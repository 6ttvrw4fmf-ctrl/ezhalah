"""SuperOffice: a booked office answers 200 with «محجوز» — its own page must retire it (2026-10-27).

The crawl skips booked offices, more than 30% of the table went unseen, prune_unseen refused (-1)
and the 404-only fallback read every booked page live, so 13 booked offices stayed on screen.
"""
from __future__ import annotations

from scrapers.superoffice import run as R

BOOKED = ('<div class="content-one"><div class="actions_div">\n'
          '  <a class="alert_btn" href="javascript:void(0)">محجوز</a></div></div>')
LIVE = ('<div class="content-one"><div class="actions_div">\n'
        '  <a class="btn" href="https://superoffice.sa/book/12">احجز</a></div></div>')


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


def _url(slug):
    return f"{R.BASE}/ar/office-details/{slug}"


def _session(**pages):
    return _S({_url(k.replace("_", "-")): v for k, v in pages.items()})


def test_booked_page_reads_gone_with_a_live_control():
    s = _session(private_office_2G_al_aarid=_Resp(200, BOOKED), seen_a=_Resp(200, LIVE))
    vg = R.make_verify_gone(s, {"SPOseen-a"})
    v, why = vg("SPOprivate-office-2G-al-aarid")
    assert v == "gone" and "محجوز" in why


def test_404_reads_gone_with_a_live_control():
    s = _session(old=_Resp(404), seen_a=_Resp(200, LIVE))
    assert R.make_verify_gone(s, {"SPOseen-a"})("SPOold")[0] == "gone"


def test_bookable_page_reads_live():
    s = _session(free=_Resp(200, LIVE), seen_a=_Resp(200, LIVE))
    assert R.make_verify_gone(s, {"SPOseen-a"})("SPOfree")[0] == "live"


def test_network_error_and_blocks_read_unknown():
    s = _session(boom=ConnectionError("reset"), blocked=_Resp(403), busy=_Resp(503),
                 odd=_Resp(200, "<html>no actions row</html>"), seen_a=_Resp(200, LIVE))
    vg = R.make_verify_gone(s, {"SPOseen-a"})
    for ad in ("SPOboom", "SPOblocked", "SPObusy", "SPOodd"):
        assert vg(ad)[0] == "unknown", ad


def test_control_not_live_turns_gone_into_unknown():
    for control in (_Resp(200, BOOKED), _Resp(429), ConnectionError("down")):
        s = _session(private_office_2G_al_aarid=_Resp(200, BOOKED), seen_a=control)
        v, _ = R.make_verify_gone(s, {"SPOseen-a"})("SPOprivate-office-2G-al-aarid")
        assert v == "unknown"
    s = _session(private_office_2G_al_aarid=_Resp(200, BOOKED))
    assert R.make_verify_gone(s, set())("SPOprivate-office-2G-al-aarid")[0] == "unknown", "no control at all"


def test_control_is_read_once_per_run():
    s = _session(a=_Resp(200, BOOKED), b=_Resp(200, BOOKED), seen_a=_Resp(200, LIVE))
    vg = R.make_verify_gone(s, {"SPOseen-a"})
    assert vg("SPOa")[0] == vg("SPOb")[0] == "gone"
    assert s.calls.count(_url("seen-a")) == 1


def test_refused_prune_hands_the_unseen_offices_to_the_oracle(monkeypatch):
    calls = {}
    monkeypatch.setattr(R.db, "prune_unseen", lambda tbl, seen, **kw: -1)

    def fake_strike(tbl, seen, source, verify_gone=None, **kw):
        calls.update(tbl=tbl, seen=set(seen), source=source, vg=verify_gone, kw=kw)
        return 13
    monkeypatch.setattr(R.db, "strike_read_gone", fake_strike)
    vg = object()
    assert R.prune_table("superoffice_commercial_listings", {"SPOa"}, vg) == 13
    assert calls["vg"] is vg and calls["source"] == R.SOURCE and calls["seen"] == {"SPOa"}
    assert "grace" not in calls["kw"], "the default 3 strikes are kept"


def test_a_normal_prune_does_not_read_pages(monkeypatch):
    monkeypatch.setattr(R.db, "prune_unseen", lambda tbl, seen, **kw: 0)
    monkeypatch.setattr(R.db, "strike_read_gone",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not read")))
    assert R.prune_table("t", {"SPOa"}, object()) == 0
