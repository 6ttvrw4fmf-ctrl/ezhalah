"""Crawler audit 2026-10-02, group status-fields-c — the status each source publishes is read
per ad, an unreadable status is never written as available, and a value nobody has measured is
kept as before but NAMED in the run notes.

OFFLINE: no network, no database. Every fixture is synthetic and minimal (invented ids, titles,
prices; no names, phones or licence numbers).

  fkralemar — the card ribbon is the only status the source publishes (live 2026-10-02: 48 cards,
              «للبيع» / «مباع» only; sold product pages are identical to live ones). A box with no
              ribbon used to be completed with the NEXT box's ribbon, title and price.
  eydah     — JSON-LD offers.availability was never read (live 2026-10-02: InStock on 2/2).
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.eydah import run as E  # noqa: E402
from scrapers.fkralemar import run as F  # noqa: E402


# ── fkralemar ─────────────────────────────────────────────────────────────────────────────────────
def _box(uid: str, slug: str, ribbon_html: str, title: str, price: int) -> str:
    return (f'<div class="e-p-box"><div class="e-commerce-product-box product-data-obj" data-unique-id="{uid}">'
            f'<a href="/offers/{slug}" class="first-image product-image"></a>'
            f'<div class="ribbonsLabels">{ribbon_html}</div>'
            f'<h4 class="product-title"><a class="box-text-primary" href="/offers/{slug}">{title}</a></h4>'
            f'<span data-type="price">{price}</span></div></div>')


def _ribbon(word: str) -> str:
    return f'<a href="#" class="background-primary-color product-ribbon-banner">{word}</a>'


A, B, C, D, G = "aaaaaaaa00001", "aaaaaaaa00002", "aaaaaaaa00003", "aaaaaaaa00004", "aaaaaaaa00005"
BOXES = (_box(A, "flat-a", _ribbon("للبيع"), "شقه 3 غرف ( 101م )", 500001)
         + _box(B, "flat-b", "", "شقه 4 غرف ( 102م )", 500002)              # no ribbon at all
         + _box(C, "flat-c", _ribbon("للبيع"), "شقه 5 غرف ( 103م )", 500003)
         + _box(D, "flat-d", _ribbon("مباع"), "شقه 6 غرف ( 104م )", 500004)
         + _box(G, "flat-g", _ribbon("محجوز"), "شقه 2 غرف ( 105م )", 500005))  # a word never measured
TILE = ('<div class="e-c-box" data-unique-id="cccccccc00001"><a href="/offers/district-one" '
        'class="image-container x"></a><span aria-label="حي الروضة"></span></div>')
CAT_META = '<meta name="description" content="شقق تمليك في حي الروضة جدة">'


@pytest.fixture(autouse=True)
def _no_catalog_network(monkeypatch):
    monkeypatch.setattr(F, "to_catalog", lambda s, hint=None: (18, 2) if (s or "").strip() == "جدة" else (None, None))
    monkeypatch.setattr(F, "city_ar_for", lambda cid: "جدة" if cid == 18 else None)
    monkeypatch.setattr(F, "find_district_in_text", lambda text, cid: None)
    monkeypatch.setattr(E, "to_catalog", lambda c, region_hint=None: (3, 1) if c == "الرياض" else (None, None))
    monkeypatch.setattr(E, "find_district_in_text", lambda t, cid: None)


def test_fkralemar_a_box_without_a_ribbon_never_borrows_the_next_cards():
    cards = {c["uid"]: c for c in F.parse_cards(BOXES)}
    assert list(cards) == [A, B, C, D, G], "one box = one card; none swallowed"
    assert cards[B]["ribbon"] is None and cards[B]["href"] == "/offers/flat-b"
    assert (cards[C]["ribbon"], cards[C]["title"], cards[C]["price_raw"]) == ("للبيع", "شقه 5 غرف ( 103م )", "500003")
    row, _cat, why = F.map_listing(cards[B], {"description": "", "photos": []}, "حي الروضة", CAT_META)
    assert row is None and why == "ribbon_unreadable"


@pytest.mark.parametrize("ribbon_html", [_ribbon(""), _ribbon("<span>مباع</span>")])
def test_fkralemar_an_empty_or_reshaped_ribbon_is_not_written(ribbon_html):
    (card,) = F.parse_cards(_box(A, "flat-a", ribbon_html, "شقه 3 غرف ( 101م )", 500001))
    row, _cat, why = F.map_listing(card, {"description": "", "photos": []}, "حي الروضة", CAT_META)
    assert row is None and why == "ribbon_unreadable", "a status that cannot be read is never 'available'"


def test_fkralemar_main_writes_only_readable_live_cards_and_names_the_rest(monkeypatch):
    calls: dict = {"batches": []}
    pages = {F.STORE: TILE + BOXES, F.BASE + "/offers/district-one": CAT_META + BOXES}
    product = lambda uid: f'<div class="product-container" data-unique-id="{uid}"></div><p class="description">( المساحة : 100م )</p>'  # noqa: E731
    pages.update({F.BASE + f"/offers/flat-{k}": product(u) for k, u in zip("abcdg", (A, B, C, D, G))})
    fetched: list[str] = []
    monkeypatch.setattr(F, "session", lambda: object())
    monkeypatch.setattr(F, "fetch", lambda s, url: fetched.append(url) or pages[url])
    monkeypatch.setattr(F.time, "sleep", lambda *_: None)
    monkeypatch.setattr(F, "db", types.SimpleNamespace(
        begin_run=lambda slug: 3,
        _wasalt_batch=lambda table, rows: calls["batches"].append((table, {r["ad_number"]: r["title"] for r in rows})),
        retire_superseded_siblings=lambda **kw: 0,
        prune_unseen=lambda table, seen, source=None, verify_gone=None: 0,
        end_run=lambda run_id, **kw: calls.update(end=kw) or True))
    monkeypatch.setattr(sys, "argv", ["run"])
    assert F.main() == 0
    written = dict(calls["batches"])["fkralemar_residential_listings"]
    assert written == {f"FKR{A}": "شقه 3 غرف ( 101م )", f"FKR{C}": "شقه 5 غرف ( 103م )", f"FKR{G}": "شقه 2 غرف ( 105م )"}
    assert F.BASE + "/offers/flat-b" not in fetched and F.BASE + "/offers/flat-d" not in fetched
    notes = calls["end"]["notes"]
    assert "soldx1" in notes and "ribbon_unreadablex1" in notes
    # «محجوز» was never measured on this source: it is NOT guessed to mean unavailable — it is named.
    assert "unmeasured_ribbon_kept_active[محجوز]x1" in notes


@pytest.mark.parametrize("ribbon_html", ["", _ribbon(""), _ribbon("<span>للبيع</span>")])
def test_fkralemar_main_aborts_red_when_no_card_has_a_readable_ribbon(monkeypatch, ribbon_html):
    """Boxes are found but the whole status source is unreadable: the run must end RED (exit 1,
    ok=False) so the silent-death alarm fires — not green with 0 rows and the active rows frozen."""
    calls: dict = {"batches": [], "prunes": []}
    boxes = (_box(A, "flat-a", ribbon_html, "شقه 3 غرف ( 101م )", 500001)
             + _box(B, "flat-b", ribbon_html, "شقه 4 غرف ( 102م )", 500002))
    pages = {F.STORE: TILE + boxes, F.BASE + "/offers/district-one": CAT_META + boxes}
    monkeypatch.setattr(F, "session", lambda: object())
    monkeypatch.setattr(F, "fetch", lambda s, url: pages[url])      # a product-page fetch would KeyError
    monkeypatch.setattr(F.time, "sleep", lambda *_: None)
    monkeypatch.setattr(F, "db", types.SimpleNamespace(
        begin_run=lambda slug: 3,
        _wasalt_batch=lambda table, rows: calls["batches"].append(table),
        retire_superseded_siblings=lambda **kw: 0,
        prune_unseen=lambda table, seen, source=None, verify_gone=None: calls["prunes"].append(table) or 0,
        end_run=lambda run_id, **kw: calls.update(end=kw) or True))
    monkeypatch.setattr(sys, "argv", ["run"])
    assert F.main() == 1
    assert calls["end"]["ok"] is False and "status source unreadable" in calls["end"]["notes"]
    assert calls["batches"] == [] and calls["prunes"] == []


# ── eydah ─────────────────────────────────────────────────────────────────────────────────────────
def _offer_page(availability) -> dict:
    offers = {"@type": "Offer", "price": 100000, "priceCurrency": "SAR"}
    if availability is not None:
        offers["availability"] = availability
    return {"ld": {"@type": "RealEstateListing", "name": "فيلا للبيع", "offers": offers,
                   "url": "https://eydah.com/offers/EY-9001.html"},
            "specs": {"نوع العقار": "فيلا", "الغرض": "بيع", "المدينة": "الرياض"}, "advertiser_fal_licence": None}


def test_eydah_instock_is_the_measured_value_and_is_archived():
    row, _cat, why = E.map_listing("/offers/EY-9001.html", _offer_page("https://schema.org/InStock"))
    assert why == "" and row["active"] is True and row["additional_info"]["availability"] == "InStock"


@pytest.mark.parametrize("value,label", [("https://schema.org/SoldOut", "SoldOut"), (None, "absent")])
def test_eydah_an_unmeasured_availability_is_kept_but_never_silent(value, label):
    row, _cat, why = E.map_listing("/offers/EY-9001.html", _offer_page(value))
    assert row is not None, "never measured on this source → today's behaviour is kept, not guessed"
    assert why == f"unmeasured_availability_kept_active[{label}]"
    assert row["additional_info"].get("availability") == (label if value else None)


def test_eydah_main_puts_the_unmeasured_value_in_the_run_notes(monkeypatch):
    calls: dict = {"batches": []}
    pages = {"/offers/EY-9001.html": _offer_page("https://schema.org/InStock"),
             "/offers/EY-9002.html": _offer_page("https://schema.org/SoldOut")}
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(E, "session", lambda: object())
    monkeypatch.setattr(E, "fetch_index", lambda s: (list(pages), 2))
    monkeypatch.setattr(E, "fetch_detail", lambda s, href: pages[href])
    monkeypatch.setattr(E.db, "begin_run", lambda platform: 7)
    monkeypatch.setattr(E.db, "_wasalt_batch", lambda tbl, rows: calls["batches"].append((tbl, [r["ad_number"] for r in rows])))
    monkeypatch.setattr(E.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(E.db, "prune_unseen", lambda tbl, seen, source, **kw: 0)
    monkeypatch.setattr(E.db, "end_run", lambda run_id, **kw: calls.update(end=kw) or True)
    assert E.main() == 0
    assert calls["batches"][0] == ("eydah_residential_listings", ["EYDEY-9001", "EYDEY-9002"])
    assert "unmeasured_availability_kept_active[SoldOut]x1" in calls["end"]["notes"]
    assert calls["end"]["rows_upserted"] == 2
