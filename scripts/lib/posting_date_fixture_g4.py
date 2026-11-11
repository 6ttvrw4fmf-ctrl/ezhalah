"""Posting-date fixtures, group 4. Contract: scripts/lib/posting_date_fixture_more.py.

Sites: opensooq, albdah, almotmkenah, ego, marksa, moftah, aalbarrak, almuteb, masar, remal, suwar,
shatri, alsidra, awal, steam, erapulse, wslnaa, expattrusted. Where a real page / record was read
live it is stored under scrapers/<site>/testdata/ (contact numbers and private names removed) and
only the date is varied; moftah (domain expired), aalbarrak and masar (JS challenge) and almuteb
(NXDOMAIN) could not be re-read, so their input is the smallest record the mapper accepts, carrying
the value our stored rows hold from the site's own API.
"""
import copy
import json
import os
import re

_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")


def _json(*parts):
    with open(os.path.join(_ROOT, *parts), encoding="utf-8") as fh:
        return json.load(fh)


def _text(*parts):
    with open(os.path.join(_ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


def _seed(*cities):
    # The shared stub (_seed_catalog) names only جدة and الأحساء. A non-empty catalog map
    # short-circuits arabic_location._load(), so adding the cities these records name stays offline.
    from scrapers.common import arabic_location as al
    ids = {"الرياض": (11, 1), "تبوك": (41, 7), "بريدة": (21, 4), "الخبر": (31, 5)}
    for c in cities:
        al._CITY.setdefault(al.norm_ar(c), [ids[c]])


def _seed_riyadh():
    _seed("الرياض")


# ── opensooq: the stored real SERP item 287056816 (PII fields are never captured) ──────────────────
def opensooq_args(inserted_date, posted_at="13-09-2026", expired_at="12-11-2026"):
    x = copy.deepcopy(_json("scrapers", "opensooq", "testdata", "287056816.serp-item.json"))
    x.pop("inserted_date", None)
    if inserted_date is not None:
        x["inserted_date"] = inserted_date
    x["posted_at"], x["expired_at"] = posted_at, expired_at
    return [x]


def _opensooq(mod, args):
    _seed("تبوك")
    got, why = mod.map_listing(*args)
    return (got[0] if got else None), why


# ── albdah: an excerpt of the real ad page 05rLV (the office phone removed) ──────────────────────
_ALBDAH_ROW = '<div class="row"><span class="k">تاريخ الإضافة</span><span class="v">2026/11/07</span></div>'


def albdah_args(posted, section_after_box=False):
    page = _text("scrapers", "albdah", "testdata", "05rLV.details.excerpt.html")
    row = "" if posted is None else _ALBDAH_ROW.replace("2026/11/07", posted)
    page = page.replace(_ALBDAH_ROW, row, 1)
    if section_after_box:   # the layout where a location section follows the details box (59ZCP)
        i = page.index('<div class="box rows">')
        j = page.index("</div>", page.index(row, i) + len(row) if row else i) + len("</div>")
        page = page[:j] + '\n<div class="sec-h"><h2>الموقع</h2><span class="line"></span></div>' + page[j:]
    return [page]


def _albdah(mod, args):
    _seed("بريدة")
    row, _category, why = mod.map_listing("villa", mod.parse_detail(args[0]))
    return row, why


# ── almotmkenah: an excerpt of the real ad page MTM50 / d=407 (phones removed) ────────────────────
def almotmkenah_args(entry_date, last_update="20-12-2025 19:46"):
    page = _text("scrapers", "almotmkenah", "testdata", "407.annonce.excerpt.html")
    page = page.replace("تاريخ الادخال: 8-10-2025", f"تاريخ الادخال: {entry_date}" if entry_date else "", 1)
    page = page.replace("آخر تحديث: 20-12-2025 19:46", f"آخر تحديث: {last_update}" if last_update else "", 1)
    return [page]


def _almotmkenah(mod, args):
    _seed_riyadh()
    raw = mod.parse_detail(args[0])
    raw["listing_url"] = "https://almotmkenah.com/annonce/x-50"
    row, _category, why = mod.map_listing(raw)
    return row, why


# ── ego: the real unit record 2472 (advertiser name, phone and user id removed) ──────────────────
def ego_args(created_at, license_start="08 Nov 2026"):
    rec = copy.deepcopy(_json("scrapers", "ego", "testdata", "2472.unit.json"))
    rec.pop("createdAt", None)
    if created_at is not None:
        rec["createdAt"] = created_at
    rec["licenseStartDate"] = license_start
    return [rec]


def _ego(mod, args):
    _seed("الخبر")
    row, _category, why = mod.map_listing(*args)
    return row, why


# ── marksa: an excerpt of the real detail page 881 + its «العروض» card (as parse_cards reads it) ──
def marksa_args(card_date):
    page = _text("scrapers", "marksa", "testdata", "881.showitem.excerpt.html")
    card = {"id": "881", "title": "مشروع صاري 2 ( شقق )", "locat": "جدة - صاري"}
    if card_date is not None:
        card["date"] = card_date
    return [card, page]


def _marksa(mod, args):
    row, _category, why = mod.map_listing(args[0], mod.parse_detail(args[1]))
    return row, why


# ── moftah: the smallest Store-API product the mapper takes, specs as stored for MFT30198 ─────────
def moftah_args(added):
    specs = {"نوع العقار": "فيلا", "التأثيث": "غير مفروش", "نوع السكن": "عوائل", "حالة البناء": "جاهز",
             "رقم بيوت المرجعي": "87899196"}
    if added is not None:
        specs["تاريخ الإضافة"] = added
    return [{"id": 30198, "name": "فيلا للبيع _شارع رقم 1240_حي سدرة_الرياض_مساحة 300 م2",
             "permalink": "https://moftah-aleaqar.com/property/x/", "description": "", "short_description": "",
             "images": [], "attributes": [{"name": k, "terms": [{"name": v}]} for k, v in specs.items()]}]


def _moftah(mod, args):
    _seed_riyadh()
    row, _category, why = mod.map_listing(*args)
    return row, why


# ── aalbarrak / almuteb: the smallest /wp/v2/properties post (Houzez) + its taxonomy names ─────────
def _houzez_args(date_gmt, modified_gmt, type_ar):
    post = {"id": 20472, "status": "publish", "link": "https://example.invalid/property/x/",
            "title": {"rendered": f"{type_ar} للبيع في حي النرجس"}, "content": {"rendered": "<p>للبيع</p>"},
            "property_status": [1], "property_type": [2], "property_city": [3],
            "property_meta": {"fave_property_price": ["2500000"]}, "modified_gmt": modified_gmt}
    if date_gmt is not None:
        post["date_gmt"] = date_gmt
    tax = {"property_status": {1: "للبيع"}, "property_type": {2: type_ar}, "property_city": {3: "الرياض"}}
    return [post, tax, []]


def aalbarrak_args(date_gmt, modified_gmt="2026-05-02T12:19:02"):
    return _houzez_args(date_gmt, modified_gmt, "فيلا")


def almuteb_args(date_gmt, modified_gmt="2026-03-26T10:44:06"):
    return _houzez_args(date_gmt, modified_gmt, "فيلا")


def _houzez(mod, args):
    _seed_riyadh()
    row, _category, why = mod.map_listing(*args)
    return row, why


# ── masar: the smallest /wp/v2/aqar post ─────────────────────────────────────────────────────────
def masar_args(date_gmt, modified_gmt="2025-08-12T19:39:49"):
    post = {"id": 2783, "status": "publish", "slug": "x", "link": "https://masaraqarat.com/aqar/x/",
            "title": {"rendered": "شقة للإيجار"}, "content": {"rendered": "<p>شقة للإيجار في الرياض حي النرجس</p>"},
            "class_list": ["aqar_type-for-rent"], "modified_gmt": modified_gmt}
    if date_gmt is not None:
        post["date_gmt"] = date_gmt
    return [post, {}, []]


def _masar(mod, args):
    _seed_riyadh()
    row, _category, why = mod.map_listing(*args)
    return row, why


# ── remal: the real REST post 6660 (/wp-json/wp/v2/estate, licence numbers removed) ─────────────
def remal_args(date_gmt, modified_gmt="2025-12-14T18:09:52"):
    post = copy.deepcopy(_json("scrapers", "remal", "testdata", "6660.rest-estate.json"))
    for k in ("date", "date_gmt"):
        post.pop(k, None)
    if date_gmt is not None:
        post["date"] = post["date_gmt"] = date_gmt
    post["modified"] = post["modified_gmt"] = modified_gmt
    return [post]


# ── suwar: the real REST post 22760 (/wp-json/wp/v2/property, embedded terms trimmed) + its page ─
def suwar_args(date_gmt, modified_gmt="2026-10-06T15:31:50"):
    post = copy.deepcopy(_json("scrapers", "suwar", "testdata", "22760.rest-property.json"))
    for k in ("date", "date_gmt"):
        post.pop(k, None)
    if date_gmt is not None:
        post["date"] = post["date_gmt"] = date_gmt
    post["modified"] = post["modified_gmt"] = modified_gmt
    detail = {"price": 420000, "status": "متاح", "address": "مكة المكرمة - الرصيفة",
              "text": "شقق تمليك المساحة / 160 م الغرف / 4 دورات المياه / 3"}
    return [post, detail]


# ── shatri: the real REST post 22238 (/wp-json/wp/v2/properties); type term 90 read live by id ──
def shatri_args(date_gmt, modified_gmt="2026-08-27T09:05:20"):
    post = copy.deepcopy(_json("scrapers", "shatri", "testdata", "22238.rest-property.json"))
    for k in ("date", "date_gmt"):
        post.pop(k, None)
    if date_gmt is not None:
        post["date"] = post["date_gmt"] = date_gmt
    post["modified"] = post["modified_gmt"] = modified_gmt
    terms = {"property_type": {90: "شقق تحت الانشاء جدة"}}
    return [post, terms, {}]


# ── alsidra: the real REST post 21272 (/?rest_route=/wp/v2/عقارات); terms 109/115 read live by id ─
def alsidra_args(date_gmt, modified_gmt="2026-09-30T10:30:35"):
    post = copy.deepcopy(_json("scrapers", "alsidra", "testdata", "21272.rest-property.json"))
    for k in ("date", "date_gmt"):
        post.pop(k, None)
    if date_gmt is not None:
        post["date"] = post["date_gmt"] = date_gmt
    post["modified"] = post["modified_gmt"] = modified_gmt
    terms = {"property_type": {109: "دبلكس"}, "property_status": {115: "للبيع"}}
    return [post, terms, {}]


# ── awal: the real REST post 19725 (/wp-json/wp/v2/rtcl_listing) + its page's own listing element ─
def awal_args(date_gmt, modified_gmt="2026-02-14T14:26:57"):
    post = copy.deepcopy(_json("scrapers", "awal", "testdata", "19725.rest-listing.json"))
    for k in ("date", "date_gmt"):
        post.pop(k, None)
    if date_gmt is not None:
        post["date"] = post["date_gmt"] = date_gmt
    post["modified"] = post["modified_gmt"] = modified_gmt
    # the detail page's own listing element, verbatim from https://awaalun.com/property/بيت-للبيع/
    body = ('<div id="rtcl-listing-19725" class="listing-item rtcl-listing-item post-19725 '
            'status-publish is-sell rtcl_category-building rtcl_location-arar rtcl_ad_type-sell">')
    return [post, body]


# ── steam: an excerpt of the real ad page 17878 (Yoast graph + property sections, phones removed) ─
_STEAM_URL = ("https://steam-realestate.com/property/%d9%84%d9%84%d8%a7%d9%8a%d8%ac%d8%a7%d8%b1-%d8%b4%d9%82%d8%a9-"
              "%d9%85%d8%a4%d8%ab%d8%ab%d9%87-3-%d8%ba%d8%b1%d9%81-%d8%a8%d8%a7%d9%84%d8%ad%d9%85%d8%b1%d8%a7-"
              "%d8%a7%d9%84%d8%ae%d8%a8%d8%b1/")


def steam_args(date_published, date_modified="2026-08-19T10:35:32+00:00"):
    page = _text("scrapers", "steam", "testdata", "17878.property.excerpt.html")
    page = re.sub(r'"datePublished":"[^"]*",?', "", page)
    page = re.sub(r'"dateModified":"[^"]*"', f'"dateModified":"{date_modified}"', page)
    if date_published is not None:
        page = page.replace('"dateModified":', f'"datePublished":"{date_published}","dateModified":', 1)
    return ["للايجار-شقة-مؤثثه-3-غرف-بالحمرا-الخبر", _STEAM_URL, page]


def _steam(mod, args):
    got, why = mod.map_property(args[0], args[1], mod.parse_property(args[2]))
    return (got[0] if got else None), why


# ── erapulse: the real list-API record REF-MVSCCSNQ-2JJTS (read live 2026-11-09) ─────────────────
def erapulse_args(published_at, created_at="2026-10-28T16:41:08.000Z", updated_at="2026-10-28T16:51:20.000Z"):
    p = copy.deepcopy(_json("scrapers", "erapulse", "testdata", "REF-MVSCCSNQ-2JJTS.list-item.json"))
    p["publishedAt"], p["createdAt"], p["updatedAt"] = published_at, created_at, updated_at
    return [p]


# ── wslnaa: the real tRPC bySlug record commercial-building-sale-dar-albaida-riyadh ───────────────
def wslnaa_args(created_at, updated_at="2026-10-05T14:32:58.000Z", scheduled_at=None):
    p = copy.deepcopy(_json("scrapers", "wslnaa", "testdata",
                            "commercial-building-sale-dar-albaida-riyadh.bySlug.json"))
    p["createdAt"], p["updatedAt"], p["scheduledAt"] = created_at, updated_at, scheduled_at
    p["mapUrl"] = None          # the mapper follows a maps short link over the network; no link → pin_absent
    return [p]


def _wslnaa(mod, args):
    _seed_riyadh()
    row, _category, why = mod.map_listing(*args)
    return row, why


# ── expattrusted: the real pageProps.property of ishbilia-village-compound (trimmed, no contacts) ──
def expattrusted_args(published_at, created_at="2025-01-27T16:35:27.208Z", updated_at="2025-02-14T01:07:54.627Z"):
    prop = copy.deepcopy(_json("scrapers", "expattrusted", "testdata", "ishbilia-village-compound.property.json"))
    prop["publishedAt"], prop["createdAt"], prop["updatedAt"] = published_at, created_at, updated_at
    return [prop, "https://expattrustedhousingriyadh.com/p/en/property/ishbilia-village-compound"]


def _expattrusted(mod, args):
    _seed_riyadh()
    rows, skipped = mod.map_compound(*args)
    return (rows[0][0] if rows else None), json.dumps(skipped)


PLATFORMS = {
    "opensooq": ("scrapers.opensooq.run", opensooq_args, _opensooq),
    "albdah": ("scrapers.albdah.run", albdah_args, _albdah),
    "almotmkenah": ("scrapers.almotmkenah.run", almotmkenah_args, _almotmkenah),
    "ego": ("scrapers.ego.run", ego_args, _ego),
    "marksa": ("scrapers.marksa.run", marksa_args, _marksa),
    "moftah": ("scrapers.moftah.run", moftah_args, _moftah),
    "aalbarrak": ("scrapers.aalbarrak.run", aalbarrak_args, _houzez),
    "almuteb": ("scrapers.almuteb.run", almuteb_args, _houzez),
    "masar": ("scrapers.masar.run", masar_args, _masar),
    "remal": ("scrapers.remal.run", remal_args, lambda m, a: (m.map_listing(a[0], {})[0], "")),
    "suwar": ("scrapers.suwar.run", suwar_args, lambda m, a: (m.map_listing(*a)[0], "")),
    "steam": ("scrapers.steam.run", steam_args, _steam),
    "awal": ("scrapers.awal.run", awal_args, lambda m, a: (m.map_listing(*a)[0], "")),
    "alsidra": ("scrapers.alsidra.run", alsidra_args,
                lambda m, a: (lambda r: (r[0], r[2]))(m.map_listing(*a))),
    "shatri": ("scrapers.shatri.run", shatri_args,
               lambda m, a: (lambda r: (r[0], r[2]))(m.map_listing(*a, this_year=2026))),
    "erapulse": ("scrapers.erapulse.run", erapulse_args, lambda m, a: (m.map_listing(*a)[0], "")),
    "wslnaa": ("scrapers.wslnaa.run", wslnaa_args, _wslnaa),
    "expattrusted": ("scrapers.expattrusted.run", expattrusted_args, _expattrusted),
}

CASES = {
    "opensooq": [
        [["2026-09-12"], "2026-09-12",
         "inserted_date on SERP item 287056816 (first seen 2026-09-27) → the Saudi day as published"],
        [[None], None, "no inserted_date → NULL, the ad still maps"],
        [[None, "13-09-2026"], None,
         "only posted_at — the page's «تاريخ النشر», re-stamped after the ad is public → NULL"],
        [[None, "قبل ساعة"], None, "only a relative posted_at → NULL"],
    ],
    "albdah": [
        [["2026/11/07"], "2026-11-07",
         "«تاريخ الإضافة 2026/11/07» read live on 05rLV, whose details box is the page's last section"],
        [["2026/10/27", True], "2026-10-27",
         "59ZCP's layout (a location section follows the box) still reads, year/month/day"],
        [[None], None, "no «تاريخ الإضافة» row → NULL, the ad still maps"],
        [["قبل يومين"], None, "a relative value is never converted → NULL"],
    ],
    "almotmkenah": [
        [["8-10-2025"], "2025-10-08", "«تاريخ الادخال: 8-10-2025» read live on MTM50 → day-month-year"],
        [["21-12-2025"], "2025-12-21", "MTM35's live «21-12-2025» — the day > 12 that fixes the order"],
        [[None], None, "no entry date → NULL, the ad still maps"],
        [[None, "20-12-2025 19:46"], None, "only «آخر تحديث» (the last edit) → NULL"],
    ],
    "ego": [
        [["08 Nov 2026 - 09:32:22 AM"], "2026-11-08T09:32:22",
         "createdAt read live on unit 2472 — Saudi wall time (its photo reached S3 at 06:34:52 GMT)"],
        [["20 Oct 2026 - 08:46:15 PM"], "2026-10-20T20:46:15", "stored createdAt of unit 2467, a PM stamp"],
        [[None], None, "no createdAt → NULL, the ad still maps"],
        [[None, "08 Nov 2026"], None, "only licenseStartDate (the REGA licence) → NULL"],
    ],
    "marksa": [
        [["2022-02-06"], "2022-02-06", "the «العروض» card date of 881, read live → the day as published"],
        [[None], None, "a card with no date → NULL, the ad still maps"],
    ],
    "moftah": [
        [["18 فبراير 2026"], "2026-02-18", "spec «تاريخ الإضافة» as stored for MFT30198 → month name read"],
        [["٥ أغسطس ٢٠٢٥"], "2025-08-05", "Arabic-Indic digits and «أغسطس» read the same"],
        [[None], None, "no «تاريخ الإضافة» (9 of 13 products) → NULL, the ad still maps"],
        [["فبراير 2026"], None, "a month without a day is not a date → NULL"],
    ],
    "aalbarrak": [
        [["2026-02-14T17:09:11"], "2026-02-14T20:09:11+03:00",
         "date_gmt as stored from the site's API (first seen 2026-09-24) → the same instant in Saudi time"],
        [["2026-04-04T22:29:22"], "2026-04-05T01:29:22+03:00", "a late-evening UTC publish lands on the Saudi day"],
        [[None], None, "no date_gmt → NULL, the ad still maps"],
        [[None, "2026-06-20T22:17:47"], None, "only modified_gmt (an edit) → NULL"],
    ],
    "almuteb": [
        [["2025-11-15T15:54:55"], "2025-11-15T18:54:55+03:00",
         "date_gmt as stored from the site's API (first seen 2026-09-24) → Saudi time"],
        [[None], None, "no date_gmt → NULL, the ad still maps"],
        [[None, "2026-02-28T19:07:51"], None, "only modified_gmt (an edit) → NULL"],
    ],
    "masar": [
        [["2025-04-30T05:38:56"], "2025-04-30T08:38:56+03:00",
         "date_gmt as stored from the site's API (first seen 2026-09-21) → Saudi time"],
        [[None], None, "no date_gmt → NULL, the ad still maps"],
        [[None, "2025-08-12T19:39:49"], None, "only modified_gmt (an edit, months later) → NULL"],
    ],
    "remal": [
        [["2024-09-29T06:53:19"], "2024-09-29T09:53:19+03:00",
         "date_gmt read live on remal 6660 (page prints «سبتمبر 29, 2024») → the same instant in Saudi time"],
        [["2024-09-29T22:10:00"], "2024-09-30T01:10:00+03:00",
         "a late-evening UTC publish lands on the Saudi day"],
        [[None], None, "no date_gmt → NULL, the ad still maps"],
        [[None, "2025-12-14T18:09:52"], None, "only modified_gmt (an edit) → NULL"],
    ],
    "suwar": [
        [["2026-10-06T15:31:50"], "2026-10-06T18:31:50+03:00",
         "date_gmt read live on suwar 22760 (first seen by us 2026-10-07 04:50 UTC) → Saudi time"],
        [["2026-11-06T23:51:15"], "2026-11-07T02:51:15+03:00",
         "live post 22845, published 23:51 UTC → the next Saudi day"],
        [[None], None, "no date_gmt → NULL, the ad still maps"],
        [[None, "2026-11-08T09:00:00"], None, "only modified_gmt (an edit) → NULL"],
    ],
    "shatri": [
        [["2026-08-26T17:49:13"], "2026-08-26T20:49:13+03:00",
         "date_gmt read live on shatri 22238 (first seen by us 2026-09-24 17:24 UTC) → Saudi time"],
        [["2026-10-31T17:40:35"], "2026-10-31T20:40:35+03:00",
         "live post 22261's date_gmt (first seen by us 2026-11-01 08:46 UTC) → Saudi time"],
        [["2026-08-27T21:30:00"], "2026-08-28T00:30:00+03:00",
         "a late-evening UTC publish lands on the Saudi day"],
        [[None], None, "no date_gmt → NULL, the ad still maps"],
        [[None, "2026-09-10T15:06:32"], None,
         "only modified_gmt (the page's «تحديث في سبتمبر 10, 2026» on 22251) → NULL"],
    ],
    "alsidra": [
        [["2026-09-30T10:30:35"], "2026-09-30T13:30:35+03:00",
         "date_gmt read live on alsidra 21272 (first seen by us 2026-10-01 04:24 UTC) → Saudi time"],
        [["2026-09-30T21:15:00"], "2026-10-01T00:15:00+03:00",
         "a late-evening UTC publish lands on the Saudi day"],
        [[None], None, "no date_gmt → NULL, the ad still maps"],
        [[None, "2026-11-03T14:18:28"], None, "only modified_gmt (an edit) → NULL"],
    ],
    "awal": [
        [["2026-02-14T14:23:24"], "2026-02-14T17:23:24+03:00",
         "date_gmt read live on awal 19725 (== its page's article:published_time …+00:00) → Saudi time"],
        [["2025-12-07T22:40:00"], "2025-12-08T01:40:00+03:00",
         "a late-evening UTC publish lands on the Saudi day"],
        [[None], None, "no date_gmt → NULL, the ad still maps"],
        [[None, "2026-02-14T14:26:57"], None, "only modified_gmt (the page's dateModified) → NULL"],
    ],
    "steam": [
        [["2026-08-01T13:45:42+00:00"], "2026-08-01T16:45:42+03:00",
         "Yoast WebPage datePublished read live on steam 17878 (first seen by us 2026-11-05) → Saudi time"],
        [["2026-07-16T21:02:59+00:00"], "2026-07-17T00:02:59+03:00",
         "live post 17546's datePublished, 21:02 UTC → the next Saudi day"],
        [[None], None, "no datePublished → NULL, the ad still maps"],
        [[None, "2026-08-19T10:35:32+00:00"], None,
         "only dateModified (the page's «تحديث في أغسطس 19, 2026 في 10:35 ص») → NULL"],
    ],
    "erapulse": [
        [["2026-10-28T16:51:20.000Z"], "2026-10-28T19:51:20+03:00",
         "publishedAt read live on REF-MVSCCSNQ-2JJTS → the same instant in Saudi time"],
        [["2026-10-24T21:40:22.000Z"], "2026-10-25T00:40:22+03:00",
         "a late-evening UTC publish lands on the Saudi day"],
        [[None], None, "no publishedAt (1 of 69 live records) → NULL, the ad still maps"],
        [[None, "2026-09-15T16:56:40.000Z", "2026-11-08T14:22:15.000Z"], None,
         "only createdAt (the draft) and updatedAt (an edit) → NULL, neither is the posting"],
    ],
    "wslnaa": [
        [["2026-10-05T14:32:58.000Z"], "2026-10-05T17:32:58+03:00",
         "createdAt read live on commercial-building-sale-dar-albaida-riyadh → Saudi time"],
        [[None], None, "no createdAt → NULL, the ad still maps"],
        [[None, "2026-11-01T09:00:00.000Z"], None, "only updatedAt (an edit) → NULL"],
        [["2026-10-05T14:32:58.000Z", "2026-10-05T14:32:58.000Z", "2026-10-20T06:00:00.000Z"], None,
         "a scheduled record goes live after it was created → UNKNOWN → NULL, never createdAt"],
    ],
    "expattrusted": [
        [["2025-01-27T16:49:46.972Z"], "2025-01-27T19:49:46+03:00",
         "Strapi publishedAt read live on ishbilia-village-compound → Saudi time"],
        [[None], None, "no publishedAt → NULL, the unit type still maps"],
        [[None, "2025-01-27T16:35:27.208Z", "2026-11-01T09:00:00.000Z"], None,
         "only createdAt (the draft) and updatedAt (an edit) → NULL"],
    ],
}
