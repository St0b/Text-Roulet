"""Optional Supabase backend client.

The local in-memory matchmaking remains the fallback when Supabase variables
are not configured. The service-role key must only be used by server code.
"""

from __future__ import annotations

import os
from typing import Any

try:
    from supabase import Client, create_client
except ImportError:
    Client = Any
    create_client = None


SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")


def get_supabase_client() -> Client | None:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY or create_client is None:
        return None
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
