"""The wasalt enrichers' proxy-spend breaker must COUNT, and its cap is 15,000 (owner, 2026-10-05).

Until 2026-10-06 both breakers counted with head=True, which reads 0 on the pinned client, so the
max_pending guard could never fire (scrape_runs rows_seen = 0 on every run while 13,133 rows were
pending). The owner's decision: count correctly and cap at 15,000 a day — a SAFETY cap against a
runaway re-crawl, not a throttle on ordinary new rows. These tests execute enrich_table() against a
stub client and the real postgrest response parser.

Run: python -m pytest scrapers/common/tests/test_wasalt_enrich_breaker_counts_2026_10_06.py -v
"""
from __future__ import annotations

import httpx
import pytest
from postgrest.base_request_builder import APIResponse

import scrapers.wasalt.enrich as EN
import scrapers.wasalt.enrich_ar as EAR


def _api(count: int | None, head: bool) -> APIResponse:
    req = httpx.Request("HEAD" if head else "GET", "https://x.supabase.co/rest/v1/t", headers={"prefer": "count=exact"})
    hdrs = {"content-range": f"0-0/{count}"} if count is not None else {}
    return APIResponse.from_http_request_response(httpx.Response(200, request=req, content=b"" if head else b"[]", headers=hdrs))


class _Q:
    def __init__(self, pending, log):
        self.pending, self.log, self.head = pending, log, False

    def select(self, *a, count=None, head=False, **k):
        self.head = head
        self.log.append(("select", a, count, head))
        return self

    def eq(self, *a): return self
    def like(self, *a): return self
    def order(self, *a, **k): return self
    def is_(self, *a): return self
    def lt(self, *a): return self
    def lte(self, *a): return self
    def gte(self, *a): return self
    def not_(self): return self

    def limit(self, n):
        self.log.append(("limit", n))
        return self

    def execute(self):
        if any(e[0] == "limit" and e[1] != 1 for e in self.log):   # the row fetch after the breaker
            raise _Proceeded()
        return _api(self.pending, self.head)


class _Proceeded(Exception):
    """The breaker let the run go on to fetch rows."""


class _C:
    def __init__(self, pending):
        self.pending, self.log = pending, []

    def table(self, _t):
        return _Q(self.pending, self.log)


@pytest.fixture(autouse=True)
def _no_catalog(monkeypatch):
    monkeypatch.setattr(EAR, "_load_catalog", lambda: None, raising=False)
    monkeypatch.setattr(EAR, "_browser_fetch_enabled", lambda: False, raising=False)


@pytest.mark.parametrize("mod,table", [(EAR, "wasalt_residential_listings"), (EN, "wasalt_residential_listings")])
def test_cap_trips_at_15001(monkeypatch, mod, table):
    monkeypatch.setattr(mod.db, "sb", lambda: _C(15001))
    out = mod.enrich_table(table, limit=10, workers=1)
    assert out["aborted"] == 15001


@pytest.mark.parametrize("mod,table", [(EAR, "wasalt_residential_listings"), (EN, "wasalt_residential_listings")])
def test_cap_does_not_trip_on_13133(monkeypatch, mod, table):
    monkeypatch.setattr(mod.db, "sb", lambda: _C(13133))
    with pytest.raises(_Proceeded):
        mod.enrich_table(table, limit=10, workers=1)


@pytest.mark.parametrize("mod", [EAR, EN])
def test_unreadable_count_stops_before_any_proxy_fetch(monkeypatch, mod):
    monkeypatch.setattr(mod.db, "sb", lambda: _C(None))
    with pytest.raises(RuntimeError, match="unreadable"):
        mod.enrich_table("wasalt_residential_listings", limit=10, workers=1)


def test_default_cap_is_the_owners_15000():
    assert EAR.MAX_PENDING_DEFAULT == EN.MAX_PENDING_DEFAULT == 15000
