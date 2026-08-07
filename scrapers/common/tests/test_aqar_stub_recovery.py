"""Guards for the Aqar stub-capture recovery job (2026-08-05).

THE PROBLEM IT REPAIRS
----------------------
The 2026-06-18..30 bulk load stored a description-only `source_capture.source_text` (~381 chars) with
NO «تفاصيل الإعلان» specification block; healthy captures average ~2,594 chars and contain it. Every
label-anchored parser in enrich_residential.py reads that block, so on a stub row they extract NOTHING
— which is the single root cause behind the missing bedrooms/bathrooms/floor/direction/age/licence on
~43% of aqar's rent apartments, and behind the 184 rows holding rent_period NULL while aqar publishes
«سنوي» (those are invisible in BOTH annual and monthly search).

Neither existing job can heal them: sweep.py re-reads only the first N pages per city, and liveness.py
never re-parses. Hence a dedicated re-enrichment.

WHAT THESE TESTS PIN
--------------------
1. The job REUSES production parsing/writing — it must never grow its own parser, because a second
   parser would drift from the one the nightly crawl uses and reintroduce exactly the class of bug
   this whole effort removed.
2. It cannot invent: no literal field assignments, no arithmetic on prices.
3. It FAILS LOUDLY in an environment aqar does not serve. aqar.fm returns a ~241 KB app shell (title
   «تطبيق عقار», no listing payload) to unfamiliar clients while the GitHub runners get real pages. A
   silent 0-write run there would be indistinguishable from "already clean", so the job must exit
   non-zero and say why.
4. The stub discriminator stays the spec-block marker, not a length heuristic.

Run: python -m pytest scrapers/common/tests/test_aqar_stub_recovery.py
"""
from __future__ import annotations

import re
from pathlib import Path

SRC = (Path(__file__).resolve().parent.parent.parent / "aqar" / "recover_stubs.py").read_text(encoding="utf-8")


def test_reuses_the_production_parser_and_writer() -> None:
    assert "from scrapers.aqar.enrich_residential import enrich_residential" in SRC, (
        "the recovery must call the SAME parser the nightly crawl uses; a private parser would drift"
    )
    assert "db.upsert_aqar_residential(fresh)" in SRC, (
        "recovered rows must go through the production upsert so triggers/canonical mapping/sync all "
        "run exactly as they do for a normal crawl"
    )


def test_does_not_reimplement_parsing() -> None:
    """No bespoke field extraction — the whole point is to reuse enrich_residential()."""
    banned = ["re.search(r\"المساحة", "def _int_after_label", "def _parse_price", "BeautifulSoup"]
    for b in banned:
        assert b not in SRC, f"recovery must not parse for itself (found {b!r})"


def test_never_fabricates_a_value() -> None:
    """No literal writes, no price arithmetic — it stores only what the page yields."""
    assert not re.search(r'"(furnished|elevator|parking|kitchen|rent_period)"\s*:\s*(True|False|"[a-z]+")', SRC), (
        "the recovery must not assign any field a literal value"
    )
    assert not re.search(r"\bprice\w*\s*[*/]\s*\d", SRC), "no price arithmetic in a recovery job"


def test_stub_discriminator_is_the_spec_block_not_a_length_guess() -> None:
    assert '"تفاصيل الإعلان" not in txt' in SRC, (
        "a stub is defined by the ABSENCE of the spec block. A length threshold would misclassify a "
        "genuinely short but complete listing."
    )


def test_fails_loudly_when_aqar_is_not_serving_this_environment() -> None:
    """0 parseable pages must be an ERROR, never a quiet success."""
    assert 'if c["fetched"] == 0 and rows:' in SRC, "must detect the all-unfetchable case"
    assert "return 1" in SRC, "must exit non-zero so CI shows red"
    assert "Run this from CI" in SRC, "must tell the operator what to do"
    assert 'ok=False' in SRC, "the run row must record the failure, not report ok"


def test_dry_run_writes_nothing() -> None:
    assert "if dry_run:" in SRC and "--dry-run" in SRC, "must support inspecting the diff first"
    # the dry-run branch must return BEFORE the upsert
    body = SRC[SRC.index("if dry_run:"):]
    upsert_at = body.index("db.upsert_aqar_residential")
    return_at = body.index("return")
    assert return_at < upsert_at, "dry-run must return before writing"


def test_reports_no_gain_separately_from_failure() -> None:
    """A listing aqar genuinely publishes nothing more for is NOT a failure — it is the answer.

    The owner's bar is 'fixed, or proven individually which information Aqar genuinely does not
    provide'. no_gain is that proof, so it must be counted and reported distinctly from unfetchable.
    """
    assert "no_gain" in SRC and "unfetchable" in SRC, "the two outcomes must be counted separately"
    assert "aqar publishes nothing further" in SRC, "no-gain must be stated as a finding, not an error"


# ── the recovery must not move a price it cannot justify ─────────────────────────────────────────
def test_price_period_and_area_are_held_back_by_default() -> None:
    """2026-08-05 dry-run evidence: three unexplained price moves, two of them EXACTLY ÷12.

    6668912 24,000 -> 2,000 and 6609974 30,000 -> 2,500 are the signature of a monthly figure landing
    in an annual column; 6663318 550 -> 16,000 is unexplained in the other direction.
    enrich_residential scans `price_text` — the whole pre-«تفاصيل الإعلان» prefix, which carries the
    seller's free-text blurb — so a "recovery" could overwrite a correct price with a prose number.
    rent_period is worse: it DEFAULTS to "annual" for every Rent listing, so recovering it would write
    a default over an honest NULL. Structured fields (aqar's own 0/1 keys and spec-table labels) are
    safe and are recovered; these are not, until the price path is verified against source.
    """
    assert "_PRICE_AND_PERIOD" in SRC
    for f in ("price_annual", "price_total", "price_per_meter", "rent_period", "area_m2"):
        assert f'"{f}"' in SRC.split("_PRICE_AND_PERIOD")[1].split("}")[0], f"{f} must be held back"
    assert "structured_only: bool = True" in SRC, "holding price back must be the DEFAULT"
    assert "--include-price" in SRC, "overriding must be explicit and deliberate"


def test_held_back_fields_are_carried_through_unchanged() -> None:
    """Not merely skipped in the report — the existing value must be written back verbatim."""
    assert "for f in _PRICE_AND_PERIOD:" in SRC and "fresh[f] = r.get(f)" in SRC, (
        "the upsert receives the whole row, so a held-back field must be re-seeded from the DB value "
        "or the upsert would null it"
    )


def test_report_hides_fields_that_cannot_be_written() -> None:
    """A diff line claiming a price change we will not make would be a lie to the operator."""
    assert "reportable = [f for f in REPORT_FIELDS" in SRC
    assert "structured_only and f in _PRICE_AND_PERIOD" in SRC
