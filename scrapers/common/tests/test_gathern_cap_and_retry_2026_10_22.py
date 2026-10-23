"""Gathern crawl: a city still serving units at the page cap is INCOMPLETE, and a refused city gets one
more try (2026-10-22). Riyadh read exactly 400 pages every night (the old cap) with units still coming,
and the same small cities were refused night after night; both cut coverage without a red line.
"""
from scrapers.gathern import run as G


def _unit(i):
    return {"unit_id": i}


def _install(monkeypatch, pages_by_city, refuse_first=()):
    calls = {"n": 0, "refused": set()}

    def fake_fetch(s, cid, page, ci, co):
        calls["n"] += 1
        if cid in refuse_first and cid not in calls["refused"]:
            calls["refused"].add(cid)
            return [], {}, "exhausted"
        n = pages_by_city.get(cid, 0)
        if page > n:
            return [], {"totalCount": n * 12}, "empty"
        return [_unit(cid * 100000 + page * 12 + k) for k in range(12)], {"totalCount": n * 12}, "ok"

    monkeypatch.setattr(G, "fetch_page", fake_fetch)
    monkeypatch.setattr(G, "map_listing", lambda it: {"ad_number": str(it["unit_id"])})
    monkeypatch.setattr(G.time, "sleep", lambda s: None)
    return calls


def test_a_city_still_serving_at_the_cap_is_incomplete(monkeypatch):
    _install(monkeypatch, {3: 10})
    monkeypatch.setattr(G, "HARD_PAGE_CAP", 5)
    rows, scanned, per_city, out = G.crawl(None, [{"id": 3, "name_en": "Riyadh"}], "a", "b", verbose=False)
    assert out.get("reason:cap") == 1 and out.get("incomplete") == 1
    assert len(rows) == 5 * 12


def test_a_city_that_ends_before_the_cap_is_complete(monkeypatch):
    _install(monkeypatch, {3: 4})
    rows, scanned, per_city, out = G.crawl(None, [{"id": 3, "name_en": "Riyadh"}], "a", "b", verbose=False)
    assert out.get("ok") == 1 and not out.get("incomplete") and not out.get("reason:cap")
    assert len(rows) == 4 * 12


def test_a_refused_city_is_crawled_on_the_second_try(monkeypatch):
    _install(monkeypatch, {3: 2, 3417: 3}, refuse_first={3417})
    rows, scanned, per_city, out = G.crawl(None, [{"id": 3, "name_en": "Riyadh"}, {"id": 3417, "name_en": "Najran"}],
                                          "a", "b", verbose=False, cooldown_s=0)
    assert out.get("recovered_on_retry") == 1 and out.get("failed") == 0
    assert per_city.get("Najran") == 3 * 12 and len(rows) == (2 + 3) * 12
    assert out.get("failed_city_ids") == []


def test_a_city_refused_twice_stays_a_failure(monkeypatch):
    calls = _install(monkeypatch, {3: 2})

    def always_refuse(s, cid, page, ci, co):
        return [], {}, "exhausted"

    monkeypatch.setattr(G, "fetch_page", always_refuse)
    rows, scanned, per_city, out = G.crawl(None, [{"id": 9, "name_en": "Sakaka"}], "a", "b", verbose=False, cooldown_s=0)
    assert out.get("failed") == 1 and out.get("recovered_on_retry") == 0 and out.get("failed_city_ids") == [9]
