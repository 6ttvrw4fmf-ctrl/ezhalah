"""remal's list fetch must retry a transient network blip instead of ending the run on it.

THE INCIDENT (daily engineer, 2026-09-15, alert 3053 rows_collapse:remal): fetch_listings() made a
single unretried GET for its one REST page and treated `curl: (28) Connection timed out after 40002
milliseconds` as "the source is genuinely empty" — failing the whole run with 0 rows. This happened
on 4 of the last 6 daily cron runs (09-10, 09-13, 09-14, 09-15), while every recovering run reads
back the same stable 87-post catalogue, so the source never actually shrank. Mirrors sadin's
_fetch_page() retry fix (test_sadin_list_fetch_failure_reason.py, 2026-09-12) for the same shape.

Run: python -m pytest scrapers/remal/test_list_fetch_retry.py -v
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

from scrapers.remal import run as rm  # noqa: E402


class _Resp:
    def __init__(self, status_code=200, body=None):
        self.status_code = status_code
        self._body = body if body is not None else []

    def json(self):
        return self._body


class _Session:
    """Either one scripted response/exception repeated every call, or a `sequence=[...]` consumed
    one per call and held at the last item once exhausted."""

    def __init__(self, resp=None, raise_exc=None, sequence=None):
        self._resp = resp
        self._raise = raise_exc
        self._sequence = list(sequence) if sequence is not None else None
        self.calls = 0

    def get(self, url, **kw):
        self.calls += 1
        if self._sequence is not None:
            item = self._sequence[min(self.calls, len(self._sequence)) - 1]
            if isinstance(item, Exception):
                raise item
            return item
        if self._raise is not None:
            raise self._raise
        return self._resp


def _no_delay(monkeypatch):
    monkeypatch.setattr(rm.time, "sleep", lambda *_a, **_k: None)


# ── THE REAL INCIDENT: a transport timeout on attempt 1 must be retried, not final ────────────────
def test_connection_timeout_retries_and_recovers(monkeypatch):
    _no_delay(monkeypatch)
    posts = [{"id": 1, "link": "https://www.remalre.com/x/", "slug": "x", "class_list": []}]
    s = _Session(sequence=[TimeoutError("Connection timed out after 40002 milliseconds"),
                            _Resp(200, posts)])
    out = rm.fetch_listings(s)
    assert out == posts, "a transient timeout must be retried, not treated as an empty source"
    assert rm.LAST_FETCH_NOTE == "no pages attempted", "a recovered fetch must not carry a stale failure note"


def test_connection_timeout_exhausts_retries_and_names_the_reason(monkeypatch):
    _no_delay(monkeypatch)
    s = _Session(raise_exc=TimeoutError("Connection timed out after 40002 milliseconds"))
    out = rm.fetch_listings(s)
    assert out == []
    assert "TimeoutError" in rm.LAST_FETCH_NOTE, rm.LAST_FETCH_NOTE
    assert s.calls == rm.LIST_FETCH_ATTEMPTS, "retries must be bounded, not open-ended"


def test_transient_503_is_retried(monkeypatch):
    _no_delay(monkeypatch)
    posts = [{"id": 1, "link": "https://www.remalre.com/x/", "slug": "x", "class_list": []}]
    s = _Session(sequence=[_Resp(503), _Resp(200, posts)])
    out = rm.fetch_listings(s)
    assert out == posts
    assert s.calls == 2


def test_permanent_404_is_not_retried(monkeypatch):
    _no_delay(monkeypatch)
    s = _Session(resp=_Resp(404))
    out = rm.fetch_listings(s)
    assert out == []
    assert s.calls == 1, "a non-transient status must fail fast, not spend the retry budget on it"
    assert "HTTP 404" in rm.LAST_FETCH_NOTE


def test_retry_budget_is_bounded():
    assert 2 <= rm.LIST_FETCH_ATTEMPTS <= 6


print("ok: remal list fetch retries a transient timeout/5xx and recovers, "
      "fails fast on a permanent status, and bounds its retry budget")
