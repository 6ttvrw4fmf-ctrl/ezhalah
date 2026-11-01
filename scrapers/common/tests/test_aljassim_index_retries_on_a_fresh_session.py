"""aljassim, 2026-10-10: the nightly died «index table returned no Views rows (challenge unsolved)»
on 10-03 and 10-10 after three tries on ONE stuck session; the automatic re-crawl minutes later (a new
session) read all 93 ads both times. fetch_index() now tries a FRESH session per profile.
Run: python -m pytest scrapers/common/tests/test_aljassim_index_retries_on_a_fresh_session.py -q
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

import scrapers.aljassim.run as A  # noqa: E402


def test_a_stuck_session_is_replaced(monkeypatch):
    made = []

    def make(prof):
        made.append(prof)
        return prof

    monkeypatch.setattr(A, "_get", lambda s, url, tries=3: "ROWS" if s == "firefox133" else "<challenge/>")
    monkeypatch.setattr(A, "index_rows", lambda page: [1, 2, 3] if page == "ROWS" else [])
    s, recs = A.fetch_index(make_session=make, pause=0)
    assert made == ["chrome", "safari17_0", "firefox133"]
    assert s == "firefox133" and recs == [1, 2, 3]


def test_first_session_that_works_is_kept(monkeypatch):
    made = []
    monkeypatch.setattr(A, "_get", lambda s, url, tries=3: "ROWS")
    monkeypatch.setattr(A, "index_rows", lambda page: [1])
    s, recs = A.fetch_index(make_session=lambda p: made.append(p) or p, pause=0)
    assert made == ["chrome"] and recs == [1]


def test_every_profile_failing_is_still_a_failure(monkeypatch):
    monkeypatch.setattr(A, "_get", lambda s, url, tries=3: None)
    monkeypatch.setattr(A, "index_rows", lambda page: [])
    _s, recs = A.fetch_index(make_session=lambda p: p, pause=0)
    assert recs == []


def test_crawl_uses_it():
    src = (Path(__file__).resolve().parents[2] / "aljassim" / "run.py").read_text(encoding="utf-8")
    assert "s, recs = fetch_index()" in src
