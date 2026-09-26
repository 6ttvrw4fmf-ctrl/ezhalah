"""Every key a scraper writes must be a REAL column of the listing table it writes to.

THE INCIDENT (2026-09-14). suwar's first production run fetched all 167 listings correctly and then
died on the upsert:

    ✗ {'code': 'PGRST204', 'message': "Could not find the 'living_rooms' column
       of 'suwar_residential_listings' in the schema cache"}

Three more were wrong in the same row and would have surfaced one redeploy at a time: `majlis_rooms`
(the column is `reception_rooms_majlis`), `garden` and `security_cameras` (no column exists at all).
Every one came from reading the SEARCH INDEX's column names — search_listings_ar genuinely has
`living_rooms` and `majlis_rooms` — and assuming the listing TABLE matched. It does not.

Nothing caught it before production because the scraper's own tests build rows and assert on their
CONTENT, never on whether the keys are writable, and `_wasalt_batch` passes the dict straight to
PostgREST. The cost is a whole run: the fetch succeeds, the upsert rejects everything, zero rows land.

So this asserts the row SHAPE against production's real column list — an oracle, read from
information_schema on 2026-09-14, not a list this repo invented. Adding a column to the shared shape
means adding it here, which is the point: the two cannot drift silently.

Run: python -m pytest scrapers/common/tests/test_scraper_rows_only_use_real_columns.py -v
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

import scrapers.common.arabic_location as _al  # noqa: E402

# The shared listing shape, verbatim from
#   select column_name from information_schema.columns
#    where table_name = 'suwar_residential_listings'
# on production, 2026-09-14 (89 columns); re-read from nufouth_residential_listings on 2026-09-24:
# 90 columns, the one addition being last_liveness_probe_at (20260924020545). Every
# *_residential_listings / *_commercial_listings table is created `LIKE abwbna_… INCLUDING ALL`, so
# they all carry exactly this set.
LISTING_COLUMNS = {
    'active', 'ad_number', 'ad_source', 'additional_info', 'additional_number', 'air_conditioner',
    'apartment_in_project', 'area_m2', 'balcony_terrace', 'bathrooms', 'bedrooms',
    'building_number', 'car_entrance', 'city', 'city_ar', 'city_id', 'date_added',
    'deactivated_at', 'deed_area_m2', 'description', 'direction', 'discount_pct', 'district_ar',
    'driver_room', 'electricity', 'elevator', 'extension', 'floor_number', 'fullparse_done',
    'furnished', 'halls', 'id', 'image_storage_keys', 'interior_space_m2', 'kitchen',
    'last_liveness_probe_at', 'last_seen_at', 'last_update', 'last_verified_alive_at',
    'laundry_room', 'license_expiry',
    'license_number', 'listing_url', 'maid_room', 'master_bedrooms', 'missing_count',
    'neighborhood', 'num_apartments', 'optical_fibers', 'outdoor_area_m2', 'parking', 'photo_urls',
    'plan_parcel', 'price_annual', 'price_original', 'price_per_meter', 'price_total',
    'private_entrance', 'project_name', 'property_age', 'property_type', 'raw_captured_at',
    'raw_html_key', 'reception_rooms_majlis', 'rega_location_verified', 'region', 'region_id',
    'rent_now_pay_later', 'rent_now_pay_later_monthly', 'rent_period', 'reparsed_v2',
    'residence_type', 'sanitation', 'scraped_at', 'separate_electricity_meter',
    'separate_water_meter', 'source', 'source_capture', 'special_position', 'special_surface',
    'street_name', 'street_width_m', 'tenant_category', 'title', 'transaction_type', 'video_url',
    'views_count', 'villa_on_roof', 'water_supply', 'zip_code',
}

# The names that were actually wrong, kept as an explicit anti-list so the specific defect cannot
# come back wearing the same clothes. The right-hand side is the column that DOES exist.
KNOWN_WRONG = {
    'living_rooms': 'halls',
    'majlis_rooms': 'reception_rooms_majlis',
    'garden': None,             # no column — belongs in additional_info
    'security_cameras': None,   # no column — belongs in additional_info
}


@pytest.mark.parametrize("bad,right", sorted(KNOWN_WRONG.items()))
def test_the_names_that_broke_production_are_still_not_columns(bad, right):
    assert bad not in LISTING_COLUMNS, f"{bad!r} is not a column of the listing tables"
    if right:
        assert right in LISTING_COLUMNS, f"{right!r} IS the real column and must exist"


# ── the real check: build a row with each scraper and inspect its keys ───────────────────────────
_MECCA, _RIYADH = 6, 3


@pytest.fixture(autouse=True)
def _seed(monkeypatch):
    monkeypatch.setitem(_al._CITY, "_stub_", [(1, 1)])
    for cid, districts in ((_MECCA, ["حي ولي العهد"]), (_RIYADH, ["حي الياسمين"])):
        monkeypatch.setitem(_al._DISTRICT_BY_CITY, cid,
                            {_al.norm_district_tok(d) for d in districts})
        for d in districts:
            monkeypatch.setitem(_al._DISTRICT_AR_BY_NORM, _al.norm_district_tok(d), d)


def _suwar_row(monkeypatch):
    from scrapers.suwar import run as S
    monkeypatch.setattr(S, "to_catalog", lambda c, region_hint=None: (_MECCA, 2) if c == "مكة" else (None, None))
    post = {"id": 1, "link": "https://suwar.sa/property/x/",
            "title": {"rendered": "مشروع رقم 709 فيلا تمليك الموقع ولي العهد 6"},
            "content": {"rendered": "<p>وصف</p>"},
            "_embedded": {"wp:term": [[{"taxonomy": "property_feature", "name": n}
                                       for n in ("مصعد", "موقف خاص", "غرفة سائق", "خزان مستقل",
                                                 "كاميرات مراقبه", "حوش")]],
                          "wp:featuredmedia": [{"source_url": "https://suwar.sa/a.jpg"}]}}
    detail = {"price": 1200000, "status": "متاح", "address": "مكة, Saudi Arabia",
              "text": "الغرف / 5 الصالات / 3 المجالس / 2 دورات المياه / 6 المساحة / 300 م"}
    row, _ = S.map_listing(post, detail)
    return row


def _rakez_row(monkeypatch):
    from scrapers.rakez import run as R
    monkeypatch.setattr(R, "to_catalog", lambda n, region_hint=None: (_RIYADH, 1) if n == "الرياض" else (None, None))
    tree = {443: {"name": "الرياض", "parent": 0},
            1434: {"name": "شمال الرياض", "parent": 443},
            566: {"name": "الياسمين", "parent": 1434}}
    proj = {"id": 66800, "title": {"rendered": "أدوار إرث - الياسمين الرياض"},
            "_embedded": {"wp:term": [[{"taxonomy": "city", "id": 566, "name": "الياسمين"},
                                       {"taxonomy": "property-type", "name": "أدوار"},
                                       {"taxonomy": "property-status", "name": "متاح"},
                                       {"taxonomy": "feature", "name": "مصعد"}]],
                          "wp:featuredmedia": [{"source_url": "https://rakez.sa/a.jpg"}]}}
    unit = {"id": 72544, "link": "https://rakez.sa/en/unit/x/", "title": {"rendered": "ارث"},
            "acf": {"unit_project": 66800, "unit_status": "available", "price": 1350000,
                    "rooms_count": 2, "area": 160.49, "floor": "rooftop", "code": "F1",
                    "description_ar": "مجلس"}}
    row, _ = R.map_unit(unit, proj, proj, tree)
    return row


@pytest.mark.parametrize("name,build", [("suwar", _suwar_row), ("rakez", _rakez_row)])
def test_every_key_the_scraper_writes_is_a_real_column(name, build, monkeypatch):
    row = build(monkeypatch)
    assert row, f"{name}: the fixture must produce a row, or this test proves nothing"
    unknown = sorted(set(row) - LISTING_COLUMNS)
    assert not unknown, (
        f"{name} writes {unknown}, which {'is' if len(unknown) == 1 else 'are'} not a column of the "
        f"listing tables. PostgREST rejects the WHOLE batch on an unknown key (PGRST204), so the "
        f"run fetches everything and stores nothing — exactly what happened to suwar on 2026-09-14.")


@pytest.mark.parametrize("name,build", [("suwar", _suwar_row), ("rakez", _rakez_row)])
def test_the_row_is_not_vacuously_small(name, build, monkeypatch):
    # A row that lost its fields would trivially satisfy the check above.
    row = build(monkeypatch)
    assert len(row) >= 20, f"{name}: only {len(row)} keys — the fixture stopped exercising the mapper"
    for essential in ("ad_number", "listing_url", "source", "property_type", "transaction_type"):
        assert essential in row, f"{name} is missing {essential}"


def test_the_guard_would_actually_catch_the_original_defect(monkeypatch):
    # CONTROL: re-introduce the exact key that broke production and watch the rule reject it.
    row = _suwar_row(monkeypatch)
    mutated = {**row, "living_rooms": 3}
    assert sorted(set(mutated) - LISTING_COLUMNS) == ["living_rooms"], (
        "the check must flag the very key PostgREST rejected, or it is not guarding the incident")


# ── the eleven platforms onboarded 2026-09-21 ────────────────────────────────────────────────────
# Their tables (migration 20260921185629) are `LIKE aqar_residential_listings INCLUDING ALL` plus
# city_ar / district_ar / city_id / region_id — read from production's information_schema on
# 2026-09-21 that is EXACTLY LISTING_COLUMNS above, so the same oracle applies. Rather than a
# hand-built fixture per platform (which only proves the fixture), this reads every key each
# scraper can put in a row literal straight from its syntax tree: the dict literal that carries
# ad_number + listing_url + source, and every `row["key"] = …` on the variable it is bound to.
# That is where the suwar defect lived — a wrong key typed into the row literal — and it is
# checked for every row-shaped literal in the file, not one code path.
BATCH_2026_09_21 = ("alsidra", "moftah", "masar", "gomenassat", "sakan", "bossbih", "alshawaf",
                    "ialqarawi", "aljassim", "almotmkenah", "nufouth")

# The thirty-five onboarded 2026-09-24 (tables: 20260924170534, same LIKE + four location columns),
# plus abaad, whose own tables landed 2026-09-25 (20260925011243, the identical LIKE shape).
BATCH_2026_09_24 = ("abaad", "dwelleo", "aqalemhajer", "sakani", "shatri", "alqasem", "fkralemar", "wadod",
                    "almuteb", "aalbarrak", "alrifai", "sodasyat", "hasaad", "aqaralriyadh", "justsa",
                    "snam", "jawher", "m3tmd", "senan", "goldendeal", "thousand", "yameen", "ebriza",
                    "eilmalriyada", "daryusuf", "albdah", "eydah", "tamyaz", "hazim", "villassa",
                    "marksa", "rightcompound", "livingcompound", "azure", "expattrusted", "flow")
# BUILT BUT NOT YET ONBOARDED — the scraper exists in the tree and its tables are still to be
# created. The check is purely static (it parses run.py), so the guarantee applies from the day the
# scraper is written rather than from the day its tables land: a wrong key is then caught in the PR
# that introduces it instead of by the first production run, which is the whole point of the suwar
# lesson. Every *_listings table is created `LIKE … INCLUDING ALL`, so LISTING_COLUMNS is the oracle
# for these too. Move a platform into its dated batch above once its migration is applied.
NOT_YET_ONBOARDED = ("alsaedan", "ego", "muhaysini", "nofodh", "razre", "reinvest", "safa",
                     "sokok", "sukna", "tuba", "remaxsa")

# A platform whose row literal lives in ANOTHER scraper's file (yameen imports goldendeal's
# map_listing, yameen/run.py:56-58) is judged on that file — a defect there is a defect in both.
ROW_LITERAL_LIVES_IN = {"yameen": "goldendeal"}

# Keys that never reach PostgREST: db._wasalt_batch pops them into source_capture first
# (_fold_price_evidence / _fold_images_evidence). Anything else must be a column.
FOLDED_BEFORE_UPSERT = {"price_evidence", "images_evidence"}

_SCRAPERS = ROOT / "scrapers"


def _row_literal_keys(tree) -> set[str]:
    """Every key a scraper writes onto its row: the anchored literal, keys assigned onto the row
    afterwards (row["k"] = …), and — the jawher shape, missed on the first crawl of 2026-09-24 —
    keys of any dict literal SPLATTED into the row ({"ad_number": …, **fields}), recursively."""
    import ast

    def str_keys(d: ast.Dict) -> set[str]:
        return {k.value for k in d.keys if isinstance(k, ast.Constant) and isinstance(k.value, str)}

    bound: dict[str, ast.Dict] = {}      # name -> the dict literal it was bound to
    extra: dict[str, set[str]] = {}      # name -> keys assigned later via name["k"] = …
    for node in ast.walk(tree):
        if isinstance(node, (ast.Assign, ast.AnnAssign)) and isinstance(node.value, ast.Dict):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for t in targets:
                if isinstance(t, ast.Name):
                    bound[t.id] = node.value
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if (isinstance(t, ast.Subscript) and isinstance(t.value, ast.Name)
                        and isinstance(t.slice, ast.Constant) and isinstance(t.slice.value, str)):
                    extra.setdefault(t.value.id, set()).add(t.slice.value)

    def keys_of(d: ast.Dict, seen: tuple = ()) -> set[str]:
        ks = str_keys(d)
        for k, v in zip(d.keys, d.values):
            if k is None and isinstance(v, ast.Name) and v.id in bound and v.id not in seen:
                ks |= keys_of(bound[v.id], seen + (v.id,)) | extra.get(v.id, set())
        return ks

    anchor = {"ad_number", "listing_url", "source"}
    keys: set[str] = set()
    for name, d in bound.items():
        ks = keys_of(d) | extra.get(name, set())
        if anchor <= ks:
            keys |= ks
    for node in ast.walk(tree):          # an anonymous row literal returned directly
        if isinstance(node, ast.Dict):
            ks = keys_of(node)
            if anchor <= ks:
                keys |= ks
    return keys


@pytest.mark.parametrize("platform", BATCH_2026_09_21 + BATCH_2026_09_24 + NOT_YET_ONBOARDED)
def test_every_row_literal_key_of_an_onboarded_batch_is_a_real_column(platform):
    import ast
    src = _SCRAPERS / ROW_LITERAL_LIVES_IN.get(platform, platform) / "run.py"
    tree = ast.parse(src.read_text(encoding="utf-8"))
    keys = _row_literal_keys(tree)
    assert {"ad_number", "listing_url", "source", "transaction_type"} <= keys, (
        f"{platform}: no row literal found — the reader stopped seeing this scraper's rows")
    unknown = sorted(keys - LISTING_COLUMNS - FOLDED_BEFORE_UPSERT)
    assert not unknown, (
        f"{platform} writes {unknown}, which {'is' if len(unknown) == 1 else 'are'} not a column of "
        f"{platform}_residential_listings / _commercial_listings. PostgREST rejects the WHOLE batch "
        f"on an unknown key (PGRST204): the run fetches everything and stores nothing — the suwar "
        f"incident of 2026-09-14. Move the value into additional_info.")


def test_the_row_literal_reader_catches_the_suwar_defect():
    # CONTROL: the static reader must flag the very key that broke production, in both shapes a
    # scraper writes it — inside the literal, and assigned onto the row afterwards.
    import ast
    literal = 'row = {"ad_number": 1, "listing_url": 2, "source": 3, "living_rooms": 4}'
    later = 'row = {"ad_number": 1, "listing_url": 2, "source": 3}\nrow["majlis_rooms"] = 5'
    # The jawher shape (2026-09-24): the offending key sits in a dict that is SPLATTED into the row.
    splat = ('fields = {"bedrooms": 1}\nfields["latitude"] = 2\n'
             'row = {"ad_number": 1, "listing_url": 2, "source": 3, **fields}')
    for src, bad in ((literal, "living_rooms"), (later, "majlis_rooms"), (splat, "latitude")):
        assert sorted(_row_literal_keys(ast.parse(src)) - LISTING_COLUMNS) == [bad]
