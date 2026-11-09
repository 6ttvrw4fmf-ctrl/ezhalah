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


def test_a_redirect_to_the_same_ads_new_address_is_ok():
    """falcon 2026-11-06, run 42277626207: dallali 16/17 and erapulse 20/20 read «moved» and raised
    P1 served_links_broken, yet every one landed on the SAME ad under the site's new pretty URL."""
    dal = "https://dallali.com/advertisements/property/7f22c416-6857-44cc-988b-0a143507bc1d"
    dal_new = ("https://dallali.com/advertisements/villa-for-sale-%D8%A8%D8%AF%D8%B1-"
               "%D8%A7%D9%84%D8%B1%D9%8A%D8%A7%D8%B6-7f22c416")
    era = "https://erapulse.sa/property/hy-alsfa-duplex-rent-ref-mlu12xet-cd3sx"
    era_new = ("https://erapulse.sa/%D8%A7%D9%84%D8%B9%D9%82%D8%A7%D8%B1%D8%A7%D8%AA/"
               "x-REF-MLU12XET-CD3SX")
    assert S.classify(dal, 200, dal_new) == "ok"
    assert S.classify(era, 200, era_new) == "ok"
    # another ad's address on the same site, another site, or a page with no id stays «moved»
    assert S.classify(dal, 200, "https://dallali.com/advertisements/villa-for-sale-x-9a9b9c9d") == "moved"
    assert S.classify(dal, 200, "https://other.com/x-7f22c416") == "moved"
    assert S.classify(era, 200, "https://erapulse.sa/%D8%A7%D9%84%D8%B9%D9%82%D8%A7%D8%B1%D8%A7%D8%AA") == "moved"
    # erapulse's reference whose first part has no digit, measured on run 42278591016
    era2 = "https://erapulse.sa/property/26401234-land-sale-ref-mlpbkvag-6hus9"
    assert S.classify(era2, 200, "https://erapulse.sa/x/%D9%82-REF-MLPBKVAG-6HUS9") == "ok"
    assert S.classify(era2, 200, "https://erapulse.sa/x/%D9%82-REF-AAAABBBB-6HUS9") == "moved"
    # slug words are not ids: dwelleo's slug move is still a repairable «moved»
    assert S.classify(OLD, 200, NEW) == "moved"


# 🔧 2026-11-07: a language prefix or one pretty segment on the SAME path is the same ad, not a move. Both
# real redirects below were read live; each re-raised card_parity_self_healed / served_links_self_healed daily.
def test_locale_prefix_is_the_same_ad():
    from scrapers.common.served_link_check import classify
    url = "https://macsaib.sa/property/ard-skny-bhy-alkhzamy-shrk-bryd"
    assert classify(url, 200, "https://macsaib.sa/ar/property/ard-skny-bhy-alkhzamy-shrk-bryd") == "ok"


def test_pretty_slug_appended_is_the_same_ad():
    from scrapers.common.served_link_check import classify
    url = "https://www.alhoshan.sa/properties/1013"
    landed = ("https://www.alhoshan.sa/properties/1013/%D8%B9%D9%85%D8%A7%D8%B1%D9%87-%D9%84%D9%84%D8%A8%D9%8A%D8%B9")
    assert classify(url, 200, landed) == "ok"


def test_a_different_ad_or_a_deeper_path_is_still_moved():
    from scrapers.common.served_link_check import classify
    assert classify("https://www.alhoshan.sa/properties/1013", 200, "https://www.alhoshan.sa/properties/1014") == "moved"
    assert classify("https://www.alhoshan.sa/properties/1013", 200,
                    "https://www.alhoshan.sa/properties/1013/a/b") == "moved"
    assert classify("https://macsaib.sa/property/x-y", 200, "https://macsaib.sa/ar/projects/x-y") == "moved"


def test_gathern_is_opened_where_the_customer_opens_it():
    """Night 11-08: /view/ read a bare 404 on two live units the Arabic app opens at /ar/view/ (adLocale.ts)."""
    stored = "https://gathern.co/view/174185/unit/246182"
    assert S.customer_url(stored) == "https://gathern.co/ar/view/174185/unit/246182"
    assert S.customer_url("https://gathern.co/en/view/1/unit/2") == "https://gathern.co/ar/view/1/unit/2"
    assert S.customer_url("https://gathern.co/ar/view/1/unit/2") == "https://gathern.co/ar/view/1/unit/2"
    other = "https://www.dwelleo.sa/ar/properties/x-1"
    assert S.customer_url(other) == other                            # every other site untouched
    # a landing on the same /ar/ address is ok, never «moved»
    assert S.classify(S.customer_url(stored), 200, S.customer_url(stored)) == "ok"


def test_check_site_opens_the_customer_address(monkeypatch):
    seen = []
    monkeypatch.setattr(S, "sample", lambda *a, **k: [{"listing_url": "https://gathern.co/view/9/unit/8", "table": "t", "id": 1}])
    monkeypatch.setattr(S, "open_link", lambda u: (seen.append(u), (200, u))[1])
    monkeypatch.setattr(S.time, "sleep", lambda *_: None)
    import random
    row = S.check_site(None, "gathern", 1, rng=random.Random(0), night="2026-11-09", write=False)
    assert "https://gathern.co/ar/view/9/unit/8" in seen and "https://gathern.co/view/9/unit/8" not in seen
    assert row["ok"] == 1 and row["dead"] == 0
