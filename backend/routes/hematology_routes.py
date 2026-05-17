from flask import Blueprint, jsonify, request

from config import HEMOVAT_REVIEW_COLUMNS
from db.supabase_client import supabase_client
from services.hematology_parser import parse_hemovat_pdf_for_review
from services.hematology_service import flatten_hematology_reports_for_visualization, save_reviewed_hematology_report
from utils.auth import require_user_id, get_current_user_id


hematology_bp = Blueprint('hematology', __name__)


@hematology_bp.route('/hematology/parse', methods=['POST'])
def parse_hematology():
    try:
        require_user_id()
        files = [f for f in request.files.getlist('files') if f and f.filename]
        if not files:
            return jsonify({'status': 'error', 'error': 'No files uploaded'}), 400
        if len(files) > 1:
            return jsonify({'status': 'error', 'error': 'Please upload one Hemovat PDF at a time for review/edit/save.'}), 400
        file = files[0]
        review_rows = parse_hemovat_pdf_for_review(file.read(), file.filename)
        return jsonify({
            'status': 'parsed',
            'upload_mode': 'hematology',
            'filename': file.filename,
            'batch': 'Unknown_Batch',
            'total_records': len(review_rows),
            'columns': HEMOVAT_REVIEW_COLUMNS,
            'records': review_rows,
            'message': 'Hemovat PDF parsed. Review/edit results, then click Save Parsing Result.',
        })
    except ValueError as e:
        return jsonify({'status': 'error', 'error': str(e)}), 400
    except Exception as e:
        return jsonify({'status': 'error', 'error': f'Hemovat parsing failed: {str(e)}'}), 500


@hematology_bp.route('/hematology-reports/save', methods=['POST'])
def save_hematology_report_route():
    if supabase_client is None:
        return jsonify({'error': 'Supabase not connected'}), 503
    try:
        user_id = require_user_id()
        data = request.get_json(silent=True) or {}
        result = save_reviewed_hematology_report(
            user_id=user_id,
            records=data.get('records') or [],
            filename=data.get('filename') or '',
            batch=data.get('batch') or 'Unknown_Batch',
        )
        return jsonify(result)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@hematology_bp.route('/hematology/reports')
def get_hematology_reports_route():
    if supabase_client is None:
        return jsonify({'error': 'Supabase not connected'}), 503
    try:
        user_id = get_current_user_id(required=True)
        if not user_id:
            return jsonify({'error': 'user_id is required'}), 400
        return jsonify(flatten_hematology_reports_for_visualization(user_id))
    except Exception as e:
        return jsonify({'error': str(e)}), 500
