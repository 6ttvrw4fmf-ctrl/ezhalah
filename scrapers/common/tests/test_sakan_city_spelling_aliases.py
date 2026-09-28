"""sakan: the four city spellings the catalogue did not know (coverage audit 2026-09-28) resolve
through the SHARED alias table, never through a sakan-only map.

The alias rows live in sql/proposed/sakan_city_spelling_aliases.sql (staged until a session with
write authority applies and mirrors it). This test reads THAT file's VALUES rows, loads them into
the shared resolver exactly as arabic_location._load() loads loc_catalog_city_alias
(alias_norm = normalize_ar(alias) → the city's (city_id, region_id)), and runs sakan's real
map_listing() on the raw labels sakan's breadcrumb prints. Without the rows every one of them is
city_not_in_catalog — 64 live listings a day.
"""
from __future__ import annotations

import re
import sys
import types
from pathlib import Path

import pytest

_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.common import arabic_location as AL  # noqa: E402
from scrapers.sakan import run as S  # noqa: E402

SQL = Path(__file__).resolve().parents[3] / "sql" / "proposed" / "sakan_city_spelling_aliases.sql"
# The catalogue rows these aliases must land on (loc_catalog_city / loc_catalog_region, 2026-09-28).
CATALOG = {"الاحساء": (3677, 5), "محايل": (1801, 6), "قصر ابن عقيل": (2990, 4),
           "مدينة الملك عبدالله الاقتصادية": (3666, 2)}
REGIONS = {"المنطقة الشرقية": 5, "منطقة عسير": 6, "منطقة القصيم": 4, "منطقة مكة المكرمة": 2}
# (sakan's raw breadcrumb city, its region crumb, the catalogue city it must resolve to)
SAKAN = [("الاحسا 1", "المنطقة الشرقية", 3677), ("محائل", "منطقة عسير", 1801),
         ("قصرابن عقيل", "منطقة القصيم", 2990), ("مدينة الملك عبدالله الاقت", "منطقة مكة المكرمة", 3666)]


def _alias_rows() -> list[tuple[str, str, str]]:
    return re.findall(r"\('([^']+)', '([^']+)', '([^']+)'\)", SQL.read_text(encoding="utf-8"))


@pytest.fixture
def catalog(monkeypatch):
    # The REAL shared resolver — another sakan test swaps in a stub at import time.
    monkeypatch.setattr(S, "to_catalog", AL.to_catalog)
    cities = {AL.norm_ar(c): [ids] for c, ids in CATALOG.items()}
    monkeypatch.setattr(AL, "_CITY", cities)
    monkeypatch.setattr(AL, "_REGION_NORM", {AL.norm_ar(r): rid for r, rid in REGIONS.items()})
    return cities


def _map(city_ar, region_ar):
    return S.map_listing({"ad_id": "86910", "url": f"{S.BASE}{S.DETAIL_PATH}86910-", "status": S.STATUS_LIVE,
                          "type_ar": "فيلا", "deal": "Buy", "city_ar": city_ar, "region_ar": region_ar,
                          "price_ld": 1000000})


def test_without_the_aliases_sakans_spellings_are_not_in_the_catalogue(catalog):
    for city, region, _ in SAKAN:
        assert _map(city, region)[2] == "city_not_in_catalog", city


def test_the_staged_aliases_resolve_every_sakan_spelling(catalog):
    for alias, city_ar, region_ar in _alias_rows():
        (cid, rid), = catalog[AL.norm_ar(city_ar)]
        assert rid == REGIONS[region_ar], (alias, region_ar)          # the region corroborates
        catalog[AL.norm_ar(alias)] = [(cid, rid)]                     # = arabic_location._load()
    for city, region, want in SAKAN:
        row, _, why = _map(city, region)
        assert why == "" and row["city_id"] == want, (city, why)


def test_no_region_label_is_aliased_to_a_city():
    aliases = {AL.norm_ar(a) for a, _, _ in _alias_rows()}
    assert len(aliases) == 4
    for r in REGIONS:
        assert not aliases & {AL.norm_ar(r), AL.norm_ar(r.replace("منطقة ", ""))}, r
