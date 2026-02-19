"""
DEXA Data Processing API

This Flask API processes uploaded DEXA scan files and standardizes them
using the unified format logic from our batch processing notebooks.

Features:
- File upload and processing
- Timepoint standardization across batches
- Duplicate removal
- CSV and Excel export with summary sheets
- Temporary file cleanup

TODO:
- Add file validation and error handling
- Implement batch detection from filenames
- Add image metadata integration
- Optimize for larger file uploads
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

app = Flask(__name__)

# Add CORS headers manually
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

# Configure folders for file storage
UPLOAD_FOLDER = Path("temp_uploads")
UPLOAD_FOLDER.mkdir(exist_ok=True)

# Create permanent export folder for downloads
EXPORT_FOLDER = Path("../frontend/exports")
EXPORT_FOLDER.mkdir(exist_ok=True)

# Copy exact functions from the unified format notebook
def standardize_timepoints(df):
    """
    Standardize timepoint names across all batches for consistency.
    
    Args:
        df (DataFrame): Input DataFrame with timepoint column
        
    Returns:
        DataFrame: DataFrame with standardized timepoint columns
        
    Note:
        Maps batch-specific timepoint names to unified naming convention:
        - Week_0/Pre_Scan -> Baseline
        - Week_1, Week_2, Week_3 remain unchanged
        - Post_Scan remains unchanged
        - Root -> Unknown
    """
    df_standardized = df.copy()
    
    # Mapping dictionary for timepoint standardization
    timepoint_mapping = {
        'Week_0': 'Baseline',      # Batch 1 baseline
        'Pre_Scan': 'Baseline',    # Batches 2-5 baseline
        'Week_1': 'Week_1',
        'Week_2': 'Week_2',
        'Week_3': 'Week_3',
        'Post_Scan': 'Post_Scan',
        'Root': 'Unknown'          # Edge case handling
    }
    
    # Apply mapping to create standardized timepoint column
    df_standardized['timepoint_standardized'] = df_standardized['timepoint'].map(timepoint_mapping)
    df_standardized['timepoint_original'] = df_standardized['timepoint']
    
    # Handle any unmapped timepoints by keeping original value
    unmapped = df_standardized['timepoint_standardized'].isnull()
    if unmapped.any():
        df_standardized.loc[unmapped, 'timepoint_standardized'] = df_standardized.loc[unmapped, 'timepoint_original']
    
    return df_standardized

def parse_dexa_file(file_content, filename):
    """
    Parse DEXA files in multiple formats (.txt, .csv, .xlsx) into standardized format.
    
    Args:
        file_content (bytes): Raw file content from uploaded file
        filename (str): Original filename for format detection and subject ID extraction
        
    Returns:
        dict or list: Standardized row(s) with DEXA measurements
        
    Supports:
        - .txt files with "key: value" format
        - .csv files with headers
        - .xlsx Excel files
    """
    file_extension = filename.lower().split('.')[-1]
    subject_id = filename.split('.')[0]
    
    # DETECT BATCH, TIMEPOINT, AND GENDER FROM FILENAME FIRST (before processing)
    batch = 'Uploaded_Batch'
    timepoint = 'Pre_Scan'
    gender = 'Unknown'
    
    filename_lower = filename.lower()
    
    # Detect batch from filename - handle formats like "B1_F_0"
    if 'batch1' in filename_lower or 'b1_' in filename_lower or filename_lower.startswith('b1'):
        batch = 'Batch_1'
    elif 'batch2' in filename_lower or 'b2_' in filename_lower or filename_lower.startswith('b2'):
        batch = 'Batch_2'
    elif 'batch3' in filename_lower or 'b3_' in filename_lower or filename_lower.startswith('b3'):
        batch = 'Batch_3'
    elif 'batch4' in filename_lower or 'b4_' in filename_lower or filename_lower.startswith('b4'):
        batch = 'Batch_4'
    elif 'batch5' in filename_lower or 'b5_' in filename_lower or filename_lower.startswith('b5'):
        batch = 'Batch_5'
    
    # Detect timepoint from filename - handle formats like "B1_F_0 Week -1"
    if 'week_0' in filename_lower or 'week0' in filename_lower or '_0 week' in filename_lower:
        timepoint = 'Week_0'
    elif 'pre_scan' in filename_lower or 'prescan' in filename_lower:
        timepoint = 'Pre_Scan'
    elif 'week_1' in filename_lower or 'week1' in filename_lower or '_1 week' in filename_lower or 'week 1' in filename_lower:
        timepoint = 'Week_1'
    elif 'week_2' in filename_lower or 'week2' in filename_lower or '_2 week' in filename_lower or 'week 2' in filename_lower:
        timepoint = 'Week_2'
    elif 'week_3' in filename_lower or 'week3' in filename_lower or '_3 week' in filename_lower or 'week 3' in filename_lower:
        timepoint = 'Week_3'
    elif 'post_scan' in filename_lower or 'postscan' in filename_lower or 'post-scan' in filename_lower or 'post scan' in filename_lower:
        timepoint = 'Post_Scan'
    elif 'week -1' in filename_lower or 'week-1' in filename_lower:
        timepoint = 'Week_0'  # Treat "Week -1" as baseline
    
    # Detect gender from filename - handle formats like "B1_F_0" and "B1_M_2"
    if 'male' in filename_lower and 'female' not in filename_lower:
        gender = 'Male'
    elif 'female' in filename_lower:
        gender = 'Female'
    elif '_m_' in filename_lower or filename_lower.startswith('m_') or '_m' in filename_lower.split('_'):
        gender = 'Male'
    elif '_f_' in filename_lower or filename_lower.startswith('f_') or '_f' in filename_lower.split('_'):
        gender = 'Female'
    
    measurements = {}
    
    if file_extension == 'txt':
        # Handle .txt files with DEXA report format
        lines = file_content.decode('utf-8').strip().split('\n')
        
        # Parse DEXA tissue statistics format
        for line in lines:
            line = line.strip()
            
            # Look for key measurement patterns in your DEXA format
            if 'Sample Area:' in line:
                value = line.split('Sample Area:')[1].strip().split()[0]
                measurements['sample_area'] = float(value)
            elif 'Bone Area:' in line:
                value = line.split('Bone Area:')[1].strip().split()[0]
                measurements['bone_area'] = float(value)
            elif 'Total Weight:' in line:
                value = line.split('Total Weight:')[1].strip().split()[0]
                measurements['total_weight'] = float(value)
            elif 'Soft Weight:' in line:
                value = line.split('Soft Weight:')[1].strip().split()[0]
                measurements['soft_weight'] = float(value)
            elif 'Lean Weight:' in line:
                value = line.split('Lean Weight:')[1].strip().split()[0]
                measurements['lean_weight'] = float(value)
            elif 'Fat Weight:' in line:
                value = line.split('Fat Weight:')[1].strip().split()[0]
                measurements['fat_weight'] = float(value)
            elif 'Fat Percent:' in line:
                value = line.split('Fat Percent:')[1].strip().split()[0]
                measurements['fat_percent'] = float(value)
            elif 'BMC:' in line:
                value = line.split('BMC:')[1].strip().split()[0]
                measurements['bmc'] = float(value)
            elif 'BMD:' in line:
                value = line.split('BMD:')[1].strip().split()[0]
                measurements['bmd'] = float(value)
            
            # Fallback: try general "key: value" format for other data
            elif ':' in line and not line.startswith('-') and not 'STATISTICS' in line:
                try:
                    key, value = line.split(':', 1)
                    key = key.strip().lower().replace(' ', '_')
                    value_clean = value.strip().split()[0]  # Take first word (number)
                    measurements[key] = float(value_clean)
                except (ValueError, IndexError):
                    pass
    
    elif file_extension == 'csv':
        # Handle CSV files - process ALL rows, not just first
        csv_content = file_content.decode('utf-8')
        df = pd.read_csv(io.StringIO(csv_content))
        
        # AUTO-CLEAN CSV: Remove empty rows and invalid data
        df = df.dropna(how='all')  # Remove completely empty rows
        df = df.reset_index(drop=True)
        
        # Process all rows from CSV (return list of records)
        csv_rows = []
        for idx, row in df.iterrows():
            row_measurements = {}
            for col in df.columns:
                col_clean = col.strip().lower().replace(' ', '_')
                try:
                    row_measurements[col_clean] = float(row[col]) if pd.notna(row[col]) else 0
                except (ValueError, TypeError):
                    row_measurements[col_clean] = str(row[col]) if pd.notna(row[col]) else ''
            
            # Create individual row for each CSV record
            csv_row = {
                'batch': batch,
                'subject_id': f"{subject_id}_row_{idx+1}",
                'timepoint': timepoint,
                'gender': gender,
                'filename': filename,
                **row_measurements,
                'has_image_data': False
            }
            csv_rows.append(csv_row)
        
        return csv_rows  # Return multiple rows for CSV
    
    elif file_extension in ['xlsx', 'xls']:
        # Handle Excel files - process ALL rows from ALL sheets
        excel_rows = []
        
        try:
            # Read all sheets from Excel file
            excel_file = pd.ExcelFile(io.BytesIO(file_content))
            
            for sheet_name in excel_file.sheet_names:
                df = pd.read_excel(io.BytesIO(file_content), sheet_name=sheet_name)
                
                # AUTO-CLEAN Excel: Remove empty rows
                df = df.dropna(how='all')
                df = df.reset_index(drop=True)
                
                for idx, row in df.iterrows():
                    row_measurements = {}
                    for col in df.columns:
                        col_clean = col.strip().lower().replace(' ', '_')
                        try:
                            row_measurements[col_clean] = float(row[col]) if pd.notna(row[col]) else 0
                        except (ValueError, TypeError):
                            row_measurements[col_clean] = str(row[col]) if pd.notna(row[col]) else ''
                    
                    # Create individual row for each Excel record
                    excel_row = {
                        'batch': batch,
                        'subject_id': f"{subject_id}_{sheet_name}_row_{idx+1}",
                        'timepoint': timepoint,
                        'gender': gender,
                        'filename': f"{filename}[{sheet_name}]",
                        **row_measurements,
                        'has_image_data': False
                    }
                    excel_rows.append(excel_row)
            
            return excel_rows  # Return multiple rows for Excel
            
        except Exception as e:
            # Fallback to single sheet processing
            df = pd.read_excel(io.BytesIO(file_content))
            df = df.dropna(how='all')
            
            for col in df.columns:
                col_clean = col.strip().lower().replace(' ', '_')
                if len(df) > 0:
                    try:
                        measurements[col_clean] = float(df[col].iloc[0])
                    except (ValueError, TypeError):
                        measurements[col_clean] = str(df[col].iloc[0])
    
    elif file_extension in ['tif', 'tiff', 'png', 'jpeg', 'jpg', 'img', 'pxl', 'bmp']:
        # Handle image files - extract metadata only (don't store actual images)
        try:
            image = Image.open(io.BytesIO(file_content))
            
            measurements = {
                'image_width': image.width,
                'image_height': image.height,
                'image_format': image.format or file_extension.upper(),
                'image_mode': image.mode,
                'image_size_mb': len(file_content) / (1024 * 1024),
                'has_image_data': True,
                'image_filename': filename,
                # DEXA scan analysis from metadata only
                'scan_quality': 'Good' if image.width > 500 and image.height > 500 else 'Low',
                'pixel_density': image.width * image.height,
                'aspect_ratio': round(image.width / image.height, 2) if image.height > 0 else 0
            }
            
            # Extract any embedded EXIF data for scan parameters
            if hasattr(image, '_getexif') and image._getexif():
                exif_data = image._getexif()
                measurements['has_scan_metadata'] = True
                # Add common EXIF data if available
                try:
                    measurements['image_date'] = exif_data.get(36867, 'Unknown')  # DateTimeOriginal
                    measurements['camera_model'] = exif_data.get(272, 'Unknown')  # Model
                except:
                    pass
            else:
                measurements['has_scan_metadata'] = False
                
        except Exception as e:
            raise ValueError(f"Could not process image file {filename}: {str(e)}")
    
    else:
        # Try to decode as text and parse as key-value pairs
        try:
            lines = file_content.decode('utf-8').strip().split('\n')
            for line in lines:
                if ':' in line:
                    key, value = line.split(':', 1)
                    key = key.strip().lower().replace(' ', '_')
                    try:
                        measurements[key] = float(value.strip())
                    except ValueError:
                        measurements[key] = value.strip()
        except UnicodeDecodeError:
            raise ValueError(f"Unsupported file format: {file_extension}")
    
    # Create standardized row matching our unified format
    row = {
        'batch': batch,
        'subject_id': subject_id,
        'timepoint': timepoint,
        'gender': gender,
        'filename': filename,
        # DEXA measurement fields
        'total_weight': measurements.get('total_weight', 0),
        'soft_weight': measurements.get('soft_weight', 0),
        'lean_weight': measurements.get('lean_weight', 0),
        'fat_weight': measurements.get('fat_weight', 0),
        'fat_percent': measurements.get('fat_percent', 0),
        'bmc': measurements.get('bmc', 0),           # Bone Mineral Content
        'bmd': measurements.get('bmd', 0),           # Bone Mineral Density
        'bone_area': measurements.get('bone_area', 0),
        'sample_area': measurements.get('sample_area', 0),
        # Image metadata fields (if image file)
        'image_width': measurements.get('image_width', None),
        'image_height': measurements.get('image_height', None),
        'image_format': measurements.get('image_format', None),
        'scan_quality': measurements.get('scan_quality', None),
        'aspect_ratio': measurements.get('aspect_ratio', None),
        'has_image_data': measurements.get('has_image_data', False)
    }
    
    return row

def clean_dexa_data(df):
    """
    Comprehensive data cleaning for DEXA datasets.
    
    Auto-cleans:
    - TEST runs and calibration data (as mentioned by Shaza)
    - Missing/null values in critical fields
    - Invalid measurements (negative weights, impossible percentages)
    - Outliers in body composition data
    - Inconsistent subject IDs and batch naming
    
    Args:
        df (DataFrame): Raw DEXA data
        
    Returns:
        DataFrame: Cleaned DEXA data with validation summary
    """
    cleaned_df = df.copy()
    original_count = len(cleaned_df)
    
    # 1. REMOVE TEST DATA - As Shaza mentioned, exclude TEST runs from machine calibration
    test_patterns = ['test', 'TEST', 'Test', 'calibration', 'CALIBRATION', 'blank', 'BLANK', 'standard', 'STANDARD']
    
    # Check multiple columns for test patterns
    test_columns = ['subject_id', 'filename']
    for col in test_columns:
        if col in cleaned_df.columns:
            for pattern in test_patterns:
                mask = cleaned_df[col].astype(str).str.contains(pattern, case=False, na=False)
                test_rows_removed = mask.sum()
                if test_rows_removed > 0:
                    print(f"Removing {test_rows_removed} TEST/calibration rows from {col} column")
                    cleaned_df = cleaned_df[~mask]
    
    # 2. Remove rows with missing critical data
    critical_fields = ['subject_id', 'batch', 'timepoint']
    cleaned_df = cleaned_df.dropna(subset=critical_fields, how='any')
    
    # 3. Clean measurement data - remove invalid values
    measurement_fields = ['total_weight', 'soft_weight', 'lean_weight', 'fat_weight', 
                         'fat_percent', 'bmc', 'bmd', 'bone_area', 'sample_area']
    
    for field in measurement_fields:
        if field in cleaned_df.columns:
            # Remove negative values (impossible for body composition)
            cleaned_df = cleaned_df[cleaned_df[field] >= 0]
            
            # Remove extreme outliers (beyond 3 standard deviations)
            if cleaned_df[field].std() > 0:  # Avoid division by zero
                z_scores = np.abs((cleaned_df[field] - cleaned_df[field].mean()) / cleaned_df[field].std())
                cleaned_df = cleaned_df[z_scores <= 3]
    
    # 3. Validate fat percentage (should be 0-100%)
    if 'fat_percent' in cleaned_df.columns:
        cleaned_df = cleaned_df[(cleaned_df['fat_percent'] >= 0) & (cleaned_df['fat_percent'] <= 100)]
    
    # 4. Clean subject IDs - standardize format
    if 'subject_id' in cleaned_df.columns:
        cleaned_df['subject_id'] = cleaned_df['subject_id'].astype(str).str.strip()
        # Remove empty subject IDs
        cleaned_df = cleaned_df[cleaned_df['subject_id'] != '']
        cleaned_df = cleaned_df[cleaned_df['subject_id'] != 'nan']
    
    # 5. Standardize batch names
    if 'batch' in cleaned_df.columns:
        cleaned_df['batch'] = cleaned_df['batch'].astype(str).str.strip()
        # Ensure batch format consistency
        batch_mapping = {
            'batch1': 'Batch_1', 'batch_1': 'Batch_1', 'b1': 'Batch_1',
            'batch2': 'Batch_2', 'batch_2': 'Batch_2', 'b2': 'Batch_2',
            'batch3': 'Batch_3', 'batch_3': 'Batch_3', 'b3': 'Batch_3',
            'batch4': 'Batch_4', 'batch_4': 'Batch_4', 'b4': 'Batch_4',
            'batch5': 'Batch_5', 'batch_5': 'Batch_5', 'b5': 'Batch_5'
        }
        cleaned_df['batch'] = cleaned_df['batch'].str.lower().map(batch_mapping).fillna(cleaned_df['batch'])
    
    # 6. SMART IMPUTATION - Handle missing values intelligently
    # Get imputation strategy from global setting (could be made configurable via API)
    imputation_strategy = globals().get('IMPUTATION_STRATEGY', 'group_median')
    cleaned_df = smart_impute_missing_data(cleaned_df, measurement_fields, strategy=imputation_strategy)
    
    print(f"Data cleaning complete: {original_count} → {len(cleaned_df)} records ({original_count - len(cleaned_df)} removed)")
    
    return cleaned_df

def create_dexa_summary(df):
    """
    Create comprehensive DEXA statistics summary with timepoint analysis.
    
    Args:
        df (DataFrame): Cleaned DEXA data
        
    Returns:
        DataFrame: Summary statistics by batch and timepoint
    """
    # Define measurement columns for analysis
    measurement_cols = ['total_weight', 'soft_weight', 'lean_weight', 'fat_weight', 
                       'fat_percent', 'bmc', 'bmd', 'bone_area', 'sample_area']
    
    # Filter to existing numeric columns
    existing_cols = [col for col in measurement_cols if col in df.columns and df[col].dtype in ['float64', 'int64']]
    
    if not existing_cols:
        return pd.DataFrame({'Message': ['No numeric measurements found for analysis']})
    
    # Create aggregation dictionary
    agg_dict = {}
    for col in existing_cols:
        agg_dict[f'{col}_mean'] = (col, 'mean')
        agg_dict[f'{col}_std'] = (col, 'std')
        agg_dict[f'{col}_count'] = (col, 'count')
    
    agg_dict['subjects_count'] = ('subject_id', 'nunique')
    agg_dict['files_count'] = ('filename', 'count')
    
    # Group by batch and timepoint for comprehensive analysis
    summary = df.groupby(['batch', 'timepoint_standardized']).agg(**agg_dict).round(3)
    
    # Reset index for better Excel formatting
    summary = summary.reset_index()
    
    return summary

def create_image_summary(image_df):
    """
    Create summary statistics for DEXA image files.
    
    Args:
        image_df (DataFrame): DataFrame containing image metadata
        
    Returns:
        DataFrame: Image analysis summary
    """
    image_stats = []
    
    # Group by batch and timepoint
    for (batch, timepoint), group in image_df.groupby(['batch', 'timepoint_standardized']):
        stats = {
            'Batch': batch,
            'Timepoint': timepoint,
            'Image_Count': len(group),
            'Avg_Width': group['image_width'].mean() if 'image_width' in group.columns else 0,
            'Avg_Height': group['image_height'].mean() if 'image_height' in group.columns else 0,
            'Total_Size_MB': group['image_size_mb'].sum() if 'image_size_mb' in group.columns else 0,
            'Formats': ', '.join(group['image_format'].unique()) if 'image_format' in group.columns else 'Unknown',
            'High_Quality_Scans': len(group[group['scan_quality'] == 'Good']) if 'scan_quality' in group.columns else 0,
            'With_Metadata': len(group[group['has_scan_metadata'] == True]) if 'has_scan_metadata' in group.columns else 0
        }
        image_stats.append(stats)
    
    return pd.DataFrame(image_stats)

def smart_impute_missing_data(df, measurement_fields, strategy='group_median'):
    """
    Intelligent imputation of missing DEXA measurement data.
    
    Args:
        df (DataFrame): Cleaned DEXA data with potential missing values
        measurement_fields (list): List of measurement columns to impute
        strategy (str): Imputation strategy to use
        
    Available strategies:
        - 'leave_nan': Keep missing values as NaN (best for analysis)
        - 'zero': Fill with 0 (simple but unrealistic)
        - 'group_median': Fill with median by batch/gender (realistic)
        - 'forward_fill': Use previous timepoint value (longitudinal)
        - 'smart': Adaptive strategy based on data type
        
    Returns:
        DataFrame: Data with imputed values and imputation metadata
    """
    imputed_df = df.copy()
    imputation_summary = {}
    
    print(f"🧹 MISSING DATA IMPUTATION - Strategy: {strategy}")
    
    for field in measurement_fields:
        if field not in imputed_df.columns:
            continue
            
        # Convert to numeric, marking non-numeric as NaN
        imputed_df[field] = pd.to_numeric(imputed_df[field], errors='coerce')
        
        missing_count = imputed_df[field].isnull().sum()
        total_count = len(imputed_df)
        missing_percent = (missing_count / total_count) * 100
        
        if missing_count > 0:
            print(f"{field}: {missing_count}/{total_count} missing ({missing_percent:.1f}%)")
            
            if strategy == 'leave_nan':
                # Keep NaN values - best for statistical analysis
                print(f" Keeping {missing_count} NaN values for analysis")
                
            elif strategy == 'zero':
                # Simple zero fill (current approach)
                imputed_df[field] = imputed_df[field].fillna(0)
                print(f" Filled {missing_count} values with 0")
                
            elif strategy == 'group_median':
                # Fill with median by batch and gender (most realistic)
                if 'batch' in imputed_df.columns and 'gender' in imputed_df.columns:
                    # Group by batch and gender, use median
                    group_medians = imputed_df.groupby(['batch', 'gender'])[field].median()
                    
                    for (batch, gender), median_val in group_medians.items():
                        if pd.notna(median_val):
                            mask = (imputed_df['batch'] == batch) & \
                                   (imputed_df['gender'] == gender) & \
                                   (imputed_df[field].isnull())
                            imputed_df.loc[mask, field] = median_val
                    
                    # Fill any remaining NaN with overall median
                    overall_median = imputed_df[field].median()
                    if pd.notna(overall_median):
                        imputed_df[field] = imputed_df[field].fillna(overall_median)
                    
                    remaining_nan = imputed_df[field].isnull().sum()
                    filled_count = missing_count - remaining_nan
                    print(f" Filled {filled_count} values with group medians")
                    
                else:
                    # Fallback to overall median
                    median_val = imputed_df[field].median()
                    if pd.notna(median_val):
                        imputed_df[field] = imputed_df[field].fillna(median_val)
                        print(f" Filled {missing_count} values with overall median: {median_val:.2f}")
                
            elif strategy == 'forward_fill':
                # Use previous timepoint value (for longitudinal data)
                if 'subject_id' in imputed_df.columns and 'timepoint' in imputed_df.columns:
                    # Sort by subject and timepoint, then forward fill
                    imputed_df = imputed_df.sort_values(['subject_id', 'timepoint'])
                    imputed_df[field] = imputed_df.groupby('subject_id')[field].fillna(method='ffill')
                    
                    # Backward fill if still missing
                    imputed_df[field] = imputed_df.groupby('subject_id')[field].fillna(method='bfill')
                    
                    remaining_nan = imputed_df[field].isnull().sum()
                    filled_count = missing_count - remaining_nan
                    print(f"Filled {filled_count} values with longitudinal data")
                    
            elif strategy == 'smart':
                # Adaptive strategy based on field type and data availability
                if missing_percent > 50:
                    # Too much missing data - keep as NaN
                    print(f" Too much missing data ({missing_percent:.1f}%) - keeping as NaN")
                elif field in ['total_weight', 'soft_weight', 'lean_weight']:
                    # Weight fields - use group median
                    if 'batch' in imputed_df.columns and 'gender' in imputed_df.columns:
                        group_medians = imputed_df.groupby(['batch', 'gender'])[field].median()
                        for (batch, gender), median_val in group_medians.items():
                            if pd.notna(median_val):
                                mask = (imputed_df['batch'] == batch) & \
                                       (imputed_df['gender'] == gender) & \
                                       (imputed_df[field].isnull())
                                imputed_df.loc[mask, field] = median_val
                    print(f"    🎯 Smart fill for {field}: group-based imputation")
                else:
                    # Other fields - keep as NaN for analysis
                    print(f"    🎯 Smart fill for {field}: keeping as NaN")
            
            # Track imputation metadata
            final_missing = imputed_df[field].isnull().sum()
            imputation_summary[field] = {
                'original_missing': missing_count,
                'final_missing': final_missing,
                'imputed_count': missing_count - final_missing,
                'strategy_used': strategy
            }
    
    # Add imputation summary as metadata
    if imputation_summary:
        print(f" Imputation Summary: {len(imputation_summary)} fields processed")
        
    return imputed_df

# Removed ZIP package creation - keeping it simple with clean CSV output only

@app.route('/api/process-dexa', methods=['POST'])
def process_dexa_files():
    """
    Process uploaded DEXA files using unified format logic.
    
    Accepts multipart/form-data with 'files' containing DEXA scan files.
    Returns JSON response with processing results and download URLs.
    
    Returns:
        JSON: Success response with file URLs or error message
        
    TODO:
        - Add file size limits and validation
        - Implement batch detection from filenames
        - Add progress tracking for multiple files
        - Enhance error handling and user feedback
    """
    try:
        # Get uploaded files from request
        files = request.files.getlist('files')
        
        if not files:
            return jsonify({
                "status": "error", 
                "error": "No files uploaded"
            }), 400
        
        # Limit number of files for performance
        MAX_FILES = 20
        if len(files) > MAX_FILES:
            files = files[:MAX_FILES]
            app.logger.warning(f"File limit exceeded. Processing only first {MAX_FILES} files.")
        
        # Process each uploaded file
        all_data = []
        processing_errors = []
        processed_count = 0
        
        for file in files:
            if file.filename == '':
                continue
            
            try:
                # Check file size (10MB limit per file)
                file_content = file.read()
                if len(file_content) > 10 * 1024 * 1024:  # 10MB
                    processing_errors.append(f"{file.filename}: File too large (max 10MB)")
                    continue
                
                # Parse file content using our flexible DEXA parser
                parsed_row = parse_dexa_file(file_content, file.filename)
                processed_count += 1
                
                # Handle multiple rows from CSV/Excel files
                if isinstance(parsed_row, list):
                    all_data.extend(parsed_row)
                else:
                    all_data.append(parsed_row)
                    
            except Exception as e:
                processing_errors.append(f"{file.filename}: {str(e)}")
                app.logger.warning(f"Failed to process {file.filename}: {e}")
                continue
        
        if not all_data:
            error_msg = "No valid files processed"
            if processing_errors:
                error_msg += f". Errors: {'; '.join(processing_errors)}"
            return jsonify({
                "status": "error", 
                "error": error_msg
            }), 400
        
        # Create DataFrame from parsed data
        df = pd.DataFrame(all_data)
        
        # AUTO DATA CLEANING - Clean missing and invalid data
        # You can change imputation strategy here:
        # Options: 'leave_nan', 'zero', 'group_median', 'forward_fill', 'smart'
        IMPUTATION_STRATEGY = 'group_median'  # Most realistic for DEXA data
        cleaned_df = clean_dexa_data(df)
        
        # Apply timepoint standardization (same logic as notebook)
        standardized_df = standardize_timepoints(cleaned_df)
        
        # Remove duplicates using our established logic
        original_count = len(standardized_df)
        standardized_df = standardized_df.drop_duplicates()
        duplicates_removed = original_count - len(standardized_df)
        
        # Count cleaned records
        records_cleaned = len(df) - len(cleaned_df)
        
        # Generate simple, clean filename
        timestamp = datetime.now().strftime("%Y%m%d_%H%M")
        
        # Auto-increment to avoid duplicates
        counter = 1
        while True:
            csv_filename = f"DEXA_Cleaned_{timestamp}_{counter:02d}.csv"
            
            if not (EXPORT_FOLDER / csv_filename).exists():
                break
            counter += 1
        
        # Save only the clean CSV output - simple and focused
        csv_path = EXPORT_FOLDER / csv_filename
        standardized_df.to_csv(csv_path, index=False)

        # Build per-record list for Supabase insert
        record_cols = ['batch', 'subject_id', 'gender', 'filename',
                       'total_weight', 'soft_weight', 'lean_weight', 'fat_weight',
                       'fat_percent', 'bmc', 'bmd', 'bone_area', 'sample_area']
        records_df = standardized_df.rename(columns={'timepoint_standardized': 'timepoint'})
        available_cols = ['timepoint'] + [c for c in record_cols if c in records_df.columns]
        records_list = []
        for record in records_df[available_cols].to_dict('records'):
            clean = {}
            for k, v in record.items():
                if isinstance(v, (np.integer, np.int64)):
                    clean[k] = int(v)
                elif isinstance(v, (np.floating, np.float64)):
                    clean[k] = None if np.isnan(v) else float(v)
                else:
                    clean[k] = v
            records_list.append(clean)

        # Return success response - simple and clean
        response_data = {
            "status": "success",
            "total_records": int(len(standardized_df)),
            "files_uploaded": int(len([f for f in files if f.filename != ''])),
            "files_processed": int(processed_count),
            "records_cleaned": int(records_cleaned),
            "test_rows_removed": int(len(df) - len(cleaned_df) - records_cleaned) if records_cleaned < len(df) - len(cleaned_df) else 0,
            "batches_processed": list(standardized_df['batch'].unique()),
            "duplicates_removed": int(duplicates_removed),
            "images_analyzed": int(standardized_df['has_image_data'].sum() if 'has_image_data' in standardized_df.columns else 0),
            "timepoints_found": list(standardized_df['timepoint_standardized'].unique()),
            "imputation_strategy": IMPUTATION_STRATEGY,
            "csv_download_url": f"http://localhost:5001/api/download/{csv_filename}",
            "csv_filename": csv_filename,
            "records": records_list
        }
        
        # Include processing errors in response if any
        if processing_errors:
            response_data["processing_warnings"] = processing_errors
        
        # Convert any remaining numpy types to Python types for JSON serialization
        def convert_numpy_types(obj):
            if isinstance(obj, (np.integer, np.int64)):
                return int(obj)
            elif isinstance(obj, (np.floating, np.float64)):
                return float(obj)
            elif isinstance(obj, np.ndarray):
                return obj.tolist()
            return obj
        
        # Apply conversion to all values in response_data
        for key, value in response_data.items():
            response_data[key] = convert_numpy_types(value)
            
        return jsonify(response_data)
        
    except Exception as e:
        # Log error for debugging
        app.logger.error(f"Error processing files: {e}")
        return jsonify({
            "status": "error", 
            "error": str(e)
        }), 500

@app.route('/api/download/<filename>')
def download_file(filename):
    """
    Serve processed files for download with proper browser compatibility.
    
    Args:
        filename (str): Name of the file to download
        
    Returns:
        File: File attachment for download or error response
    """
    try:
        # Check both export folder and upload folder
        file_path = EXPORT_FOLDER / filename
        if not file_path.exists():
            file_path = UPLOAD_FOLDER / filename
            
        if file_path.exists():
            # Add proper headers for browser compatibility
            response = send_file(
                file_path, 
                as_attachment=True,
                download_name=filename,
                mimetype='application/octet-stream'
            )
            # Add CORS headers for the download
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
    """Simple health check endpoint for monitoring API status."""
    return jsonify({
        "status": "healthy", 
        "message": "DEXA API is running",
        "timestamp": datetime.now().isoformat()
    })

@app.route('/')
def index():
    """Basic API information page."""
    return """
    <h1>DEXA Data Processing API</h1>
    <p>Upload DEXA files to get standardized, unified datasets</p>
    <h3>Available Endpoints:</h3>
    <ul>
        <li><strong>POST /api/process-dexa</strong> - Upload and process DEXA files</li>
        <li><strong>GET /api/download/&lt;filename&gt;</strong> - Download processed files</li>
        <li><strong>GET /api/health</strong> - Health check</li>
    </ul>
    <h3>Input Format:</h3>
    <p>Accepts data files (.txt, .csv, .xlsx) and image files (.tif, .png, .jpeg, .img, .bmp)</p>
    <h3>Output Format:</h3>
    <p>Returns standardized CSV and Excel files with unified timepoint naming</p>
    """

if __name__ == '__main__':
    # Clean up old temporary files on startup (older than 1 day)
    for file in UPLOAD_FOLDER.glob("*"):
        try:
            if file.is_file() and (datetime.now() - datetime.fromtimestamp(file.stat().st_mtime)).days > 1:
                file.unlink()
        except Exception as e:
            app.logger.warning(f"Could not clean up file {file}: {e}")
    
    # Start Flask development server
    print("DEXA Processing API starting...")
    print("Using unified format logic from batch processing notebooks")
    print("Access at: http://localhost:5000")
    app.run(debug=True, host='0.0.0.0', port=5001)
