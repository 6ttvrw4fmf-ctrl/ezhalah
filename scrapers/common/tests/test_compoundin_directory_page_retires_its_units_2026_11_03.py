"""A compound whose units were all withdrawn turns into a directory page: its units are GONE (2026-11-03).

Measured live: aqua-compound / retal-residence / florentina-compound / soul answer HTTP 200 with the
compound's own h1, a `cin-directory-compound` block and NO «Units» section — 21 rows sat at
missing_count 3..11 because the oracle had «no opinion» on that page and absence never hides.
A listed page keeps answering LIVE / no-opinion exactly as before.
"""
from scrapers.compoundin import run

DIRECTORY = ('<h1 class="x">Soul</h1><div class="cin-directory-compound__map" data-cin-directory-map '
             'data-lat="24.7" data-lng="46.5"></div><section class="cin-nearby-compounds"><h2>Compounds near Soul</h2>'
             '<article class="cin-compound-card">Ayanna</article></section>')
LISTED = ('<h1>Dur Alhada</h1><section class="cin-property-section" id="cin-property-units"><h2>Units</h2>'
          '<article class="cin-unit-card x"><h3 class="cin-unit-card__title">Apartment</h3>'
          '<button data-cin-contact-unit="811">c</button></article></section>')
LISTED_WITH_DIRECTORY_WORDS = LISTED + '<div class="cin-directory-compound__map"></div>'


def test_directory_page_is_gone_for_its_units():
    assert run.is_directory_only(DIRECTORY)
    assert run._unit_signal("466")(200, DIRECTORY, False) == "gone"


def test_a_redirect_to_a_directory_page_is_not_a_death():
    assert run._unit_signal("466")(200, DIRECTORY, True) is None


def test_listed_pages_are_unchanged():
    assert not run.is_directory_only(LISTED)
    assert not run.is_directory_only(LISTED_WITH_DIRECTORY_WORDS)
    sig = run._unit_signal
    assert sig("811")(200, LISTED, False) == "live"
    assert sig("812")(200, LISTED, False) is None          # a Units list without this unit: no opinion
    assert sig("811")(200, LISTED_WITH_DIRECTORY_WORDS, False) == "live"
    assert sig("466")(404, DIRECTORY, False) is None
    assert sig("466")(403, DIRECTORY, False) is None
