"""served_link_check (2026-11-05): the Dwelleo shapes, measured that day, classify and repair right."""
from scrapers.common import served_link_check as S

OLD = "https://www.dwelleo.sa/ar/properties/3-bedroom-apartment-for-rent-in-hiteen-riyadh-1"
NEW = "https://www.dwelleo.sa/ar/properties/for-rent/apartment/riyadh/hiteen/3-bedroom-apartment-for-rent-in-hiteen-riyadh-1"


def test_classify():
    assert S.classify(OLD, 404, OLD) == "dead"
    assert S.classify(OLD, 410, None) == "dead"
    assert S.classify(OLD, 200, OLD + "/") == "ok"
    assert S.classify(OLD, 200, None) == "ok"                       # status-only transport
    assert S.classify(OLD, 200, NEW) == "moved"
    assert S.classify(OLD, 200, "https://www.dwelleo.sa/ar") == "unknown"   # sent home
    for st in (403, 429, 500, None):
        assert S.classify(OLD, st, None) == "unknown"               # never dead


def test_repair_only_the_sites_own_new_address_for_this_ad():
    assert S.repairable(OLD, NEW)
    assert not S.repairable(OLD, "https://www.dwelleo.sa/ar/properties/for-rent")      # an index, not the ad
    assert not S.repairable(OLD, NEW.replace("dwelleo.sa", "elsewhere.sa"))         # another site
    assert S.repairable(OLD, NEW.replace("www.", ""))                                  # www is the same site


def test_broken_is_most_decided_links_and_needs_five():
    row = dict(ok=2, moved=0, dead=3, unknown=10)
    assert S.broken(row)
    assert not S.broken(dict(ok=3, moved=0, dead=1, unknown=0))                 # 4 decided: says nothing
    assert not S.broken(dict(ok=12, moved=3, dead=4, unknown=1))                # 7 of 19
    assert S.broken(dict(ok=0, moved=20, dead=0, unknown=0))                    # all moved: re-crawl


def test_dwelleo_is_a_small_source():
    assert "dwelleo" in S.small_sources()
