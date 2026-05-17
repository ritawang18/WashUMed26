import io
import re
import pandas as pd
import numpy as np
from PIL import Image

from config import EXCEL_SUPPORT
from utils.filenames import file_extension


def extract_metadata_from_filename(filename):
    """Parse filename '<subject_id> <timepoint>.ext', e.g. '9069 8w.txt'."""
    name = filename.rsplit('.', 1)[0]
    subject_id = name
    timepoint = 'Unknown_Timepoint'
    batch = 'Unknown_Batch'
    gender = 'Unknown'

    parts = name.strip().split(' ', 1)
    if len(parts) == 2:
        subject_id = parts[0].strip()
        timepoint_raw = parts[1].strip().lower()
        week_match = re.match(r'^(\d+)w$', timepoint_raw)
        if week_match:
            timepoint = f"Week_{week_match.group(1)}"
        elif timepoint_raw in ('baseline', 'pre', 'prescan', '0w'):
            timepoint = 'Baseline'
        elif timepoint_raw in ('post', 'postscan', 'final'):
            timepoint = 'Post_Scan'
        else:
            timepoint = timepoint_raw

    return {
        'batch': batch,
        'timepoint': timepoint,
        'gender': gender,
        'subject_id': subject_id,
    }


def create_standardized_record(measurements, metadata, filename, has_image_data=False):
    record = {
        'batch': metadata['batch'],
        'subject_id': metadata['subject_id'],
        'timepoint': metadata['timepoint'],
        'filename': filename,
        'has_image_data': has_image_data,
    }

    if any(k.startswith('roi_') or k.startswith('whole_') for k in measurements):
        record.update(measurements)
        return record

    standard_fields = {
        'total_weight': 0.0,
        'soft_weight': 0.0,
        'lean_weight': 0.0,
        'fat_weight': 0.0,
        'fat_percent': 0.0,
        'bmc': 0.0,
        'bmd': 0.0,
        'bone_area': 0.0,
        'sample_area': 0.0,
    }
    for field in standard_fields:
        if field in measurements:
            record[field] = measurements[field]
        else:
            found_value = None
            for meas_key, meas_value in measurements.items():
                if field.replace('_', '') in meas_key.replace('_', ''):
                    found_value = meas_value
                    break
            record[field] = found_value if found_value is not None else standard_fields[field]
    for key, value in measurements.items():
        if key not in record:
            record[key] = value
    return record


def parse_dexa_file(file_content, filename):
    metadata = extract_metadata_from_filename(filename)
    ext = file_extension(filename)
    try:
        if ext == 'txt':
            return parse_text_file(file_content, filename, metadata)
        if ext == 'csv':
            return parse_csv_file(file_content, filename, metadata)
        if ext in ['xlsx', 'xls']:
            return parse_excel_file(file_content, filename, metadata)
        if ext == 'pdf':
            raise ValueError('PDF files are handled by the Hemovat parser. Use /api/hematology/parse for Hemovat PDFs.')
        if ext in ['tif', 'tiff', 'png', 'jpeg', 'jpg', 'img', 'pxl', 'bmp']:
            return parse_image_file(file_content, filename, metadata)
        return parse_generic_file(file_content, filename, metadata)
    except Exception as e:
        raise ValueError(f'Failed to parse {filename}: {str(e)}')


def parse_text_file(file_content, filename, metadata):
    lines = file_content.decode('utf-8', errors='ignore').strip().split('\n')
    measurement_patterns = {
        'sample_area': [r'sample\s*area[:\s]*([0-9]+\.?[0-9]*)'],
        'bone_area': [r'bone\s*area[:\s]*([0-9]+\.?[0-9]*)'],
        'total_weight': [r'total\s*weight[:\s]*([0-9]+\.?[0-9]*)'],
        'soft_weight': [r'soft\s*weight[:\s]*([0-9]+\.?[0-9]*)'],
        'lean_weight': [r'lean\s*weight[:\s]*([0-9]+\.?[0-9]*)'],
        'fat_weight': [r'fat\s*weight[:\s]*([0-9]+\.?[0-9]*)'],
        'fat_percent': [r'fat\s*percent[:\s]*([0-9]+\.?[0-9]*)', r'fat\s*%[:\s]*([0-9]+\.?[0-9]*)'],
        'bmc': [r'bmc[:\s]*([0-9]+\.?[0-9]*)', r'bone\s*mineral\s*content[:\s]*([0-9]+\.?[0-9]*)'],
        'bmd': [r'bmd[:\s]*([0-9]+\.?[0-9]*)', r'bone\s*mineral\s*density[:\s]*([0-9]+\.?[0-9]*)'],
    }
    section = None
    roi_measurements = {}
    whole_measurements = {}

    for line in lines:
        line_clean = line.strip().lower()
        if 'inside roi' in line_clean:
            section = 'roi'
            continue
        if 'whole tissue' in line_clean:
            section = 'whole'
            continue
        if section is None:
            continue
        target = roi_measurements if section == 'roi' else whole_measurements
        for field, patterns in measurement_patterns.items():
            for pattern in patterns:
                match = re.search(pattern, line_clean)
                if match:
                    try:
                        target[field] = float(match.group(1))
                        break
                    except (ValueError, IndexError):
                        continue

    measurements = {f'roi_{field}': value for field, value in roi_measurements.items()}
    measurements.update({f'whole_{field}': value for field, value in whole_measurements.items()})
    return create_standardized_record(measurements, metadata, filename, has_image_data=False)


def parse_csv_file(file_content, filename, metadata):
    try:
        csv_content = file_content.decode('utf-8', errors='ignore')
        df = pd.read_csv(io.StringIO(csv_content)).dropna(how='all').reset_index(drop=True)
        if len(df) == 0:
            raise ValueError('CSV file contains no valid data')
        csv_rows = []
        for idx, row in df.iterrows():
            row_measurements = {}
            for col in df.columns:
                col_clean = str(col).strip().lower().replace(' ', '_').replace('-', '_')
                try:
                    if pd.notna(row[col]):
                        if isinstance(row[col], (int, float)):
                            row_measurements[col_clean] = float(row[col])
                        else:
                            value_str = str(row[col]).strip()
                            if value_str and value_str.replace('.', '').replace('-', '').isdigit():
                                row_measurements[col_clean] = float(value_str)
                            else:
                                row_measurements[col_clean] = value_str
                    else:
                        row_measurements[col_clean] = np.nan
                except (ValueError, TypeError):
                    row_measurements[col_clean] = str(row[col]) if pd.notna(row[col]) else np.nan
            row_metadata = metadata.copy()
            row_metadata['subject_id'] = f"{metadata['subject_id']}_row_{idx + 1}"
            csv_rows.append(create_standardized_record(row_measurements, row_metadata, filename, has_image_data=False))
        return csv_rows
    except Exception as e:
        raise ValueError(f'Failed to parse CSV file: {str(e)}')


def parse_excel_file(file_content, filename, metadata):
    excel_rows = []
    try:
        engines = ['openpyxl', 'xlrd'] if EXCEL_SUPPORT else ['openpyxl']
        excel_file = None
        for engine in engines:
            try:
                excel_file = pd.ExcelFile(io.BytesIO(file_content), engine=engine)
                break
            except Exception:
                continue
        if excel_file is None:
            raise ValueError('Could not read Excel file with any available engine')

        for sheet_name in excel_file.sheet_names:
            try:
                df = pd.read_excel(io.BytesIO(file_content), sheet_name=sheet_name, engine=excel_file.engine)
                df = df.dropna(how='all').reset_index(drop=True)
                if len(df) == 0:
                    continue
                for idx, row in df.iterrows():
                    row_measurements = {}
                    for col in df.columns:
                        col_clean = str(col).strip().lower().replace(' ', '_').replace('-', '_')
                        try:
                            if pd.notna(row[col]):
                                if isinstance(row[col], (int, float)):
                                    row_measurements[col_clean] = float(row[col])
                                else:
                                    value_str = str(row[col]).strip()
                                    if value_str and value_str.replace('.', '').replace('-', '').isdigit():
                                        row_measurements[col_clean] = float(value_str)
                                    else:
                                        row_measurements[col_clean] = value_str
                            else:
                                row_measurements[col_clean] = np.nan
                        except (ValueError, TypeError):
                            row_measurements[col_clean] = str(row[col]) if pd.notna(row[col]) else np.nan
                    row_metadata = metadata.copy()
                    row_metadata['subject_id'] = f"{metadata['subject_id']}_{sheet_name}_row_{idx + 1}"
                    excel_rows.append(create_standardized_record(row_measurements, row_metadata, f'{filename}[{sheet_name}]', has_image_data=False))
            except Exception:
                continue
        if not excel_rows:
            raise ValueError('No valid data found in any Excel sheets')
        return excel_rows
    except Exception as e:
        raise ValueError(f'Failed to parse Excel file: {str(e)}')


def parse_image_file(file_content, filename, metadata):
    try:
        image = Image.open(io.BytesIO(file_content))
        measurements = {
            'image_width': image.width,
            'image_height': image.height,
            'image_format': image.format or filename.split('.')[-1].upper(),
            'image_mode': image.mode,
            'image_size_mb': len(file_content) / (1024 * 1024),
            'pixel_density': image.width * image.height,
            'aspect_ratio': round(image.width / image.height, 2) if image.height > 0 else 0,
            'scan_quality': 'Good' if image.width > 500 and image.height > 500 else 'Low',
        }
        try:
            exif_data = image._getexif()
            if exif_data:
                measurements['has_scan_metadata'] = True
                measurements['image_date'] = exif_data.get(36867, 'Unknown')
                measurements['camera_model'] = exif_data.get(272, 'Unknown')
            else:
                measurements['has_scan_metadata'] = False
        except Exception:
            measurements['has_scan_metadata'] = False
        return create_standardized_record(measurements, metadata, filename, has_image_data=True)
    except Exception as e:
        raise ValueError(f'Failed to parse image file: {str(e)}')


def parse_generic_file(file_content, filename, metadata):
    try:
        text_content = file_content.decode('utf-8', errors='ignore')
        return parse_text_content_for_measurements(text_content, metadata, filename)
    except Exception as e:
        raise ValueError(f'Failed to parse generic file: {str(e)}')


def parse_text_content_for_measurements(text_content, metadata, filename):
    measurements = {}
    lines = text_content.strip().split('\n')
    for line in lines:
        line_clean = line.strip().lower()
        if ':' in line_clean and not line_clean.startswith('-'):
            try:
                key, value = line_clean.split(':', 1)
                key = key.strip().replace(' ', '_').replace('-', '_')
                value_clean = value.strip().split()[0] if value.strip() else '0'
                if value_clean.replace('.', '').replace('-', '').isdigit():
                    measurements[key] = float(value_clean)
                else:
                    measurements[key] = value_clean
            except (ValueError, IndexError):
                continue
    return create_standardized_record(measurements, metadata, filename, has_image_data=False)


def standardize_timepoints(df):
    df_standardized = df.copy()
    print('Standardizing timepoints...')
    timepoint_mapping = {
        'baseline': 'Baseline', 'week_0': 'Baseline', 'week0': 'Baseline', 'w0': 'Baseline',
        'pre': 'Baseline', 'prescan': 'Baseline',
        'unknown_timepoint': 'Unknown', 'unknown': 'Unknown', 'none': 'Unknown', 'nan': 'Unknown',
    }
    if 'timepoint' in df_standardized.columns:
        df_standardized['timepoint'] = df_standardized['timepoint'].astype(str).str.strip().str.lower()
        mapped = df_standardized['timepoint'].map(timepoint_mapping)

        def extract_timepoint_pattern(timepoint_str):
            timepoint_str = str(timepoint_str).lower()
            w_pattern = re.search(r'^(\d+)w$', timepoint_str)
            if w_pattern:
                week_num = int(w_pattern.group(1))
                return 'Baseline' if week_num == 0 else f'Week_{week_num}'
            week_pattern = re.search(r'(?:week|wk)[_\s]*(\d+)', timepoint_str)
            if week_pattern:
                week_num = int(week_pattern.group(1))
                return 'Baseline' if week_num == 0 else f'Week_{week_num}'
            if any(word in timepoint_str for word in ['pre', 'base', 'start', 'initial']):
                return 'Baseline'
            return timepoint_str

        unmapped_mask = mapped.isnull()
        mapped[unmapped_mask] = df_standardized.loc[unmapped_mask, 'timepoint'].apply(extract_timepoint_pattern)
        df_standardized['timepoint'] = mapped
        print(f"   Timepoints: {sorted(df_standardized['timepoint'].unique())}")
    return df_standardized
