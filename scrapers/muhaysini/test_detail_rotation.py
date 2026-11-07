"""muhaysini: the walk reaches the end of the catalogue, and every listed ad is read in full within k nights.

🔧 2026-11-07. MAX_PAGES = 400 (12,000 rows) was hit every night from 11-02: the catalogue held ~20,000, so
~8,000 live ads were never re-read (served_price_never_rechecked; 6,950 active rows unseen > 10 days) and the
walk never reached its end, so nothing was ever pruned. The page cap is lifted and the slow detail read is
spread by detail_plan(). Runs the REAL function. CI runs this file as a script (one interpreter per file).
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.muhaysini import run as R  # noqa: E402

assert R.MAX_PAGES * R.PAGE_SIZE >= 40_000, "the page cap must clear today's ~20,000-ad catalogue with room"

ids = [str(i) for i in range(1, 20_001)]
budget = 12_000
k = math.ceil(len(ids) / budget)
read: set[str] = set()
for day in range(20_400, 20_400 + k):
    tonight = R.detail_plan(ids, budget, day)
    assert len(tonight) == budget, f"night {day}: read {len(tonight)}, budget {budget}"
    assert tonight <= set(ids), "a plan may only pick listed ids"
    read |= tonight
assert read == set(ids), f"{len(set(ids) - read)} listed ads were never read in full within {k} nights"

# Near the budget boundary (CodeRabbit #11136: an oversized hash bucket starved ids), and odd sizes.
for n_ids, b in ((4, 2), (5, 2), (12_001, 12_000), (23_999, 12_000), (7, 3)):
    some = [str(i) for i in range(n_ids)]
    kk = math.ceil(n_ids / b)
    for start_day in (0, 1, 20_401):
        got: set[str] = set()
        for d in range(start_day, start_day + kk):
            night = R.detail_plan(some, b, d)
            assert len(night) == b, (n_ids, b, d, len(night))
            got |= night
        assert got == set(some), f"n={n_ids} budget={b} from day {start_day}: {len(set(some) - got)} starved"

small = ids[:500]
assert R.detail_plan(small, budget, 7) == set(small), "a catalogue under the budget is read in full every night"
assert R.detail_plan(ids, 0, 7) == set(ids), "budget 0 means no limit"
print(f"✓ muhaysini: cap {R.MAX_PAGES * R.PAGE_SIZE:,} rows; every one of {len(ids):,} ads read within {k} nights")
