"""THE RULE, pinned: a «منطقة X» region label is NOT a city. Region known, city UNKNOWN.

Audit 2026-08-10.

WHAT WAS WRONG
--------------
`to_catalog()` stripped BOTH admin prefixes — «محافظة X» and «منطقة X» — and retried the bare name
as a city:

    for pre in ("محافظه ", "منطقه "):
        if n.startswith(pre):
            stripped = n[len(pre):]
            break
    if stripped != n:
        hit = _pick_candidate(stripped, hint)   # ← 'منطقة الرياض' → the CITY الرياض

For a governorate the retry is correct: a governorate is named after its seat city, so
«محافظة الخرج» → الخرج is a real resolution. For a region it is not: a region is an administrative
area spanning many cities, and most of the 13 share a name with their capital. The retry therefore
upgraded region-level source precision into a specific city — silently, and with high confidence.

The function's own docstring already promised the opposite: "region label → (None, region_id)".

LIVE DAMAGE (alhoshan publishes region-level values in its city field)
---------------------------------------------------------------------
    584386  source city 'منطقة الرياض'  → resolved city_id=3 (الرياض city); title says حي الرمال
    584369  source city 'منطقة القصيم'  → title says البدائع — a different city entirely
    584375  source city 'منطقة جازان'   → resolved to جازان city
7 rows displayed a region label in the city field; 2 carried a fabricated city_id. That is invented
precision the source never gave, against the exact-location-only rule (honest unknown, never invent).

WHY THIS MATTERS BEYOND alhoshan
--------------------------------
`to_catalog()` is the SHARED resolver: aqargate, aqarmonthly, aldarim, alhoshan, hajer and sanadak
all call it. This is a fleet-wide guarantee, not a one-platform patch.

Hermetic: the catalog is stubbed, so no DB and no network.
"""

from __future__ import annotations

import sys
from pathlib import Path

# This test lives under scrapers/common/, next to http.py. pytest prepends the test file's own
# directory (rootdir-relative) in some layouts, which would shadow the stdlib `http` package and
# break the supabase→httpx import chain. Pin the repo root and drop any bare/`common` entry.
_HERE = str(Path(__file__).resolve().parent)
_COMMON = str(Path(__file__).resolve().parents[1])
sys.path[:] = [p for p in sys.path if p not in ("", ".", _HERE, _COMMON)]
sys.path.insert(0, ".")

import pytest  # noqa: E402

from scrapers.common import arabic_location as al  # noqa: E402

RIYADH_REGION, QASSIM_REGION, JAZAN_REGION = 1, 4, 10
RIYADH_CITY, JAZAN_CITY, KHARJ_CITY = 3, 17, 9


@pytest.fixture(autouse=True)
def _stub_catalog(monkeypatch):
    """Minimal catalog: cities that share a name with their region, plus a governorate seat."""
    cities = {
        al.norm_ar("الرياض"): [(RIYADH_CITY, RIYADH_REGION)],
        al.norm_ar("جازان"): [(JAZAN_CITY, JAZAN_REGION)],
        al.norm_ar("الخرج"): [(KHARJ_CITY, RIYADH_REGION)],
    }
    regions = {
        al.norm_ar("منطقة الرياض"): RIYADH_REGION,
        al.norm_ar("منطقة القصيم"): QASSIM_REGION,
        al.norm_ar("منطقة جازان"): JAZAN_REGION,
        al.norm_ar("الرياض"): RIYADH_REGION,
        al.norm_ar("القصيم"): QASSIM_REGION,
        al.norm_ar("جازان"): JAZAN_REGION,
    }
    monkeypatch.setattr(al, "_CITY", cities, raising=False)
    monkeypatch.setattr(al, "_REGION_NORM", regions, raising=False)
    monkeypatch.setattr(al, "_load", lambda: None, raising=False)


@pytest.mark.parametrize(
    "label,expected_region",
    [
        ("منطقة الرياض", RIYADH_REGION),
        ("منطقة القصيم", QASSIM_REGION),
        ("منطقة جازان", JAZAN_REGION),
    ],
)
def test_region_label_never_resolves_to_a_city(label, expected_region):
    city_id, region_id = al.to_catalog(label)
    assert city_id is None, f"{label!r} fabricated city_id={city_id} — a region is not a city"
    assert region_id == expected_region


@pytest.mark.parametrize("label,expected_city", [("الرياض", RIYADH_CITY), ("جازان", JAZAN_CITY)])
def test_real_city_still_resolves(label, expected_city):
    """The fix must not cost us ordinary city resolution."""
    assert al.to_catalog(label)[0] == expected_city


def test_governorate_still_resolves_to_its_seat_city():
    """«محافظة X» → X remains legitimate: a governorate IS named after its seat city."""
    assert al.to_catalog("محافظة الخرج")[0] == KHARJ_CITY
