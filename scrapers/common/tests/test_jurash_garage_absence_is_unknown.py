"""jurash `parking`: a page that says NOTHING about garages is UNKNOWN, not "no parking".

Found 2026-09-02 by the end-to-end UNKNOWN-safety census: `bool(garage_txt and garage_txt not in
("-", "—", "0"))` turned an absent/empty `pt_garages` cell into a confident `false` (2 active rows).
The published dash/zero forms stay a real negative; published text stays a positive.
"""
import pathlib
import sys
import types

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3]))

# Hermetic import: stub supabase/dotenv so importing the scraper never touches credentials.
_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.jurash.run import _parking_from_garage_text  # noqa: E402

SRC = pathlib.Path(__file__).resolve().parents[2].joinpath("jurash", "run.py").read_text(encoding="utf-8")


def test_absent_or_empty_cell_is_unknown():
    assert _parking_from_garage_text("") is None
    assert _parking_from_garage_text("   ") is None


def test_published_dash_or_zero_is_a_real_negative():
    for v in ("-", "—", "0"):
        assert _parking_from_garage_text(v) is False


def test_published_text_is_a_positive():
    assert _parking_from_garage_text("يتوفر مواقف للسيارات") is True
    assert _parking_from_garage_text("4") is True


def test_mapping_site_uses_the_helper_and_old_bool_shape_is_gone():
    assert "parking = _parking_from_garage_text(garage_txt)" in SRC
    assert 'parking = bool(garage_txt and garage_txt not in ("-", "—", "0"))' not in SRC
