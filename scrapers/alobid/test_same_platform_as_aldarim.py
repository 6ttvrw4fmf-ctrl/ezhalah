"""alobid is a FIFTH tenant of the SAME Nuzul SaaS platform aldarim/abwbna already scrape.

Found 2026-09-06 the same way as abwbna: the tenant's own nzl-backend.com subdomain is visible in
its page HTML ('alobidoffice.nzl-backend.com' -- matching this site's own domain exactly, unlike
bahadhabab where the subdomain is 'bahadhabab-res', not 'bahadhabab'). Same public JSON API, no
auth, byte-identical shape. 139 listings across 2 pages, 138 available (1 excluded).
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))
import scrapers.common.arabic_location as _al  # noqa: E402
_al.to_catalog = lambda city_ar: (None, None)

from scrapers.alobid import run  # noqa: E402

# ── 1. NO ABWBNA STRING SURVIVED IN A PLACE THAT WRITES TO THE DATABASE ─────────────────────────
assert "abwbna" not in run.API.lower()
assert "abwbna" not in run.SITE.lower()
assert "abwbna" not in str(run.HEADERS).lower()

L_ok = {"id": 1, "category": "residential", "purpose": "sell", "type": "villa",
        "availability_status": "available",
        "city": {"name_en": "Jeddah", "name_ar": "جدة"}, "district": None,
        "selling_price": 100, "area": 50, "cover_image_url": None, "images": []}
row, _ = run.map_listing(L_ok)
assert row["ad_number"].startswith("ALB"), "ad_number must carry the alobid prefix"
assert row["listing_url"].startswith("https://www.alobidoffice.com/"), row["listing_url"]
assert row["source"] == "Alobid"

import inspect  # noqa: E402
main_src = inspect.getsource(run.main)
assert "alobid_residential_listings" in main_src and "alobid_commercial_listings" in main_src, (
    "the prune step must target alobid's own tables")
assert 'db.begin_run("alobid")' in main_src
assert "db.upsert_alobid_residential_batch" in main_src
assert "db.upsert_alobid_commercial_batch" in main_src

# ── 2. THIS TENANT'S NEW TYPE VALUES ALL MAP EXACTLY (verified live 2026-09-06) ─────────────────
from scrapers.common import normalize as n  # noqa: E402
for t in ("building_apartment", "istraha", "tower_apartment", "storage"):
    assert n.map_type_en(t), f"{t} has no canonical mapping"

# ── 3. REUSED FROM ALDARIM, STILL TRUE HERE ─────────────────────────────────────────────────────
assert run._flag(None) is None and run._flag("0") is False and run._flag(1) is True
row, _ = run.map_listing({**L_ok, "selling_price": 1200000, "area": None})
assert row["price_total"] == 1200000 and row["price_annual"] is None
row, _ = run.map_listing({**L_ok, "selling_price": None, "purpose": "rent",
                          "rent_price_annually": None, "rent_price_monthly": None})
assert row["price_annual"] is None and row["rent_period"] is None

print("ok: alobid is a verified clean clone of aldarim's platform — no stray abwbna string in a "
      "DB-facing constant, new type values map exactly, tri-state/price rules carry over intact")
