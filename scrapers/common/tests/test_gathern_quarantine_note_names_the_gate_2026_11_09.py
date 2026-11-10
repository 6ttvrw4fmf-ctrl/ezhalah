"""A gathern quarantine note names the gate that fired, never «alive_rate below 20%» at 97 % alive (2026-11-09)."""
import sys
import types

sys.path.insert(0, ".")
for _n in ("supabase", "dotenv"):
    sys.modules.setdefault(_n, types.ModuleType(_n))
sys.modules["supabase"].Client = object
sys.modules["supabase"].create_client = lambda *a, **k: None
sys.modules["dotenv"].load_dotenv = lambda *a, **k: None

from scrapers.gathern import liveness as L  # noqa: E402


def test_a_failed_control_is_named_and_the_rate_is_not_blamed():
    # the 11-09 01:39 run: 92.2 % alive, opening canary 9/10 (one 404), closing 10/10
    why = L.quarantine_cause(False, 0.922, 9, 10, 10, 10)
    assert "controls failed" in why and "open 9/10" in why
    assert "below" not in why


def test_a_low_rate_with_no_control_verdict_still_says_so():
    why = L.quarantine_cause(None, 0.05, 0, 0, 0, 0)
    assert why.startswith("alive_rate=5.0% below 20%")
