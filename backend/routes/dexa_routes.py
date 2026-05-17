from flask import Blueprint, jsonify, request

from db.supabase_client import supabase_client
from services.dexa_service import get_dexa_records, process_and_save_dexa_files, update_dexa_record
from utils.auth import require_user_id, get_current_user_id


dexa_bp = Blueprint('dexa', __name__)


@dexa_bp.route('/dexa/process', methods=['POST'])
def process_dexa():
    try:
        user_id = require_user_id()
        files = request.files.getlist('files')
        imputation_strategy = request.form.get('imputation_strategy', 'group_median')
        result = process_and_save_dexa_files(user_id, files, imputation_strategy=imputation_strategy)
        return jsonify(result)
    except ValueError as e:
        return jsonify({'status': 'error', 'error': str(e)}), 400
    except Exception as e:
        return jsonify({'status': 'error', 'error': f'Processing failed: {str(e)}'}), 500


@dexa_bp.route('/dexa-records')
def get_dexa_records_route():
    if supabase_client is None:
        return jsonify({'error': 'Supabase not connected'}), 503
    try:
        user_id = get_current_user_id(required=True)
        if not user_id:
            return jsonify({'error': 'user_id is required'}), 400
        return jsonify(get_dexa_records(user_id))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@dexa_bp.route('/dexa-records/<record_id>', methods=['PATCH'])
def update_dexa_record_route(record_id):
    if supabase_client is None:
        return jsonify({'error': 'Supabase not connected'}), 503
    try:
        user_id = require_user_id()
        data = request.get_json() or {}
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        record = update_dexa_record(user_id, record_id, data)
        return jsonify({'success': True, 'record': record})
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500
