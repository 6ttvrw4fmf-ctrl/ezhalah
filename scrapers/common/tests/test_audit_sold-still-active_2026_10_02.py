"""Crawler audit 2026-10-02: an ad whose availability was NOT READ is never written as active.

awal and abeea both keep sold / rented ads published (HTTP 200, still in the REST feed); the only
thing that separates them is a field on the ad's own page. When that field was unread — the page
fetch failed (awal) or the page carried no «Property Status» cell (abeea) — the row was upserted
active=True, which un-hides a pinned sold ad. Each main() is run here end to end against synthetic
pages with every database call captured; both tests fail on the crawlers as they were on main.
"""
from __future__ import annotations

import sys

import pytest

import scrapers.abeea.run as abeea
import scrapers.awal.run as awal


class _Calls:
    def __init__(self):
        self.upserted: list[dict] = []
        self.pruned: list[set] = []
        self.pins: list[tuple] = []
        self.notes = ""


def _stub_db(monkeypatch, mod, site: str) -> _Calls:
    c = _Calls()
    monkeypatch.setattr(sys, "argv", ["run"])
    monkeypatch.setattr(mod.db, "begin_run", lambda platform: 1)
    for cat in ("residential", "commercial"):
        monkeypatch.setattr(mod.db, f"upsert_{site}_{cat}_batch", lambda rows: c.upserted.extend(rows))
    monkeypatch.setattr(mod.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(mod.db, "prune_unseen",
                        lambda table, seen, **kw: c.pruned.append(set(seen)) or 0)
    monkeypatch.setattr(mod, "_pin_sold_inactive", lambda *a: c.pins.append(a))

    def end_run(run_id, ok, **kw):
        c.notes = kw.get("notes", "")
        return True
    monkeypatch.setattr(mod.db, "end_run", end_run)
    return c


# ── awal ──────────────────────────────────────────────────────────────────────────────────────
def _awal_post(pid: int) -> dict:
    return {"id": pid, "link": f"https://awaalun.com/property/p{pid}/", "slug": f"p{pid}",
            "title": {"rendered": "أرض سكنية للبيع"}, "content": {"rendered": "مساحة 600م"},
            "class_list": ["rtcl_category-lands", "rtcl_location-arar"]}


def _awal_page(pid: int, extra: str = "") -> str:
    return (f'<article class="post-{pid} rtcl_listing status-publish listing-item '
            f'rtcl-listing-item is-sell{extra}"></article>')


def _awal_ad(pid: int) -> str:
    return awal.map_listing(_awal_post(pid), _awal_page(pid))[0]["ad_number"]


def test_awal_sold_flag_is_read_from_the_ads_own_element_only():
    assert awal.sold_state(_awal_page(1), 1) is False
    assert awal.sold_state(_awal_page(1, " is-sold"), 1) is True
    assert awal.sold_state(None, 1) is None                      # page not fetched
    assert awal.sold_state("<html>no listing element</html>", 1) is None
    # another ad's card on the page says nothing about this ad, in either direction
    assert awal.sold_state(_awal_page(2, " is-sold"), 1) is None
    assert awal.sold_state(_awal_page(2, " is-sold") + _awal_page(1), 1) is False


def test_awal_unread_page_is_not_upserted_and_not_struck(monkeypatch):
    c = _stub_db(monkeypatch, awal, "awal")
    pages = {1: _awal_page(1), 2: _awal_page(2, " is-sold"), 3: None,
             4: "<html>" + "x" * 3000 + "</html>"}                # 3: fetch failed, 4: no element
    posts = [_awal_post(i) for i in pages]
    monkeypatch.setattr(awal, "negotiate_list_session", lambda diag, **kw: object())
    monkeypatch.setattr(awal, "fetch_listings", lambda s, diag=None: posts)
    monkeypatch.setattr(awal, "fetch_detail",
                        lambda link: (pages[int(link.rstrip("/").rsplit("p", 1)[1])], link))

    assert awal.main() == 0

    written = {r["ad_number"]: r["active"] for r in c.upserted}
    assert written == {_awal_ad(1): True, _awal_ad(2): False}     # 3 and 4 are never written
    # the feed listed all four, so none is counted missing for a page WE failed to read
    assert c.pruned[0] == {_awal_ad(i) for i in pages}
    # ...but an unread ad is not handed to the pin as "seen on offer" either
    assert set(c.pins[0][2]) == {_awal_ad(1), _awal_ad(2)}
    assert "status_unread=2" in c.notes


# ── abeea ─────────────────────────────────────────────────────────────────────────────────────
def _abeea_page(pid: str, status: str | None) -> str:
    cell = f"<li><strong>Property Status</strong><span>{status}</span></li>" if status else ""
    return ('<script type="application/ld+json">{"@type":"House","name":"Villa For Sale In Test '
            'District","address":{"addressLocality":"Al Khobar"}}</script>'
            f'<div class="detail-wrap"><ul><li><strong>Property ID</strong><span>{pid}</span></li>'
            '<li><strong>Property Type</strong><span>Villa, Residential</span></li>'
            f'{cell}</ul></div>')


def _run_abeea(monkeypatch, pages: dict[str, str]) -> _Calls:
    c = _stub_db(monkeypatch, abeea, "abeea")
    monkeypatch.setattr(abeea, "session", lambda: object())
    monkeypatch.setattr(abeea, "discover_urls", lambda s: (list(pages), {}))
    monkeypatch.setattr(abeea, "fetch_details",
                        lambda urls, failed: ((pages[u], u) for u in urls))
    assert abeea.main() == 0
    return c


@pytest.mark.parametrize("status,gone", [("For Sale", False), ("For Rent, New Listing", False),
                                         ("For Sale, Sold", True), ("For Rent, Rented", True),
                                         (None, None)])
def test_abeea_status_is_three_valued(status, gone):
    assert abeea.map_listing(_abeea_page("ABRE9001", status), "https://abeea.com.sa/en/property/a/")[2] is gone


def test_abeea_page_without_status_cell_is_not_upserted_and_withholds_prune(monkeypatch):
    base = "https://abeea.com.sa/en/property/"
    c = _run_abeea(monkeypatch, {base + "a/": _abeea_page("ABRE9001", "For Sale"),
                                 base + "b/": _abeea_page("ABRE9002", "For Sale, Sold"),
                                 base + "c/": _abeea_page("ABRE9003", None)})
    assert {r["ad_number"]: r["active"] for r in c.upserted} == {"ABRE9001": True}
    assert c.pruned == []                         # an unread status is not an absent listing
    assert "status_unread=1" in c.notes and "status_unmeasured=0" in c.notes


def test_abeea_unmeasured_status_keeps_todays_behaviour_and_is_counted(monkeypatch):
    base = "https://abeea.com.sa/en/property/"
    c = _run_abeea(monkeypatch, {base + "a/": _abeea_page("ABRE9001", "For Sale, Resale")})
    assert {r["ad_number"]: r["active"] for r in c.upserted} == {"ABRE9001": True}
    assert len(c.pruned) == 2                     # nothing unread: prune runs for both tables
    assert "status_unread=0" in c.notes and "status_unmeasured=1" in c.notes
