"""
PDF table extraction for WashUMed26.
Adapted from the PDF Conversion project's table_extractor/filter/merger services.
Degrades gracefully: pdfplumber → camelot (optional) → OCR (optional).
"""
import io
import logging
import os
import re
import tempfile
from difflib import SequenceMatcher
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

try:
    import pdfplumber
    _PDFPLUMBER_AVAILABLE = True
except ImportError:
    _PDFPLUMBER_AVAILABLE = False

try:
    import camelot
    _CAMELOT_AVAILABLE = True
except ImportError:
    _CAMELOT_AVAILABLE = False

try:
    import pytesseract
    _OCR_AVAILABLE = True
except ImportError:
    _OCR_AVAILABLE = False


# ---------------------------------------------------------------------------
# Table validation (from table_filter.py)
# ---------------------------------------------------------------------------

_NUMERIC_RE = re.compile(r'^[\s$€£¥₩%,.()\-+eE\d/]+$')


def _looks_numeric(cell: str) -> bool:
    if not cell or not cell.strip():
        return False
    s = cell.strip()
    return bool(_NUMERIC_RE.match(s)) and any(c.isdigit() for c in s)


def is_valid_table(table: list) -> bool:
    if not table or len(table) < 2:
        return False
    col_count = max(len(row) for row in table)
    if col_count < 2:
        return False
    all_cells = [cell for row in table for cell in row]
    non_empty = [c for c in all_cells if c and str(c).strip()]
    if len(non_empty) < 4:
        return False
    empty_ratio = 1.0 - (len(non_empty) / max(len(all_cells), 1))
    if empty_ratio > 0.60:
        return False
    numeric_count = sum(1 for c in non_empty if _looks_numeric(str(c)))
    numeric_density = numeric_count / len(non_empty)
    if col_count == 1:
        return numeric_density >= 0.80
    return numeric_density >= 0.20


# ---------------------------------------------------------------------------
# Raw table dataclass
# ---------------------------------------------------------------------------

@dataclass
class _RawTable:
    page: int
    data: list
    method: str
    is_ocr: bool = False


def _normalize_row(row: list) -> list:
    return [str(cell).strip() if cell is not None else "" for cell in row]


# ---------------------------------------------------------------------------
# pdfplumber extraction (from table_extractor.py)
# ---------------------------------------------------------------------------

def _extract_pdfplumber_page(page, page_num: int) -> list:
    results = []
    for strategy, method_name in [
        ({"vertical_strategy": "lines", "horizontal_strategy": "lines"}, "pdfplumber-lines"),
        ({"vertical_strategy": "text", "horizontal_strategy": "text", "snap_tolerance": 5}, "pdfplumber-text"),
    ]:
        try:
            tables = page.extract_tables(table_settings=strategy)
        except Exception as e:
            logger.warning(f"pdfplumber {method_name} failed on page {page_num}: {e}")
            continue
        for t in (tables or []):
            if t and is_valid_table(t):
                results.append(_RawTable(
                    page=page_num,
                    data=[_normalize_row(r) for r in t],
                    method=method_name,
                ))
        if results:
            break
    return results


# ---------------------------------------------------------------------------
# Camelot fallback (adapted for bytes input)
# ---------------------------------------------------------------------------

def _extract_camelot_page(pdf_bytes: bytes, page_num: int) -> list:
    if not _CAMELOT_AVAILABLE:
        return []
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
            tmp.write(pdf_bytes)
            tmp_path = tmp.name
        results = []
        for flavor, method_name in [("lattice", "camelot-lattice"), ("stream", "camelot-stream")]:
            try:
                tables = camelot.read_pdf(tmp_path, pages=str(page_num), flavor=flavor)
                for t in tables:
                    raw = t.df.values.tolist()
                    if is_valid_table(raw):
                        results.append(_RawTable(
                            page=page_num,
                            data=[_normalize_row(r) for r in raw],
                            method=method_name,
                        ))
                if results:
                    break
            except Exception as e:
                logger.warning(f"camelot {flavor} failed on page {page_num}: {e}")
        return results
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


# ---------------------------------------------------------------------------
# OCR fallback (from table_extractor.py)
# ---------------------------------------------------------------------------

def _is_scanned_page(page) -> bool:
    return len(page.chars) < 10


def _parse_ocr_tables(text: str, page_num: int) -> list:
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    if not lines:
        return []
    table_groups = []
    current = []
    for line in lines:
        parts = line.split()
        if len(parts) >= 2:
            current.append(parts)
        else:
            if len(current) >= 2:
                table_groups.append(current)
            current = []
    if len(current) >= 2:
        table_groups.append(current)
    results = []
    for raw_table in table_groups:
        if is_valid_table(raw_table):
            results.append(_RawTable(
                page=page_num,
                data=[_normalize_row(r) for r in raw_table],
                method="ocr",
                is_ocr=True,
            ))
    return results


def _extract_ocr_page(page, page_num: int) -> tuple:
    if not _OCR_AVAILABLE:
        return [], False
    try:
        img = page.to_image(resolution=200).original
        ocr_text = pytesseract.image_to_string(img)
        return _parse_ocr_tables(ocr_text, page_num), True
    except Exception as e:
        logger.warning(f"OCR failed on page {page_num}: {e}")
        return [], True


# ---------------------------------------------------------------------------
# Multi-page table merging (adapted from table_merger.py, no Pydantic)
# ---------------------------------------------------------------------------

def _header_similarity(h1: list, h2: list) -> float:
    s1 = " ".join(str(x) for x in h1)
    s2 = " ".join(str(x) for x in h2)
    return SequenceMatcher(None, s1, s2).ratio()


def _merge_and_structure(raw_tables: list) -> list:
    """
    Convert _RawTable list to plain dicts and merge consecutive-page tables
    with matching column counts and similar headers (similarity > 0.7).
    Returns list of {"page": int, "pages": [int], "headers": [...], "rows": [[...]], "method": str}
    """
    if not raw_tables:
        return []

    # Convert to plain dicts; first row = headers, rest = rows
    structured = []
    for rt in raw_tables:
        if not rt.data:
            continue
        headers = rt.data[0]
        rows = rt.data[1:]
        structured.append({
            "page": rt.page,
            "pages": [rt.page],
            "headers": headers,
            "rows": rows,
            "method": rt.method,
            "is_ocr": rt.is_ocr,
        })

    if not structured:
        return []

    merged = [structured[0]]
    for current in structured[1:]:
        prev = merged[-1]
        if (current["page"] == prev["pages"][-1] + 1
                and len(current["headers"]) == len(prev["headers"])
                and _header_similarity(prev["headers"], current["headers"]) >= 0.70):
            extra_rows = current["rows"]
            if extra_rows and extra_rows[0] == current["headers"]:
                extra_rows = extra_rows[1:]
            merged[-1] = {
                "page": prev["page"],
                "pages": prev["pages"] + current["pages"],
                "headers": prev["headers"],
                "rows": prev["rows"] + extra_rows,
                "method": prev["method"],
                "is_ocr": prev["is_ocr"] or current["is_ocr"],
            }
        else:
            merged.append(current)

    return merged


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def extract_tables_from_bytes(pdf_bytes: bytes) -> list:
    """
    Extract tables from a PDF given as raw bytes.
    Returns list of dicts: [{"headers": [...], "rows": [[...]], "page": int, ...}]
    Returns [] if no tables found or pdfplumber is not installed.
    """
    if not _PDFPLUMBER_AVAILABLE:
        raise ImportError("pdfplumber is required for PDF table extraction")

    all_raw: list = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page_num, page in enumerate(pdf.pages, 1):
            if _is_scanned_page(page):
                ocr_tables, _ = _extract_ocr_page(page, page_num)
                all_raw.extend(ocr_tables)
            else:
                page_tables = _extract_pdfplumber_page(page, page_num)
                if not page_tables:
                    page_tables = _extract_camelot_page(pdf_bytes, page_num)
                all_raw.extend(page_tables)

    return _merge_and_structure(all_raw)
