"""sokok's traps: a land price whose per-metre rate and total NEVER multiply, a price that exists
only on «متاحة» pieces, a building system that is not a property type, a frontage COUNT that is not
a street width, a comma-AND-decimal area string, presigned photo URLs that expire, four distinct
source markers for "not on the market", a Buy-only platform that must never default to annual, and
a status-based removal oracle.

Fixtures are VERBATIM records captured live 2026-09-24/25 — pieces off /piece/<id>/show
(props.piece) and plots off /plot/<id>/show (props.plot) merged with their /api/v1/plots roster row,
trimmed to the keys the code reads (image URLs truncated; nothing else altered). Assertions execute
the SHIPPING functions: run.map_listing, run.piece_prices, run._signal, run._status_in_page,
run.fetch_plot_map. Offline: only to_catalog / find_district_in_text are stubbed, with the real
city ids this platform resolves to in production (الطائف 5, بريدة 11).

MUTATION-VERIFIED (2026-09-25). Each guard was re-broken in the plausible way and this file was run
against the broken code; every mutant was then restored and all 36 tests pass again.

  (a) `total = ppm * area` — "the total is the rate times the area", the natural land shape.
      7 FAILED, among them:
        test_the_per_metre_rate_and_the_total_never_multiply
          (550,000 stored for a plot the source publishes at 593,887.50)
        test_two_pieces_share_a_total_from_different_rates
        test_the_printed_rate_and_the_effective_rate_are_different_quantities
        test_the_commercial_piece_keeps_its_own_published_total
  (b) `ppm = total // area` — derive the rate from the total, the other direction. 5 FAILED:
        test_the_per_metre_rate_is_the_published_rate_not_the_total_over_area
          (1,079 stored as «سعر المتر» where the source prints 1,000)
        …plus the four above.
  (c) `to_int_numeric(area)` in place of `to_int(area)` — float("1,347.93") raises. 5 FAILED,
      including test_a_comma_and_decimal_area_is_not_dropped with area_m2 None.
  (d) only «مباعة» skips, so reserved / coming-soon / withdrawn pieces become listings. 3 FAILED:
      test_only_a_piece_the_source_calls_available_becomes_a_listing,
      test_the_off_plan_marker_is_the_sources_own_word,
      test_an_unmeasured_status_word_skips_instead_of_being_guessed.
  (e) store `images[].url` in photo_urls. FAILED test_a_presigned_photo_url_is_never_stored.
  (f) `map_type_exact(system)` before the purpose mapping, i.e. «فلة» → Villa. 2 FAILED:
      test_the_building_system_never_becomes_the_property_type,
      test_purpose_decides_the_category_and_an_unknown_purpose_skips.
  (g) `plan_parcel` renamed to `living_rooms` (the 2026-09-14 suwar defect) — caught by the roster
      line in test_scraper_rows_only_use_real_columns.py: assert not ['living_rooms'].
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.sokok import run as R  # noqa: E402

# ── VERBATIM pieces (props.piece off /piece/<id>/show, 2026-09-25) ───────────────────────────────
# meter_price 1,000.00 × area 550.00 = 550,000 against a PUBLISHED total of 593,887.50.
RES_TRAP = {"id": 234328899, "type": "piece", "buyable_type": "App\\Models\\Piece", "plot_id": 19,
            "number": "345", "block_number": "30", "area": "550.00", "front": "جنوبية",
            "purpose": "سكني", "system": "فلة", "street": "على شارع",
            "status": {"id": 1, "name": "متاحة", "text_color": "#ffffff", "bg_color": "#93c572"},
            "meter_price": "1,000.00", "price": "593,887.50", "raw_price": 593887.5, "sort": 1,
            "description": None, "virtual_tour_url": None,
            "images": [{"id": 40, "url": "https://axkd0h4n56jk.compat.objectstorage.me-jeddah-1."
                                         "oraclecloud.com/Web-Images/block/aa.jpg?X-Amz-Expires=3600"
                                         "&X-Amz-Signature=deadbeef"}]}
# The SAME published total as RES_TRAP from a DIFFERENT rate and area — see the price test.
RES_TWIN = {"id": 234328919, "type": "piece", "buyable_type": "App\\Models\\Piece", "plot_id": 19,
            "number": "265", "block_number": "22", "area": "500.00", "front": "جنوبية",
            "purpose": "سكني", "system": "فلة", "street": "على شارع",
            "status": {"id": 1, "name": "متاحة", "text_color": "#ffffff", "bg_color": "#93c572"},
            "meter_price": "1,100.00", "price": "593,887.50", "raw_price": 593887.5, "sort": 1,
            "description": None, "virtual_tour_url": None, "images": []}
# purpose «تجاري» → Commercial Land. 2,200.00 × 660.00 = 1,452,000 vs a published 1,566,920.00.
COM = {"id": 234329078, "type": "piece", "buyable_type": "App\\Models\\Piece", "plot_id": 19,
       "number": "82", "block_number": "8", "area": "660.00", "front": "غربية",
       "purpose": "تجاري", "system": "تجاري", "street": "على شارع",
       "status": {"id": 1, "name": "متاحة", "text_color": "#ffffff", "bg_color": "#93c572"},
       "meter_price": "2,200.00", "price": "1,566,920.00", "raw_price": 1566920, "sort": 1,
       "description": None, "virtual_tour_url": None, "images": []}
# status.id is 5 here and 1 on RES_TRAP — the source labels BOTH «متاحة», so the NAME is the gate.
# area is "1,347.93": a thousands comma AND real decimals in one string.
BIG_AREA = {"id": 234328233, "type": "piece", "buyable_type": "App\\Models\\Piece", "plot_id": 17,
            "number": "6", "block_number": "2", "area": "1,347.93", "front": "شرقية",
            "purpose": "تجاري", "system": "تجاري", "street": "على شارع",
            "status": {"id": 5, "name": "متاحة", "text_color": "#ffffff", "bg_color": "#93c572"},
            "meter_price": "600.00", "price": "873,022.68", "raw_price": 873022.68, "sort": 1,
            "description": None, "virtual_tour_url": None, "images": []}
# One of the 7 available pieces that publish a description, and it states a street width in prose.
DESC_STREET = {"id": 234328401, "type": "piece", "buyable_type": "App\\Models\\Piece", "plot_id": 1,
               "number": "26_1", "block_number": "48", "area": "1,298.89", "front": "غربية",
               "purpose": "سكني", "system": "وحدة", "street": "على شارع",
               "status": {"id": 1, "name": "متاحة", "text_color": "#ffffff", "bg_color": "#93c572"},
               "meter_price": "400.00", "price": "561,046.04", "raw_price": 561046.04, "sort": 1,
               "description": "شارع 15م غرب", "virtual_tour_url": "", "images": []}
# The four "not on the market" markers. NONE of them carries meter_price/price/raw_price at all —
# the keys are absent from the payload, exactly as captured.
SOLD = {"id": 1522, "type": "piece", "buyable_type": "App\\Models\\Piece", "plot_id": 5,
        "number": "260", "block_number": "13", "area": "279.08", "front": "غربية",
        "purpose": "سكني", "system": "فلة", "street": "على شارع",
        "status": {"id": 3, "name": "مباعة", "text_color": "#ffffff", "bg_color": "#f93a2f"},
        "sort": 0, "description": None, "virtual_tour_url": "https://seen360.co/sokok/alhada/"}
COMING = {"id": 1757, "type": "piece", "buyable_type": "App\\Models\\Piece", "plot_id": 6,
          "number": "1", "block_number": "1", "area": "592.50", "front": "جنوبية غربية",
          "purpose": "سكني", "system": "فلة", "street": "على شارعين",
          "status": {"id": 4, "name": "قريباً", "text_color": "#ffffff", "bg_color": "#ffaeb5"},
          "sort": 1, "description": None, "virtual_tour_url": None, "images": []}
RESERVED = {"id": 1581, "type": "piece", "buyable_type": "App\\Models\\Piece", "plot_id": 1,
            "number": "19_6", "block_number": "2", "area": "325.00", "front": "جنوبية",
            "purpose": "سكني", "system": "وحدة", "street": "على شارع",
            "status": {"id": 2, "name": "محجوزة", "text_color": "#ffffff", "bg_color": "#f8c300"},
            "sort": 1, "description": "شارع عرض 20م", "virtual_tour_url": ""}
WITHDRAWN = {"id": 234327981, "type": "piece", "buyable_type": "App\\Models\\Piece", "plot_id": 16,
             "number": "266", "block_number": "18", "area": "375.00", "front": "جنوبية",
             "purpose": "سكني", "system": "فلة", "street": "على شارع",
             "status": {"id": 7, "name": "موقفة من الشركة", "text_color": "#ffffff",
                        "bg_color": "#f93a2f"}, "sort": 1, "description": None}

# ── VERBATIM plots (props.plot off /plot/<id>/show merged with the /api/v1/plots roster row) ─────
PLOT_19 = {"id": 19, "name": "بوابة الطائف", "number": "2530", "license_number": 6200956591,
           "city_id": 3, "location": "الطائف", "area": 337000, "status_id": 2,
           "pieces_count": 396, "pieces_available_count": 72,
           "pieces_sales_percent": 81.81818181818183, "show_list": True,
           "city": {"id": 3, "region_id": 3, "name": "Taif", "status": 1},
           "services": [{"id": 2, "name": "كهرباء"}, {"id": 3, "name": "ماء"},
                        {"id": 4, "name": "تصريف سيول"}, {"id": 5, "name": "إنارة"}],
           "facilities": [{"id": 1, "name": "مسجد"}, {"id": 2, "name": "حديقة"}]}
# «مخطط الملقا» in بريدة — and «حي الملقا» is a RIYADH district. See the district test.
PLOT_1 = {"id": 1, "name": "مخطط الملقا", "license_number": 7200000364, "city_id": 2,
          "location": "شمال بريدة", "area": 400000, "status_id": 5, "pieces_count": 1262,
          "pieces_available_count": 4, "pieces_sales_percent": 99.7, "show_list": True,
          "city": {"id": 2, "region_id": 2, "name": "Buridah", "status": 1},
          "services": [{"id": 1, "name": "إنترنت"}, {"id": 2, "name": "كهرباء"},
                       {"id": 3, "name": "ماء"}, {"id": 4, "name": "تصريف سيول"}],
          "facilities": [{"id": 1, "name": "مسجد"}]}
PLOT_17 = {"id": 17, "name": "مخطط الصفوة", "number": "0400/0401/003453",
           "license_number": 7200807984, "city_id": 2, "location": "وسط بريدة", "area": 55047,
           "status_id": 2, "pieces_count": 122, "pieces_available_count": 89,
           "pieces_sales_percent": 10, "show_list": True,
           "city": {"id": 2, "region_id": 2, "name": "Buridah", "status": 1},
           "services": [{"id": 1, "name": "إنترنت"}, {"id": 2, "name": "كهرباء"},
                        {"id": 3, "name": "ماء"}, {"id": 4, "name": "تصريف سيول"}],
           "facilities": [{"id": 1, "name": "مسجد"}, {"id": 2, "name": "حديقة"}]}
# Plot 18: absent from /api/v1/plots (both pages), map has ZERO features, location «متفرق»,
# license_number 0. Its three available pieces are the build's one open question.
PLOT_18 = {"id": 18, "name": "قطع أقل من 100 ألف", "city_id": 2, "location": "متفرق",
           "license_number": 0, "area": 20000, "status_id": 4, "show_list": True,
           "city": {"id": 2, "region_id": 2, "name": "Buridah", "status": 1}}


@pytest.fixture(autouse=True)
def _no_catalog_network(monkeypatch):
    """The real city ids this platform resolves to in production (verified against
    loc_catalog_city 2026-09-25). بريدة's catalog district set genuinely has no «ملقا» — only
    الرياض does — which is what the district test turns on."""
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None:
                        {"الطائف": (5, 2), "بريدة": (11, 4)}.get(c, (None, None)))
    monkeypatch.setattr(R, "find_district_in_text",
                        lambda t, cid: "حي الملقا" if (t and "الملقا" in t and cid == 3) else None)


def _p(base, **over):
    p = json.loads(json.dumps(base))
    for k, v in over.items():
        if v is R:                      # sentinel: delete the key entirely
            p.pop(k, None)
        else:
            p[k] = v
    return p


# ── THE SITE'S HARDEST PRICE TRAP ────────────────────────────────────────────────────────────────
def test_the_per_metre_rate_and_the_total_never_multiply():
    """MEASURED over all 280 available pieces: price == meter_price × area on ZERO of them, and
    price ÷ area == meter_price on ZERO of them. The arithmetic fails in BOTH directions, so both
    published figures are stored verbatim and neither is ever derived.

    Here 1,000.00 × 550.00 = 550,000 while the source publishes 593,887.50. A mapper that
    multiplied would under-publish this plot by 43,887 SAR — PRICE = SOURCE.
    """
    ppm, total = R.piece_prices(RES_TRAP)
    assert ppm == 1000, "price_per_meter is the published «سعر المتر»"
    assert total == 593887, "price_total is the published total, floored to the bigint column"
    assert total != ppm * 550, "the total is NOT the rate times the area"

    row, cat, why = R.map_listing(RES_TRAP, PLOT_19)
    assert why == "" and cat == "residential"
    assert row["price_per_meter"] == 1000
    assert row["price_total"] == 593887
    assert row["area_m2"] == 550
    # The exact published strings survive the integer columns, so nothing is lost or rounded up.
    assert row["additional_info"]["source_price_raw"] == "593,887.50"
    assert row["additional_info"]["source_meter_price_raw"] == "1,000.00"
    assert row["price_evidence"]["raw"] == "593,887.50"
    assert row["price_evidence"]["unit"] == "total" and row["price_evidence"]["kind"] == "total"


def test_the_per_metre_rate_is_the_published_rate_not_the_total_over_area():
    """The other direction of the same trap. 593,887.50 ÷ 550.00 = 1,079.79, and the source prints
    1,000.00. Deriving the rate would publish a «سعر المتر» the platform never stated."""
    row, _cat, why = R.map_listing(RES_TRAP, PLOT_19)
    assert why == ""
    assert row["price_per_meter"] == 1000
    assert row["price_per_meter"] != int(593887.50 / 550.00)   # 1079 — never published


def test_two_pieces_share_a_total_from_different_rates():
    """The sharpest captured case, and why no formula can exist: ids 234328899 (rate 1,000.00 over
    550.00 m²) and 234328919 (rate 1,100.00 over 500.00 m²) publish the SAME total 593,887.50.
    Each keeps its own published rate and they keep the same published total — a mapper that
    computed either figure from the other would have to give these two different totals."""
    a_ppm, a_total = R.piece_prices(RES_TRAP)
    b_ppm, b_total = R.piece_prices(RES_TWIN)
    assert a_total == b_total == 593887, "one published total, verbatim on both"
    assert (a_ppm, b_ppm) == (1000, 1100), "two different published rates, each kept as printed"
    assert a_ppm * 550 == b_ppm * 500 != a_total   # both products are 550,000; the total is not


def test_the_printed_rate_and_the_effective_rate_are_different_quantities():
    """Block 12's four commercial parcels (verbatim, captured 2026-09-25) all print meter_price
    2,200.00 and their published totals ÷ their areas all come to 2374.12 — the same effective rate
    to four decimals, and not the printed one. So the platform publishes TWO different per-metre
    quantities and the column stores the one it prints, verbatim. Deriving either from the other
    would replace a published figure with a computed one."""
    block12 = [
        {"area": "660.41", "meter_price": "2,200.00", "price": "1,567,893.02",
         "raw_price": 1567893.02, "number": "132"},
        {"area": "660.08", "meter_price": "2,200.00", "price": "1,567,109.86",
         "raw_price": 1567109.86, "number": "134"},
        {"area": "660.17", "meter_price": "2,200.00", "price": "1,567,323.44",
         "raw_price": 1567323.44, "number": "136"},
        {"area": "660.28", "meter_price": "2,200.00", "price": "1,567,584.50",
         "raw_price": 1567584.50, "number": "138"}]
    effective = set()
    for over in block12:
        row, _cat, why = R.map_listing(_p(COM, **over), PLOT_19)
        assert why == ""
        assert row["price_per_meter"] == 2200, "the printed «سعر المتر», always"
        # The published total, not the product of the printed rate and the area.
        assert row["price_total"] == int(float(over["price"].replace(",", "")))
        assert row["price_total"] != 2200 * row["area_m2"]
        effective.add(round(float(over["price"].replace(",", "")) / float(over["area"]), 4))
    assert effective == {2374.1207, 2374.1211, 2374.121, 2374.1208}, "one effective rate…"
    assert 2200 not in {int(e) for e in effective}, "…and it is not the printed 2,200"


def test_the_commercial_piece_keeps_its_own_published_total():
    """2,200.00 × 660.00 = 1,452,000; the source publishes 1,566,920.00. A 114,920 SAR gap."""
    row, cat, why = R.map_listing(COM, PLOT_19)
    assert why == "" and cat == "commercial"
    assert row["property_type"] == "Commercial Land"
    assert row["price_total"] == 1566920
    assert row["price_per_meter"] == 2200
    assert row["price_total"] != 2200 * 660


def test_a_price_is_never_read_from_prose():
    """Prose prices are banned fleet-wide (price_evidence(origin='description') raises), and this
    platform's only prose is a short street note. A piece whose structured price keys are absent
    keeps NO price even when its description contains digits that look like money."""
    poisoned = _p(RES_TRAP, description="الفرصة بسعر 250000 ريال فقط",
                  meter_price=R, price=R, raw_price=R)
    ppm, total = R.piece_prices(poisoned)
    assert ppm is None and total is None, "no price may be salvaged from the description"
    row, _cat, why = R.map_listing(poisoned, PLOT_19)
    assert why == "" and row["price_total"] is None and row["price_per_meter"] is None
    assert row["price_evidence"]["origin"] == "api", "never 'description'"
    assert "250000" not in str(row["price_evidence"]["raw"] or "")
    with pytest.raises(ValueError):
        R.normalize.price_evidence(field="desc", raw="250000", stored=250000, origin="description")


# ── AVAILABILITY: the source's own markers ───────────────────────────────────────────────────────
def test_only_a_piece_the_source_calls_available_becomes_a_listing():
    """MEASURED: of 3,712 captured pieces, all 280 «متاحة» publish meter_price+price+raw_price and
    the other 3,432 publish NO price key at all. So a non-available piece is not an offer, and each
    of the four words the source uses skips under its OWN counted reason — never a heuristic."""
    for piece, reason in ((SOLD, "sold_mabaa"), (RESERVED, "reserved_mahjooza"),
                          (COMING, "coming_soon_qaribaan"), (WITHDRAWN, "withdrawn_by_company")):
        row, _cat, why = R.map_listing(piece, PLOT_19)
        assert row is None, f"{piece['status']['name']} must not become a listing"
        assert why == reason, f"{piece['status']['name']} → {reason}"


def test_the_off_plan_marker_is_the_sources_own_word():
    """«قريباً» is the platform's not-yet-selling marker — all 160 pieces of مخطط ضراس carry it,
    and 864 more inside plots whose selling has otherwise finished. READY ONLY: skipped on the
    source's own word, with no guess from a percentage or a sold-bar."""
    row, _cat, why = R.map_listing(COMING, PLOT_19)
    assert row is None and why == "coming_soon_qaribaan"


def test_an_unmeasured_status_word_skips_instead_of_being_guessed():
    row, _cat, why = R.map_listing(_p(RES_TRAP, status={"id": 9, "name": "تحت الإنشاء"}), PLOT_19)
    assert row is None and why == "status_unknown_تحت الإنشاء"


def test_both_ids_the_source_labels_available_are_honoured():
    """status.id is 1 on most available pieces and 5 on others, and the source labels BOTH «متاحة».
    The gate is the NAME the source publishes, so neither id is privileged."""
    assert BIG_AREA["status"]["id"] == 5 and RES_TRAP["status"]["id"] == 1
    for piece in (RES_TRAP, BIG_AREA):
        row, _cat, why = R.map_listing(piece, PLOT_17)
        assert why == "" and row["active"] is True


def test_an_available_piece_with_no_price_is_not_given_one():
    """Defensive: if the platform ever publishes «متاحة» without a price, the row carries NULL
    rather than a reconstruction from the rate and the area."""
    row, _cat, why = R.map_listing(_p(RES_TRAP, meter_price=R, price=R, raw_price=R), PLOT_19)
    assert why == ""
    assert row["price_total"] is None and row["price_per_meter"] is None
    assert row["area_m2"] == 550, "the area is still published — it just buys no price"


# ── RENT: the platform has none, and nothing may default to annual ───────────────────────────────
def test_a_sale_only_platform_never_writes_a_rent_period_or_an_annual_price():
    """sokok publishes no rent, no deal-type field and no period field anywhere (all 26 piece keys
    and 30 plot keys checked). So transaction_type is the literal "Buy" and the price lands in
    price_total — `rent_period` and `price_annual` are never written at all, rather than being
    defaulted to annual. RENT PERIOD = SOURCE, and the source makes no period statement."""
    for piece, plot in ((RES_TRAP, PLOT_19), (COM, PLOT_19), (DESC_STREET, PLOT_1)):
        row, _cat, why = R.map_listing(piece, plot)
        assert why == ""
        assert row["transaction_type"] == "Buy"
        assert "rent_period" not in row, "no period key may be written on a sale-only platform"
        assert "price_annual" not in row, "no annual price may be written"
        assert row["price_total"] is not None


def test_rent_words_in_prose_cannot_manufacture_an_annual_price():
    """The period-shaped trap: prose that says «سنوي» beside a figure must not turn this sale into
    an annualised rent, because the platform's price field is not a rent and says no period.
    Nothing in the row moves and no price is multiplied."""
    row, _cat, why = R.map_listing(
        _p(RES_TRAP, description="للايجار السنوي 593,887 ريال سنوي شهري"), PLOT_19)
    assert why == ""
    assert row["transaction_type"] == "Buy"
    assert "rent_period" not in row and "price_annual" not in row
    assert row["price_total"] == 593887, "the published total, unconverted and unmultiplied"


# ── TYPE: `system` is not a property type ────────────────────────────────────────────────────────
def test_the_building_system_never_becomes_the_property_type():
    """`system` is the building system the plot PERMITS — «فلة» on 2,220 pieces, «وحدة» on 1,360,
    «تجاري» on 132. Reading «فلة» as a type would file a bare surveyed land parcel as a built
    Villa. Only `purpose` decides, and it routes through the shared Arabic TYPE_MAP_AR canon."""
    row, cat, why = R.map_listing(RES_TRAP, PLOT_19)
    assert why == "" and RES_TRAP["system"] == "فلة"
    assert row["property_type"] == "Residential Land", "land, not the villa its system permits"
    assert cat == "residential"
    assert row["additional_info"]["system_ar"] == "فلة", "kept, but only as a source fact"

    unit, _c, why2 = R.map_listing(DESC_STREET, PLOT_1)
    assert why2 == "" and DESC_STREET["system"] == "وحدة"
    assert unit["property_type"] == "Residential Land"


def test_purpose_decides_the_category_and_an_unknown_purpose_skips():
    res, cat_r, _ = R.map_listing(RES_TRAP, PLOT_19)
    com, cat_c, _ = R.map_listing(COM, PLOT_19)
    assert (res["property_type"], cat_r) == ("Residential Land", "residential")
    assert (com["property_type"], cat_c) == ("Commercial Land", "commercial")
    row, _cat, why = R.map_listing(_p(RES_TRAP, purpose="زراعي"), PLOT_19)
    assert row is None and why == "purpose_unmapped_زراعي"
    row2, _c2, why2 = R.map_listing(_p(RES_TRAP, purpose=None), PLOT_19)
    assert row2 is None and why2 == "purpose_unmapped_blank"


def test_a_row_that_is_not_a_piece_is_not_mapped_as_land():
    row, _cat, why = R.map_listing(_p(RES_TRAP, type="unit"), PLOT_19)
    assert row is None and why == "not_a_piece_unit"


# ── AREA, STREET, DIRECTION ──────────────────────────────────────────────────────────────────────
def test_a_comma_and_decimal_area_is_not_dropped():
    """`area` is a formatted string that can carry BOTH a thousands comma and real decimals
    ("1,347.93"). to_int_numeric() raises inside float() on that and would leave area_m2 NULL on
    exactly the largest pieces, so to_int() is used. The exact string is kept for the audit."""
    row, _cat, why = R.map_listing(BIG_AREA, PLOT_17)
    assert why == ""
    assert row["area_m2"] == 1347, "1,347.93 m² → the floored integer column"
    assert row["additional_info"]["source_area_raw"] == "1,347.93"
    row2, _c2, _ = R.map_listing(DESC_STREET, PLOT_1)
    assert row2["area_m2"] == 1298 and row2["additional_info"]["source_area_raw"] == "1,298.89"


def test_a_frontage_count_never_becomes_a_street_width():
    """`street` counts frontages — «على شارع», «على شارعين», «على ثلاث شوارع» — and carries no
    measurement. There is no structured street width on the platform, so street_width_m comes only
    from the shared street_from_prose() over the piece's own description."""
    row, _cat, why = R.map_listing(RES_TRAP, PLOT_19)
    assert why == "" and RES_TRAP["street"] == "على شارع"
    assert row["street_width_m"] is None, "a frontage count is not a width"
    assert row["additional_info"]["street_frontage_ar"] == "على شارع"

    with_prose, _c, why2 = R.map_listing(DESC_STREET, PLOT_1)
    assert why2 == "" and DESC_STREET["description"] == "شارع 15م غرب"
    assert with_prose["street_width_m"] == 15, "the source's own stated width"

    two, _c2, _ = R.map_listing(_p(RES_TRAP, street="على شارعين"), PLOT_19)
    assert two["street_width_m"] is None
    assert two["additional_info"]["street_frontage_ar"] == "على شارعين"


def test_a_multi_frontage_word_is_not_a_direction():
    """`front` is a frontage compass word. A corner parcel fronting several ways («شمالية جنوبية»)
    is not ONE direction, and the shared helper already refuses it rather than picking the first."""
    row, _cat, why = R.map_listing(RES_TRAP, PLOT_19)
    assert why == "" and row["direction"] == "جنوب"
    diag, _c, _ = R.map_listing(_p(RES_TRAP, front="جنوبية غربية"), PLOT_19)
    assert diag["direction"] == "جنوب غرب"
    multi, _c2, _ = R.map_listing(_p(RES_TRAP, front="شمالية جنوبية شرقية غربية"), PLOT_19)
    assert multi["direction"] is None, "four frontages are not a direction"
    assert multi["additional_info"]["front_ar"] == "شمالية جنوبية شرقية غربية", "kept verbatim"


# ── LOCATION: a marketing name is not a district ─────────────────────────────────────────────────
def test_a_plot_marketing_name_never_becomes_a_district():
    """«مخطط الملقا» is in بريدة, and «حي الملقا» is a RIYADH district (بريدة's catalog district
    set has no ملقا — verified against loc_catalog_district). Only the plot's own `location` text
    is searched for a district, so a brand can never file Buridah land under a Riyadh district.
    The raw location is kept in `neighborhood` and the plot name in `project_name`."""
    row, _cat, why = R.map_listing(DESC_STREET, PLOT_1)
    assert why == "" and PLOT_1["name"] == "مخطط الملقا"
    assert row["city_ar"] == "بريدة" and row["city_id"] == 11
    assert row["district_ar"] is None, "no district is published, so none is invented"
    assert row["neighborhood"] == "شمال بريدة", "the source's own location text, raw"
    assert row["project_name"] == "مخطط الملقا", "the «مخطط» is the project, not the district"


def test_an_untranslatable_city_skips_rather_than_being_transliterated():
    """plot.city.name is ENGLISH and the shared map_city_en returns None for "Buridah", so the
    three measured values are translated by an explicit map. A fourth skips."""
    row, _cat, why = R.map_listing(RES_TRAP, _p(PLOT_19, city={"id": 99, "name": "Abha"}))
    assert row is None and why == "city_untranslated_Abha"
    row2, _c2, why2 = R.map_listing(RES_TRAP, _p(PLOT_19, city=None))
    assert row2 is None and why2 == "city_untranslated_blank"


def test_the_licence_is_the_plots_and_a_zero_is_not_a_licence():
    """license_number is per PLOT and shared by its pieces. Plot 18 publishes 0, which is not a
    REGA advertising licence and must not be stored as one."""
    row, _cat, why = R.map_listing(RES_TRAP, PLOT_19)
    assert why == "" and row["license_number"] == "6200956591"
    zeroed, _c, why2 = R.map_listing(RES_TRAP, _p(PLOT_18, city=PLOT_18["city"]))
    assert why2 == "" and zeroed["license_number"] is None, "0 is not a licence number"


# ── PLOT-LEVEL SUMMARIES ARE STALE AND MUST NOT GATE ─────────────────────────────────────────────
def test_a_sold_out_plot_badge_cannot_hide_its_available_pieces():
    """MEASURED: plot 16 publishes status «تم البيع» and pieces_sales_percent "100.00" while
    publishing pieces_available_count 233, and its map really does paint 233 available pieces, each
    with its own price. The per-piece status is the truth; gating on the plot's own summary would
    have discarded the single largest selling plot."""
    sold_out_plot = _p(PLOT_17, status_id=3, pieces_sales_percent="100.00",
                       pieces_available_count=233)
    row, _cat, why = R.map_listing(BIG_AREA, sold_out_plot)
    assert why == "", "a stale plot badge does not unmake an available piece"
    assert row["price_total"] == 873022
    # The contradiction stays auditable from the row alone.
    assert row["additional_info"]["plot_sales_percent"] == "100.00"
    assert row["additional_info"]["plot_status_id"] == "3"


# ── PHOTOS: presigned and short-lived ────────────────────────────────────────────────────────────
def test_a_presigned_photo_url_is_never_stored():
    """The image URLs carry X-Amz-Expires=3600 and a signature, and the same path WITHOUT the query
    answers 404 (the bucket is private). MEASURED: the signed URL serves image/jpeg, 88,795 bytes,
    no CORP header — it renders now and is dead within the hour. So photo_urls stays NULL, the
    stable object key is kept for a future mirror, and the evidence records why."""
    row, _cat, why = R.map_listing(RES_TRAP, PLOT_19)
    assert why == "" and RES_TRAP["images"], "the source DID publish an image"
    assert row["photo_urls"] is None, "an expiring URL is not a URL we may store"
    assert "X-Amz-Signature" not in json.dumps(row, ensure_ascii=False), "no signature is kept"
    ev = row["images_evidence"]
    assert ev["observed"] is True and ev["key_present"] is True
    assert ev["count"] == 0 and ev["source_count"] == 1
    assert ev["not_stored_reason"] == "presigned_url_expires_3600s"
    assert row["additional_info"]["image_object_paths"] == ["aa.jpg"], "the stable half only"
    assert "image_storage_keys" not in row, "that column belongs to the gated mirror, not here"


# ── SERVICES: positive-only, and no word is forced into the wrong column ─────────────────────────
def test_a_service_the_source_names_is_true_and_silence_stays_null():
    """The plot's services list is the developer's own structured statement. «كهرباء» → electricity
    and «ماء» → water_supply. «تصريف سيول» is STORM drainage and is NOT «صرف صحي» (sewage), so
    sanitation stays NULL; «إنترنت» is not «ألياف ضوئية», so optical_fibers stays NULL; «إنارة»
    has no column. SOURCE IS TRUTH: absent → NULL, never False."""
    row, _cat, why = R.map_listing(DESC_STREET, PLOT_1)
    assert why == ""
    assert row["electricity"] is True and row["water_supply"] is True
    assert row.get("sanitation") is None, "«تصريف سيول» is storm drainage, not sewage"
    assert row.get("optical_fibers") is None, "«إنترنت» is not fibre"
    assert set(row["additional_info"]["plot_services_ar"]) == {
        "إنترنت", "كهرباء", "ماء", "تصريف سيول"}, "every word kept, none invented"

    bare, _c, why2 = R.map_listing(RES_TRAP, _p(PLOT_19, services=[], facilities=[]))
    assert why2 == ""
    for col in ("electricity", "water_supply", "sanitation", "optical_fibers"):
        assert bare.get(col) is None, f"{col} must stay UNKNOWN, never False"


# ── PDPL ─────────────────────────────────────────────────────────────────────────────────────────
POISON_PIECE = _p(RES_TRAP,
                  description="أرض مميزة للتواصل 0555754441 أو واتساب https://wa.me/966599992887 "
                              "الأستاذ محمد العتيبي - mohammed@sokok.sa",
                  contact={"whatsapp": "https://wa.me/966599992887", "mobile": "tel:966599992887",
                           "email": "mailto:info@sokok.sa"})
POISON_PLOT = _p(PLOT_19,
                 advertiser_mobile="+966599992887",
                 owner="صكوك العقارية للتطوير — الأستاذ سعد القحطاني",
                 owner_identity="1012345678",
                 owner_logo="plots/po8cJ4qO1wLl2Cx7RePcELkkCLodXz3UUmcCRiTO.png",
                 owner_logo_url="https://axkd0h4n56jk.compat.objectstorage.me-jeddah-1."
                                "oraclecloud.com/Web-Images/plots/po8c.png?X-Amz-Signature=abc",
                 contact={"whatsapp": "https://wa.me/966537113231", "mobile": "tel:966537113231",
                          "email": "mailto:info@sokok.sa"},
                 description="للحجز اتصل 0537113231")


def test_a_poisoned_record_leaks_no_contact_detail_anywhere():
    """PDPL. The real payloads carry `contact` {wa.me, tel:, mailto:}, a per-plot
    `advertiser_mobile` (+966599992887 on plot 19, a DIFFERENT +966537113231 on plot 5) and the
    advertiser's own phone typed into the prose. None of it may reach a column, additional_info or
    source_capture: both payloads are built from an explicit key ALLOWLIST, then strip_pii_fields,
    and every free-text key goes through redact_pii."""
    row, _cat, why = R.map_listing(POISON_PIECE, POISON_PLOT)
    assert why == ""
    blob = json.dumps(row, ensure_ascii=False)
    for needle in ("0555754441", "966599992887", "966537113231", "0537113231", "wa.me",
                   "mohammed@sokok.sa", "info@sokok.sa", "tel:", "mailto:", "1012345678",
                   "سعد القحطاني", "محمد العتيبي", "advertiser_mobile", "owner_logo",
                   "owner_identity"):
        assert needle not in blob, f"PDPL leak: {needle!r} reached the stored row"
    # The allowlist is the mechanism, so the keys are absent rather than merely redacted.
    for payload in (row["source_capture"], row["source_capture"]["plot"], row["additional_info"]):
        for key in ("contact", "advertiser_mobile", "owner", "owner_identity", "owner_logo",
                    "owner_logo_url"):
            assert key not in payload, f"{key!r} must not be copied at all"
    # And the listing's own regulatory facts are untouched by the redaction.
    assert row["license_number"] == "6200956591"
    assert row["plan_parcel"] == "345" and row["additional_info"]["block_number"] == "30"
    assert row["price_total"] == 593887


def test_a_name_typed_into_the_description_cannot_reach_a_column():
    """THE HOLE THIS CLOSES. redact_pii() removes contact CHANNELS but does not claim to remove a
    person's NAME from free text — names are dropped at the KEY level by strip_pii_fields(), which
    cannot reach a name typed inside a text field. So «... الأستاذ محمد العتيبي ...» survives
    redaction and would land in the `description` column.

    MEASURED: all 574 descriptions this platform publishes (153 distinct, longest 58 chars) are
    street-geometry notes and nothing else, so the field is accepted on its own vocabulary instead.
    Anything that is not that note is dropped whole and the drop is recorded.
    """
    row, _cat, why = R.map_listing(POISON_PIECE, PLOT_19)
    assert why == ""
    assert row["description"] is None, "unexpected prose in a street-note field is not stored"
    assert row["additional_info"]["description_dropped_not_a_street_note"] is True
    blob = json.dumps(row, ensure_ascii=False)
    for needle in ("محمد العتيبي", "الأستاذ", "0555754441", "wa.me"):
        assert needle not in blob
    # The capture is gated too — "private" is not "may accumulate names".
    assert row["source_capture"].get("description") is None

    # Every shape a broker might type is refused; the real notes are all kept.
    for poison in ("مكتب الوسيط العقاري جوال 0501234567",
                   "صكوك العقارية - الأستاذ سعد القحطاني",
                   "للحجز اتصل 0537113231",
                   "أرض مميزة بموقع استراتيجي للبيع بسعر مغري"):
        r, _c, w = R.map_listing(_p(RES_TRAP, description=poison), PLOT_19)
        assert w == "" and r["description"] is None, f"must drop: {poison!r}"
    for note in ("شارع 15م غرب", "جنوبا شارع عرض 15م & شمالا ممر بطول 45م & غربا ممر عرض 10م",
                 "جنوب شارع 40م هيكلي شرق شارع 25م", "جنوب ميدان عرض 20 م وغرب شارع 15 م",
                 "شارع عرض ٣٠م"):
        r, _c, w = R.map_listing(_p(RES_TRAP, description=note), PLOT_19)
        assert w == "" and r["description"] == note, f"must keep: {note!r}"
        assert r["additional_info"].get("description_dropped_not_a_street_note") is None


def test_the_platform_name_is_the_source_field_not_an_advertiser_name():
    """«صكوك العقارية» is the PLATFORM and belongs in `source` on every row — that is not an
    advertiser name leak. The plot's `owner` string (which carries a person's name in the poisoned
    shape) is a different field and is never copied."""
    row, _cat, why = R.map_listing(RES_TRAP, POISON_PLOT)
    assert why == "" and row["source"] == "صكوك العقارية"
    assert "owner" not in row["source_capture"]["plot"]
    assert POISON_PLOT["owner"] not in json.dumps(row, ensure_ascii=False)


# ── IDENTITY ─────────────────────────────────────────────────────────────────────────────────────
def test_every_row_has_its_own_verified_per_listing_url():
    """VERIFIED live on ids 234328899, 234328918 and 234329078: each answered 200 and the page
    carried THAT piece's own number, block, area and price. So no two rows share a URL."""
    rows = [R.map_listing(p, PLOT_19)[0] for p in (RES_TRAP, RES_TWIN, COM)]
    assert [r["listing_url"] for r in rows] == [
        "https://sokok.sa/piece/234328899/show",
        "https://sokok.sa/piece/234328919/show",
        "https://sokok.sa/piece/234329078/show"]
    assert [r["ad_number"] for r in rows] == ["SKK234328899", "SKK234328919", "SKK234329078"]
    assert len({r["listing_url"] for r in rows}) == 3


def test_the_title_is_composed_only_of_published_facts():
    row, _cat, why = R.map_listing(RES_TRAP, PLOT_19)
    assert why == "" and row["title"] == "أرض رقم 345 - بلوك 30 - بوابة الطائف"
    com, _c, _ = R.map_listing(COM, PLOT_19)
    assert com["title"] == "أرض تجارية رقم 82 - بلوك 8 - بوابة الطائف"


# ── REMOVAL ORACLE ───────────────────────────────────────────────────────────────────────────────
def _page(piece: dict) -> str:
    """A minimal Inertia page carrying THAT piece — the shape /piece/<id>/show really serves."""
    import html as _h
    payload = {"component": "ShowPiece", "props": {"piece": piece}, "url": "/piece/x/show"}
    return ('<!DOCTYPE html><html lang="ar" dir="rtl"><body><div id="app" data-page="'
            + _h.escape(json.dumps(payload, ensure_ascii=False), quote=True)
            + '"></div></body></html>')


def test_the_oracle_reads_the_status_the_page_prints_about_itself():
    """MEASURED 2026-09-25 on real ids: 404 on 99999 / 999999999 (and id 1 is a REAL piece that
    answers 200, so the 404 is about the id and not the route); 200 + «متاحة» on 234328899; 200 +
    «مباعة» / «محجوزة» / «قريباً» / «موقفة من الشركة» on 1522 / 1581 / 1757 / 234327981."""
    assert R._signal(404, "not found", False) == "gone"
    assert R._signal(200, _page(RES_TRAP), False) == "live"
    for piece in (SOLD, RESERVED, COMING, WITHDRAWN):
        assert R._signal(200, _page(piece), False) == "gone", piece["status"]["name"]
    assert R._status_in_page(_page(SOLD)) == "مباعة"


def test_a_200_is_not_proof_of_life_on_this_platform():
    """A sold piece keeps serving its full page forever (id 1522 answers 200 with 397KB of its own
    content). So a "200 means live" oracle would resurrect every sold parcel on every run."""
    assert R._signal(200, _page(SOLD), False) == "gone"
    assert R._signal(200, "<html><body>no inertia payload here</body></html>", False) is None
    assert R._signal(200, _page(_p(RES_TRAP, status={"id": 8, "name": "حالة جديدة"})),
                     False) is None, "an unmeasured word earns no opinion"


def test_the_shared_law_still_refuses_a_death_on_a_block_or_an_outage():
    """The law in http_liveness cannot be relaxed here. A 403/429/5xx is about US, and this
    platform really does throttle at 60 req/min — a 429 must never read as a removal."""
    from scrapers.common.http_liveness import decide, read_is_unbelievable
    for status in (401, 403, 408, 429, 500, 503):
        assert read_is_unbelievable(status, "anything") is not None
        assert decide(status, "anything", False, R._signal) is None, f"{status} is not a death"
    assert decide(None, "", False, R._signal) is None, "no answer is not a death"
    assert decide(404, "", False, R._signal) is None, "an empty body carries no verdict"


# ── ENUMERATION: the map is the completeness oracle ──────────────────────────────────────────────
def test_the_plot_map_yields_every_piece_and_only_the_available_ones_are_coloured():
    """props.pieces_features is the complete per-plot enumeration: its feature count equalled the
    roster's own pieces_count on all eleven plots, and its #93c572 count equalled
    pieces_available_count on all four selling plots (72/89/4/233 = 398)."""
    feats = [{"properties": {"buyable_id": 234328899, "color": "#93c572", "is_piece": True}},
             {"properties": {"buyable_id": 234328919, "color": "#93c572", "is_piece": True}},
             {"properties": {"buyable_id": 1522, "color": "#f93a2f", "is_piece": True}},
             {"properties": {"buyable_id": 1757, "color": "#ffa500", "is_piece": True}},
             {"properties": {"label": "no id here"}}]

    class _C:
        def inertia(self, _url):
            return 200, {"pieces_features": feats, "plot": PLOT_19}

    every, green, plot, excluded = R.fetch_plot_map(_C(), "19")
    assert every == ["234328899", "234328919", "1522", "1757"], "every piece, id-keyed"
    assert green == ["234328899", "234328919"], "only the available colour is fetched"
    assert plot["name"] == "بوابة الطائف"
    # What was NOT fetched is counted by the map's own colour, so «قريباً» is reported separately
    # from sold rather than lumped into one opaque number. Both totals were validated against the
    # platform's own: green = pieces_available_count per plot, orange = the API's «قريباً» count.
    assert excluded == {"sold_or_withdrawn_not_fetched": 1,
                        "coming_soon_qaribaan_not_fetched": 1}


def test_an_unmeasured_map_colour_is_counted_under_its_own_name():
    """A palette change must show up as a named, countable exclusion rather than vanishing."""
    class _C:
        def inertia(self, _url):
            return 200, {"pieces_features": [
                {"properties": {"buyable_id": 5, "color": "#123456"}}], "plot": PLOT_19}

    every, green, _plot, excluded = R.fetch_plot_map(_C(), "19")
    assert every == ["5"] and green == []
    assert excluded == {"map_colour_#123456_not_fetched": 1}


def test_an_unparsed_plot_page_is_unknown_and_never_an_empty_plot():
    """A page we could not read must not present itself as a plot with nothing left for sale —
    that is how a prune deletes a live catalogue. `None` marks the run incomplete instead."""
    class _Dead:
        def inertia(self, _url):
            return 200, None

    every, green, plot, excluded = R.fetch_plot_map(_Dead(), "19")
    assert every is None, "unreadable is UNKNOWN, not zero pieces"
    assert green == [] and plot == {} and excluded == {}
