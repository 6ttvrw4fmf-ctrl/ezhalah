"""mrajhi (2026-11-07): a sitemap unit whose OWN page answers 404 is a removed ad, not an unreadable walk.
EHKyWc1M was served dead while that 404 marked every walk incomplete and froze every prune."""
from __future__ import annotations

import pytest

from scrapers.common import honest_fetch as H
from scrapers.mrajhi import run as M


def _walk(monkeypatch, answers):
    sm = "".join(f"<loc>{M.SITE}/units/{c}</loc>" for c in answers)

    def get_text(url, **_):
        if url == M.SITEMAP:
            return sm
        a = answers[url.rsplit("/", 1)[1]]
        if isinstance(a, Exception):
            raise a
        return a
    monkeypatch.setattr(M.H, "get_text", get_text)
    monkeypatch.setattr(M, "parse_unit", lambda page: {"ok": page})
    return M.walk(log=lambda *_: None)


def test_a_plain_404_is_recorded_gone_and_a_wall_stops_the_walk(monkeypatch):
    w = _walk(monkeypatch, {"A": "page", "B": H.Blocked(f"HTTP 404 at {M.SITE}/units/B (not a 200 — stopping, never guessing)")})
    assert w["gone_urls"] == [f"{M.SITE}/units/B"] and w["bad"]["gone_404"] == 1 and list(w["units"]) == ["A"]
    with pytest.raises(H.Blocked):
        _walk(monkeypatch, {"A": "page", "B": H.Blocked(f"HTTP 404 wall at {M.SITE}/units/B: 'captcha'")})
    with pytest.raises(H.Blocked):
        _walk(monkeypatch, {"A": "page", "B": H.Blocked(f"HTTP 500 at {M.SITE}/units/B (not a 200)")})


def test_the_own_page_oracle_is_control_gated():
    st = {f"{M.SITE}/units/A": 200, f"{M.SITE}/units/B": 404}.get
    g = M._make_gone(f"{M.SITE}/units/A", status=st)
    assert g("MRJA")[0] == "live" and g("MRJB")[0] == "gone" and g("MRJC")[0] == "unknown"
    assert M._make_gone(f"{M.SITE}/units/B", status=st)("MRJB")[0] == "unknown", "control not 200: no removal"
    assert M._make_gone(None, status=st)("MRJB")[0] == "unknown"
