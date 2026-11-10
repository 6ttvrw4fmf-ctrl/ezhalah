"""A page that is plainly THIS ad, still up, answers LIVE (2026-11-10).

P1 served_after_source_gone stood open on manzo (5 ads), nawafeth (2) and arsh (1): their sites'
lists stopped carrying the ads, the strikes reached grace, and the default own-page oracle read
«HTTP 200, no opinion» for ever — so missing_count never reset on pages a browser showed live.
Each crawler now hands the oracle its own reader of its site's ad page. The fixtures are the real
pages (excerpts), saved with a browser that day; every reader is EXECUTED on them.
"""
from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

import scrapers.arsh.run as arsh
import scrapers.compoundin.run as compoundin
import scrapers.manzo.run as manzo
import scrapers.nawafeth.run as nawafeth
from scrapers.common import db, http_liveness

ROOT = Path(__file__).resolve().parents[2]
TODAY = date(2026, 11, 10)


def fx(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


MNZ_URL = "https://manzo.com.sa/ar/property/long_term_rent-408m2-B6r00jE7"
MNZ_LIVE = fx("manzo/testdata/B6r00jE7.live.page.excerpt.html")
MNZ_REMOVED = fx("manzo/testdata/rNWNNZWL.removed.page.excerpt.html")
NWF_LIVE = fx("nawafeth/testdata/179.live.page.excerpt.html")
NWF_ENDED = fx("nawafeth/testdata/168.licence_ended.page.excerpt.html")
NWF_REMOVED = fx("nawafeth/testdata/178.removed.page.html")
NWF_LOGIN = fx("nawafeth/testdata/login_wall.page.excerpt.html")
ARS_AD = "ARSأرض-تجارية"
ARS_LIVE = fx("arsh/testdata/ard-tijariya.unlinked.page.excerpt.html")
ARS_404 = fx("arsh/testdata/custom404.page.excerpt.html")
CIN_NOBLES = fx("compoundin/testdata/nobles-elite-1-al-rehab.units.excerpt.html")


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(arsh, "to_catalog", lambda c, region_hint=None: (31, 5) if c else (None, None))
    monkeypatch.setattr(arsh, "stated_city",
                        lambda t: ("الخبر", 31, 5) if "مدينة الخبر" in (t or "") else (None, None, None))
    monkeypatch.setattr(arsh, "find_district_in_text", lambda t, cid: None)
    monkeypatch.setattr(http_liveness.time, "sleep", lambda *_: None)


# ── manzo ────────────────────────────────────────────────────────────────────────────────────────
def test_manzo_live_page_is_this_ad():
    assert manzo.page_is_this_live_ad("MNZ2006", {"listing_url": MNZ_URL}, MNZ_LIVE) is True


def test_manzo_removed_page_and_another_ads_page_are_not_live():
    removed_url = "https://manzo.com.sa/ar/property/long_term_rent-2500m2-rNWNNZWL"
    # the 404 body still prints a canonical to the asked address: the canonical alone proves nothing
    assert 'rel="canonical"' in MNZ_REMOVED and "rNWNNZWL" in MNZ_REMOVED
    assert manzo.page_is_this_live_ad("MNZ1403", {"listing_url": removed_url}, MNZ_REMOVED) is False
    # a live page of ANOTHER ad is not this ad
    assert manzo.page_is_this_live_ad("MNZ1403", {"listing_url": removed_url}, MNZ_LIVE) is False
    assert manzo.page_is_this_live_ad("MNZ2006", None, MNZ_LIVE) is False
    assert manzo.page_is_this_live_ad("MNZ2006", {"listing_url": MNZ_URL}, "") is False
    assert manzo.page_is_this_live_ad("MNZ2006", {"listing_url": MNZ_URL},
                                      MNZ_LIVE.replace("RealEstateListing", "WebPage")) is False


# ── nawafeth ─────────────────────────────────────────────────────────────────────────────────────
def test_nawafeth_live_page_is_this_ad_even_after_a_retitle_that_states_no_deal():
    assert nawafeth.deal_from_title(nawafeth.labels(NWF_LIVE)["عنوان الإعلان"]) is None   # why the crawl skips it
    assert nawafeth.page_is_this_live_ad("NWF179", None, NWF_LIVE, TODAY) is True


def test_nawafeth_other_ad_ended_licence_404_and_login_wall_are_not_live():
    assert nawafeth.page_is_this_live_ad("NWF155", None, NWF_LIVE, TODAY) is False       # another ad's page
    assert nawafeth.page_is_this_live_ad("NWF168", None, NWF_ENDED, TODAY) is False      # licence ended 07/10/2026
    assert nawafeth.page_is_this_live_ad("NWF168", None, NWF_ENDED, date(2026, 10, 1)) is True
    assert nawafeth.page_is_this_live_ad("NWF178", None, NWF_REMOVED, TODAY) is False
    assert nawafeth.page_is_this_live_ad("NWF155", None, NWF_LOGIN, TODAY) is False
    assert nawafeth.page_is_this_live_ad("NWF179", None, NWF_LIVE, date(2027, 8, 16)) is False


def test_nawafeth_map_listing_still_skips_exactly_as_before():
    assert nawafeth.map_listing(168, NWF_ENDED, TODAY) == (None, "licence_expired")
    assert nawafeth.map_listing(178, NWF_REMOVED, TODAY) == (None, "not_a_listing")
    assert nawafeth.map_listing(179, NWF_LIVE, TODAY) == (None, "deal_not_stated")


# ── arsh ─────────────────────────────────────────────────────────────────────────────────────────
def test_arsh_page_unlinked_from_the_index_but_still_served_is_this_ad():
    assert arsh.page_is_this_live_ad(ARS_AD, None, ARS_LIVE) is True


def test_arsh_404_page_and_another_slug_are_not_live():
    assert "custom404page" in ARS_404
    assert arsh.page_is_this_live_ad(ARS_AD, None, ARS_404) is False
    assert arsh.page_is_this_live_ad("ARSأرض-الجوهرة-التجارية", None, ARS_LIVE) is False   # another plot's page
    assert arsh.page_is_this_live_ad("XYZأرض-تجارية", None, ARS_LIVE) is False
    assert arsh.page_is_this_live_ad(ARS_AD, None, ARS_LIVE.replace('rel="canonical"', 'rel="x"')) is False


# ── compoundin: unchanged, pinned on the real page ───────────────────────────────────────────────
def test_compoundin_two_units_left_the_page_their_siblings_stayed():
    """CIN527 and CIN530 share one listing_url with CIN528 and CIN529 because a compoundin row is a
    UNIT and its listing_url is its COMPOUND's page. The page now lists 528 and 529 only: they read
    LIVE; 527 and 530 stay «no opinion» (a unit missing from a Units list is not yet a death here —
    making it one is a new removal rule, which is the owner's call)."""
    assert sorted(c["uid"] for c in compoundin.unit_cards(CIN_NOBLES)) == ["528", "529"]
    sig = compoundin._unit_signal
    assert sig("528")(200, CIN_NOBLES, False) == "live" and sig("529")(200, CIN_NOBLES, False) == "live"
    assert sig("527")(200, CIN_NOBLES, False) is None and sig("530")(200, CIN_NOBLES, False) is None


# ── the oracle, end to end ───────────────────────────────────────────────────────────────────────
class _Resp:
    def __init__(self, url, status, text, landed=None):
        self.status_code, self.text, self.url = status, text, landed or url


class _Session:
    def __init__(self, pages):
        self.pages = pages

    def get(self, url, **_k):
        status, text, *landed = self.pages[url]
        return _Resp(url, status, text, landed[0] if landed else None)


def _oracle(monkeypatch, rows, pages, seen, live_page):
    class _Q:
        ad = None

        def select(self, *_a, **_k):
            return self

        def limit(self, *_a):
            return self

        def eq(self, _k, v):
            self.ad = v
            return self

    class _C:
        def table(self, _t):
            return _Q()

    monkeypatch.setattr(db, "_execute", lambda q, what="": type("R", (), {"data": [rows[q.ad]] if q.ad in rows else []})())
    monkeypatch.setattr(db, "_READ_GONE", {})
    return db.own_page_status_oracle(_C(), "manzo_residential_listings", seen,
                                     session=_Session(pages), live_page=live_page)


GONE_URL = "https://manzo.com.sa/ar/property/long_term_rent-2500m2-rNWNNZWL"
CTRL_URL = "https://manzo.com.sa/ar/property/long_term_rent-143m2-Q6bjjP68"
ROWS = {"MNZ2006": {"listing_url": MNZ_URL}, "MNZ1403": {"listing_url": GONE_URL},
        "MNZ2010": {"listing_url": CTRL_URL}}
CTRL_BODY = MNZ_LIVE.replace("long_term_rent-408m2-B6r00jE7", "long_term_rent-143m2-Q6bjjP68")


def test_oracle_answers_live_on_the_ads_own_live_page(monkeypatch):
    vg = _oracle(monkeypatch, ROWS, {MNZ_URL: (200, MNZ_LIVE)}, {"MNZ2010"}, manzo.page_is_this_live_ad)
    assert vg("MNZ2006")[0] == "live"


def test_oracle_without_a_reader_has_no_opinion_on_a_200(monkeypatch):
    vg = _oracle(monkeypatch, ROWS, {MNZ_URL: (200, MNZ_LIVE)}, {"MNZ2010"}, None)
    assert vg("MNZ2006")[0] == "unknown"


def test_oracle_never_reads_live_on_a_redirect_a_soft_page_or_a_block(monkeypatch):
    moved = {MNZ_URL: (200, MNZ_LIVE, "https://manzo.com.sa/ar")}
    assert _oracle(monkeypatch, ROWS, moved, {"MNZ2010"}, manzo.page_is_this_live_ad)("MNZ2006")[0] == "unknown"
    soft = {MNZ_URL: (200, MNZ_REMOVED)}
    assert _oracle(monkeypatch, ROWS, soft, {"MNZ2010"}, manzo.page_is_this_live_ad)("MNZ2006")[0] == "unknown"
    blocked = {MNZ_URL: (403, MNZ_LIVE)}
    assert _oracle(monkeypatch, ROWS, blocked, set(), manzo.page_is_this_live_ad)("MNZ2006")[0] == "unknown"

    def boom(*_a):
        raise ValueError("reader broke")
    assert _oracle(monkeypatch, ROWS, {MNZ_URL: (200, MNZ_LIVE)}, {"MNZ2010"}, boom)("MNZ2006")[0] == "unknown"


def test_a_404_is_gone_only_when_the_reader_recognises_a_control_page(monkeypatch):
    pages = {GONE_URL: (404, MNZ_REMOVED), CTRL_URL: (200, CTRL_BODY)}
    assert _oracle(monkeypatch, ROWS, pages, {"MNZ2010"}, manzo.page_is_this_live_ad)("MNZ1403")[0] == "gone"
    # the site redesigned and the reader went blind: the control is a 200 it no longer recognises
    blind = {GONE_URL: (404, MNZ_REMOVED), CTRL_URL: (200, "<html>new design</html>")}
    assert _oracle(monkeypatch, ROWS, blind, {"MNZ2010"}, manzo.page_is_this_live_ad)("MNZ1403")[0] == "unknown"
    # without a reader the control rule is the old one, byte for byte
    assert _oracle(monkeypatch, ROWS, blind, {"MNZ2010"}, None)("MNZ1403")[0] == "gone"


def test_nawafeth_login_wall_redirect_is_unknown(monkeypatch):
    url = "https://nawafethalwatan.com/Advserments/GetAdvsertismentDetail?advsertismentId=155"
    rows = {"NWF155": {"listing_url": url}}
    walled = {url: (200, NWF_LOGIN, "https://nawafethalwatan.com/DAuth/SendLoginCode")}
    reader = lambda ad, row, body: nawafeth.page_is_this_live_ad(ad, row, body, TODAY)  # noqa: E731
    assert _oracle(monkeypatch, rows, walled, {"NWF182"}, reader)("NWF155")[0] == "unknown"
