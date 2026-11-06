"""Wasalt's enum confirm reads enricher-proven-dead candidates first (♻️ 2026-11-06).

Measured 2026-11-06: 8 shown wasalt ads at missing_count 1 (scraped 11-04, unseen by the 11-05 enum) had been
read «no listing» by the AR enricher on /ar AND /en, twice (alert wasalt_dead_but_active:enricher). The confirm
cohort selected only rows at missing_count >= grace, so they would have stayed on screen ~2 more nightly enums;
a CI spot check (42209883480, controls 5/5) read all 8 gone. The kill rule does not change: the confirm's own
GET must still read dead, so such a row is hidden on its third direct reading.
"""
from __future__ import annotations

import pathlib
import sys
import types

for name, attrs in (("supabase", {"Client": type("Client", (), {}), "create_client": lambda *a, **k: None}),
                    ("dotenv", {"load_dotenv": lambda *a, **k: None})):
    mod = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    sys.modules.setdefault(name, mod)

from scrapers.wasalt.liveness import ENRICHER_DEAD_ERRS, pick_enricher_dead  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[3]
U = "https://wasalt.sa/en/property/x-1"


def row(mc, err, errn, url=U):
    return {"id": 1, "listing_url": url, "missing_count": mc, "ar_data": {"_err": err, "_errn": errn}}


def test_the_measured_shape_is_picked():
    assert pick_enricher_dead([row(1, "nodetail", 2)], grace=3)
    assert pick_enricher_dead([row(2, "404", "3")], grace=3)


def test_one_read_is_not_enough():
    assert not pick_enricher_dead([row(1, "nodetail", 1)], grace=3)


def test_enum_just_saw_it_is_not_a_candidate():
    assert not pick_enricher_dead([row(0, "nodetail", 5)], grace=3)


def test_rows_at_grace_stay_in_the_normal_cohort():
    assert not pick_enricher_dead([row(3, "nodetail", 5)], grace=3)


def test_other_errors_and_bad_shapes_are_not_dead():
    for r in (row(1, "timeout", 4), row(1, "403", 4), row(1, None, 4), row(1, "nodetail", "x"),
              row(1, "nodetail", 2, url=""), {"id": 1, "listing_url": U, "missing_count": 1, "ar_data": None}):
        assert not pick_enricher_dead([r], grace=3), r


def test_the_set_is_the_detectors_set():
    # mon_detect_wasalt_dead_but_active arm A: ar_data->>'_err' in ('nodetail','404','410') and _errn >= 2
    assert ENRICHER_DEAD_ERRS == {"nodetail", "404", "410"}


def test_wired_into_the_confirm_cohort_ahead_of_the_rest():
    src = (ROOT / "scrapers/wasalt/liveness.py").read_text()
    assert "for x in pick_enricher_dead(rows, args.grace)]" in src
    assert "cohort = (early + cohort)[:max(args.confirm_limit, len(early))]" in src
    # the kill still needs the confirm's own GET-dead verdict
    assert 'elif verdict == "dead":\n                        dead += 1; dead_ids[tbl].append(lid)' in src
