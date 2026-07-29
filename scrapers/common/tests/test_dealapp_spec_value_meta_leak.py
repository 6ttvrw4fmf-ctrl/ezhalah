"""Regression test for dealapp's area/price concatenation bug (2026-07-29).

_spec_value() window-scans for a label and splits on HTML tags to isolate the value that follows
it. But the site's OpenGraph/Twitter share-preview <meta> tags embed a compact blurb with BOTH the
area and price on one line, separated only by a newline (no HTML tag), e.g.:
    <meta property="og:description" content="...المساحة / 162م
    السعر / 620،000ريال...">
Since the label's FIRST occurrence in the page is inside that <meta> tag (before the real spec
table ever renders in <body>), the old code returned the whole undivided blob, and the digit-only
strip in _num() then fused "162" and "620,000" into area_m2=162620000. Confirmed live against real
listing pages 2026-07-29: ids 956972, 1274844, 1846258, 2295991 all reproduce the DB's exact bad
area_m2 from this mechanism.

Fix: only search for the label past `</head>` — the real spec table only ever renders in <body>.

Run: python -m pytest scrapers/common/tests/test_dealapp_spec_value_meta_leak.py -v
"""
from scrapers.dealapp.run import _spec_value, _num

# Trimmed but structurally real shape: a share-preview blurb in <head>, then the actual spec table
# in <body> with a clean, correctly isolated area value.
_LEAKY_HTML = """
<html>
<head>
<meta property="og:description" content="عقار للبيع 📜المساحة / 162م
السعر / 620،000ريال">
</head>
<body>
<div class="spec-row"><span>المساحة</span></div><div>162 <span>م²</span></div>
</body>
</html>
"""


def test_spec_value_skips_head_meta_blurb():
    # Before the fix this returned the undivided "162م\nالسعر / 620،000ريال" blob.
    val = _spec_value(_LEAKY_HTML, "المساحة")
    assert val is not None
    assert "620" not in val, f"leaked price digits into the area segment: {val!r}"


def test_num_on_the_fixed_segment_is_the_real_area_not_a_fused_number():
    val = _spec_value(_LEAKY_HTML, "المساحة")
    area = _num((val or "").replace("م²", ""))
    assert area == 162, f"expected the real area (162), got {area} — concatenation bug reproduced"


_NO_HEAD_LEAK_HTML = """
<html><body>
<div class="spec-row"><span>المساحة</span></div><div>245 <span>م²</span></div>
</body></html>
"""


def test_spec_value_still_works_with_no_head_tag_at_all():
    # </head> absent entirely (e.g. a trimmed fixture) must not break normal extraction.
    val = _spec_value(_NO_HEAD_LEAK_HTML, "المساحة")
    area = _num((val or "").replace("م²", ""))
    assert area == 245


if __name__ == "__main__":
    test_spec_value_skips_head_meta_blurb()
    test_num_on_the_fixed_segment_is_the_real_area_not_a_fused_number()
    test_spec_value_still_works_with_no_head_tag_at_all()
    print("OK — dealapp _spec_value meta-leak regression tests pass")
