"""sakan: the source's own «هذا العقار لم يعد متاحاً» notice on the ad's own page retires it (owner 2026-10-20).

Measured on 94392: an expired ad keeps its own canonical, loses the listing payload, and prints the
property-unavailable-notice block. The signal used to have no opinion on it (no payload), so prune_unseen
never retired it and the card showed with a district border.
"""
import scrapers.sakan.run as S

CANON = '<link rel="canonical" href="https://sa.sakan.co/ar/property/details/94392-شقة-للبيع--جدة---حي-الصفا">'
NOTICE = ('<div class="property-unavailable-notice" style="background-color: #fff3cd;"><p>هذا العقار لم يعد متاحاً. '
          'تصفح العقارات المشابهة أدناه.</p></div>')


def test_the_notice_on_this_ads_own_page_is_gone():
    assert S._signal_for("94392")(200, "<html>" + CANON + NOTICE + "</html>", False) == "gone"


def test_the_notice_on_another_ads_page_has_no_opinion():
    assert S._signal_for("11111")(200, "<html>" + CANON + NOTICE + "</html>", False) is None


def test_no_notice_and_no_payload_still_has_no_opinion():
    assert S._signal_for("94392")(200, "<html>" + CANON + "</html>", False) is None


def test_a_failed_fetch_is_never_a_death():
    assert S._signal_for("94392")(503, NOTICE, False) is None
