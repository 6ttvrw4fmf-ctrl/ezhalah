"""october (www.1october.com.sa, a Nuzul tenant) serves ONLY the source's available units.

THE DEFECT (coverage audit 2026-09-28). The old reader walked the /properties HTML JSON-LD list:
Nuzul ignores ?page= there, so it saw 9 of the API's 18 records, and it never read
availability_status. 8 of 12 active rows were rented/sold/reserved at the source and the available
44236 was never seen. The fix reads the tenant API through the shared Nuzul reader (jawher/run.py),
skips every status but `available`, pins the rows whose own record said otherwise, and prunes with
the Nuzul verify_gone oracle.

Hermetic: records are the live API's own values (captured 2026-09-28, trimmed to the keys the reader
uses); HTTP, the location catalogue and every DB call are stubbed. main() is the real one.

    python -m pytest scrapers/common/tests/test_october_nuzul_api_available_only.py -q
"""
from __future__ import annotations

import sys
import types
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
_sb = types.ModuleType("supabase")
_sb.Client = object
_sb.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _sb)
_dv = types.ModuleType("dotenv")
_dv.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dv)

from scrapers.common import db, sold_pin  # noqa: E402
from scrapers.jawher import run as J  # noqa: E402
from scrapers.october import run as R  # noqa: E402

RES, COM = "october_residential_listings", "october_commercial_listings"
# information_schema.columns for october_residential_listings (== commercial), production 2026-09-28.
# The fleet-union LISTING_COLUMNS check cannot see a column THIS table lacks (the aqarcity PGRST204).
OCTOBER_COLUMNS = set((
    "active ad_number additional_info additional_number air_conditioner apartment_in_project area_m2 "
    "balcony_terrace bathrooms bedrooms building_number car_entrance city date_added deactivated_at "
    "description direction driver_room electricity elevator extension halls id image_storage_keys "
    "interior_space_m2 kitchen last_liveness_probe_at last_seen_at last_update last_verified_alive_at "
    "laundry_room listing_url maid_room master_bedrooms missing_count neighborhood optical_fibers "
    "outdoor_area_m2 parking photo_urls price_annual price_per_meter price_total private_entrance "
    "project_name property_age property_type raw_captured_at raw_html_key reception_rooms_majlis "
    "rega_location_verified region rent_now_pay_later rent_now_pay_later_monthly rent_period "
    "residence_type sanitation scraped_at separate_electricity_meter separate_water_meter source "
    "source_capture special_position special_surface street_name street_width_m title "
    "transaction_type video_url villa_on_roof water_supply zip_code").split())


def _rec(pid, type_, purpose, category, status, city, district, *, rent=None, sell=None,
         name=None, desc=None, area=None, bedrooms=0, bathrooms=0):
    return {"id": pid, "type": type_, "purpose": purpose, "product": "office", "category": category,
            "availability_status": status, "name_ar": name, "description_ar": desc,
            "city": {"name_ar": city}, "district": {"name_ar": district}, "is_wafi_ad": False,
            "selling_price": sell, "rent_price_annually": rent, "rent_price_monthly": None,
            "area": area, "bedrooms": bedrooms, "bathrooms": bathrooms,
            "rega_advertiser_number": "1100000000"}


CATALOGUE = {r["id"]: r for r in (
    # available
    _rec(45056, "building_apartment", "rent", "residential", "available", "جدة", "حي طيبة",
         rent=40000, area=198.5, bedrooms=5, bathrooms=4, name="شقة فاخرة للإيجار – الموسى فيو",
         desc="• 🛏️ 3 غرف نوم (منها غرفة ماستر بحمام خاص) • 🛋️ مجلس واسع"),
    _rec(52960, "kiosk", "rent", "commercial", "available", "مكة المكرمة", "حي بطحاء قريش",
         rent=150000, area=20),
    _rec(52959, "atm", "rent", "commercial", "available", "مكة المكرمة", "حي بطحاء قريش",
         rent=150000, area=6, name="موقع تأجير صراف ألي"),
    _rec(44236, "store", "rent", "commercial", "available", "مكة المكرمة", "حي ولي العهد",
         rent=180000, area=380),
    # not available — still listed by the API, with the platform's own status
    _rec(44240, "villa", "sell", "residential", "sold", "جدة", "حي الفلاح", sell=1300000, area=312),
    _rec(46582, "tower_apartment", "rent", "residential", "rented", "جدة", "حي الفيحاء", rent=85000,
         name="شقة فاخرة مفروشة للإيجار في إعمار سكوير – حي الفيحاء"),
    _rec(46023, "duplex", "rent", "residential", "rented", "جدة", "حي الياقوت", rent=80000),
)}


def _world(monkeypatch):
    """What production held before the fix: sold/rented rows active, 46023 filed commercial."""
    store = {RES: [{"ad_number": a, "active": True} for a in ("OCT44240", "OCT46582", "OCT45056")],
             COM: [{"ad_number": a, "active": True} for a in ("OCT46023", "OCT52960", "OCT52959")]}
    seen: dict = {"upserts": {RES: [], COM: []}, "pins": {}, "prune": {}}

    class _Q:
        def __init__(self, rows): self.rows = rows
        def select(self, *_): return self
        def eq(self, k, v): return _Q([r for r in self.rows if r.get(k) == v])
        def in_(self, k, vs): return _Q([r for r in self.rows if r.get(k) in vs])

    monkeypatch.setattr(J, "to_catalog", lambda city, region_hint=None: (18, 2) if city else (None, None))
    monkeypatch.setattr(J, "find_district_in_text", lambda text, city_id: text)
    monkeypatch.setattr(R, "session", lambda: None)
    monkeypatch.setattr(R, "fetch_ids", lambda s, base, limit=0: (list(CATALOGUE), True))
    monkeypatch.setattr(R, "fetch_detail", lambda s, base, pid: (CATALOGUE[pid], "live"))
    monkeypatch.setattr(db, "sb", lambda: SimpleNamespace(table=lambda t: _Q(store[t])))
    monkeypatch.setattr(db, "_execute", lambda q, what="": SimpleNamespace(data=q.rows))
    monkeypatch.setattr(db, "begin_run", lambda slug: 1)
    monkeypatch.setattr(db, "end_run", lambda *a, **k: True)
    monkeypatch.setattr(db, "retire_superseded_siblings", lambda **k: 0)
    monkeypatch.setattr(db, "upsert_october_residential_batch", lambda rows: seen["upserts"][RES].extend(rows))
    monkeypatch.setattr(db, "upsert_october_commercial_batch", lambda rows: seen["upserts"][COM].extend(rows))
    monkeypatch.setattr(sold_pin, "pin_source_confirmed_gone",
                        lambda table, ads, **k: seen["pins"].__setitem__(table, (list(ads), k)))

    def _prune(table, ads, source=None, verify_gone=None, **_):
        seen["prune"][table] = (set(ads), verify_gone)
        return 0
    monkeypatch.setattr(db, "prune_unseen", _prune)
    monkeypatch.setattr(sys, "argv", ["october", "--type", "all", "--delay", "0"])
    return seen


def test_only_available_units_are_served_and_the_rest_are_pinned_off(monkeypatch):
    seen = _world(monkeypatch)
    assert R.main() == 0

    by_ad = {r["ad_number"]: r for t in (RES, COM) for r in seen["upserts"][t]}
    # exactly the source's available units — 44236 included, nothing rented/sold
    assert set(by_ad) == {"OCT45056", "OCT52960", "OCT52959", "OCT44236"}
    assert {r["ad_number"] for r in seen["upserts"][RES]} == {"OCT45056"}

    # the rows whose OWN record said rented/sold are pinned in the table that holds them
    assert seen["pins"][RES][0] == ["OCT44240", "OCT46582"]
    assert seen["pins"][COM][0] == ["OCT46023"]
    assert seen["pins"][COM][1]["oracle"] == "october.sold_pin.availability_status"
    assert seen["pins"][RES][1]["notes"]["OCT44240"] == "availability_status=sold"

    # removals from the catalogue go through the Nuzul oracle, never absence alone
    assert all(vg is not None for _, vg in seen["prune"].values())

    # identity kept; types october decided; bedrooms stay NULL (the counter is total rooms)
    assert by_ad["OCT45056"]["listing_url"] == "https://www.1october.com.sa/properties/45056"
    assert by_ad["OCT45056"]["source"] == "1 October"
    assert (by_ad["OCT52960"]["property_type"], by_ad["OCT52959"]["property_type"]) == ("Kiosk", "ATM Site")
    assert by_ad["OCT45056"]["bedrooms"] is None and by_ad["OCT45056"]["bathrooms"] == 4
    assert (by_ad["OCT45056"]["price_annual"], by_ad["OCT45056"]["rent_period"]) == (40000, "annual")
    assert by_ad["OCT45056"]["region"] == "Makkah"

    # every key is a real column of THESE tables (price_evidence is folded by _wasalt_batch)
    for ad, row in by_ad.items():
        extra = set(row) - OCTOBER_COLUMNS - {"price_evidence"}
        assert not extra, f"{ad} writes keys october_*_listings do not have: {sorted(extra)}"
