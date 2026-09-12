"""aqar's per-row liveness audit trail: it must exist, and it must not lie.

THE DEFECT, measured on production 2026-09-12. `aqar_liveness_detail` was created 2026-08-31 with
the `ops_aqar_recent_kills` view over it and four arms of `mon_detect_served_despite_direct_404`
reading it — and nothing ever wrote a row. Twelve days on, the identity sequence had still never
advanced (`last_value = NULL`, `n_tup_ins = 0`) while this sweep deactivated ~300 aqar listings a
day. So the audit trail built to answer "why did 13,139 listings disappear on 2026-08-30" was empty
by construction, and the only detector watching whether source-confirmed-dead rows are still served
was dark on aqar and dealapp: a clean bill of health over an unmeasured surface.

The wiring itself is barriered offline by `scripts/verify-liveness-evidence-tables-have-writers.ts`
(a declared evidence ledger that no scraper inserts into fails the suite). These tests cover the
other half — that what gets written is TRUE, because an audit trail that misreports is worse than
one that is missing: it puts a confident record on a reading nobody took.

The two that matter most are §0 restated in the evidence layer:
  * a transient (no answer) reading must never be readable back as a death;
  * a --report-only verify run must never be readable back as a real deactivation.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.aqar.liveness import evidence_row  # noqa: E402


def test_a_transient_reading_is_never_readable_back_as_a_death():
    """UNKNOWN IS NOT DEAD, in the ledger as well as in the row."""
    r = evidence_row("aqar_residential_listings", 42, 0, "transient", 2, 2, applied=False)
    assert r["verdict"] == "transient", "a no-answer reading must not be recorded as a kill/strike"
    assert r["applied"] is False, "a transient applies nothing to the row"
    assert r["missing_count_before"] == r["missing_count_after"] == 2, (
        "a transient must not move the strike count on either side of the ledger"
    )


def test_no_response_records_a_null_status_not_zero():
    """`status = 0` means no response arrived. 0 is not an HTTP status, and writing it would
    record a fetch that never happened as though the source had answered."""
    assert evidence_row("aqar_residential_listings", 1, 0, "transient", 0, 0,
                        applied=False)["http_status"] is None
    assert evidence_row("aqar_residential_listings", 1, None, "transient", 0, 0,
                        applied=False)["http_status"] is None


def test_a_real_status_is_preserved_exactly():
    for status in (404, 410, 403, 429, 500, 200):
        r = evidence_row("aqar_residential_listings", 7, status, "strike", 0, 1, applied=True)
        assert r["http_status"] == status, f"{status} must survive into the audit trail verbatim"


def test_report_only_is_never_readable_back_as_an_applied_deactivation():
    """--report-only reaches the SAME verdict and writes nothing to the listing row. The ledger
    must say so, or a verify run becomes indistinguishable from a real kill after the fact."""
    r = evidence_row("aqar_residential_listings", 99, 404, "kill", 2, 3, applied=False)
    assert r["verdict"] == "kill", "the verdict reached is still recorded honestly"
    assert r["applied"] is False, "but nothing was applied, and the ledger must not claim it was"


def test_strike_and_kill_carry_the_counts_that_produced_them():
    """`ops_aqar_recent_kills` exists to show the strike count a kill reached. Both sides of the
    transition have to be in the row or that question is still unanswerable."""
    strike = evidence_row("aqar_residential_listings", 5, 404, "strike", 0, 1, applied=True)
    assert (strike["missing_count_before"], strike["missing_count_after"]) == (0, 1)

    kill = evidence_row("aqar_commercial_listings", 6, 404, "kill", 2, 3, applied=True)
    assert (kill["missing_count_before"], kill["missing_count_after"]) == (2, 3)
    assert kill["source_table"] == "aqar_commercial_listings", (
        "aqar has residential AND commercial; the ledger must say which table a row came from"
    )


def test_the_row_matches_the_tables_schema():
    """Every column the migration declares NOT NULL must be present, or the insert fails silently
    into the best-effort handler and the trail is empty again for a different reason."""
    r = evidence_row("aqar_residential_listings", 1, 404, "kill", 2, 3, applied=True)
    assert set(r) == {
        "run_at", "source_table", "listing_id", "http_status",
        "verdict", "missing_count_before", "missing_count_after", "applied",
    }
    for required in ("run_at", "source_table", "listing_id", "verdict", "applied"):
        assert r[required] is not None, f"{required} is NOT NULL in migration 20260831003901"
    assert r["verdict"] in ("strike", "kill", "transient"), (
        "the table's CHECK constraint allows exactly these three"
    )
