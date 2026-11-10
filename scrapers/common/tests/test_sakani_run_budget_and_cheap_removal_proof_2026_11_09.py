"""سكني 2026-11-09: the run ends itself before CI kills it, and a removed unit is proven cheaply.

MEASURED (small-sources job 128978543773, 11-09 04:35 UTC): the walk finished at 06:02 and 1,629 rows were
written; the prune's oracle then spent 49 silent minutes on at-grace units — ~70 s each, because a BLANK 403
(the removed shape, deterministic) first earned four backed-off attempts (6+12+18+24 s of sleep) before the
owner rule was consulted — until timeout-minutes 150 cancelled the job at 07:04, before end_run(). The run row
read «killed … rows_seen 0» and crawl_went_silent fired on a crawl that had just upserted everything.

Drives the REAL `_verify_gone` with a stub transport:
  * a blank 403 goes straight to the owner rule: the whole proof is 4 reads of the ad + 1 of the control and
    exactly ONE pause (the owner rule's), never the oracle's backed-off attempts;
  * a live unit and a deleted unit are decided from ONE read;
  * a challenge page keeps the full resilience (attempts, then fresh sessions) — no shortcut reads it;
  * once main()'s budget is spent the oracle answers UNKNOWN WITHOUT a read and counts the refusal; a module
    with no armed budget (fleet_liveness imports `_verify_gone`) is never budgeted.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import http_liveness as L  # noqa: E402
from scrapers.sakani import run as R  # noqa: E402

AD, CTRL = "23466", "24213"
AD_URL, CTRL_URL = f"{R.DETAIL}{AD}", f"{R.DETAIL}{CTRL}"
_LIVE_SALE = json.dumps({"data": {"id": AD, "attributes": {"status": "published", "publish": True,
                                                            "rega_ad_license": {"advertisement_type": "sale"}}}})
BLANK = (403, " ", "text/plain; charset=utf-8")
CHALLENGE = (403, "<!DOCTYPE html><title>Just a moment...</title>", "text/html")
LIVE = (200, _LIVE_SALE, "application/json")
NOT_FOUND = (404, '{"message":"not found"}', "application/json")


class _Resp:
    def __init__(self, url, status, body, ct):
        self.status_code, self.text, self.url = status, body, url
        self.headers = {"content-type": ct}


class _Sess:
    def __init__(self, script):
        self.script, self.calls = {k: list(v) for k, v in script.items()}, []

    def get(self, url, timeout=None, allow_redirects=True, **_):
        self.calls.append(url)
        seq = self.script[url]
        return _Resp(url, *(seq.pop(0) if len(seq) > 1 else seq[0]))


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    sleeps: list[float] = []
    monkeypatch.setattr(R.time, "sleep", lambda s=0: sleeps.append(float(s)))
    monkeypatch.setattr(L.time, "sleep", lambda s=0: sleeps.append(float(s)))
    monkeypatch.setattr(R, "_oracle_renewed", R.ORACLE_RENEGOTIATIONS)   # no fresh sessions here
    monkeypatch.setattr(R, "_DEADLINE", None)
    monkeypatch.setattr(R, "_budget_skipped", 0)
    monkeypatch.setattr(R, "live_control_url", lambda *a, **k: f"https://sakani.sa/app/market-unit/{CTRL}")
    yield sleeps


def _run(monkeypatch, script, ad=f"SKS{AD}"):
    s = _Sess(script)
    monkeypatch.setattr(R, "_oracle_sess", s)
    return R._verify_gone(ad), s


def test_a_blank_403_is_proven_removed_in_five_reads_and_one_pause(monkeypatch, _quiet):
    (verdict, why), s = _run(monkeypatch, {AD_URL: [BLANK], CTRL_URL: [LIVE]})
    assert verdict == "gone" and "owner rule" in why
    assert s.calls == [AD_URL, AD_URL, AD_URL, AD_URL, CTRL_URL]
    assert _quiet == [R.PAUSE], _quiet          # the owner rule's pause between its two reads, nothing else


def test_a_live_unit_and_a_deleted_unit_are_decided_from_one_read(monkeypatch):
    (v1, _), s1 = _run(monkeypatch, {AD_URL: [LIVE], CTRL_URL: [LIVE]})
    assert v1 == "live" and s1.calls == [AD_URL]
    (v2, _), s2 = _run(monkeypatch, {AD_URL: [NOT_FOUND], CTRL_URL: [LIVE]})
    assert v2 == "gone" and s2.calls == [AD_URL]


def test_a_challenge_page_keeps_every_attempt_and_stays_unknown(monkeypatch):
    (verdict, _), s = _run(monkeypatch, {AD_URL: [CHALLENGE], CTRL_URL: [LIVE]})
    assert verdict == "unknown"
    # the cheap look, then the oracle's attempts, then the owner rule's own look at the (HTML) 403
    assert s.calls.count(AD_URL) >= 1 + R.ORACLE_ATTEMPTS and CTRL_URL not in s.calls


def test_a_spent_budget_answers_unknown_without_a_read(monkeypatch):
    R._arm_budget(0)
    monkeypatch.setattr(R.time, "monotonic", lambda: R._DEADLINE + 1)
    (verdict, why), s = _run(monkeypatch, {AD_URL: [BLANK], CTRL_URL: [LIVE]})
    assert verdict == "unknown" and "budget" in why
    assert s.calls == [] and R._budget_skipped == 1
    assert R._over_budget()


def test_no_armed_budget_means_no_budget(monkeypatch):
    # fleet_liveness imports `_verify_gone` and never calls main(): it must never be refused a read
    assert R._DEADLINE is None and not R._over_budget()
    (verdict, _), s = _run(monkeypatch, {AD_URL: [LIVE], CTRL_URL: [LIVE]})
    assert verdict == "live" and s.calls == [AD_URL]


def test_a_spent_budget_cuts_the_walk_writes_what_was_read_and_never_prunes(monkeypatch):
    # Drives the REAL main() with the db stub of the traps module: the budget is spent after the first
    # unit, so one row is written, the cut is tallied, the run is partial (no prune) and end_run() lands.
    from scrapers.common.tests import test_sakani_price_period_and_pii_traps as T
    calls = T._stub_db(monkeypatch)
    monkeypatch.setattr(R, "enumerate_rent", lambda s: list(T._UNITS[:3]))
    monkeypatch.setattr(R, "fetch_detail", lambda s, uid: T._DETAILS[uid])
    monkeypatch.setattr(R, "district_names", lambda s, cid, cache: {"500001063": "الشعلة"})
    monkeypatch.setattr(R, "_controls_live", lambda ads: (_ for _ in ()).throw(AssertionError("no prune")))
    clock = {"t": 0.0}
    monkeypatch.setattr(R.time, "monotonic", lambda: clock["t"])
    real_fetch = R.fetch_detail
    def tick(s, uid):
        clock["t"] += 60 * R.RUN_BUDGET_MIN + 1      # the first detail read spends the whole budget
        return real_fetch(s, uid)
    monkeypatch.setattr(R, "fetch_detail", tick)
    monkeypatch.setattr(sys, "argv", ["run.py"])
    assert R.main() == 0
    assert calls["batch"][0] == ("sakani_residential_listings", ["SKI24858"])   # read before the cut, written
    assert calls["prune"] == []                                                  # partial → no prune
    run_id, kw = calls["end_run"][0]
    assert run_id == 77 and kw["ok"] is True and kw["rows_seen"] == 1 and kw["rows_upserted"] == 1
    assert "deadline_cutx3" in kw["notes"], kw["notes"]     # 2 rent units + the off-plan sale row never visited
    assert calls["progress"] == [(77, {"rows_seen": 1, "rows_upserted": 1})]


def test_the_budget_fits_inside_the_ci_job() -> None:
    # small-sources-sync.yml gives sakani `tmo: 150`; the run must end itself with room for end_run().
    wf = (Path(__file__).resolve().parents[3] / ".github/workflows/small-sources-sync.yml").read_text()
    import re
    m = re.search(r"source:\s*sakani,.*?tmo:\s*(\d+)", wf)
    assert m, "sakani's matrix line (and its tmo) must exist"
    assert R.RUN_BUDGET_MIN <= int(m.group(1)) - 15
