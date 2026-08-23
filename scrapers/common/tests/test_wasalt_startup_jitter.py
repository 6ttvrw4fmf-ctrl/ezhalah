"""Regression tests for the 2026-08-23 wasalt startup-jitter fix.

wasalt-residential-sweep.yml (20 jobs) and wasalt-commercial-sweep.yml (14 jobs) dispatch fully
parallel with no `max-parallel`, all sharing ONE WASALT_PROXY_URL secret. PR#824 (merged 2026-08-21,
session rotation on retry) did NOT fix the platform's 60-69% daily scrape_runs failure rate,
re-measured 2026-08-23 as still active 3 days after that merge — because rotating a session changes
WHICH connection a retry uses, not HOW MANY of our own jobs open one in the same instant (PR#824's
own evidence: 34 jobs' first requests landed inside a ~4s window).

This fix spreads those same 34 jobs' first connection attempts across up to a minute, cloud-only
(GITHUB_ACTIONS=true, set automatically by every Actions job — no workflow-YAML change required),
never touching a local/manual single-slug run.

Hermetic: no real sleeps, no network.

Run: python -m pytest scrapers/common/tests/test_wasalt_startup_jitter.py -v
"""
import os
import sys
from unittest import mock

sys.path.insert(0, ".")

for name in ("supabase", "dotenv"):
    if name not in sys.modules:
        stub = mock.MagicMock()
        if name == "dotenv":
            stub.load_dotenv = lambda *a, **k: None
        sys.modules[name] = stub

from scrapers.wasalt import run as wasalt  # noqa: E402


def _clean_env():
    return mock.patch.dict(os.environ, {}, clear=False)


def test_local_manual_run_never_jitters_by_default():
    with mock.patch.dict(os.environ, {"GITHUB_ACTIONS": ""}, clear=False), \
         mock.patch.object(wasalt.time, "sleep") as sleep_mock:
        assert wasalt._jitter_max_s() == 0.0
        delay = wasalt.startup_jitter()
    assert delay == 0.0
    sleep_mock.assert_not_called()


def test_github_actions_defaults_to_60s_cap():
    with mock.patch.dict(os.environ, {"GITHUB_ACTIONS": "true"}, clear=False):
        assert wasalt._jitter_max_s() == 60.0


def test_github_actions_run_jitters_within_the_cap():
    with mock.patch.dict(os.environ, {"GITHUB_ACTIONS": "true"}, clear=False), \
         mock.patch.object(wasalt.random, "uniform", return_value=12.5) as uniform_mock, \
         mock.patch.object(wasalt.time, "sleep") as sleep_mock:
        delay = wasalt.startup_jitter()
    assert delay == 12.5
    uniform_mock.assert_called_once_with(0, 60.0)
    sleep_mock.assert_called_once_with(12.5)


def test_explicit_env_override_wins_over_github_actions_default():
    with mock.patch.dict(os.environ, {"GITHUB_ACTIONS": "true", "WASALT_STARTUP_JITTER_MAX_S": "5"}, clear=False):
        assert wasalt._jitter_max_s() == 5.0


def test_zero_override_disables_jitter_even_in_actions():
    with mock.patch.dict(os.environ, {"GITHUB_ACTIONS": "true", "WASALT_STARTUP_JITTER_MAX_S": "0"}, clear=False), \
         mock.patch.object(wasalt.time, "sleep") as sleep_mock:
        assert wasalt.startup_jitter() == 0.0
    sleep_mock.assert_not_called()


def test_malformed_env_value_degrades_to_no_jitter_never_crashes():
    with mock.patch.dict(os.environ, {"WASALT_STARTUP_JITTER_MAX_S": "not-a-number"}, clear=False):
        assert wasalt._jitter_max_s() == 0.0


def test_main_calls_startup_jitter_before_any_network_or_db_work():
    """Structural guard: startup_jitter() must run before session()/db.begin_run() in main()'s
    source, so the delay actually happens before this job opens its proxy connection — jittering
    after the fact defeats the whole point."""
    import inspect
    src = inspect.getsource(wasalt.main)
    assert src.index("startup_jitter()") < src.index("session()")
    assert src.index("startup_jitter()") < src.index("db.begin_run(")


if __name__ == "__main__":
    test_local_manual_run_never_jitters_by_default()
    test_github_actions_defaults_to_60s_cap()
    test_github_actions_run_jitters_within_the_cap()
    test_explicit_env_override_wins_over_github_actions_default()
    test_zero_override_disables_jitter_even_in_actions()
    test_malformed_env_value_degrades_to_no_jitter_never_crashes()
    test_main_calls_startup_jitter_before_any_network_or_db_work()
    print("OK — wasalt startup-jitter regression tests pass")
