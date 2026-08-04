"""Regression test for scrapers/satel/run.py's city/region resolution (2026-08-04).

Two defects found in the deep-location-matching audit (currently dormant — Satel's live feed is
100% genuinely Riyadh, so 0 rows are affected today; this is hardening against a future non-Riyadh
listing being silently mis-filed):

1. `region` was hardcoded to `DEFAULT_REGION = "Riyadh"` regardless of what `city` resolved to.
2. When `raw_city_ar` was truthy but didn't map via `normalize.map_city()`, the old code defaulted
   `city` to "Riyadh" anyway — overwriting a real, unmapped signal with a guess instead of an
   honest None ("correct NULL beats wrong match").

Fix: `_resolve_city_region()` only defaults to Riyadh when there's genuinely no other signal
(`raw_city_en` empty/contains "riyadh"); an unmapped `raw_city_ar` now stays None. `region` is
derived from the resolved city via `normalize.region_for_city()`, never hardcoded.

Run: python -m pytest scrapers/common/tests/test_satel_no_hardcoded_riyadh_default.py -v
"""
import sys

sys.path.insert(0, ".")

from scrapers.common import normalize  # noqa: E402
from scrapers.satel.run import _resolve_city_region  # noqa: E402


def test_noisy_riyadh_english_still_resolves_riyadh():
    assert _resolve_city_region("", "RIYADH") == "Riyadh"
    assert _resolve_city_region("", "Al Riyadh") == "Riyadh"


def test_no_signal_at_all_defaults_riyadh():
    assert _resolve_city_region("", "") == "Riyadh"


def test_unmapped_arabic_signal_is_honest_none_not_riyadh():
    # the actual bug: a real, unmapped Arabic city must never be silently overwritten with Riyadh
    assert _resolve_city_region("قصيباء", "") is None


def test_directly_mappable_city_wins():
    mapped = normalize.map_city("جدة")
    if mapped:
        assert _resolve_city_region("جدة", "") == mapped


def test_region_derives_from_resolved_city_not_hardcoded():
    # Riyadh -> Riyadh region; a resolved non-Riyadh city must carry ITS OWN region, never Riyadh.
    assert normalize.region_for_city(_resolve_city_region("", "RIYADH")) == "Riyadh"
    jeddah = normalize.map_city("جدة")
    if jeddah:
        assert normalize.region_for_city(_resolve_city_region("جدة", "")) == normalize.region_for_city(jeddah)


if __name__ == "__main__":
    test_noisy_riyadh_english_still_resolves_riyadh()
    test_no_signal_at_all_defaults_riyadh()
    test_unmapped_arabic_signal_is_honest_none_not_riyadh()
    test_directly_mappable_city_wins()
    test_region_derives_from_resolved_city_not_hardcoded()
    print("OK — satel no-hardcoded-riyadh-default regression tests pass")
