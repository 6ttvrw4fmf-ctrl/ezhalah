"""akariyoun + therc: the ad's own «الوصف» text reaches the description COLUMN (owner 2026-10-30: «we read everything»).

The AI facts reader reads `title + description` (>= 30 chars). Measured 2026-10-30 on active rows:
  · akariyoun 290 of 290 NULL — every live page prints a «الوصف» panel (akariyoun.sa/properties/
    shk-llaygar-fy-hy-alshaf-20: floor 19, panorama, metro, rent). map_listing read it for amenities and the
    rent period but never stored it.
  · therc 133 of 447 NULL — its ads OPEN with the contact block («📞 للتواصل واتساب:» / agent name /
    «((رقم المعلن يظهر عند التواصل))»), and _redact cut the whole text at the FIRST contact marker, so nothing
    survived (therc …/shk-llaygar-fy-hy-thhr-lbn-mdyn-alryad-mntk-alryad-3). Its box regex also ended at the
    first nested </div>.
Fixtures are the live markup's shape, trimmed. Every test here fails on the old code.

Run: python -m pytest scrapers/common/tests/test_akariyoun_therc_store_the_description.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scrapers.akariyoun.run as AK  # noqa: E402
from scrapers.therc.run import map_listing as therc_map  # noqa: E402
from scrapers.common.tests.test_therc_source_truth import URL, _page, _PLAIN_DESC, _KW  # noqa: E402

# HERMETIC: map_listing resolves the city against the live catalog (and hangs with no credentials).
AK.to_catalog = lambda city_ar, region_hint=None: (1, 1)
AK.find_district_in_text = lambda text, city_id: text

# ── akariyoun ─────────────────────────────────────────────────────────────────────────────────────────
AK_PAGE = """<html><head><title>شقة للإيجار في حي الشفا - Akariyoun</title></head><body>
<div>للإيجار</div><div>رقم الاعلان : 973</div><div>نوع العقار : شقة</div><div>الرياض - الشفا السعر : 120 ألف</div>
<div class="property_block_wrap"><div class="property_block_wrap_header">
<h4 class="property_block_title">الوصف</h4></div>
<div class="block-body">
<p>للإيجار السنوي | شقة راقية في برج حديث<br>• الدور: 19<br>• إطلالة بانورامية مفتوحة</p>
<div class="note"><p>• موقع مميز بالقرب من محطة المترو</p></div>
<p>قيمة الإيجار: 120,000 ريال سنوياً</p>
<p>للتواصل واتس : 0551228113</p>
</div></div>
<div class="property_block_wrap"><h4 class="property_block_title">الخدمات المتوفرة في الحي</h4>
<div class="block-body"><p>شبكة الكهرباء</p></div></div>
</body></html>"""


def _ak(page: str) -> dict:
    row, _cat, _raw = AK.map_listing("shk-llaygar-fy-hy-alshaf-20", page)
    assert row is not None
    return row


def test_akariyoun_stores_every_paragraph_of_its_own_panel():
    d = _ak(AK_PAGE).get("description")
    assert d, "the row must carry the description (290 of 290 were NULL on 2026-10-30)"
    assert "للإيجار السنوي | شقة راقية في برج حديث" in d
    assert "إطلالة بانورامية" in d and "محطة المترو" in d, "a nested <div> must not end the panel"
    assert "قيمة الإيجار: 120,000 ريال سنوياً" in d, "every paragraph, to the panel's own end"
    assert "شبكة الكهرباء" not in d, "the next panel (the district's services) is never part of it"


def test_akariyoun_redacts_the_phone():
    assert "0551228113" not in _ak(AK_PAGE)["description"], "PDPL: a phone in the description is never stored"


def test_akariyoun_no_panel_stays_null_never_empty_string():
    page = AK_PAGE.replace("الوصف</h4>", "تفاصيل</h4>")
    assert _ak(page)["description"] is None, "silent → NULL (SOURCE IS TRUTH), never ''"


# ── therc ─────────────────────────────────────────────────────────────────────────────────────────────
def _rc(desc_html: str) -> dict:
    row, _cat = therc_map(URL, _page(**_KW).replace(_PLAIN_DESC, desc_html), None)
    return row


OPENS_WITH_CONTACT = ('<div class="prose prose-sm max-w-none">📞 للتواصل واتساب:<br />\n'
                      'فرح محمد - الخيار الصحيح للخدمات العقارية <br />\n'
                      '((رقم المعلن يظهر عند التواصل))<br />\n'
                      '🏡 فيلا دبلكس للبيع – حي العوالي<br />\n'
                      '<div>🔹 المساحة: 200 م²</div>\n'
                      '• 4 غرف + صالة + مطبخ<br />\n'
                      'للحجز 0551228113<br />\n'
                      '💰 السعر المطلوب: 1,450,000 ريال</div>')


def test_therc_ad_that_opens_with_the_contact_block_keeps_its_property_text():
    d = _rc(OPENS_WITH_CONTACT).get("description")
    assert d, "133 of 447 were NULL: the contact block at the top swallowed the whole ad"
    assert "فيلا دبلكس للبيع – حي العوالي" in d
    assert "المساحة: 200 م²" in d, "a nested <div> inside the box must not end it"
    assert "1,450,000 ريال" in d, "text AFTER a mid-ad contact line is the ad's, and stays"


def test_therc_contact_name_phone_and_placeholder_never_stored():
    d = _rc(OPENS_WITH_CONTACT)["description"]
    assert "فرح" not in d, "PDPL: the agent's name on the line under «للتواصل» is never stored"
    assert "0551228113" not in d and "للحجز" not in d
    assert "رقم المعلن" not in d


def test_therc_short_name_under_a_bare_marker_is_dropped():
    d = _rc('<div class="prose prose-sm max-w-none">للتواصل واتس <br />\nفاطمه <br />\n✅✅✅<br />\n<br />\n'
            'شقه تتكون <br />\nمن غرفتين <br />\nو صاله<br />\n٢٧ الف ريال<br />\n</div>')["description"]
    assert "فاطمه" not in d
    assert "من غرفتين" in d and "٢٧ الف ريال" in d


def test_therc_contact_only_box_stays_null():
    assert _rc('<div class="prose prose-sm max-w-none">للتواصل واتس :<br />\nفاطمه<br />\n</div>')["description"] is None
