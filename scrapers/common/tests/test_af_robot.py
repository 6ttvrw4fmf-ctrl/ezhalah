"""The hourly robot customer must CATCH a broken Advanced Filter mapping (🔬 night-2 net, 2026-10-05).

A fake anon RPC applies the real contract — amenity params are English slugs (`ac`, never
`air_conditioner`), furnished is p_furnished — and returns the listing only when the request is right.
The robot must report found on the real mapping and a MISS when the mapping is deliberately broken.

Run: python -m pytest scrapers/common/tests/test_af_robot.py -v
"""
from __future__ import annotations

import random
import sys

import pytest

sys.path.insert(0, ".")

from scrapers.common import af_robot as R  # noqa: E402
from scrapers.common import af_score as S  # noqa: E402

SLUG_COL = {"elevator": "elevator", "parking": "parking", "kitchen": "kitchen", "ac": "air_conditioner",
            "maid_room": "maid_room", "driver_room": "driver_room", "private_entrance": "private_entrance"}

ROW = {"platform": "aqar", "source_table": "aqar_residential_listings", "listing_id": 8844647,
       "deal_ar": "إيجار", "city_ar": "جدة", "district_ar": "حي الصفا", "type_ar": "شقة",
       "rent_period_ar": "سنوي", "elevator": True, "parking": True, "kitchen": True, "air_conditioner": True,
       "furnished": True, "maid_room": True, "driver_room": True, "private_entrance": True}


class _Exec:
    def __init__(self, data):
        self.data = data

    def execute(self):
        return self


class FakeAnon:
    """location_search_candidates_ar, reduced to the parts a mapping bug breaks."""
    def __init__(self, rows):
        self.rows = rows

    def rpc(self, name, p):
        assert name == "location_search_candidates_ar"
        out = []
        for r in self.rows:
            if p.get("p_rent_period") not in (None, r["rent_period_ar"]):
                continue
            if any(slug not in SLUG_COL or not r.get(SLUG_COL[slug]) for slug in (p.get("p_amenities") or [])):
                continue                                   # an unknown slug matches nothing — like the RPC
            if p.get("p_furnished") is not None and r.get("furnished") is not p["p_furnished"]:
                continue
            out.append({"source_table": r["source_table"], "listing_id": r["listing_id"]})
        return _Exec(out)


@pytest.mark.parametrize("answer", R.ANSWERS)
def test_real_mapping_finds_every_answer(answer):
    assert R.check(FakeAnon([ROW]), ROW, answer) is True


def test_a_broken_slug_mapping_is_caught(monkeypatch):
    monkeypatch.setitem(S.AMENITY_SLUG, "air_conditioner", "air_conditioner")   # the mutation
    assert R.check(FakeAnon([ROW]), ROW, "air_conditioner") is False


def test_monthly_furnished_is_never_asked():
    assert R.check(FakeAnon([ROW]), dict(ROW, rent_period_ar="شهري"), "furnished") is None


def test_rotation_covers_every_answer_within_a_day():
    seen = {a for h in range(24) for a in R.rotation(h)}
    assert seen == set(R.ANSWERS)


def test_run_reports_a_miss_with_its_key(monkeypatch):
    monkeypatch.setattr(R, "pick", lambda client, answer, rng: ROW)
    monkeypatch.setitem(S.AMENITY_SLUG, "kitchen", "مطبخ")                      # Arabic slug: trap 3
    res = R.run(None, FakeAnon([ROW]), 0, random.Random(0))
    assert any(m["key"] == "aqar_residential_listings:8844647" and m["answer"] == "kitchen" for m in res["missed"])


# ── the live count (owner screenshot 2026-10-08, backlog 281) ─────────────────────────────────────
class CountAnon:
    """apartment_guided_counts_ar that answers, errors, or answers too late (a fake clock moves per call)."""
    def __init__(self, behaviour):
        self.behaviour = list(behaviour)   # one per attempt: "ok" | "error" | "slow"
        self.calls = []
        self.now = 0.0

    def clock(self):
        return self.now

    def rpc(self, name, p):
        assert name == "apartment_guided_counts_ar"
        assert "p_limit" not in p and len(p["p_amenities"]) >= 3
        self.calls.append(p)
        b = self.behaviour.pop(0)
        if b == "error":
            raise RuntimeError("canceling statement due to statement timeout")
        self.now += 19.0 if b == "slow" else 1.2      # 19 s > 12 s budget + 6 s robot gate
        return _Exec([{"cnt_selected": 14}])


def _probe(behaviour):
    a = CountAnon(behaviour)
    return R.count_probe(a, ROW, clock=a.clock, sleep=lambda s: None), a


def test_a_count_that_answers_is_shown():
    res, a = _probe(["ok"])
    assert res["ok"] is True and res["n"] == 14 and len(a.calls) == 1 and res["ticks"] == 5


def test_one_slow_count_is_retried_like_the_app():
    res, a = _probe(["slow", "ok"])
    assert res["ok"] is True and len(a.calls) == 2


def test_three_failed_attempts_are_a_missing_count():
    res, _ = _probe(["error", "slow", "error"])
    assert res["ok"] is False and res["n"] is None and len(res["ms"]) == 3


def test_mutation_a_probe_that_ignores_time_misses_the_bug(monkeypatch):
    # if the budget check were dropped, three late answers would read as «shown» — the test above must fail then
    monkeypatch.setattr(R, "COUNT_BUDGET_S", 1e9)
    res, _ = _probe(["slow", "slow", "slow"])
    assert res["ok"] is True                      # proves the budget is what catches a late count


def test_report_pages_on_a_missing_count():
    sent = []

    class Client:
        def rpc(self, name, p):
            sent.append((name, p))
            return _Exec(1)

        def table(self, name):
            class T:
                def insert(self, row):
                    sent.append((name, row))
                    return _Exec(None)
            return T()

    res = {"tried": 1, "found": 1, "undecided": 0, "missed": [],
           "counts": [{"key": "aqar_residential_listings:8844647", "ticks": 5, "ok": False, "n": None, "ms": [18000, 18000, 18000]}]}
    R.report(Client(), res, dry_run=False)
    assert ("mon_raise" in [s[0] for s in sent]) and any(s[0] == "ops_engineer_backlog" for s in sent)
    sent.clear()
    res["counts"][0].update(ok=True, n=14, ms=[900])
    R.report(Client(), res, dry_run=False)
    assert sent[0][0] == "mon_resolve_key"
