"""manzo's API answered «total_count=0» on 2026-10-01/02 (its one ad came down) and every run went red
as "0-row run (blocked/empty source?)". A source that ANSWERS with its own empty count is healthy;
a fetch that fails still raises and stays red. Both directions are pinned here."""
import importlib

import pytest

R = importlib.import_module("scrapers.manzo.run")


class _DB:
    def __init__(self):
        self.end = None

    def begin_run(self, _slug):
        return 1

    def end_run(self, _rid, **kw):
        self.end = kw
        return not (kw.get("rows_seen") == 0 and not kw.get("allow_empty"))

    def __getattr__(self, name):          # upserts / sibling retire / prune: no-ops here
        return lambda *a, **k: 0


def _run(monkeypatch, walk):
    db = _DB()
    monkeypatch.setattr(R, "db", db)
    monkeypatch.setattr(R, "walk", walk)
    monkeypatch.setattr(R, "get_json", lambda *_a, **_k: {"display_status": "rented"})
    monkeypatch.setattr("sys.argv", ["run"])
    return R.main(), db.end


def test_source_declaring_zero_is_healthy_not_red(monkeypatch):
    rc, end = _run(monkeypatch, lambda _s: ([], 0))
    assert rc == 0 and end["allow_empty"] is True
    assert "source-published empty" in end["notes"]


def test_a_failed_fetch_still_fails(monkeypatch):
    def boom(_s):
        raise RuntimeError("HTTP 403")
    with pytest.raises(RuntimeError):
        _run(monkeypatch, boom)


def test_listings_present_is_not_an_empty_source(monkeypatch):
    rc, end = _run(monkeypatch, lambda _s: ([{"slug": "x"}], 1))
    assert end["allow_empty"] is False and end["notes"] is None


def test_the_predicate_both_ways():
    assert R.source_published_empty([], 0)
    assert not R.source_published_empty([], 3)          # a count the walk did not reach
    assert not R.source_published_empty([{"slug": "x"}], 1)
