"""hajer: the structured «واجهة العقار» reaches the direction column (🔬 AF engineer, 2026-10-06).

114 of 120 live hajer rows publish it in the REM spec table (جنوب / شمال / شرق / غرب, or two joined
by «*»), but map_listing() filed it only in additional_info, so every hajer listing was invisible to
the Advanced Filter's direction question (ops_af_score 2026-10-06: hajer direction we_miss 5/5).
A row whose table has no «واجهة العقار» keeps direction NULL (silent is unknown).
"""
import sys
from unittest import mock

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


BASE = (("رقم الإعلان", "1512"), ("نوع العقار", "دبلكس"), ("غرض العقار", "بيع"), ("التصنيف", "سكني"),
        ("المدينة", "الاحساء"), ("أسم الحي", "الحمراء الثاني"), ("السعر", "1050000"))
P = {"id": 1, "link": "https://hajerhouses.com/property/x/", "title": {"rendered": "دبلكس"}}


def test_the_published_facade_is_stored_in_the_column():
    row, _, _ = H.map_listing(P, _page(*BASE, ("واجهة العقار", "جنوب")))
    assert row["direction"] == "جنوب"


def test_a_two_way_facade_is_kept_as_published():
    row, _, _ = H.map_listing(P, _page(*BASE, ("واجهة العقار", "جنوب*غرب")))
    assert row["direction"] == "جنوب*غرب"


def test_silence_is_unknown():
    row, _, _ = H.map_listing(P, _page(*BASE))
    assert row["direction"] is None
