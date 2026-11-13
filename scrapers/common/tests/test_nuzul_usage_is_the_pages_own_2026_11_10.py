"""Nuzul sites: the usage row and a LAND ad's type follow the ad page's own «الاستخدام» (owner 2026-11-10).

Measured: aldarim ad 50820 — the page prints «الاستخدام: تجاري», the title says «أرض تجارية», and Ezhalah showed
«أرض سكنية» with usage «residential». The scrapers read the API's `category` (the office's hidden filing pick, never
shown on the page) for both jobs; the page prints the is_for_* flags. About 55 active land ads on six Nuzul sites were
served as the wrong kind of land. Owner, shown the ad: «Fix all bro these issues can't happen».

The rule lives in ONE place, scrapers/common/nuzul_usage.py. This file
  1. executes the rule itself (the truth table, and values that are not a yes);
  2. executes EVERY Nuzul scraper's real map_listing() on a land ad in each of the cases the sites really publish;
  3. discovers every scraper that talks to Nuzul and fails on one that is not behind the shared rule — so a tenant
     added tomorrow is red until it is.

Run: python3 -m pytest -q scrapers/common/tests/test_nuzul_usage_is_the_pages_own_2026_11_10.py
"""
from __future__ import annotations

import importlib
import json
import re
import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

for _name, _attrs in (("supabase", {"Client": object, "create_client": lambda *a, **k: None}),
                      ("dotenv", {"load_dotenv": lambda *a, **k: None})):
    _m = types.ModuleType(_name)
    for _k, _v in _attrs.items():
        setattr(_m, _k, _v)
    sys.modules.setdefault(_name, _m)

from scrapers.common import arabic_location as al  # noqa: E402
from scrapers.common import nuzul_usage as U  # noqa: E402
from scrapers.common.tests import test_goldendeal_nuzul_source_fidelity as _G  # noqa: E402
from scrapers.common.tests import test_jawher_nuzul_source_fidelity as _J  # noqa: E402

FLAGS = [f for f, _, _ in U.USE_FLAGS]

# the three code families, and every tenant that runs each
CLONES = ["aldarim", "abwbna", "alobid", "bahadhabab"]     # map_listing(L) -> (row, category)
GOLDEN = ["goldendeal", "yameen"]                          # map_listing(L, tenant, this_year=) -> (row, category, why)
JAWHER = ["jawher", "m3tmd", "october"]                    # map_listing(d) -> (row, category, why)
# senan left Nuzul on 2026-11-12 (its new static site: scrapers/senan/run.py, test_senan_static_projects_2026_11_12.py)
EVERY = CLONES + GOLDEN + JAWHER


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    """Never hit the network: one unambiguous city, and the district is whatever the ad states."""
    monkeypatch.setattr(al, "_load", lambda: None)
    monkeypatch.setattr(al, "_CITY", {al.norm_ar("الرياض"): [(3, 1)], al.norm_ar("جدة"): [(18, 2)]})
    monkeypatch.setattr(al, "_REGION_NORM", {})
    monkeypatch.setattr(al, "_DISTRICT_BY_CITY", {3: {al.norm_district_tok("حي المطار")}})
    for name, cities in (("goldendeal", {"جدة": (18, 2)}), ("jawher", {"جدة": (18, 2)})):
        mod = importlib.import_module(f"scrapers.{name}.run")
        monkeypatch.setattr(mod, "to_catalog", lambda city_ar, region_hint=None, _c=cities: _c.get((city_ar or "").strip(), (None, None)))
        monkeypatch.setattr(mod, "find_district_in_text", lambda text, city_id: (text or "").strip() or None)


def _land(site: str, category: str, on: tuple[str, ...]) -> dict:
    """A land ad as the API sends it, with the office's filing `category` and exactly the use flags in `on` set."""
    if site in CLONES:      # hand-built: the captured aldarim payloads carry phone numbers
        item = {"id": 50820, "purpose": "sell", "type": "land", "selling_price": 15000000, "area": 51000,
                "city": {"id": 3, "name_en": "Riyadh", "name_ar": "الرياض"},
                "district": {"id": 1, "name_en": "Al Matar Dist.", "name_ar": "حي المطار"}}
    elif site in GOLDEN:
        item = json.loads(json.dumps(_G.LAND_50495))
    else:
        item = json.loads(json.dumps(_J.LAND))
    item["category"] = category
    for f in FLAGS:
        item[f] = f in on
    return item


def _mapped(site: str, item: dict) -> tuple[dict, str]:
    mod = importlib.import_module(f"scrapers.{site}.run")
    if site in GOLDEN:
        out = mod.map_listing(item, mod.TENANT, this_year=2026)
    else:
        out = mod.map_listing(item)
    row, category = out[0], out[1]
    assert row is not None, f"{site}: the land ad was skipped ({out[2:]})"
    return row, category


def _usage(row: dict):
    """The value the card prints under «الاستخدام» — a list of rows (aldarim family) or object-shaped extras."""
    info = row.get("additional_info")
    rows = info if isinstance(info, list) else (info or {}).get("rows")
    if isinstance(rows, list):
        vals = [r.get("value") for r in rows if isinstance(r, dict) and r.get("key") == "usage"]
        assert len(vals) <= 1, "one usage row at most"
        return vals[0] if vals else None
    return (info or {}).get("usage")


R, C, FARM = "is_for_residential", "is_for_commercial", "is_for_farming"

# (office's category, flags on) -> (type we store, table, the page's usage words)
CASES = [
    # the page settles it — the office's hidden filing must not overrule it
    ("residential", (C,), "Commercial Land", "commercial", "تجاري"),          # aldarim 50820, m3tmd 37176, jawher 51496
    ("commercial", (R,), "Residential Land", "residential", "سكني"),          # aldarim 41719
    ("residential", (R,), "Residential Land", "residential", "سكني"),
    ("commercial", (C,), "Commercial Land", "commercial", "تجاري"),
    # the page does not settle it — the filing decides, the usage row still prints the page's words
    ("residential", (R, C), "Residential Land", "residential", "سكني، تجاري"),  # aldarim 39815
    ("commercial", (R, C), "Commercial Land", "commercial", "سكني، تجاري"),
    ("residential", (FARM,), "Residential Land", "residential", "زراعي"),     # aldarim 49109
    ("commercial", (C, "is_for_health", "is_for_factory"), "Commercial Land", "commercial", "تجاري، صحي، صناعي"),  # goldendeal 48914
    # the page prints no «الاستخدام» row at all — we print none either (never the office's filing)
    ("residential", (), "Residential Land", "residential", None),             # aldarim 27808
    ("commercial", (), "Commercial Land", "commercial", None),
]


@pytest.mark.parametrize("site", EVERY)
@pytest.mark.parametrize("category,on,want_type,want_table,want_usage", CASES)
def test_a_land_ad_is_stored_as_the_page_shows_it(site, category, on, want_type, want_table, want_usage):
    row, table = _mapped(site, _land(site, category, on))
    assert (row["property_type"], table, _usage(row)) == (want_type, want_table, want_usage)


@pytest.mark.parametrize("site", EVERY)
def test_the_offices_hidden_filing_is_never_printed_as_the_usage(site):
    row, _ = _mapped(site, _land(site, "residential", (C,)))
    shown = json.dumps(_usage(row), ensure_ascii=False)
    assert "residential" not in shown and "سكني" not in shown


@pytest.mark.parametrize("site", EVERY)
def test_a_flag_that_is_not_a_yes_is_silence(site):
    item = _land(site, "residential", ())
    item.update({C: "0", "is_for_health": None, "is_for_factory": 0, FARM: "", "is_for_education": "no"})
    row, table = _mapped(site, item)
    assert (row["property_type"], table, _usage(row)) == ("Residential Land", "residential", None)
    item.update({C: 1, R: "0"})                       # the API's integer / string spellings of a yes
    row, table = _mapped(site, item)
    assert (row["property_type"], table, _usage(row)) == ("Commercial Land", "commercial", "تجاري")


@pytest.mark.parametrize("site", JAWHER)
def test_the_machine_list_and_the_shown_words_use_one_yes_rule(site):
    """`usages` (machine names) and `usage` (the page's words) come from the same flags by the same rule."""
    item = _land(site, "residential", (C,))
    item.update({R: "0", FARM: "false", "is_for_health": ""})        # strings that are not a yes
    info = _mapped(site, item)[0]["additional_info"]
    assert (info.get("usages"), info.get("usage")) == (["commercial"], "تجاري")
    item = _land(site, "residential", ())
    item.update({R: "0"})
    info = _mapped(site, item)[0]["additional_info"]
    assert info.get("usages") is None and info.get("usage") is None


def test_the_rule_itself():
    assert U.land_category({"category": "residential", C: True}) == "commercial"
    assert U.land_category({"category": "commercial", R: True}) == "residential"
    assert U.land_category({"category": "commercial", R: True, C: True}) == "commercial"
    assert U.land_category({"category": "residential", R: True, C: True}) == "residential"
    assert U.land_category({"category": "commercial", FARM: True}) == "commercial"
    assert U.land_category({}) == "residential" and U.land_category({"category": None}) == "residential"
    assert U.usage_shown_ar({}) is None and U.usage_shown_ar({"category": "commercial"}) is None
    assert U.usage_shown_ar({R: True, C: 1, "is_for_education": "1"}) == "سكني، تجاري، تعليمي"
    assert U.uses_on({C: True, FARM: "true", R: "0"}) == ["commercial", "farming"]
    # the words are the six the pages print, one per flag
    assert [ar for _, _, ar in U.USE_FLAGS] == ["سكني", "تجاري", "تعليمي", "صحي", "صناعي", "زراعي"]


# ── 3. every scraper that talks to Nuzul is behind the shared rule ───────────────────────────────────────────────────
# maqam left the Nuzul API (it reads the page's own category_ar); eightfloor is the v2 API on one office with two
# apartments and no use flags observed — neither prints a usage row nor decides a land type from the filing.
NOT_THE_NUZUL_USAGE_SHAPE = {"maqam", "eightfloor"}
_TALKS_TO_NUZUL = re.compile(r"nzl-backend|is_for_(residential|commercial)|\bnuzul_usage\b|nuzul\.api\.|from scrapers\.(jawher|goldendeal)\.run import|from scrapers\.(jawher|goldendeal) import")


def _nuzul_scrapers(sources: dict[str, str]) -> list[str]:
    return sorted(n for n, src in sources.items() if _TALKS_TO_NUZUL.search(src) and n not in NOT_THE_NUZUL_USAGE_SHAPE)


def _unguarded(sources: dict[str, str]) -> list[str]:
    """Nuzul scrapers that neither use the shared rule nor take their mapping from an engine that does."""
    direct = {n for n, src in sources.items() if re.search(r"\bnuzul_usage\.(land_category|usage_shown_ar)\(", src)}
    def behind(n: str) -> bool:
        return n in direct or any(re.search(rf"from scrapers\.{e}(\.run)? import|from scrapers import {e}\b", sources[n]) for e in direct)
    return [n for n in _nuzul_scrapers(sources) if not behind(n)]


def _sources() -> dict[str, str]:
    return {p.parent.name: p.read_text(encoding="utf-8") for p in sorted((ROOT / "scrapers").glob("*/run.py"))}


def test_every_nuzul_scraper_is_behind_the_shared_rule_and_is_executed_above():
    src = _sources()
    found = _nuzul_scrapers(src)
    assert _unguarded(src) == [], "a Nuzul scraper decides usage / land type without scrapers/common/nuzul_usage.py"
    assert found == sorted(EVERY), ("a scraper talks to Nuzul but this file does not execute it — add it to its family "
                                    f"above (or to NOT_THE_NUZUL_USAGE_SHAPE with the measured reason): {sorted(set(found) ^ set(EVERY))}")


def test_the_discovery_catches_a_tenant_added_tomorrow():
    src = _sources()
    # a new clone that copies the old code: reads the filing for the usage row, no shared rule
    src["newoffice"] = 'BASE = "https://newoffice.nzl-backend.com/api"\nrows.append({"key": "usage", "value": L.get("category")})\n'
    assert _unguarded(src) == ["newoffice"]
    # a thin tenant over the jawher engine is covered by the engine…
    src["newoffice"] = "from scrapers.jawher.run import nuzul_fields\n"
    assert _unguarded(src) == [] and "newoffice" in _nuzul_scrapers(src)
    # …and an engine that drops the rule uncovers every tenant riding on it
    src["jawher"] = src["jawher"].replace("nuzul_usage.", "nuzul_usage_")
    assert set(_unguarded(src)) >= {"jawher", "m3tmd", "october", "newoffice"}


@pytest.mark.parametrize("site", CLONES)
def test_no_clone_reads_the_filing_for_its_usage_row(site):
    src = _sources()[site]
    assert not re.search(r'"key":\s*"usage"[^\n]*category', src), "the usage row must be nuzul_usage.usage_shown_ar(L)"
