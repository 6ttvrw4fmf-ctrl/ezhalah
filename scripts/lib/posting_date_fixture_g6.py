"""Posting-date fixtures, group 6. Contract: scripts/lib/posting_date_fixture_more.py.

Every input is a real record or page saved under scrapers/<site>/testdata/ (contacts removed), read
live on 2026-11-09. No network, no database: the inblaj REST read goes through a stub session.
"""
import copy
import json
import os

_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")


def _with_cities(names, fn):
    """Run fn() with these Arabic city names placeable in the test catalog (the shared seed holds only
    جدة and الأحساء), then remove them again so no other site's case sees them."""
    from scrapers.common import arabic_location as al
    added = []
    for i, name in enumerate(names):
        key = al.norm_ar(name)
        if key not in al._CITY:
            al._CITY[key] = [(960 + i, 96 + i)]
            added.append(key)
    try:
        return fn()
    finally:
        for key in added:
            al._CITY.pop(key, None)


def _testdata(site, name):
    with open(os.path.join(_ROOT, "scrapers", site, "testdata", name), encoding="utf-8") as fh:
        return fh.read()


def _wp_post(site, name, date_gmt, modified_gmt):
    """A saved WordPress REST record with its post date replaced (None = the field is absent)."""
    rec = copy.deepcopy(json.loads(_testdata(site, name)))
    for key in ("date", "date_gmt", "modified", "modified_gmt"):
        rec.pop(key, None)
    if date_gmt is not None:
        rec["date_gmt"] = date_gmt
    if modified_gmt is not None:
        rec["modified_gmt"] = modified_gmt
    return rec


# ── gudai / safera: inblaj.net tenants (scrapers/common/inblaj_platform.py) ──────────────────────
# The property page prints no date; the run reads every post's `date_gmt` from the tenant's own
# wp/v2/property route once (fetch_post_dates) and map_listing picks the page's own post id out of it.
class _Resp:
    def __init__(self, status, records):
        self.status_code = status
        self.headers = {"x-wp-totalpages": "1"}
        self._records = records

    def json(self):
        return copy.deepcopy(self._records)


class _Sess:
    """Answers wp/v2/property with the saved records — nothing else is ever asked of it."""
    def __init__(self, status, records):
        self._r = _Resp(status, records)

    def get(self, url, params=None, timeout=None):
        assert url.endswith("/wp-json/wp/v2/property"), url
        return self._r


_INBLAJ = {
    "gudai": dict(page="1619.page.html", source="Gudai", prefix="GUD", city="الرياض",
                  url="https://gudai.inblaj.net/property/%d8%a8%d9%8a%d8%aa-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%81%d9%8a-"
                      "%d8%ad%d9%8a-%d8%a7%d9%84%d8%b9%d9%84%d9%8a%d8%a7-%d8%a7%d9%84%d8%b1%d9%8a%d8%a7%d8%b6/"),
    "safera": dict(page="3157.page.html", source="سفيرة العقارات", prefix="SAF", city="بريدة",
                   url="https://safera.inblaj.net/property/%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d8%a7%d8%b1%d8%b6-%d8%b3%d9%83"
                       "%d9%86%d9%8a%d8%a9-%d8%a8%d8%a7%d9%84%d8%ad%d8%b2%d9%85-%d8%a7%d9%84%d9%85%d9%86%d8%aa%d8%b2%d9%87-"
                       "%d8%a7%d9%84%d8%b4%d9%85%d8%a7%d9%84/"),
}


def _inblaj_args(site, mode):
    """mode: 'live' (the saved wp/v2/property answer), 'modified_only' (every record keeps only
    modified_gmt), 'refused' (the route answers 403), 'empty' (it answers [])."""
    spec = _INBLAJ[site]
    records = json.loads(_testdata(site, "wp-property-dates.json"))
    status = 200
    if mode == "modified_only":
        records = [{k: v for k, v in r.items() if k != "date_gmt"} for r in records]
    elif mode == "refused":
        status, records = 403, []
    elif mode == "empty":
        records = []
    return [spec["url"], _testdata(site, spec["page"]), status, records, site]


def _inblaj_call(m, a):
    url, html, status, records, site = a
    spec = _INBLAJ[site]
    dates = m.fetch_post_dates(_Sess(status, records), "https://t.test")
    return _with_cities([spec["city"]], lambda: (
        m.map_listing(url, html, source=spec["source"], prefix=spec["prefix"], post_dates=dates)[0], ""))


def gudai_args(mode):
    return _inblaj_args("gudai", mode)


def safera_args(mode):
    return _inblaj_args("safera", mode)


# ── aqaralriyadh: the real wp/v2/posts record of post 310 ─────────────────────────────────────────
def aqaralriyadh_args(date_gmt, modified_gmt="2026-06-30T03:28:37"):
    return [_wp_post("aqaralriyadh", "310.post.json", date_gmt, modified_gmt), {175: "شقق للإيجار"}]


# ── aqaralsaudia: the real wp/v2/properties record of 9067 (owner fields dropped) ─────────────────
def aqaralsaudia_args(date_gmt, modified_gmt="2026-04-14T15:56:47"):
    return [_wp_post("aqaralsaudia", "9067.property.json", date_gmt, modified_gmt)]


# ── alta: the real wp/v2/estate_property record of 25759 (term names as the stored row reads them) ─
_ALTA_TAX = {"property_category": {122: "شقق"}, "property_action_category": {119: "بيع"},
             "property_city": {117: "مكة المكرمة"}, "property_status": {133: "متاح"},
             "property_area": {}, "property_features": {}}


def alta_args(date_gmt, modified_gmt="2025-10-28T12:29:30"):
    return [_wp_post("alta", "25759.estate_property.json", date_gmt, modified_gmt), _ALTA_TAX]


# ── shmoualshmal: the real wp/v2/properties record of 18702 (meta trimmed to the fields read) ─────
_SHM_TAX = {"property_type": {76: "شقة"}, "property_status": {34: "للبيع"}, "property_city": {54: "تبوك"},
            "property_area": {125: "حي الريان"}, "property_feature": {}}


def shmoualshmal_args(date_gmt, modified_gmt="2026-08-30T09:20:17"):
    return [_wp_post("shmoualshmal", "18702.property.json", date_gmt, modified_gmt), _SHM_TAX]


# ── tamyaz: the real /api/properties record prop-mvo4ong6na1v (phones removed) ────────────────────
def tamyaz_args(created_at):
    rec = copy.deepcopy(json.loads(_testdata("tamyaz", "prop-mvo4ong6na1v.property.json")))
    rec.pop("createdAt", None)
    if created_at is not None:
        rec["createdAt"] = created_at
    return [rec]


# ── livingcompound: an excerpt of the real /property/ page of 9703 (Yoast JSON-LD kept) ───────────
_LC_URL = "https://livingcompound.com/property/one-bedroom-furnished-unit-for-rent-kindi-housing-compound-rabwah/"
_LC_PUBLISHED = '"datePublished":"2025-10-19T13:58:47+00:00",'


def livingcompound_args(date_published):
    page = _testdata("livingcompound", "9703.page.html")
    assert page.count(_LC_PUBLISHED) == 1
    page = page.replace(_LC_PUBLISHED, "" if date_published is None else f'"datePublished":"{date_published}",')
    return [_LC_URL, page]


PLATFORMS = {
    "gudai": ("scrapers.common.inblaj_platform", gudai_args, _inblaj_call),
    "safera": ("scrapers.common.inblaj_platform", safera_args, _inblaj_call),
    "aqaralriyadh": ("scrapers.aqaralriyadh.run", aqaralriyadh_args,
                     lambda m, a: _with_cities(["الرياض"], lambda: (m.map_listing(*a)[0], ""))),
    "aqaralsaudia": ("scrapers.aqaralsaudia.run", aqaralsaudia_args,
                     lambda m, a: _with_cities(["الرياض"], lambda: (m.map_listing(*a)[0], ""))),
    "alta": ("scrapers.alta.run", alta_args, lambda m, a: (m.map_listing(*a)[0], "")),
    "shmoualshmal": ("scrapers.shmoualshmal.run", shmoualshmal_args, lambda m, a: (m.map_listing(*a)[0], "")),
    "tamyaz": ("scrapers.tamyaz.run", tamyaz_args, lambda m, a: (m.map_listing(*a)[0], "")),
    "livingcompound": ("scrapers.livingcompound.run", livingcompound_args, lambda m, a: (m.map_listing(*a)[0], "")),
}

CASES = {
    "gudai": [
        [["live"], "2025-11-10T21:32:44+03:00",
         "wp/v2/property date_gmt of post 1619 (read live; its photo is «WhatsApp Image 2025-11-09») → Saudi time"],
        [["modified_only"], None, "only modified_gmt (an edit) on every record → NULL"],
        [["refused"], None, "the REST route answers 403 → UNKNOWN, NULL; the listing still maps"],
        [["empty"], None, "the REST route lists no post for this page → NULL"],
    ],
    "safera": [
        [["live"], "2026-10-21T20:54:14+03:00",
         "wp/v2/property date_gmt of post 3157 (read live; first seen by us 2026-10-22 04:26 UTC) → Saudi time"],
        [["modified_only"], None, "only modified_gmt (3157 was edited 18:01:12) → NULL"],
        [["refused"], None, "the REST route answers 403 → UNKNOWN, NULL; the listing still maps"],
    ],
    "aqaralriyadh": [
        [["2026-06-30T03:21:23"], "2026-06-30T06:21:23+03:00",
         "post 310 date_gmt (= the page's article:published_time «2026-06-30T03:21:23+00:00») → Saudi time"],
        [[None], None, "no date_gmt → NULL, the ad still maps"],
        [[None, "2026-06-30T03:28:37"], None, "only modified_gmt (an edit) → NULL"],
    ],
    "aqaralsaudia": [
        [["2026-04-14T15:56:47"], "2026-04-14T18:56:47+03:00",
         "9067 date_gmt (= the page's JSON-LD datePublished «2026-04-14T15:56:47+00:00») → Saudi time"],
        [[None], None, "no date_gmt → NULL, the ad still maps"],
        [[None, "2026-04-14T16:53:27"], None, "only modified_gmt (an edit) → NULL"],
    ],
    "alta": [
        [["2025-10-28T12:29:29"], "2025-10-28T15:29:29+03:00",
         "25759 date_gmt read live on wp/v2/estate_property → Saudi time"],
        [[None], None, "no date_gmt → NULL, the ad still maps"],
        [[None, "2025-10-28T12:29:30"], None, "only modified_gmt (an edit) → NULL"],
    ],
    "shmoualshmal": [
        [["2024-10-04T17:55:16"], "2024-10-04T20:55:16+03:00",
         "18702 date_gmt (the site's own `date` reads 2024-10-04T20:55:16, Saudi clock) → Saudi time"],
        [[None], None, "no date_gmt → NULL, the ad still maps"],
        [[None, "2026-08-30T09:20:17"], None, "only modified_gmt (an edit) → NULL"],
    ],
    "tamyaz": [
        [[1792950681151], "2026-10-25T20:51:21+03:00",
         "createdAt epoch ms of prop-mvo4ong6na1v (2026-10-25T17:51:21Z; first seen by us 10-26 05:30 UTC)"],
        [[2], None, "a theme SEED record's createdAt (1..8 is a sort order, not a time) → NULL"],
        [[None], None, "no createdAt → NULL, the ad still maps"],
    ],
    "livingcompound": [
        [["2025-10-19T13:58:47+00:00"], "2025-10-19T16:58:47+03:00",
         "9703 Yoast JSON-LD WebPage datePublished (the page reads «1 year ago») → Saudi time"],
        [[None], None, "datePublished absent, only dateModified (an edit) remains → NULL"],
    ],
}
