"""سكني oracle: an ACCESS answer earns the walk's resilience, never a verdict (🦅 2026-11-03).

MEASURED. Small-sources jobs 124191219317 (10-30 18:24 UTC) and 125148161467 (11-02 09:43 UTC): the first
in-run control (SKI25390, SKI25369 — both live, both just upserted) answered «no verdict after 2 attempts —
HTTP 403 is about our access», `_controls_live` withheld the prune, and `scrape_runs.notes` said only
«pruned=0». 54 residential + 4 commercial rows the catalogue had dropped for 3–20 crawls stayed in search.

These tests drive the REAL `_verify_gone` / `_controls_live` with a stub transport that replays that
shape: Cloudflare 403 on the warmed session, then the JSON record once a fresh session is negotiated.
On the old code (2 attempts, no renegotiation) the live control answers UNKNOWN and the first test fails.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.sakani import run as R  # noqa: E402

_LIVE = {"data": {"attributes": {"status": "published", "publish": True,
                                 "rega_ad_license": {"advertisement_type": "rent"}}}}
_GONE_404 = {"message": "Not Found"}


class _Resp:
    def __init__(self, status, body, ct="application/json"):
        self.status_code, self.text, self.url = status, body, ""
        self.headers = {"content-type": ct}


class _Sess:
    """403 challenge for `walled` reads, then the scripted answer."""
    def __init__(self, walled: int, answer: tuple[int, dict]):
        self.walled, self.answer, self.calls = walled, answer, 0

    def get(self, url, timeout=None, allow_redirects=True):
        self.calls += 1
        self.url = url
        if self.calls <= self.walled:
            return _Resp(403, "<html>Just a moment...</html>", "text/html")
        st, j = self.answer
        r = _Resp(st, json.dumps(j))
        r.url = url
        return r


@pytest.fixture(autouse=True)
def _fast(monkeypatch):
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    monkeypatch.setattr(R, "_oracle_renewed", 0)
    yield


def _install(monkeypatch, first: _Sess, fresh: _Sess):
    made = []

    def _session():
        made.append(fresh)
        return fresh
    monkeypatch.setattr(R, "_oracle_sess", first)
    monkeypatch.setattr(R, "session", _session)
    return made


def test_a_challenged_live_unit_still_reads_live(monkeypatch):
    # the warmed session is walled for every read it makes; a fresh session reads the record
    made = _install(monkeypatch, _Sess(99, (200, _LIVE)), _Sess(0, (200, _LIVE)))
    assert R._verify_gone("SKI25369")[0] == "live"
    assert made, "an access answer must earn a fresh session"


def test_the_control_passes_and_the_prune_is_not_withheld(monkeypatch):
    _install(monkeypatch, _Sess(99, (200, _LIVE)), _Sess(0, (200, _LIVE)))
    assert R._controls_live(["SKI25369", "SKI25370", "SKI25371"]) is True
    assert R._control_why == ""


def test_retries_inside_one_session_cover_the_half_time_challenge(monkeypatch):
    # 3 walled reads then the answer: the old 2-attempt probe gave up here without renegotiating
    first = _Sess(3, (200, _LIVE))
    made = _install(monkeypatch, first, _Sess(0, (200, _LIVE)))
    assert R._verify_gone("SKI25369")[0] == "live"
    assert not made


def test_an_access_answer_is_never_a_death_and_renegotiation_is_bounded(monkeypatch):
    walled = _Sess(10 ** 6, (200, _LIVE))
    made = _install(monkeypatch, walled, walled)
    verdict, why = R._verify_gone("SKI25369")
    assert verdict == "unknown" and "access" in why
    assert len(made) == R.ORACLE_RENEGOTIATIONS
    R._verify_gone("SKI25370")                     # the budget is per run, not per probe
    assert len(made) == R.ORACLE_RENEGOTIATIONS


def test_a_real_404_is_still_gone_without_any_renegotiation(monkeypatch):
    made = _install(monkeypatch, _Sess(0, (404, _GONE_404)), _Sess(0, (404, _GONE_404)))
    assert R._verify_gone("SKI99999")[0] == "gone"
    assert not made


def test_a_withheld_prune_is_recorded_for_the_run_row(monkeypatch):
    walled = _Sess(10 ** 6, (200, _LIVE))
    _install(monkeypatch, walled, walled)
    assert R._controls_live(["SKI25369", "SKI25370", "SKI25371"]) is False
    assert R._control_why.startswith("prune withheld: control SKI25369 unknown")
