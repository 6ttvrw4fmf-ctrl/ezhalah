"""wahadat prints each unit's price as «<span>799,000</span>» followed by the Saudi riyal SIGN drawn as an inline SVG,
and the project's JSON-LD says «الأسعار تبدأ من 759,000 ريال». Read 2026-11-14 (wahadat.sa/project/وشاح-11 through
net.http_get; card parity alert 14669: 6 of 12 wahadat prices «mismatch», e.g. 13603694 stored 799,000 = the page's
unitsData price). The reader dropped every <svg>, so the unit figures reached the score with no currency word and only
the project's «starts from» price looked like a price. Markup below is the page's own, trimmed; the glyph path is cut
after its first segments (the reader keys on its opening, the sign's outline)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import source_reread as R  # noqa: E402
from scrapers.common.new_listings_score import compare_listing  # noqa: E402

_SIGN = ('<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5">'
         '<path d="M13.663 20.545A7.827 7.827 0 0013 23l7.337-1.545A7.828 7.828 0 0021 19l-7.337 1.545z" '
         'fill="currentColor"></path></svg>')
_LD = {"@context": "https://schema.org", "@type": "RealEstateListing", "name": "وشاح 11",
       "description": "وشاح 11 في حي العارض، الرياض. الأسعار تبدأ من 759,000 ريال. تصفح الوحدات المتاحة واحجز زيارتك عبر منصة وحدات."}


def _unit(name, price, sign=_SIGN):
    return (f'<div class="flex items-center gap-4"><span class="text-base font-bold" title="{name}">{name}</span>'
            f'<div class="flex items-center gap-1"><span class="text-foreground text-xl">{price}</span>{sign}</div></div>')


def _page(units):
    return ('<html><head><title>وشاح 11 - وحدات</title><script type="application/ld+json">' + json.dumps(_LD, ensure_ascii=False)
            + "</script></head><body>" + "".join(units) + "</body></html>")


STORED = {"platform": "wahadat", "price_total": 799000, "deal_ar": "بيع", "type_ar": "شقة"}
PAGE = _page([_unit("1 \\ 1", "759,000"), _unit("1 \\ 10", "799,000")])


def test_the_drawn_riyal_sign_is_the_currency_word():
    lines = R.page_evidence(PAGE)["evidence_lines"]
    assert any("799,000 ريال" in x for x in lines), lines


def test_the_unit_price_reads_as_the_page_s_own():
    assert compare_listing(STORED, R.page_evidence(PAGE))["price"] == "match"


def test_a_price_the_page_never_prints_still_reads_as_a_mismatch():
    assert compare_listing(dict(STORED, price_total=905000), R.page_evidence(PAGE))["price"] == "mismatch"


def test_any_other_icon_after_a_figure_is_not_a_currency():
    other = '<svg viewBox="0 0 20 21"><path d="M10 2a8 8 0 100 16"></path></svg>'
    lines = R.page_evidence(_page([_unit("1 \\ 10", "799,000", sign=other)]))["evidence_lines"]
    assert not any("799,000 ريال" in x for x in lines)
