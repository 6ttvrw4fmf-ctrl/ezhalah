"""Golden tests for scrapers/aqar/enrich_residential.py's parse_price_per_meter() (bug B2,
2026-07-16) — old-vs-new over REAL aqar page text harvested from the live DB (source_capture->
source_text snippets, trimmed to the pricing/spec block; advertiser info removed).

The bug: the old pattern `(\\d[\\d,]{1,})\\s*[§ر﷼]?\\s*/?\\s*(?:متر|م²)` made the currency AND the
slash optional, so any bare "N م²" matched — and aqar's spec row is
"... المساحة <area> م² سعر المتر <value> § ..." (the real per-meter value comes AFTER its label).
re.search's leftmost match was therefore the AREA on essentially every canonical page. Stored
data mostly survived because the trg_aqar_parse trigger recomputes Buy ppm as price_total/area
and NULLs Rent ppm — but the bogus transient value still fed _sanitize_price, and for land with
area > 300,000 m² it crossed the 300k/m² typo gate: hide → trigger stores sane prices → the 05:20
auto_recover_false_inactive cron resurrects → next enrich re-poisons. A daily flap on 18 live
rows (e.g. ads 6693642, 6708090).

New contract: anchor to the سعر المتر label; keep an explicit-slash rate fallback ("N §/متر")
guarded by reject-if-equal-to-the-area-token. These goldens pin old and new behaviour side by
side on every harvested shape, including the ones where the old parse was correct.
"""
from __future__ import annotations

import re
import sys
import types

# ── Stub supabase + dotenv so importing scrapers.common.db (for _sanitize_price) is hermetic ────
_supabase_mod = types.ModuleType("supabase")


class _StubClient:
    pass


_supabase_mod.Client = _StubClient
_supabase_mod.create_client = lambda url, key: _StubClient()
sys.modules.setdefault("supabase", _supabase_mod)

_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.aqar.enrich_residential import parse_price_per_meter  # noqa: E402
from scrapers.common import normalize as N  # noqa: E402
from scrapers.common.db import _sanitize_price  # noqa: E402

# The retired pattern, verbatim — kept here ONLY to document what the old code returned on each
# golden sample. It must never come back into production code.
_OLD_RE = re.compile(r"(\d[\d,]{1,})\s*[§ر﷼]?\s*/?\s*(?:متر|م²)")


def _old_parse(text: str):
    m = _OLD_RE.search(text)
    return N.to_int(m.group(1)) if m else None


# ── Golden samples — live DB source_text, trimmed ────────────────────────────────────────────────

# Ad 6693642 (flap exemplar #1): agricultural land, area 717,928 m², page says سعر المتر = 1 §.
G_6693642 = ("تفاصيل الإعلان الواجهة 4 شوارع عرض الشارع 50 م المساحة 717,928 م² سعر المتر 1 § "
             "المميزات توفر الماء معلومات الإعلان معلومات إضافية تفاصيل الموقع رقم الإعلان 6693642")

# Ad 6708090 (flap exemplar #2): land, area 739,100 m², spec row سعر المتر = 7.5 §; the free-text
# description ALSO mentions the rate, label-less and with a decimal comma ("سعر متر البيع 7,5 ريال").
G_6708090 = ("فرصه للمستثمرين سعر متر البيع 7,5 ريال ملاحظه : نقبل البدل والمقايضة المزيد "
             "تفاصيل الإعلان الواجهة جنوب عرض الشارع 50 م المساحة 739,100 م² سعر المتر 7.5 §")

# Ad 6768687: normal-size land; description quotes area WITHOUT م² ("المساحة 412 م الشارع") and the
# spec row carries a fractional سعر المتر.
G_6768687 = ("للبيع أرض بحي الرجاء 2/419 بعزيزية الخبر رقم القطعة 1/224 المساحة 412 م الشارع 15 "
             "شمال السعر 450 الف المزيد تفاصيل الإعلان نوع العقار سكني الواجهة شمال عرض الشارع 15 م "
             "المساحة 412 م² سعر المتر 1,093.74 §")

# Ad 6762590: the rate appears TWICE — free text "سعر المتر : 1800﷼" and spec row "سعر المتر 1,800 §".
G_6762590 = ("تبعد عن الحرم المكي 18 كيلو سعر المتر : 1800﷼ المزيد تفاصيل الإعلان نوع العقار سكني "
             "عرض الشارع 30 م المساحة 570 م² سعر المتر 1,800 §")

# Ad 6776946: description has a decimal area "882.49 م²" and a label-less rate "2,200 ريال للمتر";
# the spec row has the real label.
G_6776946 = ("📍 الموقع: حي شاطئ نصف القمر – الدمام 📐 المساحة: 882.49 م² 💰 سعر البيع: 2,200 ريال "
             "للمتر المزيد تفاصيل الإعلان نوع العقار سكني الواجهة شمال عرض الشارع 15 م المساحة 882 م² "
             "سعر المتر 2,201.22 §")

# Ad 6318985 (Rent apartment): NO سعر المتر anywhere — only area + rent-payment figures.
G_6318985 = ("المزيد تفاصيل الإعلان المساحة 80 م² الفئة عوائل غرف النوم 1 الصالات 1 دورات المياه 1 "
             "عمر العقار 6 سنوات المميزات مؤثثة مطبخ دفعات الإيجار 1500 § سنوي دفعة واجدة 1,500 § "
             "على شهري 125 § لكل شهر")

# Ad 6622613 (Buy apartment): spec row with area but no سعر المتر label.
G_6622613 = ("المزيد تفاصيل الإعلان نوع العقار سكني غرف النوم 4 عمر العقار 9 سنة المساحة 145 م² "
             "المميزات مطبخ توفر الماء توفر الكهرباء توفر صرف صحي")


# ── The flap rows: old = area (poison), new = the page's own سعر المتر value ────────────────────

def test_flap_6693642_new_reads_the_label_old_read_the_area():
    assert _old_parse(G_6693642) == 717_928          # the AREA — what poisoned _sanitize_price
    assert parse_price_per_meter(G_6693642) == 1     # the page's actual سعر المتر


def test_flap_6708090_new_reads_the_label_old_read_the_area():
    assert _old_parse(G_6708090) == 739_100
    # to_int("7.5") truncates the halala fraction to whole riyals, same as every other price path.
    assert parse_price_per_meter(G_6708090) == 7


def test_flap_rows_no_longer_trip_the_sanitize_gate():
    """End-to-end assertion of the flap mechanics: the OLD parse crossed _sanitize_price's
    300k/m² typo gate (active=False → hide → recover → flap); the NEW parse must not."""
    for g in (G_6693642, G_6708090):
        old_row = {"active": True, "price_per_meter": _old_parse(g)}
        _sanitize_price(old_row)
        assert old_row["active"] is False, "old parse must trip the gate (that WAS the flap)"

        new_row = {"active": True, "price_per_meter": parse_price_per_meter(g)}
        _sanitize_price(new_row)
        assert new_row["active"] is True, "new parse must NOT trip the gate"


# ── Canonical spec-row pages: new = label value; old grabbed the area here too ──────────────────

def test_spec_row_with_fractional_value():
    assert _old_parse(G_6768687) == 412              # area again — old was wrong on normal pages too
    assert parse_price_per_meter(G_6768687) == 1_093  # to_int("1,093.74") → 1093 (trigger stores 1094)


def test_free_text_and_spec_row_agree():
    assert _old_parse(G_6762590) == 570
    assert parse_price_per_meter(G_6762590) == 1_800  # leftmost label hit "سعر المتر : 1800﷼"


def test_decimal_area_in_description_does_not_leak():
    # Old regex matched the fraction digits of "882.49 م²" — ppm "49"(!).
    assert _old_parse(G_6776946) == 49
    assert parse_price_per_meter(G_6776946) == 2_201


# ── Pages with no سعر المتر: honest None (old returned the area) ────────────────────────────────

def test_rent_page_without_label_is_none():
    assert _old_parse(G_6318985) == 80
    assert parse_price_per_meter(G_6318985) is None


def test_buy_apartment_without_label_is_none():
    assert _old_parse(G_6622613) == 145
    assert parse_price_per_meter(G_6622613) is None


def test_empty_and_numberless_text_is_none():
    assert parse_price_per_meter("") is None
    assert parse_price_per_meter("أرض للبيع في موقع مميز سعر المتر عند التواصل") is None


# ── Shapes where the OLD parse was CORRECT must keep working ────────────────────────────────────

def test_explicit_rate_shape_preserved():
    """Label-less but unambiguous rate ("N § / متر", slash present): the one shape the old regex
    got right. The new fallback must return the same value the old code did."""
    for text, want in (
        ("أرض تجارية للبيع بسعر 1,500 § / متر موقع ممتاز", 1_500),
        ("للبيع 2,000/م² قابل للتفاوض", 2_000),
    ):
        assert _old_parse(text) == want
        assert parse_price_per_meter(text) == want


def test_rate_fallback_rejects_the_area_token():
    """Defense in depth on the fallback: a slashed number equal to the page's area token is the
    area leaking through some layout quirk, not a rate → None rather than poison."""
    text = "المساحة 800 م² السعر 800/م²"
    assert parse_price_per_meter(text) is None


def test_market_average_stats_are_skipped():
    """Aqar pages embed neighbourhood stats ("متوسط سعر المتر …") — the listing's own spec-row
    value must win, not the market average."""
    text = ("متوسط سعر المتر 3,500 § في هذا الحي المزيد تفاصيل الإعلان المساحة 400 م² "
            "سعر المتر 2,000 §")
    assert parse_price_per_meter(text) == 2_000
