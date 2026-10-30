"""The ad's own prose reaches `description` — hajer, sadiqeltajer, satel, ashab units (2026-10-30).

The AI facts reader (scrapers/facts/extract.py) reads `title + description`. Measured that day, these
platforms stored NO description on any active ad although each ad's own page prints one:

  hajer          123/123 empty — `<div class="description">` (WP content): «يتكون من دورين وملحق …»
  sadiqeltajer   1,740/1,740 empty — the «تفاصيل الإعلان» `all-desc` box: «للبيع فله بحي البساتين …»
  satel          69/69 empty — the DETAIL record's descriptionEn («About this Property»); the list has none
  ashab units    371/371 empty — a unit page heads «نظرة عامة» with <h3>, the parser only knew <b>

Every text goes through redact_pii (PDPL) and an ad with no text stays NULL, never ''. Fixture text is
verbatim from the live pages named in each test (fetched 2026-10-30), plus a planted phone number.

    python -m pytest scrapers/common/tests/test_ad_description_is_stored_2026_10_30.py -q
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
_supabase = types.ModuleType("supabase")
_supabase.Client = type("Client", (), {})
_supabase.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase)
_dotenv = types.ModuleType("dotenv")
_dotenv.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv)

import pytest  # noqa: E402

import scrapers.ashab.run as A  # noqa: E402
import scrapers.hajer.run as H  # noqa: E402
import scrapers.sadiqeltajer.run as S  # noqa: E402
import scrapers.satel.run as T  # noqa: E402
from scrapers.common.tests.test_ashab_limit_units_and_skips import _page as ashab_page  # noqa: E402

PHONE = "0551234567"


# ── hajer — live post 1437 (hajerhouses.com «دبلكس للبيع تشطيب راقي في حي الدانة بالهفوف») ──────────
@pytest.fixture(autouse=True)
def _hajer_catalog(monkeypatch):
    monkeypatch.setattr(H, "to_catalog", lambda city_ar, region_hint=None: (1, 1))


def _hajer_row(body_html: str) -> dict:
    page = "".join(f'<strong class="rem-single-field-title">{k}</strong>'
                   f'<span class="rem-single-field-value">{v}</span>'
                   for k, v in (("رقم الإعلان", "1137"), ("نوع العقار", "دبلكس"), ("غرض العقار", "بيع"),
                                ("التصنيف", "سكني"), ("المدينة", "الأحساء"), ("أسم الحي", "الدانة")))
    p = {"id": 1437, "link": "https://hajerhouses.com/property/x/",
         "title": {"rendered": "دبلكس للبيع تشطيب راقي في حي الدانة بالهفوف"},
         "content": {"rendered": body_html}}
    row, _cat, _gone = H.map_listing(p, page)
    return row


HAJER_BODY = ("<p><strong>يتكون من دورين وملحق:</strong></p>\n<p><strong>الدور الأرضي</strong><br />•صالة+دورة مياه"
              "<br />•مجلس رجال+دورة مياه<br />•غرفة طعام<br />•مطبخ مغلق<br />•حديقة خلفية</p>\n"
              "<p><strong>✅‏‎يتوفر كافة الضمانات</strong></p>")


def test_hajer_stores_the_ads_own_body():
    d = _hajer_row(HAJER_BODY)["description"]
    assert d and "يتكون من دورين وملحق" in d and "مطبخ مغلق" in d and "يتوفر كافة الضمانات" in d


def test_hajer_redacts_a_phone_in_the_body():
    d = _hajer_row(HAJER_BODY + f"<p>للتواصل {PHONE}</p>")["description"]
    assert d and PHONE not in d and "مطبخ مغلق" in d


def test_hajer_empty_body_is_null_not_empty_string():
    assert _hajer_row("")["description"] is None


# ── sadiqeltajer — live ad flh-bhy-albsatyn-shrk-bryd-13 ───────────────────────────────────────────
SADIQ_HEAD = "--&gt; للبيع فله --&gt; مميز بيع فلل كود الاعلان : 8134 (حد) للبيع فله 875,000 ريال 630 م² "
SADIQ_BOX = ("للبيع فله بحي البساتين شرق بريدة<br>المساحة : 630م<br>العمر : 7 سنوات<br>"
             "المكونات : الدور الاول : مشب . مجلس رجال . مقلط . مجلس نساء . صالة . مطبخين")
SADIQ_TAIL = " الموقع حسب الصك القصيم - بريدة - البساتين اعلانات مشابهة 9 1 م² 5 ريال"


@pytest.fixture
def sadiq(monkeypatch):
    monkeypatch.setattr(S, "to_catalog", lambda city_ar, region_ar=None: (11, 4))
    monkeypatch.setattr(S, "find_district_in_text", lambda text, city_id: None)


def _sadiq_row(box: str | None) -> dict:
    desc = f'<div class="all-desc">{box}</div>' if box is not None else ""
    html = f"<html><body>{SADIQ_HEAD}{desc}{SADIQ_TAIL}</body></html>"
    row, _cat, why = S.map_listing("https://sadiq-eltajer.sa/ads/x", html)
    assert row, why
    return row


def test_sadiqeltajer_stores_the_description_box(sadiq):
    d = _sadiq_row(SADIQ_BOX)["description"]
    assert d and d.startswith("للبيع فله بحي البساتين") and "مجلس نساء" in d


def test_sadiqeltajer_redacts_a_phone_in_the_box(sadiq):
    d = _sadiq_row(SADIQ_BOX + f"<br>جوال {PHONE}")["description"]
    assert d and PHONE not in d and "مجلس نساء" in d


def test_sadiqeltajer_no_box_is_null(sadiq):
    assert _sadiq_row(None)["description"] is None


# ── satel — live detail record C0094 (apiv2.satel.sa/property/p/v2/C0094) ──────────────────────────
SATEL_EN = ('<p><span style="color: rgb(18, 18, 18);">Residential building in Al Olaya District, ideally positioned '
            'just 2 minutes from Kingdom Tower.</span></p><p style="text-align: justify;"><strong>Apartment Layout:'
            '</strong></p><p>Each unit features 2 bedrooms, a living room, a fully fitted kitchen.</p>')


def _satel_row(detail: dict | None) -> dict:
    row = {"ad_number": "STC0094", "photo_urls": []}
    T._attach_detail(row, detail)
    return row


def test_satel_stores_the_detail_records_description():
    d = _satel_row({"propertyNumber": "C0094", "descriptionEn": SATEL_EN, "descriptionAr": ""})["description"]
    assert d.startswith("Residential building in Al Olaya District") and "fully fitted kitchen" in d
    assert "<" not in d


def test_satel_prefers_arabic_when_the_source_writes_it():
    d = _satel_row({"propertyNumber": "C0094", "descriptionEn": SATEL_EN, "descriptionAr": "<p>شقة مفروشة</p>"})
    assert d["description"] == "شقة مفروشة"


def test_satel_redacts_a_phone():
    d = _satel_row({"propertyNumber": "C0094", "descriptionEn": SATEL_EN + f"<p>Call {PHONE}</p>"})["description"]
    assert PHONE not in d and "Kingdom Tower" in d


def test_satel_no_text_or_no_detail_writes_no_description():
    assert "description" not in _satel_row({"propertyNumber": "C0094", "descriptionEn": "", "descriptionAr": ""})
    assert "description" not in _satel_row(None)   # an unread detail never clears a stored text


# ── ashab — live unit page /properties/1002/unit/1000 (its box is headed <h3>, not <b>) ───────────────
ASHAB_UNIT_TEXT = ("قطعة رقم ( 20 ) تقع ضمن مخطط النرجس، في موقع يجمع بين الطابع الريفي الهادئ و بجوار النطاق "
                   "السكني. تتميز الأرض بصك إلكتروني وإمكانية إفراغ فوري")


def _unit_page(text: str) -> str:
    page = ashab_page(unit_page=True, desc="X")
    old = '<section id="description" class="myP"><b>نظرة عامة</b><p><p>X</p></p></section>'
    assert old in page
    return page.replace(old, '<section id="description" class="myP">\n <h3>نظرة عامة</h3>\n <p>\n'
                             f' <p>{text}</p>\n </p>\n </section>')


def test_ashab_unit_page_description_is_read():
    d = A.parse_page(_unit_page(ASHAB_UNIT_TEXT))
    assert d["description"].startswith("قطعة رقم ( 20 ) تقع ضمن مخطط النرجس")


def test_ashab_ad_page_b_heading_still_read():
    assert A.parse_page(ashab_page(desc="وحدة علوية بموقع مميز"))["description"] == "وحدة علوية بموقع مميز"


@pytest.fixture
def _catalog(monkeypatch):
    monkeypatch.setattr(A, "to_catalog", lambda c, region_hint=None: (11, 4) if c == "بريدة" else (None, None))
    monkeypatch.setattr(A, "find_district_in_text", lambda t, cid: None)


def test_ashab_unit_row_carries_the_redacted_description(_catalog):
    d = A.parse_page(_unit_page(ASHAB_UNIT_TEXT + f" للتواصل {PHONE}"))
    got, why = A.map_page(d, "1002-U1000", "https://ashab.sa/properties/1002/unit/1000", unit_of="1002",
                          building_licence="7201126713")
    assert got, why
    row, _cat = got
    assert row["description"].startswith("قطعة رقم ( 20 )") and PHONE not in row["description"]
