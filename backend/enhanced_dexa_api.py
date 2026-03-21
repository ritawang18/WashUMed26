"""
Enhanced DEXA Data Processing API

This Flask API processes uploaded DEXA scan files using advanced multi-file processing,
flexible file type support, intelligent data cleaning, and smart missing data imputation.

Features:
Multi-file batch processing (5+ files simultaneously)
Flexible file type support (.txt, .csv, .xlsx, .pdf, images)
Automatic data cleaning and validation
Smart missing data imputation with multiple strategies
Unified format standardization
Comprehensive error handling and progress tracking
Export to multiple formats with summaries

Based on unified format logic from batch processing notebooks.
"""

from flask import Flask, request, jsonify, send_file
import pandas as pd
import numpy as np
from pathlib import Path
from PIL import Image
import os
import tempfile
import uuid
from datetime import datetime
import io
import zipfile
import re
import warnings
warnings.filterwarnings('ignore')

# Optional PDF support
try:
    import pdfplumber
    PDF_SUPPORT = True
except ImportError:
    PDF_SUPPORT = False

# Enhanced Excel support
try:
    import xlrd
    import openpyxl
    EXCEL_SUPPORT = True
except ImportError:
    EXCEL_SUPPORT = False

app = Flask(__name__)

# Enhanced CORS headers
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

# Configuration
BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_FOLDER = BASE_DIR / "backend" / "temp_uploads"
UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)
EXPORT_FOLDER = BASE_DIR / "frontend" / "exports"
EXPORT_FOLDER.mkdir(parents=True, exist_ok=True)

# Enhanced configuration
MAX_FILES_PER_BATCH = 50
MAX_FILE_SIZE_MB = 50
SUPPORTED_EXTENSIONS = ['.txt', '.csv', '.xlsx', '.xls', '.pdf', '.tif', '.tiff', '.png', '.jpeg', '.jpg', '.img', '.pxl', '.bmp']

# Metadata extraction from filename
def extract_metadata_from_filename(filename):
    """Parse filename in the format '<subject_id> <timepoint>.ext', e.g. '9069 8w.txt'."""
    name = filename.rsplit('.', 1)[0]  # strip extension

    # Default values
    subject_id = name
    timepoint = 'Unknown_Timepoint'
    batch = 'Unknown_Batch'
    gender = 'Unknown'

    # Split on first space: '<subject_id> <timepoint>'
    parts = name.strip().split(' ', 1)
    if len(parts) == 2:
        subject_id = parts[0].strip()
        timepoint_raw = parts[1].strip().lower()

        # Match Nw format (e.g. 8w, 4w, 12w)
        week_match = re.match(r'^(\d+)w$', timepoint_raw)
        if week_match:
            timepoint = f"Week_{week_match.group(1)}"
        elif timepoint_raw in ('baseline', 'pre', 'prescan', '0w'):
            timepoint = 'Baseline'
        elif timepoint_raw in ('post', 'postscan', 'final'):
            timepoint = 'Post_Scan'
        else:
            timepoint = timepoint_raw  # keep as-is if unrecognized

    return {
        'batch': batch,
        'timepoint': timepoint,
        'gender': gender,
        'subject_id': subject_id
    }

def create_standardized_record(measurements, metadata, filename, has_image_data=False):
    """Create a standardized DEXA record with all required fields."""
    record = {
        'batch': metadata['batch'],
        'subject_id': metadata['subject_id'],
        'timepoint': metadata['timepoint'],
        'gender': metadata['gender'],
        'filename': filename,
        'has_image_data': has_image_data
    }

    # If measurements are already section-prefixed (roi_/whole_), add them directly
    if any(k.startswith('roi_') or k.startswith('whole_') for k in measurements):
        record.update(measurements)
    else:
        # Legacy: fill standard fields with fuzzy matching for non-prefixed measurements
        standard_fields = {
            'total_weight': 0.0,
            'soft_weight': 0.0,
            'lean_weight': 0.0,
            'fat_weight': 0.0,
            'fat_percent': 0.0,
            'bmc': 0.0,
            'bmd': 0.0,
            'bone_area': 0.0,
            'sample_area': 0.0
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

def parse_dexa_file_enhanced(file_content, filename):
    """Enhanced DEXA file parser with support for all file types."""
    
    metadata = extract_metadata_from_filename(filename)
    file_extension = filename.lower().split('.')[-1]
    
    try:
        if file_extension == 'txt':
            return parse_text_file(file_content, filename, metadata)
        elif file_extension == 'csv':
            return parse_csv_file(file_content, filename, metadata)
        elif file_extension in ['xlsx', 'xls']:
            return parse_excel_file(file_content, filename, metadata)
        elif file_extension == 'pdf':
            return parse_pdf_file(file_content, filename, metadata)
        elif file_extension in ['tif', 'tiff', 'png', 'jpeg', 'jpg', 'img', 'pxl', 'bmp']:
            return parse_image_file(file_content, filename, metadata)
        else:
            return parse_generic_file(file_content, filename, metadata)
    except Exception as e:
        raise ValueError(f"Failed to parse {filename}: {str(e)}")

def parse_text_file(file_content, filename, metadata):
    """Parse DEXA text files, capturing ROI and Whole Tissue sections separately."""
    lines = file_content.decode('utf-8', errors='ignore').strip().split('\n')

    measurement_patterns = {
        'sample_area': [r'sample\s*area[:\s]*([0-9]+\.?[0-9]*)'],
        'bone_area':   [r'bone\s*area[:\s]*([0-9]+\.?[0-9]*)'],
        'total_weight':[r'total\s*weight[:\s]*([0-9]+\.?[0-9]*)'],
        'soft_weight': [r'soft\s*weight[:\s]*([0-9]+\.?[0-9]*)'],
        'lean_weight': [r'lean\s*weight[:\s]*([0-9]+\.?[0-9]*)'],
        'fat_weight':  [r'fat\s*weight[:\s]*([0-9]+\.?[0-9]*)'],
        'fat_percent': [r'fat\s*percent[:\s]*([0-9]+\.?[0-9]*)', r'fat\s*%[:\s]*([0-9]+\.?[0-9]*)'],
        'bmc':         [r'bmc[:\s]*([0-9]+\.?[0-9]*)', r'bone\s*mineral\s*content[:\s]*([0-9]+\.?[0-9]*)'],
        'bmd':         [r'bmd[:\s]*([0-9]+\.?[0-9]*)', r'bone\s*mineral\s*density[:\s]*([0-9]+\.?[0-9]*)']
    }

    # Track which section we're currently in
    section = None
    roi_measurements = {}
    whole_measurements = {}

    for line in lines:
        line_clean = line.strip().lower()

        # Detect section headers
        if 'inside roi' in line_clean:
            section = 'roi'
            continue
        elif 'whole tissue' in line_clean:
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

    # Prefix each section's fields and merge into one measurements dict
    measurements = {}
    for field, value in roi_measurements.items():
        measurements[f'roi_{field}'] = value
    for field, value in whole_measurements.items():
        measurements[f'whole_{field}'] = value

    return create_standardized_record(measurements, metadata, filename, has_image_data=False)

def parse_csv_file(file_content, filename, metadata):
    """Parse CSV files with enhanced multi-row support."""
    try:
        csv_content = file_content.decode('utf-8', errors='ignore')
        df = pd.read_csv(io.StringIO(csv_content))
        df = df.dropna(how='all').reset_index(drop=True)
        
        if len(df) == 0:
            raise ValueError("CSV file contains no valid data")
        
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
            row_metadata['subject_id'] = f"{metadata['subject_id']}_row_{idx+1}"
            
            csv_rows.append(create_standardized_record(row_measurements, row_metadata, 
                                                     filename, has_image_data=False))
        
        return csv_rows
        
    except Exception as e:
        raise ValueError(f"Failed to parse CSV file: {str(e)}")

def parse_excel_file(file_content, filename, metadata):
    """Parse Excel files with enhanced multi-sheet support."""
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
            raise ValueError("Could not read Excel file with any available engine")
        
        for sheet_name in excel_file.sheet_names:
            try:
                df = pd.read_excel(io.BytesIO(file_content), sheet_name=sheet_name, 
                                 engine=excel_file.engine)
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
                    row_metadata['subject_id'] = f"{metadata['subject_id']}_{sheet_name}_row_{idx+1}"
                    
                    excel_rows.append(create_standardized_record(row_measurements, row_metadata,
                                                               f"{filename}[{sheet_name}]", has_image_data=False))
            
            except Exception as sheet_error:
                continue
        
        if not excel_rows:
            raise ValueError("No valid data found in any Excel sheets")
            
        return excel_rows
        
    except Exception as e:
        raise ValueError(f"Failed to parse Excel file: {str(e)}")

def parse_pdf_file(file_content, filename, metadata):
    """Parse PDF files with text extraction."""
    if not PDF_SUPPORT:
        raise ValueError("PDF processing not available - install pdfplumber")
    
    try:
        with pdfplumber.open(io.BytesIO(file_content)) as pdf:
            text_content = ""
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text_content += page_text + "\n"
        
        if not text_content.strip():
            raise ValueError("No text found in PDF")
        
        return parse_text_content_for_measurements(text_content, metadata, filename)
        
    except Exception as e:
        raise ValueError(f"Failed to parse PDF file: {str(e)}")

def parse_image_file(file_content, filename, metadata):
    """Parse image files and extract metadata."""
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
            'scan_quality': 'Good' if image.width > 500 and image.height > 500 else 'Low'
        }
        
        try:
            exif_data = image._getexif()
            if exif_data:
                measurements['has_scan_metadata'] = True
                measurements['image_date'] = exif_data.get(36867, 'Unknown')
                measurements['camera_model'] = exif_data.get(272, 'Unknown')
            else:
                measurements['has_scan_metadata'] = False
        except:
            measurements['has_scan_metadata'] = False
        
        return create_standardized_record(measurements, metadata, filename, has_image_data=True)
        
    except Exception as e:
        raise ValueError(f"Failed to parse image file: {str(e)}")

def parse_generic_file(file_content, filename, metadata):
    """Generic parser for unknown file types."""
    try:
        text_content = file_content.decode('utf-8', errors='ignore')
        return parse_text_content_for_measurements(text_content, metadata, filename)
    except Exception as e:
        raise ValueError(f"Failed to parse generic file: {str(e)}")

def parse_text_content_for_measurements(text_content, metadata, filename):
    """Extract measurements from any text content."""
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

# Enhanced data cleaning functions (same as before but with improvements)
def clean_dexa_data_enhanced(df):
    """Comprehensive data cleaning with enhanced patterns and standardization."""
    cleaned_df = df.copy()
    original_count = len(cleaned_df)
    
    print(f"Starting data cleaning and standardization...")
    print(f"   Initial records: {original_count}")
    
    # 1. ENHANCED TEST PATTERN DETECTION
    test_patterns = ['test', 'TEST', 'Test', 'calibration', 'CALIBRATION', 'blank', 'BLANK', 
                    'standard', 'STANDARD', 'control', 'CONTROL', 'phantom', 'PHANTOM',
                    'demo', 'DEMO', 'sample', 'SAMPLE', 'unknown', 'UNKNOWN', 'null', 'NULL']
    
    test_columns = ['subject_id', 'filename']
    for col in test_columns:
        if col in cleaned_df.columns:
            for pattern in test_patterns:
                mask = cleaned_df[col].astype(str).str.contains(pattern, case=False, na=False)
                test_rows_removed = mask.sum()
                if test_rows_removed > 0:
                    print(f"   Removing {test_rows_removed} test/calibration rows from {col}")
                    cleaned_df = cleaned_df[~mask]
    
    # 2. STANDARDIZE COLUMN NAMES
    print("   Standardizing column names...")
    column_mapping = {
        # Common variations for key fields
        'subject': 'subject_id', 'mouse_id': 'subject_id', 'animal_id': 'subject_id',
        'batch_number': 'batch', 'batch_id': 'batch', 'group': 'batch',
        'time_point': 'timepoint', 'time': 'timepoint', 'week': 'timepoint',
        'sex': 'gender', 'gender_id': 'gender',
        
        # Weight measurements
        'total_wt': 'total_weight', 'tot_weight': 'total_weight', 'body_weight': 'total_weight',
        'soft_wt': 'soft_weight', 'tissue_weight': 'soft_weight',
        'lean_wt': 'lean_weight', 'lean_mass': 'lean_weight',
        'fat_wt': 'fat_weight', 'fat_mass': 'fat_weight',
        'fat_pct': 'fat_percent', 'fat_%': 'fat_percent', 'body_fat_%': 'fat_percent',
        
        # Bone measurements
        'bone_mineral_content': 'bmc', 'bmc_g': 'bmc',
        'bone_mineral_density': 'bmd', 'bmd_mg_cm2': 'bmd', 'bmd_mg/cm2': 'bmd',
        'bone_area_cm2': 'bone_area', 'b_area': 'bone_area', 'area_bone': 'bone_area',
        'sample_area_cm2': 'sample_area', 's_area': 'sample_area', 'area_sample': 'sample_area'
    }
    
    # Apply column standardization
    cleaned_df.columns = [column_mapping.get(col.lower().replace(' ', '_').replace('-', '_'), col) 
                         for col in cleaned_df.columns]
    
    # Remove duplicate columns (keep first occurrence)
    if cleaned_df.columns.duplicated().any():
        print(f"   Found {cleaned_df.columns.duplicated().sum()} duplicate columns, removing duplicates...")
        cleaned_df = cleaned_df.loc[:, ~cleaned_df.columns.duplicated()]
    
    # 3. ENHANCED DATA VALIDATION AND CLEANING
    critical_fields = ['subject_id', 'batch', 'timepoint']
    before_validation = len(cleaned_df)
    cleaned_df = cleaned_df.dropna(subset=critical_fields, how='any')
    validation_removed = before_validation - len(cleaned_df)
    if validation_removed > 0:
        print(f"   Removed {validation_removed} records with missing critical fields")
    
    # 4. MEASUREMENT FIELD STANDARDIZATION AND VALIDATION
    print("   Standardizing and validating measurements...")

    # Define realistic ranges for base field names (applied to both roi_ and whole_ columns)
    measurement_ranges = {
        'total_weight': (5.0, 200.0),
        'soft_weight':  (5.0, 180.0),
        'lean_weight':  (5.0, 150.0),
        'fat_weight':   (0.1, 50.0),
        'fat_percent':  (1.0, 60.0),
        'bmc':          (0.01, 5.0),
        'bmd':          (10.0, 300.0),
        'bone_area':    (0.5, 25.0),
        'sample_area':  (1.0, 50.0)
    }

    # Build the list of actual columns to validate, matching roi_/whole_ prefixed columns
    measurement_fields = [
        col for col in cleaned_df.columns
        if any(col == f'{prefix}{base}'
               for prefix in ('roi_', 'whole_')
               for base in measurement_ranges)
    ]

    for field in measurement_fields:
        base_field = field.split('_', 1)[1]  # strip roi_ or whole_ prefix
        if field in cleaned_df.columns:
            # Convert to numeric first
            cleaned_df[field] = pd.to_numeric(cleaned_df[field], errors='coerce')
            
            # Apply range validation if defined
            if base_field in measurement_ranges:
                min_val, max_val = measurement_ranges[base_field]
                before_range = len(cleaned_df)
                valid_mask = (cleaned_df[field] >= min_val) & (cleaned_df[field] <= max_val)
                # Keep NaN values but remove out-of-range values
                cleaned_df = cleaned_df[valid_mask | cleaned_df[field].isna()]
                range_removed = before_range - len(cleaned_df)
                if range_removed > 0:
                    print(f"   Removed {range_removed} records with {field} outside range [{min_val}-{max_val}]")
            
            # Statistical outlier detection (more conservative)
            if len(cleaned_df) > 10 and cleaned_df[field].notna().sum() > 5:
                field_data = cleaned_df[field].dropna()
                if len(field_data) > 0 and field_data.std() > 0:
                    # Use modified Z-score method
                    median = field_data.median()
                    mad = (field_data - median).abs().median()
                    if mad > 0:
                        modified_z_scores = 0.6745 * (field_data - median) / mad
                        outlier_threshold = 3.5  # More conservative threshold
                        
                        outlier_mask = cleaned_df[field].apply(
                            lambda x: abs(0.6745 * (x - median) / mad) > outlier_threshold 
                            if pd.notna(x) and mad > 0 else False
                        )
                        
                        outlier_count = outlier_mask.sum()
                        if outlier_count > 0 and outlier_count < len(cleaned_df) * 0.05:  # Max 5% outliers
                            cleaned_df = cleaned_df[~outlier_mask]
                            print(f"   Removed {outlier_count} statistical outliers in {field}")
    
    # 5. ENHANCED SUBJECT ID STANDARDIZATION
    print("   Standardizing subject IDs...")
    if 'subject_id' in cleaned_df.columns:
        # Clean subject IDs
        cleaned_df['subject_id'] = cleaned_df['subject_id'].astype(str).str.strip()
        
        # Remove obviously invalid IDs
        invalid_ids = ['', 'nan', 'none', 'null', 'unknown', 'missing', 'test', 'sample']
        before_id_clean = len(cleaned_df)
        id_mask = ~cleaned_df['subject_id'].str.lower().isin(invalid_ids)
        cleaned_df = cleaned_df[id_mask]
        id_removed = before_id_clean - len(cleaned_df)
        if id_removed > 0:
            print(f"   Removed {id_removed} records with invalid subject IDs")
        
        # Keep subject ID as raw value — no reformatting
    
    # 6. ENHANCED BATCH STANDARDIZATION
    print("   Standardizing batch naming...")
    if 'batch' in cleaned_df.columns:
        batch_mapping = {
            # Standard patterns
            'batch1': 'Batch_1', 'batch_1': 'Batch_1', 'b1': 'Batch_1', 'batch 1': 'Batch_1',
            'batch2': 'Batch_2', 'batch_2': 'Batch_2', 'b2': 'Batch_2', 'batch 2': 'Batch_2',
            'batch3': 'Batch_3', 'batch_3': 'Batch_3', 'b3': 'Batch_3', 'batch 3': 'Batch_3',
            'batch4': 'Batch_4', 'batch_4': 'Batch_4', 'b4': 'Batch_4', 'batch 4': 'Batch_4',
            'batch5': 'Batch_5', 'batch_5': 'Batch_5', 'b5': 'Batch_5', 'batch 5': 'Batch_5',
            'batch6': 'Batch_6', 'batch_6': 'Batch_6', 'b6': 'Batch_6', 'batch 6': 'Batch_6',
            'batch7': 'Batch_7', 'batch_7': 'Batch_7', 'b7': 'Batch_7', 'batch 7': 'Batch_7',
            'batch8': 'Batch_8', 'batch_8': 'Batch_8', 'b8': 'Batch_8', 'batch 8': 'Batch_8',
            'batch9': 'Batch_9', 'batch_9': 'Batch_9', 'b9': 'Batch_9', 'batch 9': 'Batch_9',
            'batch10': 'Batch_10', 'batch_10': 'Batch_10', 'b10': 'Batch_10', 'batch 10': 'Batch_10'
        }
        
        cleaned_df['batch'] = cleaned_df['batch'].astype(str).str.lower().str.strip()
        cleaned_df['batch'] = cleaned_df['batch'].map(batch_mapping).fillna(cleaned_df['batch'])
        
        # For unmapped batches, try to standardize format
        def standardize_batch(batch_str):
            if batch_str.startswith('batch_'):
                return batch_str
            
            # Try to extract number and format as Batch_X
            import re
            number_match = re.search(r'(\d+)', str(batch_str))
            if number_match:
                number = number_match.group(1)
                return f"Batch_{number}"
            return batch_str
        
        unmapped_mask = ~cleaned_df['batch'].str.startswith('Batch_')
        if unmapped_mask.any():
            cleaned_df.loc[unmapped_mask, 'batch'] = cleaned_df.loc[unmapped_mask, 'batch'].apply(standardize_batch)
    
    # 7. GENDER STANDARDIZATION
    print("   Standardizing gender values...")
    if 'gender' in cleaned_df.columns:
        gender_mapping = {
            'm': 'Male', 'male': 'Male', 'M': 'Male', 'MALE': 'Male', 'Male': 'Male',
            'f': 'Female', 'female': 'Female', 'F': 'Female', 'FEMALE': 'Female', 'Female': 'Female',
            '1': 'Male', '2': 'Female',  # Sometimes encoded as numbers
            'boy': 'Male', 'girl': 'Female',
            '': 'Unknown', 'nan': 'Unknown', 'None': 'Unknown', 'unknown': 'Unknown'
        }
        
        cleaned_df['gender'] = cleaned_df['gender'].astype(str).str.strip()
        # Replace empty strings and 'nan' with actual Unknown
        cleaned_df['gender'] = cleaned_df['gender'].replace(['', 'nan', 'None', 'NaN'], 'Unknown')
        cleaned_df['gender'] = cleaned_df['gender'].map(gender_mapping).fillna('Unknown')
        
        # Mark unrecognized genders as Unknown instead of removing them
        valid_genders = ['Male', 'Female', 'Unknown']
        unrecognized_mask = ~cleaned_df['gender'].isin(valid_genders)
        unrecognized_count = unrecognized_mask.sum()
        if unrecognized_count > 0:
            print(f"   Marked {unrecognized_count} records with unrecognized gender as 'Unknown'")
            cleaned_df.loc[unrecognized_mask, 'gender'] = 'Unknown'
    
    records_after_cleaning = len(cleaned_df)
    total_removed = original_count - records_after_cleaning
    
    print(f"Data cleaning complete!")
    print(f"   Final records: {records_after_cleaning}")
    print(f"   Total removed: {total_removed}")
    print(f"   Retention rate: {(records_after_cleaning/original_count)*100:.1f}%")
    
    return cleaned_df

def smart_impute_missing_data_enhanced(df, measurement_fields, strategy='group_median'):
    """Enhanced smart imputation with multiple strategies and validation."""
    imputed_df = df.copy()
    imputation_summary = {}
    
    print(f"SMART MISSING DATA IMPUTATION - Strategy: {strategy}")
    
    for field in measurement_fields:
        if field not in imputed_df.columns:
            continue
            
        imputed_df[field] = pd.to_numeric(imputed_df[field], errors='coerce')
        
        missing_count = imputed_df[field].isnull().sum()
        total_count = len(imputed_df)
        missing_percent = (missing_count / total_count) * 100 if total_count > 0 else 0
        
        if missing_count > 0:
            print(f"  {field}: {missing_count}/{total_count} missing ({missing_percent:.1f}%)")
            
            if strategy == 'leave_nan':
                print(f"    Keeping {missing_count} NaN values for analysis")
                
            elif strategy == 'zero':
                imputed_df[field] = imputed_df[field].fillna(0)
                print(f"    Filled {missing_count} values with 0")
                
            elif strategy == 'group_median':
                if 'batch' in imputed_df.columns and 'gender' in imputed_df.columns:
                    group_medians = imputed_df.groupby(['batch', 'gender'])[field].median()
                    
                    for (batch, gender), median_val in group_medians.items():
                        if pd.notna(median_val):
                            mask = (imputed_df['batch'] == batch) & \
                                   (imputed_df['gender'] == gender) & \
                                   (imputed_df[field].isnull())
                            imputed_df.loc[mask, field] = median_val
                    
                    overall_median = imputed_df[field].median()
                    if pd.notna(overall_median):
                        imputed_df[field] = imputed_df[field].fillna(overall_median)
                    
                    remaining_nan = imputed_df[field].isnull().sum()
                    filled_count = missing_count - remaining_nan
                    print(f"    Filled {filled_count} values with group medians")
                    
                else:
                    median_val = imputed_df[field].median()
                    if pd.notna(median_val):
                        imputed_df[field] = imputed_df[field].fillna(median_val)
                        print(f"    Filled {missing_count} values with overall median: {median_val:.2f}")
                
            elif strategy == 'forward_fill':
                if 'subject_id' in imputed_df.columns and 'timepoint' in imputed_df.columns:
                    imputed_df = imputed_df.sort_values(['subject_id', 'timepoint'])
                    imputed_df[field] = imputed_df.groupby('subject_id')[field].fillna(method='ffill')
                    imputed_df[field] = imputed_df.groupby('subject_id')[field].fillna(method='bfill')
                    
                    remaining_nan = imputed_df[field].isnull().sum()
                    filled_count = missing_count - remaining_nan
                    print(f"    Filled {filled_count} values with longitudinal data")
                    
            elif strategy == 'smart':
                if missing_percent > 60:
                    print(f"    Too much missing data ({missing_percent:.1f}%) - keeping as NaN")
                elif field in ['total_weight', 'soft_weight', 'lean_weight']:
                    # Use group median for weight fields
                    if 'batch' in imputed_df.columns and 'gender' in imputed_df.columns:
                        group_medians = imputed_df.groupby(['batch', 'gender'])[field].median()
                        for (batch, gender), median_val in group_medians.items():
                            if pd.notna(median_val):
                                mask = (imputed_df['batch'] == batch) & \
                                       (imputed_df['gender'] == gender) & \
                                       (imputed_df[field].isnull())
                                imputed_df.loc[mask, field] = median_val
                    print(f"    Smart fill for {field}: group-based imputation")
                else:
                    print(f"    Smart fill for {field}: keeping as NaN for analysis")
            
            final_missing = imputed_df[field].isnull().sum()
            imputation_summary[field] = {
                'original_missing': missing_count,
                'final_missing': final_missing,
                'imputed_count': missing_count - final_missing,
                'strategy_used': strategy
            }
    
    if imputation_summary:
        print(f"  Imputation Summary: {len(imputation_summary)} fields processed")
        
    return imputed_df

def standardize_timepoints(df):
    """Enhanced timepoint standardization across all batches with comprehensive mapping."""
    df_standardized = df.copy()
    
    print("Standardizing timepoints...")
    
    # Timepoint mapping — Week_N only, no post-treatment logic
    timepoint_mapping = {
        'baseline': 'Baseline', 'week_0': 'Baseline', 'week0': 'Baseline', 'w0': 'Baseline',
        'pre': 'Baseline', 'prescan': 'Baseline',
        'unknown_timepoint': 'Unknown', 'unknown': 'Unknown', 'none': 'Unknown', 'nan': 'Unknown'
    }
    
    # Store original timepoint for reference
    if 'timepoint' in df_standardized.columns:
        df_standardized['timepoint'] = df_standardized['timepoint'].astype(str).str.strip().str.lower()

        # Apply static mapping first
        mapped = df_standardized['timepoint'].map(timepoint_mapping)

        # For unmapped timepoints, apply pattern matching
        def extract_timepoint_pattern(timepoint_str):
            timepoint_str = str(timepoint_str).lower()

            # Match Nw format (e.g. 8w, 4w)
            w_pattern = re.search(r'^(\d+)w$', timepoint_str)
            if w_pattern:
                week_num = int(w_pattern.group(1))
                return 'Baseline' if week_num == 0 else f'Week_{week_num}'

            # Match week_N / weekN / wkN patterns
            week_pattern = re.search(r'(?:week|wk)[_\s]*(\d+)', timepoint_str)
            if week_pattern:
                week_num = int(week_pattern.group(1))
                return 'Baseline' if week_num == 0 else f'Week_{week_num}'

            if any(word in timepoint_str for word in ['pre', 'base', 'start', 'initial']):
                return 'Baseline'

            return timepoint_str  # keep as-is if unrecognized

        unmapped_mask = mapped.isnull()
        mapped[unmapped_mask] = df_standardized.loc[unmapped_mask, 'timepoint'].apply(extract_timepoint_pattern)

        df_standardized['timepoint'] = mapped
        print(f"   Timepoints: {sorted(df_standardized['timepoint'].unique())}")
    
    return df_standardized

@app.route('/api/process-dexa', methods=['POST'])
def process_dexa_files_enhanced():
    """
    Enhanced DEXA file processing with multi-file support and advanced features.
    """
    try:
        files = request.files.getlist('files')
        
        if not files:
            return jsonify({
                "status": "error", 
                "error": "No files uploaded"
            }), 400
        
        # Enhanced file limit handling
        if len(files) > MAX_FILES_PER_BATCH:
            files = files[:MAX_FILES_PER_BATCH]
            app.logger.warning(f"File limit exceeded. Processing only first {MAX_FILES_PER_BATCH} files.")
        
        # Enhanced processing with detailed tracking
        all_data = []
        processing_errors = []
        processed_count = 0
        file_type_stats = {}
        
        print(f"Starting enhanced batch processing of {len(files)} files...")
        
        for i, file in enumerate(files):
            if file.filename == '':
                continue
            
            try:
                print(f"Processing {i+1}/{len(files)}: {file.filename}")
                
                # Enhanced file validation
                file_content = file.read()
                file_size_mb = len(file_content) / (1024 * 1024)
                
                if file_size_mb > MAX_FILE_SIZE_MB:
                    processing_errors.append(f"{file.filename}: File too large ({file_size_mb:.1f}MB, max: {MAX_FILE_SIZE_MB}MB)")
                    continue
                
                # Enhanced file parsing
                parsed_row = parse_dexa_file_enhanced(file_content, file.filename)
                processed_count += 1
                
                # Track file types
                file_ext = file.filename.lower().split('.')[-1]
                file_type_stats[file_ext] = file_type_stats.get(file_ext, 0) + 1
                
                # Handle multiple rows from CSV/Excel files
                if isinstance(parsed_row, list):
                    all_data.extend(parsed_row)
                    print(f"    Extracted {len(parsed_row)} records")
                else:
                    all_data.append(parsed_row)
                    print(f"    Extracted 1 record")
                    
            except Exception as e:
                error_msg = str(e)
                # Enhanced error messages
                if "xlrd" in error_msg.lower():
                    error_msg = "Excel format not supported. Please convert to .xlsx or .csv"
                elif "unicode" in error_msg.lower():
                    error_msg = "File encoding not supported. Please save as UTF-8"
                elif "pdf" in error_msg.lower() and not PDF_SUPPORT:
                    error_msg = "PDF processing not available. Please convert to text format"
                
                processing_errors.append(f"{file.filename}: {error_msg}")
                app.logger.warning(f"Failed to process {file.filename}: {e}")
                continue
        
        if not all_data:
            error_msg = "No valid files processed"
            if processing_errors:
                error_msg += f". Errors: {'; '.join(processing_errors[:3])}..."
            return jsonify({
                "status": "error", 
                "error": error_msg
            }), 400
        
        print(f"Total records extracted: {len(all_data)}")
        
        # Create DataFrame and apply enhanced processing
        df = pd.DataFrame(all_data)
        
        # Enhanced data cleaning
        print("Starting enhanced data cleaning...")
        cleaned_df = clean_dexa_data_enhanced(df)
        
        # Smart imputation with configurable strategy
        imputation_strategy = request.form.get('imputation_strategy', 'group_median')
        base_fields = ['total_weight', 'soft_weight', 'lean_weight', 'fat_weight',
                       'fat_percent', 'bmc', 'bmd', 'bone_area', 'sample_area']
        measurement_fields = [
            col for col in cleaned_df.columns
            if any(col == f'{prefix}{base}'
                   for prefix in ('roi_', 'whole_')
                   for base in base_fields)
        ]
        
        print("Starting smart missing data imputation...")
        imputed_df = smart_impute_missing_data_enhanced(cleaned_df, measurement_fields, strategy=imputation_strategy)
        
        # Timepoint standardization
        print("Standardizing timepoints...")
        standardized_df = standardize_timepoints(imputed_df)
        
        # Enhanced duplicate removal
        print("Removing duplicates...")
        original_count = len(standardized_df)
        standardized_df = standardized_df.drop_duplicates()
        duplicates_removed = original_count - len(standardized_df)
        
        # Generate enhanced filename
        timestamp = datetime.now().strftime("%Y%m%d_%H%M")
        counter = 1
        while True:
            csv_filename = f"DEXA_Enhanced_{timestamp}_{counter:02d}.csv"
            if not (EXPORT_FOLDER / csv_filename).exists():
                break
            counter += 1
        
        # Save enhanced CSV output
        csv_path = EXPORT_FOLDER / csv_filename
        standardized_df.to_csv(csv_path, index=False)
        
        print("Enhanced processing complete!")
        
        # Enhanced response with detailed statistics
        response_data = {
            "status": "success",
            "processing_method": "enhanced_multi_file",
            "total_records": int(len(standardized_df)),
            "files_uploaded": int(len([f for f in files if f.filename != ''])),
            "files_processed": int(processed_count),
            "records_before_cleaning": int(len(df)),
            "records_after_cleaning": int(len(cleaned_df)),
            "records_after_imputation": int(len(imputed_df)),
            "final_records": int(len(standardized_df)),
            "duplicates_removed": int(duplicates_removed),
            "batches_processed": int(standardized_df['batch'].nunique()),
            "timepoints_found": list(standardized_df['timepoint'].unique()),
            "file_type_breakdown": file_type_stats,
            "imputation_strategy": imputation_strategy,
            "images_analyzed": int(standardized_df['has_image_data'].sum() if 'has_image_data' in standardized_df.columns else 0),
            "csv_download_url": f"http://localhost:5001/api/download/{csv_filename}",
            "csv_filename": csv_filename,
            "supported_formats": SUPPORTED_EXTENSIONS,
            "processing_features": [
                "Multi-file batch processing",
                "Flexible file type support", 
                "Smart missing data imputation",
                "Automatic data cleaning",
                "Timepoint standardization",
                "Duplicate removal",
                "Enhanced error handling"
            ]
        }
        
        # Include processing warnings if any
        if processing_errors:
            response_data["processing_warnings"] = processing_errors
            response_data["warning_count"] = len(processing_errors)
        
        # Convert numpy types for JSON serialization
        def convert_numpy_types(obj):
            if isinstance(obj, (np.integer, np.int64)):
                return int(obj)
            elif isinstance(obj, (np.floating, np.float64)):
                return float(obj)
            elif isinstance(obj, np.ndarray):
                return obj.tolist()
            return obj
        
        for key, value in response_data.items():
            response_data[key] = convert_numpy_types(value)
            
        return jsonify(response_data)
        
    except Exception as e:
        app.logger.error(f"Error in enhanced processing: {e}")
        return jsonify({
            "status": "error", 
            "error": f"Processing failed: {str(e)}"
        }), 500

@app.route('/api/download/<filename>')
def download_file(filename):
    """Enhanced file download with proper headers."""
    try:
        file_path = EXPORT_FOLDER / filename
        if not file_path.exists():
            file_path = UPLOAD_FOLDER / filename
            
        if file_path.exists():
            response = send_file(
                file_path, 
                as_attachment=True,
                download_name=filename,
                mimetype='application/octet-stream'
            )
            response.headers['Access-Control-Allow-Origin'] = '*'
            response.headers['Access-Control-Expose-Headers'] = 'Content-Disposition'
            return response
        else:
            return jsonify({"error": "File not found"}), 404
    except Exception as e:
        app.logger.error(f"Error serving file {filename}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/health')
def health_check():
    """Enhanced health check with system information."""
    return jsonify({
        "status": "healthy", 
        "message": "Enhanced DEXA API is running",
        "version": "2.0-enhanced",
        "features": {
            "multi_file_processing": True,
            "flexible_file_types": True,
            "smart_imputation": True,
            "pdf_support": PDF_SUPPORT,
            "excel_support": EXCEL_SUPPORT
        },
        "supported_formats": SUPPORTED_EXTENSIONS,
        "max_files_per_batch": MAX_FILES_PER_BATCH,
        "max_file_size_mb": MAX_FILE_SIZE_MB,
        "timestamp": datetime.now().isoformat()
    })

@app.route('/')
def index():
    """Enhanced API information page."""
    return f"""
    <h1>Enhanced DEXA Data Processing API</h1>
    <p><strong>Advanced multi-file processing with intelligent data cleaning and smart imputation</strong></p>
    
    <h3>Enhanced Features:</h3>
    <ul>
        <li><strong>Multi-File Processing</strong>: Upload and process up to {MAX_FILES_PER_BATCH} files simultaneously</li>
        <li><strong>Flexible File Types</strong>: Support for {', '.join(SUPPORTED_EXTENSIONS)}</li>
        <li><strong>Smart Data Cleaning</strong>: Automatic removal of test data, outliers, and invalid measurements</li>
        <li><strong>Advanced Imputation</strong>: Multiple strategies for handling missing data</li>
        <li><strong>Unified Format</strong>: Standardized timepoint and batch naming across all sources</li>
        <li><strong>Enhanced Error Handling</strong>: Detailed error messages and processing warnings</li>
    </ul>
    
    <h3>API Endpoints:</h3>
    <ul>
        <li><strong>POST /api/process-dexa</strong> - Enhanced multi-file DEXA processing</li>
        <li><strong>GET /api/download/&lt;filename&gt;</strong> - Download processed files</li>
        <li><strong>GET /api/health</strong> - Enhanced health check with system info</li>
    </ul>
    
    <h3>Processing Options:</h3>
    <p>Include <code>imputation_strategy</code> parameter in your request:</p>
    <ul>
        <li><code>group_median</code> - Use median values by batch/gender (default)</li>
        <li><code>forward_fill</code> - Use previous timepoint values</li>
        <li><code>zero</code> - Fill with zeros</li>
        <li><code>leave_nan</code> - Keep missing values as NaN</li>
        <li><code>smart</code> - Adaptive strategy based on data characteristics</li>
    </ul>
    
    <h3>Output Format:</h3>
    <p>Unified CSV with standardized columns and comprehensive metadata</p>
    
    <p><em>Enhanced DEXA Processor v2.0 - Built for production-scale data processing</em></p>
    """

if __name__ == '__main__':
    # Enhanced startup with system info
    print("Enhanced DEXA Processing API starting...")
    print(f"Supported formats: {', '.join(SUPPORTED_EXTENSIONS)}")
    print(f"Max files per batch: {MAX_FILES_PER_BATCH}")
    print(f"Max file size: {MAX_FILE_SIZE_MB}MB")
    print(f"PDF support: {'Available' if PDF_SUPPORT else 'Not Available'}")
    print(f"Excel support: {'Available' if EXCEL_SUPPORT else 'Not Available'}")
    print("Features: Multi-file processing, Smart imputation, Enhanced cleaning")
    print("Access at: http://localhost:5001")
    
    # Cleanup old files
    for file in UPLOAD_FOLDER.glob("*"):
        try:
            if file.is_file() and (datetime.now() - datetime.fromtimestamp(file.stat().st_mtime)).days > 1:
                file.unlink()
        except Exception as e:
            app.logger.warning(f"Could not clean up file {file}: {e}")
    
    app.run(debug=True, host='0.0.0.0', port=5001)
