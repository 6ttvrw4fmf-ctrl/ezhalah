"""af-score never reads nufouth's shared list page as the ad (🔬 2026-11-06).

Re-read through net.http_get on 2026-11-06: https://nufouth.com/latest-offers?ads-N4670=1 and ?ads-N5007=1 return the
same 399,743-byte page (identical md5) of 14 OTHER offers; neither code appears in the HTML. 11-06's score counted 4
nufouth bathroom «mismatches» from those other offers while every stored value equals the ad's own description.
"""
import sys

sys.path.insert(0, ".")

from scrapers.common import af_score as S  # noqa: E402


class _Q:
    def __init__(self, data):
        self._d = data

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        return type("R", (), {"data": self._d})()


class _Client:
    def table(self, name):
        if name == "search_listings_ar":
            return _Q([{"bathrooms": 3}])
        if name == "listing_text_facts":
            return _Q([{"facts": {}, "stale_at": None}])
        return _Q([{"listing_url": "https://nufouth.com/latest-offers?ads-N4670=1"}])


def _run(platform):
    fetched = []

    def probe(url):
        fetched.append(url)
        return 200, "<html><body><div>3 دورات مياه</div></body></html>"

    row = S.score_site(_Client(), None, platform, [(f"{platform}_residential_listings", 17807002)],
                       night="2026-11-06", pace=0, probe=probe, wasalt=None, sanadak=None)
    return row, fetched


def test_nufouth_is_a_shared_list_page_site():
    assert "nufouth" in S.SHARED_LIST_PAGE_SITES and "safa" in S.SHARED_LIST_PAGE_SITES


def test_nufouth_page_is_unreadable_and_never_fetched():
    row, fetched = _run("nufouth")
    assert fetched == [] and row["unreadable_pages"] == 1 and row["af_claimed"] == 0


def test_an_ordinary_site_is_still_read():
    _row, fetched = _run("aqar")
    assert fetched, "the shared-list rule must not silence every site"
