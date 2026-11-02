"""abralosol: the pin is read from the ad's OWN article, never from the related-ads list (audit 2026-10-21).

Measured live: ad 4790's article carries no map link, but the «views-field» list of OTHER ads below it carries
two maps/place links. Reading the whole page stored 25.454170,49.582003 — a neighbour's pin — on 95 «الراشدية»
ads. Ad 7069 shows the opposite case: its own «الموقع» link sits inside the article and must still be read.
These tests EXECUTE _detail() on page shapes copied from those two live pages.
"""
from __future__ import annotations

from scrapers.abralosol import run

RELATED = ('<div class="views-row"><div class="views-field views-field-field-als-r views-align-center">'
           'السعر 550,000 المساحة 313م شارع 12 الراشدية <a href="https://www.google.com/maps/place/25.454170,49.582003">'
           'الموقع</a></div></div>')


def _page(nid: str, article_inner: str) -> str:
    return (f'<html><body><article class="node" data-history-node-id="{nid}">'
            f'<span property="schema:name" content="أرض للبيع في الراشدية"></span>{article_inner}</article>'
            f'<section class="related">{RELATED}</section></body></html>')


def _detail(monkeypatch, nid: str, html: str) -> dict:
    monkeypatch.setattr(run, "_fetch", lambda _s, _url: (200, html))
    return run._detail(object(), nid)


def test_a_neighbours_pin_in_the_related_list_is_not_this_ads_pin(monkeypatch):
    d = _detail(monkeypatch, "4790", _page("4790", '<div class="text-right h1">🟡 المساحة 500</div>'))
    assert not d["pin"], f"stored a neighbour's pin: {d['pin']}"


def test_the_ads_own_location_link_inside_the_article_is_read(monkeypatch):
    own = '<div class="text-right h1">الموقع</div><a href="https://www.google.com/maps/place/25.3414,49.738">خريطة</a>'
    d = _detail(monkeypatch, "7069", _page("7069", own))
    assert d["pin"] and round(float(d["pin"]["latitude"]), 4) == 25.3414 and round(float(d["pin"]["longitude"]), 3) == 49.738


def test_mutation_reading_the_whole_page_again_is_caught(monkeypatch):
    # The defect itself: the same reader pointed at the WHOLE page picks up the related-list pin.
    page = _page("4790", '<div class="text-right h1">🟡 المساحة 500</div>')
    assert run.pin_from_html(page), "the fixture no longer reproduces the defect — the test above would pass vacuously"


def test_a_read_article_without_a_pin_says_so(monkeypatch):
    # keep_stored_pin keeps an old pin unless the write says the article was read and had none (audit 2026-10-21).
    import inspect
    src = inspect.getsource(run)
    assert '**({"pin_absent": True} if detail and not detail.get("pin") else {}),' in src
