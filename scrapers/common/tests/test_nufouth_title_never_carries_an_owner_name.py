"""PDPL: nufouth's «-H» office writes the owner's full name into the unit name
(«<asset> - <owner> [- n] F-H123»); 101 active titles carried one on 2026-09-28. The title keeps the
asset and the code only. Names below are placeholders, never real people."""
import sys
import types

sys.path.insert(0, ".")
for _n in ("supabase", "dotenv"):
    sys.modules.setdefault(_n, types.ModuleType(_n))
sys.modules["supabase"].Client = object
sys.modules["supabase"].create_client = lambda *a, **k: None
sys.modules["dotenv"].load_dotenv = lambda *a, **k: None

import scrapers.nufouth.run as R  # noqa: E402

OWNER = "فلان بن فلان الفلاني"


def test_an_owner_name_between_the_asset_and_the_code_is_dropped():
    assert R._public_title(f"(1-أرض سكنية)-أرض المبعوث - {OWNER} - 2 F-H659") == "(1-أرض سكنية)-أرض المبعوث F-H659"
    assert R._public_title(f"(2-شقة)-عمارة جزع الصدقة - {OWNER} F-H203") == "(2-شقة)-عمارة جزع الصدقة F-H203"
    assert R._public_title(f"(1-مزرعة)-مزرعة قرية - {OWNER} G-H163") == "(1-مزرعة)-مزرعة قرية G-H163"
    assert OWNER not in (R._public_title(f"عمارة - {OWNER} O-H191") or "")


def test_titles_without_an_owner_segment_are_untouched():
    for t in ("(11-مكتب)-الهلال -حي المروج-N5325", "(7-شقة)-المجدوعي - الواحة A-N4650", "(1-مكتب)-عمارة البدر 3 - الملقا-N1470"):
        assert R._public_title(t) == t
    assert R._public_title("") is None and R._public_title(None) is None


def test_the_row_the_scraper_writes_carries_no_owner_name():
    import json
    from scrapers.common.tests.test_nufouth_price_period_and_amenity_traps import N4990, N4990_AD, N4990_U1, URL
    unit = dict(N4990_U1, name=f"(2-شقة)-عمارة جزع الصدقة - {OWNER} F-H203")
    row, _cat, why = R.map_listing(N4990, N4990_AD, unit, URL)
    assert row is not None, why
    assert row["title"] == "(2-شقة)-عمارة جزع الصدقة F-H203"
    assert OWNER not in json.dumps(row, ensure_ascii=False, default=str)
