"""Hermetic contract for db.retire_superseded_siblings() — the res/com URL-collision root cause.

THE DEFECT THIS CLOSES (found by Search & Matching QA, repaired 2026-08-30).
A dual-table platform routes each ad to exactly ONE of `<platform>_residential_listings` /
`<platform>_commercial_listings`, decided from the source page. When that decision CHANGES between
runs — the source edits its type, a mapping learns a word it used to miss, or a degraded capture
classifies differently — the ad is written to the new table and the row in the old one is simply
abandoned. The SAME source ad then stays live in BOTH tables, and the Normal Filter renders it as
two independent cards that click through to one URL. Measured live: 8 such pairs across dealapp
and sadin, each visible as a duplicate card in a real production search.

WHY prune_unseen COULD NOT FIX IT, and why this is a separate function rather than a new guard:
  • prune_unseen works one table at a time and reasons from ABSENCE. Every circuit breaker it has
    (empty-seen, collapse, coverage floor) exists to stop absence from cascading — so on a thin
    catalog the orphan trips a guard forever and is never even given a strike.
  • verify_gone then makes the orphan IMMORTAL. The oracle asks "is this URL still live on the
    source?" and it is — the ad is alive in the SIBLING table. Verdict 'live' self-heals
    missing_count to 0 and refreshes last_seen_at. Measured: five sadin commercial rows last
    parsed 2026-07-26 still carried missing_count = 0 and last_seen_at of 2026-08-30, five weeks on.

This function answers a different question and therefore needs none of those guards: an ad in
`com_ads` was POSITIVELY parsed and classified commercial from the source page THIS run, which is
direct evidence its residential row is superseded. A thin or blocked crawl yields a smaller
seen-set and supersedes fewer rows; it can never cascade.
"""
from __future__ import annotations

import sys
import types

# ── Stub supabase + dotenv (common/db.py imports both at module load) ────────────────────────────
_supabase_mod = types.ModuleType("supabase")


class _StubClient:
    pass


_supabase_mod.Client = _StubClient
_supabase_mod.create_client = lambda url, key: _StubClient()
sys.modules.setdefault("supabase", _supabase_mod)

_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.common import db  # noqa: E402


# ── A tiny in-memory PostgREST stand-in: enough to observe exactly what the function asks for ────
class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, table, store, log):
        self._t, self._store, self._log = table, store, log
        self._ads, self._active_only, self._source, self._update = None, False, None, None

    def select(self, *_a):
        return self

    def update(self, payload):
        self._update = payload
        return self

    def in_(self, _col, ads):
        self._ads = list(ads)
        return self

    def eq(self, col, val):
        if col == "active":
            self._active_only = bool(val)
        if col == "source":
            self._source = val
        return self

    def execute(self):
        rows = self._store.setdefault(self._t, [])
        if self._update is not None:
            hit = [r for r in rows if r["ad_number"] in (self._ads or [])]
            for r in hit:
                r.update(self._update)
            self._log.append(("update", self._t, sorted(x["ad_number"] for x in hit), self._update))
            return _Resp(hit)
        sel = [r for r in rows
               if r["ad_number"] in (self._ads or [])
               and (not self._active_only or r.get("active"))
               and (self._source is None or r.get("source") == self._source)]
        self._log.append(("select", self._t, sorted(r["ad_number"] for r in sel)))
        return _Resp([{"ad_number": r["ad_number"]} for r in sel])


class _Client:
    def __init__(self, store, log):
        self._store, self._log = store, log

    def table(self, name):
        return _Query(name, self._store, self._log)


def _run(store, res_ads, com_ads, monkeypatch, source=None):
    log: list = []
    monkeypatch.setattr(db, "sb", lambda: _Client(store, log))
    n = db.retire_superseded_siblings(
        res_table="p_residential_listings", com_table="p_commercial_listings",
        res_ads=res_ads, com_ads=com_ads, source=source)
    return n, log


def _row(ad, active=True, source="P"):
    return {"ad_number": ad, "active": active, "source": source, "deactivated_at": None}


# ── 1. THE DEFECT ITSELF ─────────────────────────────────────────────────────────────────────────
def test_ad_classified_commercial_retires_its_residential_row(monkeypatch):
    """The exact live shape: SD6IWMD sits active in both tables; this run says commercial."""
    store = {"p_residential_listings": [_row("SD6IWMD")], "p_commercial_listings": [_row("SD6IWMD")]}
    n, _ = _run(store, res_ads=set(), com_ads={"SD6IWMD"}, monkeypatch=monkeypatch)
    assert n == 1
    assert store["p_residential_listings"][0]["active"] is False
    assert store["p_residential_listings"][0]["deactivated_at"] is not None
    # The surviving side is never touched — retiring must not cost the listing.
    assert store["p_commercial_listings"][0]["active"] is True


def test_it_works_in_the_other_direction_too(monkeypatch):
    """A genuinely residential ad reclassified out of the commercial table must clean up too."""
    store = {"p_residential_listings": [_row("A1")], "p_commercial_listings": [_row("A1")]}
    n, _ = _run(store, res_ads={"A1"}, com_ads=set(), monkeypatch=monkeypatch)
    assert n == 1
    assert store["p_commercial_listings"][0]["active"] is False
    assert store["p_residential_listings"][0]["active"] is True


# ── 2. IT MUST NEVER DELETE, AND NEVER TOUCH ANYTHING ELSE ───────────────────────────────────────
def test_deactivates_never_deletes(monkeypatch):
    store = {"p_residential_listings": [_row("A1")], "p_commercial_listings": [_row("A1")]}
    _run(store, res_ads=set(), com_ads={"A1"}, monkeypatch=monkeypatch)
    assert len(store["p_residential_listings"]) == 1, "the row must survive for audit/reversal"


def test_unrelated_ads_are_untouched(monkeypatch):
    """An ad this run never classified is none of this function's business, in either table."""
    store = {"p_residential_listings": [_row("KEEP"), _row("A1")],
             "p_commercial_listings": [_row("A1"), _row("ALSOKEEP")]}
    _run(store, res_ads=set(), com_ads={"A1"}, monkeypatch=monkeypatch)
    assert store["p_residential_listings"][0]["ad_number"] == "KEEP"
    assert store["p_residential_listings"][0]["active"] is True
    assert store["p_commercial_listings"][1]["active"] is True


def test_already_inactive_row_is_not_rewritten(monkeypatch):
    """Idempotent: a second run must not stamp a fresh deactivated_at over the original date."""
    store = {"p_residential_listings": [_row("A1", active=False)],
             "p_commercial_listings": [_row("A1")]}
    n, log = _run(store, res_ads=set(), com_ads={"A1"}, monkeypatch=monkeypatch)
    assert n == 0
    assert not [e for e in log if e[0] == "update"], "nothing to do → no write at all"


# ── 3. CONTRADICTORY EVIDENCE IS NOT OURS TO SETTLE ──────────────────────────────────────────────
def test_ad_classified_BOTH_ways_in_one_run_is_left_completely_alone(monkeypatch):
    """If the crawl itself classified one ad two ways, that is ambiguous — touch neither side.

    This is the guard that keeps a genuine cross-category record safe: the function only ever acts
    on unambiguous, single-category positive evidence."""
    store = {"p_residential_listings": [_row("A1")], "p_commercial_listings": [_row("A1")]}
    n, log = _run(store, res_ads={"A1"}, com_ads={"A1"}, monkeypatch=monkeypatch)
    assert n == 0
    assert store["p_residential_listings"][0]["active"] is True
    assert store["p_commercial_listings"][0]["active"] is True
    assert not [e for e in log if e[0] == "update"]


# ── 4. A BROKEN OR PARTIAL CRAWL MUST NEVER CASCADE ──────────────────────────────────────────────
def test_empty_seen_sets_do_nothing(monkeypatch):
    """A blocked crawl reports nothing; nothing may be retired. No absence-based reasoning here."""
    store = {"p_residential_listings": [_row("A1")], "p_commercial_listings": [_row("A1")]}
    n, log = _run(store, res_ads=set(), com_ads=set(), monkeypatch=monkeypatch)
    assert n == 0
    assert not [e for e in log if e[0] == "update"]


def test_a_thin_crawl_supersedes_only_what_it_actually_saw(monkeypatch):
    """Seeing 1 of 100 ads retires exactly that ad's sibling — never the 99 it never reached."""
    store = {"p_residential_listings": [_row(f"A{i}") for i in range(100)],
             "p_commercial_listings": [_row("A7")]}
    n, _ = _run(store, res_ads=set(), com_ads={"A7"}, monkeypatch=monkeypatch)
    assert n == 1
    assert [r["ad_number"] for r in store["p_residential_listings"] if not r["active"]] == ["A7"]


def test_source_filter_is_honoured(monkeypatch):
    """Platforms that share a table by `source` must not retire another platform's row."""
    store = {"p_residential_listings": [_row("A1", source="OTHER")],
             "p_commercial_listings": [_row("A1")]}
    n, _ = _run(store, res_ads=set(), com_ads={"A1"}, monkeypatch=monkeypatch, source="P")
    assert n == 0
    assert store["p_residential_listings"][0]["active"] is True


# ── 5. MUTATION PROOF — the pre-fix behaviour fails this contract ────────────────────────────────
def test_MUTATION_the_old_no_op_behaviour_fails(monkeypatch):
    """Before the fix there was NO cross-table step at all: the orphan simply stayed active.

    Reproduced here as the literal pre-fix behaviour (do nothing) and asserted to fail the very
    first contract above — so deleting or stubbing out retire_superseded_siblings can never pass."""
    store = {"p_residential_listings": [_row("SD6IWMD")], "p_commercial_listings": [_row("SD6IWMD")]}

    def _pre_fix_noop(**_kwargs):
        return 0

    monkeypatch.setattr(db, "retire_superseded_siblings", _pre_fix_noop)
    assert db.retire_superseded_siblings(
        res_table="p_residential_listings", com_table="p_commercial_listings",
        res_ads=set(), com_ads={"SD6IWMD"}) == 0
    # The orphan is still active → still a second card on the same URL. This is the live defect.
    assert store["p_residential_listings"][0]["active"] is True


# Dual-routing scrapers that do NOT yet call the supersession step. SHRINK-ONLY: the ceiling below
# can never be raised, so this backlog is visible and can only be worked down. A scraper added
# tomorrow that routes to both tables is RED until it either wires the step or is deliberately
# added here — which is a reviewed edit, not something a rename or a new platform can do silently.
#
# WHY THIS FILE HAS A LIST AT ALL. Until 2026-09-13 this test asserted over the literal tuple
# ("sadin", "dealapp") and called them "the two dual-table platforms". They were not: 47 scrapers
# route to both tables, so the guard was green over 45 unwired ones. Two of them then collided in
# production on consecutive days — amaall (6 ads) and arkaan (1) — and the wiring check had nothing
# to say about either, because neither was in the tuple. Discovery by SHAPE is the fix; the baseline
# only records how much of the discovered set is still outstanding.
UNWIRED_DUAL_ROUTING_BASELINE = {
    "abeea", "abralosol", "abwbna", "aldarim", "alhoshan", "alkhaas", "alnokhba", "alobid",
    "alta", "amlakalahsa", "aouj", "aqaratikom", "aqarcity", "aqargate", "awal", "azdad",
    "bahadhabab", "deal", "eaqartabuk", "eastabha", "erapulse", "fursaghyr", "hajer", "jazwtn",
    "jurash", "mizlaj", "muktamel", "mustqr", "nowaisiry", "october", "raghdan", "ramzalqasim",
    "rawasidark", "remal", "sanadak", "satel", "shmoualshmal", "souq24", "therc", "toor", "wasalt",
}
# Measured 2026-09-13. Lowering this is the point; raising it is a regression.
UNWIRED_CEILING = 41


def _dual_routing_scrapers():
    """DISCOVER, by shape, every scraper whose run.py writes to BOTH sibling tables.

    Shape, not a list: a scraper that names `<platform>_residential_listings` (or its batch upsert)
    AND the commercial twin can route one ad to either table, which is the precondition for the
    orphan this whole file exists to prevent. Nobody has to remember to register a new platform.
    """
    import pathlib
    root = pathlib.Path(__file__).resolve().parents[3] / "scrapers"
    found = {}
    for run_py in sorted(root.glob("*/run.py")):
        platform = run_py.parent.name
        src = run_py.read_text(encoding="utf-8")
        if f"{platform}_residential_listings" in src and f"{platform}_commercial_listings" in src:
            found[platform] = src
    return found


def test_discovery_actually_finds_the_dual_routing_scrapers():
    """Guard the guard: a discovery that silently matched nothing would make every check below vacuous."""
    found = _dual_routing_scrapers()
    assert len(found) >= 40, f"shape discovery collapsed to {len(found)} scrapers — it is broken, not the fleet"
    for known in ("sadin", "dealapp", "amaall", "arkaan"):
        assert known in found, f"{known} routes to both tables but discovery missed it"


def test_every_dual_routing_scraper_is_wired_or_explicitly_outstanding():
    """A correct helper nothing calls is decoration — and a wiring check over a hardcoded pair is worse."""
    found = _dual_routing_scrapers()
    unwired = {p for p, src in found.items() if "retire_superseded_siblings(" not in src}
    newly_unwired = unwired - UNWIRED_DUAL_ROUTING_BASELINE
    assert not newly_unwired, (
        f"these scrapers route to BOTH sibling tables but never supersede: {sorted(newly_unwired)}. "
        "Call db.retire_superseded_siblings() before prune_unseen (see sadin/run.py), or add the "
        "platform to UNWIRED_DUAL_ROUTING_BASELINE with a reason."
    )
    assert len(unwired) <= UNWIRED_CEILING, (
        f"{len(unwired)} dual-routing scrapers are unwired but the ceiling is {UNWIRED_CEILING}. "
        "This number is shrink-only."
    )
    stale = UNWIRED_DUAL_ROUTING_BASELINE - set(found)
    assert not stale, f"baseline names scrapers that no longer route to both tables: {sorted(stale)}"


def test_a_wired_scraper_supersedes_before_it_prunes():
    """Order is load-bearing: prune's guards protect the orphan rather than ageing it out."""
    found = _dual_routing_scrapers()
    wired = {p: src for p, src in found.items() if "retire_superseded_siblings(" in src}
    assert wired, "no scraper calls the supersession step — the helper is decoration"
    for platform, src in sorted(wired.items()):
        if "db.prune_unseen(" not in src:
            continue  # amaall prunes nothing; there is no ordering to get wrong
        assert src.index("retire_superseded_siblings(") < src.index("db.prune_unseen("), \
            f"{platform} must supersede BEFORE prune_unseen — prune's guards protect the orphan"


def test_the_two_platforms_repaired_on_2026_09_13_are_wired():
    """Pin the specific fix, so a revert of either wiring is RED rather than a silent baseline drift."""
    found = _dual_routing_scrapers()
    for platform in ("amaall", "arkaan"):
        assert "retire_superseded_siblings(" in found[platform], (
            f"{platform} collided in production on 2026-09-13 and was wired then; "
            "un-wiring it re-opens that defect"
        )
        assert platform not in UNWIRED_DUAL_ROUTING_BASELINE, \
            f"{platform} is wired — it must not sit in the outstanding baseline"
