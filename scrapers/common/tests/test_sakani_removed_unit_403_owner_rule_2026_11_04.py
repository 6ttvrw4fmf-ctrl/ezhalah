"""سكني: owner rule 2026-11-04 («Yes, use your picks», decision 1). A REMOVED unit's DETAIL API answers
HTTP 403 with a BLANK text/plain body (measured from a laptop that day: 23412, 23438, 22775, 20252 — all
struck, all ' '); a made-up id answers 404 {"message":"not found"}; a Cloudflare challenge is a 403 HTML
«Just a moment…» page. The unit is removed ONLY when its own URL answers the blank 403 on two reads, neither
redirected, AND a recently proven-live sakani unit reads LIVE through the oracle in the same check.

Drives the REAL `_verify_gone` with a stub transport. Every way short of the full proof stays UNKNOWN:
no control, a challenged control, a challenge page instead of the blank body, one blank read, a redirect.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import http_liveness as L  # noqa: E402
from scrapers.sakani import run as R  # noqa: E402

AD, CTRL = "23412", "25426"
AD_URL, CTRL_URL = f"{R.DETAIL}{AD}", f"{R.DETAIL}{CTRL}"
_LIVE = json.dumps({"data": {"attributes": {"status": "published", "publish": True,
                                            "rega_ad_license": {"advertisement_type": "sale"}}}})
BLANK = (403, " ", "text/plain; charset=utf-8")
CHALLENGE = (403, "<!DOCTYPE html><title>Just a moment...</title>", "text/html")
LIVE = (200, _LIVE, "application/json")


class _Resp:
    def __init__(self, url, status, body, ct, moved=False):
        self.status_code, self.text = status, body
        self.url = "https://sakani.sa/app/login" if moved else url
        self.headers = {"content-type": ct}


class _Sess:
    """Replays a per-URL script; an exhausted script repeats its last answer."""
    def __init__(self, script: dict[str, list[tuple]]):
        self.script, self.calls = {k: list(v) for k, v in script.items()}, []

    def get(self, url, timeout=None, allow_redirects=True, **_):
        self.calls.append(url)
        seq = self.script[url]
        ans = seq.pop(0) if len(seq) > 1 else seq[0]
        return _Resp(url, *ans)


@pytest.fixture(autouse=True)
def _fast(monkeypatch):
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    monkeypatch.setattr(L.time, "sleep", lambda *_: None)
    monkeypatch.setattr(R, "_oracle_renewed", R.ORACLE_RENEGOTIATIONS)   # no fresh sessions in these tests


def _run(monkeypatch, script, control=f"https://sakani.sa/app/market-unit/{CTRL}"):
    s = _Sess(script)
    monkeypatch.setattr(R, "_oracle_sess", s)
    monkeypatch.setattr(R, "live_control_url", lambda *a, **k: control)
    return R._verify_gone(f"SKI{AD}"), s


def test_blank_403_twice_with_a_live_control_is_gone(monkeypatch):
    (verdict, why), s = _run(monkeypatch, {AD_URL: [BLANK], CTRL_URL: [LIVE]})
    assert verdict == "gone" and "owner rule" in why
    assert s.calls[-3:] == [AD_URL, AD_URL, CTRL_URL]


@pytest.mark.parametrize("ad_answers,ctrl_answers,control", [
    ([BLANK], [LIVE], None),                                         # control required
    ([BLANK], [LIVE], f"https://sakani.sa/app/market-unit/{AD}"),    # control is the ad itself
    ([BLANK], [CHALLENGE], f"https://sakani.sa/app/market-unit/{CTRL}"),  # control challenged
    ([BLANK], [(404, '{"message":"not found"}', "application/json")],
     f"https://sakani.sa/app/market-unit/{CTRL}"),                   # control not live
    ([CHALLENGE], [LIVE], f"https://sakani.sa/app/market-unit/{CTRL}"),   # a challenge is not the removed shape
])
def test_anything_short_of_the_full_proof_stays_unknown(monkeypatch, ad_answers, ctrl_answers, control):
    (verdict, _), _s = _run(monkeypatch, {AD_URL: ad_answers, CTRL_URL: ctrl_answers}, control)
    assert verdict == "unknown"


def test_two_reads_are_required(monkeypatch):
    # the oracle's one quick read and the rule's shape check see blank 403s, the rule's first read too, then
    # its second read draws a challenge (since 2026-11-09 the rule is asked after ONE oracle read)
    first = [BLANK, BLANK, BLANK, CHALLENGE]
    (verdict, _), _s = _run(monkeypatch, {AD_URL: first, CTRL_URL: [LIVE]})
    assert verdict == "unknown"


def test_a_redirected_403_is_unknown(monkeypatch):
    moved = (403, " ", "text/plain", True)
    (verdict, _), _s = _run(monkeypatch, {AD_URL: [moved], CTRL_URL: [LIVE]})
    assert verdict == "unknown"


def test_a_live_unit_and_a_404_are_untouched(monkeypatch):
    rent = (200, _LIVE.replace("sale", "rent"), "application/json")
    (v1, _), _s = _run(monkeypatch, {AD_URL: [rent], CTRL_URL: [LIVE]})
    assert v1 == "live"
    (v2, _), _s = _run(monkeypatch, {AD_URL: [(404, '{"message":"not found"}', "application/json")],
                                     CTRL_URL: [LIVE]})
    assert v2 == "gone"


def test_the_universal_law_still_never_reads_403_as_death():
    assert L.decide(403, " ", False, lambda *a: "gone") is None
    assert L.OWNER_APPROVED_REMOVAL_STATUS["sakani"] == 403


def test_a_removed_unit_costs_the_owner_rule_reads_not_every_retry(monkeypatch):
    """⚡ 2026-11-09 (run_duration_explosion:fleet_liveness:sakani): a blank 403 goes to the owner rule after
    ONE oracle read. Before, the oracle spent all ORACLE_ATTEMPTS (≈ 60 s of back-off) on every removed unit
    first — 177 removals made the 11-08 run take 203 min."""
    sleeps: list[float] = []
    monkeypatch.setattr(L.time, "sleep", lambda d: sleeps.append(d))
    (verdict, why), s = _run(monkeypatch, {AD_URL: [BLANK], CTRL_URL: [LIVE]})
    assert verdict == "gone" and "owner rule" in why
    # 1 oracle read + the rule's shape check + its 2 reads + the control
    assert s.calls == [AD_URL, AD_URL, AD_URL, AD_URL, CTRL_URL]
    assert sum(d for d in sleeps if d >= R.PAUSE * 4) <= R.PAUSE * 4   # no retry ladder before the rule


def test_a_challenge_still_earns_every_retry(monkeypatch):
    (verdict, _), s = _run(monkeypatch, {AD_URL: [CHALLENGE], CTRL_URL: [LIVE]})
    assert verdict == "unknown"
    assert s.calls.count(AD_URL) >= 1 + R.ORACLE_ATTEMPTS


@pytest.mark.parametrize("prefix,purpose", [(R.PREFIX, "rent"), (R.SALE_PREFIX, "sale")])
@pytest.mark.parametrize("outcome", ["live", "gone"])
def test_decisive_first_read_needs_no_retry_or_control(monkeypatch, prefix, purpose, outcome):
    answer = ((200, _LIVE.replace("sale", purpose), "application/json") if outcome == "live"
              else (404, '{"message":"not found"}', "application/json"))
    s = _Sess({AD_URL: [answer]})
    monkeypatch.setattr(R, "_oracle_sess", s)
    monkeypatch.setattr(R, "live_control_url", lambda *a, **k: pytest.fail("no control needed"))
    monkeypatch.setattr(L.time, "sleep", lambda *_: pytest.fail("decisive read must not sleep"))

    verdict, _ = R._verify_gone(f"{prefix}{AD}")

    assert verdict == outcome
    assert s.calls == [AD_URL]


@pytest.mark.parametrize("initial", [CHALLENGE, (503, "unavailable", "text/plain"),
                                     (200, "not JSON", "application/json")])
def test_unknown_quick_read_can_recover_on_the_last_retry(monkeypatch, initial):
    rent = (200, _LIVE.replace("sale", "rent"), "application/json")
    answers = [initial] * R.ORACLE_ATTEMPTS + [rent]
    (verdict, _), s = _run(monkeypatch, {AD_URL: answers})

    assert verdict == "live"
    assert s.calls == [AD_URL] * (1 + R.ORACLE_ATTEMPTS)


def test_blank_first_read_with_failed_owner_proof_can_recover(monkeypatch):
    rent = (200, _LIVE.replace("sale", "rent"), "application/json")
    # The quick read is blank; the owner's shape check sees a challenge. Retry normally.
    (verdict, _), s = _run(monkeypatch, {AD_URL: [BLANK, CHALLENGE, rent]})

    assert verdict == "live"
    assert s.calls == [AD_URL] * 3


def test_removal_after_a_challenge_still_requires_the_owner_proof(monkeypatch):
    (verdict, why), s = _run(monkeypatch, {AD_URL: [CHALLENGE, CHALLENGE, BLANK],
                                         CTRL_URL: [LIVE]})

    assert verdict == "gone" and "owner rule" in why
    assert s.calls[-3:] == [AD_URL, AD_URL, CTRL_URL]


@pytest.mark.parametrize("control_answer", [CHALLENGE, (503, "unavailable", "text/plain")])
def test_early_owner_rule_never_removes_without_a_live_control(monkeypatch, control_answer):
    (verdict, _), s = _run(monkeypatch, {AD_URL: [BLANK], CTRL_URL: [control_answer]})

    assert verdict == "unknown"
    assert CTRL_URL in s.calls
    assert s.calls.count(AD_URL) >= 1 + R.ORACLE_ATTEMPTS


def test_a_persistent_server_failure_exhausts_retries_without_removal(monkeypatch):
    (verdict, _), s = _run(monkeypatch, {AD_URL: [(503, "unavailable", "text/plain")]})

    assert verdict == "unknown"
    assert s.calls == [AD_URL] * (1 + R.ORACLE_ATTEMPTS)
