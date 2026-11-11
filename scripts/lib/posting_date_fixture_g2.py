"""Posting-date fixtures, group 2: abeea, abralosol, aljassim, aqalemhajer, aqargate, bossbih, dallali, daryusuf, hajer, maktab, maqrat, mizlaj, nawafeth, raghdan, shomou.
Contract: scripts/lib/posting_date_fixture_more.py.

Every input is a real record, page or feed read live on 2026-11-09 and stored under
scrapers/<site>/testdata/ (phones, emails and private persons' names removed); the posting date is the one
thing varied. Builders touch no network and no database. Where an ad's city is not in the shared seed
(`_seed_catalog()` names only جدة and الأحساء) the call adds it for that one mapping and removes it again.

The traps this group guards: a Drupal bump / «changed» date (abralosol, aqalemhajer, bossbih, aljassim,
shomou — the creation date is the RSS pubDate), a REGA licence date (aqargate, mizlaj, maktab, dallali,
raghdan, maqrat, nawafeth), a WordPress `modified` / «Updated on» (daryusuf, abeea, hajer) and a
re-stamped review time (aqargate publishedAt). Each of those alone must give None.
"""
import copy
import datetime
import importlib
import json
import os
import re

_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")

PLATFORMS = {}
CASES = {}
MUTATIONS = {}


# ── abeea: an excerpt of the real detail page of WordPress property 24493 (ABRE373) + its REST date_gmt ──
_ABEEA_URL = "https://abeea.com.sa/en/property/apartment-for-rent-in-al-bahar-district-al-khobar-6/"


def abeea_args(posted_gmt):
    with open(os.path.join(_ROOT, "scrapers", "abeea", "testdata", "24493.property-page.html"),
              encoding="utf-8") as fh:
        body = fh.read()
    return [body, _ABEEA_URL, posted_gmt]


PLATFORMS |= {
    "abeea": ("scrapers.abeea.run", abeea_args,
              lambda m, a: (m.map_listing(a[0], a[1], posted_gmt=a[2])[0], "")),
}

CASES |= {
    "abeea": [
        [["2026-11-03T14:27:35"], "2026-11-03T17:27:35+03:00",
         "REST date_gmt read live on abeea post 24493 (its `date` is 17:27:35, Saudi time) → Saudi time"],
        [[None], None,
         "no REST date (sitemap fallback) → NULL; the page itself carries only «Updated on» (an edit)"],
    ],
}


# ── abralosol: the real index row of nid 4987 + the site's real Drupal RSS feed (read 2026-11-09) ──


def _abralosol_read(name):
    with open(os.path.join(_ROOT, "scrapers", "abralosol", "testdata", name), encoding="utf-8") as fh:
        return fh.read()


def abralosol_args(feed_file, row_file="4987.index-row.html"):
    """[ix, detail, feed xml]: ix is the real index row parsed by the scraper's own index parser; the
    feed is what /rss.xml (or rss.xml?nid=) answered, or None when the ad was in no feed read."""
    real = importlib.import_module("scrapers.abralosol.run")
    ix = real._parse_index(real._index_rows(_abralosol_read(row_file))[0])
    return [ix, {}, _abralosol_read(feed_file) if feed_file else None]


def _abralosol_call(m, a):
    ix, detail, feed = a
    ix = dict(ix, posted_raw=m.feed_created(feed).get(ix["nid"]))   # what crawl() hands the mapper
    out = m.map_listing(ix, detail)
    return (out[0] if out else None), ""


PLATFORMS |= {
    "abralosol": ("scrapers.abralosol.run", abralosol_args, _abralosol_call),
}

CASES |= {
    "abralosol": [
        [["rss-latest.xml"], "2025-03-11T23:53:35+03:00",
         "/rss.xml pubDate «Tue, 11 Mar 2025 20:53:35 +0000» (created) for 4987, whose page and index "
         "print only the bump «09/11/2026» → the same instant in Saudi time"],
        [[None], None, "no feed carried the ad → NULL; the index bump «09/11/2026» is never used"],
        [["4687.rss-nid.xml"], None,
         "a feed answer for ANOTHER nid (rss.xml?nid=4687, created 04 Jan 2025) never dates 4987"],
    ],
}

MUTATIONS |= {
    "abralosol": [
        ["abralosol reading the index bump date (node CHANGED) as the posting date", "scrapers/abralosol/run.py",
         '"date_added": posting_date(ix.get("posted_raw")),',
         '"date_added": site_posting_date(ix.get("bump_date")),',
         [None]],
    ],
}


# ── aljassim: index row of nid 3741 (its index page sits behind a JS challenge, so the row is rebuilt
#    from the cells our crawl stored for it), the real article and the site's real RSS feed (read 2026-11-09) ──


def _aljassim_read(name):
    with open(os.path.join(_ROOT, "scrapers", "aljassim", "testdata", name), encoding="utf-8") as fh:
        return fh.read()


_ALJASSIM_3741_CELLS = {      # stored source_capture.index: «السعر 15,800» · «أربع غرف الدور الاول» ·
    "view-field-als-r-table-column": "السعر\n15,800<br>",                        # «الفاضلية» ·
    "view-nothing-1-table-column": "أربع غرف الدور الاول",                        # «شقة للايجار 31/10/2026»
    "view-field-tags-table-column": "الفاضلية",
    "view-nothing-table-column": '<a href="/3741" hreflang="en">شقة<br>للايجار</a><br>31/10/2026',
}


def aljassim_args(feed_file):
    """[ix, detail, feed xml]: ix from the scraper's own parse_index, detail from its own parse_detail on
    the real article; the feed is what /rss.xml answered, or None when the ad was not among its 10 items."""
    real = importlib.import_module("scrapers.aljassim.run")
    ix = real.parse_index({"nid": "3741", "cells": dict(_ALJASSIM_3741_CELLS)})
    detail = real.parse_detail(_aljassim_read("3741.article.html"), "3741")
    return [ix, detail, _aljassim_read(feed_file) if feed_file else None]


def _aljassim_call(m, a):
    from scrapers.common import arabic_location as al
    key = al.norm_ar("الهفوف")              # the office city (OFFICE_CITY_AR); the shared seed names two others
    added = key not in al._CITY
    if added:
        al._CITY[key] = [(4, 5)]
    try:
        ix, detail, feed = a
        ix = dict(ix, posted_raw=m.feed_created(feed).get(ix["nid"]))   # what crawl() hands the mapper
        row, _cat, why = m.map_listing(ix, detail)
    finally:
        if added:
            al._CITY.pop(key, None)        # leave the shared seed exactly as other sites' cases expect it
    return row, why


PLATFORMS |= {
    "aljassim": ("scrapers.aljassim.run", aljassim_args, _aljassim_call),
}

CASES |= {
    "aljassim": [
        [["rss-latest.xml"], "2024-04-29T20:28:29+03:00",
         "/rss.xml pubDate «Mon, 29 Apr 2024 17:28:29 +0000» (created) for 3741, whose row and page print "
         "only the bump «31/10/2026» → the same instant in Saudi time"],
        [[None], None, "not among the feed's 10 items → NULL; the bump «31/10/2026» is never used"],
    ],
}

MUTATIONS |= {
    "aljassim": [
        ["aljassim reading the index bump date (node CHANGED) as the posting date", "scrapers/aljassim/run.py",
         '"date_added": posting_date(ix.get("posted_raw")),',
         '"date_added": site_posting_date(ix.get("bump_date")),',
         [None]],
    ],
}


# ── aqalemhajer: the real index rows of nids 4079 / 5362 + the site's real Drupal RSS feed (read 2026-11-09) ──


def _aqalemhajer_read(name):
    with open(os.path.join(_ROOT, "scrapers", "aqalemhajer", "testdata", name), encoding="utf-8") as fh:
        return fh.read()


def aqalemhajer_args(nid, feed_file):
    """[index card, detail, feed xml]: the card is the real index row parsed by the scraper's own
    parse_index; the feed is what /rss.xml (or rss.xml?nid=) answered, or None when no feed carried it."""
    real = importlib.import_module("scrapers.aqalemhajer.run")
    card = next(c for c in real.parse_index(_aqalemhajer_read("index-rows.html")) if c["nid"] == nid)
    return [card, {}, _aqalemhajer_read(feed_file) if feed_file else None]


def _aqalemhajer_call(m, a):
    card, detail, feed = a
    card = dict(card, posted_raw=m.feed_created(feed).get(card["nid"]))   # what main() hands the mapper
    row, _cat, why = m.map_listing(card, detail)
    return row, why


PLATFORMS |= {
    "aqalemhajer": ("scrapers.aqalemhajer.run", aqalemhajer_args, _aqalemhajer_call),
}

CASES |= {
    "aqalemhajer": [
        [["4079", "4079.rss-nid.xml"], "2025-07-12T15:06:31+03:00",
         "rss.xml?nid=4079 pubDate «Sat, 12 Jul 2025 12:06:31 +0000» (created); the row prints only the "
         "bump «09/11/2026» → the same instant in Saudi time"],
        [["5362", "rss-latest.xml"], "2026-08-31T01:35:37+03:00",
         "/rss.xml pubDate «Sun, 30 Aug 2026 22:35:37 +0000», which the site itself prints as «31/08/2026» "
         "→ the Saudi day, not the UTC one"],
        [["4079", None], None, "no feed carried the ad → NULL; the row's bump «09/11/2026» is never used"],
        [["5362", "4079.rss-nid.xml"], None, "a feed answer for ANOTHER nid never dates this ad"],
    ],
}

MUTATIONS |= {
    "aqalemhajer": [
        ["aqalemhajer reading the index bump date (node CHANGED) as the posting date", "scrapers/aqalemhajer/run.py",
         '"date_added": posting_date(ix.get("posted_raw")),',
         '"date_added": site_posting_date(ix.get("bump_date")),',
         ["4079", None]],
    ],
}


# ── aqargate: the real marketplace record 912 (GET /api/public/listings/912, 2026-11-09; contact,
# publisher and broker blocks removed) ──────────────────────────────────────────────────────────
def aqargate_args(created_at, published_at="2026-11-09T02:56:30.228Z", wp_id=None, licence_only=False):
    with open(os.path.join(_ROOT, "scrapers", "aqargate", "testdata", "912.marketplace-record.json"),
              encoding="utf-8") as fh:
        rec = copy.deepcopy(json.load(fh))
    rec.pop("createdAt", None)
    if created_at is not None:
        rec["createdAt"] = created_at
    rec["publishedAt"] = published_at
    if wp_id is not None:
        rec.setdefault("regaData", {})["wp_id"] = wp_id
    if licence_only:                       # only the REGA licence dates are left
        rec["creationDate"] = "27/11/2025"
        rec["adLicenseEndDate"] = "27/11/2026"
    return [rec]


PLATFORMS |= {
    "aqargate": ("scrapers.aqargate.run", aqargate_args, lambda m, a: (m.map_marketplace(*a)[0], "")),
}

CASES |= {
    "aqargate": [
        [["2026-11-09T02:56:29.376Z"], "2026-11-09T05:56:29+03:00",
         "createdAt read live on marketplace/912 (first seen 04:22:41Z) → the same instant in Saudi time"],
        [["2026-06-26T06:02:35.000Z", "2026-06-26T06:02:35.000Z", 56140], "2026-06-26T06:02:35",
         "a WordPress-imported ad (regaData.wp_id) carries WP LOCAL time with a false Z → kept as Saudi time "
         "(AG56140: as UTC it would be 1h40m after we first saw it, 04:22:39Z)"],
        [[None], None, "no createdAt → NULL, the ad still maps"],
        [[None, "2026-09-20T18:28:07.658Z"], None,
         "only publishedAt (re-stamped by a review) → NULL, a re-review is not a posting"],
        [[None, None, None, True], None,
         "only the REGA licence creationDate / adLicenseEndDate → NULL, a licence date is not a posting"],
    ],
}


# ── bossbih: the real index cards of nids 12496 / 14798 + the site's real Drupal RSS feed (read 2026-11-09) ──


def _bossbih_read(name):
    with open(os.path.join(_ROOT, "scrapers", "bossbih", "testdata", name), encoding="utf-8") as fh:
        return fh.read()


def bossbih_args(nid, feed_file):
    """[index card, detail, feed xml]: the card is the real index card parsed by the scraper's own
    parse_index; the feed is what /rss.xml answered, or None when the ad was not among its 10 items."""
    real = importlib.import_module("scrapers.bossbih.run")
    card = next(c for c in real.parse_index(_bossbih_read("index-cards.html")) if c["nid"] == nid)
    return [card, {}, _bossbih_read(feed_file) if feed_file else None]


def _bossbih_call(m, a):
    card, detail, feed = a
    card = dict(card, posted_raw=m.feed_created(feed).get(card["nid"]))   # what main() hands the mapper
    row, _cat, why = m.map_listing(card, detail)
    return row, why


PLATFORMS |= {
    "bossbih": ("scrapers.bossbih.run", bossbih_args, _bossbih_call),
}

CASES |= {
    "bossbih": [
        [["12496", "rss-latest.xml"], "2025-08-03T22:57:35+03:00",
         "/rss.xml pubDate «Sun, 03 Aug 2025 19:57:35 +0000» (created) for 12496, whose card and page print "
         "only the bump «2026-11-09» → the same instant in Saudi time"],
        [["14798", "rss-latest.xml"], "2026-11-09T22:02:22+03:00",
         "a new ad: feed pubDate «Mon, 09 Nov 2026 19:02:22 +0000» → Saudi time"],
        [["12496", None], None,
         "not among the feed's 10 items → NULL; the card's bump «تاريخ 2026-11-09» is never used"],
    ],
}

MUTATIONS |= {
    "bossbih": [
        ["bossbih reading the card's «تاريخ» bump date (node CHANGED) as the posting date", "scrapers/bossbih/run.py",
         '"date_added": posting_date(ix.get("posted_raw")),',
         '"date_added": site_posting_date(ix.get("bump_date")),',
         ["12496", None]],
    ],
}


# ── dallali: the live API record 1a944e24 (licence PII removed) ──────────────────────────────────
def dallali_args(published_at, created_at="2026-10-21T11:53:09.946Z"):
    with open(os.path.join(_ROOT, "scrapers", "dallali", "testdata", "1a944e24.listing.json"),
              encoding="utf-8") as fh:
        x = copy.deepcopy(json.load(fh))
    # the live licence ends 31/03/2027; push it out so the ad-end-date gate never expires the fixture
    x["rega_display_data"]["endDate"] = "31/03/2099"
    x.pop("published_at", None)
    x.pop("created_at", None)
    if published_at is not None:
        x["published_at"] = published_at
    if created_at is not None:
        x["created_at"] = created_at
    return [x]


PLATFORMS |= {
    "dallali": ("scrapers.dallali.run", dallali_args, lambda m, a: ((m.map_listing(*a)[0] or (None,))[0], "")),
}

CASES |= {
    "dallali": [
        [["2026-10-21T11:53:01.899Z"], "2026-10-21T14:53:01+03:00",
         "published_at read live on dallali 1a944e24 → the same instant in Saudi time"],
        [["2026-11-04T22:10:00.000Z"], "2026-11-05T01:10:00+03:00",
         "a late-evening UTC publish lands on the Saudi day"],
        [[None], None, "no published_at (created_at alone is not read) → NULL, the ad still maps"],
        [[None, None], None,
         "only the licence's rega.creationDate «18/10/2026» (in the record) → NULL, a licence date is not a posting"],
    ],
}


# ── daryusuf: the real WordPress portfolio post 10070 (/wp-json/wp/v2/portfolio/10070, phones removed) ──
def daryusuf_args(date_gmt, modified_gmt="2026-11-08T14:24:22"):
    with open(os.path.join(_ROOT, "scrapers", "daryusuf", "testdata", "10070.portfolio-post.json"),
              encoding="utf-8") as fh:
        post = copy.deepcopy(json.load(fh))
    post.pop("date_gmt", None)
    if date_gmt is not None:
        post["date_gmt"] = date_gmt
    post["modified_gmt"] = modified_gmt
    return [post, {82: "فلل-للبيع"}]


def _daryusuf_call(m, a):
    from scrapers.common import arabic_location as al
    key = al.norm_ar("المدينة المنورة")      # the ad is in Madinah; the shared seed names Jeddah and Al-Ahsa
    added = key not in al._CITY
    if added:
        al._CITY[key] = [(4, 3)]
    try:
        return m.map_listing(*a)[0], ""
    finally:
        if added:
            al._CITY.pop(key, None)        # leave the shared seed exactly as other sites' cases expect it


PLATFORMS |= {
    "daryusuf": ("scrapers.daryusuf.run", daryusuf_args, _daryusuf_call),
}

CASES |= {
    "daryusuf": [
        [["2026-11-08T14:15:37"], "2026-11-08T17:15:37+03:00",
         "date_gmt read live on daryusuf 10070 (UTC; JSON-LD datePublished 14:15:37+00:00) → Saudi time"],
        [["2026-11-08T22:30:00"], "2026-11-09T01:30:00+03:00",
         "a late-evening UTC publish lands on the Saudi day"],
        [[None], None, "no date_gmt → NULL, the ad still maps"],
        [[None, "2026-11-09T08:00:00"], None, "only modified_gmt (an edit) is present → NULL"],
    ],
}


# ── hajer: the real WP REST record of property post 1555 (HJ4043) + an excerpt of its detail page ──────
def hajer_args(date_gmt, modified_gmt="2026-10-19T13:53:44"):
    base = os.path.join(_ROOT, "scrapers", "hajer", "testdata")
    with open(os.path.join(base, "1555.rest-property.json"), encoding="utf-8") as fh:
        post = copy.deepcopy(json.load(fh))
    with open(os.path.join(base, "1555.property-page.html"), encoding="utf-8") as fh:
        page = fh.read()
    post.pop("date_gmt", None)
    post.pop("date", None)
    if date_gmt is not None:
        post["date_gmt"] = date_gmt
    post["modified_gmt"] = modified_gmt
    return [post, page]


# NOT A POSTING DATE (2026-11-10): hajer's WordPress date_gmt moves forward when an ad is re-published (post 1022 /
# HJ4010: «2026-10-10», modified the same second, though that link was stored on 2026-06-21). The mapper stores NULL
# and keeps the verbatim value as additional_info["date_gmt"]; the mutation restores the old reading.
def _hajer_nd(*_):
    return hajer_args("2026-10-19T13:53:44")


NO_DATE = {
    "hajer": ("scrapers.hajer.run", _hajer_nd, lambda m, a: (m.map_listing(*a)[0], ""), ["additional_info", "date_gmt"]),
}

MUTATIONS |= {
    "hajer": [
        ("hajer: the re-publish date_gmt stored as the posting date again", "scrapers/hajer/run.py",
         'verbatim value is kept as additional_info["date_gmt"].\n        "date_added": None,',
         'verbatim value is kept as additional_info["date_gmt"].\n        "date_added": site_posting_date(f"{p[\'date_gmt\']}Z"),', []),
    ],
}


# ── maktab: the live API office 127 (viewer_* / licence names and phones removed) ────────────────
def maktab_args(created_at, license_create_date="2026-11-04"):
    with open(os.path.join(_ROOT, "scrapers", "maktab", "testdata", "127.office.json"),
              encoding="utf-8") as fh:
        o = copy.deepcopy(json.load(fh))
    # the fixture catalog (posting_date_fixture._seed_catalog) knows only جدة / الأحساء — the live office
    # is in الرياض, so the city is swapped; nothing date-related is touched
    o["location"]["city"] = "جدة"
    o["license_data"]["location"]["city"] = "جدة"
    o.pop("created_at", None)
    o.pop("license_create_date", None)
    if created_at is not None:
        o["created_at"] = created_at
    if license_create_date is not None:
        o["license_create_date"] = license_create_date
    return [o, datetime.date(2026, 11, 9)]     # a fixed «today»: the licence end gate never ages the fixture


PLATFORMS |= {
    "maktab": ("scrapers.maktab.run", maktab_args, lambda m, a: (m.map_office(*a)[0], m.map_office(*a)[2])),
}

CASES |= {
    "maktab": [
        [["2026-11-05T12:53:13.000000Z"], "2026-11-05T15:53:13+03:00",
         "created_at read live on maktab office 127 (the page's «تاريخ الإعلان») → the same instant in Saudi time"],
        [["2026-11-08T21:30:00.000000Z"], "2026-11-09T00:30:00+03:00",
         "a late-evening UTC posting lands on the Saudi day"],
        [[None, None], None, "no created_at → NULL, the office still maps"],
        [[None], None,
         "only license_create_date «2026-11-04» («تاريخ إصدار الرخصة») → NULL, a licence date is not a posting"],
    ],
}


# ── maqrat: an excerpt of the real ad page Details/10302 (2026-11-09; the ad officer's name and
# mobile removed) ─────────────────────────────────────────────────────────────────────────────────
def maqrat_args(pill="2026-11-08"):
    with open(os.path.join(_ROOT, "scrapers", "maqrat", "testdata", "10302.detail.html"),
              encoding="utf-8") as fh:
        page = fh.read()
    if pill is None:                       # no dated pill: only the licence end date is left
        page = re.sub(r'<time class="pd-hero-pill pd-hero-date".*?</time>', "", page, flags=re.S)
    else:
        page = page.replace('datetime="2026-11-08"', f'datetime="{pill}"')
    return ["10302", {"deal": "للإيجار", "lat": "21.5", "lng": "39.2"}, page]


def maqrat_call(m, a):
    pid, card, page = a
    res, why = m.map_listing(pid, card, m.parse_detail(page, pid))
    return (res[0] if res else None), why


PLATFORMS |= {
    "maqrat": ("scrapers.maqrat.run", maqrat_args, maqrat_call),
}

CASES |= {
    "maqrat": [
        [["2026-11-08"], "2026-11-08",
         "the dated pill read live on Details/10302 (first seen 2026-11-09 05:30Z) → the Saudi day as published"],
        [[None], None,
         "no pill → NULL; the page's «تاريخ انتهاء رخصة الإعلان» 2027/07/02 (a licence date) is never used"],
        [["08/11/2026 مساءً"], None, "a pill in any other shape → NULL, never a guess"],
    ],
}


# ── mizlaj: props.listing of the real ad page /guest/listings/…-lp4pHECk (listing 90, 2026-11-09;
# owner, contract, broker, employee and REGA-response blocks removed) ─────────────────────────────
def mizlaj_args(published_at, status="approved", extra_ad=None, created_only=False):
    with open(os.path.join(_ROOT, "scrapers", "mizlaj", "testdata", "90.listing.json"), encoding="utf-8") as fh:
        listing = copy.deepcopy(json.load(fh))
    ad = listing["rega_advertisements"][0]
    ad.pop("published_at", None)
    if published_at is not None:
        ad["published_at"] = published_at
    ad["status"] = status
    if extra_ad is not None:
        listing["rega_advertisements"].append(dict(ad, id=999, status="approved", published_at=extra_ad))
    if created_only:                       # only the draft's created_at + the licence dates are left
        listing["rega_advertisements"] = []
    md = {"id": listing["id"], "slug": listing["slug"], "name": listing["name"]}
    return [md, listing]


PLATFORMS |= {
    "mizlaj": ("scrapers.mizlaj.run", mizlaj_args, lambda m, a: (m.map_listing(*a)[0], "")),
}

CASES |= {
    "mizlaj": [
        [["2026-09-24T00:25:52.000000Z"], "2026-09-24T03:25:52+03:00",
         "rega_advertisements[].published_at read live on listing 90 (first seen 2026-09-24 04:22:36Z) → Saudi time"],
        [["2026-09-24T00:25:52.000000Z", "approved", "2027-08-06T09:00:00.000000Z"], "2026-09-24T03:25:52+03:00",
         "a later re-published advertisement (licence renewal) does not move the date: the earliest wins"],
        [[None], None, "no published_at → NULL, the ad still maps"],
        [["2026-09-24T00:25:52.000000Z", "pending"], None,
         "an advertisement that is not approved was never published → NULL"],
        [[None, "approved", None, True], None,
         "only the draft created_at and the licence end date (2027-08-05) → NULL"],
    ],
}


# ── nawafeth: the live detail page of ad 182 (an excerpt; advertiser/employee names and phone removed) ─
def nawafeth_args(header_date):
    """header_date: the text inside the header's clock-icon <p> — None removes the whole date line."""
    with open(os.path.join(_ROOT, "scrapers", "nawafeth", "testdata", "182.detail.html"),
              encoding="utf-8") as fh:
        page = fh.read()
    live = "<p>26&#x200F;/10&#x200F;/2026</p>"
    assert live in page
    if header_date is None:
        page = page.replace('<img src="/imgs/icons/time.png" alt="last-seen" class="mx-1">', "").replace(live, "")
    else:
        page = page.replace(live, f"<p>{header_date}</p>")
    return [182, page, datetime.date(2026, 11, 9)]   # a fixed «today»: the licence end gate never ages it


PLATFORMS |= {
    "nawafeth": ("scrapers.nawafeth.run", nawafeth_args, lambda m, a: ((m.map_listing(*a)[0] or (None,))[0], m.map_listing(*a)[1])),
}

CASES |= {
    "nawafeth": [
        [["26&#x200F;/10&#x200F;/2026"], "26/10/2026",
         "the header date read live on nawafeth 182 (RLM marks as entities) → DD/MM/YYYY"],
        [["04‏/10‏/2026"], "04/10/2026", "the same date with literal RLM marks (live 176's value)"],
        [[None], None, "no header date → NULL, the ad still maps"],
        [[None], None,
         "only the licence END date «تاريخ انتهاء رخصة الاعلان: 30/12/2026» is on the page → NULL"],
    ],
}


# ── raghdan: the live page of T9ylxTlxzuwptEDcp2dI (an excerpt; seller notes + phone removed) ────
def raghdan_args(created_seconds, printed="08/11/2026"):
    """created_seconds: the RSC record's createdAt.seconds (None drops it); printed: «تاريخ النشر»."""
    with open(os.path.join(_ROOT, "scrapers", "raghdan", "testdata", "T9ylxTlxzuwptEDcp2dI.detail.html"),
              encoding="utf-8") as fh:
        page = fh.read()
    stamp = '\\"createdAt\\":{\\"seconds\\":1794121573},'
    shown = 'تاريخ النشر<!-- -->:</span><span class="text-gray-800 dark:text-gray-400">08/11/2026</span>'
    assert stamp in page and shown in page
    page = page.replace(stamp, "" if created_seconds is None
                        else f'\\"createdAt\\":{{\\"seconds\\":{created_seconds}}},')
    page = page.replace(shown, shown.replace("08/11/2026", printed))
    return [page, "https://raghdan.sa/ar/property/T9ylxTlxzuwptEDcp2dI/"]


PLATFORMS |= {
    "raghdan": ("scrapers.raghdan.run", raghdan_args, lambda m, a: (m.map_listing(*a)[0], "")),
}

CASES |= {
    "raghdan": [
        [[1794121573], "2026-11-08T10:06:13+03:00",
         "createdAt read live on raghdan T9ylxTlxzuwptEDcp2dI (page «08/11/2026») → the instant in Saudi time"],
        [[None], None, "no createdAt in the record → NULL, the ad still maps (the printed date alone is not read)"],
        [[1792357200, "19/10/2026"], None,
         "a licence-imported record (live 659188181231): createdAt exactly Saudi midnight = the licence's "
         "issue date (endDate − 1 year) → NULL"],
        [[1794121573, "07/11/2026"], None, "the printed «تاريخ النشر» names another day → NULL, never a guess"],
    ],
}


# ── shomou: the real article of nid 8494 + the site's real Drupal RSS feed (read 2026-11-09) ──


def _shomou_read(name):
    with open(os.path.join(_ROOT, "scrapers", "shomou", "testdata", name), encoding="utf-8") as fh:
        return fh.read()


def shomou_args(feed_file, nid="8494"):
    """[parsed detail, feed xml]: the detail is the real article parsed by the scraper's own
    parse_detail; the feed is what /rss.xml answered, or None when the ad was not among its 10 items."""
    real = importlib.import_module("scrapers.shomou.run")
    d = real.parse_detail(nid, _shomou_read(f"{nid}.article.html"))
    return [d, _shomou_read(feed_file) if feed_file else None]


def _shomou_call(m, a):
    d, feed = a
    feed_created = importlib.import_module("scrapers.bossbih.run").feed_created   # shomou imports bossbih's
    d = dict(d, posted_raw=feed_created(feed).get(d["nid"]))   # what main() hands the mapper
    # the ad's own end date is 2027-02-06: judged on the day it was read, so the case never expires
    row, _cat, why = m.map_detail(d, today=datetime.date(2026, 11, 9))
    return row, why


PLATFORMS |= {
    "shomou": ("scrapers.shomou.run", shomou_args, _shomou_call),
}

CASES |= {
    "shomou": [
        [["rss-latest.xml"], "2026-11-08T18:30:12+03:00",
         "/rss.xml pubDate «Sun, 08 Nov 2026 15:30:12 +0000» (created) for 8494 → the same instant in "
         "Saudi time (our first sight: 2026-11-09 06:09 UTC)"],
        [[None], None,
         "not among the feed's 10 items → NULL; the page's «إعلان 8494 - 08/11/2026» (changed date) and "
         "«تاريخ إنتهاء الإعلان 2027-02-06» are never used"],
    ],
}

_SHOMOU_SPD = '__import__("scrapers.common.posting_date", fromlist=["site_posting_date"]).site_posting_date'
MUTATIONS |= {
    "shomou": [
        ["shomou reading the page's «إعلان N - DD/MM/YYYY» (node CHANGED) as the posting date", "scrapers/shomou/run.py",
         '"date_added": posting_date(d.get("posted_raw")),',
         '"date_added": ' + _SHOMOU_SPD + '(d.get("posted")),',
         [None]],
        ["shomou reading «تاريخ إنتهاء الإعلان» (the ad's END date) as the posting date", "scrapers/shomou/run.py",
         '"date_added": posting_date(d.get("posted_raw")),',
         '"date_added": ' + _SHOMOU_SPD + '(d.get("end_date")),',
         [None]],
    ],
}
