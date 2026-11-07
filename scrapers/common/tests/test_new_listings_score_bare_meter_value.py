"""«عرض الشارع» / «18 م»: a value line with the bare metre «م» states the width (🔬 2026-11-07, justsa).

Markup copied from just.sa/l/595 (justsa_residential_listings:13109260, net.http_get 2026-11-07 response 9293), trimmed.
On the 11-07 dry run 15 of 15 sampled justsa ads scored street_width_m MISMATCH although the page states the stored value."""
from scrapers.common.new_listings_score import MATCH, MISMATCH, compare_listing
from scrapers.common.source_reread import page_evidence

BODY = '''<html><body><div class="spec-item"><div class="spec-icon"><i class="fa-solid fa-bath"></i></div>
<span>الحمامات</span>
<strong>8</strong>
</div>
<div class="spec-item"><div class="spec-icon"><i class="fa-solid fa-road"></i></div>
<span>عرض الشارع</span>
<strong>18 م</strong>
</div>
<div class="spec-item"><div class="spec-icon"><i class="fa-solid fa-building"></i></div>
<span>الواجهة</span>
<strong>جنوبية</strong>
</div></body></html>'''


def _sw(stored):
    return compare_listing({"street_width_m": stored}, page_evidence(BODY), skip_price=True)["street_width_m"]


def test_the_stated_width_matches():
    assert _sw(18) == MATCH


def test_a_different_width_is_still_a_mismatch():
    assert _sw(20) == MISMATCH
