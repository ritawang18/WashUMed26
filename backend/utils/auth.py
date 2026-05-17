import os
from flask import request


def get_current_user_id(required=True):
    """Resolve user_id from X-User-Id, form body, query string, JSON body, or DEV_USER_ID."""
    json_body = request.get_json(silent=True) or {}
    user_id = (
        request.headers.get('X-User-Id')
        or request.form.get('user_id')
        or request.args.get('user_id')
        or json_body.get('user_id')
        or os.environ.get('DEV_USER_ID')
    )
    if user_id:
        return str(user_id).strip()
    return None if required else None


def require_user_id():
    user_id = get_current_user_id(required=True)
    if not user_id:
        raise ValueError(
            'Missing user id. Send user_id in FormData, X-User-Id header, query string, JSON body, '
            'or set DEV_USER_ID in backend/.env.'
        )
    return user_id


def normalize_subject_id(subject_id):
    return str(subject_id or '').strip()
