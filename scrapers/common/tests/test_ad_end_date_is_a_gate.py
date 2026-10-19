"""An ad's OWN end date is a gate, never a caption (owner 2026-09-28: «add barriers so dont have it again»).

Shomou listed 1,028 ads of which 835 were past their own «تاريخ إنتهاء الإعلان». Two halves:
1. normalize.ad_expiry_state() reads such a date honestly (Gregorian only; a Hijri or build year is
   'unknown', never 'live').
2. RATCHET: every scraper that reads an ad-end / ad-licence-end date must route it through
   ad_expiry_state(). The scrapers that read one today without gating are frozen in UNGATED_BASELINE —
   a NEW scraper can never join it, and one that gains the gate must leave it (the list only shrinks).
"""
import ast
import datetime
import re
from pathlib import Path

from scrapers.common.normalize import ad_expiry_state

ROOT = Path(__file__).resolve().parents[2]
_END_LABEL = re.compile(r"(?:إنتهاء|انتهاء)\s*(?:الإعلان|رخصة\s*الإعلان|ترخيص\s*الإعلان|الترخيص)|license_end_date")
# Frozen 2026-09-28. Each READS an ad-licence end date and does not (yet) refuse an expired ad at map
# time. abaad and aqarcity use it in their liveness oracles; the rest only capture it. Shrink only.
UNGATED_BASELINE = frozenset({
    "abaad", "aqaratikom", "aqarcity", "mizlaj", "reinvest", "sadin", "sakani",
    "souq24", "sukna", "villassa",
})
T = datetime.date(2026, 9, 28)


def test_the_gate_reads_only_real_gregorian_end_dates():
    assert ad_expiry_state("2026-12-26", T) == "live"
    assert ad_expiry_state("2026-09-28T12:00:00Z", T) == "live"      # its last day is still live
    assert ad_expiry_state("2026-09-27", T) == "expired"
    assert ad_expiry_state("26/12/2026", T) == "live" and ad_expiry_state("13/03/2024", T) == "expired"
    assert ad_expiry_state("٢٠٢٤-٠٣-١٣", T) == "expired"               # Arabic-Indic digits
    for not_a_date in ("1433-02-11", "1983-02-16", "0024-12-15", "2026-13-40", "", None, "قريباً"):
        assert ad_expiry_state(not_a_date, T) == "unknown", not_a_date


def _calls_the_gate(src: str) -> bool:
    """A real CALL, found by AST — a docstring or comment naming the gate is not a code path."""
    return any(isinstance(n, ast.Call) and getattr(n.func, "attr", getattr(n.func, "id", None)) == "ad_expiry_state"
               for n in ast.walk(ast.parse(src)))


def test_every_scraper_that_reads_an_ad_end_date_gates_on_it():
    readers = {p.parent.name for p in ROOT.glob("*/run.py") if _END_LABEL.search(p.read_text(encoding="utf-8"))}
    gated = {n for n in readers if _calls_the_gate((ROOT / n / "run.py").read_text(encoding="utf-8"))}
    new_ungated = readers - gated - UNGATED_BASELINE
    assert not new_ungated, (f"{sorted(new_ungated)} read an ad end date but never call normalize.ad_expiry_state() — "
                             "an expired ad would be published (the Shomou 835/1,028 class)")
    stale = UNGATED_BASELINE - (readers - gated)
    assert not stale, f"{sorted(stale)} no longer ungated readers — remove them from UNGATED_BASELINE (ratchet)"
    assert {"shomou", "maktab"} <= gated
