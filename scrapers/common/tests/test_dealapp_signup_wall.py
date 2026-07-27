"""Regression test for dealapp's signup-wall sentinel (2026-07-27).

WHY: dealapp.sa serves a REGISTRATION INTERSTITIAL (`<title>صفحة التسجيل`, ~86KB) after a burst of
rapid /ad-details requests — HTTP 200, sticky per-IP, not cleared by short backoff. Observed live
2026-07-27: an ad-liveness sweep of 36 ids returned real ad titles for the first 14 requests and
the interstitial for the remaining 22. A title/status-based liveness check reads that interstitial
as a SUCCESSFUL fetch — i.e. FALSE-ALIVE (or, with a stricter title match, false-dead). Either way
a throttling episode becomes a liveness verdict, which is the exact class of error that
`feedback_inactive-stock-verification` calls the more dangerous direction.

INVARIANT UNDER TEST: a walled response is neither alive nor dead.
  • is_signup_wall() recognises it,
  • fetch_one() never returns it (not even as the skeleton fallback),
  • recover._classify() verdicts it "unknown" (row left UNTOUCHED),
  • and the run counts it so the episode is visible in scrape_runs.notes + an ops alert.

Run: python -m pytest scrapers/common/tests/test_dealapp_signup_wall.py -v
"""
from scrapers.dealapp.recover import _classify
from scrapers.dealapp.run import is_signup_wall, note_wall_hit, reset_wall_hits, wall_hits

# Representative wall response. The `<title>صفحة التسجيل` marker and the absence of any ng-state
# listing schema are what was observed live on 2026-07-27 (86,329-byte body, HTTP 200, served for
# every /ar/ad-details/<id> once the wall engaged, including ids independently known to be live).
_WALL_HTML = """
<html lang="ar"><head><title>صفحة التسجيل</title></head>
<body><app-root><div class="register-cta">سجل الدخول للمتابعة</div>
<a href="/ar/auth/register">إنشاء حساب</a></app-root></body></html>
"""

# A real, fully-rendered ad page (same ng-state shape the scraper parses).
_LIVE_HTML = """
<html><body>
<script id="ng-state" type="application/json">
{"schemaMarkupScripts":{"real-estate-listing-schema-402463":"{\\"@type\\":\\"RealEstateListing\\",\\"offers\\":{\\"@type\\":\\"Offer\\",\\"price\\":\\"4000000\\",\\"priceCurrency\\":\\"SAR\\",\\"availability\\":\\"https://schema.org/InStock\\"}}"}}
</script>
</body></html>
"""

# A sold ad — must still be classifiable; the wall guard must not swallow real verdicts.
_SOLD_HTML = """
<html><body>
<script id="ng-state" type="application/json">
{"schemaMarkupScripts":{"real-estate-listing-schema-286432":"{\\"@type\\":\\"RealEstateListing\\",\\"offers\\":{\\"@type\\":\\"Offer\\",\\"price\\":\\"2500000\\",\\"priceCurrency\\":\\"SAR\\",\\"availability\\":\\"https://schema.org/SoldOut\\"}}"}}
</script>
</body></html>
"""

# An ad page whose chrome links to /ar/auth/register (every logged-out page does). This must NOT be
# mistaken for the wall, or a normal run would report walls constantly and the alert would be noise.
_LIVE_HTML_WITH_REGISTER_LINK = _LIVE_HTML.replace(
    "</body>", '<footer><a href="/ar/auth/register">إنشاء حساب</a></footer></body>'
)


def test_wall_is_recognised():
    assert is_signup_wall(_WALL_HTML) is True


def test_real_ad_page_is_not_a_wall():
    assert is_signup_wall(_LIVE_HTML) is False
    assert is_signup_wall(_SOLD_HTML) is False


def test_ad_page_linking_to_register_is_not_a_wall():
    # Guards the false-positive direction: schema present => not a wall, whatever the chrome says.
    assert "/ar/auth/register" in _LIVE_HTML_WITH_REGISTER_LINK
    assert is_signup_wall(_LIVE_HTML_WITH_REGISTER_LINK) is False


def test_empty_response_is_not_a_wall():
    assert is_signup_wall("") is False


def test_wall_never_yields_a_liveness_verdict():
    # THE core invariant: not "live", not "sold" — unknown, so recover_table leaves the row alone.
    assert _classify(_WALL_HTML) == "unknown"


def test_real_verdicts_still_work_behind_the_guard():
    assert _classify(_LIVE_HTML) == "live"
    assert _classify(_SOLD_HTML) == "sold"


def test_wall_hits_are_counted():
    reset_wall_hits()
    assert wall_hits() == 0
    note_wall_hit()
    note_wall_hit()
    assert wall_hits() == 2
    reset_wall_hits()
    assert wall_hits() == 0


def test_fetch_one_never_returns_a_walled_response():
    """fetch_one must not hand a wall page back — not as success, not as the skeleton fallback.

    Drives the real fetch_one against a stubbed session that always walls, so the assertion covers
    the shipped retry/fallback logic rather than a reimplementation of it.
    """
    from scrapers.dealapp import run as dealapp_run

    class _WalledResponse:
        status_code = 200
        text = _WALL_HTML

    class _WalledSession:
        def get(self, *a, **kw):
            return _WalledResponse()

    orig_session, orig_sleep = dealapp_run._session, dealapp_run.time.sleep
    reset_wall_hits()
    try:
        dealapp_run._session = lambda: _WalledSession()
        dealapp_run.time.sleep = lambda *_a, **_kw: None
        assert dealapp_run.fetch_one("402463") is None
        assert wall_hits() == 3  # one per retry attempt, all counted
    finally:
        dealapp_run._session, dealapp_run.time.sleep = orig_session, orig_sleep
        reset_wall_hits()


if __name__ == "__main__":
    test_wall_is_recognised()
    test_real_ad_page_is_not_a_wall()
    test_ad_page_linking_to_register_is_not_a_wall()
    test_empty_response_is_not_a_wall()
    test_wall_never_yields_a_liveness_verdict()
    test_real_verdicts_still_work_behind_the_guard()
    test_wall_hits_are_counted()
    test_fetch_one_never_returns_a_walled_response()
    print("OK — dealapp signup-wall sentinel regression tests pass")
