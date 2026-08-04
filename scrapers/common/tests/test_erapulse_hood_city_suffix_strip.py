"""Regression test for scrapers/erapulse/run.py's hood/city-name contamination strip (2026-08-04).

The bug: `_HOOD_RE = re.compile(r"حي\\s+([^,،]+)")` captures up to the next comma. When the source
`location` string has NO comma between the hood and the city ("حي الروضة بريدة"), the greedy
capture group swallows the city name into the "district" value ("الروضة بريدة" instead of
"الروضة"), which then fails to resolve against the district catalog (4 confirmed rows: ERPREFMRDQ
8FJZ8Y1CW/4D6NGZODV/TUMCYCG72/MUF9FPBTH) — or worse, gets self-heal-promoted into the canonical
district catalog AS the contaminated string, so it "matches" a garbage district
("الرحاب - بريده" — ERPREFMN3DP7WQVG9ZU).

Fix: `_strip_hood_city_suffix()` strips a trailing KNOWN Qassim city-name suffix (from the existing
vetted `QASSIM_CITY_WORDS`) off a captured hood. Guarded so a hood that legitimately IS a city word
on its own — e.g. Buraidah's own real "حي البصر" district, since "البصر" is also a
QASSIM_CITY_WORDS key (verified live in loc_canonical_district, city_id=11) — is never wiped to
nothing: an empty/no-op strip falls back to the original hood untouched.

Run: python -m pytest scrapers/common/tests/test_erapulse_hood_city_suffix_strip.py -v
"""
import sys

sys.path.insert(0, ".")

from scrapers.erapulse.run import parse_location  # noqa: E402


def test_strips_glued_city_suffix_from_hood():
    # The 4 confirmed-null rows: comma-less "حي <hood> <city>".
    cases = [
        ("حي الروضة بريدة", "الروضة"),
        ("حي الشفق بريدة", "الشفق"),
        ("حي الشقة – بريدة", "الشقة"),  # en-dash separator
        ("حي السليمانية بريدة", "السليمانية"),
        ("حي الرحاب - بريده", "الرحاب"),  # the wrongly-matched row (hyphen + بريده variant)
    ]
    for loc, expected_hood in cases:
        city, region, hood = parse_location(loc)
        assert hood == expected_hood, f"{loc!r} -> hood {hood!r}, expected {expected_hood!r}"
        assert city == "Buraidah", f"{loc!r} -> city {city!r}"
        assert region == "Qassim"


def test_strips_governorate_marker_before_city_word():
    # ERPREFMNR6BJ0NJ5NOU: "حي غرناطة محافظة النبهانبة" — same contamination, plus a "محافظة"
    # (governorate) admin marker glued between hood and city.
    city, region, hood = parse_location("حي غرناطة محافظة النبهانبة")
    assert hood == "غرناطة", f"got {hood!r}"
    assert city == "An Nabhaniyah"


def test_does_not_wipe_a_hood_that_is_itself_a_city_word():
    # "البصر" is BOTH a QASSIM_CITY_WORDS key AND a real Buraidah district name
    # (loc_canonical_district city_id=11 district_norm='بصر' -> 'حي البصر'). A comma-terminated
    # hood of exactly "البصر" must survive the strip untouched, not collapse to "".
    city, region, hood = parse_location("حي البصر, مدينة بريدة, منطقة القصيم")
    assert hood == "البصر", f"real Buraidah district wiped: got {hood!r}"
    assert city == "Buraidah"


def test_comma_delimited_hood_is_unaffected():
    # The normal, already-working case must keep working.
    city, region, hood = parse_location("شارع الملك فهد, حي الفيصلية, مدينة بريدة, منطقة القصيم")
    assert hood == "الفيصلية"
    assert city == "Buraidah"


if __name__ == "__main__":
    test_strips_glued_city_suffix_from_hood()
    test_strips_governorate_marker_before_city_word()
    test_does_not_wipe_a_hood_that_is_itself_a_city_word()
    test_comma_delimited_hood_is_unaffected()
    print("OK — erapulse hood/city-suffix-strip regression tests pass")
