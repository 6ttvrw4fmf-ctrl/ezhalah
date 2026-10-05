"""hajer's liveness oracle: a badge decides first; with no badge, the listing's own rendered page is
a live answer (2026-10-05). Fixtures are cut from pages read that day."""
from __future__ import annotations

import scrapers.hajer.run as R

_PALETTE = "<style>/* مباع - Red */ .status-sold{background:#dc3545} .status-rented{}</style>"
_SINGLE = ('<html><head>' + _PALETTE + '</head><body class="rtl wp-singular rem_property-template-default '
           'single single-rem_property postid-729 wp-custom-logo">'
           '<article id="post-729" class="post-729 rem_property">دبلكسات للبيع</article></body></html>')
_ARCHIVE = ('<html><head>' + _PALETTE + '</head><body class="rtl archive post-type-archive '
            'post-type-archive-rem_property">grid of single-rem_property cards</body></html>')


def _badge(page: str, cls: str) -> str:
    return page.replace("<article", f'<span class="property-status-badge status-{cls}">x</span><article')


def test_rendered_own_page_without_a_badge_is_live():
    assert R._signal(200, _SINGLE, False) == "live"


def test_terminal_badge_still_wins_over_the_rendered_page():
    assert R._signal(200, _badge(_SINGLE, "sold"), False) == "gone"
    assert R._signal(200, _badge(_SINGLE, "rented"), False) == "gone"


def test_available_badge_is_live():
    assert R._signal(200, _badge(_SINGLE, "available"), False) == "live"


def test_a_page_that_is_not_this_listing_has_no_opinion():
    assert R._signal(200, _ARCHIVE, False) is None
    assert R._signal(200, "", False) is None


def test_404_redirect_and_errors_have_no_opinion():
    assert R._signal(404, _SINGLE, False) is None
    assert R._signal(200, _SINGLE, True) is None
    assert R._signal(503, _SINGLE, False) is None


def test_the_css_palette_alone_never_reads_gone():
    assert R._signal(200, _SINGLE, False) != "gone"
