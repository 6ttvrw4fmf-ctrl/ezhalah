"""The dealapp sweep counts, in SHADOW, the struck rows the crawl's bracketed no-listing oracle
would call gone (2026-10-23, backlog 766). 60 shown dealapp ads at 3+ strikes read UNKNOWN to every
reader: a removed ad renders dealapp's bogus-id shell. Only an ORIGIN render with no listing,
between two live-ad renders on the same runner, counts; since 10-24 a bracketed struck row is one DIRECT strike."""
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


def _row(adid, mc):
    return {"id": int(adid), "listing_url": f"https://dealapp.sa/ar/ad-details/{adid}", "missing_count": mc}


def test_a_bracketed_struck_unknown_becomes_one_direct_strike():
    """Promoted 2026-10-24: 124 shadow ads, 0 read alive since. One strike per reading, grace unchanged."""
    from scrapers.common.liveness_policies import policy_for
    pol = policy_for("dealapp")
    pending = [(_row(1, 1), "none", 1, 200, "t"),     # struck, bracketed  -> strike 2
               (_row(2, 2), "none", 2, 200, "t"),     # struck, bracketed  -> grace -> deactivate
               (_row(3, 0), "none", 0, 200, "t"),     # never struck: the bracket alone never starts one
               (_row(4, 1), "none", 1, 200, "t"),     # struck, not bracketed: stays UNKNOWN
               (_row(5, 1), "reset", 0, 200, "t")]    # read ALIVE: an alive answer always wins
    out, n = L.promote_bracketed(pending, {"1", "2", "3", "5"}, pol)
    acts = {r["id"]: (a, k) for r, a, k, _s, _t in out}
    assert n == 2
    assert acts[1] == ("strike", 2)
    assert acts[2][0] == "deactivate" and acts[2][1] == 3
    assert acts[3] == ("none", 0) and acts[4] == ("none", 1) and acts[5] == ("reset", 0)


def test_the_run_note_reports_the_bracket():
    src = open(L.__file__, encoding="utf-8").read()
    assert "bracketed_none=" in src and "bracketed_dead=" in src
    assert "= promote_bracketed(pending, set(bracketed), policy)" in src, "the sweep must apply the promotion before the trust gate"
