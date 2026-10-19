"""صادق التاجر: an ad that states a price but no area stores that price — never NULL.

THE BUG THIS PINS (2026-09-28). The price span was keyed on the area: «كود الاعلان … <price> <area>
م²». An ad with no area has no «م²», so the span never matched and the price the source prints was
stored NULL. 81 live rows had neither area nor price; 62 of them print one (19 Buy, 43 Rent — e.g.
SDQ7896 «38,000 ريال ( للإيجار )»). The other 19 print «لا يتوفر سعر» or «على السوم» and stay NULL.
Owner rules: PRICE = SOURCE, and no source-published price is ever hidden.

The headers below are copied from the live pages. Without an area the span ends at «اللوكيشن», so
the description after it («الدخل السنوي …») is still never read as the price.

Run: python -m pytest scrapers/common/tests/test_sadiqeltajer_reads_the_price_of_an_ad_without_an_area.py -q
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Hermetic: db.py must import with no credentials and no network.
_supabase = types.ModuleType("supabase")
_supabase.Client = type("Client", (), {})
_supabase.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase)
_dotenv = types.ModuleType("dotenv")
_dotenv.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv)

import scrapers.sadiqeltajer.run as S  # noqa: E402

TAIL = (" اللوكيشن تفاصيل الإعلان الدخل السنوي 30,000 ريال الموقع حسب الصك القصيم - بريدة - الرابية"
        " اعلانات مشابهة 5415 478 م² 285,000 ريال")

# header copied from the live ad                                                → parse_price
CASES = {
    # SDQ7896, rent, no area
    "كود الاعلان : 7896 | الفئة المطلوبة : عوائل للأيجار دبلكس بحي الرابية 38,000 ريال ( للإيجار )":
        (38000, None),
    # SDQ8198, sale, no area
    "كود الاعلان : 8198 (حد) للبيع استراحة بخب روضان غرب بريدة تقبل البنك ومبنية على الكود السعودي "
    "349,000 ريال": (349000, None),
    # SDQ7382: the per-metre marker still wins without an area
    "كود الاعلان : 7382 (سوم) ارض حي الوسيطئ 400 ريال ( للمتر )": (None, 400),
    # SDQ6884: no area, no marker — the figure as printed, a total (no area = nothing to prove
    # per-metre against; token prices stay, owner 2026-08-03)
    "كود الاعلان : 6884 (سوم) ارضين بحي الفاروق ( الازدهار ) شمال بريدة 600 ريال": (600, None),
    # SDQ8875 / SDQ7485: the source prints no price — the description's income is never it
    "كود الاعلان : 8875 | الفئة المطلوبة : عوائل للايجار دور علوي حي البساتين شرق بريدة لا يتوفر سعر":
        (None, None),
    "كود الاعلان : 7485 | رقم اللوحة : 3733 على السوم ارض حي البريكه": (None, None),
}


def test_an_ad_without_an_area_keeps_the_price_it_prints():
    for header, want in CASES.items():
        text = S.own_section("<html><body>" + header + TAIL + "</body></html>")
        assert S.parse_area(text) is None, header
        assert S.parse_price(text) == want, header


def test_the_rent_price_reaches_the_row(monkeypatch):
    monkeypatch.setattr(S, "to_catalog", lambda city_ar, region_hint=None: (1, 1))
    monkeypatch.setattr(S, "find_district_in_text", lambda text, city_id: text)
    page = ("<html><body>--&gt; للأيجار دبلكس بحي الرابية --&gt; إيجار فلل ودبلكسات (ايجار) "
            + next(iter(CASES)) + TAIL + "</body></html>")
    row, _cat, why = S.map_listing("https://sadiq-eltajer.sa/ads/llaygar-dblks-bhy-alraby", page)
    assert why == "" and row is not None
    assert row["transaction_type"] == "Rent" and row["area_m2"] is None
    assert row["price_annual"] == 38000, "the source prints 38,000 — NULL hides it"
