"""tamyaz, 2026-10-10: one 40 s connect timeout failed the nightly (no retry); the re-crawl 28 min
later read every ad. _get_api() retries a transport error or refused/5xx answer on a fresh session.
Run: python -m pytest scrapers/common/tests/test_tamyaz_api_retries_a_transient_failure.py -q
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

import scrapers.tamyaz.run as T  # noqa: E402


class R:
    def __init__(self, status):
        self.status_code = status


class S:
    def __init__(self, outcome):
        self.outcome = outcome

    def get(self, url, timeout=None):
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return R(self.outcome)


def test_timeout_then_success_on_a_fresh_session():
    made = []
    seq = {"safari17_0": S(200)}
    r = T._get_api(S(TimeoutError("curl 28")), "u", make_session=lambda p: made.append(p) or seq[p], pause=0)
    assert r.status_code == 200 and made == ["safari17_0"]


def test_refused_then_success():
    seq = {"safari17_0": S(503), "firefox133": S(200)}
    assert T._get_api(S(403), "u", make_session=lambda p: seq[p], pause=0).status_code == 200


def test_a_definite_answer_is_not_retried():
    made = []
    assert T._get_api(S(404), "u", make_session=lambda p: made.append(p), pause=0).status_code == 404
    assert made == []


def test_all_transport_failures_raise():
    with pytest.raises(TimeoutError):
        T._get_api(S(TimeoutError("a")), "u", make_session=lambda p: S(TimeoutError("b")), pause=0)
