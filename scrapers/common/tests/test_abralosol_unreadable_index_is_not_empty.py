"""abralosol: an index page we could not READ is a failed fetch, never an empty catalogue (2026-10-13).

The 10-13 nightly crawl (run 38346091212) read /node?page=0 as nothing on its one pinned profile and
logged «pages: 0» with no error, the same as a source with no listings. Page 0 unreadable must fail
the run with that reason; a later unreadable page keeps what was read and prunes nothing.
These tests EXECUTE crawl() and main() against stubs.
"""
from __future__ import annotations

import sys

import pytest

from scrapers.abralosol import run


def _stub_pages(monkeypatch, pages):
    monkeypatch.setattr(run, "_session", lambda: object())
    monkeypatch.setattr(run, "_get", lambda s, url, tries=3: pages.get(int(url.rsplit("=", 1)[1])))
    monkeypatch.setattr(run, "_index_rows", lambda html: [{"nid": html, "cells": {}}] if html else [])
    monkeypatch.setattr(run, "_parse_index", lambda rec: {"nid": rec["nid"], "title_lines": []})
    monkeypatch.setattr(run, "map_listing", lambda ix, d: None)
    monkeypatch.setattr(run.time, "sleep", lambda *_: None)


def test_first_page_unreadable_fails_the_run(monkeypatch):
    _stub_pages(monkeypatch, {0: None})
    with pytest.raises(run.IndexUnreadable):
        run.crawl(want_detail=False)


def test_later_page_unreadable_marks_the_crawl_incomplete(monkeypatch):
    _stub_pages(monkeypatch, {0: "1", 1: None})
    _res, _com, _n, stats = run.crawl(want_detail=False)
    assert stats["pages"] == 1
    assert stats["incomplete"] == "index page 1 unreadable"


def test_a_real_last_page_is_complete(monkeypatch):
    _stub_pages(monkeypatch, {0: "1", 1: ""})
    _res, _com, _n, stats = run.crawl(want_detail=False)
    assert "incomplete" not in stats


def test_incomplete_crawl_prunes_nothing(monkeypatch):
    row = {"ad_number": "ABR1"}
    monkeypatch.setattr(run, "crawl", lambda limit=0: ([row], [], 1, {"incomplete": "index page 3 unreadable"}))
    calls = []
    monkeypatch.setattr(run.db, "begin_run", lambda p: 1)
    monkeypatch.setattr(run.db, "upsert_abralosol_residential_batch", lambda rows: None)
    monkeypatch.setattr(run.db, "retire_superseded_siblings", lambda **k: 0)
    monkeypatch.setattr(run.db, "prune_unseen", lambda *a, **k: calls.append(a) or 0)
    monkeypatch.setattr(run.db, "end_run", lambda *a, **k: True)
    monkeypatch.setattr(run, "_make_verify_gone", lambda c: None)
    monkeypatch.setattr(sys, "argv", ["run"])
    assert run.main() == 0
    assert calls == []


def test_the_failure_names_its_reason(monkeypatch):
    """10-13 07:40: every route raised CertificateVerifyError and the notes said only «unreadable»."""
    class _S:
        def get(self, url):
            raise RuntimeError("curl: (60) SSL certificate problem: certificate has expired")
    _stub_pages(monkeypatch, {0: None})
    monkeypatch.setattr(run, "_session", lambda: _S())
    with pytest.raises(run.IndexUnreadable, match="certificate has expired"):
        run.crawl(want_detail=False)
