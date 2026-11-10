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
    # cheapest-proof read blank, the owner rule's own first look blank, its first read blank, then
    # its SECOND read draws a challenge: no removal, and the remaining attempts never see the blank again
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
