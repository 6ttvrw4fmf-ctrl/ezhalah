"""source_reread: another listing's related-ad card is not this ad (🔬 2026-10-17, backlog 628).

CI re-read 39021296467: ksaaqar 12226090 (a Makkah sale) scored «kitchen» from a related Jeddah rental's card
title, verbatim below (URL trimmed). The card is dropped; the ad's own lines stay.
"""
from scrapers.common.source_reread import page_evidence

CARD = ('<a href="https://ksaaqar.com/ad/%d8%ac%d8%af%d8%a9/">\n'
        '  <h5>جدة الخمرة الحي المسرات توجد شقة للايجار  غرفتين وصالة ومطبخ وحمام شامل ال...</h5>\n'
        '</a>\n<p><i class="fas fa-map-marker-alt"></i>الخمره</p>')
OWN = '<h1>شقة مع السطح</h1><div>حي العدل, مكة المكرمة</div>'


def test_a_related_card_title_is_not_a_page_line():
    head = page_evidence(OWN + CARD)["text_head"]
    assert "مطبخ" not in head and "شقة مع السطح" in head


def test_the_ads_own_text_is_kept():
    assert "مطبخ" in page_evidence('<h1>شقة مع مطبخ</h1>' + CARD)["text_head"]
