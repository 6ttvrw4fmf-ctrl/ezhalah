"""sadin's detail-page description must survive the dt/dd redesign — and the older markup too.

Regression guard for the silent capture outage that ran from ~2026-08-14 to 2026-09-03: sadin
redesigned its detail page, `_description()` still targeted the pre-redesign
`<div class="property-description">` / `<div class="text">`, and every freshly-crawled sadin row
was stored with no description. Because sadin's price is parsed ONLY out of that description prose
(`_extract_price`), the whole platform went price-less — 73/74 active residential rows and 10/10
commercial rows — while the crawl reported ok=true, rows_seen=84 and a healthy prune, so no
count-based or liveness barrier could see it.

What proved the fetch was healthy and isolated the defect to this one selector: `area_m2` kept
parsing on 74/74 of the same rows from the redesigned `<dt>المساحة</dt><dd>500 م²</dd>` pair.

The DB-side barrier for the whole class is `mon_detect_detail_capture_collapse()`.
"""
from scrapers.sadin.run import _description, _extract_price


REDESIGN = """
<dl class="property-details">
  <dt>المساحة</dt><dd>500 م²</dd>
  <dt>وصف العقار</dt>
  <dd class="value">أرض تجارية للبيع بحي القصواء<br/>المطلوب 5,000,000 ريال</dd>
  <dt>الغرض</dt><dd>للبيع</dd>
</dl>
"""

PRE_REDESIGN_CURRENT = """
<h3>وصف العقار</h3>
<div class="property-description">أرض تجارية للبيع بحي القصواء المطلوب 5,000,000 ريال</div>
"""

PRE_REDESIGN_LEGACY = """
<h3>وصف العقار</h3>
<div class="text">أرض تجارية للبيع بحي القصواء المطلوب 5,000,000 ريال</div>
"""


def test_redesign_dt_dd_description_is_read():
    """FAILS on the pre-fix code: the dd shape matched neither div selector, so this returned None."""
    got = _description(REDESIGN)
    assert got is not None, "redesigned dt/dd description must be read, not silently dropped"
    assert "أرض تجارية للبيع بحي القصواء" in got
    assert "5,000,000" in got


def test_redesign_description_still_yields_the_published_price():
    """The user-visible consequence: no description meant no price on every sadin card."""
    assert _extract_price(_description(REDESIGN)) == 5000000


def test_both_pre_redesign_selectors_still_parse():
    """The fix must not regress cached/mirrored older pages."""
    for html in (PRE_REDESIGN_CURRENT, PRE_REDESIGN_LEGACY):
        got = _description(html)
        assert got is not None and "أرض تجارية" in got


def test_unrelated_dt_dd_further_down_is_never_taken_as_the_description():
    """The dd pattern is anchored to the label's own </dt>; a later pair must not be picked up.

    Without the anchor this would return "للبيع" — inventing a description (and, through
    _extract_price, potentially a price) out of an unrelated field.
    """
    html = """
    <dt>وصف العقار</dt><span>no dd here</span>
    <dt>الغرض</dt><dd>للبيع</dd>
    """
    assert _description(html) is None


def test_missing_description_label_returns_none():
    assert _description("<div>لا يوجد</div>") is None
