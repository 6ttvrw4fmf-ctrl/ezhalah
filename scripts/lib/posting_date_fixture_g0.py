"""Posting-date fixtures, group 0: wasalt. Contract: scripts/lib/posting_date_fixture_more.py."""
import copy
import json
import os

_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")


# ── wasalt: the stored real search-list property 5966658 (owner fields removed) ──────────────────
def wasalt_args(published_at, updated_at="2026-11-03T13:04:22.535Z", deal="sale"):
    with open(os.path.join(_ROOT, "scrapers", "wasalt", "testdata", "5966658.search-property.json"),
              encoding="utf-8") as fh:
        prop = json.load(fh)
    prop = copy.deepcopy(prop)
    prop.pop("publishedAt", None)
    if published_at is not None:
        prop["publishedAt"] = published_at
    prop["updatedAt"] = updated_at
    return [prop, deal]


PLATFORMS = {
    "wasalt": ("scrapers.wasalt.run", wasalt_args, lambda m, a: (m.map_property(*a), "")),
}

CASES = {
    "wasalt": [
        [["2026-10-31T10:19:21.069Z"], "2026-10-31T13:19:21+03:00",
         "publishedAt read live on wasalt 5966658 → the same instant in Saudi time"],
        [["2026-11-08T22:30:00.000Z"], "2026-11-09T01:30:00+03:00",
         "a late-evening UTC publish lands on the Saudi day"],
        [[None], None, "no publishedAt → NULL, the ad still maps"],
        [[None, "2026-11-09T08:00:00.000Z"], None,
         "only updatedAt (an edit) is present → NULL, an edit is not a posting"],
    ],
}

MUTATIONS = {
    "wasalt": [
        ["wasalt reading updatedAt (an edit) as the posting date", "scrapers/wasalt/run.py",
         '"date_added": site_posting_date(prop.get("publishedAt")),',
         '"date_added": site_posting_date(prop.get("updatedAt")),',
         [None, "2026-11-09T08:00:00.000Z"]],
        ["wasalt reading the REGA licence date as the posting date", "scrapers/wasalt/run.py",
         '"date_added": site_posting_date(prop.get("publishedAt")),',
         '"date_added": site_posting_date(info.get("regaAdvLicDate") or "2026-01-05"),',
         [None]],
    ],
}


# ── SITES WHOSE PRINTED «DATE» IS NOT A POSTING DATE ─────────────────────────────────────────────
# NO_DATE = {site: (scraper module, builder, call, where the raw text must survive)}. The builder takes
# the raw value the page prints; the mapper must store date_added = None and keep the raw text in the
# row's own capture (a path into the row dict). MUTATIONS above may re-create the old reading.
#
# nofodh: «تاريخ النشر» is the platform's import timestamp — 2,542 of 2,556 active ads print the same
# one. The record is /listings/149628 verbatim (scrapers/common/tests/test_nofodh_price_period_and_pdpl.py),
# with the catalog stubbed to the real ids that test documents (جدة = city 18, region 2).
def nofodh_args(printed="2026-05-15"):
    return [{
        "id": "149628",
        "details": {"رقم العقار": "149628", "السعر": "882,446",
                    "مساحة العقار": "1689.45 متر مربع", "سنة البناء": printed,
                    "نوع العقار": "أرض", "حالة العقار": "للبيع", "رقم البلوك": "BLK54"},
        "overview": {"تاريخ النشر": printed, "متر مربع": "1689.45",
                     "نوع العقار": "أرض", "الفئة": "سكني"},
        "address": {"المدينة": "جدة", "الحي": "حي المنارات"},
        "price_exact": 882446, "min_price": 882446, "max_price": 0,
        "code": "WAP-BLK54-6",
        "photos": ["https://www.nofodh.sa/listings/149628_6a43785435dc0/6.jpg"],
        "has_auction_word": False,
    }]


def _nofodh(mod, args):
    mod.to_catalog = lambda c, *a, **k: {"جدة": (18, 2)}.get(c, (None, None))
    mod.find_district_in_text = lambda t, cid: {(18, "حي المنارات"): "حي المنارات"}.get((cid, t))
    row, _cat, why = mod.map_listing(*args)
    return row, why


NO_DATE = {
    "nofodh": ("scrapers.nofodh.run", nofodh_args, _nofodh, ["source_capture", "overview", "تاريخ النشر"]),
}

MUTATIONS["nofodh"] = [
    ["nofodh storing its import stamp as the posting date (the defect as it shipped)", "scrapers/nofodh/run.py",
     '        "date_added": None,\n        "photo_urls": photos,',
     '        "date_added": redact_pii(rec["overview"].get("تاريخ النشر")),\n        "photo_urls": photos,',
     ["2026-05-15"]],
]
