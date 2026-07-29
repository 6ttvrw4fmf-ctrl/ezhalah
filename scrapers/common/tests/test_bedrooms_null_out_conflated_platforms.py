"""Regression tests for the 2026-07-28 bedrooms-fidelity fix, owner decision: for any platform
where the source has no bedroom-SPECIFIC figure (only a generic total-room count that can include a
majlis/living room in Saudi listing convention), null `bedrooms` rather than store an unverifiable
number.

A 34-platform live audit (following the abeea/muktamel area_m2 fix, PR#259) found roughly half of
all scrapers stored a generic "N rooms" figure as bedroom count. Four platforms had CONFIRMED live
numeric mismatches on real active listings: aqargate (5435594: DB=11, listing's own description
enumerates 5 real bedrooms), dealapp (558063: DB=6, description enumerates only 3), jazwtn (3/3
sampled rows wrong), and alhoshan (AH1012: DB=10, description enumerates 5 — added in a follow-up
pass once its differently-shaped root cause was understood: `specs.bedrooms` is a real API field,
but alhoshan.sa's own front end renders it under the generic label "الغرف", not a bedroom-specific
one, per the site's own embedded i18n dictionary).

Three shapes of fix were applied, by platform:
  1. NULL entirely — no bedroom-specific field exists anywhere on the source:
     aqargate, aqarcity, aqarmonthly, alhoshan, dealapp, jazwtn, mizlaj, mustqr, october, raghdan,
     sadin, souq24.
  2. Tighten the extraction regex to REQUIRE the "نوم" (bedroom) qualifier instead of a bare "غرف"
     (rooms) match — live testing showed these generally DO carry the qualifier, so this narrows
     false-positive risk without losing real coverage:
     alkhaas, alnokhba, gathern, nowaisiry.
  3. Remove an ambiguous FALLBACK label while keeping a genuinely bedroom-specific PRIMARY field:
     aqar (kept "غرف النوم", dropped "عدد الغرف" fallback), aqaratikom (kept estate.bedroom, dropped
     the REGA authority_details "عدد الغرف" fallback).

Platforms left UNCHANGED (confirmed DIRECT, or live-proven correct despite a generic-sounding
field/attribute name): aldarim, abeea, erapulse, eaqartabuk, hajer, jurash, muktamel, ramzalqasim,
sanadak, satel, toor, wasalt, fursaghyr (already NULL-only), eastabha (live-proven its "data-rooms"
attribute genuinely tracks the bedroom-specific figure, not the page's separate "Rooms" total).

Run: python -m pytest scrapers/common/tests/test_bedrooms_null_out_conflated_platforms.py -v
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, ".")

SCRAPERS_DIR = Path(__file__).resolve().parents[2]


def _src(platform: str) -> str:
    return (SCRAPERS_DIR / platform / "run.py").read_text(encoding="utf-8")


# ═══ 1. NULL-entirely platforms — source-text assertions (the ambiguous field is gone, bedrooms is
# unconditionally None at the write site) ═══════════════════════════════════════════════════════

def test_alhoshan_specs_bedrooms_no_longer_feeds_bedrooms():
    text = _src("alhoshan")
    assert '"bedrooms": _int(specs.get("bedrooms")),' not in text
    assert '"bedrooms": None,' in text


def test_aqargate_numberOfRooms_no_longer_feeds_bedrooms():
    text = _src("aqargate")
    assert '"bedrooms": _int(ar.get("numberOfRooms")),' not in text
    assert '"bedrooms": None,' in text


def test_aqarcity_no_longer_derives_bedrooms_dead_helper_removed():
    text = _src("aqarcity")
    assert "_sane_beds(_int(pi.get" not in text
    assert '"bedrooms": None,' in text
    assert "def _sane_beds(" not in text


def test_aqarmonthly_beds_field_no_longer_feeds_bedrooms():
    text = _src("aqarmonthly")
    assert '"bedrooms":         N.to_int(g.get("beds")),' not in text
    assert '"bedrooms":         None,' in text


def test_dealapp_numberOfRooms_no_longer_feeds_beds():
    text = _src("dealapp")
    assert 'beds = _int(io.get("numberOfRooms"))' not in text
    assert re.search(r"beds = None\n\s*baths = _spec_int", text)


def test_jazwtn_title_regex_removed_bedrooms_unconditionally_none():
    text = _src("jazwtn")
    assert "BEDS_RE = re.compile" not in text
    assert re.search(r"bedrooms = None\n\s*baths = None", text)


def test_mizlaj_number_of_rooms_no_longer_feeds_bedrooms():
    text = _src("mizlaj")
    assert 'rooms = _int(rega.get("number_of_rooms"))' not in text
    assert "bedrooms = None" in text


def test_mustqr_rooms_field_no_longer_feeds_bedrooms():
    text = _src("mustqr")
    assert 'bedrooms = _int(p.get("rooms"))' not in text
    assert re.search(r"bedrooms = None\n\n    area = _int", text)


def test_october_specs_bedrooms_no_longer_feeds_beds():
    text = _src("october")
    assert 'beds = specs.get("bedrooms")' not in text
    assert re.search(r"beds = None\n    baths = specs\.get", text)


def test_raghdan_no_longer_derives_bedrooms_dead_helper_removed():
    text = _src("raghdan")
    assert "_sane_beds(_int(specs.get" not in text
    assert '"bedrooms": None,' in text
    assert "def _sane_beds(" not in text


def test_sadin_card_beds_chip_no_longer_feeds_beds():
    text = _src("sadin")
    assert 'beds = card.get("beds")' not in text
    assert re.search(r"beds = None\n    baths = card\.get", text)


def test_souq24_room_spec_no_longer_feeds_beds():
    text = _src("souq24")
    assert 'beds = _to_int(specs.get("عدد الغرف"))' not in text
    assert re.search(r"beds = None\n    facade", text)


# ═══ 2. Fallback-removed platforms — the good primary field still works, the ambiguous fallback is
# gone ══════════════════════════════════════════════════════════════════════════════════════════

def test_aqar_primary_kept_fallback_removed():
    text = (SCRAPERS_DIR / "aqar" / "enrich_residential.py").read_text(encoding="utf-8")
    assert 'bedrooms          = _int_after_label(text, r"غرف\\s*النوم")' in text
    assert 'r"غرف\\s*النوم", r"عدد\\s*الغرف")' not in text

    # The extraction function itself (_int_after_label) is real and DB-independent — exercise it.
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "aqar_enrich_residential", SCRAPERS_DIR / "aqar" / "enrich_residential.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod._int_after_label("شقة فيها غرف النوم 3 وحمامين", r"غرف\s*النوم") == 3
    assert mod._int_after_label("شقة فيها عدد الغرف 5", r"غرف\s*النوم") is None


def test_aqaratikom_primary_kept_fallback_removed():
    text = _src("aqaratikom")
    assert 'bedroom = _int(estate.get("bedroom"))' in text
    assert 'or _int(amap.get("عدد الغرف"))' not in text


# ═══ 3. Regex-tightened platforms — require "نوم", exercise the real extraction functions ═══════

def test_alkhaas_requires_noom_qualifier():
    from scrapers.alkhaas.run import BEDS_RE
    assert BEDS_RE.search("الدور الثاني : 3 غرف نوم ماستر") is not None
    assert BEDS_RE.search("شقة فيها 5 غرف واسعة") is None


def test_alnokhba_requires_noom_qualifier():
    from scrapers.alnokhba.run import _beds
    assert _beds("شقة فيها 3 غرف نوم واسعة") == 3
    assert _beds("عمارة 10 غرف للإيجار") is None


def test_gathern_requires_noom_qualifier():
    from scrapers.gathern.run import _BEDS_RE
    assert _BEDS_RE.search("1 غرف نوم (1 سرير ماستر)") is not None
    assert _BEDS_RE.search("2 غرف نوم (4 سرير مفرد)") is not None
    assert _BEDS_RE.search("5 غرف فسيحة") is None


def test_nowaisiry_requires_noom_qualifier():
    text = _src("nowaisiry")
    assert r'r"([\d٠-٩]{1,2})\s*غرف\s*نوم"' in text


if __name__ == "__main__":
    test_alhoshan_specs_bedrooms_no_longer_feeds_bedrooms()
    test_aqargate_numberOfRooms_no_longer_feeds_bedrooms()
    test_aqarcity_no_longer_derives_bedrooms_dead_helper_removed()
    test_aqarmonthly_beds_field_no_longer_feeds_bedrooms()
    test_dealapp_numberOfRooms_no_longer_feeds_beds()
    test_jazwtn_title_regex_removed_bedrooms_unconditionally_none()
    test_mizlaj_number_of_rooms_no_longer_feeds_bedrooms()
    test_mustqr_rooms_field_no_longer_feeds_bedrooms()
    test_october_specs_bedrooms_no_longer_feeds_beds()
    test_raghdan_no_longer_derives_bedrooms_dead_helper_removed()
    test_sadin_card_beds_chip_no_longer_feeds_beds()
    test_souq24_room_spec_no_longer_feeds_beds()
    test_aqar_primary_kept_fallback_removed()
    test_aqaratikom_primary_kept_fallback_removed()
    test_alkhaas_requires_noom_qualifier()
    test_alnokhba_requires_noom_qualifier()
    test_gathern_requires_noom_qualifier()
    test_nowaisiry_requires_noom_qualifier()
    print("OK — bedrooms null-out / regex-tighten / fallback-removal regression tests pass")
