"""wasalt's DAILY new-only detail enricher must write separate_water_meter /
separate_electricity_meter from the same additional_info keys the 2026-08-09 repair read — or the
gap it repaired re-creates itself on every row the enricher touches.

Root cause (ops alert kind=wasalt_meter_parse_gap, raised 2026-09-04, ops_incident routed to
routine-1-scraping): run.py's cloud sweeps never set WASALT_FETCH_DETAIL (no workflow does), so
run.py's own `_yes_no()` fix at row-creation time never sees waterMeter/electricityMeter for a
freshly-created row — addl_info there is only the FREE search-list panel. The detail page (and
therefore waterMeter/electricityMeter) is fetched ONLY by scrapers/wasalt/enrich.py's daily
new-only trickle (wasalt-enrich.yml / wasalt-enrich-matrix.yml), which used to write fresh
additional_info via a bare `.table().update()` without ever recomputing the two boolean columns
from it. Measured 2026-09-04: 8,284 active rows publish waterMeter/electricityMeter as Yes/No in
additional_info while the parsed column sits NULL — all of them scraped after the 2026-08-09
repair, none before it (migration 20260904143531_wasalt_meter_parse_gap_detector_and_registry_
rotation.sql).

This pins meter_fields_from_deep(), the fix: run it on the exact `deep` list enrich.py passes to
additional_info, and it must return the SAME tri-state verdict run.py's own row builder does.

Run: python -m pytest scrapers/common/tests/test_wasalt_enrich_meter_parse_gap.py -v
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.wasalt.enrich import meter_fields_from_deep  # noqa: E402

_ENRICH_PY = Path(__file__).resolve().parents[1].parent / "wasalt" / "enrich.py"

# Real shape of the `deep` list enrich.py's fetch_detail() returns — the detail page's
# additionalAttributes, filtered to KEEP_KEYS.
DEEP = [
    {"key": "waterMeter", "label": "Water Meter", "value": "Yes"},
    {"key": "electricityMeter", "label": "Electricity Meter", "value": "No"},
    {"key": "noOfParkings", "label": "Parkings", "value": "2"},
]


def test_yes_becomes_true():
    assert meter_fields_from_deep(DEEP)["separate_water_meter"] is True


def test_no_becomes_false():
    """wasalt's real negative must survive, not be omitted as if unknown."""
    assert meter_fields_from_deep(DEEP)["separate_electricity_meter"] is False


def test_absent_key_is_omitted_not_written_as_none():
    """The key must not even be present in the returned dict — writing None via a bare
    .table().update() would NULL the column and could erase a value a prior enrichment read,
    since this write path does not go through db._unknown_must_not_overwrite_known()."""
    out = meter_fields_from_deep([{"key": "noOfParkings", "label": "Parkings", "value": "2"}])
    assert "separate_water_meter" not in out
    assert "separate_electricity_meter" not in out


def test_empty_deep_yields_no_meter_keys():
    assert meter_fields_from_deep([]) == {}


def test_unexpected_value_is_omitted_not_a_false_negative():
    out = meter_fields_from_deep([{"key": "waterMeter", "value": "Maybe"}])
    assert "separate_water_meter" not in out


def test_both_present_returns_both():
    out = meter_fields_from_deep(DEEP)
    assert out == {"separate_water_meter": True, "separate_electricity_meter": False}


# ── The enricher's write path must actually MERGE this into `upd` — a correct helper nobody calls
# fixes nothing, which is exactly how this gap was created (deep was already parsed into
# additional_info while these two columns sat unrecomputed since 2026-08-09). ───────────────────
def test_the_enricher_writes_meter_fields_into_the_update_payload():
    src = _ENRICH_PY.read_text(encoding="utf-8")
    assert re.search(r'upd\.update\(meter_fields_from_deep\(deep\)\)', src), \
        "enrich_table()'s work() must merge meter_fields_from_deep(deep) into the row it writes"


def test_the_meter_keys_are_still_kept_from_the_detail_payload():
    """If these drop out of KEEP_KEYS the panel arrives empty and both fields silently go missing."""
    src = _ENRICH_PY.read_text(encoding="utf-8")
    keep = src.split("KEEP_KEYS = {", 1)[1].split("}", 1)[0]
    assert '"waterMeter"' in keep and '"electricityMeter"' in keep


def test_agrees_with_run_pys_own_tri_state_reader():
    """Both producing paths (run.py's base row builder, enrich.py's daily detail trickle) must
    reach the same verdict from the same additional_info shape — enrich.py reuses run.py's
    _yes_no() rather than a second, potentially-diverging implementation."""
    from scrapers.wasalt.run import _yes_no
    for key, col in (("waterMeter", "separate_water_meter"),
                     ("electricityMeter", "separate_electricity_meter")):
        expected = _yes_no(DEEP, key)
        out = meter_fields_from_deep(DEEP)
        assert out.get(col) == expected
