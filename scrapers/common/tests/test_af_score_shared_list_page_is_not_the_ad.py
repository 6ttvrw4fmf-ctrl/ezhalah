"""af_score: safa's listing_url is its shared rental list, so the score never reads it as the unit's ad.

CI re-read 39228340160 (2026-10-19): «/units/rental?page=1&property_id=14146» and «…=13181» print the identical
first page of cards, and the «مفروشة بالكامل» chip on it belongs to another unit. All 4 safa misses of the
10-19 08:00 score asked furnished from it. Unreadable is honest; a miss built from another unit's card is not.
"""
from scrapers.common import af_score as A


class _Q:
    def __init__(self, data):
        self.data = data

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def execute(self):
        return self


class _Client:
    def table(self, name):
        if name == "search_listings_ar":
            return _Q([{"furnished": None, "deal_ar": "إيجار", "city_ar": "الرياض"}])
        return _Q([{"listing_url": "https://safainv.sa/units/rental?page=1&property_id=14146"}])


CARD_PAGE = "<html><title>وحدات للإيجار</title><span>مفروشة بالكامل</span><span>162.75 م² 80,000</span></html>"


def _probe_calls(platform):
    calls = []

    def probe(url):
        calls.append(url)
        return 200, CARD_PAGE

    row = A.score_site(_Client(), None, platform, [("x_residential_listings", 1)], night="2026-10-19", pace=0,
                       probe=probe, wasalt=None, sanadak=None)
    return row, calls


def test_safa_list_page_is_unreadable_and_never_fetched():
    row, calls = _probe_calls("safa")
    assert calls == []
    assert row["unreadable_pages"] == 1 and row["find_tried"] == 0 and row["find_missed_ids"] == []


def test_a_site_with_its_own_unit_page_is_still_read():
    _row, calls = _probe_calls("some_unit_page_site")
    assert len(calls) == 1
