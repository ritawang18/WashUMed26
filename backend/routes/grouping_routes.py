from flask import Blueprint, jsonify, request

from db.supabase_client import supabase_client
from services.grouping_service import (
    create_custom_grouping,
    delete_custom_grouping,
    get_custom_grouping_members,
    get_custom_groupings,
    get_subject_groupings,
    upsert_subject_grouping,
)
from utils.auth import require_user_id


grouping_bp = Blueprint('grouping', __name__)


@grouping_bp.route('/subject-groupings')
def get_subject_groupings_route():
    if supabase_client is None:
        return jsonify({'error': 'Supabase not connected'}), 503
    try:
        user_id = require_user_id()
        return jsonify(get_subject_groupings(user_id))
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@grouping_bp.route('/subject-groupings/<subject_id>', methods=['POST'])
def upsert_subject_grouping_route(subject_id):
    if supabase_client is None:
        return jsonify({'error': 'Supabase not connected'}), 503
    try:
        user_id = require_user_id()
        data = request.get_json() or {}
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        result = upsert_subject_grouping(user_id, subject_id, data)
        return jsonify({'success': True, 'data': result})
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@grouping_bp.route('/custom-groupings', methods=['GET'])
def get_custom_groupings_route():
    if supabase_client is None:
        return jsonify({'error': 'Supabase not connected'}), 503
    try:
        user_id = require_user_id()
        return jsonify(get_custom_groupings(user_id))
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@grouping_bp.route('/custom-groupings', methods=['POST'])
def create_custom_grouping_route():
    if supabase_client is None:
        return jsonify({'error': 'Supabase not connected'}), 503

    try:
        user_id = require_user_id()
        data = request.get_json() or {}

        if not data:
            return jsonify({'error': 'No data provided'}), 400

        result = create_custom_grouping(user_id, data)

        if result.get('success') is False:
            status_code = 404 if result.get('error') == 'subject_not_found' else 400
            return jsonify(result), status_code

        return jsonify({
            'success': True,
            'grouping': result['grouping'],
            'subjects_updated': result['subjects_updated']
        }), 201

    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@grouping_bp.route('/custom-groupings/<grouping_id>/members', methods=['GET'])
def get_grouping_members_route(grouping_id):
    if supabase_client is None:
        return jsonify({'error': 'Supabase not connected'}), 503
    try:
        user_id = require_user_id()
        return jsonify(get_custom_grouping_members(user_id, grouping_id))
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@grouping_bp.route('/custom-groupings/<grouping_id>', methods=['DELETE'])
def delete_custom_grouping_route(grouping_id):
    if supabase_client is None:
        return jsonify({'error': 'Supabase not connected'}), 503
    try:
        user_id = require_user_id()
        return jsonify(delete_custom_grouping(user_id, grouping_id))
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500
