"""Hermetic tests for the Gathern Tier-1 scraper fixes (2026-07-20):

  #5 additional_info.amenities — was stored from amenities[].title, which in the LIST response is a
     NUMERIC count string (["60","3","1","1"] — junk). Now read from the LIST response's features[]
     array, keeping only the REAL Arabic amenity labels (تلفزيون/انترنت/مصعد/موقف سيارة/دخول ذاتي/…)
     and dropping the structural rows (unit area / bedrooms / master beds) that own dedicated columns.
  #6 bathrooms — derived from the LIST response's amenities[] bathtub-icon object
     ({"icon": ".../bathtub-01.png", "count": N}); set ONLY when present with a positive count.

Fixtures are the EXACT shapes captured live from msapi search-units (city=3 Riyadh, monthly mode)
on 2026-07-20 — see the `_FEATURES_*` / `_AMENITIES_*` literals below (real values, verbatim).

    python -m pytest scrapers/common/tests/test_gathern_amenities_bathrooms.py -q
"""
from __future__ import annotations

import sys
import types

# ── Keep the import chain hermetic: stub supabase + dotenv so importing scrapers.gathern.run (which
#    pulls in scrapers.common.db / arabic_location) never touches a network or credentials. The two
#    functions under test are pure and use neither. (Same pattern as test_aqar_area_comma_parse.) ──
_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.gathern.run import _amenity_labels, _bathrooms  # noqa: E402


# ── REAL captured features[] (item 0, unit_type_id=6) — a MIX of structural rows + amenity labels ──
_FEATURES_ITEM0 = [
    "مساحة الوحدة 65 م2", "", "1 غرف نوم", "1 سرير ماستر",
    "إضاءة إضافية", "تلفزيون", "اطلالة على الحديقة", "انترنت", "دخول ذاتي", "مصعد",
]
# The amenity labels that MUST survive (structural rows + the empty string removed).
_EXPECTED_ITEM0 = ["إضاءة إضافية", "تلفزيون", "اطلالة على الحديقة", "انترنت", "دخول ذاتي", "مصعد"]

# A richer real page mixes in workspace ("مساحة عمل"), bride-prep room, speakers-with-trailing-space,
# and a "2 غرف نوم" bedroom count — all captured live.
_FEATURES_RICH = [
    "مساحة الوحدة 90 م2", "2 غرف نوم", "1 سرير ماستر", "",
    "مساحة عمل", "غرفة تجهيز عروس", "سماعات ", "موقف سيارة", "دخول ذاتي", "خزانة ملابس",
]

# ── REAL captured amenities[] (item 0) — icon/count/title objects; bathtub-01.png.count = bathrooms ──
_AMENITIES_ITEM0 = [
    {"icon": "https://cdn.gathern.co/icons/square-arrow-expand-01.png", "count": 65, "title": "65"},
    {"icon": "https://cdn.gathern.co/icons/area.png", "count": 6, "title": "6"},
    {"icon": "https://cdn.gathern.co/icons/bed-single-01.png", "count": 1, "title": "1"},
    {"icon": "https://cdn.gathern.co/icons/bathtub-01.png", "count": 1, "title": "1"},
    {"icon": "https://cdn.gathern.co/icons/microwave.png", "count": 0, "title": ""},
    {"icon": "https://cdn.gathern.co/icons/wifi-01.png", "count": 0, "title": ""},
    {"icon": "https://cdn.gathern.co/icons/tv.png", "count": 0, "title": ""},
]
# A real item that carries NO bathtub object at all (some studios) — verified live.
_AMENITIES_NO_BATH = [
    {"icon": "https://cdn.gathern.co/icons/square-arrow-expand-01.png", "count": 40, "title": "40"},
    {"icon": "https://cdn.gathern.co/icons/wifi-01.png", "count": 0, "title": ""},
]


# ─────────────────────────── #5 amenities: real labels, not numeric junk ───────────────────────────

def test_amenity_labels_keeps_only_real_arabic_labels():
    assert _amenity_labels(_FEATURES_ITEM0) == _EXPECTED_ITEM0


def test_amenity_labels_excludes_area_bed_and_master_rows():
    out = _amenity_labels(_FEATURES_ITEM0)
    assert "مساحة الوحدة 65 م2" not in out   # unit area → area_m2 column
    assert "1 غرف نوم" not in out             # bedrooms → bedrooms column
    assert "1 سرير ماستر" not in out          # master beds → master_bedrooms column
    assert "" not in out                      # the empty-string row


def test_amenity_labels_keeps_workspace_but_not_unit_area():
    # "مساحة عمل" (workspace) is a genuine amenity and must survive; only "مساحة الوحدة …" is dropped.
    out = _amenity_labels(_FEATURES_RICH)
    assert "مساحة عمل" in out
    assert "غرفة تجهيز عروس" in out
    assert all("مساحة الوحدة" not in x for x in out)
    assert "2 غرف نوم" not in out and "1 سرير ماستر" not in out


def test_amenity_labels_strips_trailing_whitespace_and_dedupes():
    out = _amenity_labels(["سماعات ", "سماعات", "تلفزيون", "تلفزيون "])
    assert out == ["سماعات", "تلفزيون"]         # stripped + de-duplicated, order preserved


def test_amenity_labels_result_has_no_numeric_junk():
    # Regression guard vs the OLD behaviour: the retired code stored amenities[].title, which on this
    # exact item was the numeric list below. The new labels must contain NONE of those pure numbers.
    old_junk = [a.get("title") for a in _AMENITIES_ITEM0
                if isinstance(a, dict) and a.get("title")]  # == ["65","6","1","1"]
    assert old_junk == ["65", "6", "1", "1"]
    new_labels = _amenity_labels(_FEATURES_ITEM0)
    assert all(not lbl.strip().isdigit() for lbl in new_labels)
    assert not (set(new_labels) & set(old_junk))


def test_amenity_labels_empty_and_none_and_nonstrings():
    assert _amenity_labels([]) == []
    assert _amenity_labels(None) == []
    assert _amenity_labels([None, 123, {"x": 1}, "تلفزيون"]) == ["تلفزيون"]


def test_amenity_labels_caps_at_30():
    many = [f"مرفق{i}" for i in range(50)]
    assert len(_amenity_labels(many)) == 30


# ─────────────────────────── #6 bathrooms: bathtub-01.png count, never fabricated ──────────────────

def test_bathrooms_from_bathtub_icon_count():
    assert _bathrooms(_AMENITIES_ITEM0) == 1


def test_bathrooms_reads_higher_counts():
    amen = [{"icon": "https://cdn.gathern.co/icons/bathtub-01.png", "count": 3, "title": "3"}]
    assert _bathrooms(amen) == 3


def test_bathrooms_absent_icon_returns_none():
    assert _bathrooms(_AMENITIES_NO_BATH) is None


def test_bathrooms_zero_count_returns_none():
    # A bathtub object with count 0 is "no data", not "0 bathrooms" — never store a fabricated 0.
    amen = [{"icon": "https://cdn.gathern.co/icons/bathtub-01.png", "count": 0, "title": ""}]
    assert _bathrooms(amen) is None


def test_bathrooms_bool_count_guarded():
    # bool is a subclass of int in Python — a stray True must NOT become 1 bathroom.
    amen = [{"icon": "https://cdn.gathern.co/icons/bathtub-01.png", "count": True, "title": ""}]
    assert _bathrooms(amen) is None


def test_bathrooms_none_and_empty():
    assert _bathrooms(None) is None
    assert _bathrooms([]) is None


def test_bathrooms_ignores_similar_icon_names():
    # Only the exact bathtub-01.png basename counts — a different bathtub icon must not be read as baths.
    amen = [{"icon": "https://cdn.gathern.co/icons/bathtub-02.png", "count": 5, "title": "5"}]
    assert _bathrooms(amen) is None
