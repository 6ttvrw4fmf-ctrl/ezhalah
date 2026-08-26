"""aqaratikom must recover the detail records the concurrent burst loses (senior run #60, 2026-08-25).

THE DEFECT
----------
`detail_ok` sat at 113±1 for TWELVE consecutive days while the aqaratikom catalogue grew 138 → 152
(scrape_runs 28617/29256/29806/30335/30867/31398/31741/31959/32609/32619/33258/33817/34568/35107).
A pinned ceiling is not a random failure rate: every ad added past ~113 was never captured at all,
and `detail_missing` grew 25 → 26 → 27 → 28 → 33 → 39 in lockstep with the catalogue.

The loss is real and it is the source's own data. Probing all 152 ids from an ordinary datacenter
IP on 2026-08-25 returned **152/152 HTTP 200 with a full record and ZERO 404s** — the source
publishes every one. Replaying the production request pattern (6 workers, 0.3s global interval)
showed the mechanism: per-request latency holds at ~1.06s through request ~110, then degrades ~4x
(4.17s at #120, 4.72s at #140). The source THROTTLES A BURST; it does not refuse the ad.

Two things then guaranteed the loss was permanent:

  1. `fetch_detail`'s 3 in-loop retries all fire inside that same throttled window, and every one
     of them was issued over the SAME thread-local Session — i.e. the same established HTTP/2
     connection the failure landed on. `scrapers/common/http.py::_rotate_session` (2026-08-21
     incident) and wasalt's RotatingSession already fixed exactly this shape elsewhere in the
     fleet; aqaratikom never got it.
  2. Since 2026-08-09 `db._unknown_must_not_overwrite_known` correctly DROPS an unread field rather
     than NULLing it, so a miss no longer destroys a stored value — but it also means a field that
     was NEVER captured is never repaired by a later run. Capturing it is the only way it arrives.

Measured user-visible damage against the live source on 2026-08-25 (152 active listings): 18
listings whose published bathrooms were NULL in Ezhalah, 18 halls, 26 street width, 16 lift, 16
kitchen, 18 driver room — and 9 Rent listings whose source publishes «سنوي» while `rent_period` was
NULL. A NULL period makes a rental unreachable under BOTH period chips. Zero values were WRONG:
this is a pure silent-drop of supported source data (AGENTS.md §10), not a fidelity error.

THE FIX
-------
  * `_rotate_session()` (mirroring `scrapers/common/http.py`) — a retry never reuses the connection
    that just failed.
  * `second_chance_details()` — after the concurrent pass finishes, re-fetch the missed ads
    SERIALLY with a real gap, i.e. outside the burst that caused the throttle. Recovered ads are
    re-mapped and re-upserted, and move from `missing` to `ok` in the run's own tally so the RC-B
    loss guard measures capture loss AFTER recovery.

Run: python -m pytest scrapers/common/tests/test_aqaratikom_second_chance_detail_recovery.py -v

PROVEN RED ON THE PARENT COMMIT (813ebb4): `second_chance_details` and `_rotate_session` do not
exist there, so every test below fails with AttributeError on import/use.
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


# A full detail record: this is what the source actually serves for every one of the 152 ids.
def _good(subtype: str = "سنوي") -> _Resp:
    return _Resp(200, {"data": {
        "id": "x", "type": "rent", "subtype": subtype, "price": "85,000",
        "estate": {"area": 130, "category": "شقة", "bedroom": 4, "city": "جدة",
                   "title": "شقة", "details": [
                       {"title": "عدد دورة المياه", "value": "3"},
                       {"title": "عدد الصالات", "value": "1"},
                       {"title": "عرض الشارع", "value": "10"},
                       {"title": "مصعد", "value": "نعم"},
                       {"title": "مطبخ", "value": "نعم"},
                       {"title": "غرفة السائق", "value": "لا"},
                   ]},
    }})


THROTTLED = _Resp(200, {"message": "Unauthenticated."})  # never resolves to `data` → burns retries


@pytest.fixture(autouse=True)
def _no_sleep_no_throttle(monkeypatch):
    monkeypatch.setattr(aq.time, "sleep", lambda *_a, **_k: None)
    monkeypatch.setattr(aq, "_throttle", lambda: None)
    monkeypatch.delenv("AQARATIKOM_SECOND_CHANCE_MAX", raising=False)
    monkeypatch.delenv("AQARATIKOM_SECOND_CHANCE_GAP", raising=False)
    monkeypatch.delenv("AQARATIKOM_SECOND_CHANCE_BUDGET_S", raising=False)


# ── 1. a retry must not reuse the connection that just failed ───────────────────────────────────
def test_fetch_detail_rotates_the_session_between_failed_attempts(monkeypatch):
    """The throttle symptom lands on an established connection; retrying over it fails identically.

    This is the fleet pattern from scrapers/common/http.py::_rotate_session (2026-08-21).
    """
    built: list[object] = []

    class _S:
        def __init__(self):
            built.append(self)
            self.calls = 0

        def get(self, url, timeout=None):
            self.calls += 1
            return THROTTLED

    monkeypatch.setattr(aq, "_build_session", _S)
    monkeypatch.setattr(aq._local, "s", None, raising=False)

    status, det = aq.fetch_detail("some-uuid")

    assert (status, det) == ("missing", None)
    # 3 attempts over 3 DIFFERENT sessions — not 3 attempts over one poisoned connection.
    # Exactly 3, not 4: the final attempt has no successor, so it must not build a session
    # nobody uses (same guard as scrapers/common/http.py::get).
    assert len(built) == 3, f"expected one fresh session per attempt, got {len(built)}"
    assert all(s.calls == 1 for s in built), [s.calls for s in built]


def test_a_successful_fetch_does_not_rotate(monkeypatch):
    """Rotation is a failure path only — the happy path must keep its keep-alive connection."""
    built: list[object] = []

    class _S:
        def __init__(self):
            built.append(self)

        def get(self, url, timeout=None):
            return _good()

    monkeypatch.setattr(aq, "_build_session", _S)
    monkeypatch.setattr(aq._local, "s", None, raising=False)

    status, _det = aq.fetch_detail("some-uuid")
    assert status == "ok"
    assert len(built) == 1, "a successful fetch must not throw away its connection"


# ── 2. the second-chance pass recovers what the burst lost ──────────────────────────────────────
def test_second_chance_recovers_ads_that_resolve_after_the_burst(monkeypatch):
    """The exact production shape: the tail fails during the burst and resolves once it is over."""
    missed = [{"id": f"uuid-{i}"} for i in range(39)]  # the 2026-08-25 tail, to the ad
    monkeypatch.setattr(aq, "fetch_detail", lambda _id: ("ok", _good()._payload["data"]))

    out = aq.second_chance_details(missed)

    assert len(out) == 39, "every ad the source still serves must be recovered"
    ads, dets = zip(*out)
    assert [a["id"] for a in ads] == [m["id"] for m in missed]
    # The recovered record carries the detail-ONLY fields — the whole point of the second call.
    dmap = aq._details_map(dets[0]["estate"])
    assert dmap["عدد دورة المياه"] == "3"
    assert dmap["عرض الشارع"] == "10"
    assert dets[0]["subtype"] == "سنوي"


def test_second_chance_recovers_the_rent_period_that_makes_a_rental_searchable(monkeypatch):
    """9 live Rent listings had rent_period NULL while the source published «سنوي» (2026-08-25).

    A NULL period is not a cosmetic gap: it makes the rental unreachable under BOTH period chips.
    Prove recovery all the way through map_listing to the stored column.
    """
    ad = {"id": "uuid-rent", "type": "rent", "price": "85,000", "is_sold": False}
    monkeypatch.setattr(aq, "fetch_detail", lambda _id: ("ok", _good("سنوي")._payload["data"]))

    (recovered_ad, det), = aq.second_chance_details([ad])
    row, category, _sold = aq.map_listing(recovered_ad, det)

    assert category == "residential"
    assert row["transaction_type"] == "Rent"
    assert row["rent_period"] == "annual", "the source published «سنوي» — it must reach the column"
    # …and the detail-only fields the summary alone can never supply:
    assert row["bathrooms"] == 3
    assert row["halls"] == 1
    assert row["street_width_m"] == 10
    assert row["elevator"] is True
    assert row["kitchen"] is True
    assert row["driver_room"] is False


def test_still_failing_ads_stay_missing_so_the_loss_guard_keeps_its_teeth(monkeypatch):
    """A genuinely unreachable ad must NOT be silently promoted to captured.

    The RC-B guard (AQARATIKOM_MAX_DETAIL_MISS_FRAC) measures loss AFTER recovery, so a source
    that is really broken still fails CI instead of being papered over by the retry pass.
    """
    missed = [{"id": f"uuid-{i}"} for i in range(30)]
    monkeypatch.setattr(aq, "fetch_detail", lambda _id: ("missing", None))

    assert aq.second_chance_details(missed) == []

    # main()'s tally only decrements `missing` for entries the pass RETURNS, so the ratio is
    # unchanged and the guard still trips at the same threshold.
    stats = {"ok": 100, "gone": 0, "missing": 30}
    for _ad, _det in aq.second_chance_details(missed):
        stats["missing"] -= 1
        stats["ok"] += 1
    d_total = stats["ok"] + stats["missing"]
    assert stats["missing"] / d_total > 0.20, "a dead source must still trip the RC-B guard"


def test_partial_recovery_moves_only_what_was_recovered(monkeypatch):
    """The realistic mixed case — some of the tail comes back, some does not."""
    missed = [{"id": f"uuid-{i}"} for i in range(10)]
    resolved = {"uuid-0", "uuid-3", "uuid-7"}
    monkeypatch.setattr(aq, "fetch_detail",
                        lambda i: ("ok", _good()._payload["data"]) if i in resolved
                        else ("missing", None))

    out = aq.second_chance_details(missed)
    assert {a["id"] for a, _ in out} == resolved

    stats = {"ok": 113, "gone": 0, "missing": 10}
    for _ad, _det in out:
        stats["missing"] -= 1
        stats["ok"] += 1
    assert stats == {"ok": 116, "gone": 0, "missing": 7}


def test_second_chance_is_bounded_so_a_dead_source_cannot_blow_the_ci_budget(monkeypatch):
    """The pass is serial; without a cap a fully-dead source would retry the whole catalogue."""
    monkeypatch.setenv("AQARATIKOM_SECOND_CHANCE_MAX", "5")
    seen: list[str] = []

    def _fd(i):
        seen.append(i)
        return "missing", None

    monkeypatch.setattr(aq, "fetch_detail", _fd)
    aq.second_chance_details([{"id": f"uuid-{i}"} for i in range(200)])

    assert len(seen) == 5, f"cap not honoured — {len(seen)} fetches issued"


def test_second_chance_is_bounded_in_WALL_CLOCK_not_just_ad_count(monkeypatch):
    """The ad cap alone does not bound time — a HANGING source costs 30s x3 attempts per ad.

    80 ads x ~98s worst case is ~2.2h, past the 90-minute CI job budget; a killed run keeps its
    rows but skips prune/liveness. The pass must stop on a wall clock, and must SAY what it
    dropped rather than let a truncated pass read as a complete one.
    """
    monkeypatch.setenv("AQARATIKOM_SECOND_CHANCE_BUDGET_S", "10")
    clock = {"t": 0.0}
    monkeypatch.setattr(aq.time, "monotonic", lambda: clock["t"])

    seen: list[str] = []

    def _slow(i):
        seen.append(i)
        clock["t"] += 4.0  # each ad burns 4s of the 10s budget
        return "missing", None

    monkeypatch.setattr(aq, "fetch_detail", _slow)
    out = aq.second_chance_details([{"id": f"uuid-{i}"} for i in range(50)])

    assert out == []
    # t=0 ok, t=4 ok, t=8 ok, t=12 >= 10 -> stop. Three attempted, not fifty.
    assert len(seen) == 3, f"budget not honoured — {len(seen)} ads attempted"


def test_budget_does_not_truncate_a_pass_that_fits(monkeypatch):
    """The bound must not cost anything on the normal path it exists to protect."""
    monkeypatch.setenv("AQARATIKOM_SECOND_CHANCE_BUDGET_S", "600")
    monkeypatch.setattr(aq, "fetch_detail", lambda _i: ("ok", _good()._payload["data"]))
    assert len(aq.second_chance_details([{"id": f"uuid-{i}"} for i in range(39)])) == 39


def test_second_chance_on_an_empty_list_does_nothing(monkeypatch):
    """A healthy run (the goal state) must not pay for this pass at all."""
    called: list[str] = []
    monkeypatch.setattr(aq, "fetch_detail", lambda i: called.append(i) or ("ok", {}))
    assert aq.second_chance_details([]) == []
    assert called == []
