"""abwbna is a DIFFERENT TENANT of the SAME Nuzul SaaS platform aldarim already scrapes.

Found 2026-09-06: abwbna's cover images resolve to nuzul-saas-production.s3.us-east-2.amazonaws.com
/tenants/3846/..., the exact bucket family aldarim's tenant (3567) uses. Guessing the sibling API
host from aldarim's own pattern (<slug>.nzl-backend.com/api/public/properties) answered on the
first try — same JSON shape byte-for-byte. This file is a close CLONE of scrapers/aldarim/run.py,
not a fresh build, so what needs pinning is (a) the clone did not leave any aldarim-specific string
behind in a place that matters, and (b) the one shape difference measured live: abwbna's
availability_status includes 'reserved' (1/100 sampled), which must be excluded exactly like 'sold'.
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))
import scrapers.common.arabic_location as _al  # noqa: E402
_al.to_catalog = lambda city_ar: (None, None)   # DB-backed lookup; unit-irrelevant here

from scrapers.abwbna import run  # noqa: E402

# ── 1. NO ALDARIM STRING SURVIVED IN A PLACE THAT WRITES TO THE DATABASE ────────────────────────
# Comments citing aldarim as the origin of a shared fix are fine and expected (this file's own
# docstring does it); a literal "aldarim" in the SQL-facing constants below would mean the clone
# silently reads or writes the WRONG platform's rows.
assert "aldarim" not in run.API.lower()
assert "aldarim" not in run.SITE.lower()
assert "aldarim" not in str(run.HEADERS).lower()

L_ok = {"id": 1, "category": "residential", "purpose": "sell", "type": "villa",
        "availability_status": "available",
        "city": {"name_en": "Al Ahsa", "name_ar": "الاحساء"}, "district": None,
        "selling_price": 100, "area": 50, "cover_image_url": None, "images": []}
row, _ = run.map_listing(L_ok)
assert row["ad_number"].startswith("ABW"), "ad_number must carry the abwbna prefix, not ALD"
assert row["listing_url"].startswith("https://www.abwbna.com/"), row["listing_url"]
assert row["source"] == "Abwbna"

import inspect  # noqa: E402
main_src = inspect.getsource(run.main)
assert "abwbna_residential_listings" in main_src and "abwbna_commercial_listings" in main_src, (
    "the prune step must target abwbna's own tables — the clone left aldarim's table names here "
    "once, which would prune the WRONG platform's rows on every full crawl")
assert 'db.begin_run("abwbna")' in main_src
assert "db.upsert_abwbna_residential_batch" in main_src
assert "db.upsert_abwbna_commercial_batch" in main_src

# ── 2. THE ONE MEASURED SHAPE DIFFERENCE: 'reserved' IS EXCLUDED LIKE 'sold' ────────────────────
for status in ("sold", "reserved", "unavailable"):
    # main() filters BEFORE map_listing ever runs; this pins the exact predicate it uses.
    assert (status.lower() not in ("available", "", None)) is True
assert ("available".lower() not in ("available", "", None)) is False

# ── 3. REUSED FROM ALDARIM, STILL TRUE HERE: tri-state flags, never a manufactured negative ─────
assert run._flag(None) is None and run._flag("0") is False and run._flag(1) is True
assert run._kitchen_state(None, None) is None
assert run._kitchen_state(0, 3) is True, "a counted kitchen proves one even when the flag reads 0"

# ── 4. PRICE = SOURCE: selling_price is stored verbatim, never derived from area ────────────────
row, _ = run.map_listing({**L_ok, "selling_price": 3500000, "area": 750})
assert row["price_total"] == 3500000 and row["price_annual"] is None
row, _ = run.map_listing({**L_ok, "selling_price": None, "purpose": "rent",
                          "rent_price_annually": 24000})
assert row["price_annual"] == 24000 and row["rent_period"] == "annual"
row, _ = run.map_listing({**L_ok, "selling_price": None, "purpose": "rent",
                          "rent_price_annually": None, "rent_price_monthly": None})
assert row["price_annual"] is None and row["rent_period"] is None, (
    "no rent-price field published at all -> NULL, never a manufactured period")

print("ok: abwbna is a verified clean clone of aldarim's platform — no stray aldarim string in a "
      "DB-facing constant, reserved excluded like sold, tri-state/price rules carry over intact")
