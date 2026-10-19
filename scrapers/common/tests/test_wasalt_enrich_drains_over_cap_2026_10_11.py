"""Over the 15,000 cap the wasalt DETAIL enricher drains a bounded batch, newest first (owner 2026-10-10).

From 2026-10-08 every run refused (27,119 pending > 15,000) and the backlog only grew: 0 of ~8,000
new residential rows got facade / meters / street width (backlog 338/228). The owner: «fix the root —
drain in batches under the cap». A run over the cap must fetch at most DRAIN_BATCH rows (the spend
bound), newest first, and must never refuse.

Run: python -m pytest scrapers/common/tests/test_wasalt_enrich_drains_over_cap_2026_10_11.py -v
"""
from __future__ import annotations

import scrapers.wasalt.enrich as EN

from scrapers.common.tests.test_wasalt_enrich_breaker_counts_2026_10_06 import _C, _Proceeded

import pytest




def _run(monkeypatch, pending, limit):
    client = _C(pending)
    monkeypatch.setattr(EN.db, "sb", lambda: client)
    orders = []
    import scrapers.common.tests.test_wasalt_enrich_breaker_counts_2026_10_06 as B
    real_order = B._Q.order
    def order(self, *a, **k):
        orders.append((a, k))
        return real_order(self, *a, **k)
    monkeypatch.setattr(B._Q, "order", order)
    with pytest.raises(_Proceeded):          # it went on to fetch rows: no refusal
        EN.enrich_table("wasalt_residential_listings", limit=limit, workers=1)
    fetch_limits = [e[1] for e in client.log if e[0] == "limit" and e[1] != 1]
    return fetch_limits, orders


def test_27119_pending_drains_instead_of_refusing(monkeypatch):
    limits, orders = _run(monkeypatch, 27119, 2000)
    assert limits == [2000]
    assert orders[0] == (("scraped_at",), {"desc": True}), "over the cap, today's arrivals go first"


def test_drain_batch_bounds_the_spend_even_with_a_huge_limit(monkeypatch):
    limits, _ = _run(monkeypatch, 57000, 50000)
    assert limits == [EN.DRAIN_BATCH] and EN.DRAIN_BATCH <= EN.MAX_PENDING_DEFAULT


def test_under_the_cap_keeps_the_fair_queue(monkeypatch):
    limits, orders = _run(monkeypatch, 13133, 800)
    assert limits == [800]
    assert orders[0][0] == ("enrich_attempted_at",)
