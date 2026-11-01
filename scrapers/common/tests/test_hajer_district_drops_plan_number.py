"""hajer: the district matches without its plan number; the card keeps it (🔬 AF engineer, 2026-10-11).

Owner rule 2026-09-14 (migration 20260914204035): «in our district, we don't include numbers. We just match it
with ours, and then in their property card, if they kept a number, we include that number». hajer writes the
subdivision plan number into أسم الحي («الورود (1100/4)»). Stored verbatim in district_ar, norm_district_tok()
kept the number and no district option reached the listing (journey FAIL hajer_residential_listings:584515,
backlog 184/247). The 25 stored rows were repaired by 20261011093718, watched by
mon_detect_district_plan_number_stranded.
"""
import sys
from unittest import mock

import pytest

sys.path.insert(0, ".")

for name in ("supabase", "dotenv"):
    if name not in sys.modules:
        stub = mock.MagicMock()
        if name == "dotenv":
            stub.load_dotenv = lambda *a, **k: None
        sys.modules[name] = stub

import scrapers.hajer.run as H  # noqa: E402

H.to_catalog = lambda city_ar, region_hint=None: (1, 1)


def _page(*fields: tuple[str, str]) -> str:
    return "".join(f'<strong class="rem-single-field-title">{k}</strong>'
                   f'<span class="rem-single-field-value">{v}</span>' for k, v in fields)


def _base(district: str):
    return (("رقم الإعلان", "4023"), ("نوع العقار", "شقة"), ("غرض العقار", "بيع"), ("التصنيف", "سكني"),
            ("المدينة", "الاحساء"), ("أسم الحي", district), ("السعر", "650000"))


P = {"id": 1, "link": "https://hajerhouses.com/property/x/", "title": {"rendered": "شقة"}}

# every plan-numbered shape live on hajer on 2026-10-11
CASES = [
    ("الورود (1100/4)", "الورود"),
    ("الصقور (787/4)", "الصقور"),
    ("مخطط الرياض (474/19)", "مخطط الرياض"),
    ("جنوب منسوب التعليم (253/4)", "جنوب منسوب التعليم"),
    ("الدوحة (شرق شرق الحديقة)- 776/4", "الدوحة (شرق شرق الحديقة)"),
    ("مخطط النخيل (الجشة) 258/4", "مخطط النخيل (الجشة)"),
]


@pytest.mark.parametrize("raw,district", CASES)
def test_plan_number_leaves_the_district_and_stays_on_the_card(raw, district):
    row, _, _ = H.map_listing(P, _page(*_base(raw)))
    assert row["district_ar"] == district
    assert row["neighborhood"] == raw


@pytest.mark.parametrize("raw", ["الدانة", "ضاحية هجر(الحي الأول)", "الملك فهد(المحدود)", "الرابية- الهفوف",
                                 "الحمراء الثاني"])
def test_a_name_without_a_plan_number_is_untouched(raw):
    row, _, _ = H.map_listing(P, _page(*_base(raw)))
    assert row["district_ar"] == raw
