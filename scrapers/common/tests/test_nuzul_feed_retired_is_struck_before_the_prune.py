"""Backlog 923 (2026-10-27): a Nuzul tenant's own feed marking a stored ad «rented» removes it.

yameen 2026-10-25 → 10-27: the API answered 28 items every run, 4 of the 10 active stored rows had
turned «rented» in it, the crawl skipped them, prune_unseen's collapse guard read «re-saw 6 of 10»,
refused the prune and demoted every run (P0 silent_scraper_death) while the four stayed on screen.
strike_feed_retired strikes ONLY ads the feed itself retired, through the canaried per-id oracle, at
grace 1 (owner 2026-10-20 «once we see it, remove it»), before the absence prune. Mutation-checked:
dropping the call from main() or the feed filter turns this red.
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.goldendeal import run as ENGINE  # noqa: E402
from scrapers.yameen import run as R  # noqa: E402


def _item(pid: int, status: str) -> dict:
    return {"id": pid, "availability_status": status, "published_on_website": 1}


def test_only_feed_retired_ads_reach_the_oracle_and_strike_at_grace_one(monkeypatch):
    seen_calls: list = []

    def fake_strike(table, seen, source, verify_gone=None, **kw):
        verdicts = {ad: verify_gone(ad)[0] for ad in ("YMN1", "YMN2", "YMN3", "YMN9")}
        seen_calls.append((table, sorted(seen), source, kw, verdicts))
        return 2
    monkeypatch.setattr(ENGINE.db, "strike_read_gone", fake_strike)
    asked: list = []
    verify = lambda ad: (asked.append(ad), ("gone", "record says rented"))[1]
    items = [_item(1, "rented"), _item(2, "unavailable"), _item(3, "available"), _item(4, "sold")]
    n = ENGINE.strike_feed_retired("yameen_residential_listings", [{"ad_number": "YMN3"}], items,
                                   R.TENANT, verify)
    assert n == 2
    table, seen, source, kw, verdicts = seen_calls[0]
    assert (table, seen, source, kw) == ("yameen_residential_listings", ["YMN3"], "يمين العقارية", {"grace": 1})
    # YMN3 is available and YMN9 is not in the feed at all: neither may be struck by this path.
    assert verdicts == {"YMN1": "gone", "YMN2": "gone", "YMN3": "unknown", "YMN9": "unknown"}
    assert asked == ["YMN1", "YMN2"]


def test_no_retired_item_means_no_reading_and_a_failed_reading_is_not_a_crash(monkeypatch):
    monkeypatch.setattr(ENGINE.db, "strike_read_gone", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("db down")))
    assert ENGINE.strike_feed_retired("t", [{"ad_number": "YMN3"}], [_item(3, "available")], R.TENANT,
                                      lambda ad: ("gone", "")) == 0
    assert ENGINE.strike_feed_retired("t", [{"ad_number": "YMN3"}], [_item(1, "rented")], R.TENANT,
                                      lambda ad: ("gone", "")) == 0     # raised → logged, 0


def test_main_strikes_the_feed_retired_before_the_absence_prune(monkeypatch):
    order: list = []
    items = [{**_item(1, "rented")}, {**_item(3, "available")}]
    monkeypatch.setattr(R, "crawl", lambda s, tenant, limit=0, mapper=None: (
        items, 2, [{"ad_number": "YMN3"}], [], {"status_rented": 1}))
    monkeypatch.setattr(R, "session", lambda: object())
    monkeypatch.setattr(R.db, "begin_run", lambda platform: 5)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda table, rows: None)
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(R, "strike_feed_retired", lambda table, rows, its, tenant, verify: order.append(("strike", table)) or 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda table, seen, source, **kw: order.append(("prune", table)) or 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **kw: True)
    assert R.main([]) == 0
    assert order == [("strike", R.RES_TABLE), ("prune", R.RES_TABLE),
                     ("strike", R.COM_TABLE), ("prune", R.COM_TABLE)]


# ── the listing's OWN page (yameen 45194: API «available», www.yameen.sa/properties/45194 → 404) ──
class _R:
    def __init__(self, status, url, body=None):
        self.status_code, self.url = status, url
        self.text = json.dumps(body) if body is not None else '{"message": "No query results"}'
        self.headers = {"content-type": "application/json"}

    def json(self):
        return json.loads(self.text)


def _sf(web: dict[int, int]):
    def get(url, timeout=None, allow_redirects=True, **_):
        pid = int(url.rstrip("/").rsplit("/", 1)[1])
        if url.startswith(R.TENANT.base):
            return _R(web.get(pid, 200), url)
        return _R(200, url, {"data": {"id": pid, "availability_status": "available", "published_on_website": 1}})
    return lambda: types.SimpleNamespace(get=get)


def test_an_api_live_listing_whose_own_page_is_404_reads_gone_only_behind_a_live_web_control():
    sf = _sf({45194: 404})
    canary = lambda: (True, "control ok")
    verify = ENGINE.verify_gone_for(R.TENANT, canary, sf, web_control=54413)
    assert verify("YMN45194")[0] == "gone"
    assert verify("YMN54413")[0] == "live"
    # no web control → the API verdict stands (pre-fix behaviour, never a kill from the page alone)
    assert ENGINE.verify_gone_for(R.TENANT, canary, sf)("YMN45194")[0] == "live"
    # the control's own page not answering 200 → the page is not trusted
    dark = _sf({45194: 404, 54413: 503})
    assert ENGINE.verify_gone_for(R.TENANT, canary, dark, web_control=54413)("YMN45194")[0] == "live"


def test_a_refused_prune_still_reads_the_unseen_rows(monkeypatch):
    calls = []
    monkeypatch.setattr(R, "crawl", lambda s, tenant, limit=0, mapper=None: (
        [_item(3, "available")], 1, [{"ad_number": "YMN3"}], [], {}))
    monkeypatch.setattr(R, "session", lambda: object())
    monkeypatch.setattr(R.db, "begin_run", lambda platform: 5)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda table, rows: None)
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda table, seen, source, **kw: -1)
    monkeypatch.setattr(R, "read_unseen_after_refused_prune", lambda table, rows, tenant, verify: calls.append(table) or 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **kw: True)
    assert R.main([]) == 0
    assert calls == [R.RES_TABLE, R.COM_TABLE]
