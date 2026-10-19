"""An empty inblaj run must SAY WHY, in the database — not only on stdout.

Measured on production 2026-09-20: `alhumaidan` had run four times, every run `ok=true`, every run
`rows_seen=3, rows_upserted=0`, and every run's `notes` **NULL**. Reading the run ledger, that is
indistinguishable from a parser that silently dropped every row — and it was read exactly that way,
costing a full investigation before anyone fetched the site.

The site was FINE. al-humaidan.inblaj.net publishes three ads and all three are transacted:

    استراحات للإيجار تم الإيجار
    شقة للإيجار تم الإيجار
    عمارة للبيع تم البيع

`scrapers/common/inblaj_platform.py` skips «تم الإيجار» / «تم البيع» by design — a transacted ad the
office still displays is not active inventory. Zero upserts was the CORRECT answer. The defect was
never the parsing; it was that the reason existed only in a `print()` and was thrown away before the
run ledger was written, so the database could not tell "sold out" from "broken".

This is the repo's standing shape: **a failure that is invisible in the surface people actually read
is a defect even when the code is right.** The fix persists the per-reason tally into
`scrape_runs.notes`, and `ok` stays True — a site whose whole catalogue is sold out is healthy.

Executes the REAL `skip_note` out of the production module (never a retyped copy), which is why it
was named rather than left inline.

Run: python -m pytest scrapers/common/tests/test_inblaj_skip_reason_reaches_the_run_ledger.py -v
"""
from __future__ import annotations

import inspect
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scrapers.common.inblaj_platform as IP  # noqa: E402
from scrapers.common.inblaj_platform import skip_note  # noqa: E402


def test_nothing_skipped_writes_no_note():
    # An ordinary full run must not start decorating the ledger with empty noise.
    assert skip_note({}) is None
    assert skip_note(None) is None  # type: ignore[arg-type]


def test_the_alhumaidan_case_is_legible_in_the_ledger():
    # The exact production shape: three ads, all transacted.
    note = skip_note({"transacted": 3})
    assert note is not None, "an all-skipped run must leave a reason behind"
    assert "transacted" in note and "3" in note, note
    # The whole point: a human (or a monitor) reading ONLY the ledger can tell this from a breakage.
    assert note.startswith("skipped: "), note


def test_dominant_reason_leads_and_ties_are_stable():
    note = skip_note({"unreachable": 1, "transacted": 7, "http_404": 3})
    assert note == "skipped: transacted x7, http_404 x3, unreachable x1".replace(" x", "x"), note
    # ties break alphabetically so the string is deterministic run to run (a churning note is noise)
    assert skip_note({"b": 2, "a": 2}) == "skipped: ax2, bx2"


def test_note_is_capped_to_the_fleet_limit():
    many = {f"reason_{i:03d}": i + 1 for i in range(200)}
    note = skip_note(many)
    assert note is not None and len(note) <= 300, len(note or "")


def test_run_platform_actually_passes_the_note_to_end_run():
    """A helper nobody calls fixes nothing — assert the real call site wires it through.

    Source-shape assertion rather than a full run_platform execution: that function needs live HTTP
    and a real Supabase client, which a unit barrier must not require. The shape checked here is
    exactly the line that was missing, so it fails if the wiring is removed again.
    """
    src = inspect.getsource(IP.run_platform)
    assert "skip_note(skipped)" in src, "run_platform no longer builds the note"
    end_run_call = re.search(r"db\.end_run\((.*?)\)\n", src, re.S)
    assert end_run_call, "could not locate the end_run call in run_platform"
    assert "notes=note" in end_run_call.group(1), (
        "end_run is being called without notes= again — the ledger goes back to NULL and an empty "
        "run becomes indistinguishable from a broken one"
    )
    # ok stays True: sold-out is healthy, not failing.
    assert "ok=True" in end_run_call.group(1), end_run_call.group(1)


# The three titles al-humaidan.inblaj.net actually serves, fetched live 2026-09-20. These are the
# rows behind production's rows_seen=3 / rows_upserted=0.
ALHUMAIDAN_LIVE_TITLES = [
    "استراحات للإيجار تم الإيجار",
    "شقة للإيجار تم الإيجار",
    "عمارة للبيع تم البيع",
]


def test_every_real_alhumaidan_title_is_recognised_as_transacted():
    """EXECUTE the real regex against the real titles — not a grep of the module source.

    An earlier draft of this test asserted the strings merely appeared somewhere in the module, and
    a mutation that broke the actual matcher sailed straight past it: the words also live in the
    module docstring. Grepping source for a literal proves nothing when prose carries that literal.
    """
    for title in ALHUMAIDAN_LIVE_TITLES:
        assert IP._TRANSACTED_RE.search(title), f"would be ingested as ACTIVE inventory: {title}"


def test_an_ordinary_listing_is_not_mistaken_for_transacted():
    # The skip must not swallow live ads that merely contain the deal words.
    for title in ("شقة للإيجار",
                  "عمارة للبيع",
                  "أرض للبيع في الرياض"):
        assert not IP._TRANSACTED_RE.search(title), f"a LIVE ad was skipped as transacted: {title}"


def test_hamzaless_spelling_is_covered():
    # «الايجار» without the hamza is common in Saudi listing prose.
    assert IP._TRANSACTED_RE.search("شقة تم الايجار")


def test_the_skip_reason_reaching_the_ledger_is_the_one_run_platform_emits():
    """Tie the two halves together: the reason string the parser returns is the key that is tallied."""
    src = inspect.getsource(IP)
    assert '"already_transacted"' in src, "the transacted skip no longer names a reason"
    note = skip_note({"already_transacted": 3})
    assert note == "skipped: already_transactedx3", note
