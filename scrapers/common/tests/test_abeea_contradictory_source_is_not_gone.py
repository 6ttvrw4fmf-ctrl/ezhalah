"""Guards for abeea's duplicate-post conflict and for the oracle that reads the RIGHT field.

TWO DEFECTS, BOTH FOUND ON 2026-08-24 BY RUNNING A REAL PRUNE CYCLE AND READING THE RESULT.

**1. A contradictory source is not authoritative GONE evidence.** abeea publishes some properties
TWICE — two posts carrying the same «Property ID». Measured that day over the full WP REST list:
4 of 245 posts are such duplicates, and THREE of those pairs disagree with each other:

    ABRE300  …-al-sadafah-district/    "For Sale"          …-al-sadafah-district-2/  "For Rent, Rented"
    ABRE277  …-al-bahar-district/      "For Rent, Rented"  …-al-bahar-district-2/    "For Sale"
    ABRE104  …-al-shaati-al-gharbi/    "For Sale"          …-al-shaati-al-gharbi-2/  "For Rent"

Ezhalah keys on Property ID, so both posts collapse onto ONE row. The live post upserted it
available; then `_pin_sold_inactive`, which runs after every upsert, killed it anyway. ABRE300 and
ABRE277 sat inactive while abeea was still advertising them — and the row even carried a
`last_seen_at` from the very crawl that killed it, which is the tell.

The owner's rule decides this exactly: authoritative GONE inactivates; UNKNOWN / inconclusive HOLDS.
A source that contradicts itself is inconclusive. So a live sighting in the same crawl wins.

**2. An oracle must be controlled against the failure mode the platform ACTUALLY uses.** abeea's
first `verify_gone` tested a bogus slug, saw a hard 404, and concluded "404 = gone, 200 = live".
True, and useless: abeea does not delete a sold property. The post stays up, returns 200, renders in
full, and only «Property Status» flips to Sold/Rented. That oracle proved a page EXISTS and called it
alive — so 9 rows were restored on its say-so and the next crawl correctly re-killed 5 of them.

    python -m pytest scrapers/common/tests/test_abeea_contradictory_source_is_not_gone.py -q
"""
from __future__ import annotations

import re
import sys
import types
from pathlib import Path

import pytest

_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.abeea import run as abeea  # noqa: E402
from scrapers.common import db  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
RUN_PY = (REPO / "scrapers" / "abeea" / "run.py").read_text(encoding="utf-8")


# ── 1. the pin must not override a live sighting ─────────────────────────────────────────────────
class _Q:
    def __init__(self, sink, table):
        self._sink, self._table, self._payload = sink, table, None

    def update(self, payload):
        self._payload = payload
        return self

    def insert(self, rows):
        self._payload = {"_insert": rows}
        return self

    def in_(self, _col, ads):
        self._sink.append((self._table, dict(self._payload), sorted(ads)))
        return self

    def execute(self):
        if self._payload and "_insert" in self._payload:
            self._sink.append((self._table, "insert", self._payload["_insert"]))
        return types.SimpleNamespace(data=[])


class _Client:
    def __init__(self, sink):
        self._sink = sink

    def table(self, name):
        return _Q(self._sink, name)


@pytest.fixture
def sink(monkeypatch):
    out: list = []
    monkeypatch.setattr(db, "sb", lambda: _Client(out))
    monkeypatch.setattr(db, "_execute", lambda q, what=None: q.execute())
    return out


def _pinned(sink):
    ads = []
    for _tbl, payload, arg in sink:
        if isinstance(payload, dict) and payload.get("active") is False:
            ads += arg
    return sorted(ads)


def test_ad_number_seen_live_this_crawl_is_never_pinned(sink):
    """THE REGRESSION: ABRE300 is 'Rented' on its duplicate post and 'For Sale' on its primary."""
    abeea._pin_sold_inactive("abeea_residential_listings",
                             ["ABRE300", "ABRE277", "ABRE999"],
                             {"ABRE300", "ABRE277"})
    assert _pinned(sink) == ["ABRE999"], (
        "a listing abeea still advertises was pinned inactive because a DUPLICATE post for the same "
        "Property ID said Rented. A source that contradicts itself is not authoritative GONE."
    )


def test_unambiguous_gone_still_pins(sink):
    """The hold must not become a blanket amnesty — a clean Sold/Rented still inactivates."""
    abeea._pin_sold_inactive("abeea_residential_listings", ["ABRE254", "ABRE115"], set())
    assert _pinned(sink) == ["ABRE115", "ABRE254"]


def test_pin_records_gone_evidence(sink):
    """Without per-row evidence, every correct sold-pin reads to the barrier as an unverified
    deactivation and mon_detect_prune_kill_without_source_verdict() cries wolf on the one path that
    is actually well-evidenced."""
    abeea._pin_sold_inactive("abeea_residential_listings", ["ABRE254"], set())
    inserts = [rows for tbl, kind, rows in
               [(t, k, r) for t, k, r in sink if k == "insert"]
               if tbl == "ops_stale_inactivation_probe"]
    assert inserts, "the sold pin recorded no GONE evidence"
    row = inserts[0][0]
    assert row["ad_number"] == "ABRE254" and row["verdict"] == "GONE"
    assert "property_status" in row["oracle"]


def test_everything_conflicted_pins_nothing_and_writes_nothing(sink):
    abeea._pin_sold_inactive("abeea_residential_listings", ["ABRE300"], {"ABRE300"})
    assert sink == []


def test_main_passes_the_live_sighting_set():
    """The guard is worthless if main() never hands it the live set."""
    assert re.search(r"live_res\s*=\s*\{r\[.ad_number.\]\s+for\s+r\s+in\s+res\}", RUN_PY), \
        "main() no longer builds the live-sighting set for the residential pin"
    assert "_pin_sold_inactive(\"abeea_residential_listings\", sold_res, live_res)" in RUN_PY
    assert "_pin_sold_inactive(\"abeea_commercial_listings\", sold_com, live_com)" in RUN_PY


# ── 2. the oracle must read Property Status, not merely the HTTP status ──────────────────────────
def _page(status: str) -> str:
    return ('<html><body>' + 'x' * 3000 + '<ul class="detail-wrap">'
            f'<li><strong>Property Status</strong> <span>{status}</span></li>'
            '</ul></body></html>')


def test_a_sold_page_that_returns_200_is_gone_not_live():
    """abeea keeps the post up when a property sells — only the status flips. A 200 is not life."""
    items = abeea._detail_items(_page("For Rent, Rented"))
    status = (items.get("Property Status") or "").lower()
    assert any(g in status for g in abeea.GONE_STATUS), (
        "the oracle would read a Rented listing as live — the exact error that caused 5 of the 9 "
        "abeea restores on 2026-08-24 to be wrong"
    )


def test_an_available_page_is_live():
    for good in ("For Sale", "For Rent", "For Rent, New Listing"):
        status = (abeea._detail_items(_page(good)).get("Property Status") or "").lower()
        assert not any(g in status for g in abeea.GONE_STATUS), good


def _oracle_src() -> str:
    """The oracle's WHOLE decision path.

    The verdict logic was extracted into the pure `_liveness_verdict()` on 2026-08-25 (identity
    supersession fix), so reading only `_verify_gone`'s body would now miss the half that actually
    decides — and this assertion would silently pass on an oracle that had lost its status check.
    The window follows the code; the assertions below are unchanged in strength and one is added.
    """
    verdict = RUN_PY[RUN_PY.index("def _liveness_verdict"):RUN_PY.index("def _pin_sold_inactive")]
    gone = RUN_PY[RUN_PY.index("def _verify_gone"):]
    return verdict + gone[:gone.index("pruned = 0")]


def test_oracle_reads_the_status_field_and_holds_when_unreadable():
    src = _oracle_src()
    assert "_detail_items" in src and "GONE_STATUS" in src, (
        "abeea's verify_gone must decide on «Property Status» (the field the platform actually "
        "flips), using the same parser and token list as map_listing so the two cannot disagree"
    )
    assert src.count('return "unknown"') >= 2, (
        "a page that renders without a readable status cell must be UNKNOWN — never 'live', which "
        "would resurrect a sold listing, and never 'gone', which would kill a live one"
    )


def test_oracle_checks_identity_before_status():
    """A page publishing a DIFFERENT «Property ID» is not evidence the probed ad is alive.

    abeea edits a live post's Property ID in place (ABREA166 → ABRE166). Identity is keyed on that
    field, so the next crawl inserts a second row while the old row keeps the same listing_url.
    Before 2026-08-25 the oracle loaded that shared page, saw 200 + a non-Sold status, answered
    'live', and prune SELF-HEALED the retired row — resurrecting it on every cycle, so both rows
    stayed production_ready for months and the user saw two cards for one property.
    """
    assert "_ad_number_from_pid" in _oracle_src(), (
        "the oracle must compare the page's own published Property ID against the ad_number it is "
        "probing, using the same derivation as map_listing"
    )
    v = abeea._liveness_verdict
    # the two real production cases
    assert v(200, 5000, "ABRE166", "For Rent", "ABREA166") == "gone"
    assert v(200, 5000, "ABRE334", "For Rent", "ABRE3334") == "gone"
    # and the cases that must NOT change
    assert v(200, 5000, "ABRE166", "For Rent", "ABRE166") == "live"
    assert v(200, 5000, "ABRE166", "Rented", "ABRE166") == "gone"
    assert v(200, 5000, None, "For Rent", "ABdeadbeef") == "live", (
        "ads whose page publishes no Property ID key on md5(slug) — for them the URL IS the "
        "identity and there is nothing to compare, so behaviour must be unchanged"
    )
    assert v(200, 5000, "ABRE166", None, "ABRE166") == "unknown"
    assert v(404, 0, None, None, "ABRE166") == "gone"
    assert v(403, 10, None, None, "ABRE166") == "retry", "blocked is never proof of death"
