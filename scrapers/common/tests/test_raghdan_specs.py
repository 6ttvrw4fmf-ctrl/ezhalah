"""Raghdan rendered spec/licence/deed panel — the rules that keep it honest.

Raghdan's JSON-LD carries only area, rooms and a prose blurb. The page the user sees renders a
full REGA-grade panel (ad licence, brokerage licence, deed type/plan/parcel, deed location text,
street width, utilities, building-code compliance). Until 2026-08-11 the scraper read none of it,
so raghdan held 0/71 ad licences and 0 street widths on its searchable annual-rent apartments —
a capture gap, not a silent source.

Locked here:
  1. «عرض الشارع: 0» means "not stated", not a zero-metre street.
  2. The AD licence and the BROKERAGE licence are two different licences and must never merge —
     the brokerage number is identical on every raghdan listing, so merging them would stamp one
     company's licence onto every ad.
  3. The utilities card is a positive-only list: listed ⇒ True, unlisted ⇒ NULL, never False.
  4. «شارع» is never stored (PDPL — indistinguishable from a person's name on this source).
  5. Placeholders («غير محدد») are not values.

Offline and hermetic — the fixtures are inline, no network, no DB.
"""
from __future__ import annotations

from scrapers.raghdan.run import (
    _rendered_specs,
    _rendered_utilities,
    _spec_int,
)


def _label(ar: str, val: str) -> str:
    """Reproduce raghdan's rendered label/value shape, including the React comment marker."""
    return f'<span class="font-bold text-gray-600">{ar}<!-- -->:</span><span class="x">{val}</span>'


PAGE = (
    _label("عرض الشارع", "0")
    + _label("رقم ترخيص الإعلان", "7201071186")
    + _label("رقم رخصة الوساطة", "1200029439")
    + _label("وصف الموقع حسب الصك", "حي النرجس في مدينة الرياض")
    + _label("نوع الصك", "صك إلكتروني")
    + _label("رقم المخطط", "2737")
    + _label("مطابقة كود البناء السعودي", "لا")
    + _label("شارع", "محمد بن عبدالعزيز الدغيثر")
    + "مرافق العقار واستخداماته<span>المرافق:</span><span>كهرباء</span>"
      "<span> - مياه</span><span> - صرف صحي</span>إستخدام العقار"
)


def test_zero_street_width_is_not_a_width():
    assert _spec_int("0") is None
    assert _spec_int("") is None
    assert _spec_int(None) is None
    assert _spec_int("20") == 20


def test_ad_licence_and_brokerage_licence_stay_separate():
    sp = _rendered_specs(PAGE)
    assert sp["ad_license"] == "7201071186"
    assert sp["brokerage_license"] == "1200029439"
    assert sp["ad_license"] != sp["brokerage_license"]


def test_deed_and_plan_are_captured_verbatim():
    sp = _rendered_specs(PAGE)
    assert sp["deed_location"] == "حي النرجس في مدينة الرياض"
    assert sp["deed_type"] == "صك إلكتروني"
    assert sp["plan_number"] == "2737"
    assert sp["building_code"] == "لا"   # an explicit source NO, preserved as the source wrote it


def test_utilities_listed_are_true_and_unlisted_are_absent():
    u = _rendered_utilities(PAGE)
    assert u == {"electricity": True, "water_supply": True, "sanitation": True}
    assert "optical_fibers" not in u       # the card did not list it -> NULL, not False
    assert not any(v is False for v in u.values())


def test_utilities_card_is_scoped_to_the_property_section():
    """The page footer contains an unrelated «المرافق» string; reading it would invent utilities."""
    footer_only = "<div>النشرة العقارية المرافق كهرباء مياه</div>"
    assert _rendered_utilities(footer_only) == {}


def test_missing_panel_yields_nothing_rather_than_guesses():
    assert _rendered_specs("<html><body>no panel here</body></html>") == {}
    assert _rendered_utilities("<html><body>no panel here</body></html>") == {}


def test_placeholder_is_not_a_value():
    assert "deed_type" not in _rendered_specs(_label("نوع الصك", "غير محدد"))
    assert "plan_number" not in _rendered_specs(_label("رقم المخطط", "-"))


def test_street_name_is_never_written_to_the_row():
    """PDPL: on raghdan this free text is frequently a person's name. It is read into the spec dict
    but must not reach a stored column — assert the row builder leaves it out."""
    import inspect

    from scrapers.raghdan import run

    src = inspect.getsource(run.map_listing)
    assert '"street_name":' not in src, (
        "street_name was added back to the raghdan row; this source cannot distinguish an "
        "official street name from an owner/advertiser name"
    )


def test_html_entities_are_decoded_before_storage():
    """raghdan was the only scraper in the fleet whose _strip_tags skipped ihtml.unescape, so
    entities reached the database raw — a live deed-location value stored
    «قطعة الأرض &quot;2558&quot;» instead of the quotation marks the deed actually shows."""
    from scrapers.raghdan.run import _strip_tags

    out = _strip_tags('قطعة الأرض &quot;2558&quot; &amp; <b>x</b>')
    assert '&quot;' not in out and '&amp;' not in out
    assert '"2558"' in out
    assert '<b>' not in out and 'x' in out
