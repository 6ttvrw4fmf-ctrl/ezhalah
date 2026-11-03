"""Every raw type that was live in production and served as «غير معروف» on 2026-11-03 (legacy_novel_type
alerts 1056, 6898, 6899, 9742, 9822, 9866, 12334, 12436) maps to a clean type whose Arabic label exists,
so the type filter can reach it. Fails on the old maps (each key was absent)."""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from scrapers.common import normalize  # noqa: E402
from scrapers.dealapp.run import TYPE_MAP_AR as DEAL  # noqa: E402
from scrapers.wasalt.run import WASALT_TYPE_OVERRIDES  # noqa: E402

LABELS = json.loads((ROOT / "src/data/taxonomy.source.json").read_text())["labels"]

WASALT = {"Farming Land": "Agriculture Plot", "Complex": "Compound",
          "Telecom tower": "Telecom Tower", "Teller": "ATM Site"}
DEALAPP = {"بلك": "Residential Land", "ستريب مول": "Commercial Building",
           "مبنى عيادات": "Health Center", "مجمع طبي": "Health Center"}


def test_wasalt_subtypes_map():
    for raw, clean in WASALT.items():
        assert normalize.map_type_en(raw, WASALT_TYPE_OVERRIDES) == clean, raw
        assert clean in LABELS, clean


def test_dealapp_types_map():
    for raw, clean in DEALAPP.items():
        assert (DEAL.get(raw) or normalize.map_type(raw)) == clean, raw
        assert clean in LABELS, clean
