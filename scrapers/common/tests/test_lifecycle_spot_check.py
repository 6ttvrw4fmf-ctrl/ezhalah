"""The Lifecycle spot check's judging: a wrong answer in either direction is counted, UNKNOWN is never
counted as right or wrong, and a run whose controls failed is VOID, never "clean"."""
import pytest

from scrapers.common import lifecycle_spot_check as S
from scrapers.common.lifecycle_spot_check import judge, parse_ids, summarize
from scrapers.common.liveness_contract import ALIVE, DEAD, UNKNOWN


def _r(side, verdict):
    return {"side": side, "table": "t", "id": 1, "url": "u", "verdict": verdict, "judged": judge(side, verdict)}


def test_hidden_ad_that_is_alive_was_wrongly_hidden():
    assert judge("hidden", ALIVE) == "wrong"
    assert judge("hidden", DEAD) == "right"


def test_live_ad_that_is_dead_is_wrongly_still_shown():
    assert judge("live", DEAD) == "wrong"
    assert judge("live", ALIVE) == "right"


def test_unknown_is_never_right_or_wrong():
    assert judge("hidden", UNKNOWN) == "unknown"
    assert judge("live", UNKNOWN) == "unknown"


def test_clean_only_when_zero_wrong_and_controls_passed():
    ok = {"probed": 5, "alive": 5, "ok": True}
    assert summarize("x", "status-only", ok, [_r("hidden", DEAD), _r("live", ALIVE)])["verdict"] == "clean"
    out = summarize("x", "status-only", ok, [_r("hidden", ALIVE), _r("live", DEAD), _r("live", UNKNOWN)])
    assert out["verdict"] == "2 wrong answer(s)"
    assert out["hidden"]["wrong"] == 1 and out["live"]["wrong"] == 1 and out["live"]["unknown"] == 1


def test_failed_controls_make_the_run_void_not_clean():
    bad = {"probed": 5, "alive": 1, "ok": False}
    out = summarize("x", "status-only", bad, [])
    assert out["verdict"].startswith("void") and out["trusted"] is False


def test_ids_are_parsed_exactly_and_malformed_ones_refused():
    assert parse_ids("aqar_residential_listings:12, gathern_residential_listings:7") == [
        ("aqar_residential_listings", 12), ("gathern_residential_listings", 7)]
    assert parse_ids("") == []
    for bad in ("aqar_residential_listings", "aqar_residential_listings:x", ":5"):
        with pytest.raises(ValueError):
            parse_ids(bad)


def test_controls_fall_back_to_the_most_recently_crawled_ads_when_the_crawl_is_stale():
    # dwelleo/muhaysini 2026-10-02: crawl failing for days → 0 controls → every spot check void.
    import random
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    rows = [{"id": i, "ad_number": str(i), "listing_url": f"https://x/{i}", "active": True,
             "last_seen_at": (now - timedelta(days=3, hours=i)).isoformat()} for i in range(8)]

    class _Q:
        def __init__(self): self.f, self.desc, self.n = [], False, None
        def select(self, *_): return self
        def eq(self, c, v): self.f.append(lambda r: r.get(c) == v); return self
        def gte(self, c, v): self.f.append(lambda r: r[c] >= v); return self
        def lt(self, c, v): self.f.append(lambda r: r[c] < v); return self
        def filter(self, *_): return self
        def order(self, c, desc=False): self.desc = (c, desc); return self
        def limit(self, n): self.n = n; return self
        def execute(self):
            out = [r for r in rows if all(f(r) for f in self.f)]
            if self.desc:
                out.sort(key=lambda r: r[self.desc[0]], reverse=self.desc[1])
            return type("R", (), {"data": out[: self.n]})()

    class _Cl:
        def table(self, t): return _Q()

    ctl = S.pick_controls(_Cl(), ["t_residential_listings"], random.Random(1))
    assert len(ctl) == S.CANARIES
    assert {r["id"] for r in ctl} == set(range(S.CANARIES)), "the most recently crawled ads, not older ones"
