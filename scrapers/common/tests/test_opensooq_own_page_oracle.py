"""OpenSooq's removal oracle (2026-10-11): 19 ads its own SERP dropped since 09-28 stayed shown,
because its prune guard trips on a ~100-row catalogue every night and absence never hides on its
own. The daily direct check now reads each ad's OWN page; these pin what that page may testify."""
from scrapers.opensooq import run as osq
from scrapers.common import fleet_liveness as FL

AD = "285028104"
sig = osq._signal_for(AD)


def test_archive_banner_and_hard_404_are_gone():
    assert sig(200, f"<h1>هذا الإعلان غير متوفر</h1> {AD}", False) == "gone"
    assert sig(404, "", False) == "gone"
    assert sig(410, "", False) == "gone"


def test_live_needs_this_ads_own_id_and_no_banner():
    assert sig(200, f"<html>... {AD} ...</html>", False) == "live"
    # a 200 that does not name this ad (a shell, a search page) proves nothing either way
    assert sig(200, "<html>286311526</html>", False) is None


def test_block_redirect_and_5xx_are_unknown_never_dead():
    assert sig(403, "", False) is None
    assert sig(503, "", False) is None
    assert sig(200, f"هذا الإعلان غير متوفر {AD}", True) is None   # landed on another path
    assert sig(301, "", False) is None


def test_the_daily_direct_check_can_call_it():
    assert FL.SITES["opensooq"] == "scrapers.opensooq.run:_make_verify_gone()"
    oracle = FL.oracle_for(FL.SITES["opensooq"], None)
    assert callable(oracle)
