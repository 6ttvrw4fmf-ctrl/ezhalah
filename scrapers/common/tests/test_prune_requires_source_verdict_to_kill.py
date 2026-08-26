"""Guards for `db.prune_unseen(..., verify_gone=...)` — the source re-probe that must happen
BEFORE a listing is deactivated for being missing from the crawl.

THE INCIDENT THIS PREVENTS (2026-08-24 data-integrity run, measured — not hypothetical).
Aqar City's sitemap.xml publishes a ~1,799-entry WINDOW, but the site keeps serving listings outside
it. So a live listing misses three consecutive crawls not because it is gone, but because it is
un-enumerable. Every existing guard behaved correctly and none of them could see it:
  • coverage read ~99.6%, far above the 0.80 partial-scrape floor;
  • the 30% collapse guard was never approached (a handful of rows per crawl);
  • the 3-strike counter did exactly what it was told.
Result: 252 aqarcity + 9 abeea listings deactivated over 30 days, and a direct fetch found
**261 of 261 still served by the source**. They were restored with per-row evidence in
`ops_stale_inactivation_probe`.

The lesson, which is DATA_INTEGRITY_ENGINEER.md §4 restated: absence from the crawl is evidence of
absence from the INDEX, never evidence the listing is dead — and that does not become true by
repeating it three times. The guards above all protect against a BROKEN crawl; this was a PERFECT
crawl of an INCOMPLETE index, which has an identical signature and the opposite meaning.

So when a platform supplies an oracle, only the SOURCE's verdict may deactivate:
  gone → kill · live → self-heal (missing_count 0, last_seen_at refreshed) · unknown → hold.

    python -m pytest scrapers/common/tests/test_prune_requires_source_verdict_to_kill.py -q
"""
from __future__ import annotations

import sys
import types

import pytest

# ── Hermetic import: stub supabase + dotenv so db.py imports with no credentials/network ─────────
_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.common import db  # noqa: E402


# ── A fake PostgREST client that records every update payload + the ad_numbers it targeted ───────
class _Q:
    def __init__(self, sink, table):
        self._sink, self._table = sink, table
        self._payload = None

    # read path
    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    # write path
    def update(self, payload):
        self._payload = payload
        return self

    def in_(self, _col, ads):
        self._sink.append((self._table, dict(self._payload), list(ads)))
        return self

    def execute(self):
        return types.SimpleNamespace(data=self._sink_rows if hasattr(self, "_sink_rows") else [])


class _Client:
    def __init__(self, sink, existing):
        self._sink, self._existing = sink, existing

    def table(self, name):
        q = _Q(self._sink, name)
        q._sink_rows = self._existing
        return q


ACTIVE = [
    {"ad_number": "AC1", "missing_count": 2},   # at grace-1 → this crawl would kill it
    {"ad_number": "AC2", "missing_count": 2},
    {"ad_number": "AC3", "missing_count": 2},
    {"ad_number": "AC4", "missing_count": 0},   # only ticking up, must never be probed
] + [{"ad_number": f"AC{i}", "missing_count": 0} for i in range(10, 60)]

# Everything except AC1..AC4 is re-seen, so coverage stays high and the collapse guard is nowhere
# near tripping — exactly the aqarcity shape.
SEEN = {r["ad_number"] for r in ACTIVE} - {"AC1", "AC2", "AC3", "AC4"}


@pytest.fixture
def wired(monkeypatch):
    sink: list = []
    monkeypatch.setattr(db, "sb", lambda: _Client(sink, ACTIVE))
    monkeypatch.setattr(db, "_execute", lambda q, what=None: q.execute())
    return sink


def _kills(sink):
    """ad_numbers this run actually flipped to active=false."""
    out = []
    for _tbl, payload, ads in sink:
        if payload.get("active") is False:
            out += ads
    return out


def _selfhealed(sink):
    out = []
    for _tbl, payload, ads in sink:
        if payload.get("missing_count") == 0:
            out += ads
    return out


def test_live_verdict_blocks_the_kill_and_self_heals(wired):
    """THE REGRESSION. The source says all three are still served → none may be deactivated."""
    killed = db.prune_unseen("aqarcity_residential_listings", SEEN,
                             verify_gone=lambda ad: "live")
    assert killed == 0, (
        "prune_unseen deactivated a listing the source still serves — this is the 2026-08-24 "
        "incident (261/261 killed rows were live). Absence from the crawl is not death."
    )
    assert _kills(wired) == []
    assert sorted(_selfhealed(wired)) == ["AC1", "AC2", "AC3"], (
        "a listing the source still serves must have its strike count reset, or it is re-killed "
        "on the very next crawl"
    )


def test_gone_verdict_still_kills(wired):
    """The guard must not become a blanket amnesty — a source-confirmed removal still ages out."""
    killed = db.prune_unseen("aqarcity_residential_listings", SEEN,
                             verify_gone=lambda ad: "gone")
    assert killed == 3
    assert sorted(_kills(wired)) == ["AC1", "AC2", "AC3"]


def test_unknown_verdict_holds_and_never_kills(wired):
    """§4: timeout / 403 / 429 / 5xx / blocked is NOT proof of inactivity."""
    killed = db.prune_unseen("aqarcity_residential_listings", SEEN,
                             verify_gone=lambda ad: "unknown")
    assert killed == 0
    assert _kills(wired) == []
    assert _selfhealed(wired) == [], "an unreachable source must not reset the strike count either"


def test_oracle_that_raises_is_unknown_not_gone(wired):
    """A crashing oracle must fail CLOSED (hold), never open (kill)."""
    def _boom(_ad):
        raise RuntimeError("proxy exploded")

    killed = db.prune_unseen("aqarcity_residential_listings", SEEN, verify_gone=_boom)
    assert killed == 0
    assert _kills(wired) == []


def test_only_at_grace_rows_are_probed(wired):
    """A row merely ticking up costs no network call — the probe is for the kill decision only."""
    probed: list[str] = []

    def _spy(ad):
        probed.append(ad)
        return "gone"

    db.prune_unseen("aqarcity_residential_listings", SEEN, verify_gone=_spy)
    assert sorted(probed) == ["AC1", "AC2", "AC3"]
    assert "AC4" not in probed, "AC4 is at missing_count 0 → nowhere near grace; must not be fetched"


def test_mixed_verdicts_partition_the_batch(wired):
    """One batch, three outcomes — the kill list must contain ONLY the confirmed-gone rows."""
    verdicts = {"AC1": "gone", "AC2": "live", "AC3": "unknown"}
    killed = db.prune_unseen("aqarcity_residential_listings", SEEN,
                             verify_gone=lambda ad: verdicts[ad])
    assert killed == 1
    assert _kills(wired) == ["AC1"]
    assert _selfhealed(wired) == ["AC2"]


def test_without_an_oracle_behaviour_is_unchanged(wired):
    """Opt-in: platforms with no control-validated oracle keep the previous semantics exactly."""
    killed = db.prune_unseen("aqarcity_residential_listings", SEEN)
    assert killed == 3
    assert sorted(_kills(wired)) == ["AC1", "AC2", "AC3"]


# ── The wiring half: the two platforms proven affected must actually pass an oracle ───────────────
def test_aqarcity_and_abeea_pass_verify_gone_to_prune_unseen():
    from pathlib import Path
    repo = Path(__file__).resolve().parents[3]
    for platform in ("aqarcity", "abeea"):
        src = (repo / "scrapers" / platform / "run.py").read_text(encoding="utf-8")
        assert "verify_gone=_verify_gone" in src, (
            f"{platform}/run.py calls prune_unseen without a source oracle. Its listings were "
            f"PROVEN to survive falling out of the discovery index (2026-08-24); without the probe "
            f"they get deactivated while live."
        )
        assert 'return "unknown"' in src, (
            f"{platform}'s oracle must return 'unknown' on an unreachable source, never 'gone'"
        )


# ══════════════════════════════════════════════════════════════════════════════════════════════
# 2026-08-26: "I could not read the page" is not "the source deleted it"
# ══════════════════════════════════════════════════════════════════════════════════════════════
# The 2026-08-24 fix above made the SOURCE's verdict the only thing that may deactivate. It did not
# check what the oracle counts AS that verdict. aqarcity's `_probe_id()` returned one value,
# 'exists', for two conditions that mean opposite things:
#
#     if "هذا الإعلان منتهي" in r.text or "application/ld+json" not in r.text:
#         return "exists"
#
# and `_verify_gone()` mapped 'exists' → "gone". The first limb is the source's OWN expired banner
# (authoritative death). The second is "this page has no JSON-LD" — a PARSE condition. A Cloudflare
# interstitial, a partial render or a template change all serve HTTP 200 with neither banner nor
# JSON-LD, on a listing that is perfectly alive, and the row was deactivated for it.
#
# Measured that day: 254 aqarcity deactivations, 55/55 sampled carried the expired banner, so the
# live cohort was decided by the CORRECT limb and nothing was falsely killed. The defect was latent,
# not yet realised — which is exactly when it is cheapest to remove. §4/§26: unverifiable is its own
# verdict, and it means DO NOTHING.

def test_oracle_may_state_a_reason_and_it_is_recorded(wired):
    """A (verdict, reason) pair must be accepted, and the reason persisted as evidence."""
    killed = db.prune_unseen("aqarcity_residential_listings", SEEN,
                             verify_gone=lambda ad: ("gone", "source published «هذا الإعلان منتهي»"))
    assert killed == 3, "a (verdict, reason) tuple must decide exactly as the bare string does"
    assert sorted(_kills(wired)) == ["AC1", "AC2", "AC3"]


def test_bare_string_oracle_still_supported(wired):
    """Backward compatibility: abeea returns plain strings and must keep working untouched."""
    assert db.prune_unseen("aqarcity_residential_listings", SEEN,
                           verify_gone=lambda ad: "gone") == 3


def test_aqarcity_unparseable_page_is_unknown_never_gone():
    """THE REGRESSION. Drive the real aqarcity oracle mapping, not a stand-in.

    Fails on the pre-fix code, where 'exists' (no JSON-LD) mapped straight to "gone".
    """
    from pathlib import Path
    repo = Path(__file__).resolve().parents[3]
    src = (repo / "scrapers" / "aqarcity" / "run.py").read_text(encoding="utf-8")

    probe = src[src.index("def _probe_id"):src.index("def sequential_id_urls")]
    assert '"expired"' in probe, (
        "_probe_id must give the source's own «هذا الإعلان منتهي» banner its OWN return value. "
        "While the expired banner and 'page has no JSON-LD' share one value, the kill path cannot "
        "tell authoritative death from a page it merely failed to parse."
    )
    # The two conditions must no longer be OR-ed into a single return.
    assert 'or "application/ld+json" not in r.text' not in probe, (
        "the expired-banner check and the JSON-LD check are OR-ed back together — that is the "
        "2026-08-26 defect exactly: an unreadable page becomes indistinguishable from a dead one."
    )

    gone = src[src.index("def _verify_gone"):]
    gone = gone[:gone.index("pruned = 0")]
    assert '"exists"' in gone and "unknown" in gone.split('"exists"')[1][:200], (
        "aqarcity's _verify_gone must map 'exists' (real id, unparseable page) to UNKNOWN so the "
        "strike is held and nothing is deactivated. Mapping it to 'gone' deactivates live "
        "listings on a Cloudflare shell (§4: blocked ≠ inactive; §26: unverifiable means DO NOTHING)."
    )
    assert '("notfound", "exists")' not in gone, (
        "'exists' is back on the kill path alongside 'notfound' — the exact pre-fix mapping."
    )
