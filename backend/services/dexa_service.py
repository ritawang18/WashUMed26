import uuid
import logging
import pandas as pd

from config import MAX_FILES_PER_BATCH, MAX_FILE_SIZE_MB, SUPPORTED_EXTENSIONS, EXPORTS_FOLDER
from db.supabase_client import supabase_client
from services.dexa_parser import parse_dexa_file, standardize_timepoints
from services.dexa_cleaner import clean_dexa_data_enhanced, smart_impute_missing_data_enhanced
from services.grouping_service import upsert_subject_groupings_for_user
from utils.auth import normalize_subject_id
from utils.serialization import clean_numeric_nan, clean_response_dict

logger = logging.getLogger(__name__)

DEXA_RECORD_COLS = {
    'user_id', 'session_id', 'batch', 'subject_id', 'timepoint', 'filename',
    'has_image_data', 'gender', 'genotype', 'age', 'image_path',
    'total_weight', 'soft_weight', 'lean_weight', 'fat_weight',
    'fat_percent', 'bmc', 'bmd', 'bone_area', 'sample_area',
    'roi_bmd', 'whole_bmd', 'roi_bone_area', 'whole_bone_area',
    'roi_bmc', 'whole_bmc', 'roi_fat_percent', 'whole_fat_percent',
    'roi_total_weight', 'whole_total_weight', 'roi_lean_weight',
    'whole_lean_weight', 'roi_fat_weight', 'whole_fat_weight',
    'roi_soft_weight', 'whole_soft_weight',
}


def process_and_save_dexa_files(user_id, files, imputation_strategy='group_median'):
    files = [f for f in files if f and f.filename]
    if not files:
        raise ValueError('No files uploaded')
    if len(files) > MAX_FILES_PER_BATCH:
        files = files[:MAX_FILES_PER_BATCH]
        logger.warning('File limit exceeded. Processing only first %s files.', MAX_FILES_PER_BATCH)

    all_data = []
    processing_errors = []
    processed_count = 0
    file_type_stats = {}

    print(f'Starting enhanced batch processing of {len(files)} DEXA files...')
    for idx, file in enumerate(files):
        try:
            print(f'Processing {idx + 1}/{len(files)}: {file.filename}')
            file_content = file.read()
            file_size_mb = len(file_content) / (1024 * 1024)
            if file_size_mb > MAX_FILE_SIZE_MB:
                processing_errors.append(f'{file.filename}: File too large ({file_size_mb:.1f}MB, max: {MAX_FILE_SIZE_MB}MB)')
                continue
            parsed = parse_dexa_file(file_content, file.filename)
            processed_count += 1
            ext = file.filename.lower().split('.')[-1]
            file_type_stats[ext] = file_type_stats.get(ext, 0) + 1
            if isinstance(parsed, list):
                all_data.extend(parsed)
                print(f'    Extracted {len(parsed)} records')
            else:
                all_data.append(parsed)
                print('    Extracted 1 record')
        except Exception as e:
            msg = str(e)
            if 'xlrd' in msg.lower():
                msg = 'Excel format not supported. Please convert to .xlsx or .csv'
            elif 'unicode' in msg.lower():
                msg = 'File encoding not supported. Please save as UTF-8'
            processing_errors.append(f'{file.filename}: {msg}')
            logger.warning('Failed to process %s: %s', file.filename, e)

    if not all_data:
        msg = 'No valid files processed'
        if processing_errors:
            msg += f". Errors: {'; '.join(processing_errors[:3])}..."
        raise ValueError(msg)

    session_id = str(uuid.uuid4())
    if supabase_client is not None:
        try:
            supabase_client.table('upload_sessions').insert({
                'session_id': session_id,
                'user_id': user_id,
                'data_type': 'dexa',
                'status': 'processing',
                'files_uploaded': int(len(files)),
                'files_processed': int(processed_count),
                'processing_warnings': processing_errors,
            }).execute()
        except Exception as e:
            logger.warning('upload_sessions insert failed (non-critical): %s', e)

    df = pd.DataFrame(all_data)
    cleaned_df = clean_dexa_data_enhanced(df)
    base_fields = ['total_weight', 'soft_weight', 'lean_weight', 'fat_weight', 'fat_percent', 'bmc', 'bmd', 'bone_area', 'sample_area']
    measurement_fields = [
        col for col in cleaned_df.columns
        if any(col == f'{prefix}{base}' for prefix in ('roi_', 'whole_') for base in base_fields)
    ]
    imputed_df = smart_impute_missing_data_enhanced(cleaned_df, measurement_fields, strategy=imputation_strategy)
    standardized_df = standardize_timepoints(imputed_df)
    original_count = len(standardized_df)
    standardized_df = standardized_df.drop_duplicates()
    duplicates_removed = original_count - len(standardized_df)

    records_for_grouping = standardized_df.where(pd.notnull(standardized_df), None).to_dict(orient='records')
    if supabase_client is not None:
        upsert_subject_groupings_for_user(user_id, records_for_grouping)
        records = []
        for r in records_for_grouping:
            r['user_id'] = user_id
            r['session_id'] = session_id
            r['subject_id'] = normalize_subject_id(r.get('subject_id'))
            records.append(clean_numeric_nan({k: v for k, v in r.items() if k in DEXA_RECORD_COLS}))
        for i in range(0, len(records), 100):
            supabase_client.table('dexa_records').insert(records[i:i + 100]).execute()
        try:
            supabase_client.table('upload_sessions').update({
                'status': 'success',
                'data_type': 'dexa',
                'files_processed': int(processed_count),
                'total_records': int(len(standardized_df)),
                'duplicates_removed': int(duplicates_removed),
                'imputation_strategy': imputation_strategy,
                'batches_processed': list(standardized_df['batch'].dropna().unique()) if 'batch' in standardized_df.columns else [],
                'timepoints_found': list(standardized_df['timepoint'].dropna().unique()) if 'timepoint' in standardized_df.columns else [],
                'processing_warnings': processing_errors,
            }).eq('session_id', session_id).eq('user_id', user_id).execute()
        except Exception as e:
            logger.warning('upload_sessions final update failed: %s', e)

    output_records = standardized_df.where(standardized_df.notna(), other=None).to_dict(orient='records')
    response_data = {
        'status': 'success',
        'processing_method': 'enhanced_multi_file',
        'upload_mode': 'dexa',
        'total_records': int(len(output_records)),
        'files_uploaded': int(len(files)),
        'files_processed': int(processed_count),
        'records_before_cleaning': int(len(cleaned_df)),
        'records_after_cleaning': int(len(cleaned_df)),
        'records_after_imputation': int(len(imputed_df)),
        'final_records': int(len(output_records)),
        'duplicates_removed': int(duplicates_removed),
        'batches_processed': int(standardized_df['batch'].nunique()) if 'batch' in standardized_df.columns else 0,
        'timepoints_found': list(standardized_df['timepoint'].unique()) if 'timepoint' in standardized_df.columns else [],
        'file_type_breakdown': file_type_stats,
        'imputation_strategy': imputation_strategy,
        'images_analyzed': int(standardized_df['has_image_data'].sum() if 'has_image_data' in standardized_df.columns else 0),
        'session_id': session_id,
        'supported_formats': SUPPORTED_EXTENSIONS,
        'records': output_records,
    }
    if processing_errors:
        response_data['processing_warnings'] = processing_errors
        response_data['warning_count'] = len(processing_errors)

    try:
        csv_filename = f'DEXA_{session_id[:8]}.csv'
        pd.DataFrame(output_records).to_csv(EXPORTS_FOLDER / csv_filename, index=False)
        response_data['csv_filename'] = csv_filename
        response_data['csv_download_url'] = f'/api/download/{csv_filename}'
    except Exception as e:
        logger.warning('Could not save CSV export: %s', e)

    return clean_response_dict(response_data)


def get_dexa_records(user_id):
    if supabase_client is None:
        raise RuntimeError('Supabase not connected')
    return supabase_client.table('dexa_records').select('*').eq('user_id', user_id).execute().data or []


def update_dexa_record(user_id, record_id, data):
    if supabase_client is None:
        raise RuntimeError('Supabase not connected')
    data = {k: v for k, v in data.items() if k not in ('id', 'user_id', 'session_id')}
    if not data:
        raise ValueError('No editable fields provided')
    result = supabase_client.table('dexa_records').update(data).eq('id', record_id).eq('user_id', user_id).execute()
    return result.data[0] if result.data else {}
