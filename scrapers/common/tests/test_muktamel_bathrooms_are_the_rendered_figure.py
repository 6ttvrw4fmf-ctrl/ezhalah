"""Muktamel bathrooms = the figure the ad's own page RENDERS (🔬 2026-11-08, backlog 1508).

real-estates/33770 (muktamel_residential_listings:14137390) renders «الحمامات : 3» in its «المكونات الداخلية»
block and its own description says «🔹 3 غرف 🔹 3 دورات مياه», while the Nuxt payload's offer.bathroomsCount is 4 —
the value we stored and served. 34132 / 33971 / 34258 / 34524: page 3 and description «3 دورات مياه», payload 4.
Rooms and halls in the same block equal the payload. Markup below is pasted from the re-read page (net.http_get).
"""
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
