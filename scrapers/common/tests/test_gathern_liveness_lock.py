"""Guards for the Gathern liveness --apply cross-session lock (2026-07-27).

Two sessions ran the same liveness --apply against the shared Supabase project within the hour, so
--apply now takes the shared deploy lock under a distinct lock_name. The safety-critical mapping is:
  • a returned lock row  -> True  (we hold it, may write)
  • an EMPTY result      -> False (someone else holds it -> must NOT write)
  • a DB error           -> None  (fail CLOSED -> must NOT write)
A wrong mapping here would let two apply runs write concurrently — the exact bug this closes.

    python -m pytest scrapers/common/tests/test_gathern_liveness_lock.py -q
"""
from __future__ import annotations

import sys
import types

_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.gathern.liveness import (  # noqa: E402
    LOCK_NAME, _acquire_apply_lock, _release_apply_lock,
)


class _RPC:
    def __init__(self, data=None, boom=False):
        self._data, self._boom = data, boom

    def execute(self):
        if self._boom:
            raise RuntimeError("db down")
        return types.SimpleNamespace(data=self._data)


class _Client:
    """Minimal stand-in: records calls, returns a preset acquire result."""
    def __init__(self, acquire_rpc):
        self._acquire_rpc = acquire_rpc
        self.released_with = None

    def rpc(self, name, params):
        assert params["p_lock_name"] == LOCK_NAME, params
        if name == "acquire_deploy_lock":
            return self._acquire_rpc
        if name == "release_deploy_lock":
            self.released_with = params["p_holder"]
            return _RPC(data=[True])
        raise AssertionError(f"unexpected rpc {name}")


def test_acquire_true_when_lock_row_returned():
    got = _acquire_apply_lock(_Client(_RPC(data=[{"lock_name": LOCK_NAME, "holder": "h"}])), "h", 60)
    assert got is True


def test_acquire_false_when_empty_means_held_elsewhere():
    # EMPTY result MUST map to False so --apply refuses to write while another session holds it.
    assert _acquire_apply_lock(_Client(_RPC(data=[])), "h", 60) is False


def test_acquire_none_on_db_error_fails_closed():
    assert _acquire_apply_lock(_Client(_RPC(boom=True)), "h", 60) is None


def test_release_calls_rpc_with_holder():
    c = _Client(_RPC(data=[]))
    _release_apply_lock(c, "holder-xyz")
    assert c.released_with == "holder-xyz"


if __name__ == "__main__":
    test_acquire_true_when_lock_row_returned()
    test_acquire_false_when_empty_means_held_elsewhere()
    test_acquire_none_on_db_error_fails_closed()
    test_release_calls_rpc_with_holder()
    print("ok")
