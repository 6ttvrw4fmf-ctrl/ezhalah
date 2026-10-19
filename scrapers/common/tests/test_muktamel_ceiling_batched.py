"""muktamel's ceiling walk probes CEILING_BATCH ids at once and must return exactly what the old
one-at-a-time walk returned.

2026-10-03: the sequential walk took 74 of a shard's 120 minutes (46 the night before), so every
shard was killed at its cap with the sweep unfinished. The batched walk must (1) give the same
ceiling for any pattern of assigned ids, including the broken-signal and backstop cases, and
(2) really overlap its probes, or it fixes nothing.
"""
import random
import sys
import threading
import time

sys.path.insert(0, ".")

import scrapers.muktamel.run as M  # noqa: E402


def sequential(floor, exists, *, stride=M.CEILING_STRIDE, give_up=M.CEILING_GIVE_UP,
               bound=M.CEILING_BOUND):
    """The walk exactly as it was before batching (reference oracle)."""
    if exists(M._NEVER_ASSIGNED_ID):
        return floor
    top, i = floor, floor + stride
    while i <= floor + bound and i - top <= give_up:
        if exists(i):
            top = i
        i += stride
    return top + stride - 1


def test_same_ceiling_as_the_sequential_walk_for_random_id_layouts():
    rng = random.Random(20261003)
    for _ in range(400):
        floor = rng.randrange(20_000, 40_000)
        span = rng.choice([0, 500, 2_000, 6_000, 60_000])
        assigned = {floor + rng.randrange(0, span + 1) for _ in range(rng.randrange(0, 40))}
        broken = rng.random() < 0.05
        exists = lambda i: (i == M._NEVER_ASSIGNED_ID and broken) or i in assigned  # noqa: E731
        for batch in (1, 3, 8, 13):
            for kw in ({}, {"stride": 50, "give_up": 700, "bound": 5_000}):
                assert M.find_ceiling(floor, exists, batch=batch, **kw) == sequential(floor, exists, **kw)


def test_tonights_shape_finds_34399():
    # 2026-10-03 log: floor 32300, highest assigned sampled id 34300 → «sweeping ids 24000..34399»
    assigned = set(range(32300, 34301, 100))
    assert M.find_ceiling(32300, lambda i: i in assigned) == 34399


def test_probes_really_overlap():
    live, peak, lock = [0], [0], threading.Lock()

    def slow(i):
        with lock:
            live[0] += 1
            peak[0] = max(peak[0], live[0])
        time.sleep(0.02)
        with lock:
            live[0] -= 1
        return False

    t = time.monotonic()
    M.find_ceiling(32300, slow)
    assert peak[0] >= M.CEILING_BATCH, f"probes ran {peak[0]} at a time, not {M.CEILING_BATCH}"
    # ~31 probes at 20 ms: sequential would be ≥ 0.6 s; batched is a handful of rounds
    assert time.monotonic() - t < 0.4
