"""nufouth: a coordinate with surrounding whitespace is still the ad's pin (audit 2026-10-21).

H182 (Al Kharj) published its longitude as «47.3109269\t». Stored verbatim, listing_rich_attrs' numeric check
rejected the pair, so the ad page showed a district border over a real published pin.
"""
from scrapers.nufouth import run


def test_trailing_tab_is_trimmed():
    assert run._coord("47.3109269\t") == "47.3109269"
    assert run._coord(" 24.272602 ") == "24.272602"


def test_empty_stays_empty():
    assert run._coord(None) is None
    assert run._coord("  ") is None


def test_mutation_the_raw_value_would_fail_the_index_check():
    import re
    numeric = re.compile(r"^-?[0-9]+(\.[0-9]+)?$")     # listing_rich_attrs' own check
    assert not numeric.match("47.3109269\t"), "fixture no longer reproduces the defect"
    assert numeric.match(run._coord("47.3109269\t"))
