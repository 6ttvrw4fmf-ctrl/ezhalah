"""The Lifecycle spot check's judging: a wrong answer in either direction is counted, UNKNOWN is never
counted as right or wrong, and a run whose controls failed is VOID, never "clean"."""
from scrapers.common.lifecycle_spot_check import judge, summarize
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
