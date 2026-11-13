"""asasmakeen (♻️ 2026-11-13): prune_unseen's answer at grace reads the ad's OWN page. It used to hold every
candidate UNKNOWN, so ASM2676 (row 24218552) sat at 3 strikes, served, while its page answered 404 to the 09:05
dead-visible score. And a sitemap unit whose own page 404s must not freeze every prune."""
from __future__ import annotations

import pytest

from scrapers.common import honest_fetch as H
from scrapers.asasmakeen import run as M

U = M.SITE + M.UNIT_PATH
PAGES = {U + "1/a": (200, "unit"), U + "2/b": (404, ""), U + "3/c": (200, "shell"), U + "4/d": (None, "")}
URLS = {"ASM1": U + "1/a", "ASM2": U + "2/b", "ASM3": U + "3/c", "ASM4": U + "4/d", "ASM9": "https://elsewhere/x"}


@pytest.fixture(autouse=True)
def _parse(monkeypatch):
    monkeypatch.setattr(M, "parse_unit", lambda body: {"ok": 1} if body == "unit" else None)


def _g(control):
    return M._make_gone(control, page=lambda u: PAGES.get(u, (None, "")), url_for=URLS.get)


def test_own_page_decides_and_removal_is_control_gated():
    g = _g(U + "1/a")
    assert g("ASM1")[0] == "live"
    assert g("ASM2")[0] == "gone"
    assert g("ASM3")[0] == "unknown", "a 200 without the unit block is no opinion, never live or gone"
    assert g("ASM4")[0] == "unknown"
    assert g("ASM9")[0] == "unknown" and g("ASMX")[0] == "unknown"
    assert _g(U + "3/c")("ASM2")[0] == "unknown", "control without a unit block: no removal"
    assert _g(None)("ASM2")[0] == "unknown"


def test_the_crawl_hands_prune_the_own_page_oracle_not_a_held_answer():
    src = open(M.__file__, encoding="utf-8").read()
    assert "_GONE[0] = _make_gone(" in src and "verify_gone=_gone" in src
    assert "no own-page oracle yet" not in src, "the old held-UNKNOWN answer is back"


def test_a_sitemap_404_does_not_freeze_the_prune(monkeypatch):
    sm = f"<loc>{U}1/a</loc><loc>{U}2/b</loc>"

    def get_text(url, **_):
        if url == M.SITEMAP:
            return sm
        if url.endswith("2/b"):
            raise H.Blocked(f"HTTP 404 at {url} (not a 200 — stopping, never guessing)")
        return "unit"
    monkeypatch.setattr(M.H, "get_text", get_text)
    monkeypatch.setattr(M, "project_slugs", lambda page: {})
    monkeypatch.setattr(M, "parse_unit", lambda body: {"project": ""} if body == "unit" else None)
    w = M.walk(log=lambda *_: None)
    assert w["bad"] == {"gone_404": 1} and list(w["units"]) == ["1"]
    src = open(M.__file__, encoding="utf-8").read()
    assert 'not (set(w["bad"]) - {"gone_404"})' in src
