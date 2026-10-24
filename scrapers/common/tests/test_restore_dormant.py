"""A dormant platform comes back only on a good crawl from THIS workflow run (restore_dormant.py)."""
from datetime import datetime

from scrapers.common.restore_dormant import is_back

SINCE = datetime.fromisoformat("2026-09-27T04:22:01Z")  # GitHub's run_started_at shape


def run(started_at="2026-09-27T04:49:36.619905+00:00", ok=True, rows_upserted=12):
    return {"started_at": started_at, "ok": ok, "rows_upserted": rows_upserted}  # PostgREST shape


def test_good_crawl_in_this_run_brings_it_back():
    assert is_back(run(), SINCE)


def test_failed_crawl_keeps_it_down():  # therc 2026-09-27: HTTP 500 everywhere, ok=false
    assert not is_back(run(ok=False, rows_upserted=0), SINCE)
    # a partial capture is demoted to ok=false even though it wrote some rows
    assert not is_back(run(ok=False, rows_upserted=40), SINCE)


def test_ok_but_empty_crawl_keeps_it_down():
    assert not is_back(run(rows_upserted=0), SINCE)
    assert not is_back(run(rows_upserted=None), SINCE)


def test_good_crawl_from_before_this_run_never_brings_it_back():
    # a crawl that succeeded BEFORE the site was put down must not undo the down decision
    assert not is_back(run(started_at="2026-09-26T04:49:36+00:00"), SINCE)


def test_start_times_are_compared_as_time_not_text():
    # as text, "04:22:01.5+00:00" < "04:22:01Z" ('.' sorts before 'Z'); as time it is later
    assert is_back(run(started_at="2026-09-27T04:22:01.5+00:00"), SINCE)
    # 07:00 Riyadh = 04:00 UTC, before this run started; as text "07" > "04"
    assert not is_back(run(started_at="2026-09-27T07:00:00+03:00"), SINCE)


def test_platform_never_crawled_stays_down():
    assert not is_back(None, SINCE)
