from db.supabase_client import supabase_client


def require_supabase():
    if supabase_client is None:
        raise RuntimeError('Supabase not connected')
    return supabase_client


def _normalize_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def get_cases_for_user(user_id):
    client = require_supabase()
    sessions = client.table('upload_sessions').select('*').eq('user_id', user_id).order('created_at', desc=True).execute().data or []
    cases = []
    for session in sessions:
        session_id = session.get('session_id')
        data_type = (session.get('data_type') or 'dexa').lower()

        if data_type == 'dexa':
            records = client.table('dexa_records').select('subject_id,timepoint,batch,filename').eq('user_id', user_id).eq('session_id', session_id).execute().data or []
            derived_timepoints = sorted({str(r.get('timepoint')).strip() for r in records if r.get('timepoint') not in (None, '', 'Unknown_Timepoint')})
            derived_batches = sorted({str(r.get('batch')).strip() for r in records if r.get('batch') not in (None, '', 'Unknown_Batch')})
            derived_subjects = sorted({str(r.get('subject_id')).strip() for r in records if r.get('subject_id')})
        elif data_type in ('hematology', 'hemovat'):
            reports = client.table('hematology_reports').select('subject_id,timepoint,batch,filename').eq('user_id', user_id).eq('session_id', session_id).execute().data or []
            derived_timepoints = sorted({str(r.get('timepoint')).strip() for r in reports if r.get('timepoint') not in (None, '', 'Unknown_Timepoint')})
            derived_batches = sorted({str(r.get('batch')).strip() for r in reports if r.get('batch') not in (None, '', 'Unknown_Batch')})
            derived_subjects = sorted({str(r.get('subject_id')).strip() for r in reports if r.get('subject_id')})
            records = reports
        else:
            records = []
            derived_timepoints, derived_batches, derived_subjects = [], [], []

        case = dict(session)
        case['timepoints_found'] = derived_timepoints or _normalize_list(session.get('timepoints_found'))
        case['batches_processed'] = derived_batches or _normalize_list(session.get('batches_processed'))
        case['record_count'] = len(records)
        case['subject_count'] = len(derived_subjects)
        cases.append(case)
    return cases
