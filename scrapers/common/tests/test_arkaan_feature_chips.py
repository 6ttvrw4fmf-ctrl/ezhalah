"""arkaan: the ad's own feature chips answer kitchen / elevator / parking (🔬 2026-10-17).

CI source-reread 39021280625 (2026-10-17) on https://arkaanalaqar.com/property/1895 printed the description
section's chip list, verbatim below (whitespace trimmed). The parser read none of it, so kitchen and elevator were
NULL on an ad that names both, and arkaan scored kitchen we-miss 3 and 0 of 3 findable.
"""
import scrapers.arkaan.run as R

PAGE = (
    '<div class="property-description-feature-list">'
    '<span class="property-description-feature">\r\n <i class="bi bi-door-closed"></i>\r\n <span>ثلاث غرف نوم</span>\r\n </span>'
    '<span class="property-description-feature">\r\n <i class="bi bi-droplet"></i>\r\n <span>ثلاث دورات مياه</span>\r\n </span>'
    '<span class="property-description-feature">\r\n <i class="bi bi-cup-hot"></i>\r\n <span>مطبخ مغلق مؤثث</span>\r\n </span>'
    '<span class="property-description-feature">\r\n <i class="bi bi-arrow-up"></i>\r\n <span>مصعد</span>\r\n </span>'
    '\r\n </div>\r\n <div class="property-description-plain-text">للايجار شقة عزاب</div>'
)
RELATED = ('<div class="property-description-feature-list"><span class="property-description-feature">'
           '<i></i><span>موقف خاص</span></span></div>')


def _chips(body):
    fl = R._FEATURE_LIST.search(body)
    return [c for c in (R._text(x) for x in R._FEATURE.findall(fl.group(1))) if c] if fl else []


def test_the_chips_are_read_in_order():
    assert _chips(PAGE) == ["ثلاث غرف نوم", "ثلاث دورات مياه", "مطبخ مغلق مؤثث", "مصعد"]


def test_named_chips_answer_yes_and_unnamed_facts_stay_unknown():
    assert R.feature_answers(_chips(PAGE)) == {"kitchen": True, "elevator": True}


def test_only_the_first_list_is_this_ads():
    assert "parking" not in R.feature_answers(_chips(PAGE + RELATED))


def test_a_negated_chip_says_no():
    assert R.feature_answers(["بدون مصعد", "مطبخ راكب"]) == {"elevator": False, "kitchen": True}


def test_a_page_without_chips_answers_nothing():
    assert R.feature_answers(_chips('<div class="property-description-plain-text">مطبخ</div>')) == {}


def test_furnished_kitchen_is_not_a_furnished_unit():
    assert "furnished" not in R.feature_answers(["مطبخ مغلق مؤثث"])


def test_map_listing_writes_the_chip_answers(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda *a, **k: (None, None))
    item = {"id": "1895", "specs": {}, "ptype": "شقة", "deal": "للإيجار", "hood": "حي جواثا", "landno": "",
            "status": "", "price_text": "", "title_text": "شقة للإيجار", "last_updated": "", "index_image": None}
    detail = {"ld": {}, "type_text": "شقة للإيجار", "feature_chips": ["مطبخ مغلق مؤثث", "مصعد"],
              "ad_text": "للايجار شقة", "price_card": "السعر 14,000 ريال"}
    row, _ = R.map_listing(item, detail)
    assert row["kitchen"] is True and row["elevator"] is True and "parking" not in row
    assert row["additional_info"]["feature_chips"] == ["مطبخ مغلق مؤثث", "مصعد"]
