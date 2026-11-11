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

assert R.MAX_PAGES * R.PAGE_SIZE >= 80_000, "the page cap must clear today's ~44,000-ad catalogue with room"


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

# ≤ 1 request/second between request STARTS, whatever the latency (CodeRabbit #11136): a fake clock drives
# the REAL _pace with instant responses, then with slow ones.
for latency in (0.0, 0.2, 1.5):
    clock = {"t": 1000.0}
    starts: list[float] = []

    def now():
        return clock["t"]

    def sleep(dt):
        clock["t"] += dt

    R._last_start[0] = 0.0
    for _ in range(50):
        R._pace(now=now, sleep=sleep)
        starts.append(clock["t"])
        clock["t"] += latency                       # the request itself
    gaps = [b - a for a, b in zip(starts, starts[1:])]
    assert min(gaps) >= R.MIN_INTERVAL - 1e-9, (latency, min(gaps))
assert R.MIN_INTERVAL >= 1.0
src = Path(R.__file__).read_text()
assert "_pace()\n        try:\n            r = s.get(" in src, "every GET (and every retry) must be paced"
assert src.count("r = s.get(") == 1 and src.count("return self._s.get(") == 1, "a new GET call site must be paced too"

# The prune's liveness probe + canary (http_liveness.LivenessProbe calls session().get() itself) share the limiter.
assert "session=paced_session," in src, "the verify_gone probe must use the paced session"
calls = []
R._pace, _real_pace = (lambda: calls.append("pace")), R._pace
try:
    class _S:
        def get(self, *a, **k):
            calls.append("get")
            return "resp"
    assert R._Paced(_S()).get("u") == "resp" and calls == ["pace", "get"], calls
finally:
    R._pace = _real_pace
# The cursor (a DB read that raises on failure) is read only when the budget actually limits the night.
assert not R.needs_cursor(0, 500) and not R.needs_cursor(-1, 500), "a nonpositive budget is «no limit»"
assert not R.needs_cursor(500, 500) and not R.needs_cursor(600, 500), "a budget covering the list needs no cursor"
assert R.needs_cursor(100, 500)
assert "stored_last_read() if needs_cursor(DETAIL_BUDGET, len(listed_ids)) else {}" in src

# ── 2026-11-10: one unanswered request is retried, never the end of the night ───────────────────────
# Run 101583 (2026-11-08) died 62 minutes in on ONE curl-28 timeout and wrote 0 rows. _get_json is EXECUTED
# against a session that raises the real curl_cffi error: once → the call succeeds; every time → RuntimeError
# (which fetch_detail turns into a counted miss), never the raw transport error.
class _Resp:
    status_code = 200
    headers: dict = {}

    def json(self):
        return {"property": {"id": "7"}}


class _Flaky:
    def __init__(self, fail):
        self.fail, self.calls = fail, 0

    def get(self, *a, **k):
        self.calls += 1
        if self.calls <= self.fail:
            raise R.cc.RequestsError("curl: (28) Operation timed out after 45002 milliseconds with 0 bytes received")
        return _Resp()


_rp, _rs = R._pace, R.time.sleep
R._pace, R.time.sleep = (lambda: None), (lambda *_: None)
try:
    one = _Flaky(1)
    assert R._get_json(one, "u", what="list page 9") == {"property": {"id": "7"}} and one.calls == 2
    dead = _Flaky(99)
    try:
        R._get_json(dead, "u", what="list page 9")
        raise AssertionError("a request that never answers must end as RuntimeError")
    except RuntimeError as e:
        assert "no response in 4 tries" in str(e) and dead.calls == 4, (str(e), dead.calls)
    assert R.fetch_detail(_Flaky(1), "7") == {"id": "7"} and R.fetch_detail(_Flaky(99), "7") is None
finally:
    R._pace, R.time.sleep = _rp, _rs

# ── 2026-11-10: the run ends itself before the 240-minute CI kill ───────────────────────────────────
assert not R.past_detail_deadline(204.9 * 60, 0.0, 205) and R.past_detail_deadline(205 * 60, 0.0, 205)
assert not R.past_detail_deadline(10**9, 0.0, 0), "a nonpositive limit is «no limit»"
assert 0 < R.DETAIL_DEADLINE_MIN <= 210, "the detail deadline must leave the writes and the prune room inside 240 min"
assert "past_detail_deadline(time.monotonic(), _PROCESS_START, DETAIL_DEADLINE_MIN)" in src
assert 'seen_not_read.add(f"{PREFIX}{pid}")' in src, "a deadline-cut ad stays SEEN — it is never a prune candidate"
print("✓ muhaysini: request starts ≥ 1 s apart at any latency, prune probe included")
