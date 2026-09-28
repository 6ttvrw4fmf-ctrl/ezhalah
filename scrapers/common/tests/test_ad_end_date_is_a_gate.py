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
# Widened 2026-09-28: tuba kept 39 expired ads live through `advalidatorinfo.endDate`, a reader the
# Arabic label alone never saw. An API key that feeds the end date counts as reading it.
_END_LABEL = re.compile(r"(?:إنتهاء|انتهاء)\s*(?:الإعلان|رخصة\s*الإعلان|ترخيص\s*الإعلان|الترخيص)|license_end_date"
                        r'|"license_expiry"|licence_expiry|\bendDate\b|"End Date"')
# Frozen 2026-09-28, then cut to what is left after the fleet gate the same day (every platform that had
# an active row past its own date is gated). Shrink only:
#   reinvest — names «تاريخ إنتهاء رخصة الإعلان» in prose only; its API does not publish the date.
#   sadin    — down (502) since 2026-09-26; its field is unverifiable until it serves pages again.
#   the other 10 became visible when the label was widened; 0 active rows past their date on 09-28,
#   each joins the gate once its field is verified live as the ad's own end date.
UNGATED_BASELINE = frozenset({
    "reinvest", "sadin",
    "dallali", "earthapp", "ebriza", "ego", "holoul", "muajarh", "nawafeth", "raghdan", "remaxsa", "vmksa",
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
    return any(isinstance(n, ast.Call) and getattr(n.func, "attr", getattr(n.func, "id", None)) in ("ad_expiry_state", "gate_ad_end")
               for n in ast.walk(ast.parse(src)))


def test_every_scraper_that_reads_an_ad_end_date_gates_on_it():
    readers = {p.parent.name for p in ROOT.glob("*/run.py") if _END_LABEL.search(p.read_text(encoding="utf-8"))}
    gated = {n for n in readers if _calls_the_gate((ROOT / n / "run.py").read_text(encoding="utf-8"))}
    new_ungated = readers - gated - UNGATED_BASELINE
    assert not new_ungated, (f"{sorted(new_ungated)} read an ad end date but never call normalize.ad_expiry_state() — "
                             "an expired ad would be published (the Shomou 835/1,028 class)")
    stale = UNGATED_BASELINE - (readers - gated)
    assert not stale, f"{sorted(stale)} no longer ungated readers — remove them from UNGATED_BASELINE (ratchet)"
    assert {"shomou", "maktab", "tuba", "sukna", "ibaax", "abaad", "sakani", "muhaysini", "aqaratikom",
            "mizlaj"} <= gated   # every platform that had an active row past its own date on 2026-09-28


def test_an_expired_ad_is_upserted_inactive_and_pinned_with_its_date(monkeypatch):
    """gate_ad_end → the shared upsert: the marker never reaches PostgREST, the expired ad is written
    active=false and pinned with GONE evidence naming its date, an in-date ad is offered as LIVE."""
    from scrapers.common import db, normalize, sold_pin

    class _Q:
        def __init__(self, payload): self.payload = payload

    class _C:
        def table(self, _name): return self

        def upsert(self, payload, on_conflict=None): return _Q(list(payload))

    sent, pins = [], []
    monkeypatch.setattr(db, "sb", lambda: _C())
    monkeypatch.setattr(db, "_execute", lambda q, what=None: sent.extend(q.payload))
    monkeypatch.setattr(sold_pin, "pin_source_confirmed_gone", lambda t, ads, **kw: pins.append((t, ads, kw)))
    rows = [normalize.gate_ad_end({"ad_number": "SKN1", "license_expiry": "25/07/2026"}, "25/07/2026", T),
            normalize.gate_ad_end({"ad_number": "SKN2", "license_expiry": "03/01/2027"}, "03/01/2027", T),
            normalize.gate_ad_end({"ad_number": "SKN3"}, None, T)]
    db._wasalt_batch("sukna_residential_listings", rows)
    assert all(normalize.AD_END_KEY not in r for r in sent)
    assert {r["ad_number"]: r["active"] for r in sent} == {"SKN1": False, "SKN2": True, "SKN3": True}
    (table, ads, kw), = pins
    assert (table, ads, kw["oracle"]) == ("sukna_residential_listings", ["SKN1"], "sukna.sold_pin.ad_end_date")
    assert "25/07/2026" in kw["notes"]["SKN1"] and kw["seen_ad_numbers"] == ["SKN2"]
