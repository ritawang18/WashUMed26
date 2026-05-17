import math
import numpy as np


def clean_numeric_nan(record):
    """Convert NaN/Inf floats to None before Supabase insert/update."""
    cleaned = {}
    for k, v in record.items():
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            cleaned[k] = None
        else:
            cleaned[k] = v
    return cleaned


def convert_numpy_types(obj):
    if isinstance(obj, (np.integer, np.int64)):
        return int(obj)
    if isinstance(obj, (np.floating, np.float64)):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    return obj


def clean_response_dict(data):
    return {k: convert_numpy_types(v) for k, v in data.items()}
