"""suwar: a REST 401 (post no longer public) is UNKNOWN under the law; the ad's own page decides.

Measured 2026-10-17 (spot-check 39028234068): five shown suwar ads at 7 strikes read «REST 401» on every
run since 10-10, so they could never be hidden. Only the listing's own 404/410 removes one."""
import types

import pytest

from scrapers.common import http_liveness as HL
from scrapers.suwar import run as S


class _R:
    def __init__(self, status, body):
        self.status_code, self._b = status, body

    def json(self):
        return self._b


@pytest.fixture
def rest_401(monkeypatch):
    monkeypatch.setattr(S, "cc", types.SimpleNamespace(get=lambda *a, **k: _R(401, {"code": "rest_forbidden"})))
    monkeypatch.setattr(HL.time, "sleep", lambda s: None)


def _page(monkeypatch, status, body="<html>page</html>", moved=False):
    monkeypatch.setattr(HL.LivenessProbe, "fetch", lambda self, url: (status, body, moved))


def test_a_401_whose_own_page_is_404_is_gone(rest_401, monkeypatch):
    _page(monkeypatch, 404)
    verdict, why = S._verify_gone("SWR19940")
    assert verdict == "gone" and "REST 401" in why


@pytest.mark.parametrize("status", [200, 403, 500, None])
def test_a_401_whose_own_page_is_anything_else_stays_unknown(rest_401, monkeypatch, status):
    _page(monkeypatch, status)
    assert S._verify_gone("SWR19940")[0] == "unknown"


def test_a_401_asks_for_the_post_by_its_own_id_never_its_slug(rest_401, monkeypatch):
    # 2026-11-03: the stored slug 301'd to «…-2/», ANOTHER post of project 839, so it read "moved"
    # for weeks. /?p=19940 answers 404 with no redirect; a live id redirects to its own permalink.
    asked = []
    monkeypatch.setattr(HL.LivenessProbe, "fetch", lambda self, url: (asked.append(url), (404, "x", False))[1])
    assert S._verify_gone("SWR19940")[0] == "gone"
    assert asked and all(u == "https://suwar.sa/?p=19940" for u in asked)


def test_a_404_reached_through_a_redirect_is_not_this_post(rest_401, monkeypatch):
    _page(monkeypatch, 404, moved=True)
    assert S._verify_gone("SWR19940")[0] == "unknown"


def test_a_published_post_is_still_live(monkeypatch):
    monkeypatch.setattr(S, "cc", types.SimpleNamespace(get=lambda *a, **k: _R(200, {"id": 19940, "status": "publish"})))
    assert S._verify_gone("SWR19940")[0] == "live"
