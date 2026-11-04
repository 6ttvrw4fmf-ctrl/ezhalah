"""Manzo's walk reads every page the API says exists, not just the first 49 (crawl-health 2026-11-04).

Measured 2026-11-04: the search API answered total_count 982, page_size 20, total_pages 50. The walk was
`for page in range(1, 50)`, so page 50 was never read, the walk stayed short of the declared total, `complete`
was false on every run and the absence prune never ran (alert zero_new_stall:manzo). Also pins that a failed
detail read says WHY (status / exception) instead of a bare count.

Run: python -m pytest scrapers/common/tests/test_manzo_walk_follows_the_source_pagination.py -v
"""
from __future__ import annotations

import re

from scrapers.manzo import run


def _api(total: int, page_size: int = 20):
    pages = -(-total // page_size)

    def fetch(_s, url):
        page = int(re.search(r"page=(\d+)", url).group(1))
        start = (page - 1) * page_size
        results = [{"slug": f"s{i}"} for i in range(start, min(start + page_size, total))]
        return {"results": results,
                "pagination": {"total_count": total, "page": page, "total_pages": pages,
                               "has_next": page < pages}}
    return fetch


def test_the_measured_982_catalogue_is_walked_whole():
    rows, declared = run.walk(None, fetch=_api(982))
    assert declared == 982
    assert len(rows) == 982            # range(1, 50) stopped at 980


def test_a_small_catalogue_still_stops_on_the_last_page():
    calls = []
    f = _api(45)

    def counting(s, url):
        calls.append(url)
        return f(s, url)
    rows, declared = run.walk(None, fetch=counting)
    assert len(rows) == 45 and declared == 45 and len(calls) == 3


def test_an_unreadable_record_says_why():
    run.UNREADABLE_WHY.clear()

    class _Resp:
        status_code = 429

    class _HTTPError(Exception):
        response = _Resp()

    def fetch(_s, url):
        if url.endswith("/bad/"):
            raise _HTTPError("429")
        if url.endswith("/slow/"):
            raise TimeoutError("read timed out")
        return {"data": {"ok": True}}

    out = run.read_details(object(), [{"slug": "good"}, {"slug": "bad"}, {"slug": "slow"}], fetch=fetch)
    assert out[0] == {"ok": True} and out[1] is None and out[2] is None
    assert run.UNREADABLE_WHY == {"http_429": 1, "TimeoutError": 1}
    assert "http_429=1" in run.unreadable_summary()
