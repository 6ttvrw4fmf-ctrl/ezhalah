"""sadiqeltajer: the platform's own test ad (/ads/fake-1001-2, «fake - 1002») is not a property (🆕 2026-10-16, #589)."""
import scrapers.sadiqeltajer.run as R


def test_the_test_ad_slug_is_skipped_and_real_slugs_are_not():
    assert R.PLATFORM_TEST_AD.search("https://sadiq-eltajer.sa/ads/fake-1001-2")
    assert not R.PLATFORM_TEST_AD.search("https://sadiq-eltajer.sa/ads/villa-fakeeh-district")
    assert not R.PLATFORM_TEST_AD.search("https://sadiq-eltajer.sa/ads/fake")
