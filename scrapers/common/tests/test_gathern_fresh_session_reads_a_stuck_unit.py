"""A Gathern unit the sweep's long session leaves with no verdict is read once under a fresh session.

2026-11-02 (♻️, backlog 1147/1148): 178 served units sat past 26 h because the hourly sweep's one
long-lived session was sent home for them every hour (transient). lifecycle-spot-check 41434405092
read 43 of them from a FRESH session (same gl.probe, controls 5/5 live): 33 answered 404, 8 opened.
These tests EXECUTE fresh_read() against stub sessions.
"""
import sys
import types

sys.path.insert(0, ".")
for _n in ("supabase", "dotenv"):
    sys.modules.setdefault(_n, types.ModuleType(_n))
sys.modules["supabase"].Client = object
sys.modules["supabase"].create_client = lambda *a, **k: None
sys.modules["dotenv"].load_dotenv = lambda *a, **k: None

from scrapers.gathern import liveness as gl  # noqa: E402

UNIT = "https://gathern.co/view/125434/unit/176594"


def _factory(status, made):
    def make():
        made.append(1)
        return "fresh-session"
    return make


def test_a_no_verdict_read_takes_the_fresh_sessions_own_answer(monkeypatch):
    for answer in (404, 410, 200):
        made: list = []
        monkeypatch.setattr(gl, "probe", lambda s, url, **k: answer if s == "fresh-session" else 0)
        assert gl.fresh_read(0, UNIT, _factory(answer, made)) == answer
        assert gl.fresh_read(gl.HOME_LANDED, UNIT, _factory(answer, made)) == answer
        assert len(made) == 2, "one brand-new session per stuck unit"


def test_a_fresh_session_that_also_gets_no_answer_stays_no_verdict(monkeypatch):
    for answer in (0, 403, 429, 503, 307):
        monkeypatch.setattr(gl, "probe", lambda s, url, **k: answer)
        assert gl.fresh_read(0, UNIT, _factory(answer, [])) == 0
        assert gl.fresh_read(gl.HOME_LANDED, UNIT, _factory(answer, [])) == gl.HOME_LANDED


def test_a_verdict_the_run_already_reached_is_never_re_read(monkeypatch):
    made: list = []
    monkeypatch.setattr(gl, "probe", lambda s, url, **k: 404)
    for status in (200, 404, 410):
        assert gl.fresh_read(status, UNIT, _factory(404, made)) == status
    assert made == [], "no extra request for a unit that already has an answer"


def test_the_sweep_loop_calls_it_only_after_every_other_reader():
    src = open("scrapers/gathern/liveness.py", encoding="utf-8").read()
    i = src.index("status = fingerprint_read(fallback_read(probe(s, url), fb, url), alt, url)")
    assert "status = fresh_read(status, url)" in src[i:i + 300]
    assert "fresh_reread=" in src
