"""Direct-alive stamp gates added to crawls on 2026-09-25 (owner: fleet-wide liveness).

A crawl may call db.mark_direct_alive only for a row built from a fetch of THAT listing's own page
that the platform's own liveness test would read as alive. These tests execute each gate against
pages shaped like the source's real live, dead and redirected answers.
"""
from __future__ import annotations

from scrapers.aqarcity import run as AC


class _R:
    def __init__(self, status, url, text):
        self.status_code, self.url, self.text = status, url, text


class _S:
    def __init__(self, landed, text, status=200):
        self._r = _R(status, landed, text)

    def get(self, *_a, **_k):
        return self._r


_LIVE = '<script type="application/ld+json">{"@type":"Product"}</script>'
_EXPIRED = _LIVE + "<div>هذا الإعلان منتهي</div>"


def _fetch(monkeypatch, landed, text, status=200, url="https://aqarcity.net/property/123"):
    monkeypatch.setattr(AC, "_session", lambda: _S(landed, text, status))
    monkeypatch.setattr(AC.time, "sleep", lambda *_: None)
    return AC.fetch_one(url)


def test_aqarcity_own_page_sets_the_identity_flag(monkeypatch):
    body, url, own = _fetch(monkeypatch, "https://aqarcity.net/property/123", _LIVE)
    assert own is True


def test_aqarcity_redirect_to_another_listing_is_not_this_listing(monkeypatch):
    _b, _u, own = _fetch(monkeypatch, "https://aqarcity.net/property/999", _LIVE)
    assert own is False, "a page for listing 999 must never certify listing 123 alive"


def test_aqarcity_expired_banner_builds_no_row_so_nothing_is_stamped(monkeypatch):
    body, url, own = _fetch(monkeypatch, "https://aqarcity.net/property/123", _EXPIRED)
    assert own is True
    row, _cat = AC.map_listing(body, url)
    assert row is None, "the source's own «هذا الإعلان منتهي» banner must not produce a row"


def test_aqarcity_not_found_redirect_returns_nothing(monkeypatch):
    assert _fetch(monkeypatch, "https://aqarcity.net/notfoundproperty", "Page Not Found") is None


# ── raghdan ─────────────────────────────────────────────────────────────────────────────────────
from scrapers.raghdan import run as RG  # noqa: E402

_RG_LIVE = '<script type="application/ld+json">{"@type":"RealEstateListing","name":"x"}</script>' + "x" * 200
_RG_SHELL = "<title>رغدان للعقارات</title>" + "x" * 200


def _rg(monkeypatch, landed, text, status=200, url="https://raghdan.sa/ar/property/AbC123xyz/"):
    monkeypatch.setattr(RG, "_session", lambda: _S(landed, text, status))
    monkeypatch.setattr(RG.time, "sleep", lambda *_: None)
    return RG.fetch_one(url)


def test_raghdan_own_page_with_listing_payload_is_live(monkeypatch):
    assert _rg(monkeypatch, "https://raghdan.sa/ar/property/AbC123xyz/", _RG_LIVE)[2] is True


def test_raghdan_another_property_is_never_this_listing(monkeypatch):
    assert _rg(monkeypatch, "https://raghdan.sa/ar/property/OTHER999/", _RG_LIVE)[2] is False


def test_raghdan_shell_without_payload_is_not_proof_of_life(monkeypatch):
    assert _rg(monkeypatch, "https://raghdan.sa/ar/property/AbC123xyz/", _RG_SHELL)[2] is False


# ── jazwtn ──────────────────────────────────────────────────────────────────────────────────────
from scrapers.jazwtn import run as JZ  # noqa: E402

_JZ_PAGE = "<html>" + "x" * 2100 + "</html>"


def _jz(monkeypatch, landed, url="https://jazwtn.com/property/villa-7/"):
    monkeypatch.setattr(JZ, "_session", lambda: _S(landed, _JZ_PAGE))
    monkeypatch.setattr(JZ.time, "sleep", lambda *_: None)
    return JZ.fetch_one((url, None))


def test_jazwtn_unredirected_own_page_is_own(monkeypatch):
    assert _jz(monkeypatch, "https://jazwtn.com/property/villa-7/")[3] is True


def test_jazwtn_redirected_page_is_never_this_listing(monkeypatch):
    assert _jz(monkeypatch, "https://jazwtn.com/")[3] is False
    assert _jz(monkeypatch, "https://jazwtn.com/property/other-9/")[3] is False
