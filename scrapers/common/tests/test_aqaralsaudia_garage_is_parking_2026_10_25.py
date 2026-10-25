"""aqaralsaudia: RealHomes' own garage count (REAL_HOMES_property_garage) is parking.

ops_af_score 2026-10-25: aqaralsaudia found 0 of 4, parking we_miss 3. «1» on 11 of 16 active ads and parking
was stored on none. Yes or silence, never «no» (ADVANCED_FILTER_SOURCE_TRUTH §2). 🔬 2026-10-25.

Run: python -m pytest scrapers/common/tests/test_aqaralsaudia_garage_is_parking_2026_10_25.py -q
"""
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

from scrapers.aqaralsaudia import run  # noqa: E402


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    # Only THIS module's names, and only for the test: patching arabic_location.to_catalog itself leaked into
    # every later test in the session (sukna's 125 tests read «city_not_in_catalog», PR 8650 CI 10-25).
    monkeypatch.setattr(run, "to_catalog", lambda city_ar: (None, None))
    monkeypatch.setattr(run, "deal_from_page", lambda url: None)


def _row(garage):
    meta = {"REAL_HOMES_property_price": "650000", "REAL_HOMES_property_size": "120",
            "REAL_HOMES_property_bedrooms": "2", "REAL_HOMES_property_address": "لبن, منطقة الرياض, السعودية"}
    if garage is not None:
        meta["REAL_HOMES_property_garage"] = garage
    post = {"id": 9014, "link": "https://aqaralsaudia.com/property/x/", "title": {"rendered": "شقة للبيع بحي لبن"},
            "content": {"rendered": "شقة ارضية فاخرة مكونة من مجلس وصاله ومطبخ وغرفتين نوم"},
            "property_meta": meta,
            "_embedded": {"wp:term": [[{"taxonomy": "property-type", "name": "شقة"},
                                       {"taxonomy": "property-status", "name": "للبيع"}]]}}
    row, _ = run.map_listing(post)
    assert row
    return row


def test_a_garage_count_is_parking():
    assert _row("1").get("parking") is True
    assert _row("2").get("parking") is True


def test_no_garage_count_is_silence_not_no():
    for g in (None, "", "0"):
        assert "parking" not in _row(g)
