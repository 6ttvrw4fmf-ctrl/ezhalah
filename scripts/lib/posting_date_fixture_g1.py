"""Posting-date fixtures, group 1: aqarmonthly, rakez, sakani, ksaaqar, akariyoun, amlakalahsa.
Contract: scripts/lib/posting_date_fixture_more.py.

Every input is a real record or page read live on 2026-11-09 and stored under scrapers/<site>/testdata/
(owner/contact fields removed); the posting date is the one thing varied. Builders touch no network and
no database: the location catalog is the in-memory seed `_seed_catalog()` lays down, plus الرياض under
an id the seed does not use, so the slug/city resolvers answer from memory.
"""
import copy
import json
import os

_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
_RIYADH_ID = 9101          # a city id the shared seed (1 = جدة, 3 = الأحساء) does not use


def _path(*parts):
    return os.path.join(_ROOT, *parts)


def _json(*parts):
    with open(_path(*parts), encoding="utf-8") as fh:
        return json.load(fh)


def _text(*parts):
    with open(_path(*parts), encoding="utf-8") as fh:
        return fh.read()


def _seed_riyadh():
    from scrapers.common import arabic_location as al
    al._CITY.setdefault(al.norm_ar("الرياض"), [(_RIYADH_ID, 1)])
    al._CID_AR.setdefault(_RIYADH_ID, "الرياض")


# ── aqarmonthly: Listing 6560670 as its unit page embedded it ───────────────────────────────────
_UNSET = object()


def aqarmonthly_args(create_time, published_at=_UNSET, last_update=_UNSET):
    _seed_riyadh()
    d = _json("scrapers", "aqarmonthly", "testdata", "6560670.listing.json")
    g = copy.deepcopy(d["listing"])
    g.pop("create_time", None)
    if create_time is not None:
        g["create_time"] = create_time
    for key, val in (("published_at", published_at), ("last_update", last_update)):
        if val is None:
            g.pop(key, None)
        elif val is not _UNSET:
            g[key] = val
    return [g, d["price"]]


# ── rakez: unit 72526 + its Arabic project 66825, as /wp-json/wp/v2 served them ────────────────────
_RAKEZ_TREE = {
    443: {"name": "الرياض", "parent": 0},
    1434: {"name": "شمال الرياض", "parent": 443},
    719: {"name": "الياسمين", "parent": 1434},
}


def rakez_args(date_gmt, date=_UNSET, modified_gmt=_UNSET):
    _seed_riyadh()
    unit = copy.deepcopy(_json("scrapers", "rakez", "testdata", "72526.unit.json"))
    unit.pop("date_gmt", None)
    if date_gmt is not None:
        unit["date_gmt"] = date_gmt
    for key, val in (("date", date), ("modified_gmt", modified_gmt)):
        if val is None:
            unit.pop(key, None)
        elif val is not _UNSET:
            unit[key] = val
    ar_project = _json("scrapers", "rakez", "testdata", "66825.project-ar.json")
    return [unit, None, ar_project, dict(_RAKEZ_TREE)]


# ── sakani: market unit 23577 (rent) — the detail record the crawl reads, plus its search row ─────
def sakani_args(publish_date, rich_publish_date=""):
    _seed_riyadh()
    detail = copy.deepcopy(_json("scrapers", "sakani", "testdata", "23577.market-unit.json")["attributes"])
    detail.pop("publish_date", None)
    if publish_date is not None:
        detail["publish_date"] = publish_date
    idx = {"auction_status": "", "resource_id": 23577, "resource_type": "market_units",
           "unit_types": ["land"], "marketplace_price": 1555.56}
    # The rent catalogue's rich row (type "marketing_rentals"), the keys map_listing reads; its own
    # publish_date is "" on the rent side (measured on SKI25490), so the detail is where the date lives.
    rich = {"resource_id": 23577, "status": "published", "publish": True, "tags": {"from_broker": True},
            "unit_type": "land", "city_text": "الرياض", "region_text": "منطقة الرياض", "city_id": 14,
            "annual_unit_price": 1555.56005859375, "area": 450.0, "main_building_face": [""],
            "location": {"lat": 24.77218784270536, "lon": 46.629819987169846}, "media_images": [],
            "price_is_negotiable": False, "publish_date": rich_publish_date}
    return [idx, rich, detail, "العقيق", "rent"]


def _sakani(mod, args):
    row, _category, why = mod.map_listing(*args)
    return row, why


# ── ksaaqar: ad_post 29304 as REST served it, and its page text ──────────────────────────────────
def ksaaqar_args(date_gmt, date=_UNSET, modified=_UNSET):
    post = copy.deepcopy(_json("scrapers", "ksaaqar", "testdata", "29304.ad_post.json"))
    post.pop("_note", None)
    post.pop("date_gmt", None)
    if date_gmt is not None:
        post["date_gmt"] = date_gmt
    for key, val in (("date", date), ("modified", modified)):
        if val is None:
            post.pop(key, None)
        elif val is not _UNSET:
            post[key] = val
    text = _text("scrapers", "ksaaqar", "testdata", "29304.page-text.txt").strip()
    return [post, text, ""]


def _ksaaqar(mod, args):
    row, _category, why = mod.map_listing(*args)
    return row, why


# ── akariyoun: the listing block of ad 1108 (/properties/shk-llaygar-fy-hy-alnfl-2) ──────────────
_AK_PILL = '<span class="property-views">\n 2026-11-08 \n </span>'


def akariyoun_args(variant):
    _seed_riyadh()
    page = _text("scrapers", "akariyoun", "testdata", "1108.excerpt.html")
    assert _AK_PILL in page, "akariyoun fixture no longer carries its date pill"
    assert "تاريخ انشاء الاعلان" in page, "akariyoun fixture no longer carries the licence block"
    if variant == "live":
        pass
    elif variant == "no-pill":           # the pill gone; the REGA block's «تاريخ انشاء الاعلان 2026-11-07» stays
        page = page.replace(_AK_PILL, "")
    elif variant == "relative":          # a pill that is not a calendar date is not read
        page = page.replace(_AK_PILL, '<span class="property-views">\n منذ يومين \n </span>')
    else:
        raise ValueError(variant)
    return ["shk-llaygar-fy-hy-alnfl-2", page]


def _akariyoun(mod, args):
    row, _category, _raw = mod.map_listing(*args)
    return row, ""


# ── amlakalahsa: land 20186 as /wp-json/wp/v2/land served it ─────────────────────────────────────
def amlakalahsa_args(date_gmt, date=_UNSET, modified_gmt=_UNSET):
    post = copy.deepcopy(_json("scrapers", "amlakalahsa", "testdata", "20186.land.json"))
    post.pop("_note", None)
    post.pop("date_gmt", None)
    if date_gmt is not None:
        post["date_gmt"] = date_gmt
    for key, val in (("date", date), ("modified_gmt", modified_gmt)):
        if val is None:
            post.pop(key, None)
        elif val is not _UNSET:
            post[key] = val
    return [post, {}]


PLATFORMS = {
    "aqarmonthly": ("scrapers.aqarmonthly.run", aqarmonthly_args, lambda m, a: (m.map_listing(*a), "")),
    "rakez": ("scrapers.rakez.run", rakez_args, lambda m, a: m.map_unit(*a)),
    "sakani": ("scrapers.sakani.run", sakani_args, _sakani),
    "ksaaqar": ("scrapers.ksaaqar.run", ksaaqar_args, _ksaaqar),
    "akariyoun": ("scrapers.akariyoun.run", akariyoun_args, _akariyoun),
}

CASES = {
    "aqarmonthly": [
        [[1769291538], "2026-01-25T00:52:18+03:00",
         "Listing.create_time read live on unit 6560670 (unix seconds, UTC) → the same instant in Saudi time"],
        [[None], None, "no create_time → NULL, the unit still maps"],
        [[None, 1794257423, 1794257423], None,
         "only published_at / last_update (a bump moves them) → NULL, never read as the posting date"],
        [[1769291538000], None, "a millisecond-scale stamp is not read as a date in the year 58000 → NULL"],
    ],
    "rakez": [
        [["2026-09-12T17:34:51"], "2026-09-12T20:34:51+03:00",
         "unit 72526 date_gmt read live (UTC, no zone mark) → the same instant in Saudi time = its `date`"],
        [["2026-11-08T22:30:00"], "2026-11-09T01:30:00+03:00", "a late-evening UTC publish lands on the Saudi day"],
        [[None, None], None, "no date / date_gmt → NULL, the unit still maps"],
        [[None, None, "2026-11-01T17:27:38"], None, "only modified_gmt (an edit) → NULL"],
    ],
    "sakani": [
        [["2026-06-23"], "2026-06-23",
         "market unit 23577 publish_date read live → stored as published (a bare day is Saudi-local)"],
        [[None], None, "no publish_date (the licence still carries end_date 2027-04-04) → NULL, the unit still maps"],
        [[None, "2026-11-08"], "2026-11-08", "the search row's own publish_date (the sale side) when the detail has none"],
    ],
    "ksaaqar": [
        [["2026-10-30T15:41:53"], "2026-10-30T18:41:53+03:00",
         "ad_post 29304 date_gmt read live = the page's JSON-LD datePublished 2026-10-30T15:41:53+00:00"],
        [[None, None], None, "no date / date_gmt → NULL, the ad still maps"],
        [[None, None, "2026-11-06T10:47:38"], None, "only modified (an edit) → NULL"],
    ],
    "akariyoun": [
        [["live"], "2026-11-08", "ad 1108's title-block pill «2026-11-08», read live → stored as published"],
        [["no-pill"], None,
         "no pill → NULL; the REGA block's «تاريخ انشاء الاعلان 2026-11-07» (a licence date) is never read"],
        [["relative"], None, "a pill that is relative text («منذ يومين») → NULL, never converted"],
    ],
}


# ── NOT A POSTING DATE (2026-11-10): amlakalahsa's WordPress date_gmt moves forward when an ad is re-published
# (land 19748: «2026-11-03» though first stored 2026-09-12; 45 of 302 live ads dated after our first sight). The
# mapper stores NULL and keeps the verbatim value as additional_info["date_gmt"]; the mutation restores the old
# reading and must put a date back.
def _amlakalahsa_nd(*_):
    return amlakalahsa_args("2026-11-07T15:15:07")


NO_DATE = {
    "amlakalahsa": ("scrapers.amlakalahsa.run", _amlakalahsa_nd, lambda m, a: m.map_listing(*a),
                    ["additional_info", "date_gmt"]),
}

MUTATIONS = {
    "amlakalahsa": [
        ("amlakalahsa: the re-publish date_gmt stored as the posting date again", "scrapers/amlakalahsa/run.py",
         '"date_added": None,                     # WordPress date_gmt is a re-publish date here — see the note above',
         '"date_added": site_posting_date(post["date_gmt"] + "Z"),', []),
    ],
}
