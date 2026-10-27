"""nowaisiry: every ad its list serves gets a direct own-page read (2026-10-27).

20 active rows, 0 ever verified: the crawl reads only the REST list, a full list every night, so no
row reached grace and the 404 oracle was never asked. verify_seen() adds the LIVE limb that oracle
lacks — 200 on the stored URL whose body names THIS post (postid-<id>) — and main() hands it to
db.stamp_seen_alive, which records only 'live' and can never hide a listing.

Measured 2026-10-27 with curl: NW3016's page → 200, body class postid-3016, shortlink ?p=3016;
deleted NW3529's page → 404 with the error404 template; a made-up slug → 404.
"""
from __future__ import annotations

import inspect

import pytest

from scrapers.common import http_liveness
from scrapers.nowaisiry import run as NW

URL = "https://alnowaisiry.com/lands/x-3541/"
LIVE = '<body class="lands-template-default single single-lands postid-3016">…</body>'
DEAD = '<body class="error404">الصفحة غير موجودة</body>'


class _R:
    def __init__(self, status, text, url=URL):
        self.status_code, self.text, self.url = status, text, url


@pytest.fixture
def serve(monkeypatch):
    box = {}

    class _S:
        def get(self, url, timeout=None, allow_redirects=None):
            r = box["r"]
            if isinstance(r, Exception):
                raise r
            return r
    monkeypatch.setattr(NW, "_oracle_session", lambda: _S())
    monkeypatch.setattr(NW, "_probe", type("P", (), {"url_for": staticmethod(lambda ad: URL)})())
    monkeypatch.setattr(http_liveness.time, "sleep", lambda *_: None)

    def set_(r):
        box["r"] = r
    return set_


def test_this_posts_page_is_live(serve):
    serve(_R(200, LIVE))
    assert NW.verify_seen("NW3016")[0] == "live"


def test_another_posts_page_is_not_live(serve):
    serve(_R(200, LIVE))
    assert NW.verify_seen("NW301")[0] == "unknown", "postid-3016 is not post 301"
    assert NW.verify_seen("NW9999")[0] == "unknown"


def test_404_is_gone_exactly_as_the_prune_oracle_says(serve):
    serve(_R(404, DEAD))
    assert NW.verify_seen("NW3529")[0] == "gone"


def test_unknown_reads_are_unknown(serve):
    for r in (_R(403, "blocked"), _R(500, "err"), _R(429, "slow"), _R(200, ""), TimeoutError("t")):
        serve(r)
        assert NW.verify_seen("NW3016")[0] == "unknown", r
    serve(_R(200, LIVE, url="https://alnowaisiry.com/somewhere-else/"))
    assert NW.verify_seen("NW3016")[0] == "unknown", "a redirect off its own path proves nothing"


def test_a_non_post_ad_number_is_unknown():
    assert NW.verify_seen("NWabc123def456")[0] == "unknown"
    assert NW.verify_seen("")[0] == "unknown"


def test_the_prune_oracle_gone_limb_is_unchanged():
    assert NW._signal(404, "", False) == "gone"
    assert NW._signal(200, LIVE, False) is None, "the prune oracle itself still has no live limb"


def test_main_stamps_seen_rows_with_this_reader_after_the_prune():
    src = inspect.getsource(NW.main)
    assert "db.stamp_seen_alive(tbl, {r[\"ad_number\"] for r in rows_seen}, verify_seen, source=SOURCE)" in src
    assert src.index("db.prune_unseen(") < src.index("db.stamp_seen_alive(")
