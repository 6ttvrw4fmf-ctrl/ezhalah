"""The lifecycle double-check reads nowaisiry by the ad's OWN post id, never its re-used slug (2026-11-07).

NW4349's stored slug was re-used by the office for post 4513 (another farm). lifecycle_spot_check read
that URL by status («200» → LIVE) and put back an ad prune had hidden on a direct /?p=4349 404, so its
card opened NW4513's page (backlog 1427, alert card_link_identity:dupe:nowaisiry_commercial_listings).
These tests EXECUTE the spot check's reader with the HTTP layer stubbed.
"""
from __future__ import annotations

import scrapers.common.lifecycle_spot_check as SC
from scrapers.common.liveness_contract import ALIVE, DEAD, UNKNOWN
from scrapers.nowaisiry import run as NW

SLUG = "https://alnowaisiry.com/lands/shared-slug/"
PAGES = {  # url -> (status, body)
    "https://alnowaisiry.com/?p=4513": (200, '<body class="single postid-4513">farm 14,582</body>'),
    "https://alnowaisiry.com/?p=4349": (404, '<body class="error404"></body>'),
    SLUG: (200, '<body class="single postid-4513">farm 14,582</body>'),
}


class _Resp:
    def __init__(self, url):
        self.status_code, self.text = PAGES.get(url, (404, ""))
        self.url = url
        self.content = self.text.encode()
        self.headers = {}
        self.history = []


class _Sess:
    def get(self, url, **_k):
        return _Resp(url)


def _reader(monkeypatch):
    monkeypatch.setattr(NW, "_oracle_session", lambda *a, **k: _Sess())
    assert SC._reader_for("nowaisiry") is None
    method, read = SC.pick_reader("nowaisiry", None, {"ad_number": "NW4513", "listing_url": SLUG})
    return method, read


def test_nowaisiry_is_read_by_its_own_post_id(monkeypatch):
    method, read = _reader(monkeypatch)
    assert method == "site-oracle"
    live = {"ad_number": "NW4513", "listing_url": SLUG}
    gone = {"ad_number": "NW4349", "listing_url": SLUG}   # SAME stored URL as the live ad
    assert read(live) == ALIVE
    # The re-used slug answers 200 for post 4513; NW4349's own /?p=4349 is a 404 → never LIVE.
    assert read(gone) in (DEAD, UNKNOWN) and read(gone) != ALIVE


def test_a_page_for_another_post_is_not_this_ads_life():
    sig = NW._own_id_signal_for("4349")
    assert sig(200, '<body class="single postid-4513">', False) is None
    assert sig(200, '<body class="single postid-4349">', False) == "live"
