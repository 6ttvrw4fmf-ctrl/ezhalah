"""ryadah: a REST page that answers 200 with a non-JSON body is a failed fetch, recorded (2026-10-13).

The 10-13 nightly crawl's probe was served, then REST page 1 answered 200 with a body that was not
JSON; r.json() crashed the job BEFORE begin_run, so the night left no scrape_runs row at all.
These tests EXECUTE fetch_json_page() and main() against stubs.
"""
from __future__ import annotations

import sys

import pytest

import scrapers.ryadah.run as R


class _Resp:
    def __init__(self, status, text):
        self.status_code, self.text, self.content = status, text, text.encode()

    def json(self):
        import json
        return json.loads(self.text)


def _stub_fetch(monkeypatch, bodies):
    it = iter(bodies)
    monkeypatch.setattr(R, "fetch", lambda s, url: _Resp(*next(it)))
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)


def test_non_json_200_is_retried(monkeypatch):
    _stub_fetch(monkeypatch, [(200, "<html>wait</html>"), (200, '[{"link": "https://ryadah.com.sa/p/1/"}]')])
    _r, got = R.fetch_json_page(None, "u")
    assert got == [{"link": "https://ryadah.com.sa/p/1/"}]


def test_non_json_200_every_time_raises(monkeypatch):
    _stub_fetch(monkeypatch, [(200, "")] * 3)
    with pytest.raises(RuntimeError, match="not a JSON list"):
        R.fetch_json_page(None, "u")


def test_past_the_end_400_is_an_answer(monkeypatch):
    _stub_fetch(monkeypatch, [(400, "")])
    r, got = R.fetch_json_page(None, "u")
    assert r.status_code == 400 and got == []


def test_a_walk_that_dies_leaves_a_failed_run_row(monkeypatch):
    ends = []
    monkeypatch.setattr(R, "retry_smarter_session", lambda url, **k: (object(), ["direct/chrome124:200"]))
    monkeypatch.setattr(R.db, "begin_run", lambda slug: 7)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **k: ends.append((run_id, k)) or True)
    monkeypatch.setattr(R, "walk_posts", lambda s: (_ for _ in ()).throw(RuntimeError("REST answered 200 but not a JSON list")))
    monkeypatch.setattr(sys, "argv", ["run"])
    with pytest.raises(RuntimeError):
        R.main()
    assert ends and ends[0][0] == 7 and ends[0][1]["ok"] is False
    assert "not a JSON list" in ends[0][1]["notes"]
