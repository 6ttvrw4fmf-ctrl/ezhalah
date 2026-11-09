"""served_link_check (2026-11-05): the Dwelleo shapes, measured that day, classify and repair right."""
import random
from unittest.mock import Mock

import pytest

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


@pytest.mark.parametrize(("stored", "expected"), [
    ("http://www.gathern.co/view/1/unit/2/", "http://www.gathern.co/ar/view/1/unit/2/"),
    ("https://WWW.GATHERN.CO/EN/view/1/unit/2", "https://WWW.GATHERN.CO/ar/view/1/unit/2"),
    ("https://gathern.co/view/1/unit/2?next=%2Fen%2Fview%2F3#photos",
     "https://gathern.co/ar/view/1/unit/2?next=%2Fen%2Fview%2F3#photos"),
    ("https://gathern.co/ar/view/1/unit/2?lang=en#photos",
     "https://gathern.co/ar/view/1/unit/2?lang=en#photos"),
])
def test_customer_url_preserves_the_listing_and_url_components(stored, expected):
    assert S.customer_url(stored) == expected
    assert S.customer_url(expected) == expected  # localization is idempotent


@pytest.mark.parametrize("url", [
    "", None,
    "https://gathern.co/", "https://gathern.co/ar", "https://gathern.co/en/search",
    "https://gathern.co/preview/1/unit/2", "https://gathern.co/viewing/1/unit/2",
    "https://gathern.co.evil.test/view/1/unit/2",
    "https://fakegathern.co/view/1/unit/2", "https://other.test/gathern.co/view/1/unit/2",
    "https://other.test/view/1?next=https://gathern.co/view/1/unit/2",
    "/view/1/unit/2", "not a URL",
])
def test_customer_url_leaves_non_listing_and_unrelated_urls_untouched(url):
    assert S.customer_url(url) == url


@pytest.fixture
def check_one_link(monkeypatch):
    """Run the real checker with only transport, sampling and pacing replaced."""
    def run(stored, status=200, landed=None, *, write=False, home_status=200):
        listing = {"listing_url": stored, "table": "gathern_listings", "id": 17}
        original = listing.copy()
        transport = Mock(side_effect=[(home_status, None), (status, landed)])
        client = Mock()
        monkeypatch.setattr(S, "sample", lambda *a, **k: [listing])
        monkeypatch.setattr(S, "open_link", transport)
        monkeypatch.setattr(S.time, "sleep", lambda *_: None)
        row = S.check_site(client, "gathern", 1, rng=random.Random(0),
                           night="2026-11-09", write=write)
        assert listing == original  # even write mode must preserve the sampled stored URL
        return row, client, transport
    return run


@pytest.mark.parametrize("prefix", ["", "/ar", "/en"])
@pytest.mark.parametrize("write", [False, True])
def test_localized_success_never_repairs_the_stored_url(check_one_link, prefix, write):
    stored = f"https://gathern.co{prefix}/view/9/unit/8"
    opened = "https://gathern.co/ar/view/9/unit/8"
    row, client, transport = check_one_link(stored, landed=opened, write=write)
    assert [call.args[0] for call in transport.call_args_list] == ["https://gathern.co/", opened]
    assert {key: row[key] for key in ("sampled", "ok", "moved", "repaired", "dead", "unknown")} == {
        "sampled": 1, "ok": 1, "moved": 0, "repaired": 0, "dead": 0, "unknown": 0,
    }
    assert row["dead_sample"] == []
    client.table.assert_not_called()


@pytest.mark.parametrize(("status", "landed", "kind"), [
    (404, None, "dead"), (410, None, "dead"),
    (403, None, "unknown"), (429, None, "unknown"), (500, None, "unknown"),
    (None, None, "unknown"), (200, "https://gathern.co/ar", "unknown"),
    (200, None, "ok"),
    (200, "https://gathern.co/ar/view/9/unit/7", "moved"),
])
def test_localized_result_is_counted_but_dead_sample_keeps_stored_url(check_one_link, status, landed, kind):
    stored = "https://gathern.co/en/view/9/unit/8"
    row, client, transport = check_one_link(stored, status, landed, write=True)
    assert transport.call_args.args == ("https://gathern.co/ar/view/9/unit/8",)
    assert row["sampled"] == 1
    assert row[kind] == 1
    assert sum(row[key] for key in ("ok", "moved", "dead", "unknown")) == 1
    assert row["dead_sample"] == ([stored] if kind == "dead" else [])
    assert row["repaired"] == 0
    client.table.assert_not_called()


@pytest.mark.parametrize("write", [False, True])
def test_localized_move_retains_original_repair_contract(check_one_link, monkeypatch, write):
    stored = "https://gathern.co/en/view/9/unit/8"
    landed = "https://gathern.co/new/view/9/unit/8"
    repair = Mock(wraps=S.repairable)
    monkeypatch.setattr(S, "repairable", repair)
    row, client, _ = check_one_link(stored, landed=landed, write=write)
    repair.assert_called_once_with(stored, landed)
    assert row["moved"] == row["repaired"] == 1
    if write:
        client.table.assert_called_once_with("gathern_listings")
        client.table.return_value.update.assert_called_once_with({"listing_url": landed})
        client.table.return_value.update.return_value.eq.assert_called_once_with("id", 17)
        client.table.return_value.update.return_value.eq.return_value.execute.assert_called_once_with()
    else:
        client.table.assert_not_called()


def test_home_page_wall_prevents_even_localized_listing_checks(check_one_link):
    row, client, transport = check_one_link("https://gathern.co/view/9/unit/8", home_status=403, write=True)
    transport.assert_called_once_with("https://gathern.co/")
    assert row["home_status"] == 403
    assert row["sampled"] == row["dead"] == row["repaired"] == 0
    client.table.assert_not_called()


def test_check_site_keeps_other_sites_address(check_one_link):
    row, client, transport = check_one_link(OLD, landed=OLD, write=True)
    assert transport.call_args.args == (OLD,)
    assert row["ok"] == 1 and row["repaired"] == 0
    client.table.assert_not_called()
