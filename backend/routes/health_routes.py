from datetime import datetime

from flask import Blueprint, jsonify

from config import EXCEL_SUPPORT, GEMINI_SUPPORT, MAX_FILE_SIZE_MB, MAX_FILES_PER_BATCH, SUPPORTED_EXTENSIONS


health_bp = Blueprint('health', __name__)


@health_bp.route('/health')
def health_check():
    return jsonify({
        'status': 'healthy',
        'message': 'Enhanced DEXA API is running',
        'version': '3.0-refactored',
        'features': {
            'excel_support': EXCEL_SUPPORT,
            'gemini_support': GEMINI_SUPPORT,
            'custom_grouping': True,
        },
        'supported_formats': SUPPORTED_EXTENSIONS,
        'max_files_per_batch': MAX_FILES_PER_BATCH,
        'max_file_size_mb': MAX_FILE_SIZE_MB,
        'timestamp': datetime.now().isoformat(),
    })
