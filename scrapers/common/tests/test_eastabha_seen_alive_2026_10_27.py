"""eastabha: the crawl's own detail-page read now stamps the row alive (2026-10-27).

181 active rows, 0 ever verified: the crawl re-reads the full REST list nightly, so no row reached
grace and prune_unseen's oracle (own ribbon / 404) was never asked. But the crawl already fetches
every ad's OWN page (parse_detail). detail_proves_live() records that read — zero extra requests —
only when the page is THIS post (body class postid-<id>) and its own ribbon is not a removal.

Shapes measured 2026-10-27 with curl:
  live   /estate_property/6991/  200, postid-36084, ribbon «أرض استثمار»
  rented /estate_property/2845/  200, postid-35661, ribbons «بيت إيجار» + «تأجرت»
  sold   /estate_property/6024/  200, postid-34780, ribbons «أرض فضاء», «ارض سكني», «تم البيع»
  fake   /estate_property/zz-not-real-99999/  404
"""
from __future__ import annotations

import inspect

from scrapers.common import db
from scrapers.eastabha import run as EA


def _ribbon(label: str) -> str:
    return (f'<div class="slider-property-status horizontalstatus ribbon-wrapper-{label} {label}">'
            f'{label}</div>')


LIVE = f'<body class="estate_property-template-default single postid-36084">{_ribbon("أرض استثمار")}'
RENTED = f'<body class="single postid-35661">{_ribbon("بيت إيجار")}{_ribbon("تأجرت")}'
SOLD = f'<body class="single postid-34780">{_ribbon("أرض فضاء")}{_ribbon("تم البيع")}'
# The related-listings carousel carries OTHER listings' ribbons in ribbon-inside, never in
# slider-property-status — a sold neighbour must not stop this listing being live.
LIVE_WITH_SOLD_NEIGHBOUR = LIVE + '<div class="ribbon-inside">تم البيع</div>'


def test_a_live_page_for_this_post_proves_live():
    assert EA.detail_proves_live(36084, 200, LIVE)
    assert EA.detail_proves_live("36084", 200, LIVE_WITH_SOLD_NEIGHBOUR)


def test_rented_or_sold_ribbon_is_never_stamped():
    assert not EA.detail_proves_live(35661, 200, RENTED)
    assert not EA.detail_proves_live(34780, 200, SOLD)


def test_another_posts_page_is_not_this_listing():
    assert not EA.detail_proves_live(36084, 200, RENTED)          # postid-35661
    assert not EA.detail_proves_live(3608, 200, LIVE)             # a prefix is not the id


def test_unknown_reads_prove_nothing():
    for status in (None, 403, 404, 410, 429, 500, 503):
        assert not EA.detail_proves_live(36084, status, LIVE)
    assert not EA.detail_proves_live(36084, 200, "")
    assert not EA.detail_proves_live(None, 200, LIVE)


def test_the_gone_signal_is_unchanged():
    assert EA._signal(404, "", False) == "gone"
    assert EA._signal(200, SOLD, False) == "gone"
    assert EA._signal(200, LIVE, False) is None, "the prune oracle still has no live limb"
    assert EA._signal(403, "", False) is None and EA._signal(None, "", False) is None


def test_main_marks_the_row_only_through_the_predicate():
    src = inspect.getsource(EA.main)
    assert "detail_proves_live(" in src and "db.mark_direct_alive(row, oracle=DIRECT_ALIVE_ORACLE)" in src
    assert 'row.get("active") is True' in src


def test_an_inactive_row_never_keeps_the_stamp():
    row = db.mark_direct_alive({"ad_number": "EA35661", "active": False}, oracle=EA.DIRECT_ALIVE_ORACLE)
    patch, reason = db.decide_direct_alive(row, "2026-10-27T00:00:00+00:00")
    assert patch == {} and reason == "dropped-inactive"
    live = db.mark_direct_alive({"ad_number": "EA36084", "active": True}, oracle=EA.DIRECT_ALIVE_ORACLE)
    patch, reason = db.decide_direct_alive(live, "2026-10-27T00:00:00+00:00")
    assert reason == "stamped" and "last_verified_alive_at" in patch
