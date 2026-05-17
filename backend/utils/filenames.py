from pathlib import Path
import re


def safe_filename(filename):
    return Path(filename or 'file').name


def file_extension(filename):
    name = safe_filename(filename)
    return name.lower().rsplit('.', 1)[-1] if '.' in name else ''


def make_export_filename(prefix, session_id, ext='csv'):
    clean_prefix = re.sub(r'[^A-Za-z0-9_-]+', '_', prefix or 'export')
    return f'{clean_prefix}_{str(session_id)[:8]}.{ext}'
