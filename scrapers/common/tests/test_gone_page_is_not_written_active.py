"""An ad whose OWN page answered 404/410 in this run is never written active (2026-10-02).

Crawler audit 2026-10-02 (scrapers/lifecycle-gaps.txt): abralosol, arkaan and aqaratikom mapped and
upserted an ad from its index/list card even when its own page had just said gone, so the row was
refreshed (and, on a list-presence tier, would be stamped verified) against the source's own
answer. These tests EXECUTE each crawler's decision with stubbed fetches. A 404/410 drops the ad;
no answer (UNKNOWN) keeps the old behaviour, because one unreadable page must never start a removal.
"""
from __future__ import annotations

import scrapers.abralosol.run as AB
import scrapers.aqaratikom.run as AQ
import scrapers.arkaan.run as AR


# ── arkaan ──────────────────────────────────────────────────────────────────────────────────────
def _arkaan(monkeypatch, statuses):
    items = [{"id": str(i)} for i in range(len(statuses))]
    monkeypatch.setattr(AR, "_session", lambda: object())
    monkeypatch.setattr(AR, "crawl_index", lambda s, limit=0: items)
    monkeypatch.setattr(AR, "fetch_detail", lambda s, pid: {"http_status": statuses[int(pid)]})
    monkeypatch.setattr(AR, "map_listing", lambda item, d: ({"ad_number": "AK" + item["id"]}, "residential"))
    res, com, n = AR.crawl()
    return [r["ad_number"] for r in res]


def test_arkaan_gone_page_is_dropped(monkeypatch):
    assert _arkaan(monkeypatch, [200, 404, 410, 200]) == ["AK0", "AK3"]


def test_arkaan_unreadable_page_keeps_the_card(monkeypatch):
    assert _arkaan(monkeypatch, [200, None, 503]) == ["AK0", "AK1", "AK2"]


# ── abralosol ───────────────────────────────────────────────────────────────────────────────────
class _R:
    def __init__(self, code, text=""):
        self.status_code, self.text = code, text


class _S:
    def __init__(self, code):
        self.code = code

    def get(self, url):
        return _R(self.code)


def test_abralosol_detail_reports_gone_on_404_and_410(monkeypatch):
    monkeypatch.setattr(AB.time, "sleep", lambda *_: None)
    assert AB._detail(_S(404), "1") == {"gone": 404}
    assert AB._detail(_S(410), "1") == {"gone": 410}
    assert AB._detail(_S(503), "1") == {}            # unreadable: UNKNOWN, not gone


def test_abralosol_crawl_drops_a_gone_ad(monkeypatch):
    monkeypatch.setattr(AB.time, "sleep", lambda *_: None)
    monkeypatch.setattr(AB, "_session", lambda: object())
    pages = {0: "p0"}
    monkeypatch.setattr(AB, "_get", lambda s, url, tries=3: pages.get(int(url.rsplit("=", 1)[1])))
    monkeypatch.setattr(AB, "_index_rows", lambda html: [{"nid": "1"}, {"nid": "2"}, {"nid": "3"}] if html else [])
    monkeypatch.setattr(AB, "_parse_index", lambda rec: {"nid": rec["nid"], "title_lines": [], "price": {"amount": None}})
    details = {"1": {"title": "x"}, "2": {"gone": 404}, "3": {}}
    monkeypatch.setattr(AB, "_detail", lambda s, nid: details[nid])
    monkeypatch.setattr(AB, "map_listing", lambda ix, d: (
        {"ad_number": "AB" + ix["nid"], "price_total": 1, "price_annual": None,
         "price_per_meter": None, "additional_info": {"price_basis": "x"}}, "residential"))
    res, com, n, stats = AB.crawl()
    assert [r["ad_number"] for r in res] == ["AB1", "AB3"]
    assert stats["detail_gone"] == 1 and stats["detail_failed"] == 1


# ── aqaratikom ──────────────────────────────────────────────────────────────────────────────────
def test_aqaratikom_gone_record_is_not_mapped(monkeypatch):
    monkeypatch.setattr(AQ, "map_listing", lambda ad, d: ({"ad_number": "AQ"}, "residential", False))
    assert AQ.row_for({"id": 1}, "gone", None) is None
    assert AQ.row_for({"id": 1}, "missing", None) == ({"ad_number": "AQ"}, "residential", False)
    assert AQ.row_for({"id": 1}, "ok", {"x": 1}) == ({"ad_number": "AQ"}, "residential", False)
