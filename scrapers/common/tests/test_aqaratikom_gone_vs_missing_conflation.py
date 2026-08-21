"""aqaratikom's detail-loss guard must not conflate "gone (404)" with "genuinely uncaptured"
(follow-up to senior run #25 / PR #721, 2026-08-20/21).

THE DEFECT
----------
`fetch_detail` (scrapers/aqaratikom/run.py) used to return a bare `Optional[dict]`: `None` for a
TERMINAL 404 (the ad no longer exists — explicitly documented as "not a capture failure") AND
`None` for a genuinely exhausted retry after 3 attempts on any non-404 failure. The caller could
not tell these apart:

    det = fetch_detail(ad.get("id"))
    detail_stats["ok" if det else "missing"] += 1

so EVERY 404 silently inflated `detail_stats["missing"]` exactly like a real capture failure,
directly contradicting the function's own comment ("A 404 is NOT counted as a failure"). Production
evidence: four runs since #721 landed in an 18.0%-20.1% "missing" band on a stable ~139-ad catalog
(scrape_runs ids 30867/31398/31741/31959), and the 2026-08-20 run (id 31959) tripped the RC-B guard
(`AQARATIKOM_MAX_DETAIL_MISS_FRAC=0.20`) at exactly 20.1% — with zero visibility into how much of
that was normal churn (ads sold/delisted between the list fetch and the detail fetch) versus a real
regression, because the two were never counted separately.

THE FIX
-------
`fetch_detail` now returns `(status, record)` with status in {"ok", "gone", "missing"}. The 404
branch is tagged "gone"; the exhausted-retry branch is tagged "missing". `main()`'s detail_stats
tally becomes 3-way (`{"ok", "gone", "missing"}`), and the loss ratio is recomputed as
`d_total = d_ok + d_missing` / `d_frac = d_missing / d_total` — "gone" ads are excluded from BOTH
the numerator and the denominator, so normal churn can no longer, by itself, trip the guard. A
genuine capture-loss regression (non-404 failures piling up) still trips it exactly as before.

This test proves BOTH directions end-to-end through `fetch_detail`'s real HTTP-retry state machine
(mocked at the session layer, exactly like the sibling test file), aggregated with the identical
formula `main()` uses (mirrored here since that accounting lives inline in `main()`, not a separate
importable function):

  1. A batch that is ALL terminal-404 churn must NOT be able to trip the guard (d_total == 0,
     d_frac == 0.0) — this is the exact false-positive this fix closes.
  2. A batch of genuine non-404 capture failures of the SAME size still trips the guard — proving
     the fix did not make the RC-B guard toothless.
  3. A mixed batch (the realistic shape) shows "gone" correctly excluded from d_frac's denominator,
     so the same absolute number of real failures produces a HIGHER (more honest) d_frac once churn
     is no longer diluting/inflating the count incorrectly — the exact accounting bug this closes.

Run: python -m pytest scrapers/common/tests/test_aqaratikom_gone_vs_missing_conflation.py -v

PROVEN RED ON THE PARENT COMMIT: `fetch_detail` there returns a bare `Optional[dict]`, so
`status, det = aq.fetch_detail(...)` raises `TypeError: cannot unpack non-iterable NoneType /
dict object` on every single call in every test below — all 3 tests below fail/error against
git rev 14e973b (pre-fix HEAD). They pass cleanly against this fix.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.aqaratikom import run as aq  # noqa: E402


class _Resp:
    def __init__(self, status: int, payload=None):
        self.status_code = status
        self._payload = payload

    def json(self):
        return self._payload


class _FakeSession:
    """Serves one canned response per ad_id, keyed by the URL's trailing uuid."""

    def __init__(self, by_id: dict):
        self._by_id = dict(by_id)
        self.calls = 0

    def get(self, url, timeout=None):
        self.calls += 1
        ad_id = url.rsplit("/", 1)[-1]
        return self._by_id[ad_id]


GOOD_DETAIL = {"data": {"id": "x", "type": "rent", "subtype": "سنوي", "price": "85,000",
                        "estate": {"area": 100, "category": "شقة"}}}
GONE = _Resp(404, {"message": "No query results for model [Ad]"})
BLOCKED = _Resp(200, {"message": "Unauthenticated."})  # never resolves to `data` → exhausts retries


@pytest.fixture(autouse=True)
def _no_sleep_no_throttle(monkeypatch):
    monkeypatch.setattr(aq.time, "sleep", lambda *_a, **_k: None)
    monkeypatch.setattr(aq, "_throttle", lambda: None)


def _run_batch(monkeypatch, ad_ids: list[str], resp_for_id) -> dict:
    """Fetch every ad_id through the REAL fetch_detail() and aggregate exactly like main() does
    (scrapers/aqaratikom/run.py, the detail_stats tally + d_total/d_frac block)."""
    fake = _FakeSession({aid: resp_for_id(aid) for aid in ad_ids})
    monkeypatch.setattr(aq, "_session", lambda: fake)

    stats = {"ok": 0, "gone": 0, "missing": 0}
    for aid in ad_ids:
        status, _det = aq.fetch_detail(aid)
        stats[status] += 1

    d_ok, d_gone, d_missing = stats["ok"], stats["gone"], stats["missing"]
    d_total = d_ok + d_missing  # mirrors run.py: "gone" excluded from both parts of the ratio
    d_frac = (d_missing / d_total) if d_total else 0.0
    return {"ok": d_ok, "gone": d_gone, "missing": d_missing, "d_total": d_total, "d_frac": d_frac}


MAX_FRAC = 0.20  # AQARATIKOM_MAX_DETAIL_MISS_FRAC default


def _detail_collapsed(agg: dict) -> bool:
    return agg["d_total"] >= 20 and agg["d_frac"] > MAX_FRAC


# ── 1. Pure churn must never trip the guard ───────────────────────────────────────────────────────
def test_all_404_churn_cannot_trip_the_guard(monkeypatch):
    """30 ads, every single one a terminal 404 (sold/delisted between list and detail fetch). Under
    the OLD conflated accounting this would have been detail_stats={"missing": 30}, d_frac=1.0,
    tripping the guard on pure normal churn with zero real capture loss. Post-fix: d_total==0
    (nothing was actually ATTEMPTED-and-lost), d_frac==0.0, guard stays green."""
    ad_ids = [f"gone-{i}" for i in range(30)]
    agg = _run_batch(monkeypatch, ad_ids, lambda _aid: GONE)
    assert agg == {"ok": 0, "gone": 30, "missing": 0, "d_total": 0, "d_frac": 0.0}
    assert not _detail_collapsed(agg), "30/30 terminal 404s must never trip the RC-B guard"


# ── 2. Real capture loss of the same size still trips the guard — the fix is not toothless ─────────
def test_same_size_batch_of_real_failures_still_trips_the_guard(monkeypatch):
    """Same 30-ad batch size, but every ad is a genuine non-404 failure (3 exhausted retries each).
    This MUST still trip the guard exactly as before the fix."""
    ad_ids = [f"blocked-{i}" for i in range(30)]
    agg = _run_batch(monkeypatch, ad_ids, lambda _aid: BLOCKED)
    assert agg["gone"] == 0
    assert agg["missing"] == 30
    assert agg["d_total"] == 30
    assert agg["d_frac"] == 1.0
    assert _detail_collapsed(agg), "30/30 genuine capture failures must still trip the RC-B guard"


# ── 3. Realistic mixed batch: churn excluded, real loss measured honestly ──────────────────────────
def test_mixed_batch_excludes_gone_from_both_numerator_and_denominator(monkeypatch):
    """139-ad-shaped batch: 111 ok, 20 gone(404, normal churn), 8 genuinely missing. Under the OLD
    conflated accounting: detail_stats = {"ok": 111, "missing": 28} (20 gone + 8 missing folded
    together) → d_frac = 28/139 = 20.1% → TRIPS the guard (this is exactly what happened in
    production on 2026-08-20, scrape_runs id 31959). Under the FIX: d_total = 111 + 8 = 119,
    d_frac = 8/119 = 6.7% → guard stays green, and the number now means what it claims to mean."""
    ad_ids = ([f"ok-{i}" for i in range(111)]
              + [f"gone-{i}" for i in range(20)]
              + [f"blocked-{i}" for i in range(8)])

    def resp_for(aid: str):
        if aid.startswith("ok-"):
            return GOOD_DETAIL_RESP
        if aid.startswith("gone-"):
            return GONE
        return BLOCKED

    global GOOD_DETAIL_RESP
    GOOD_DETAIL_RESP = _Resp(200, GOOD_DETAIL)

    agg = _run_batch(monkeypatch, ad_ids, resp_for)
    assert agg == {"ok": 111, "gone": 20, "missing": 8, "d_total": 119,
                    "d_frac": pytest.approx(8 / 119)}
    assert agg["d_frac"] < MAX_FRAC, "6.7% real loss must stay under the 20% floor"
    assert not _detail_collapsed(agg)

    # Show the counterfactual explicitly: what the OLD (conflated) code would have computed on the
    # exact same underlying outcomes — this is the false positive the fix closes.
    old_missing = agg["gone"] + agg["missing"]           # old code: every non-ok counted as missing
    old_total = agg["ok"] + old_missing
    old_frac = old_missing / old_total
    assert old_total == 139 and old_missing == 28
    assert old_frac == pytest.approx(0.201, abs=0.001), "matches the real 2026-08-20 20.1% figure"
    assert old_total >= 20 and old_frac > MAX_FRAC, (
        "the OLD accounting on these exact outcomes WOULD have tripped the guard — this is the "
        "false positive the fix closes"
    )
