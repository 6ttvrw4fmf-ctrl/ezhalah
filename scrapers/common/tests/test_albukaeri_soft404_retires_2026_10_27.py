"""Albukaeri: a removed ad answers 200 as an empty shell — its own page must retire it (2026-10-27).

The shell's <title> is just «  | البكيري» (~15.5 KB) with no property block; a live ad has a real
title and the block (~66 KB). prune_unseen refused (-1) and the 404-only fallback read the shell live.
"""
from __future__ import annotations

from scrapers.albukaeri import run as R

GONE_ID, LIVE_ID, SEEN_ID = "a" * 24, "b" * 24, "c" * 24
SHELL = "<html><head><title>  | البكيري</title></head><body>" + "x" * 15000 + "</body></html>"
LIVE = ('<html><head><title>شقة للبيع في الرياض | البكيري</title></head><body>'
        '<h1 class="prop-hero-title">شقة للبيع في الرياض</h1>' + "x" * 60000 + "</body></html>")


class _Resp:
    def __init__(self, status, text=""):
        self.status_code, self.text = status, text


class _S:
    def __init__(self, pages):
        self.pages, self.calls = pages, []

    def get(self, url, timeout=None, **kw):
        self.calls.append(url)
        v = self.pages.get(url)
        if v is None or isinstance(v, Exception):
            raise v or ConnectionError(url)
        return v


def _url(pid):
    return f"{R.BASE}/property/{pid}"


def _vg(pages, controls=(SEEN_ID,)):
    s = _S({_url(SEEN_ID): _Resp(200, LIVE), **{_url(k): v for k, v in pages.items()}})
    return R.make_verify_gone(s, {R.PREFIX + c for c in controls}), s


def test_empty_shell_reads_gone_with_a_live_control():
    vg, _ = _vg({GONE_ID: _Resp(200, SHELL)})
    v, why = vg(R.PREFIX + GONE_ID)
    assert v == "gone" and "empty shell" in why


def test_404_reads_gone_with_a_live_control():
    vg, _ = _vg({GONE_ID: _Resp(404)})
    assert vg(R.PREFIX + GONE_ID)[0] == "gone"


def test_real_page_reads_live():
    vg, _ = _vg({LIVE_ID: _Resp(200, LIVE)})
    assert vg(R.PREFIX + LIVE_ID)[0] == "live"


def test_errors_and_half_pages_read_unknown():
    ids = {"1" * 24: ConnectionError("reset"), "2" * 24: _Resp(403), "3" * 24: _Resp(502),
           "4" * 24: _Resp(200, "<html><title>Just a moment...</title></html>"),   # a challenge page
           "5" * 24: _Resp(200, "<html><title>  | البكيري</title><h1 class=\"prop-hero-title\">x</h1></html>"),
           "6" * 24: _Resp(200, "")}
    vg, _ = _vg(ids)
    for pid in ids:
        assert vg(R.PREFIX + pid)[0] == "unknown", pid
    assert vg("BKRnot-an-id")[0] == "unknown"


def test_control_not_live_turns_gone_into_unknown():
    for control in (_Resp(200, SHELL), _Resp(429), ConnectionError("down")):
        s = _S({_url(GONE_ID): _Resp(200, SHELL), _url(SEEN_ID): control})
        assert R.make_verify_gone(s, {R.PREFIX + SEEN_ID})(R.PREFIX + GONE_ID)[0] == "unknown"
    vg, _ = _vg({GONE_ID: _Resp(200, SHELL)}, controls=())
    assert vg(R.PREFIX + GONE_ID)[0] == "unknown", "no control at all"


def test_control_is_read_once_per_run():
    vg, s = _vg({GONE_ID: _Resp(200, SHELL), "d" * 24: _Resp(200, SHELL)})
    assert vg(R.PREFIX + GONE_ID)[0] == vg(R.PREFIX + "d" * 24)[0] == "gone"
    assert s.calls.count(_url(SEEN_ID)) == 1


def test_refused_prune_hands_the_unseen_ads_to_the_oracle(monkeypatch):
    calls = {}
    monkeypatch.setattr(R.db, "prune_unseen", lambda tbl, seen, **kw: -1)

    def fake_strike(tbl, seen, source, verify_gone=None, **kw):
        calls.update(tbl=tbl, seen=set(seen), source=source, vg=verify_gone, kw=kw)
        return 2
    monkeypatch.setattr(R.db, "strike_read_gone", fake_strike)
    vg = object()
    assert R.prune_table("albukaeri_residential_listings", {"BKRa"}, vg) == 2
    assert calls["vg"] is vg and calls["source"] == R.SOURCE and calls["seen"] == {"BKRa"}
    assert "grace" not in calls["kw"], "the default 3 strikes are kept"


def test_a_normal_prune_does_not_read_pages(monkeypatch):
    monkeypatch.setattr(R.db, "prune_unseen", lambda tbl, seen, **kw: 0)
    monkeypatch.setattr(R.db, "strike_read_gone",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not read")))
    assert R.prune_table("t", {"BKRa"}, object()) == 0
