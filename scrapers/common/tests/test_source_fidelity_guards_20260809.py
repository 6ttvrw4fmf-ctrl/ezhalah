"""Regression guards for the 2026-08-09 source-fidelity + raghdan-capture fixes.

Each test fails on the OLD code and passes on the new one. Grouped in one file on purpose: they
all defend the same rule — what the source published is what we store.
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

from scrapers.common import normalize
from scrapers.raghdan import run as raghdan

SCRAPERS = Path(__file__).resolve().parents[2]


# ── 1. No scraper may gate a price on MAGNITUDE ────────────────────────────────
# Standing owner rule (2026-08-03): a source-published price is stored and searchable at ANY
# magnitude. On 2026-08-09 five scrapers were found nulling — and mizlaj DISCARDING THE WHOLE
# LISTING for — prices under 1,000 SAR, on the assumption such a price is "impossible". All 204
# live sub-1000 Buy rows were then fetched from their source pages and 204/204 matched exactly, so
# the assumption was false. Wrong prices are corrected against the source page, never by magnitude.
_PRICEY = re.compile(r"price|\bn\b|amount|total", re.I)


def _names(node):
    """Every identifier mentioned in an expression, so `price`, `p.price` and `price_for_check`
    all read the same."""
    return {n.id for n in ast.walk(node) if isinstance(n, ast.Name)} | \
           {n.attr for n in ast.walk(node) if isinstance(n, ast.Attribute)}


def test_no_scraper_rejects_a_price_by_magnitude():
    """AST-based on purpose: a regex over source text also matches the COMMENTS that document the
    removed gates, so every fix would re-trip its own guard."""
    offenders = []
    for path in sorted(SCRAPERS.glob("*/run.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Compare):
                continue
            for op, cmp_to in zip(node.ops, node.comparators):
                if not isinstance(op, (ast.Lt, ast.LtE)):
                    continue
                if not (isinstance(cmp_to, ast.Constant) and cmp_to.value == 1000):
                    continue
                if any(_PRICEY.fullmatch(nm) or _PRICEY.search(nm) for nm in _names(node.left)):
                    offenders.append(
                        f"{path.parent.name}/run.py:{node.lineno}: "
                        f"{ast.unparse(node)}")
    assert not offenders, (
        "A price magnitude gate is back. A source-published price is stored at any magnitude "
        "(PRICE = SOURCE, 2026-08-03) — 204/204 live sub-1000 Buy rows matched their source page "
        "on 2026-08-09, so 'too small to be real' is not a fact about the data. Correct wrong "
        "prices against the SOURCE PAGE instead:\n  " + "\n  ".join(offenders)
    )


# ── 2. Raghdan must not keep a private, drifting copy of the canonical type map ─
# The drift cost three defects at once: type_ar became the page TITLE, the unmapped type fell back
# to the "Residential Land" routing default, and that default made the source's TOTAL price be
# stored as a per-METER rate (price_total NULL). One missing spelling, three broken fields.
def test_raghdan_maps_hamza_alif_rest_house():
    assert raghdan._map_type("إستراحة للبيع في الودي، حائل") == "Rest House"
    assert raghdan._map_type("استراحة للبيع") == "Rest House"


def test_raghdan_type_overrides_do_not_shadow_the_shared_map_silently():
    """Overrides are for genuine conflicts + platform-only vocabulary ONLY (map_type_exact's
    contract). Anything that merely REPEATS the shared map is drift waiting to happen."""
    redundant = {
        k: v for k, v in raghdan.TYPE_OVERRIDES_AR.items()
        if normalize.TYPE_MAP_AR.get(k) == v
    }
    assert not redundant, (
        f"These raghdan overrides duplicate the shared map and will silently drift: {redundant}"
    )


def test_raghdan_inherits_shared_map_keys_it_used_to_be_missing():
    """The 12 keys the private copy had drifted away from — including the two that keep Farm and
    Agriculture Plot from re-merging on this platform."""
    for word in ("إستراحة", "أرض تجارية", "شقق", "دوبليكس", "ستوديو", "حوش"):
        assert raghdan._map_type(word) is not None, f"raghdan no longer maps {word!r}"


# ── 3. TRIPWIRE: the shared map still folds «أرض زراعية» into Farm ─────────────
# This is a KNOWN, OWNER-GATED conflict, pinned here so it cannot rot silently:
#   2026-07-16 (owner-approved): «ارض زراعية» → Farm was promoted fleet-wide as canonical.
#   2026-07-21 (PR#186, owner-mandated): مزرعة (Farm) and أرض زراعية (Agriculture Plot) were SPLIT
#     into two distinct clean types, because Agriculture Plot outnumbers real Farm ~3:1 live and a
#     merged button mostly surfaced bare agricultural land.
# The second decision supersedes the first, but the shared map was never revisited. Blast radius
# TODAY is zero — verified live 2026-08-09: no platform stores the raw Arabic string «أرض زراعية»
# (`... where property_type ILIKE '%زراع%'` returns 0 rows across every scraper table), so no live
# listing is misfiled. Changing the map is a TAXONOMY decision and needs the owner, so this test
# asserts the status quo rather than silently re-deciding it.
#
# It fails the moment either half of that changes — a new spelling entering the shared map, or the
# fold being edited — which is when a human has to make the call.
def test_agriculture_plot_fold_is_pinned_pending_owner_decision():
    assert normalize.map_type("أرض زراعية") == "Farm", (
        "The «أرض زراعية» → Farm fold changed. If this was deliberate, the owner must confirm the "
        "taxonomy decision and the daily audit's Section 5b additivity check must be re-run; if it "
        "was accidental, restore it."
    )
    # The split itself must remain real: the two canonical English types stay distinct values.
    assert normalize.map_type("مزرعة") == "Farm"
    assert "Agriculture Plot" != "Farm"


# ── 4. Raghdan reads the location the page RENDERS, not only its JSON-LD ────────
# Raghdan's REGA-sourced page shape publishes address {"addressCountry":"SA"} and nothing else in
# JSON-LD, while the body renders the full «الموقع» card. Reading JSON-LD only left 172 of 361 live
# rows with no city at all — unreachable by every city filter.
_FIXTURE = """
<div><h2>العنوان</h2>
  <span class="lbl">المدينة<!-- -->:</span><span class="val"></span>
  <span class="lbl">شارع<!-- -->:</span><span class="val"></span>
</div>
<div><h2>الموقع</h2>
  <span class="lbl">المنطقة<!-- -->:</span><span class="val">منطقة مكة المكرمة</span>
  <span class="lbl">المدينة<!-- -->:</span><span class="val">جدة</span>
  <span class="lbl">الحى<!-- -->:</span><span class="val">النعيم</span>
  <span class="lbl">الرمز البريدي<!-- -->:</span><span class="val">23526</span>
</div>
"""


def test_rendered_location_reads_the_location_card():
    loc = raghdan._rendered_location(_FIXTURE)
    assert loc == {"region": "منطقة مكة المكرمة", "city": "جدة",
                   "district": "النعيم", "postal": "23526"}


def test_rendered_location_is_scoped_past_the_address_card():
    """The earlier «العنوان» card repeats a usually-BLANK «المدينة» label. Reading that one would
    overwrite a good city with an empty string — the parser must start after «الموقع»."""
    assert raghdan._rendered_location(_FIXTURE)["city"] == "جدة"


def test_rendered_location_rejects_the_unspecified_placeholder():
    body = _FIXTURE.replace(">النعيم<", ">غير محدد<")
    assert "district" not in raghdan._rendered_location(body)


def test_rendered_location_absent_card_yields_nothing_not_a_guess():
    assert raghdan._rendered_location("<html><body>no location card</body></html>") == {}


@pytest.mark.parametrize("ar,en", [("جدة", "Jeddah"), ("مكة المكرمة", "Mecca"),
                                   ("الرياض", "Riyadh"), ("حائل", "Hail")])
def test_rendered_city_survives_the_unchanged_canonical_mapper(ar, en):
    """The fallback feeds the SAME normalize.map_city path as the JSON-LD one — no new resolution
    logic, so an unrecognised value still resolves to an honest None."""
    assert normalize.map_city(ar) == en
