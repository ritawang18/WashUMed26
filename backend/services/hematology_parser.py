import json
import os
import re
import tempfile

from config import GEMINI_MODEL, GEMINI_SUPPORT, HEMOVAT_REVIEW_COLUMNS, genai_client


def _clean_str(value):
    if value is None:
        return ''
    return str(value).strip()


def _blank_hemovat_review_row():
    return {col: '' for col in HEMOVAT_REVIEW_COLUMNS}


def _extract_hemovat_with_gemini(pdf_bytes: bytes, filename: str) -> dict:
    gemini_key = os.environ.get('GEMINI_API_KEY')
    if not gemini_key:
        raise ValueError('GEMINI_API_KEY not set')
    if not GEMINI_SUPPORT:
        raise ValueError('Gemini client package is not installed')

    client = genai_client.Client(api_key=gemini_key)
    prompt = """
Extract the Hemovat / hematology report data from this PDF.

Return ONLY a JSON object. No markdown. No extra explanation.

Use this exact structure:
{
  "metadata": {
    "Patient": "",
    "Owner Last Name": "",
    "Gender": "",
    "Sample ID": "",
    "Species": "",
    "Patient ID": "",
    "Mode": "",
    "Age": "",
    "Delivery Time": "",
    "Draw Time": "",
    "Time of Analysis": "",
    "Time of Printing": "",
    "Operator": "",
    "Veterinarian": "",
    "Comments": ""
  },
  "rows": [
    {
      "Parameter": "",
      "Result": "",
      "Unit": "",
      "Ref. Ranges": ""
    }
  ]
}

Rules:
- Keep empty fields as empty strings.
- Do not include test_no.
- Do not include flag.
- Keep parameter rows in the same order as the PDF table.
- Result may be a string or number, but preserve the visible value.
- Ref. Ranges should contain the full reference range text from the PDF.
- Sample ID is the animal/sample identifier and will become subject_id later.
- Include every numeric parameter row from the table.
"""
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
            tmp.write(pdf_bytes)
            tmp_path = tmp.name
        with open(tmp_path, 'rb') as f:
            uploaded = client.files.upload(file=f, config={'mime_type': 'application/pdf'})
        response = client.models.generate_content(model=GEMINI_MODEL, contents=[uploaded, prompt])
        raw = response.text.strip()
        if raw.startswith('```'):
            raw = re.sub(r'^```[a-zA-Z]*\n?', '', raw)
            raw = re.sub(r'\n?```$', '', raw)
        return json.loads(raw)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


def _hemovat_gemini_to_review_rows(gemini_result: dict) -> list:
    metadata = gemini_result.get('metadata') or {}
    rows = gemini_result.get('rows') or []
    review_rows = []
    metadata_cols = [
        'Patient', 'Owner Last Name', 'Gender', 'Sample ID', 'Species', 'Patient ID',
        'Mode', 'Age', 'Delivery Time', 'Draw Time', 'Time of Analysis',
        'Time of Printing', 'Operator', 'Veterinarian', 'Comments',
    ]
    for row in rows:
        out = _blank_hemovat_review_row()
        for col in metadata_cols:
            out[col] = _clean_str(metadata.get(col))
        out['Parameter'] = _clean_str(row.get('Parameter'))
        out['Result'] = _clean_str(row.get('Result'))
        out['Unit'] = _clean_str(row.get('Unit'))
        out['Ref. Ranges'] = _clean_str(row.get('Ref. Ranges'))
        if out['Parameter']:
            review_rows.append(out)
    return review_rows


def parse_hemovat_pdf_for_review(file_content, filename):
    gemini_result = _extract_hemovat_with_gemini(file_content, filename)
    rows = _hemovat_gemini_to_review_rows(gemini_result)
    if not rows:
        raise ValueError('Gemini could not extract Hemovat table rows from this PDF')
    return rows
