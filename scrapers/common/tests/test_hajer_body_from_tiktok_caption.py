"""hajer: an empty WordPress body falls back to the ad's own TikTok caption (🔬 2026-11-11, backlog 1776).

Markup copied from the re-read page of hajer_residential_listings:10674101 (net.http_get 11456, 2026-11-11): its
<div class="description"> is empty and the advertiser's description sits in the TikTok embed. 55 of 122 active hajer
ads stored description NULL that night, so the word reader had nothing to read (kitchen, garden, laundry unread).
"""
from scrapers.hajer.run import _ad_body, _tiktok_caption_lines

PAGE = ("<div class=\"description\"> </div>"
        "<blockquote class='tiktok-embed' cite='https://www.tiktok.com/@hajer.houses/video/7678056058337758485' "
        "data-video-id='7678056058337758485' style='max-width: 605px;min-width: 325px;' >\n<section> "
        "<a target='_blank' title='@hajer.houses' href='https://www.tiktok.com/@hajer.houses?refer=embed'>@hajer.houses</a> "
        "✅ دبلكسات للبيع في حي الحمراء الثاني بالهفوف -المكونات للوحدات /  &#8211; الدور الأرضي/ مجلس +دور مياه، غرفة طعام،"
        "صالة+دورة مياه،مطبخ+مستودع، حديقة خلفية. &#8211; الدور الاول/ صالة، عدد 4 غرف ماستر &#8211; الملحق/ غرفتين نوم+دورة "
        "مياه،غرفة غسيل ✅ سعر الزاوية/مليون و 50 الف شامل السعي ✅ سعر البطن/مليون شامل السعي       "
        "<a title='الهفوف' target='_blank' href='https://www.tiktok.com/tag/x?refer=embed'>#الهفوف</a> "
        "<a target='_blank' title='♬ الصوت الأصلي - بيوت هجر للخدمات العقارية' href='https://www.tiktok.com/music/x'>"
        "♬ الصوت الأصلي &#8211; بيوت هجر للخدمات العقارية</a> </section>\n</blockquote>")


def test_the_caption_is_the_body_when_wordpress_content_is_empty():
    body = _ad_body({"content": {"rendered": ""}}, PAGE)
    assert "مطبخ+مستودع، حديقة خلفية" in body and "غرفة غسيل" in body
    assert "\n" in body                                        # one line per ✅ / «–» item, so a negation never crosses


def test_no_handle_hashtag_or_advertiser_name_reaches_the_body():
    body = _tiktok_caption_lines(PAGE)
    assert "@hajer" not in body and "#الهفوف" not in body
    assert "بيوت هجر" not in body and "الصوت الأصلي" not in body   # the music credit names the advertiser (PDPL)


def test_a_real_wordpress_body_still_wins():
    assert _ad_body({"content": {"rendered": "<p>فيلا مع مسبح</p>"}}, PAGE) == "فيلا مع مسبح"


def test_no_embed_no_body():
    assert _ad_body({"content": {"rendered": ""}}, "<div class=\"description\"> </div>") == ""
