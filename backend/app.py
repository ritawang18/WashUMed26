import os
import warnings
from datetime import datetime

from flask import Flask

from config import EXCEL_SUPPORT, GEMINI_SUPPORT, MAX_FILE_SIZE_MB, MAX_FILES_PER_BATCH, SUPPORTED_EXTENSIONS, UPLOAD_FOLDER
from routes.case_routes import case_bp
from routes.dexa_routes import dexa_bp
from routes.export_routes import export_bp
from routes.grouping_routes import grouping_bp
from routes.health_routes import health_bp
from routes.hematology_routes import hematology_bp

warnings.filterwarnings('ignore')


def create_app():
    app = Flask(__name__)

    @app.after_request
    def after_request(response):
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-User-Id')
        response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
        return response

    app.register_blueprint(dexa_bp, url_prefix='/api')
    app.register_blueprint(hematology_bp, url_prefix='/api')
    app.register_blueprint(case_bp, url_prefix='/api')
    app.register_blueprint(grouping_bp, url_prefix='/api')
    app.register_blueprint(export_bp, url_prefix='/api')
    app.register_blueprint(health_bp, url_prefix='/api')

    @app.route('/')
    def index():
        return f'''
        <h1>Enhanced Biomedical Data Processing API</h1>
        <p><strong>Refactored Flask backend for DEXA and Hemovat processing.</strong></p>
        <h3>API Endpoints:</h3>
        <ul>
            <li><strong>POST /api/dexa/process</strong> - Process and save DEXA files</li>
            <li><strong>POST /api/hematology/parse</strong> - Parse Hemovat PDF for review/edit</li>
            <li><strong>POST /api/hematology-reports/save</strong> - Save reviewed Hemovat result</li>
            <li><strong>GET /api/cases</strong> - List upload sessions</li>
            <li><strong>GET /api/export-csv/&lt;session_id&gt;</strong> - Download session CSV</li>
            <li><strong>GET /api/health</strong> - Health check</li>
        </ul>
        <p>Supported formats: {', '.join(SUPPORTED_EXTENSIONS)}</p>
        '''

    return app


app = create_app()


if __name__ == '__main__':
    print('Enhanced biomedical processing API starting...')
    print(f'Supported formats: {", ".join(SUPPORTED_EXTENSIONS)}')
    print(f'Max files per batch: {MAX_FILES_PER_BATCH}')
    print(f'Max file size: {MAX_FILE_SIZE_MB}MB')
    print(f'PDF/Gemini support: {"Available" if GEMINI_SUPPORT and os.environ.get("GEMINI_API_KEY") else "Not Available"}')
    print(f'Excel support: {"Available" if EXCEL_SUPPORT else "Not Available"}')
    print('Access at: http://localhost:5001')

    for file in UPLOAD_FOLDER.glob('*'):
        try:
            if file.is_file() and (datetime.now() - datetime.fromtimestamp(file.stat().st_mtime)).days > 1:
                file.unlink()
        except Exception as e:
            app.logger.warning(f'Could not clean up file {file}: {e}')

    app.run(debug=True, host='0.0.0.0', port=5001)
