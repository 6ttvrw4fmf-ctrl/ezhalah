"""fahadalshahri failed two nights running on ONE request (10-07 a non-200 read as «store api returned
no products»; 10-08 a 45 s connect timeout) and the re-crawl 30 minutes later read all 26 products.
A burst is retried with a fresh session; a page that never answers raises with its status."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.fahadalshahri import run as R  # noqa: E402


class _Resp:
    def __init__(self, status, body=None):
        self.status_code, self._body, self.headers = status, body or [], {"x-wp-total": str(len(body or []))}

    def json(self):
        return self._body


class _Stub:
    def __init__(self, script):
        self.script = script

    def get(self, *a, **k):
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)


def test_a_timeout_then_a_502_is_retried_on_a_fresh_session(monkeypatch):
    script = [TimeoutError("Connection timed out after 45001 milliseconds"), _Resp(502),
              _Resp(200, [{"id": 1}, {"id": 2}])]
    stub = _Stub(script)
    monkeypatch.setattr(R, "session", lambda: stub)
    assert [p["id"] for p in R.fetch_products(stub)] == [1, 2]
    assert not R.INCOMPLETE


def test_a_page_that_never_answers_raises_never_reads_as_an_empty_shop(monkeypatch):
    stub = _Stub([_Resp(503)] * R._PAGE_ATTEMPTS)
    monkeypatch.setattr(R, "session", lambda: stub)
    with pytest.raises(RuntimeError, match="HTTP 503"):
        R.fetch_products(stub)
