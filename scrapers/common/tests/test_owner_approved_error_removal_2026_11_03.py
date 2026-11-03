"""Owner rule 2026-11-03: alshawaf/bossbih (403) and aqaratikom (500) answer a REMOVED ad with an error.
Such an ad is hidden only on two identical error reads while a live control of the same site reads LIVE in
the same check. Every other site, status, redirect or missing control stays UNKNOWN, and the universal law
(decide / read_is_unbelievable) is untouched."""
import json

import pytest

from scrapers.common import http_liveness as L

AD, CTRL = "https://x.test/ad/1", "https://x.test/ad/2"
live_sig = lambda st, body, moved: "live" if st == 200 and body == "LIVE" else None  # noqa: E731


def fetcher(answers):
    calls = []

    def fetch(url):
        calls.append(url)
        return answers[url].pop(0)
    return fetch, calls


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(L.time, "sleep", lambda *_: None)


def test_two_reads_of_the_approved_status_with_a_live_control_is_gone():
    f, calls = fetcher({AD: [(403, "x", False), (403, "x", False)], CTRL: [(200, "LIVE", False)]})
    v = L.removal_by_owner_approved_status("alshawaf", f, AD, CTRL, live_sig)
    assert v and v[0] == "gone" and "owner rule" in v[1]
    assert calls == [AD, AD, CTRL]


@pytest.mark.parametrize("platform,answers,ctrl", [
    ("aqar", [(403, "x", False), (403, "x", False)], [(200, "LIVE", False)]),       # not an approved site
    ("alshawaf", [(500, "x", False), (500, "x", False)], [(200, "LIVE", False)]),   # not ITS status
    ("aqaratikom", [(403, "x", False), (403, "x", False)], [(200, "LIVE", False)]),
    ("alshawaf", [(403, "x", False), (200, "LIVE", False)], [(200, "LIVE", False)]),  # second read differs
    ("alshawaf", [(403, "x", True), (403, "x", False)], [(200, "LIVE", False)]),    # redirected
    ("alshawaf", [(403, "x", False), (403, "x", False)], [(403, "x", False)]),      # control blocked too
    ("bossbih", [(403, "x", False), (403, "x", False)], [(200, "shell", False)]),   # control not live
])
def test_anything_short_of_the_full_proof_decides_nothing(platform, answers, ctrl):
    f, _ = fetcher({AD: list(answers), CTRL: list(ctrl)})
    assert L.removal_by_owner_approved_status(platform, f, AD, CTRL, live_sig) is None


def test_no_control_or_control_is_the_ad_itself_decides_nothing():
    f, calls = fetcher({AD: [(403, "x", False)] * 2})
    assert L.removal_by_owner_approved_status("alshawaf", f, AD, None, live_sig) is None
    assert L.removal_by_owner_approved_status("alshawaf", f, AD, AD, live_sig) is None
    assert calls == []


def test_the_universal_law_is_unchanged():
    assert L.read_is_unbelievable(403, "x") is not None
    assert L.read_is_unbelievable(500, "x") is not None
    assert L.decide(403, "x", False, lambda *a: "gone") is None
    assert set(L.OWNER_APPROVED_REMOVAL_STATUS) == {"alshawaf", "bossbih", "aqaratikom"}


# ── wired into each site's oracle ──────────────────────────────────────────────────────────────────
def _wire(monkeypatch, mod, answers, control):
    monkeypatch.setattr(mod, "live_control_url", lambda *a, **k: control, raising=False)
    monkeypatch.setattr(L, "live_control_url", lambda *a, **k: control)
    monkeypatch.setattr(L.LivenessProbe, "fetch", lambda self, url: answers[url].pop(0))


def test_alshawaf_unpublished_node_is_gone_and_a_blocked_one_without_control_is_not(monkeypatch):
    from scrapers.alshawaf import run
    ad, ctrl = f"{run.BASE}/12605", f"{run.BASE}/19000"
    monkeypatch.setattr(run, "parse_detail", lambda body, nid: {"fields": {}} if body == f"LIVE{nid}" else {})
    _wire(monkeypatch, run, {ad: [(403, "d", False)] * 4, ctrl: [(200, "LIVE19000", False)]}, ctrl)
    assert run._verify_gone(f"{run.PREFIX}12605")[0] == "gone"
    _wire(monkeypatch, run, {ad: [(403, "d", False)] * 4}, None)
    assert run._verify_gone(f"{run.PREFIX}12605")[0] == "unknown"


def test_bossbih_unpublished_node_is_gone_with_a_live_control(monkeypatch):
    from scrapers.bossbih import run
    ad, ctrl = f"{run.BASE}/12603", f"{run.BASE}/14000"
    monkeypatch.setattr(run, "parse_detail", lambda body: {"title": "", "fields": {}})
    live_page = 'data-history-node-id="14000"'
    _wire(monkeypatch, run, {ad: [(403, "d", False)] * 4, ctrl: [(200, live_page, False)]}, ctrl)
    assert run._verify_gone(f"{run.PREFIX}12603")[0] == "gone"


U1, U2 = "f05fcfbf-df33-4841-b0b0-40dfeef78229", "34a5f533-5937-49ff-94c9-cc52fa619373"


def _aq(monkeypatch, answers, control_uuid=U2):
    from scrapers.aqaratikom import run
    monkeypatch.setattr(L, "stored_listing_url", lambda t: (lambda ad: f"https://nawait.sa/real-estate/{U1}"))
    monkeypatch.setattr(L, "live_control_url",
                        lambda *a, **k: control_uuid and f"https://nawait.sa/real-estate/{control_uuid}")
    monkeypatch.setattr(L.LivenessProbe, "fetch", lambda self, url: answers[url].pop(0))
    return run


def rec(uuid, sold=False):
    return json.dumps({"data": {"id": uuid, "is_sold": sold}})


def test_aqaratikom_record_states_the_verdict(monkeypatch):
    run = _aq(monkeypatch, {})
    api1 = f"{run.BASE}/ad/{U1}"
    run = _aq(monkeypatch, {api1: [(200, rec(U1), False)]})
    assert run._verify_gone("AQTK1")[0] == "live"
    run = _aq(monkeypatch, {api1: [(200, rec(U1, sold=True), False)]})
    assert run._verify_gone("AQTK1")[0] == "gone"
    run = _aq(monkeypatch, {api1: [(404, "{}", False)]})
    assert run._verify_gone("AQTK1")[0] == "gone"


def test_aqaratikom_500_is_gone_only_with_a_live_control(monkeypatch):
    from scrapers.aqaratikom import run
    api1, api2 = f"{run.BASE}/ad/{U1}", f"{run.BASE}/ad/{U2}"
    _aq(monkeypatch, {api1: [(500, "e", False)] * 4, api2: [(200, rec(U2), False)]})
    assert run._verify_gone("AQTK1")[0] == "gone"
    _aq(monkeypatch, {api1: [(500, "e", False)] * 4, api2: [(500, "e", False)]})
    assert run._verify_gone("AQTK1")[0] == "unknown"
    _aq(monkeypatch, {api1: [(500, "e", False)] * 4}, control_uuid=None)
    assert run._verify_gone("AQTK1")[0] == "unknown"
