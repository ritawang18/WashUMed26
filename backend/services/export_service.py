import io
import pandas as pd

from db.supabase_client import supabase_client


def require_supabase():
    if supabase_client is None:
        raise RuntimeError('Supabase not connected')
    return supabase_client


def export_session_to_csv(user_id, session_id):
    client = require_supabase()
    session_result = client.table('upload_sessions').select('*').eq('session_id', session_id).eq('user_id', user_id).execute()
    sessions = session_result.data or []
    if not sessions:
        raise LookupError('Upload session not found for this user')

    session_row = sessions[0]
    data_type = (session_row.get('data_type') or 'dexa').lower()

    if data_type == 'dexa':
        result = client.table('dexa_records').select('*').eq('session_id', session_id).eq('user_id', user_id).execute()
        if not result.data:
            raise LookupError('No DEXA records found for this session')
        df = pd.DataFrame(result.data)
        preferred_cols = ['id', 'user_id', 'session_id', 'batch', 'subject_id', 'timepoint', 'filename']
        ordered_cols = [c for c in preferred_cols if c in df.columns] + [c for c in df.columns if c not in preferred_cols]
        df = df[ordered_cols]
        filename = f'DEXA_{str(session_id)[:8]}.csv'

    elif data_type in ('hematology', 'hemovat'):
        result = client.table('hematology_reports').select('*').eq('session_id', session_id).eq('user_id', user_id).execute()
        if not result.data:
            raise LookupError('No hematology reports found for this session')
        rows = []
        for report in result.data:
            for key, info in (report.get('measurements') or {}).items():
                if not isinstance(info, dict):
                    continue
                rows.append({
                    'patient': report.get('patient'),
                    'owner_last_name': report.get('owner_last_name'),
                    'gender': report.get('gender'),
                    'subject_id': report.get('subject_id'),
                    'species': report.get('species'),
                    'patient_id': report.get('patient_id'),
                    'mode': report.get('mode'),
                    'age': report.get('age'),
                    'parameter': info.get('label') or key,
                    'result': info.get('raw_value') or info.get('value'),
                    'unit': info.get('unit'),
                    'ref_range': info.get('ref_range'),
                    'delivery_time': report.get('delivery_time'),
                    'draw_time': report.get('draw_time'),
                    'time_of_analysis': report.get('time_of_analysis'),
                    'time_of_printing': report.get('time_of_printing'),
                    'operator': report.get('operator'),
                    'veterinarian': report.get('veterinarian'),
                    'comments': report.get('comments'),
                    'filename': report.get('filename'),
                    'session_id': report.get('session_id'),
                })
        if not rows:
            raise LookupError('No hematology measurement rows found for this session')
        df = pd.DataFrame(rows)
        filename = f'Hematology_{str(session_id)[:8]}.csv'
    else:
        raise ValueError(f'Unsupported session data_type: {data_type}')

    csv_buffer = io.StringIO()
    df.to_csv(csv_buffer, index=False)
    csv_buffer.seek(0)
    return csv_buffer.getvalue(), filename
