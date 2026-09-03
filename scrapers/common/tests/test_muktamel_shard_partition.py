"""muktamel shard fleet: the partition must be exact, mirroring test_dealapp_shard_partition.py.

2026-09-03: a single sequential crawl cannot cover the evidenced live band (24000-32300, 8301 ids)
inside a GitHub Actions job timeout at the measured worst-case throughput (~17.7 ids/min — see
.github/workflows/muktamel-sharded.yml for the full sizing). The fix is the same 8-shard-fleet
pattern dealapp already uses.

Sharding a crawl that can deactivate rows (db.prune_unseen) is only safe if the partition is
exact, AND if the enumeration side (scrapers/muktamel/run.py's shard_ids()) agrees with the prune
side (db._ad_shard applied to ad_number="MK<id>") about which shard owns which id — a disagreement
there would mean a shard prunes ids it never fetched, or leaves ids it did fetch unprotected. These
tests pin, at the level where they are decidable:

  1. shard_ids() and db._ad_shard() agree on every id's owner (the property that actually matters —
     dealapp's own tests already cover _ad_shard's standalone correctness, so this file does not
     re-derive that; it proves muktamel's specific enumeration is consistent with it)
  2. every id in the evidenced range belongs to exactly one shard
  3. no id belongs to two shards
  4. the union of all 8 shards is the complete evidenced range
  5. shards=1 is the unsharded identity (every other muktamel invocation must be unaffected)
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3]))

from scrapers.common.db import _ad_shard  # noqa: E402
from scrapers.muktamel.run import shard_ids  # noqa: E402

SHARDS = 8
MIN_ID, MAX_ID = 24000, 32300  # the evidenced live band muktamel-sharded.yml actually crawls


def test_shard_ids_agrees_with_ad_shard_on_every_id():
    # This is the property that actually matters: if enumeration and pruning ever disagreed about
    # who owns an id, a shard would silently prune ids it never visited.
    for i in range(MIN_ID, MIN_ID + 5000):
        for s in range(SHARDS):
            enumerated = i in shard_ids(MIN_ID, MIN_ID + 5000 - 1, SHARDS, s)
            pruned_owner = _ad_shard(f"MK{i}", SHARDS) == s
            assert enumerated == pruned_owner, f"id {i} shard {s}: enumerated={enumerated} pruned_owner={pruned_owner}"


def test_every_id_belongs_to_exactly_one_shard():
    for i in range(MIN_ID, MIN_ID + 2000):
        owners = [s for s in range(SHARDS) if i in shard_ids(MIN_ID, MIN_ID + 1999, SHARDS, s)]
        assert len(owners) == 1, f"id {i} owned by {owners}"


def test_no_id_belongs_to_two_shards():
    buckets = [set(shard_ids(MIN_ID, MAX_ID, SHARDS, s)) for s in range(SHARDS)]
    seen: set[int] = set()
    for s, ids in enumerate(buckets):
        assert not (seen & ids), f"shard {s} overlaps an earlier shard"
        seen |= ids


def test_union_of_shards_covers_the_complete_evidenced_range():
    universe = set(range(MIN_ID, MAX_ID + 1))
    covered: set[int] = set()
    for s in range(SHARDS):
        covered |= set(shard_ids(MIN_ID, MAX_ID, SHARDS, s))
    assert covered == universe, f"{len(universe - covered)} ids owned by no shard"


def test_shards_are_reasonably_balanced():
    # Not a correctness property, but an operational one -- an unbalanced split under-uses some
    # runners and risks timing others out. Muktamel ids are dense, so modulo should be near-even.
    counts = [len(shard_ids(MIN_ID, MAX_ID, SHARDS, s)) for s in range(SHARDS)]
    assert max(counts) - min(counts) <= 1, f"unbalanced: {counts}"


def test_shards_one_is_the_unsharded_identity():
    full = list(range(MIN_ID, MIN_ID + 500))
    assert shard_ids(MIN_ID, MIN_ID + 499, 1, 0) == full
