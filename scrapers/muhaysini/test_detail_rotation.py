"""muhaysini: the walk reaches the end of the catalogue, and every listed ad is read in full within k nights.

🔧 2026-11-07. MAX_PAGES = 400 (12,000 rows) was hit every night from 11-02: the catalogue held ~20,000, so
~8,000 live ads were never re-read (served_price_never_rechecked; 6,950 active rows unseen > 10 days) and the
walk never reached its end, so nothing was ever pruned. The page cap is lifted and the slow detail read is
spread by detail_plan(), whose cursor is each row's stored last_seen_at (oldest first). Runs the REAL
function, simulating nights in which the catalogue GROWS and SHRINKS (CodeRabbit #11136: a size-derived
position broke coverage when one ad was added). CI runs this file as a script (one interpreter per file).
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.muhaysini import run as R  # noqa: E402

assert R.MAX_PAGES * R.PAGE_SIZE >= 40_000, "the page cap must clear today's ~20,000-ad catalogue with room"


def simulate(n0: int, budget: int, nights: int, churn) -> None:
    """Nights of crawling with the real plan; `churn(night, ids)` returns tonight's listed ids. Every id
    listed on k consecutive nights must be read at least once in them, where k = ceil(max n / budget)."""
    stored: dict[str, str] = {}                     # id -> last read (the column the cursor reads)
    ids = [str(i) for i in range(n0)]
    history: list[tuple[list[str], set[str]]] = []
    for night in range(nights):
        ids = churn(night, ids)
        plan = R.detail_plan(ids, budget, {i: stored[i] for i in ids if i in stored})
        assert len(plan) == min(budget, len(ids)) or budget <= 0, (night, len(plan))
        assert plan <= set(ids), "a plan may only pick listed ids"
        for i in plan:
            stored[i] = f"2026-11-{night:04d}"          # sorts by night, like an ISO timestamp
        history.append((ids, plan))
    k = math.ceil(max(len(h[0]) for h in history) / budget)
    for start in range(len(history) - k + 1):
        window = history[start:start + k]
        always = set(window[0][0]).intersection(*(set(h[0]) for h in window))
        read = set().union(*(h[1] for h in window))
        starved = always - read
        assert not starved, f"n0={n0} budget={budget} nights {start}..{start + k - 1}: {len(starved)} starved"


simulate(20_000, 11_000, 6, lambda d, ids: ids)                                           # steady
simulate(20_000, 11_000, 6, lambda d, ids: ids + [f"n{d}"])                               # +1 a night
simulate(20_000, 11_000, 6, lambda d, ids: ids[300:] + [f"n{d}-{j}" for j in range(500)])  # churn
for n_ids, b in ((4, 2), (5, 2), (12_001, 12_000), (23_999, 12_000), (7, 3)):
    simulate(n_ids, b, 5, lambda d, ids: ids)

small = [str(i) for i in range(500)]
assert R.detail_plan(small, 11_000, {}) == set(small), "a catalogue under the budget is read in full every night"
assert R.detail_plan(small, 0, {}) == set(small), "budget 0 means no limit"
assert R.detail_plan(["1", "2", "3"], 2, {"1": "2026-11-07", "2": "2026-11-01"}) == {"2", "3"}, \
    "never-read and oldest-read ads go first"
print(f"✓ muhaysini: cap {R.MAX_PAGES * R.PAGE_SIZE:,} rows; every listed ad read within k nights, catalogue churn included")
