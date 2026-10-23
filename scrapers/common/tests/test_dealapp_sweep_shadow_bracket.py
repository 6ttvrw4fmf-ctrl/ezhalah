"""The dealapp sweep counts, in SHADOW, the struck rows the crawl's bracketed no-listing oracle
would call gone (2026-10-23, backlog 766). 60 shown dealapp ads at 3+ strikes read UNKNOWN to every
reader: a removed ad renders dealapp's bogus-id shell. Only an ORIGIN render with no listing,
between two live-ad renders on the same runner, counts; nothing here writes a verdict."""
from __future__ import annotations

from scrapers.dealapp import liveness_run as L
from scrapers.common.liveness_contract import ALIVE, UNKNOWN

SHELL = '<html><script id="ng-state" type="application/json">{}</script></html>'
AD = '<html><script id="ng-state">{}</script><script>"real-estate-listing"</script></html>'


def test_render_kind():
    assert L.render_kind(ALIVE, 200, AD, False) == "ad"
    assert L.render_kind(UNKNOWN, 200, SHELL, False) == "none"
    assert L.render_kind(UNKNOWN, 200, SHELL, True) == "other", "a CloudFront copy is no origin render"
    assert L.render_kind(UNKNOWN, 200, AD, False) == "other", "another ad's page is not 'no listing'"
    assert L.render_kind(UNKNOWN, 503, SHELL, False) == "other"
    assert L.render_kind(UNKNOWN, 200, "<html>no state</html>", False) == "other"


def test_only_a_none_between_two_live_ads_counts():
    log = [("1", "ad"), ("2", "none"), ("3", "ad"), ("4", "none"), ("5", "other"),
           ("6", "none"), ("7", "none"), ("8", "ad")]
    assert L.bracketed_none(log) == ["2"], "4: next real render is 'other'; 6/7: preceded by 'other'"
    assert L.bracketed_none([("1", "none"), ("2", "ad")]) == [], "no live render before it"
    assert L.bracketed_none([("1", "ad"), ("2", "none"), ("3", "none"), ("4", "ad")]) == ["2", "3"]
    assert L.bracketed_none([]) == []


def test_shadow_writes_nothing():
    src = open(L.__file__, encoding="utf-8").read()
    shadow_uses = [ln for ln in src.splitlines() if "shadow" in ln and "decide(" in ln]
    assert not shadow_uses, "the shadow bracket must not feed a verdict"
    assert "shadow_bracketed_none=" in src
