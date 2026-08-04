"""Regression test for scrapers/dealapp/run.py's city-fallback resolution (2026-08-04).

The bug: `CITY_FALLBACK_AR` maps a handful of small-town Arabic names (that the shared catalog
doesn't carry) to an ALREADY-CANONICAL English city name ("Riyadh", "Hafar Al Batin", ...). The old
code re-wrapped that English string through `normalize.map_city()`, which only matches ARABIC
input — so the fallback was a permanent no-op. 129 live rows (ضرما, قرية العليا, عسفان) silently
lost their city/region match forever (region is derived 1:1 from city).

Fix: `_resolve_city()` uses the fallback value directly — no re-wrap.
(deep-location-matching-audit 2026-08-04)

Run: python -m pytest scrapers/common/tests/test_dealapp_city_fallback_no_double_normalize.py -v
"""
import sys

sys.path.insert(0, ".")

from scrapers.common import normalize  # noqa: E402
from scrapers.dealapp.run import CITY_FALLBACK_AR, _resolve_city  # noqa: E402


def test_fallback_values_are_english_and_would_fail_map_city():
    # Guards the bug's precondition: if this ever stops being true (e.g. someone "helpfully"
    # re-Arabizes CITY_FALLBACK_AR), the double-normalize bug would be silent again.
    for city_ar, fallback_en in CITY_FALLBACK_AR.items():
        assert normalize.map_city(fallback_en) is None, (
            f"{fallback_en!r} now matches map_city() directly — re-check _resolve_city()"
        )


def test_resolves_known_fallback_towns():
    assert _resolve_city("ضرما") == "Riyadh"
    assert _resolve_city("قرية العليا") == "Hafar Al Batin"
    assert _resolve_city("عسفان") == "Jeddah"


def test_direct_catalog_match_still_takes_priority():
    # A city_ar that map_city() already resolves directly must not be shadowed by the fallback.
    direct = next(iter(k for k in ["الرياض", "جدة"] if normalize.map_city(k)), None)
    if direct:
        assert _resolve_city(direct) == normalize.map_city(direct)


def test_unknown_city_ar_is_honest_none():
    assert _resolve_city("قصيباء") is None  # genuinely ambiguous, not in the fallback dict either
    assert _resolve_city(None) is None
    assert _resolve_city("") is None


if __name__ == "__main__":
    test_fallback_values_are_english_and_would_fail_map_city()
    test_resolves_known_fallback_towns()
    test_direct_catalog_match_still_takes_priority()
    test_unknown_city_ar_is_honest_none()
    print("OK — dealapp city-fallback no-double-normalize regression tests pass")
