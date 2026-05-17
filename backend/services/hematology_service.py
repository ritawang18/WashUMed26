import re

from db.supabase_client import supabase_client
from services.hematology_parser import _clean_str
from services.grouping_service import upsert_subject_groupings_for_user


def require_supabase():
    if supabase_client is None:
        raise RuntimeError('Supabase not connected')
    return supabase_client


def normalize_hemovat_param_key(label: str) -> str:
    raw = _clean_str(label)
    mapping = {
        'WBC': 'wbc',
        'Neu #': 'neu_abs',
        'Lym #': 'lym_abs',
        'Mon #': 'mon_abs',
        'Eos #': 'eos_abs',
        'Bas #': 'bas_abs',
        'Neu %': 'neu_pct',
        'Lym %': 'lym_pct',
        'Mon %': 'mon_pct',
        'Eos %': 'eos_pct',
        'Bas %': 'bas_pct',
        'RBC': 'rbc',
        'HGB': 'hgb',
        'HCT': 'hct',
        'MCV': 'mcv',
        'MCH': 'mch',
        'MCHC': 'mchc',
        'RDW-CV': 'rdw_cv',
        'PLT': 'plt',
        'MPV': 'mpv',
    }
    if raw in mapping:
        return mapping[raw]
    return raw.lower().replace('#', 'abs').replace('%', 'pct').replace('/', '_').replace('-', '_').replace('.', '').replace(' ', '_')


def to_float_or_none(value):
    s = _clean_str(value)
    if not s:
        return None
    cleaned = re.sub(r'[^0-9.\-]', '', s)
    if cleaned in ('', '.', '-', '-.'):
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def save_reviewed_hematology_report(user_id, records, filename='', batch='Unknown_Batch'):
    client = require_supabase()
    if not isinstance(records, list) or not records:
        raise ValueError('No parsed hematology rows provided')

    first = records[0]
    subject_id = _clean_str(first.get('Sample ID'))
    if not subject_id:
        raise ValueError('Sample ID is required because it maps to subject_id')

    measurements = {}
    for row in records:
        parameter = _clean_str(row.get('Parameter'))
        if not parameter:
            continue
        key = normalize_hemovat_param_key(parameter)
        measurements[key] = {
            'label': parameter,
            'value': to_float_or_none(row.get('Result')),
            'raw_value': _clean_str(row.get('Result')),
            'unit': _clean_str(row.get('Unit')),
            'ref_range': _clean_str(row.get('Ref. Ranges')),
        }
    if not measurements:
        raise ValueError('No valid measurement rows found')

    timepoint = _clean_str(first.get('Time of Analysis')) or _clean_str(first.get('Draw Time')) or 'Unknown_Timepoint'
    session_insert = {
        'user_id': user_id,
        'status': 'success',
        'data_type': 'hematology',
        'files_uploaded': 1,
        'files_processed': 1,
        'total_records': len(measurements),
        'duplicates_removed': 0,
        'batches_processed': [batch] if batch else [],
        'timepoints_found': [timepoint],
        'csv_filename': filename,
        'processing_warnings': [],
    }
    session_result = client.table('upload_sessions').insert(session_insert).execute()
    session_rows = session_result.data or []
    session_id = session_rows[0]['session_id'] if session_rows else None

    upsert_subject_groupings_for_user(user_id, [{'subject_id': subject_id, 'gender': _clean_str(first.get('Gender'))}])

    report_row = {
        'user_id': user_id,
        'session_id': session_id,
        'batch': batch,
        'subject_id': subject_id,
        'timepoint': timepoint,
        'filename': filename,
        'patient': _clean_str(first.get('Patient')),
        'owner_last_name': _clean_str(first.get('Owner Last Name')),
        'gender': _clean_str(first.get('Gender')),
        'species': _clean_str(first.get('Species')),
        'patient_id': _clean_str(first.get('Patient ID')),
        'mode': _clean_str(first.get('Mode')),
        'age': _clean_str(first.get('Age')),
        'delivery_time': _clean_str(first.get('Delivery Time')),
        'draw_time': _clean_str(first.get('Draw Time')),
        'time_of_analysis': _clean_str(first.get('Time of Analysis')),
        'time_of_printing': _clean_str(first.get('Time of Printing')),
        'operator': _clean_str(first.get('Operator')),
        'veterinarian': _clean_str(first.get('Veterinarian')),
        'comments': _clean_str(first.get('Comments')),
        'measurements': measurements,
        'messages': {},
    }
    report_result = client.table('hematology_reports').insert(report_row).execute()
    return {
        'status': 'success',
        'message': 'Hemovat parsing result saved.',
        'session_id': session_id,
        'report': (report_result.data or [None])[0],
    }


def get_hematology_reports(user_id):
    client = require_supabase()
    return client.table('hematology_reports').select('*').eq('user_id', user_id).execute().data or []


def flatten_hematology_report(report):
    flat = {
        'id': report.get('id'),
        'data_type': 'hematology',
        'subject_id': report.get('subject_id'),
        'timepoint': report.get('timepoint'),
        'batch': report.get('batch'),
        'filename': report.get('filename'),
        'patient': report.get('patient'),
        'owner_last_name': report.get('owner_last_name'),
        'gender': report.get('gender'),
        'species': report.get('species'),
        'patient_id': report.get('patient_id'),
        'mode': report.get('mode'),
        'age': report.get('age'),
    }
    meta = {}
    for key, info in (report.get('measurements') or {}).items():
        if not isinstance(info, dict):
            continue
        value = info.get('value')
        if isinstance(value, (int, float)):
            flat[key] = value
        meta[key] = {
            'label': info.get('label'),
            'unit': info.get('unit'),
            'ref_range': info.get('ref_range'),
        }
    flat['_measurement_meta'] = meta
    return flat


def flatten_hematology_reports_for_visualization(user_id):
    return [flatten_hematology_report(r) for r in get_hematology_reports(user_id)]
