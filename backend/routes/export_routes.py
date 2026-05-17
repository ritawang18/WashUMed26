from pathlib import Path

from flask import Blueprint, current_app, jsonify, send_from_directory

from config import EXPORTS_FOLDER
from db.supabase_client import supabase_client
from services.export_service import export_session_to_csv
from utils.auth import require_user_id
from utils.filenames import safe_filename


export_bp = Blueprint('export', __name__)


@export_bp.route('/export-csv/<session_id>')
def export_csv_route(session_id):
    if supabase_client is None:
        return jsonify({'error': 'Supabase not connected'}), 503
    try:
        user_id = require_user_id()
        csv_text, filename = export_session_to_csv(user_id, session_id)
        return current_app.response_class(
            csv_text,
            mimetype='text/csv',
            headers={
                'Content-Disposition': f'attachment; filename={filename}',
                'Access-Control-Allow-Origin': '*',
            },
        )
    except LookupError as e:
        return jsonify({'error': str(e)}), 404
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@export_bp.route('/download/<filename>')
def download_file_route(filename):
    safe_name = safe_filename(filename)
    file_path = EXPORTS_FOLDER / safe_name
    if not file_path.exists():
        return jsonify({'error': 'File not found'}), 404
    return send_from_directory(str(EXPORTS_FOLDER), safe_name, as_attachment=True, download_name=safe_name, mimetype='text/csv')
