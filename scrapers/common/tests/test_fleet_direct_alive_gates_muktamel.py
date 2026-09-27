"""muktamel direct-alive gate (fleet liveness, 2026-09-25): fetch_one's `own` flag must be True only
when the request landed on THIS id's own /real-estates/<id> page. Executes the real fetch_one with
the transport and the Nuxt evaluation stubbed; the gate under test is the landed-URL comparison."""
from __future__ import annotations

from scrapers.muktamel import run as MK


class _R:
    def __init__(self, status, url, text="<html>nuxt</html>"):
        self.status_code, self.url, self.text = status, url, text


class _S:
    def __init__(self, r):
        self._r = r

    def get(self, *_a, **_k):
        return self._r


_OFFER = {"offer": {"isAvailable": True, "price": 900000}}


def _run(monkeypatch, landed, status=200, offer=_OFFER):
    monkeypatch.setattr(MK, "_session", lambda: _S(_R(status, landed)))
    monkeypatch.setattr(MK, "_extract_nuxt", lambda html: "src")
    monkeypatch.setattr(MK, "_nuxt_via_node", lambda src: offer)
    monkeypatch.setattr(MK.time, "sleep", lambda *_: None)
    return MK.fetch_one(25866)


def test_own_page_is_this_listing(monkeypatch):
    assert _run(monkeypatch, "https://www.muktamel.com/real-estates/25866")[2] is True


def test_landing_on_another_listing_is_not_this_listing(monkeypatch):
    got = _run(monkeypatch, "https://www.muktamel.com/real-estates/31923")
    assert got is not None and got[2] is False


def test_redirect_to_404_returns_nothing(monkeypatch):
    assert _run(monkeypatch, "https://www.muktamel.com/404") is None


def test_unavailable_offer_returns_nothing(monkeypatch):
    assert _run(monkeypatch, "https://www.muktamel.com/real-estates/25866",
                offer={"offer": {"isAvailable": False, "price": None}}) is None
