"""Posting-date fixtures, group 3. Contract: scripts/lib/posting_date_fixture_more.py.

Every builder reads a real record saved from the live site on 2026-11-09 (PII removed) under
scrapers/<site>/testdata/, or — where the scraper reads a JSON API — the smallest record its mapper
accepts, with values copied from a live record. No network, no database.
"""
import copy
import json
import os

_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")


def _load(site, name):
    with open(os.path.join(_ROOT, "scrapers", site, "testdata", name), encoding="utf-8") as fh:
        return json.load(fh)


def _set(rec, key, value):
    """A copy of rec with `key` set to value, or removed when value is None."""
    rec = copy.deepcopy(rec)
    rec.pop(key, None)
    if value is not None:
        rec[key] = value
    return rec


# ── manzo: detail record of long_term_rent-80m2-JoZJ5Qoy (lister/borders/phones removed) ──────────
def manzo_args(listing_date, licence_expires="2027-07-26T00:00:00Z"):
    d = _set(_load("manzo", "JoZJ5Qoy.detail.json"), "listing_date", listing_date)
    d["ad_licence_expires_at"] = licence_expires
    return [d]


def _manzo(m, a):
    res, why = m.map_property(*a)
    return (res[0] if res else None), why


# ── wahadat: مرزم فلل المرسلات project page parsed by parse_project + its unit 328cdfb9 ────────────
def wahadat_args(created_at, updated_at="2026-11-04T14:10:47.582877+03:00"):
    t = _load("wahadat", "marzam-unit-328cdfb9.parsed.json")
    unit = _set(t["unit"], "created_at", created_at)
    unit["updated_at"] = updated_at
    return [t["project"], unit]


def _wahadat(m, a):
    proj, unit = a
    ptype, why = m.resolve_type(proj)
    if not ptype:
        return None, why
    row, _cat = m.map_unit(proj, unit, ptype)
    return row, ""


# ── sanadak: the RSC listing object of 7100296212 (seller fields + phone in the prose removed) ────
def sanadak_args(creation, last_update="0001-01-01T00:00:00+00:00"):
    o = _set(_load("sanadak", "7100296212.rsc-listing.json"), "creationDateTime", creation)
    o["lastUpdateDateTime"] = last_update
    url = ("https://sanadak.sa/property-details/"
           "شقَّة-صغيرة-(استوديو)-للإيجار-في-الرياض-النزهة-1-غرفة-7100296212")
    return [o, "", url]


# ── sirdab: the ad object of 302869aa from its own page's RSC payload (owner phone removed) ───────
def sirdab_args(created_at, available_from=None):
    a = _set(_load("sirdab", "302869aa.ad.json"), "created_at", created_at)
    a["available_from"] = available_from
    return [a]


def _sirdab(m, a):
    res, why = m.map_ad(*a)
    return (res[0] if res else None), why


# ── the Nuzul engine (abwbna, aldarim, alobid, bahadhabab: one copy each; goldendeal + yameen: one
#    shared mapper): one live API item per tenant, WhatsApp/advertiser numbers removed ───────────
def _nuzul(site, pid):
    def build(created_at, updated_at=None):
        L = _set(_load(site, f"{pid}.api-item.json"), "created_at", created_at)
        if updated_at is not None:
            L["updated_at"] = updated_at
        if site == "yameen":             # the fixture catalogue knows only جدة / الأحساء
            L["city"] = dict(L.get("city") or {}, name_ar="جدة")
        return [L]
    return build


def _two(m, a):
    row, _cat = m.map_listing(*a)
    return row, ""


def _three(m, a):
    row, _cat, why = m.map_listing(*a)
    return row, why


def _three_marker(m, a):
    row, _cat, _gone = m.map_marker(*a)
    return row, ""


def _three_marker_like(m, a):            # satel: (row, category, gone)
    row, _cat, _gone = m.map_listing(*a)
    return row, ""


# ── eilmalriyada: /api/recent/683 (prose trimmed) ───────────────────────────────────────────────
def eilmalriyada_args(created_at, updated_at="2026-10-27T15:33:20.000000Z"):
    it = _set(_load("eilmalriyada", "683.recent.json"), "created_at", created_at)
    it["updated_at"] = updated_at
    it["location"] = "ضاحية الخزام - جدة"   # the fixture catalogue knows only جدة / الأحساء (live: الرياض)
    return [it, None]


# ── ebriza: list item 787 (agent / phone / deed fields removed) ─────────────────────────────────
def ebriza_args(created_at, creation_date="31/10/2026"):
    it = _set(_load("ebriza", "787.list-item.json"), "created_at", created_at)
    it["creationDate"] = creation_date
    return [it]


# ── justsa: catalogue unit 738 (J1562) ──────────────────────────────────────────────────────────
def justsa_args(created_at, updated_at="2026-11-04 11:00:50"):
    u = _set(_load("justsa", "738.catalogue-unit.json"), "created_at", created_at)
    u["updated_at"] = updated_at
    u["city"] = "جدة"                        # the fixture catalogue knows only جدة / الأحساء (live: الرياض)
    return [u, None]


# ── ramzalqasim: marker 272 from /maps page 1 (owner name/phone removed) ────────────────────────
def ramzalqasim_args(created_at, updated_at="2026-11-01T14:39:22.000000Z"):
    rec = _set(_load("ramzalqasim", "272.marker.json"), "created_at", created_at)
    rec["updated_at"] = updated_at
    return [rec]


# ── rawasidark: catalog object cmrvc7lr6… with the page's «$D» date sentinels ─────────────────
def rawasidark_args(created_at, updated_at="$D2026-11-09T05:50:32.626Z"):
    o = _set(_load("rawasidark", "cmrvc7lr6.catalog-object.json"), "createdAt", created_at)
    o.pop("_note", None)
    o["updatedAt"] = updated_at
    return [o]


def _rawasidark(m, a):
    res = m.map_object(*a)
    return (res[0] if res else None), ""


# ── aouj: API object 1456 ───────────────────────────────────────────────────────────────────────
def aouj_args(date):
    return [_set(_load("aouj", "1456.api-item.json"), "date", date)]


def _aouj(m, a):
    row, why = m.map_item(*a)
    return row, ("" if row else why)


# ── satel: filter-feed item C0109 (publishedOn lives only in the detail record) ─────────────────
def satel_args(created_at, published_on=None):
    p = _set(_load("satel", "C0109.filter-item.json"), "createdAt", created_at)
    if published_on is not None:
        p["publishedOn"] = published_on
    return [p]


# ── alhoshan: search item 1047 (advertiser / brokerage blocks removed) ─────────────────────────
def alhoshan_args(created_at, price_changed="2026-09-19T22:10:11.802388Z"):
    p = _set(_load("alhoshan", "1047.search-item.json"), "createdAt", created_at)
    p["lastPriceChangedAt"] = price_changed
    return [p]


# ── azdad: row AD202611020001 from its own page payload (owner fields removed) ─────────────────
def azdad_args(created_at, updated_at="2026-11-03T13:39:34.551+00:00"):
    L = _set(_load("azdad", "AD202611020001.row.json"), "created_at", created_at)
    L["updated_at"] = updated_at
    return [L]


# ── fursaghyr: fgh feed item 27748 (advertiser id / name / phone removed) ──────────────────────
def fursaghyr_args(created_at, licence_start="26/10/2026"):
    it = _set(_load("fursaghyr", "27748.fgh-item.json"), "created_at", created_at)
    it["updated_at"] = created_at
    it["rea"] = dict(it.get("rea") or {}, license_start=licence_start)
    return [it]


# ── hazim: Base44 entity 6a3120a0… (ref 1127; agent fields removed) ────────────────────────────
def hazim_args(created_date, updated_date="2026-06-20T11:22:42.470000"):
    p = _set(_load("hazim", "6a3120a0.entity.json"), "created_date", created_date)
    p["updated_date"] = updated_date
    p["city"] = "جدة"                        # the fixture catalogue knows only جدة / الأحساء (live: الدمام)
    return [p]


PLATFORMS = {
    "manzo": ("scrapers.manzo.run", manzo_args, _manzo),
    "wahadat": ("scrapers.wahadat.run", wahadat_args, _wahadat),
    "sanadak": ("scrapers.sanadak.run", sanadak_args, lambda m, a: (m.map_listing(*a)[0], "")),
    "sirdab": ("scrapers.sirdab.run", sirdab_args, _sirdab),
    "abwbna": ("scrapers.abwbna.run", _nuzul("abwbna", 55210), _two),
    "aldarim": ("scrapers.aldarim.run", _nuzul("aldarim", 55063), _two),
    "alobid": ("scrapers.alobid.run", _nuzul("alobid", 27909), _two),
    "bahadhabab": ("scrapers.bahadhabab.run", _nuzul("bahadhabab", 39116), _two),
    "goldendeal": ("scrapers.goldendeal.run", _nuzul("goldendeal", 48712), _three),
    "yameen": ("scrapers.yameen.run", _nuzul("yameen", 39907), _three),
    "eilmalriyada": ("scrapers.eilmalriyada.run", eilmalriyada_args, _three),
    "ebriza": ("scrapers.ebriza.run", ebriza_args, _three),
    "justsa": ("scrapers.justsa.run", justsa_args, _three),
    "ramzalqasim": ("scrapers.ramzalqasim.run", ramzalqasim_args, _three_marker),
    "rawasidark": ("scrapers.rawasidark.run", rawasidark_args, _rawasidark),
    "aouj": ("scrapers.aouj.run", aouj_args, _aouj),
    "satel": ("scrapers.satel.run", satel_args, _three_marker_like),
    "alhoshan": ("scrapers.alhoshan.run", alhoshan_args, _two),
    "azdad": ("scrapers.azdad.run", azdad_args, _two),
    "fursaghyr": ("scrapers.fursaghyr.run", fursaghyr_args, _two),
    "hazim": ("scrapers.hazim.run", hazim_args, _three),
}

CASES = {
    "manzo": [
        [["2026-11-07T14:42:47.378618Z"], "2026-11-07T17:42:47+03:00",
         "listing_date read live on JoZJ5Qoy (= the page's JSON-LD datePosted) → the same instant in Saudi time"],
        [["2026-11-08T22:30:00.000000Z"], "2026-11-09T01:30:00+03:00",
         "a late-evening UTC listing lands on the Saudi day"],
        [[None], None, "no listing_date → NULL, the ad still maps"],
        [[None, "2027-07-26T00:00:00Z"], None,
         "only ad_licence_expires_at (the REGA licence) → NULL"],
    ],
    "wahadat": [
        [["2026-11-04T14:10:47.582858+03:00"], "2026-11-04T14:10:47+03:00",
         "unit created_at read live (the page's datePosted 2026-11-04T14:09:31+03:00 is the same minute)"],
        [[None], None, "no created_at → NULL, the unit still maps"],
        [[None, "2026-11-07T17:03:50.052515+03:00"], None, "only updated_at (an edit) → NULL"],
    ],
    "sanadak": [
        [["2026-11-08T13:36:21.489+00:00"], "2026-11-08T16:36:21+03:00",
         "creationDateTime read live on 7100296212 (page: «منذ يوم» on 2026-11-09) → Saudi time"],
        [["2026-11-08T13:26:25.38+00:00"], "2026-11-08T16:26:25+03:00",
         "a two-digit fraction as stored on 7100296248"],
        [[None], None, "no creationDateTime → NULL, the ad still maps"],
        [[None, "2026-11-08T14:09:11.122244+00:00"], None, "only lastUpdateDateTime (an edit) → NULL"],
    ],
    "sirdab": [
        [["2026-11-01T15:45:52.306996+00:00"], "2026-11-01T18:45:52+03:00",
         "ad created_at read live on 302869aa (= its page's JSON-LD datePosted) → Saudi time"],
        [[None], None, "no created_at → NULL, the ad still maps"],
        [[None, "2026-02-10"], None, "only available_from (the rental window) → NULL"],
    ],
    "abwbna": [
        [["2026-11-08T18:40:45.000000Z"], "2026-11-08T21:40:45+03:00",
         "created_at read live on abwbna 55210 (Nuzul API item) → the same instant in Saudi time"],
        [[None], None, "no created_at → NULL, the ad still maps"],
        [[None, "2026-11-08T18:43:10.000000Z"], None, "only updated_at (an edit) → NULL"],
    ],
    "aldarim": [
        [["2026-11-02T13:47:01.000000Z"], "2026-11-02T16:47:01+03:00",
         "created_at read live on aldarim 55063 (Nuzul API item) → the same instant in Saudi time"],
        [[None], None, "no created_at → NULL, the ad still maps"],
        [[None, "2026-11-02T13:50:55.000000Z"], None, "only updated_at (an edit) → NULL"],
    ],
    "alobid": [
        [["2025-04-30T06:37:02.000000Z"], "2025-04-30T09:37:02+03:00",
         "created_at read live on alobid 27909 (Nuzul API item) → the same instant in Saudi time"],
        [[None], None, "no created_at → NULL, the ad still maps"],
        [[None, "2025-05-03T14:54:38.000000Z"], None, "only updated_at (an edit) → NULL"],
    ],
    "bahadhabab": [
        [["2025-08-28T16:31:13.000000Z"], "2025-08-28T19:31:13+03:00",
         "created_at read live on bahadhabab 39116 (Nuzul API item) → the same instant in Saudi time"],
        [[None], None, "no created_at → NULL, the ad still maps"],
        [[None, "2025-08-28T17:05:46.000000Z"], None, "only updated_at (an edit) → NULL"],
    ],
    "goldendeal": [
        [["2026-05-03T23:51:47.000000Z"], "2026-05-04T02:51:47+03:00",
         "created_at read live on goldendeal 48712 (Nuzul API item) → the same instant in Saudi time"],
        [[None], None, "no created_at → NULL, the ad still maps"],
        [[None, "2026-08-01T12:38:59.000000Z"], None, "only updated_at (an edit) → NULL"],
    ],
    "yameen": [
        [["2025-10-07T06:01:24.000000Z"], "2025-10-07T09:01:24+03:00",
         "created_at read live on yameen 39907 (Nuzul API item) → the same instant in Saudi time"],
        [[None], None, "no created_at → NULL, the ad still maps"],
        [[None, "2026-10-14T09:20:20.000000Z"], None, "only updated_at (an edit) → NULL"],
    ],
    "eilmalriyada": [
        [["2026-10-27T15:33:20.000000Z"], "2026-10-27T18:33:20+03:00",
         "created_at read live on /api/recent/683 → the same instant in Saudi time"],
        [[None], None, "no created_at → NULL, the ad still maps"],
        [[None, "2026-10-28T09:00:00.000000Z"], None, "only updated_at (an edit) → NULL"],
    ],
    "ebriza": [
        [["2026-11-01 14:50:59"], "2026-11-01 14:50:59",
         "created_at read live on 787: zone-less and Saudi time (photo upload epoch 11:50:06Z) → kept as published"],
        [[None], None, "no created_at → NULL, the ad still maps"],
        [[None, "31/10/2026"], None, "only creationDate (the REGA licence date) → NULL"],
    ],
    "justsa": [
        [["2026-10-12 20:29:22"], "2026-10-12 20:29:22",
         "created_at read live on 738 (its page prints 2026-10-12): zone-less Saudi time → kept as published"],
        [[None], None, "no created_at → NULL, the unit still maps"],
        [[None, "2026-11-04 11:00:50"], None, "only updated_at (an edit) → NULL"],
    ],
    "ramzalqasim": [
        [["2026-10-31T21:25:56.000000Z"], "2026-11-01T00:25:56+03:00",
         "created_at read live on /x/272 (marker JSON) — 21:25Z is already 11-01 in Saudi time"],
        [[None], None, "no created_at → NULL, the ad still maps"],
        [[None, "2026-11-01T14:39:22.000000Z"], None, "only updated_at (an edit) → NULL"],
    ],
    "rawasidark": [
        [["$D2026-07-22T00:21:34.815Z"], "2026-07-22T03:21:34+03:00",
         "createdAt as the page emits it («$D» sentinel) — the cuid id encodes the same instant"],
        [[None], None, "no createdAt → NULL, the ad still maps"],
        [[None, "$D2026-11-09T05:50:32.626Z"], None, "only updatedAt (a bulk rewrite) → NULL"],
    ],
    "aouj": [
        [["2026-10-31T07:47:05.852110+00:00"], "2026-10-31T10:47:05+03:00",
         "date read live on API object 1456 → the same instant in Saudi time"],
        [[None], None, "no date → NULL, the ad still maps"],
    ],
    "satel": [
        [["2026-10-24T11:37:59.282Z"], "2026-10-24T14:37:59+03:00",
         "createdAt read live on C0109 → the same instant in Saudi time"],
        [[None], None, "no createdAt → NULL, the ad still maps"],
        [[None, "2026-10-15T07:55:00.000Z"], None,
         "only publishedOn (re-stamped on a re-publish: A0105) → NULL"],
    ],
    "alhoshan": [
        [["2026-09-19T22:10:11.804396Z"], "2026-09-20T01:10:11+03:00",
         "createdAt read live on 1047 (= its page's article:published_time) → Saudi time, next day"],
        [[None], None, "no createdAt → NULL, the ad still maps"],
        [[None, "2026-10-01T08:00:00.000000Z"], None, "only lastPriceChangedAt (a price edit) → NULL"],
    ],
    "azdad": [
        [["2026-11-02T18:38:11.045325+00:00"], "2026-11-02T21:38:11+03:00",
         "created_at read live on AD202611020001 (its page: «تاريخ النشر: ٢/١١/٢٠٢٦»)"],
        [[None], None, "no created_at → NULL, the ad still maps"],
        [[None, "2026-11-03T13:39:34.551+00:00"], None, "only updated_at (an edit) → NULL"],
    ],
    "fursaghyr": [
        [["2026-10-29T15:15:54+00:00"], "2026-10-29T18:15:54+03:00",
         "created_at read live on post 27748 (= WordPress date_gmt) → Saudi time"],
        [[None], None, "no created_at → NULL, the ad still maps"],
        [[None, "26/10/2026"], None, "only rea.license_start (the REGA licence) → NULL"],
    ],
    "hazim": [
        [["2026-06-16T10:08:32.042000"], "2026-06-16T13:08:32+03:00",
         "created_date read live on ref 1127: zone-less UTC (= its ObjectId epoch) → marked Z → Saudi time"],
        [["2026-06-16T22:30:00.000000"], "2026-06-17T01:30:00+03:00",
         "a late-evening UTC creation lands on the next Saudi day"],
        [[None], None, "no created_date → NULL, the ad still maps"],
        [[None, "2026-06-20T11:22:42.470000"], None, "only updated_date (an edit) → NULL"],
    ],
}
