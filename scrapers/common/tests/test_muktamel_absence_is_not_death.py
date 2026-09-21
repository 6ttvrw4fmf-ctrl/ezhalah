"""muktamel may not deactivate a listing it merely failed to READ.

THE INCIDENT (measured, 2026-09-21 04:54 UTC). 94 `muktamel_residential_listings` rows were set
`active = false` with `missing_count = 3` and **no source verdict recorded for any of them** —
`mon_detect_unknown_treated_as_dead` raised P1 alert 4344 at 04:59 with
`without_direct_evidence: 94`. muktamel is declared `CRAWL_PRESENCE_ONLY`, the tier
`liveness_policies.py` itself describes as one that "CANNOT satisfy the owner rule".

Root cause was not the crawl and not the cadence. `fetch_one()` returns None for SEVEN reasons and
`prune_unseen` saw one: "not in rows_seen". Per shard, the 2026-09-21 runs logged ~85-90 reads that
told us nothing about the listing (`http_500` 51-58, `network_Timeout` 29, `no_html_after_retries`
3-5) next to 84-98 genuine removals. The weekly→daily cadence change (#3429) only changed how fast
the third strike arrived — three days instead of three weeks.

So this file executes muktamel's REAL signal through the REAL law for every shape its own fetch path
produces, because a test that reads the source text would have passed for the whole time the defect
was live (AGENTS.md: "Barriers for this class must EXECUTE the function against an injected
failure"). The invariant, one line: only a DIRECT answer from the source may kill.

    python -m pytest scrapers/common/tests/test_muktamel_absence_is_not_death.py -q
"""
from __future__ import annotations

import ast
import pathlib
import sys
import types

import pytest

# ── Hermetic import: stub the network + credential deps so run.py imports offline ────────────────
for name, attrs in (
    ("supabase", {"Client": type("Client", (), {}), "create_client": lambda *a, **k: None}),
    ("dotenv", {"load_dotenv": lambda *a, **k: None}),
    # The real HTTP client is never used here — every probe goes through an injected `fetch`.
    ("curl_cffi", {}),
    ("curl_cffi.requests", {"Session": type("Session", (), {})}),
):
    if name not in sys.modules:
        m = types.ModuleType(name)
        for k, v in attrs.items():
            setattr(m, k, v)
        sys.modules[name] = m
sys.modules["curl_cffi"].requests = sys.modules["curl_cffi.requests"]

from scrapers.common import http_liveness  # noqa: E402
from scrapers.muktamel import run as muktamel  # noqa: E402

RUN_PY = pathlib.Path(muktamel.__file__)


# ── The shapes muktamel's own fetch path actually produces ───────────────────────────────────────
# (name, status, body, path_changed, may_this_kill)
#
# Names are the exact keys muktamel writes into its `_outcomes` counter, so a reader can line each
# row up against a real production run's notes string in `scrape_runs`.
SHAPES = [
    # The source itself answers. These, and only these, may kill.
    ("dead_404",                    404,  "<html>not found</html>", False, True),
    ("dead_410",                    410,  "<html>gone</html>",      False, True),
    ("redirect_404",                200,  "<html>404 page</html>",  True,  True),
    # We never got an answer — this is about US, never about the listing.
    ("http_500",                    500,  "<html>error</html>",     False, False),
    ("http_502",                    502,  "<html>bad gw</html>",    False, False),
    ("http_503",                    503,  "<html>down</html>",      False, False),
    ("network_Timeout",             None, "",                       False, False),
    ("network_ConnectionError",     None, "",                       False, False),
    ("no_html_after_retries",       None, "",                       False, False),
    ("blocked_403",                 403,  "<html>denied</html>",    False, False),
    ("throttled_429",               429,  "<html>slow down</html>", False, False),
    ("proxy_407",                   407,  "<html>auth</html>",      False, False),
    # We read something, but our own parser could not make sense of it.
    ("no_nuxt_payload",             200,  "<html>no nuxt</html>",   False, False),
    ("unparseable_or_no_offer",     200,  "<html>__NUXT__=1</html>", False, False),
    # Read fine; the source has not said "removed" (see run.py's note on the conjunction).
    ("not_available_or_zero_price", 200,  '<html>isAvailable</html>', False, False),
    ("live",                        200,  "<html>a real listing</html>", False, False),
    # A body we could not read cannot carry a death, even with the removal signal present.
    ("redirect_404_empty_body",     200,  "",                       True,  False),
    ("http_500_and_redirected",     500,  "<html>error</html>",     True,  False),
]


def _verdict(status, body, path_changed):
    """Run the REAL law over muktamel's REAL signal. None == 'retry, then UNKNOWN'."""
    return http_liveness.decide(status, body, path_changed, muktamel._liveness_signal)


@pytest.mark.parametrize("name,status,body,changed,may_kill", SHAPES,
                         ids=[s[0] for s in SHAPES])
def test_only_a_source_answer_may_kill(name, status, body, changed, may_kill):
    got = _verdict(status, body, changed)
    killed = got is not None and got[0] == "gone"
    assert killed == may_kill, (
        f"{name}: verdict={got!r} but may_kill={may_kill}. A read that does not carry an "
        f"affirmative removal from muktamel must never deactivate a listing.")
    if not may_kill:
        # Never a silent kill AND never a fabricated life: it is UNKNOWN or a retry, with a reason.
        assert got is None or got[0] == "unknown", f"{name}: {got!r} is neither held nor unknown"
        if got is not None:
            assert got[1], f"{name}: an UNKNOWN with no reason is unfalsifiable (ops_incident #84)"


def test_the_94_row_incident_shapes_are_all_held():
    """The exact reads that produced the 94 kills must now all be UNKNOWN, not death."""
    for name, status, body, changed, _ in SHAPES:
        if name in ("http_500", "network_Timeout", "no_html_after_retries"):
            got = _verdict(status, body, changed)
            assert got is None or got[0] != "gone", f"{name} still kills: {got!r}"


def test_a_broken_signal_is_unknown_not_death():
    """A signal that raises tells us nothing about the listing (law, not platform, decides)."""
    def _boom(*_a):
        raise RuntimeError("parser blew up")
    got = http_liveness.decide(404, "<html/>", False, _boom)
    assert got == ("unknown", "the platform signal raised RuntimeError: parser blew up")


def test_url_for_addresses_this_listing_or_refuses():
    """A kill on a row we cannot address is never allowed; a bad key must yield None."""
    assert muktamel._probe.url_for("MK25816") == "https://www.muktamel.com/real-estates/25816"
    for bogus in ("25816", "MK", "MKabc", "", "XX25816"):
        assert muktamel._probe.url_for(bogus) is None, f"{bogus!r} must not resolve to a URL"


def test_canary_fails_closed_with_no_control():
    """No known-live control id from this run ⇒ no removal. Fails CLOSED."""
    saved = list(muktamel._canary_ids)
    muktamel._canary_ids.clear()
    muktamel._canary_state.update(verdict=None, reason="not evaluated")
    try:
        ok, why = muktamel._canary()
        assert ok is False and why, "an empty control set must withhold removals"
        # And the probe must actually consult it: a 'gone' read becomes UNKNOWN.
        muktamel._probe.fetch = lambda _url: (404, "<html>not found</html>", False)
        verdict, note = muktamel._probe.verify_gone("MK25816")
        assert verdict == "unknown", f"removal not withheld despite a failing canary: {verdict}"
        assert "withheld" in note
    finally:
        muktamel._canary_ids[:] = saved
        muktamel._canary_state.update(verdict=None, reason="not evaluated")
        del muktamel._probe.fetch


def test_a_working_canary_lets_a_real_removal_through():
    """The control must not become a blanket veto — a validated oracle still kills."""
    saved = list(muktamel._canary_ids)
    muktamel._canary_ids[:] = [31999]
    try:
        probe = http_liveness.LivenessProbe(
            platform="muktamel", signal=muktamel._liveness_signal,
            session=muktamel._session, url_for=muktamel._probe.url_for,
            canary=lambda: (True, "control reads live"))
        probe.fetch = lambda _url: (404, "<html>not found</html>", False)  # type: ignore[method-assign]
        assert probe.verify_gone("MK25816")[0] == "gone"
    finally:
        muktamel._canary_ids[:] = saved


def test_the_canary_verdict_is_memoised_for_the_run():
    """The control is a fact about the RUN, so it is read once — and a FAILURE stays failed.

    `verify_gone` is called once per row at grace, so a per-row control would multiply a 94-kill
    run's requests for an answer that cannot differ between rows. Both directions must stick: a
    failed control that got re-rolled until it passed would be no control at all.
    """
    saved, calls = list(muktamel._canary_ids), []
    muktamel._canary_ids[:] = [31999]
    muktamel._canary_state.update(verdict=None, reason="not evaluated")
    real_session = muktamel._session
    try:
        class _R:
            status_code, text, url = 404, "<html>not found</html>", "https://www.muktamel.com/404"
        muktamel._session = lambda: type("S", (), {"get": lambda _s, *a, **k: (calls.append(1), _R())[1]})()  # type: ignore[assignment]
        first = muktamel._canary()
        assert first[0] is False, "a control reading GONE must withhold removals"
        for _ in range(5):
            assert muktamel._canary() == first, "the memoised verdict changed between calls"
        assert len(calls) == 1, f"the control was re-fetched {len(calls)} times, not memoised"
    finally:
        muktamel._session = real_session  # type: ignore[assignment]
        muktamel._canary_ids[:] = saved
        muktamel._canary_state.update(verdict=None, reason="not evaluated")


def test_every_prune_call_site_passes_the_oracle():
    """Structural, not textual: read the AST of the real call and check its keywords.

    The defect was an ABSENT keyword argument, so the thing to assert is the argument list of the
    call the interpreter will make — not that the file mentions `verify_gone` somewhere.
    """
    tree = ast.parse(RUN_PY.read_text())
    calls = [n for n in ast.walk(tree)
             if isinstance(n, ast.Call)
             and (getattr(n.func, "attr", None) == "prune_unseen"
                  or getattr(n.func, "id", None) == "prune_unseen")]
    assert calls, "no prune_unseen call found — has the deactivation path moved?"
    for c in calls:
        kw = {k.arg for k in c.keywords}
        assert "verify_gone" in kw, (
            f"prune_unseen at line {c.lineno} can deactivate on absence alone: "
            f"keywords={sorted(x for x in kw if x)}")
        assert None not in kw, (
            f"prune_unseen at line {c.lineno} passes **kwargs, so whether an oracle reaches it "
            "cannot be read from the call site")
