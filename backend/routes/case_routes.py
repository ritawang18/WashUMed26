from flask import Blueprint, jsonify

from db.supabase_client import supabase_client
from services.case_service import get_cases_for_user
from utils.auth import require_user_id


case_bp = Blueprint('case', __name__)


@case_bp.route('/cases', methods=['GET'])
def get_cases_route():
    if supabase_client is None:
        return jsonify({'error': 'Supabase not connected'}), 503
    try:
        user_id = require_user_id()
        return jsonify(get_cases_for_user(user_id))
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500
