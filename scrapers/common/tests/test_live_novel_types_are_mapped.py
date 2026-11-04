"""Every raw type that was live in production and served as «غير معروف» on 2026-11-03 (legacy_novel_type
alerts 1056, 6898, 6899, 9742, 9822, 9866, 12334, 12436) maps to a clean type whose Arabic label exists —
except wasalt «Teller» and «Telecom tower», which owner decision #9 (2026-11-04) keeps «غير معروف»,
so the type filter can reach it. Fails on the old maps (each key was absent)."""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from scrapers.common import normalize  # noqa: E402
from scrapers.dealapp.run import TYPE_MAP_AR as DEAL  # noqa: E402
from scrapers.wasalt.run import WASALT_DELIBERATELY_UNMAPPED, WASALT_TYPE_OVERRIDES  # noqa: E402

LABELS = json.loads((ROOT / "src/data/taxonomy.source.json").read_text())["labels"]

WASALT = {"Farming Land": "Agriculture Plot", "Complex": "Compound"}
# Owner decision #9 (2026-11-04): these two stay «غير معروف» — unmapped on purpose, recorded in
# known_property_types by migration 20261104094019 so legacy_novel_type stops re-raising them.
WASALT_UNMAPPED = ("Teller", "Telecom tower")
MIGRATION = ROOT / "supabase/migrations/20261104094019_owner_decisions_4_5_9_aqar_rate_one_farm_area_wasalt_types.sql"
DEALAPP = {"بلك": "Residential Land", "ستريب مول": "Commercial Building",
           "مبنى عيادات": "Health Center", "مجمع طبي": "Health Center"}


def test_wasalt_subtypes_map():
    for raw, clean in WASALT.items():
        assert normalize.map_type_en(raw, WASALT_TYPE_OVERRIDES) == clean, raw
        assert clean in LABELS, clean


def test_wasalt_teller_and_telecom_tower_stay_unknown():
    assert tuple(WASALT_DELIBERATELY_UNMAPPED) == WASALT_UNMAPPED
    for raw in WASALT_UNMAPPED:
        assert normalize.map_type_en(raw, WASALT_TYPE_OVERRIDES) is None, raw
        assert raw not in WASALT_TYPE_OVERRIDES, raw
    sql = MIGRATION.read_text()
    for raw in WASALT_UNMAPPED:                       # the decision is recorded, not hidden
        assert f"('{raw}')" in sql, raw
    assert "insert into public.known_property_types" in sql and "owner decision #9" in sql


def test_dealapp_types_map():
    for raw, clean in DEALAPP.items():
        assert (DEAL.get(raw) or normalize.map_type(raw)) == clean, raw
        assert clean in LABELS, clean
