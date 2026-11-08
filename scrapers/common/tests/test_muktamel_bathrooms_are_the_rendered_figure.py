"""Muktamel bathrooms = the figure the ad's own page RENDERS (🔬 2026-11-08, backlog 1508).

real-estates/33770 (muktamel_residential_listings:14137390) renders «الحمامات : 3» in its «المكونات الداخلية»
block and its own description says «🔹 3 غرف 🔹 3 دورات مياه», while the Nuxt payload's offer.bathroomsCount is 4 —
the value we stored and served. 34132 / 33971 / 34258 / 34524: page 3 and description «3 دورات مياه», payload 4.
Rooms and halls in the same block equal the payload. Markup below is pasted from the re-read page (net.http_get).
"""
from types import SimpleNamespace

import pytest

from scrapers.muktamel import run as M

# verbatim from real-estates/33770, 2026-11-08 (whitespace as served)
BLOCK = ('<div class="inner-cont" data-v-66ad8990><label for data-v-66ad8990>الصالات</label> <span data-v-66ad8990>:</span> '
         '<span class="number-text" data-v-66ad8990>1</span></div> <div class="inner-cont" data-v-66ad8990><label for '
         'data-v-66ad8990>الحمامات</label> <span data-v-66ad8990>:</span> <span class="number-text" '
         'data-v-66ad8990>3</span></div> <!----> <!---->')

OFFER = {"dealType": 1, "type": 1, "isAvailable": True, "price": 620000, "bedRoomsCount": 3, "hallsCount": 1,
         "bathroomsCount": 4, "landArea": 112, "address": {}}


def test_reads_the_rendered_bathrooms():
    assert M.page_bathrooms("<html>" + BLOCK + "<script>window.__NUXT__=(function(a){}(1))</script>") == 3


def test_a_number_inside_the_payload_is_not_the_page():
    payload_only = '<script>window.__NUXT__=(function(){return {x:"<label>الحمامات</label> <span>:</span> ' \
                   '<span class=\\"number-text\\">9</span>"}}())</script>'
    assert M.page_bathrooms("<html>" + payload_only) is None
    assert M.page_bathrooms(None) is None


def _row(page):
    offer = dict(OFFER, buildingArea=112, features=[], streets=[], photos=[])
    parsed = {"offer": offer} if page is None else {"offer": offer, "_page_bathrooms": page}
    row, cat = M.map_listing(14137390, parsed)
    assert cat == "residential" and row
    return row


def test_map_listing_stores_the_page_figure_over_the_payload():
    assert _row(3)["bathrooms"] == 3      # the ad's page and words say 3; the payload says 4
    assert _row(None)["bathrooms"] == 4   # a page with no bathrooms row keeps the payload (no regression)
    assert _row(3)["bedrooms"] == 3 and _row(3)["halls"] == 1


def test_fetch_one_hands_the_page_figure_to_the_mapper(monkeypatch):
    html = ("<html>" + BLOCK + "<script>window.__NUXT__=(function(a){return {offer:a}}(1))</script>")

    class R:
        status_code, url, text = 200, "https://www.muktamel.com/real-estates/33770", html

    class S:
        def get(self, *a, **k):
            return R()

    monkeypatch.setattr(M, "_session", lambda: S())
    monkeypatch.setattr(M, "_nuxt_via_node", lambda src: {"offer": dict(OFFER)})
    got = M.fetch_one(33770)
    assert got and got[1]["_page_bathrooms"] == 3


@pytest.mark.parametrize("number, expected", [("0", None), ("1", 1), ("12", 12), ("99", 99), ("٣", 3)])
def test_page_bathrooms_reads_the_complete_rendered_count(number, expected):
    assert M.page_bathrooms(BLOCK.replace('>3</span>', f'>{number}</span>')) == expected


def test_page_bathrooms_accepts_whitespace_and_attributes():
    html = ('<label for data-v-example>\n الحمامات \t</label>\n'
            '<span data-v-example> : </span>\t'
            '<span data-v-example class="number-text" title="count"> 12\n</span>')
    assert M.page_bathrooms(html) == 12


@pytest.mark.parametrize("html", [
    "", "<html></html>",
    BLOCK.replace("الحمامات", "الغرف"),
    BLOCK.replace('>3</span>', '>غير محدد</span>'),
    BLOCK.replace('>3</span>', '></span>'),
    BLOCK.replace('>3</span>', '>3.5</span>'),
    BLOCK.replace('>3</span>', '>-3</span>'),
    BLOCK.replace('>3</span>', '>100</span>'),
])
def test_page_bathrooms_does_not_invent_a_count(html):
    assert M.page_bathrooms(html) is None


def test_page_bathrooms_prefers_the_first_own_block():
    related_listing = BLOCK.replace('>3</span>', '>8</span>')
    assert M.page_bathrooms(BLOCK + related_listing) == 3


def test_page_bathrooms_ignores_matching_markup_after_nuxt():
    # Use actual matching HTML here: escaped quotes alone would fail the regex
    # even if the Nuxt boundary protection were accidentally removed.
    after_nuxt = '<script>window.__NUXT__={}</script>' + BLOCK
    assert M.page_bathrooms(after_nuxt) is None
    assert M.page_bathrooms(BLOCK + after_nuxt) == 3


@pytest.mark.parametrize("payload, expected", [("7", 7), (None, None), ("", None), ("unknown", None), (0, None)])
@pytest.mark.parametrize("explicit_none", [False, True], ids=["missing-page-key", "null-page-count"])
def test_map_listing_falls_back_to_normalized_payload(payload, expected, explicit_none):
    parsed = {"offer": dict(OFFER, bathroomsCount=payload)}
    if explicit_none:
        parsed["_page_bathrooms"] = None
    row, category = M.map_listing(33770, parsed)
    assert category == "residential"
    assert row is not None
    assert row["bathrooms"] == expected


@pytest.mark.parametrize("payload", [None, "unknown", 9])
@pytest.mark.parametrize("rendered", [3])
def test_map_listing_preserves_rendered_count_even_with_missing_or_conflicting_payload(payload, rendered):
    parsed = {"offer": dict(OFFER, bathroomsCount=payload), "_page_bathrooms": rendered}
    row, category = M.map_listing(33770, parsed)
    assert category == "residential"
    assert row is not None
    assert row["bathrooms"] == rendered
    assert row["bedrooms"] == 3
    assert row["halls"] == 1


@pytest.mark.parametrize("body, page_count, stored_count", [
    (BLOCK, 3, 3),
    (BLOCK.replace('>3</span>', '>0</span>'), None, 4),   # a rendered 0 is silence: the payload stands
    ("<p>No bathroom row</p>", None, 4),
    (BLOCK.replace('>3</span>', '>غير محدد</span>'), None, 4),
])
def test_fetch_one_to_mapper_preserves_page_precedence_and_fallback(monkeypatch, body, page_count, stored_count):
    url = "https://www.muktamel.com/real-estates/33770"
    html = body + '<script>window.__NUXT__=(function(){return {}}())</script>'

    def get(request_url, **kwargs):
        assert request_url == url
        return SimpleNamespace(status_code=200, url=url, text=html)

    monkeypatch.setattr(M, "_session", lambda: SimpleNamespace(get=get))
    monkeypatch.setattr(M, "_nuxt_via_node", lambda src: {"offer": dict(OFFER)})
    monkeypatch.setattr(M, "_note", lambda reason: None)

    fetched = M.fetch_one(33770)
    assert fetched is not None
    listing_id, parsed, own = fetched
    assert listing_id == 33770
    assert own is True
    assert "_page_bathrooms" in parsed
    assert parsed["_page_bathrooms"] == page_count
    assert parsed["offer"]["bathroomsCount"] == 4
    row, category = M.map_listing(listing_id, parsed)
    assert category == "residential"
    assert row is not None
    assert row["bathrooms"] == stored_count
