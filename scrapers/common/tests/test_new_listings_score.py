"""new_listings_score: the comparison and the rating rule, hermetic (synthetic fixtures only)."""
from __future__ import annotations

import pytest

from scrapers.common.new_listings_score import (
    FLOOR_CAP, MATCH, MISMATCH, PAGE_SILENT, WE_MISS,
    _cmp_district, af_precision, af_recall, compare_listing, empty_row, fold,
    norm, normal_accuracy, rating, score_site,
)


def page(*lines, title=""):
    return {"title": title, "meta": {}, "jsonld": [], "evidence_lines": list(lines),
            "text_head": " | ".join(lines)}


# ── District equivalence (the owner's priority, the exact rules) ───────────────────────────────

@pytest.mark.parametrize("stored,on_page,want", [
    ("حي النرجس", "النرجس", MATCH),              # «حي X» stored, bare «X» on the page
    ("النرجس", "حي النرجس", MATCH),              # bare stored, «حي X» on the page
    ("الرابية", "الرابية الهفوف", MATCH),        # glued city suffix CONTAINS our district → match
    ("المحمدية 2", "حي المحمدية", MATCH),        # numbered district folds onto the plain name
    ("النرجس", "حي العليا", MISMATCH),           # the page names a DIFFERENT district
    (None, "حي العليا", WE_MISS),                # page states it, we serve NULL
])
def test_district_rules(stored, on_page, want):
    assert _cmp_district(stored, norm(on_page)) == want


def test_district_silent_is_never_wrong():
    assert _cmp_district(None, norm("لا شيء هنا")) == PAGE_SILENT
    assert _cmp_district("النرجس", norm("لا شيء هنا")) == PAGE_SILENT  # we claim, page silent: not a mismatch


# ── Booleans, numbers, deal ─────────────────────────────────────────────────────────────────────

def test_bool_negation_and_unknown():
    r = compare_listing({"elevator": False}, page("شقة بدون مصعد"))
    assert r["elevator"] == MATCH
    r = compare_listing({"elevator": True}, page("شقة بدون مصعد"))
    assert r["elevator"] == MISMATCH
    r = compare_listing({"elevator": None}, page("يوجد مصعد"))
    assert r["elevator"] == WE_MISS
    r = compare_listing({"elevator": None}, page("شقة واسعة"))
    assert r["elevator"] == PAGE_SILENT          # silent means unknown, never a miss


def test_price_grouping_and_arabic_digits():
    ok = page("السعر 1,250,000 ريال")
    assert compare_listing({"price_total": 1250000}, ok)["price"] == MATCH
    assert compare_listing({"price_total": 1250000}, page("السعر ١٬٢٥٠٬٠٠٠ ريال"))["price"] == MATCH
    assert compare_listing({"price_total": 1250000}, page("السعر 900,000 ريال"))["price"] == MISMATCH
    assert compare_listing({"price_total": None}, page("السعر 900,000 ريال"))["price"] == WE_MISS


def test_small_numbers_only_count_near_their_keyword():
    # a stray «3» on the page must not confirm bedrooms=3; «3 غرف» must.
    assert compare_listing({"bedrooms": 3}, page("الدور 3", "غرف نوم عديدة"))["bedrooms"] != MATCH
    assert compare_listing({"bedrooms": 3}, page("3 غرف نوم"))["bedrooms"] == MATCH


def test_label_and_value_on_neighbouring_lines():
    # aqar renders «غرف النوم» / «4» and «م²» / «240» as label + bare-value lines (seen live
    # 2026-10-03): the bare neighbour confirms the figure; a busy neighbour never does.
    assert compare_listing({"bedrooms": 4}, page("غرف النوم", "4"))["bedrooms"] == MATCH
    assert compare_listing({"area_m2": 240}, page("م²", "240"))["area"] == MATCH
    assert compare_listing({"bedrooms": 4}, page("غرف النوم", "5"))["bedrooms"] == MISMATCH


def test_gathern_price_is_never_compared():
    r = compare_listing({"price_total": 999}, page("السعر 5 ريال"), skip_price=True)
    assert "price" not in r


def test_deal_words():
    assert compare_listing({"deal_ar": "بيع"}, page("فيلا للبيع"))["deal"] == MATCH
    assert compare_listing({"deal_ar": "إيجار"}, page("شقة للإيجار"))["deal"] == MATCH
    assert compare_listing({"deal_ar": "بيع"}, page("شقة للإيجار"))["deal"] == MISMATCH


# ── The rating rule (the constants the owner tunes) ────────────────────────────────────────────

def _row(**kw):
    r = empty_row("2026-10-02", kw.pop("platform", "siteA"))
    r.update(kw)
    return r


def test_rating_10_needs_thresholds_and_every_site_measured():
    good = _row(sampled=10, decided_ads=6, normal_match=200, normal_mismatch=0,
                af_claimed=20, af_agree=20, af_page_states=20, af_captured=19)
    assert rating([good])[0] == 10


def test_rating_caps_at_5_when_any_site_is_under_the_floor():
    bad = _row(platform="siteB", decided_ads=6, normal_match=5, normal_mismatch=5)
    cap, why = rating([bad])
    assert cap == FLOOR_CAP and "siteB" in why


def test_rating_9_when_no_site_reaches_min_decided_ads():
    thin = _row(decided_ads=2, normal_match=10, normal_mismatch=0)
    assert rating([thin])[0] == 9


def test_unknown_never_lowers_the_rating_below_9():
    silent = _row(sampled=5, decided_ads=0)       # every field page-silent or unreadable
    cap, why = rating([silent])
    assert cap == 9 and normal_accuracy(silent) is None and "not measured" in why


# ── The whole site path over a fake client and a fake page (no network, no database) ──────────

class _Q:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self._rows = [r for r in self._rows if r.get(col) == val or r.get("id") == val and col == "id"]
        return self

    def limit(self, n):
        self._rows = self._rows[:n]
        return self

    def execute(self):
        return type("R", (), {"data": self._rows})()


class FakeClient:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return _Q([dict(r) for r in self.tables.get(name, [])])


HTML = """<html><head><title>شقة للإيجار في حي النرجس</title></head><body>
<p>شقة للإيجار سنوي في حي النرجس</p><p>السعر 35,000 ريال</p><p>المساحة 120 م2</p>
<p>3 غرف نوم</p><p>يوجد مصعد</p><p>بدون مسبح</p></body></html>"""


def test_score_site_end_to_end():
    stored = {"source_table": "fake_residential_listings", "listing_id": 7, "platform": "fakesite",
              "district_ar": "النرجس", "city_ar": None, "region_ar": None, "deal_ar": "إيجار",
              "rent_period_ar": "سنوي", "type_ar": "شقة", "price_annual": 35000, "area_m2": 120,
              "bedrooms": 3, "elevator": True, "pool": True}   # pool True but the page says «بدون مسبح»
    client = FakeClient({
        "search_listings_ar": [stored],
        "fake_residential_listings": [{"id": 7, "listing_url": "https://example.test/7"}],
    })
    row = score_site(client, "fakesite", [("fake_residential_listings", 7)],
                     night="2026-10-02", pace=0, probe=lambda url: (200, HTML))
    assert row["sampled"] == 1 and row["decided_ads"] == 1
    assert row["fields"]["district"][MATCH] == 1
    assert row["fields"]["deal"][MATCH] == 1 and row["fields"]["rent_period"][MATCH] == 1
    assert row["fields"]["price"][MATCH] == 1 and row["fields"]["area"][MATCH] == 1
    assert row["fields"]["pool"][MISMATCH] == 1          # we say yes, the page says «بدون مسبح»
    assert row["mismatch_ids"] == ["fake_residential_listings:7"]
    assert normal_accuracy(row) == 1.0
    assert af_precision(row) is not None and af_precision(row) < 1.0


def test_unreadable_page_is_counted_but_never_wrong():
    client = FakeClient({
        "search_listings_ar": [{"source_table": "t", "listing_id": 1}],
        "t": [{"id": 1, "listing_url": "https://example.test/1"}],
    })
    row = score_site(client, "fakesite", [("t", 1)], night="2026-10-02", pace=0,
                     probe=lambda url: (503, ""))
    assert row["sampled"] == 1 and row["unreadable_pages"] == 1
    assert row["normal_mismatch"] == 0 and row["mismatch_ids"] == []


def test_fold_counts_af_recall_misses():
    row = empty_row("2026-10-02", "s")
    stored = {"elevator": None}
    fold(row, "t:1", {"elevator": WE_MISS, "district": MATCH}, stored)
    assert row["af_page_states"] == 1 and row["af_captured"] == 0
    assert af_recall(row) == 0.0
    assert row["normal_match"] == 1      # district is a normal field
