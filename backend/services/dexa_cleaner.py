import re
import pandas as pd


def clean_dexa_data_enhanced(df):
    cleaned_df = df.copy()
    original_count = len(cleaned_df)

    print('Starting data cleaning and standardization...')
    print(f'   Initial records: {original_count}')

    test_patterns = [
        'test', 'TEST', 'Test', 'calibration', 'CALIBRATION', 'blank', 'BLANK',
        'standard', 'STANDARD', 'control', 'CONTROL', 'phantom', 'PHANTOM',
        'demo', 'DEMO', 'sample', 'SAMPLE', 'unknown', 'UNKNOWN', 'null', 'NULL',
    ]
    for col in ['subject_id', 'filename']:
        if col in cleaned_df.columns:
            for pattern in test_patterns:
                mask = cleaned_df[col].astype(str).str.contains(pattern, case=False, na=False)
                removed = mask.sum()
                if removed > 0:
                    print(f'   Removing {removed} test/calibration rows from {col}')
                    cleaned_df = cleaned_df[~mask]

    print('   Standardizing column names...')
    column_mapping = {
        'subject': 'subject_id', 'mouse_id': 'subject_id', 'animal_id': 'subject_id',
        'batch_number': 'batch', 'batch_id': 'batch', 'group': 'batch',
        'time_point': 'timepoint', 'time': 'timepoint', 'week': 'timepoint',
        'sex': 'gender', 'gender_id': 'gender',
        'total_wt': 'total_weight', 'tot_weight': 'total_weight', 'body_weight': 'total_weight',
        'soft_wt': 'soft_weight', 'tissue_weight': 'soft_weight',
        'lean_wt': 'lean_weight', 'lean_mass': 'lean_weight',
        'fat_wt': 'fat_weight', 'fat_mass': 'fat_weight',
        'fat_pct': 'fat_percent', 'fat_%': 'fat_percent', 'body_fat_%': 'fat_percent',
        'bone_mineral_content': 'bmc', 'bmc_g': 'bmc',
        'bone_mineral_density': 'bmd', 'bmd_mg_cm2': 'bmd', 'bmd_mg/cm2': 'bmd',
        'bone_area_cm2': 'bone_area', 'b_area': 'bone_area', 'area_bone': 'bone_area',
        'sample_area_cm2': 'sample_area', 's_area': 'sample_area', 'area_sample': 'sample_area',
    }
    cleaned_df.columns = [column_mapping.get(col.lower().replace(' ', '_').replace('-', '_'), col) for col in cleaned_df.columns]
    if cleaned_df.columns.duplicated().any():
        print(f"   Found {cleaned_df.columns.duplicated().sum()} duplicate columns, removing duplicates...")
        cleaned_df = cleaned_df.loc[:, ~cleaned_df.columns.duplicated()]

    critical_fields = ['subject_id', 'batch', 'timepoint']
    before_validation = len(cleaned_df)
    cleaned_df = cleaned_df.dropna(subset=critical_fields, how='any')
    if before_validation - len(cleaned_df) > 0:
        print(f'   Removed {before_validation - len(cleaned_df)} records with missing critical fields')

    print('   Standardizing and validating measurements...')
    measurement_ranges = {
        'total_weight': (5.0, 200.0),
        'soft_weight': (5.0, 180.0),
        'lean_weight': (5.0, 150.0),
        'fat_weight': (0.1, 50.0),
        'fat_percent': (1.0, 60.0),
        'bmc': (0.01, 5.0),
        'bmd': (10.0, 300.0),
        'bone_area': (0.5, 25.0),
        'sample_area': (1.0, 50.0),
    }
    measurement_fields = [
        col for col in cleaned_df.columns
        if any(col == f'{prefix}{base}' for prefix in ('roi_', 'whole_') for base in measurement_ranges)
    ]

    for field in measurement_fields:
        base_field = field.split('_', 1)[1]
        cleaned_df[field] = pd.to_numeric(cleaned_df[field], errors='coerce')
        if base_field in measurement_ranges:
            min_val, max_val = measurement_ranges[base_field]
            before_range = len(cleaned_df)
            valid_mask = (cleaned_df[field] >= min_val) & (cleaned_df[field] <= max_val)
            cleaned_df = cleaned_df[valid_mask | cleaned_df[field].isna()]
            removed = before_range - len(cleaned_df)
            if removed > 0:
                print(f'   Removed {removed} records with {field} outside range [{min_val}-{max_val}]')
        if len(cleaned_df) > 10 and cleaned_df[field].notna().sum() > 5:
            field_data = cleaned_df[field].dropna()
            if len(field_data) > 0 and field_data.std() > 0:
                median = field_data.median()
                mad = (field_data - median).abs().median()
                if mad > 0:
                    outlier_mask = cleaned_df[field].apply(
                        lambda x: abs(0.6745 * (x - median) / mad) > 3.5 if pd.notna(x) and mad > 0 else False
                    )
                    outlier_count = outlier_mask.sum()
                    if outlier_count > 0 and outlier_count < len(cleaned_df) * 0.05:
                        cleaned_df = cleaned_df[~outlier_mask]
                        print(f'   Removed {outlier_count} statistical outliers in {field}')

    print('   Standardizing subject IDs...')
    if 'subject_id' in cleaned_df.columns:
        cleaned_df['subject_id'] = cleaned_df['subject_id'].astype(str).str.strip()
        invalid_ids = ['', 'nan', 'none', 'null', 'unknown', 'missing', 'test', 'sample']
        before = len(cleaned_df)
        cleaned_df = cleaned_df[~cleaned_df['subject_id'].str.lower().isin(invalid_ids)]
        if before - len(cleaned_df) > 0:
            print(f'   Removed {before - len(cleaned_df)} records with invalid subject IDs')

    print('   Standardizing batch naming...')
    if 'batch' in cleaned_df.columns:
        batch_mapping = {}
        for i in range(1, 11):
            batch_mapping.update({f'batch{i}': f'Batch_{i}', f'batch_{i}': f'Batch_{i}', f'b{i}': f'Batch_{i}', f'batch {i}': f'Batch_{i}'})
        cleaned_df['batch'] = cleaned_df['batch'].astype(str).str.lower().str.strip()
        cleaned_df['batch'] = cleaned_df['batch'].map(batch_mapping).fillna(cleaned_df['batch'])

        def standardize_batch(batch_str):
            if str(batch_str).startswith('batch_'):
                return batch_str
            number_match = re.search(r'(\d+)', str(batch_str))
            return f"Batch_{number_match.group(1)}" if number_match else batch_str

        mask = ~cleaned_df['batch'].str.startswith('Batch_')
        if mask.any():
            cleaned_df.loc[mask, 'batch'] = cleaned_df.loc[mask, 'batch'].apply(standardize_batch)

    print('   Standardizing gender values...')
    if 'gender' in cleaned_df.columns:
        gender_mapping = {
            'm': 'Male', 'male': 'Male', 'M': 'Male', 'MALE': 'Male', 'Male': 'Male',
            'f': 'Female', 'female': 'Female', 'F': 'Female', 'FEMALE': 'Female', 'Female': 'Female',
            '1': 'Male', '2': 'Female', 'boy': 'Male', 'girl': 'Female',
            '': 'Unknown', 'nan': 'Unknown', 'None': 'Unknown', 'unknown': 'Unknown',
        }
        cleaned_df['gender'] = cleaned_df['gender'].astype(str).str.strip().replace(['', 'nan', 'None', 'NaN'], 'Unknown')
        cleaned_df['gender'] = cleaned_df['gender'].map(gender_mapping).fillna('Unknown')
        valid_genders = ['Male', 'Female', 'Unknown']
        unrecognized = ~cleaned_df['gender'].isin(valid_genders)
        if unrecognized.sum() > 0:
            print(f"   Marked {unrecognized.sum()} records with unrecognized gender as 'Unknown'")
            cleaned_df.loc[unrecognized, 'gender'] = 'Unknown'

    print('Data cleaning complete!')
    print(f'   Final records: {len(cleaned_df)}')
    print(f'   Total removed: {original_count - len(cleaned_df)}')
    if original_count:
        print(f'   Retention rate: {(len(cleaned_df) / original_count) * 100:.1f}%')
    return cleaned_df


def smart_impute_missing_data_enhanced(df, measurement_fields, strategy='group_median'):
    imputed_df = df.copy()
    print(f'SMART MISSING DATA IMPUTATION - Strategy: {strategy}')
    for field in measurement_fields:
        if field not in imputed_df.columns:
            continue
        imputed_df[field] = pd.to_numeric(imputed_df[field], errors='coerce')
        missing_count = imputed_df[field].isnull().sum()
        total_count = len(imputed_df)
        missing_percent = (missing_count / total_count) * 100 if total_count > 0 else 0
        if missing_count <= 0:
            continue
        print(f'  {field}: {missing_count}/{total_count} missing ({missing_percent:.1f}%)')
        if strategy == 'leave_nan':
            continue
        if strategy == 'zero':
            imputed_df[field] = imputed_df[field].fillna(0)
            continue
        if strategy == 'group_median':
            if 'batch' in imputed_df.columns and 'gender' in imputed_df.columns:
                group_medians = imputed_df.groupby(['batch', 'gender'])[field].median()
                for (batch, gender), median_val in group_medians.items():
                    if pd.notna(median_val):
                        mask = (imputed_df['batch'] == batch) & (imputed_df['gender'] == gender) & imputed_df[field].isnull()
                        imputed_df.loc[mask, field] = median_val
                overall_median = imputed_df[field].median()
                if pd.notna(overall_median):
                    imputed_df[field] = imputed_df[field].fillna(overall_median)
            else:
                median_val = imputed_df[field].median()
                if pd.notna(median_val):
                    imputed_df[field] = imputed_df[field].fillna(median_val)
            continue
        if strategy == 'forward_fill' and 'subject_id' in imputed_df.columns and 'timepoint' in imputed_df.columns:
            imputed_df = imputed_df.sort_values(['subject_id', 'timepoint'])
            imputed_df[field] = imputed_df.groupby('subject_id')[field].ffill()
            imputed_df[field] = imputed_df.groupby('subject_id')[field].bfill()
            continue
        if strategy == 'smart':
            if missing_percent > 60:
                continue
            if field in ['total_weight', 'soft_weight', 'lean_weight'] and 'batch' in imputed_df.columns and 'gender' in imputed_df.columns:
                group_medians = imputed_df.groupby(['batch', 'gender'])[field].median()
                for (batch, gender), median_val in group_medians.items():
                    if pd.notna(median_val):
                        mask = (imputed_df['batch'] == batch) & (imputed_df['gender'] == gender) & imputed_df[field].isnull()
                        imputed_df.loc[mask, field] = median_val
    return imputed_df
