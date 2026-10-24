"""aldarim's own-page liveness signal reads the 2026-10-20 page shape.

fleet-liveness run 39916739488 (2026-10-23): «aldarim: APPLY active=171 probed=0 … QUARANTINED: opening controls
0/5 live (ALD26049: no verdict after 2 attempts — HTTP 200, but this platform's signal had no opinion about it)».
The live page /en/properties/26049 (read 2026-10-23) carries «"@type":"RealEstateListing"»; the signal matched only
«"@type":"RealEstate"» followed by a quote, so every live ad read as «no opinion» and nothing was verified for three
days. The not-found page and the unrecognised-200 limb must keep their meaning.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3]))

from scrapers.aldarim.run import _signal

NEW_SHAPE = ('<html><head><title>Showroom for Sale in Al Qadisiyah Dist., Riyadh</title>'
             '<script type="application/ld+json">{"@context":"https://schema.org","@type":"RealEstateListing",'
             '"name":"Showroom for Sale","url":"https://www.aldarim.sa/en/properties/26049"}</script></head></html>')
OLD_SHAPE = ('<html><script type="application/ld+json">{"@context":"https://schema.org","@type":"RealEstate",'
             '"name":"x"}</script></html>')
NOT_FOUND = '<html><head><title>Property Not Found | ALDARIM</title></head><body></body></html>'


def test_the_2026_10_20_listing_page_reads_live():
    assert _signal(200, NEW_SHAPE, False) == "live"


def test_the_older_page_shape_still_reads_live():
    assert _signal(200, OLD_SHAPE, False) == "live"


def test_not_found_page_still_reads_gone():
    assert _signal(200, NOT_FOUND, False) == "gone"


def test_an_unrecognised_200_is_still_no_opinion():
    assert _signal(200, '<html><script type="application/ld+json">{"@type":"Organization"}</script></html>', False) is None
    assert _signal(200, '<html><script type="application/ld+json">{"@type":"RealEstateAgent"}</script></html>', False) is None


def test_a_redirect_or_non_200_is_still_no_opinion():
    assert _signal(200, NEW_SHAPE, True) is None
    assert _signal(503, NEW_SHAPE, False) is None
