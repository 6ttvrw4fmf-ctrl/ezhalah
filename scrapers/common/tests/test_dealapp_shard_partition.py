"""dealapp shard fleet: the partition must be exact, and a broken shard must not prune.

Owner-approved 2026-08-11 (option b). dealapp's single capped crawl re-saw ~2,024 of 8,386 active
rows a week (~25%), so `prune_unseen`'s 0.80 coverage floor tripped EVERY night — nothing was ever
aged out, and 3,976 residential rows (49.6%) sat 7-day stale. The fix is a 12-shard fleet, sized
from measured throughput (8.3 rows/min worst observed → 699 rows/shard → 84 min inside a 120-min
timeout, 30% headroom).

Sharding a crawl that can deactivate rows is only safe if the partition is exact. These tests pin
the five properties the owner asked the barrier to prove, at the level where they are decidable —
the shard key itself — plus the two prune guards that stop a bad shard cascading:

  1. every id belongs to exactly one shard
  2. no id belongs to two shards
  3. the union of all shards is the complete id space
  4. one failed/blocked shard cannot deactivate another shard's rows
  5. a 0-row shard prunes nothing at all

Properties 1-3 are properties of modulo, not of a schedule, so they cannot drift — which is exactly
why the key is `int(ad_number) % shards` and not a range/geometric split. aqar's original geometric
split handed shard 0 81% of the rows (bug B1, 2026-07-16); a hash cannot do that.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3]))

from scrapers.common.db import _ad_shard  # noqa: E402

SHARDS = 12


def test_every_id_belongs_to_exactly_one_shard():
    for i in range(5000):
        owners = [s for s in range(SHARDS) if _ad_shard(str(i), SHARDS) == s]
        assert len(owners) == 1, f"id {i} owned by {owners}"


def test_no_id_belongs_to_two_shards():
    # Restated as a partition of a realistic id space: the per-shard sets must be pairwise disjoint.
    buckets = {s: set() for s in range(SHARDS)}
    for i in range(20000, 25000):
        buckets[_ad_shard(str(i), SHARDS)].add(i)
    seen = set()
    for s, ids in buckets.items():
        assert not (seen & ids), f"shard {s} overlaps an earlier shard"
        seen |= ids


def test_union_of_shards_covers_the_whole_id_space():
    universe = {str(i) for i in range(7000, 12000)}
    covered = set()
    for s in range(SHARDS):
        covered |= {i for i in universe if _ad_shard(i, SHARDS) == s}
    assert covered == universe, f"{len(universe - covered)} ids owned by no shard"


def test_shards_are_balanced():
    # Not a correctness property, but an operational one: an unbalanced split is what timed aqar's
    # shard 0 out every day. dealapp ids are dense, so modulo should be near-perfectly even.
    counts = [0] * SHARDS
    for i in range(100000, 108386):          # ~ the real active inventory size
        counts[_ad_shard(str(i), SHARDS)] += 1
    assert max(counts) - min(counts) <= 1, f"unbalanced: {counts}"


def test_zero_padded_and_bare_ids_collapse_to_the_same_shard():
    # The crawl canonicalises ids with str(int(...)); the prune reads raw ad_number strings. If the
    # two disagreed on a zero-padded id, a shard would prune a row it never fetched.
    for raw, bare in (("0004512", "4512"), ("00099", "99"), ("120345", "120345")):
        assert _ad_shard(raw, SHARDS) == _ad_shard(bare, SHARDS)


def test_non_numeric_ad_number_belongs_to_no_shard():
    # Must be None, not 0 — otherwise every junk id silently becomes shard 0's problem and shard 0
    # would age out rows no crawl ever visits.
    assert _ad_shard("", SHARDS) is None
    assert _ad_shard(None, SHARDS) is None
    assert _ad_shard("abc", SHARDS) is None


def test_shards_one_is_the_unsharded_identity():
    # The default path must keep mapping everything into the single shard 0.
    for i in (1, 999, 123456):
        assert _ad_shard(str(i), 1) == 0


# ── the two prune guards that stop a bad shard cascading ────────────────────────────────────────

class _FakeExec:
    def __init__(self, data):
        self.data = data


def _install_fake_db(monkeypatch, active_rows, captured):
    """Minimal supabase stub: prune_unseen selects active rows, then issues update batches."""
    import scrapers.common.db as db

    class _Q:
        def select(self, *a, **k): return self
        def eq(self, *a, **k): return self
        def in_(self, col, vals): captured.setdefault("updated", []).extend(vals); return self
        def update(self, payload): captured["payload"] = payload; return self

    class _C:
        def table(self, name): return _Q()

    monkeypatch.setattr(db, "sb", lambda: _C())
    monkeypatch.setattr(db, "_execute",
                        lambda q, what=None: _FakeExec(active_rows if "prune_select" in (what or "") else []))
    return db


def test_a_shard_can_only_ever_touch_its_own_ids(monkeypatch):
    # 24 active rows spread over 12 shards; shard 3 runs and sees NONE of its own.
    # It must count misses only for ids 3 and 15 — never for any other shard's rows.
    rows = [{"ad_number": str(i), "missing_count": 2} for i in range(24)]
    captured: dict = {}
    db = _install_fake_db(monkeypatch, rows, captured)

    killed = db.prune_unseen("dealapp_residential_listings", {"999999"},
                             shards=12, shard=3, min_active_guard=99)
    touched = set(captured.get("updated", []))
    assert touched <= {"3", "15"}, f"shard 3 touched rows it does not own: {touched - {'3', '15'}}"
    assert killed >= 0


def test_a_blocked_shard_that_saw_nothing_prunes_nothing(monkeypatch):
    # The 0-row/blocked case the owner called out explicitly. 2 of the last 8 real dealapp runs
    # returned 0 rows (login-wall), so this is the live failure mode, not a hypothetical.
    rows = [{"ad_number": str(i), "missing_count": 2} for i in range(24)]
    captured: dict = {}
    db = _install_fake_db(monkeypatch, rows, captured)

    assert db.prune_unseen("dealapp_residential_listings", set(), shards=12, shard=3) == -1
    assert not captured.get("updated"), "a blocked shard must not touch a single row"


def test_unsharded_prune_is_unchanged(monkeypatch):
    # shards=1 must behave exactly as before for every other scraper that calls prune_unseen.
    rows = [{"ad_number": str(i), "missing_count": 0} for i in range(10)]
    captured: dict = {}
    db = _install_fake_db(monkeypatch, rows, captured)

    db.prune_unseen("dealapp_residential_listings", {str(i) for i in range(9)}, min_active_guard=99)
    assert set(captured.get("updated", [])) == {"9"}, "unsharded prune changed behaviour"
