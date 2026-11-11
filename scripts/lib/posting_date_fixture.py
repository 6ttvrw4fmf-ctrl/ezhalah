"""Mapper INPUTS for verify-source-posting-date-is-written.ts — one per platform, no network.

Each builder returns the argument list the platform's REAL mapper takes; `mapped()` hands it to that
mapper — or to a mutated copy of the mapper's module — and reports what landed in `date_added`.
Nothing here maps or decides anything: the posting-date logic under test lives in the scrapers.

Why this file runs the mapper itself instead of leaving it to pythonMutant.ts: arkaan and sakan
resolve the city through the location catalog, which `arabic_location._load()` reads from the
database. The catalog has to be stubbed in the same process before the mapper runs (the repo's own
convention — scrapers/aqargate/test_gallery_fallback_and_order.py), and pythonMutant's runner has no
place to do that. The mutant is built exactly the way that runner builds one.

Where a real page is stored in the repo it is used (dealapp, aqarcity, sakan); the posting date is
then the one thing varied. arkaan, therc, mustqr, eydah and tawia have no stored page, so their input is the
smallest record their mapper accepts, in the shape the scraper's own docstring documents.
"""
import gzip
import importlib
import json
import os
import re
import types

_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")


def _read(*parts: str) -> str:
    with open(os.path.join(_ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


# ── dealapp: the stored real page 573551, with the listing schema's datePosted set ──────────────
def dealapp_args(date_posted):
    page = _read("scrapers", "dealapp", "testdata", "573551.excerpt.html")
    m = re.search(r'(<script id="ng-state" type="application/json">)(.*?)(</script>)', page, re.S)
    state = json.loads(m.group(2))
    sm = state["schemaMarkupScripts"]
    key = next(k for k in sm if k.startswith("real-estate-listing"))
    was_text = isinstance(sm[key], str)
    schema = json.loads(sm[key]) if was_text else sm[key]
    schema.pop("datePosted", None)
    if date_posted is not None:
        schema["datePosted"] = date_posted
    sm[key] = json.dumps(schema, ensure_ascii=False) if was_text else schema
    blob = json.dumps(state, ensure_ascii=False).replace("</", "<\\/")
    return [page[:m.start(2)] + blob + page[m.end(2):], "573551"]


# ── arkaan: (index card, detail page) ─────────────────────────────────────────────────────────
def arkaan_args(date_posted, last_updated="آخر تحديث قبل 3 أيام"):
    ld = {
        "@type": "RealEstateListing",
        "name": "فيلا للبيع في حي المحمدية",
        "offers": {"price": "950000", "priceCurrency": "SAR"},
        "contentLocation": {"address": {"addressLocality": "الأحساء"}},
        "image": [],
    }
    if date_posted is not None:
        ld["datePosted"] = date_posted
    item = {
        "id": "4242", "specs": {}, "ptype": "فيلا", "deal": "للبيع", "hood": "المحمدية",
        "title_text": "فيلا للبيع", "price_text": "950,000", "landno": "", "status": "",
        "last_updated": last_updated, "index_image": "",
    }
    detail = {"ld": ld, "type_text": "فيلا للبيع", "price_card": None, "lat": None, "lng": None,
              "area_text": None, "ad_text": None}
    return [item, detail]


# ── therc: (url, page, sitemap lastmod) ───────────────────────────────────────────────────────
def therc_args(date_posted, lastmod="2026-11-01T00:00:00+03:00"):
    ld = {
        "@context": "https://schema.org", "@type": "RealEstateListing",
        "name": "شقة للبيع في حي الصفا",
        "address": {"addressLocality": "جدة", "addressRegion": "الصفا"},
        "offers": {"price": "650000", "priceCurrency": "SAR"},
    }
    if date_posted is not None:
        ld["datePosted"] = date_posted
    page = ('<html><body><script type="application/ld+json">' + json.dumps(ld, ensure_ascii=False)
            + "</script><h1>شقة للبيع في حي الصفا</h1><div>رقم المرجع: AQ000001</div></body></html>")
    return ["https://therc.sa/ar/properties/aq000001", page, lastmod]


# ── mustqr: (API property, district→compass-region map) ───────────────────────────────────────
def mustqr_args(created_at, updated_at="2026-11-07T08:00:00.000000+00:00"):
    p = {"id": 4242, "type": "شقة", "category": "بيع", "usage_type": "سكني", "area_sqm": 180,
         "neighborhood": "النقرة", "title": "شقة للبيع", "price": 400000, "updated_at": updated_at}
    if created_at is not None:
        p["created_at"] = created_at
    return [p, {}]


# ── sakan: (url, page) for parse_page — the real page's own two JSON-LD blocks ────────────────
_SAKAN_URL = "https://sa.sakan.co/ar/property/details/100553-x"


def sakan_args(date_posted="2026-11-08", keep=True):
    page = _read("scrapers", "sakan", "testdata", "100553.ldjson.excerpt.html")
    stamp = '"datePosted": "2026-11-08",'
    assert stamp in page, "sakan fixture no longer carries its datePosted line"
    if not keep:
        page = page.replace(stamp, "")
    elif date_posted != "2026-11-08":
        page = page.replace(stamp, '"datePosted": ' + json.dumps(date_posted, ensure_ascii=False) + ",")
    return [_SAKAN_URL, page]


# ── aqarcity: (body, url) — the stored real page 30260 under the site's three layouts ─────────
_AC_URL = "https://www.aqarcity.net/property/30260"
_AC_STAMP = '"datePublished":"2026-07-15T17:05:16+03:00"'


def aqarcity_args(variant):
    with gzip.open(os.path.join(_ROOT, "scripts", "fixtures", "aqarcity-30260.html.gz"), "rb") as fh:
        body = fh.read().decode("utf-8", "replace")
    assert _AC_STAMP in body, "aqarcity fixture no longer carries its datePublished"
    if variant == "published":            # the page as stored: the old key
        pass
    elif variant == "posted":             # the live page since the redesign: same instant, new key, UTC
        body = body.replace(_AC_STAMP, '"datePosted":"2026-07-15T14:05:16.000Z"')
    elif variant == "cell":               # block silent, the page's own «تاريخ النشر» cell speaks
        body = body.replace(_AC_STAMP, '"x-none":""') + _read(
            "scrapers", "aqarcity", "testdata", "aqarcity_dl_layout_2026_10.excerpt.html")
    elif variant == "month-name":         # block silent, the older cell prints «٣٠ نوفمبر ٢٠٢٥»
        body = body.replace(_AC_STAMP, '"x-none":""') + _read(
            "scrapers", "aqarcity", "testdata", "aqarcity_grid_layout_2026_09.excerpt.html")
    elif variant == "silent":             # nothing anywhere
        body = body.replace(_AC_STAMP, '"x-none":""')
    else:
        raise ValueError(variant)
    return [body, _AC_URL]


# ── eydah: (href, parsed detail) ──────────────────────────────────────────────────────────────
def eydah_args(date_posted):
    ld = {
        "@type": "RealEstateListing", "name": "فيلا للبيع في حي الصفا",
        "description": "فيلا للبيع",
        "address": {"addressLocality": "جدة", "addressRegion": "الصفا"},
        "offers": {"price": 1200000, "availability": "https://schema.org/InStock"},
        "floorSize": {"value": 400},
    }
    if date_posted is not None:
        ld["datePosted"] = date_posted
    specs = {"نوع العقار": "فيلا", "الغرض": "بيع", "المدينة": "جدة", "الحي": "الصفا"}
    return ["/listing/a1b2.html", {"ld": ld, "specs": specs, "advertiser_fal_licence": None}]


# ── tawia: (parsed page) ──────────────────────────────────────────────────────────────────────
def tawia_args(date_posted):
    ld = {
        "@type": "RealEstateListing", "name": "فيلا - فيلا للبيع في حي الصفا",
        "description": "فيلا للبيع",
        "address": {"addressRegion": "جدة", "addressLocality": "الصفا"},
        "offers": {"price": "1200000", "availability": "https://schema.org/InStock",
                   "businessFunction": "http://purl.org/goodrelations/v1#Sell"},
        "floorSize": {"value": 400, "unitCode": "MTK"},
    }
    if date_posted is not None:
        ld["datePosted"] = date_posted
    return [{"pin": None, "id": "00000000-0000-0000-0000-000000000001", "ld": ld, "images": [],
             "name": "فيلا للبيع في حي الصفا", "purpose": "sale", "investment": None, "floor": None,
             "details": {}, "fal": None}]


def _tawia(mod, args):
    hit, why = mod.map_page(*args)
    return (hit[0] if hit else None), why


def _eydah(mod, args):
    row, _category, why = mod.map_listing(*args)
    return row, why


# ── run one platform's real mapper (or a mutated copy of its module) over one input ───────────
def _seed_catalog() -> None:
    from scrapers.common import arabic_location as al
    if not al._CITY:
        # Two cities are all these inputs name. A non-empty map short-circuits _load(): no database.
        al._CITY[al.norm_ar("جدة")] = [(1, 2)]
        al._CITY[al.norm_ar("الأحساء")] = [(3, 5)]


def _sakan(mod, args):
    row, _category, why = mod.map_listing(mod.parse_page(*args))
    return row, why


_PLATFORMS = {
    # platform: (module, input builder, call → (row, skip note))
    "dealapp": ("scrapers.dealapp.run", dealapp_args, lambda m, a: (m.map_listing(*a)[0], "")),
    "arkaan": ("scrapers.arkaan.run", arkaan_args, lambda m, a: ((m.map_listing(*a) or (None,))[0], "")),
    "therc": ("scrapers.therc.run", therc_args, lambda m, a: ((m.map_listing(*a) or (None,))[0], "")),
    "mustqr": ("scrapers.mustqr.run", mustqr_args, lambda m, a: (m.map_listing(*a)[0], "")),
    "sakan": ("scrapers.sakan.run", sakan_args, _sakan),
    "aqarcity": ("scrapers.aqarcity.run", aqarcity_args, lambda m, a: (m.map_listing(*a)[0], "")),
    "eydah": ("scrapers.eydah.run", eydah_args, _eydah),
    "tawia": ("scrapers.tawia.run", tawia_args, _tawia),
}


def mapped(platform, builder_args, mutated_source=None):
    """{"mapped": did the mapper return a row, "date_added": what it would store, "why": skip note}."""
    module, build, call = _PLATFORMS[platform]
    _seed_catalog()
    real = importlib.import_module(module)
    mod = real
    if mutated_source:
        mod = types.ModuleType("mutant")
        mod.__dict__.update({k: v for k, v in real.__dict__.items() if not k.startswith("__")})
        mod.__dict__["__file__"] = real.__file__
        mod.__dict__["__name__"] = "mutant"
        exec(compile(mutated_source, "mutant.py", "exec"), mod.__dict__)
    row, why = call(mod, build(*builder_args))
    return {"mapped": bool(row), "date_added": (row or {}).get("date_added"), "why": why}
