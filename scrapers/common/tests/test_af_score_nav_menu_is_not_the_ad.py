"""af_score: opensooq's category menu is not the ad (🔬, 2026-10-14, backlog 76 / 129).

CI source-reread 38543714404: every «مطبخ» / «مكيف» on opensooq 13605230 and 13605245 was a menu link
(<a href="/ar/أجهزة-منزلية/أجهزة-منزلية-للمطبخ">أجهزة مطبخ</a>); opensooq scored 0 of 5 findable with kitchen
and AC «missed» 5 of 5. The page's own words stay.
"""
from scrapers.common import af_score as A

BODY = ('<nav><a href="/ar/أجهزة-منزلية/أجهزة-منزلية-للمطبخ">أجهزة مطبخ</a>'
        '<a href="/ar/أجهزة-تكييف/مكيفات">مكيفات هواء</a></nav>'
        '<main><h1>شقة فاخرة في شوران</h1><p>شقة دور أول مع مصعد خاص</p></main>')


def _page():
    return {"title": "شقة فاخرة في شوران", "meta": {},
            "evidence_lines": ["أجهزة مطبخ", "مكيفات هواء", "شقة دور أول مع مصعد خاص"],
            "text_head": "أجهزة مطبخ | مكيفات هواء | شقة دور أول مع مصعد خاص"}


def test_menu_links_are_dropped_and_the_ad_words_stay():
    lines = A.page_lines(A.strip_nav(_page(), BODY))
    assert not any("مطبخ" in x or "مكيف" in x for x in lines)
    assert any("مصعد" in x for x in lines)
    assert not A.says_yes(lines, "kitchen") and A.says_yes(lines, "elevator")
    # 2026-10-26: opensooq publishes its amenities structurally on the ad page (opensooq_props), so on opensooq the
    # page's prose is silent for them (law §2); the menu stays dropped either way.
    assert not A.says_yes(lines, "kitchen", "opensooq") and not A.says_yes(lines, "elevator", "opensooq")


def test_without_links_the_page_is_unchanged():
    assert A.strip_nav(_page(), "<p>no links</p>") == _page()


def test_only_listed_sites_are_stripped():
    assert "opensooq" in A.NAV_LINK_SITES and "aqar" not in A.NAV_LINK_SITES
