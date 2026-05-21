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
    """
    Convert one hematology_reports DB row into one visualization row.

    measurements JSONB:
      {
        "wbc": {"label": "WBC", "value": 12.3, "raw_value": "12.3", ...}
      }

    becomes:
      {
        "subject_id": "...",
        "timepoint": "...",
        "wbc": 12.3
      }
    """
    flat = {
        'id': report.get('id'),
        'user_id': report.get('user_id'),
        'session_id': report.get('session_id'),
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

        'delivery_time': report.get('delivery_time'),
        'draw_time': report.get('draw_time'),
        'time_of_analysis': report.get('time_of_analysis'),
        'time_of_printing': report.get('time_of_printing'),
        'operator': report.get('operator'),
        'veterinarian': report.get('veterinarian'),
        'comments': report.get('comments'),
    }

    meta = {}

    for key, info in (report.get('measurements') or {}).items():
        if not isinstance(info, dict):
            continue

        value = info.get('value')
        raw_value = info.get('raw_value')

        if value is not None:
            try:
                flat[key] = float(value)
            except (ValueError, TypeError):
                pass
        elif raw_value not in (None, ''):
            try:
                flat[key] = float(raw_value)
            except (ValueError, TypeError):
                pass

        meta[key] = {
            'label': info.get('label'),
            'unit': info.get('unit'),
            'ref_range': info.get('ref_range'),
        }

    flat['_measurement_meta'] = meta
    return flat


def flatten_hematology_reports_for_visualization(user_id):
    return [flatten_hematology_report(r) for r in get_hematology_reports(user_id)]

def update_hematology_report_field(user_id, report_id, updates):
    """
    Update one or more visible fields from the Hemovat side panel.

    Metadata fields are stored as normal columns.
    Measurement fields are stored inside measurements JSONB.
    data_type is not editable.
    """
    client = require_supabase()

    if not isinstance(updates, dict) or not updates:
        raise ValueError('No update fields provided')

    result = (
        client
        .table('hematology_reports')
        .select('*')
        .eq('user_id', user_id)
        .eq('id', report_id)
        .execute()
    )

    rows = result.data or []
    if not rows:
        raise ValueError('Hematology report not found')

    report = rows[0]

    blocked_fields = {
        'id',
        'user_id',
        'session_id',
        'data_type',
        '_measurement_meta',
        'created_at',
        'messages',
    }

    direct_columns = {
        'batch',
        'subject_id',
        'timepoint',
        'filename',
        'patient',
        'owner_last_name',
        'gender',
        'species',
        'patient_id',
        'mode',
        'age',
        'delivery_time',
        'draw_time',
        'time_of_analysis',
        'time_of_printing',
        'operator',
        'veterinarian',
        'comments',
    }

    direct_updates = {}
    measurements = report.get('measurements') or {}

    for field, value in updates.items():
        if field in blocked_fields:
            continue

        if field in direct_columns:
            direct_updates[field] = value

        elif field in measurements and isinstance(measurements[field], dict):
            numeric_value = to_float_or_none(value)

            measurements[field]['raw_value'] = str(value) if value is not None else ''
            measurements[field]['value'] = numeric_value

        else:
            # If it is not a direct DB column and not an existing measurement,
            # treat it as a new measurement field.
            numeric_value = to_float_or_none(value)

            measurements[field] = {
                'label': field,
                'value': numeric_value,
                'raw_value': str(value) if value is not None else '',
                'unit': '',
                'ref_range': '',
            }

    update_payload = {
        **direct_updates,
        'measurements': measurements,
    }

    update_result = (
        client
        .table('hematology_reports')
        .update(update_payload)
        .eq('user_id', user_id)
        .eq('id', report_id)
        .execute()
    )

    updated_rows = update_result.data or []
    if not updated_rows:
        return report

    return updated_rows[0]