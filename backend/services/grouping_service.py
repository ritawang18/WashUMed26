import uuid
from db.supabase_client import supabase_client
from utils.auth import normalize_subject_id


def require_supabase():
    if supabase_client is None:
        raise RuntimeError('Supabase not connected')
    return supabase_client


def upsert_subject_groupings_for_user(user_id, records):
    client = require_supabase()
    rows_by_subject = {}
    for record in records:
        sid = normalize_subject_id(record.get('subject_id'))
        if not sid:
            continue
        row = {'user_id': user_id, 'subject_id': sid}
        if record.get('gender') not in (None, '', 'Unknown'):
            row['gender'] = record.get('gender')
        if record.get('genotype') not in (None, '', 'Unknown'):
            row['genotype'] = record.get('genotype')
        rows_by_subject[sid] = {**rows_by_subject.get(sid, {}), **row}
    rows = list(rows_by_subject.values())
    for i in range(0, len(rows), 100):
        client.table('subject_grouping').upsert(rows[i:i + 100], on_conflict='user_id,subject_id').execute()
    return len(rows)


def get_subject_groupings(user_id):
    client = require_supabase()
    return client.table('subject_grouping').select('*').eq('user_id', user_id).execute().data or []


def upsert_subject_grouping(user_id, subject_id, data):
    client = require_supabase()
    flag = data.get('flag')
    if flag and flag not in ('experiment', 'control'):
        raise ValueError('Invalid flag value')
    row = {'subject_id': subject_id, 'user_id': user_id}
    for field in ('flag', 'gender', 'dob', 'genotype'):
        if field in data:
            row[field] = data[field]
    existing = client.table('subject_grouping').select('*').eq('user_id', user_id).eq('subject_id', subject_id).execute()
    if existing.data:
        result = client.table('subject_grouping').update(row).eq('user_id', user_id).eq('subject_id', subject_id).execute()
    else:
        result = client.table('subject_grouping').insert(row).execute()
    return result.data or []


def get_custom_groupings(user_id):
    client = require_supabase()
    return client.table('custom_groupings').select('*').eq('user_id', user_id).execute().data or []


def _matching_subjects_for_range(user_id, data):
    client = require_supabase()
    metric_field = data['metric_field']
    range_min = float(data['range_min'])
    range_max = float(data['range_max'])
    data_type = data.get('data_type')
    matching_subjects = set()

    if data_type == 'dexa':
        result = client.table('dexa_records').select(f'subject_id,{metric_field}').eq('user_id', user_id).execute()
        for record in result.data or []:
            sid = record.get('subject_id')
            val = record.get(metric_field)
            if sid and val is not None:
                try:
                    if range_min <= float(val) <= range_max:
                        matching_subjects.add(str(sid))
                except (ValueError, TypeError):
                    pass

    elif data_type in ('hematology', 'hemovat'):
        result = client.table('hematology_reports').select('subject_id,measurements').eq('user_id', user_id).execute()
        for report in result.data or []:
            sid = report.get('subject_id')
            info = (report.get('measurements') or {}).get(metric_field)
            if sid and isinstance(info, dict):
                val = info.get('value')
                if val is not None:
                    try:
                        if range_min <= float(val) <= range_max:
                            matching_subjects.add(str(sid))
                    except (ValueError, TypeError):
                        pass
    return matching_subjects

def validate_subjects_exist_for_user(user_id, subject_ids):
    """
    Check whether manually entered subject IDs already exist for this user.

    We validate against subject_grouping because it is the user-scoped subject table
    populated during DEXA/Hemovat uploads.
    """
    client = require_supabase()

    requested_subjects = [
        str(s).strip()
        for s in subject_ids
        if str(s).strip()
    ]

    if not requested_subjects:
        raise ValueError('selected_subjects must be a non-empty list for manual grouping')

    result = (
        client
        .table('subject_grouping')
        .select('subject_id')
        .eq('user_id', user_id)
        .in_('subject_id', requested_subjects)
        .execute()
    )

    existing_subjects = {
        str(row.get('subject_id')).strip()
        for row in (result.data or [])
        if row.get('subject_id')
    }

    missing_subjects = [
        sid for sid in requested_subjects
        if sid not in existing_subjects
    ]

    return requested_subjects, existing_subjects, missing_subjects

def create_custom_grouping(user_id, data):
    client = require_supabase()
    if not data.get('name'):
        raise ValueError('name is required')
    if data.get('grouping_type') not in ('range', 'manual_selection'):
        raise ValueError("grouping_type must be 'range' or 'manual_selection'")
    if data.get('data_type') not in ('dexa', 'hemovat', 'hematology'):
        raise ValueError("data_type must be 'dexa', 'hemovat', or 'hematology'")
    data_type = 'hematology' if data.get('data_type') == 'hemovat' else data.get('data_type')

    if data['grouping_type'] == 'range':
        if not data.get('metric_field'):
            raise ValueError('metric_field is required for range grouping')
        if data.get('range_min') is None or data.get('range_max') is None:
            raise ValueError('range_min and range_max are required for range grouping')
        matching_subjects = _matching_subjects_for_range(user_id, {**data, 'data_type': data_type})
    else:
        selected = data.get('selected_subjects')

        if not selected or not isinstance(selected, list):
            raise ValueError('selected_subjects must be a non-empty list for manual grouping')

        requested_subjects, existing_subjects, missing_subjects = validate_subjects_exist_for_user(
            user_id,
            selected
        )

        if missing_subjects:
            return {
                'success': False,
                'error': 'subject_not_found',
                'message': 'Subject not found',
                'missing_subjects': missing_subjects,
            }

        matching_subjects = set(existing_subjects)

    grouping_id = str(uuid.uuid4())
    new_grouping = {
        'id': grouping_id,
        'user_id': user_id,
        'name': data['name'],
        'grouping_type': data['grouping_type'],
        'data_type': data_type,
        'metric_field': data.get('metric_field'),
        'range_min': data.get('range_min'),
        'range_max': data.get('range_max'),
    }
    client.table('custom_groupings').insert(new_grouping).execute()

    members = [
        {'id': str(uuid.uuid4()), 'user_id': user_id, 'grouping_id': grouping_id, 'subject_id': sid}
        for sid in matching_subjects
    ]
    if members:
        client.table('custom_grouping_members').insert(members).execute()

    return {'grouping': new_grouping, 'subjects_updated': len(matching_subjects)}


def get_custom_grouping_members(user_id, grouping_id):
    client = require_supabase()
    result = client.table('custom_grouping_members').select('subject_id').eq('grouping_id', grouping_id).eq('user_id', user_id).execute()
    subjects = [row['subject_id'] for row in result.data or []]
    return {'subjects': subjects, 'count': len(subjects)}


def delete_custom_grouping(user_id, grouping_id):
    client = require_supabase()
    client.table('custom_grouping_members').delete().eq('grouping_id', grouping_id).eq('user_id', user_id).execute()
    client.table('custom_groupings').delete().eq('id', grouping_id).eq('user_id', user_id).execute()
    return {'success': True}
