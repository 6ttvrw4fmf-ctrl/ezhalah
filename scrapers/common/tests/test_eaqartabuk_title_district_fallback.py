"""Regression test for the 2026-08-04 eaqartabuk district title-fallback fix
(scrapers/eaqartabuk/run.py).

Root cause (2026-08-04 audit, live-reverified): map_listing() only read district from the
candles-map enrichment API (mp.get("district")), which was blank on 115/546 search_listings_ar
rows. The WordPress list API's own `title` field the scraper already downloads frequently embeds
the district — e.g. "فيلا روف ارضي بحى الصفا" or "شقة للبيع في تبوك (حي حي البوادي)"
(live-verified https://eaqartabuk.com/property/شقة-للبيع-في-تبوك-حي-حي-البوادي/).

Fix: when mp.get("district") is empty, _district_from_title() regexes the title for a بحي/حي
(and alef-maqsura بحى/حى) phrase and captures ONE following word — mirrors alkhaas's proven
بحي/حي title-scrape (alkhaas/run.py), narrowed to a single word after a dry-run resolve_district_ar()
comparison against every null-district row showed a 1-word capture resolves 72/115 vs only 46/115
for a 2-word capture (eaqartabuk titles often trail the district with room counts / "|" separators
that a wider window swallows and breaks the catalog match on).

This is a raw, unvalidated extraction — same as raghdan's/alkhaas's — safe because downstream
resolve_district_ar() only accepts a value already attested in loc_canonical_district for the
listing's city_id (Tabuk); an unresolvable capture just stays NULL, exactly as it did before this
fallback existed (card-district-gates-on-match rule). This test only covers the scraper-side
extraction.

Run: python -m pytest scrapers/common/tests/test_eaqartabuk_title_district_fallback.py -v
"""
import sys

sys.path.insert(0, ".")

from scrapers.eaqartabuk.run import _district_from_title, map_listing  # noqa: E402


# ── بحي / حي (regular yaa) ──────────────────────────────────────────────────────────────────────
def test_bahai_yaa():
    # live ET6970
    assert _district_from_title("فيلا بحي الريان") == "الريان"


def test_hai_yaa_no_ba():
    # live ET6062
    assert _district_from_title("شقة دور ثاني حي البوادي") == "البوادي"


# ── بحى / حى (alef-maqsura spelling — the audit's "حي"/"حى" note) ──────────────────────────────
def test_bahaa_alef_maqsura():
    # live ET10546
    assert _district_from_title("فيلا روف ارضي بحى الصفا") == "الصفا"


def test_haa_alef_maqsura_no_ba():
    # live ET10802
    assert _district_from_title("شقه دور ثانى حى اليرموك") == "اليرموك"


# ── doubled "(حي حي X)" WordPress title wrapper ────────────────────────────────────────────────
def test_doubled_hai_paren_wrapper():
    # live ET10941 — the "(" glues to the first حي with no space, so the (?<=\s) boundary skips
    # it and matches the second حي, capturing just the real district.
    assert _district_from_title("شقة للبيع في تبوك (حي حي البوادي)") == "البوادي"


def test_doubled_hai_paren_wrapper_different_district():
    # live ET10886/ET10896
    assert _district_from_title("شقة للإيجار في تبوك (حي حي الورود)") == "الورود"


# ── في حي (commercial title shape) ──────────────────────────────────────────────────────────────
def test_fi_hai_commercial():
    # live ET10013 (commercial)
    assert _district_from_title("معارض في حي المصيف في تبوك") == "المصيف"


# ── noise after the district (room counts / pipes) truncated to 1 word, not swallowed ──────────
def test_trailing_pipe_noise_not_swallowed():
    # live ET5834 — 2-word capture would have grabbed "اليرموك |"; 1-word capture stops clean.
    assert _district_from_title("فيلا روف للبيع حي اليرموك | 4 غرف نوم | كراج | 5 دورات مياه") == "اليرموك"


def test_trailing_room_count_not_swallowed():
    # live ET8595 — 2-word capture would have grabbed "الصفا ع".
    assert _district_from_title("فله روف ارضيه للبيع حي الصفا ع شارعين") == "الصفا"


# ── no match at all ─────────────────────────────────────────────────────────────────────────────
def test_no_keyword_no_match():
    assert _district_from_title("ملحق للبيع") is None
    assert _district_from_title("") is None
    assert _district_from_title(None) is None


def test_gps_title_no_match():
    # live ET10748 — no بحي/حي token at all.
    assert _district_from_title("28°28’13.8″N 36°35’31.2″E") is None


# ── end-to-end wiring through map_listing() when candles-map district is blank ─────────────────
def _item(pid=1, title="فيلا بحي الريان"):
    return {
        "id": pid, "title": title, "link": f"https://eaqartabuk.com/?p={pid}",
        "date": "2026-08-01", "meta": {}, "featured_image": None, "excerpt": "",
    }


def test_map_listing_uses_title_fallback_when_candles_map_district_blank():
    mp = {"usage": "residential", "operation": "sale", "status": "بيع", "city": "تبوك", "district": ""}
    row, category = map_listing(_item(), mp, None)
    assert category == "residential"
    assert row["neighborhood"] == "الريان"
    assert row["additional_info"]["district_ar"] == "الريان"


def test_map_listing_prefers_candles_map_district_over_title():
    # candles-map's own field wins when present, even if the title also has a (different) حي.
    mp = {"usage": "residential", "operation": "sale", "status": "بيع", "city": "تبوك",
          "district": "حي النخيل"}
    row, _ = map_listing(_item(title="فيلا بحي الريان"), mp, None)
    assert row["neighborhood"] == "حي النخيل"


def test_map_listing_stays_none_when_neither_source_has_a_district():
    mp = {"usage": "residential", "operation": "sale", "status": "بيع", "city": "تبوك", "district": ""}
    row, _ = map_listing(_item(title="ملحق للبيع"), mp, None)
    assert row["neighborhood"] is None
    assert "district_ar" not in row["additional_info"]


if __name__ == "__main__":
    test_bahai_yaa()
    test_hai_yaa_no_ba()
    test_bahaa_alef_maqsura()
    test_haa_alef_maqsura_no_ba()
    test_doubled_hai_paren_wrapper()
    test_doubled_hai_paren_wrapper_different_district()
    test_fi_hai_commercial()
    test_trailing_pipe_noise_not_swallowed()
    test_trailing_room_count_not_swallowed()
    test_no_keyword_no_match()
    test_gps_title_no_match()
    test_map_listing_uses_title_fallback_when_candles_map_district_blank()
    test_map_listing_prefers_candles_map_district_over_title()
    test_map_listing_stays_none_when_neither_source_has_a_district()
    print("OK — eaqartabuk title district-fallback regression tests pass")
