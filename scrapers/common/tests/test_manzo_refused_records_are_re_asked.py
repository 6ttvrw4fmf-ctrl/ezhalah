"""manzo: a record the API refused with HTTP 429 is re-asked one at a time before the walk is called incomplete.

Measured 2026-11-06 05:19: 300 of 1,279 detail records answered 429 with five workers, the job used 13 of its 30
minutes, `complete` stayed false and the absence prune never ran (alert run_killed_by_timeout:manzo).
"""
from __future__ import annotations

from scrapers.manzo import run as R


class _E(Exception):
    def __init__(self, code, retry_after=None):
        class Resp:
            status_code = code
            headers = {"Retry-After": retry_after} if retry_after else {}
        self.response = Resp()


def _listing(n):
    return [{"slug": f"s{i}"} for i in range(n)]


def test_refused_records_are_recovered_on_a_slow_second_pass():
    calls = {}

    def fetch(_s, url):
        calls[url] = calls.get(url, 0) + 1
        if calls[url] == 1:
            raise _E(429, "7")              # refused once, answers on the retry
        return {"data": {"u": url}}
    slept = []
    out = R.retry_refused(None, _listing(3), [{"x": 1}, None, None], fetch=fetch, sleep=slept.append)
    assert all(d is not None for d in out)
    assert 7.0 in slept                      # the API's own Retry-After was honoured
    assert R.unreadable_summary() == ""


def test_a_record_still_refused_stays_unreadable_with_its_reason():
    def fetch(_s, _url):
        raise _E(429)
    out = R.retry_refused(None, _listing(2), [None, {"x": 1}], fetch=fetch, sleep=lambda _x: None)
    assert out[0] is None and out[1] == {"x": 1}
    assert R.unreadable_summary() == "http_429=1"


def test_the_pass_stops_inside_the_slot():
    t = iter([0, 0, R.RETRY_BUDGET_S + 1, R.RETRY_BUDGET_S + 2, R.RETRY_BUDGET_S + 3])

    def fetch(_s, _url):
        return {"data": {}}
    out = R.retry_refused(None, _listing(3), [None, None, None], fetch=fetch,
                          clock=lambda: next(t), sleep=lambda _x: None)
    assert out[0] is not None and out[1] is None and out[2] is None
    assert R.unreadable_summary() == "retry_budget=2"


def test_nothing_refused_means_no_second_pass():
    def fetch(_s, _url):
        raise AssertionError("must not be called")
    assert R.retry_refused(None, _listing(1), [{"x": 1}], fetch=fetch) == [{"x": 1}]


def test_read_details_runs_the_second_pass(monkeypatch):
    monkeypatch.setattr(R, "RETRY_PAUSE_S", 0.0)
    calls = {}

    def fetch(_s, url):
        calls[url] = calls.get(url, 0) + 1
        if calls[url] == 1:
            raise _E(503)                    # the pool's read fails, the slow pass reads it
        return {"data": {"u": url}}
    out = R.read_details(None, _listing(2), fetch=fetch)
    assert all(d is not None for d in out)
