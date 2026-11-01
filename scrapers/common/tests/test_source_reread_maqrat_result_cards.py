"""source_reread: maqrat's result cards under an ad are OTHER ads (🔬 2026-11-01, backlog 1123).

CI re-read 41292070655: maqrat 13605201 (/Property/Details/76, no description of its own) carries the card of
ad 72 below, verbatim (whitespace trimmed). The score read the card's «مؤثثة» as this ad's furnished.
"""
from scrapers.common.source_reread import page_evidence

CARD = ('<span class="property-purpose-chip">للبيع</span></div>'
        '<p class="property-showcase-location" title="جدة · الفيصلية">'
        '<i class="fa-solid fa-location-dot" aria-hidden="true"></i><span>جدة · الفيصلية</span></p>'
        '<p class="result-card-description ">'
        '<span class="result-card-description-text">يوجد شقة في نفس المشروع داخليه مؤثثة البيع 680 الف</span>'
        '<a class="result-card-description-more" href="/Property/Details/72" aria-label="المزيد - شقة">المزيد</a></p>')
OWN = '<h1>شقة للبيع في حي النعيم</h1><div class="pd-overview-label">المساحة</div><div class="pd-overview-value">150</div>'


def _all(page: dict) -> str:
    return page["text_head"] + " ".join(page["evidence_lines"])


def test_another_ads_card_is_not_a_page_line():
    page = page_evidence(OWN + CARD)
    assert "مؤثثة" not in _all(page) and "الفيصلية" not in _all(page)
    assert "حي النعيم" in page["text_head"]


def test_the_ads_own_description_is_kept():
    own = OWN + '<h3>وصف العقار</h3><p>شقة مؤثثة بالكامل مع مطبخ راكب</p>'
    assert "مؤثثة" in page_evidence(own + CARD)["text_head"]
