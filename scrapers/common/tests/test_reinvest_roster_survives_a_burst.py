"""ري إنفست: one HTTP 500 or one stalled request on the roster must not throw the night away.

2026-10-01 04:30 «Operation timed out after 60000 milliseconds» and 2026-10-07 04:31 «page 1 returned
500» each failed the whole crawl on its FIRST request; the early-warning re-crawl at 04:58 read all
891 rows. `_json()` retried only gateway statuses (500 is not one), with no pause, and let a
transport error escape on the first try. These run `_json()` itself against a stub session.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.reinvest import run as R  # noqa: E402


class _Resp:
    def __init__(self, status: int, body=None):
        self.status_code = status
        self._body = body if body is not None else {"data": [], "links": {}}

    def json(self):
        return self._body


class _Stub:
    """Answers from a script: an int is a status, an Exception is raised (timeout / reset)."""

    def __init__(self, script):
        self.script, self.calls = list(script), 0

    def get(self, url, timeout=None):
        self.calls += 1
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return _Resp(step)


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    monkeypatch.setattr(R.time, "sleep", lambda _s: None)


def test_a_500_burst_is_retried():                      # 10-07 shape
    s = _Stub([500, 500, 200])
    assert R._json(s, "u", what="roster page 1") == {"data": [], "links": {}}
    assert s.calls == 3


def test_a_stalled_request_is_retried():                # 10-01 shape
    s = _Stub([TimeoutError("Operation timed out after 60000 milliseconds"), 200])
    assert R._json(s, "u", what="roster page 1") == {"data": [], "links": {}}
    assert s.calls == 2


def test_a_4xx_is_believed_at_once():
    s = _Stub([404, 200])
    with pytest.raises(RuntimeError, match="returned 404"):
        R._json(s, "u", what="roster page 1")
    assert s.calls == 1


def test_a_source_that_stays_down_still_fails_loudly():
    s = _Stub([500] * R._JSON_ATTEMPTS)
    with pytest.raises(RuntimeError, match="roster page 1 returned 500"):
        R._json(s, "u", what="roster page 1")
    assert s.calls == R._JSON_ATTEMPTS


def test_transport_errors_to_the_end_name_the_error():
    s = _Stub([ConnectionError("reset")] * R._JSON_ATTEMPTS)
    with pytest.raises(RuntimeError, match="no response .*reset"):
        R._json(s, "u", what="roster page 1")


class _ByPageSize:
    """The big one-page roster answers 500 on every try; pages of 100 answer (10-08 04:32–05:20)."""

    def __init__(self):
        self.urls: list[str] = []

    def get(self, url, timeout=None):
        self.urls.append(url)
        if "per_page=1000" in url:
            return _Resp(500)
        assert "per_page=100" in url, url        # the page size must survive every page
        page = int(url.rsplit("page=", 1)[1])
        # the live endpoint's links.next DROPS per_page (10-08), so following it verbatim reads
        # page 2 at the default size and stops on repeats
        nxt = f"{R.API}?page={page + 1}" if page < 2 else None
        return _Resp(200, {"data": [{"slug": f"ad-{page}-{i}"} for i in range(100 if page < 2 else 3)],
                           "links": {"next": nxt}})


def test_a_roster_whose_big_page_keeps_failing_is_walked_in_small_pages():
    s = _ByPageSize()
    rows = R.fetch_roster(s)
    assert len(rows) == 103 and {"ad-2-0", "ad-2-2"} <= {r["slug"] for r in rows}
    assert any("per_page=100&page=2" in u for u in s.urls)
