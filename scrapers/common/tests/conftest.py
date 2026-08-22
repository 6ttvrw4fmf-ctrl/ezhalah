"""Hermetic import shim for scrapers/common/tests/.

Every per-platform `run.py` imports real third-party clients at module level (`curl_cffi`,
`supabase`, `python-dotenv`) even though these tests only exercise pure parsing/mapping functions
and never touch the network or a real database. Rather than installing those (and Playwright, the
heaviest one) in CI just to satisfy an import, stub the same three modules `scrapers/wasalt/tests/
conftest.py` already stubs for the same reason — keeps this suite hermetic, no-network, ~1s.

`setdefault` so a real install (e.g. a future `pip install -r scrapers/requirements.txt` CI job)
is used instead of the stub if present.
"""
from __future__ import annotations

import sys
import types

# ── dotenv ───────────────────────────────────────────────────────────────────────────────────────
_dotenv = types.ModuleType("dotenv")
_dotenv.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv)

# ── supabase ─────────────────────────────────────────────────────────────────────────────────────
_supabase = types.ModuleType("supabase")


class _StubClient:  # only referenced as a type annotation (`-> Client`) by scrapers.common.db
    pass


def _stub_create_client(*a, **k):
    raise RuntimeError("supabase.create_client is stubbed in tests — no real DB access here")


_supabase.Client = _StubClient
_supabase.create_client = _stub_create_client
sys.modules.setdefault("supabase", _supabase)

# ── curl_cffi ────────────────────────────────────────────────────────────────────────────────────
_cc = types.ModuleType("curl_cffi")
_cc_requests = types.ModuleType("curl_cffi.requests")


class _StubSession:  # only referenced as a type by platform run.py modules
    pass


_cc_requests.Session = _StubSession
_cc.requests = _cc_requests
sys.modules.setdefault("curl_cffi", _cc)
sys.modules.setdefault("curl_cffi.requests", _cc_requests)
