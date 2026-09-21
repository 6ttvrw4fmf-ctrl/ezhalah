"""gathern may not deactivate a listing it merely failed to READ.

THE GAP THIS CLOSES. `scrapers/absence-only-prune.txt` carried gathern with the reason
"ORACLE EXISTS, NOT WIRED HERE": a tier-1 `DIRECT_REVISIT` platform with a full canary apparatus in
`scrapers/gathern/liveness.py`, whose `run.py` nevertheless reached `active = false` down a SECOND
path — two `db.prune_unseen()` calls with no `verify_gone`, killing on three consecutive crawl
misses with no source check at all. `docs/ops/LISTING_LIVENESS.md` §4.2 names both the fix ("route
the prune through the oracle that already exists — inventing nothing") and the hazard specific to
this platform ("any wiring there must go through its canary gate, not through `looks_dead()`
alone"). gathern is one of the four delete-ENABLED platforms, so an absence-only kill here starts
the 30-day clock that ends in a permanent, unrecoverable delete. (ops_incident #372.)

WHY THE CANARY IS THE LOAD-BEARING PART, MEASURED TWICE. §5.4 records gathern expressing BLOCKING as
its own application-rendered 404 rather than a 429 — 12/12 false deaths from datacenter egress on
rows its own oracle had verified alive minutes earlier. Re-measured 2026-09-21 from a cloud-routine
egress with 12 dead + 12 known-alive controls INTERLEAVED: the dead cohort answered 404 12/12, and
so did TEN OF THE TWELVE CONTROLS the crawl itself had served two hours earlier — every 404 a
byte-identical 50,511-byte page. An 83% false-death rate. On this platform a bare 404-means-gone
oracle is worse than none, and `test_the_2026_09_21_blocked_egress_kills_nothing` is that
measurement frozen as an executable case.

These run the REAL signal through the REAL law and the REAL `LivenessProbe`, against an injected
`fetch` — a test that read the source text would have passed for the entire time the defect was live
(AGENTS.md: "Barriers for this class must EXECUTE the function against an injected failure").

    python -m pytest scrapers/common/tests/test_gathern_absence_is_not_death.py -q
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
from scrapers.gathern import run as gathern  # noqa: E402

RUN_PY = pathlib.Path(gathern.__file__)

# A real row: ad_number GTH193856 → unit 193856 inside chalet 111024. The chalet id appears nowhere
# in the ad_number, which is exactly why the URL has to be read back rather than reconstructed.
AD = "GTH193856"
URL = "https://gathern.co/view/111024/unit/193856"

# The 50,511-byte application-rendered page gathern returns for BOTH a delisted unit and a client it
# has decided not to answer. Its indistinguishability is the whole problem.
BLOCK_PAGE = "<html>" + ("x" * 200) + "</html>"


# ── The shapes gathern's detail fetch actually produces ──────────────────────────────────────────
# (name, status, body, path_changed, may_this_kill)
SHAPES = [
    # The source itself answers. These, and only these, may kill.
    ("delisted_404",            404,  BLOCK_PAGE,                False, True),
    ("delisted_410",            410,  "<html>gone</html>",       False, True),
    # We never got an answer — this is about US, never about the listing. §5.4's whole lesson is
    # that on gathern the FIRST of these arrives disguised as the first row above, which is why a
    # status table alone cannot protect this platform and the canary has to exist.
    ("throttled_429",           429,  "<html>slow down</html>",  False, False),
    ("blocked_403",             403,  "<html>denied</html>",     False, False),
    ("proxy_407",               407,  "<html>auth</html>",       False, False),
    ("timeout_408",             408,  "<html>timeout</html>",    False, False),
    ("http_500",                500,  "<html>error</html>",      False, False),
    ("http_502",                502,  "<html>bad gw</html>",     False, False),
    ("http_503",                503,  "<html>down</html>",       False, False),
    ("network_error",           None, "",                        False, False),
    # We read something we cannot interpret as an answer.
    ("empty_body_404",          404,  "",                        False, False),
    ("empty_body_200",          200,  "",                        False, False),
    # The source is still serving it. Restorative, and never gated by a degraded run.
    ("live_200",                200,  "<html>a real unit</html>", False, False),
    # A redirect is not a removal signal on THIS platform (unlike souq24): no opinion either way.
    ("redirected_200",          200,  "<html>somewhere else</html>", True, False),
]


def _verdict(status, body, path_changed):
    """Run the REAL law over gathern's REAL signal. None == 'retry, then UNKNOWN'."""
    return http_liveness.decide(status, body, path_changed, gathern._oracle_signal)


@pytest.mark.parametrize("name,status,body,changed,may_kill", SHAPES,
                         ids=[s[0] for s in SHAPES])
def test_only_a_source_answer_may_kill(name, status, body, changed, may_kill):
    got = _verdict(status, body, changed)
    killed = got is not None and got[0] == "gone"
    assert killed == may_kill, (
        f"{name}: verdict={got!r} but may_kill={may_kill}. A read that does not carry an "
        f"affirmative removal from gathern must never deactivate a listing.")
    if not may_kill:
        assert got is None or got[0] in ("unknown", "live"), f"{name}: {got!r} is not held"
        if got is not None:
            assert got[1], f"{name}: a verdict with no reason is unfalsifiable (ops_incident #84)"


def test_the_signal_matches_the_sweep_that_already_runs():
    """run.py and liveness.py must not hold two opinions about one source.

    The signal here is `liveness.py::looks_dead`/`classify` verbatim; if the sweep's measurement is
    ever revised, this fails rather than letting the crawl keep killing on the old one.
    """
    from scrapers.gathern import liveness
    for status in (200, 404, 410, 403, 429, 500, 503):
        said = gathern._oracle_signal(status, "<html>body</html>", False)
        assert (said == "gone") == liveness.looks_dead(status), (
            f"HTTP {status}: run.py says {said!r}, liveness.py says "
            f"looks_dead={liveness.looks_dead(status)}")


# ── The canary: the part that makes this safe on THIS platform ───────────────────────────────────
def _fresh_canary_state():
    gathern._canary_pool.clear()
    gathern._canary_state.update(verdict=None, reason="not evaluated")
    gathern._oracle_url_memo.clear()


def test_the_2026_09_21_blocked_egress_kills_nothing():
    """THE MEASUREMENT, FROZEN. An egress answering 404 to live units must kill nothing.

    Reproduces the interleaved probe run on 2026-09-21: every read is a 404 carrying gathern's own
    block page, including the controls the crawl had just seen alive. Without the canary this run
    deactivates every row at grace; with it, every removal is withheld as UNKNOWN.
    """
    _fresh_canary_state()
    gathern._oracle_url_memo[AD] = URL
    gathern._oracle_url_memo["GTH269136"] = "https://gathern.co/view/143297/unit/269136"
    gathern.arm_liveness_canaries(["GTH269136"])
    try:
        gathern._probe.fetch = lambda _u: (404, BLOCK_PAGE, False)  # type: ignore[method-assign]
        verdict, note = gathern._probe.verify_gone(AD)
        assert verdict == "unknown", f"a blocked egress deactivated a listing: {verdict} / {note}"
        assert "withheld" in note, note
    finally:
        del gathern._probe.fetch
        _fresh_canary_state()


def test_canary_fails_closed_with_no_control():
    """No known-live control from this run ⇒ no removal. Fails CLOSED."""
    _fresh_canary_state()
    gathern._oracle_url_memo[AD] = URL
    try:
        ok, why = gathern._canary()
        assert ok is False and why, "an empty control pool must withhold removals"
        gathern._probe.fetch = lambda _u: (404, BLOCK_PAGE, False)  # type: ignore[method-assign]
        verdict, note = gathern._probe.verify_gone(AD)
        assert verdict == "unknown", f"removal not withheld despite no canary: {verdict}"
        assert "withheld" in note
    finally:
        del gathern._probe.fetch
        _fresh_canary_state()


def test_a_working_canary_lets_a_real_removal_through():
    """The control must not become a blanket veto — a validated oracle still kills."""
    probe = http_liveness.LivenessProbe(
        platform="gathern", signal=gathern._oracle_signal,
        session=gathern.detail_session, url_for=lambda _ad: URL,
        canary=lambda: (True, "control reads live"))
    probe.fetch = lambda _u: (404, BLOCK_PAGE, False)  # type: ignore[method-assign]
    assert probe.verify_gone(AD)[0] == "gone", "a validated oracle must still confirm a removal"


def test_the_canary_verdict_is_memoised_and_a_failure_sticks():
    """The control is a fact about the RUN, read once — and a FAILURE stays failed.

    `verify_gone` is called once per row at grace, so a per-row control would multiply a large
    run's requests for an answer that cannot differ between rows. Both directions must stick: a
    failed control re-rolled until it passed would be no control at all.
    """
    _fresh_canary_state()
    calls: list[int] = []
    gathern._oracle_url_memo["GTH269136"] = "https://gathern.co/view/143297/unit/269136"
    gathern.arm_liveness_canaries(["GTH269136"])
    try:
        gathern._probe.fetch = lambda _u: (calls.append(1), (404, BLOCK_PAGE, False))[1]  # type: ignore[method-assign]
        first = gathern._canary()
        assert first[0] is False, "a control reading GONE must withhold removals"
        for _ in range(5):
            assert gathern._canary() == first, "the memoised verdict changed between calls"
        assert len(calls) == 1, f"the control was re-fetched {len(calls)} times, not memoised"
    finally:
        del gathern._probe.fetch
        _fresh_canary_state()


def test_arming_resets_a_previous_runs_verdict():
    """A stale PASS must not authorise this run's removals."""
    _fresh_canary_state()
    gathern._canary_state.update(verdict=True, reason="a previous run's control")
    gathern.arm_liveness_canaries(["GTH269136"])
    assert gathern._canary_state["verdict"] is None, "a stale canary verdict survived re-arming"
    _fresh_canary_state()


# ── Identity: never kill a row on another listing's evidence ─────────────────────────────────────
def test_url_for_refuses_a_stored_url_belonging_to_another_unit():
    """LISTING_LIVENESS.md §4.2 lesson 2: 39 of 1,724 sanadak rows stored another listing's page.

    gathern's path carries the unit id, so the identity IS checkable — and a mismatch must produce
    no URL at all, which the probe reports as UNKNOWN rather than probing someone else's page.
    """
    class _Res:
        def __init__(self, url): self.data = [{"listing_url": url}]

    class _Tbl:
        def __init__(self, url): self._url = url
        def select(self, *_a): return self
        def eq(self, *_a): return self
        def limit(self, *_a): return self
        def execute(self): return _Res(self._url)

    real_sb = gathern.db.sb
    try:
        # A URL for a DIFFERENT unit inside a plausible chalet — the shape that produced three false
        # resurrections on sanadak.
        gathern.db.sb = lambda: types.SimpleNamespace(  # type: ignore[assignment]
            table=lambda _t: _Tbl("https://gathern.co/view/111024/unit/999999"))
        gathern._oracle_url_memo.clear()
        assert gathern._oracle_url_for(AD) is None, "probed a URL that addresses a different unit"
        assert gathern._probe.verify_gone(AD)[0] == "unknown"

        # The row's own URL resolves normally.
        gathern.db.sb = lambda: types.SimpleNamespace(  # type: ignore[assignment]
            table=lambda _t: _Tbl(URL))
        gathern._oracle_url_memo.clear()
        assert gathern._oracle_url_for(AD) == URL
    finally:
        gathern.db.sb = real_sb  # type: ignore[assignment]
        gathern._oracle_url_memo.clear()


def test_url_for_refuses_a_key_that_is_not_a_gathern_ad_number():
    for bogus in ("193856", "GTH", "GTHabc", "", "XX193856"):
        gathern._oracle_url_memo.clear()
        assert gathern._oracle_url_for(bogus) is None, f"{bogus!r} must not resolve to a URL"
    gathern._oracle_url_memo.clear()


def test_a_failed_url_lookup_is_unknown_not_death():
    """A database we could not read tells us nothing about the listing."""
    real_sb = gathern.db.sb
    try:
        def _boom():
            raise RuntimeError("supabase unreachable")
        gathern.db.sb = _boom  # type: ignore[assignment]
        gathern._oracle_url_memo.clear()
        assert gathern._oracle_url_for(AD) is None
        assert gathern._probe.verify_gone(AD)[0] == "unknown"
    finally:
        gathern.db.sb = real_sb  # type: ignore[assignment]
        gathern._oracle_url_memo.clear()


def test_a_broken_signal_is_unknown_not_death():
    """A signal that raises tells us nothing about the listing (the law decides, not the platform)."""
    def _boom(*_a):
        raise RuntimeError("parser blew up")
    got = http_liveness.decide(404, "<html/>", False, _boom)
    assert got == ("unknown", "the platform signal raised RuntimeError: parser blew up")


# ── Structural: the oracle must actually reach every deactivation path ───────────────────────────
def test_every_prune_call_site_passes_the_oracle():
    """Structural, not textual: read the AST of the real call and check its keywords.

    gathern reaches `active = false` from TWO places — the full-crawl prune and the cross-shard
    `--prune-from` union — and a fix applied to one of them leaves the other killing on absence.
    """
    tree = ast.parse(RUN_PY.read_text())
    calls = [n for n in ast.walk(tree)
             if isinstance(n, ast.Call)
             and (getattr(n.func, "attr", None) == "prune_unseen"
                  or getattr(n.func, "id", None) == "prune_unseen")]
    assert len(calls) >= 2, (
        f"expected both gathern prune paths, found {len(calls)} — has one moved or been added?")
    for c in calls:
        kw = {k.arg for k in c.keywords}
        assert "verify_gone" in kw, (
            f"prune_unseen at line {c.lineno} can deactivate on absence alone: "
            f"keywords={sorted(x for x in kw if x)}")
        assert None not in kw, (
            f"prune_unseen at line {c.lineno} passes **kwargs, so whether an oracle reaches it "
            "cannot be read from the call site")


def test_every_prune_call_site_arms_a_canary_first():
    """An oracle with an unarmed canary kills NOTHING, so a missing arming call is a silent outage
    of the prune rather than a safety hole — but it is still a defect, and it is invisible without
    this. Assert the arming happens in the same function body as each prune call."""
    tree = ast.parse(RUN_PY.read_text())
    for fn in [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]:
        prunes = [n for n in ast.walk(fn) if isinstance(n, ast.Call)
                  and getattr(n.func, "attr", None) == "prune_unseen"]
        if not prunes:
            continue
        armed = [n for n in ast.walk(fn) if isinstance(n, ast.Call)
                 and getattr(n.func, "id", None) == "arm_liveness_canaries"]
        assert len(armed) >= len(prunes), (
            f"{fn.name}() prunes {len(prunes)}x but arms the canary {len(armed)}x — an unarmed "
            "canary withholds every removal, so this prune would silently stop working")


def test_the_oracle_reuses_one_throttled_session():
    """Connection reuse and rate limiting, on a source where a burst LOOKS like a removal.

    gathern 429s above ~2 req/s (`liveness.py` pins MIN_INTERVAL at 1.0) and expresses blocking as
    its own 404 (§5.4) — so an unthrottled, session-per-request oracle would provoke exactly the
    response it cannot distinguish from a delisting. The canary keeps that HONEST (every kill would
    be withheld); throttling is what keeps the oracle USEFUL. `LivenessProbe.fetch()` acquires the
    session once per request, so throttling on acquire is exactly once per probe.
    """
    calls: list[int] = []
    real_throttle, real_detail = gathern._throttle, gathern.detail_session
    gathern._oracle_session_memo.clear()
    try:
        gathern._throttle = lambda: calls.append(1)  # type: ignore[assignment]
        gathern.detail_session = lambda: object()    # type: ignore[assignment]
        first = gathern._oracle_session()
        for _ in range(4):
            assert gathern._oracle_session() is first, "a new session was minted per probe"
        assert len(calls) == 5, f"throttled {len(calls)} times for 5 acquisitions"
    finally:
        gathern._throttle, gathern.detail_session = real_throttle, real_detail
        gathern._oracle_session_memo.clear()


def test_the_probe_is_wired_to_the_throttled_session():
    """Structural: the probe must not be handed the raw session factory."""
    assert gathern._probe.session is gathern._oracle_session, (
        "LivenessProbe was given a session factory that does not throttle or reuse")
