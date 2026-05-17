import os

try:
    from supabase import create_client
    _supabase_url = os.environ.get('SUPABASE_URL')
    _supabase_key = os.environ.get('SUPABASE_SERVICE_KEY')
    supabase_client = create_client(_supabase_url, _supabase_key) if _supabase_url and _supabase_key else None
except ImportError:
    supabase_client = None
