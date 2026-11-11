"""Posting-date fixtures, group 5. Contract: scripts/lib/posting_date_fixture_more.py."""
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
            al._CITY[key] = [(900 + i, 90 + i)]
            added.append(key)
    try:
        return fn()
    finally:
        for key in added:
            al._CITY.pop(key, None)


def _testdata(site, name):
    with open(os.path.join(_ROOT, "scrapers", site, "testdata", name), encoding="utf-8") as fh:
        return fh.read()


# ── dwelleo: the real detail record of 22869 (owner/contact removed) ─────────────────────────────
def dwelleo_args(date_posted):
    rec = json.loads(_testdata("dwelleo", "22869.detail.json"))
    rec = copy.deepcopy(rec)
    blocks = (rec.get("seo") or {}).get("structured_data_blocks") or []
    for b in blocks:
        b.pop("datePosted", None)
        if date_posted is not None:
            b["datePosted"] = date_posted
    return [rec]


# ── jurash: the real detail page of #132 (print_r dump + gallery; the share link's number zeroed) ───
def jurash_args(pt_date, pt_updated="2026-11-02 23:16:17"):
    body = _testdata("jurash", "132.detail.html")
    body = body.replace("[pt_date] => 2026-11-02 05:15:15", "[pt_date] => " + (pt_date or ""))
    body = body.replace("[16] => 2026-11-02 05:15:15", "[16] => " + (pt_date or ""))
    body = body.replace("[pt_updated] => 2026-11-02 23:16:17", "[pt_updated] => " + pt_updated)
    return [body, "https://jurash.sa/property/132/x"]


# ── mobasher: the real direct-sale feed row 6addd533… (seller, deed and account ids removed) ──────────
def mobasher_args(created, published=None, updated="2026-11-09T17:54:59.907Z"):
    row = json.loads(_testdata("mobasher", "6addd533c5a0553b3209c19d.feed-row.json"))
    for k in ("createdAtUtc", "publishedAtUtc", "sortDateUtc"):
        row.pop(k, None)
    if created is not None:
        row["createdAtUtc"] = created
    if published is not None:
        row["publishedAtUtc"] = row["sortDateUtc"] = published
    row["updatedAtUtc"] = updated
    return [row, {}]


def _mobasher(m, a):
    got, why = m.map_listing(*a)
    return (got[0] if got else None), why


# ── aqarnajran: the real WordPress post 494 (wp-json, the fields the scraper asks for) ─────────────
def aqarnajran_args(date_gmt, modified_gmt="2026-02-03T01:00:42"):
    post = json.loads(_testdata("aqarnajran", "494.wp-post.json"))
    post.pop("date", None)
    post.pop("date_gmt", None)
    if date_gmt is not None:
        post["date_gmt"] = date_gmt
    post["modified_gmt"] = modified_gmt
    return [post]


# ── amaall: the real Houzez property post 24146 (WhatsApp/edit meta removed; its terms in `_tax`) ───
def amaall_args(date_gmt, modified_gmt="2026-09-16T12:09:29"):
    post = json.loads(_testdata("amaall", "24146.wp-property.json"))
    tax = {k: {int(i): n for i, n in v.items()} for k, v in post.pop("_tax").items()}
    post.pop("date", None)
    post.pop("date_gmt", None)
    if date_gmt is not None:
        post["date_gmt"] = date_gmt
    post["modified_gmt"] = modified_gmt
    return [post, tax]


# ── flow: the real Granada «2 Bedroom» floorplan record (units' lease ladders trimmed) ─────────────
def flow_args(published_at, created_at="2025-05-30T19:50:36.747Z", updated_at="2026-11-09T22:35:05.982Z"):
    fp = json.loads(_testdata("flow", "C1ThyDRn8cT7nzvDUHcF.floorplan.json"))
    fp.pop("publishedAt", None)
    if published_at is not None:
        fp["publishedAt"] = published_at
    fp["createdAt"], fp["updatedAt"] = created_at, updated_at
    return [fp, "riyadh-granada", {}]


# ── ryadah: the real RealHomes post 9731 (owner/agent meta removed); `_page` = what parse_page read
#    from its live page, `_type_terms` = its property-type terms (both as stored for RYD9731) ─────
def ryadah_args(date_gmt, modified_gmt="2025-07-28T20:48:37"):
    post = json.loads(_testdata("ryadah", "9731.wp-property.json"))
    page, terms = post.pop("_page"), post.pop("_type_terms")
    post.pop("date", None)
    post.pop("date_gmt", None)
    if date_gmt is not None:
        post["date_gmt"] = date_gmt
    post["modified_gmt"] = modified_gmt
    return [post, page, terms]


def _ryadah(m, a):
    got, why = _with_cities(["الدمام"], lambda: m.map_property(*a))
    return (got[0] if got else None), why


PLATFORMS = {
    "dwelleo": ("scrapers.dwelleo.run", dwelleo_args, lambda m, a: (m.map_listing(*a)[0], "")),
    "jurash": ("scrapers.jurash.run", jurash_args, lambda m, a: (m.map_listing(*a)[0], "")),
    "mobasher": ("scrapers.mobasher.run", mobasher_args, _mobasher),
    "aqarnajran": ("scrapers.aqarnajran.run", aqarnajran_args,
                   lambda m, a: _with_cities(["نجران"], lambda: (m.map_listing(*a)[0], ""))),
    "amaall": ("scrapers.amaall.run", amaall_args, lambda m, a: (m.map_listing(*a)[0], "")),
    "flow": ("scrapers.flow.run", flow_args,
             lambda m, a: _with_cities(["الرياض"], lambda: (m.map_listing(*a)[0], ""))),
    "ryadah": ("scrapers.ryadah.run", ryadah_args, _ryadah),
}

CASES = {
    "dwelleo": [
        [["2026-11-03T17:12:30+03:00"], "2026-11-03T17:12:30+03:00",
         "datePosted read live on dwelleo 22869 (detail JSON-LD) → stored as published"],
        [["2026-11-03T21:30:00Z"], "2026-11-04T00:30:00+03:00",
         "a UTC stamp is re-expressed on the Saudi day"],
        [[None], None, "no datePosted (no detail fetched) → NULL even though the record still carries "
                       "ad_license_expires_at «2027-07-24» (a licence date) — the ad still maps"],
    ],
    "jurash": [
        [["2026-11-02 05:15:15"], "2026-11-02T15:15:15+03:00",
         "pt_date read live on jurash #132, server clock America/Denver (−7 in November) → Saudi time"],
        [["2026-06-17 07:53:11"], "2026-06-17T16:53:11+03:00",
         "live #87: summer −6 h — the creation photo property_1781704392 is 13:53:12 UTC"],
        [[""], None, "no pt_date → NULL, the ad still maps"],
        [["", "2026-11-08 10:00:00"], None, "only pt_updated (an edit) → NULL"],
    ],
    "mobasher": [
        [["2026-10-25T10:08:51.000Z"], "2026-10-25T13:08:51+03:00",
         "createdAtUtc read live on mobasher 6addd533… (= the ObjectId's own second) → Saudi time"],
        [[None], None, "no createdAtUtc → NULL, the ad still maps"],
        [[None, "2026-10-25T10:08:51.264Z", "2026-11-09T17:54:59.907Z"], None,
         "only publishedAtUtc/sortDateUtc (re-sortable) and updatedAtUtc (an edit) → NULL"],
    ],
    "aqarnajran": [
        [["2026-02-02T01:37:41"], "2026-02-02T04:37:41+03:00",
         "date_gmt read live on aqarnajran post 494 (UTC) → Saudi time"],
        [["2026-02-01T22:10:00"], "2026-02-02T01:10:00+03:00", "a late UTC evening lands on the Saudi day"],
        [[None], None, "no date_gmt → NULL, the ad still maps"],
        [[None, "2026-11-08T10:00:00"], None, "only modified_gmt (an edit) → NULL"],
    ],
    "amaall": [
        [["2026-09-16T07:20:06"], "2026-09-16T10:20:06+03:00",
         "date_gmt read live on amaall 24146 (= its page's datePublished …07:20:06+00:00) → Saudi time"],
        [[None], None, "no date_gmt → NULL, the ad still maps"],
        [[None, "2026-11-08T10:00:00"], None, "only modified_gmt (an edit) → NULL"],
    ],
    "flow": [
        [["2025-05-30T19:50:38.135Z"], "2025-05-30T22:50:38+03:00",
         "publishedAt read live on flow Granada «2 Bedroom» (CMS, UTC) → Saudi time"],
        [["2025-08-12T22:25:54.793Z", "2025-08-06T20:25:35.698Z"], "2025-08-13T01:25:54+03:00",
         "live Shams: a draft created 08-06 went public 08-12 22:25 UTC → the publish instant, Saudi day 08-13"],
        [[None], None, "no publishedAt → NULL (createdAt is a draft time, never a fallback)"],
        [[None, "2025-05-30T19:50:36.747Z", "2026-11-09T22:35:05.982Z"], None,
         "only createdAt / updatedAt (the per-sync edit stamp) → NULL"],
    ],
    "ryadah": [
        [["2022-09-20T09:30:41"], "2022-09-20T12:30:41+03:00",
         "date_gmt read live on ryadah 9731 (= its page's datePublished …09:30:41+00:00) → Saudi time"],
        [[None], None, "no date_gmt → NULL, the building still maps"],
        [[None, "2025-07-28T20:48:37"], None, "only modified_gmt (an edit) → NULL"],
    ],
}
