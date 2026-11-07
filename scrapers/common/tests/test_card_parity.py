"""Card parity (2026-11-06): our card vs the source page, field by field. Pure judge, both ways + planted mismatches."""
from scrapers.common import card_parity as cp
from scrapers.common.new_listings_score import MATCH, MISMATCH, PAGE_SILENT, UNREADABLE

STORED = {"platform": "tuba", "city_ar": "الرياض", "district_ar": "حي النرجس", "deal_ar": "بيع", "type_ar": "شقة",
          "price_total": 850000, "area_m2": 140, "bedrooms": 3, "bathrooms": 2, "license_number": "7200767759",
          "card_licence": "7200767759", "has_photo": True}
LINES = ["شقة للبيع في حي النرجس الرياض", "السعر 850,000 ريال", "المساحة 140 م²", "3 غرف نوم", "2 دورات مياه",
         "رقم رخصة الإعلان 7200767759"]
PAGE = {"title": "شقة للبيع", "meta": {}, "jsonld": [], "evidence_lines": LINES, "text_head": " | ".join(LINES),
        "_text": "\n".join(LINES)}
CARD = {"text": "SAR 850,000 | 140 م² | 3 غرف | 2 حمام | حي النرجس، الرياض | رقم رخصة الإعلان 7200767759",
        "photo": True, "opened_ok": True}


def _judge(stored=STORED, card=CARD, page=PAGE, link="ok", photo=True):
    return cp.judge(stored, card, page, platform="tuba", link_kind=link, page_photo=photo)


def test_a_faithful_card_matches_every_field():
    v = _judge()
    for f in ("price", "area", "bedrooms", "bathrooms", "city", "district", "licence", "photo", "link"):
        assert v[f] == MATCH, (f, v[f])


def test_planted_licence_not_on_card_is_caught():          # the 11-06 Falcon finding
    v = _judge(card={**CARD, "text": CARD["text"].replace("رقم رخصة الإعلان 7200767759", "")})
    assert v["licence"] == cp.CARD_MISSING


def test_planted_dead_link_is_caught():                    # the 11-05 Dwelleo finding
    assert _judge(link="dead")["link"] == MISMATCH
    assert _judge(card={**CARD, "opened_ok": False})["link"] == MISMATCH
    assert cp.judge(STORED, CARD, PAGE, platform="tuba", link_kind="moved", link_repaired=True,
                    page_photo=True)["link"] == cp.REPAIRED


def test_planted_price_and_area_mismatch_is_caught():
    v = _judge(stored={**STORED, "price_total": 990000, "area_m2": 300})
    assert v["area"] in (MISMATCH, cp.CARD_MISSING)
    assert v["price"] in (MISMATCH, cp.CARD_MISSING)
    lines = [x.replace("850,000", "910,000") for x in LINES]
    v = _judge(page={**PAGE, "evidence_lines": lines, "text_head": " | ".join(lines)})
    assert v["price"] == MISMATCH


def test_planted_missing_photo_is_caught():
    assert _judge(card={**CARD, "photo": False})["photo"] == cp.CARD_MISSING


def test_a_licence_that_differs_from_the_source_is_a_mismatch():
    v = _judge(stored={**STORED, "license_number": "7100000001", "card_licence": "7100000001"})
    assert v["licence"] == MISMATCH


def test_unreadable_and_silent_are_never_wrong():
    v = _judge(page=None, link=None)
    assert set(v.values()) <= {UNREADABLE, cp.CARD_MISSING}
    assert all(x == UNREADABLE for f, x in v.items() if f in ("licence", "photo", "link", "price"))
    quiet = {**PAGE, "evidence_lines": ["شقة"], "text_head": "شقة", "_text": "شقة"}
    v = _judge(page=quiet, photo=False)
    assert v["licence"] == PAGE_SILENT and v["photo"] == PAGE_SILENT


def test_stays_never_compare_a_price():
    v = cp.judge({**STORED, "platform": "gathern"}, CARD, PAGE, platform="gathern", link_kind="ok", page_photo=True)
    assert v["price"] == PAGE_SILENT


def test_numbers_fold_separators_and_arabic_digits():
    assert {850000, 140} <= cp.numbers("SAR ٨٥٠٬٠٠٠ · 140 م²")


def test_slots_cover_every_site_once():
    sites = [f"s{i}" for i in range(150)]
    assert sorted(p for k in range(cp.SLOTS) for p in sites if cp.slot_of(p) == k) == sorted(sites)


def test_the_ad_licence_is_read_never_the_brokers_fal_licence():
    page = "معلومات موثوقة من الهيئة العامة للعقار: رقم رخصة فال: 1200025871 رقم ترخيص الاعلان: 7200990751 تاريخ"
    assert cp.licence_on_page(page) == "7200990751"
    assert cp.licence_on_page("رخصة فال: 1200025871") is None


def test_a_fal_label_with_the_word_tarkhees_is_not_the_ad_licence():
    assert cp.licence_on_page("رقم ترخيص فال: 1200025871") is None


def test_card_missing_only_when_the_source_agrees():
    bare = {**CARD, "text": "SAR 850,000"}                     # the card prints no area / district / licence
    silent = {**PAGE, "evidence_lines": ["شقة"], "text_head": "شقة", "_text": "شقة"}
    v = _judge(card=bare, page=silent, photo=False)
    assert v["licence"] == PAGE_SILENT and v["area"] != cp.CARD_MISSING
    lines = [x.replace("140", "300") for x in LINES]
    v = _judge(card=bare, page={**PAGE, "evidence_lines": lines, "text_head": " | ".join(lines)})
    assert v["area"] == MISMATCH                                # a source disagreement stays in its own lane


def test_a_photo_still_loading_is_unknown_not_missing():
    assert _judge(card={**CARD, "photo": None})["photo"] == UNREADABLE


def test_a_label_and_its_value_on_two_lines_are_read_together():   # alqasem / alshawaf, first full run 11-07
    head = "نوع العقار | شقة | المساحة | 265 م | غرف | 3 غرف"
    assert "المساحة 265 م" in cp.paired_lines(head)
    lines = cp.paired_lines(head) + head.split(" | ")
    page = {**PAGE, "evidence_lines": lines, "text_head": head}
    assert _judge(stored={**STORED, "area_m2": 265, "bedrooms": 3}, card={**CARD, "text": CARD["text"] + " 265"},
                  page=page)["area"] == MATCH


def test_our_licence_printed_anywhere_on_the_page_is_a_match():   # alajlan's page lists other ads' licences too
    page = {**PAGE, "_text": "رقم ترخيص الاعلان: 7200503415 … 7200767759"}
    assert _judge(page=page)["licence"] == MATCH


def test_a_home_page_link_names_no_ad():
    assert cp.is_home("https://alajlan-re.com/") and not cp.is_home("https://alshawaf.com.sa/22293")


def test_an_office_number_beside_the_label_is_not_the_ad_licence():   # remaxsa / holoul, first full run 11-07
    assert cp.licence_on_page("رقم الترخيص: 1100029634") is None
    assert cp.licence_on_page("رقم الترخيص 7032067345") is None
    assert cp.licence_on_page("رقم ترخيص الاعلان 7101234567") == "7101234567"


def test_zero_padded_values_and_per_metre_totals():          # dwelleo «04», akariyoun 5,000/m² × 1,120 m²
    assert cp.paired_lines("عدد دورات المياه | 04") == ["عدد دورات المياه 4"]
    lines = ["💰 السعر المطلوب: 5,000 ريال للمتر", "المساحة 1120 م²"]
    page = {**PAGE, "evidence_lines": lines, "text_head": " | ".join(lines), "_text": "\n".join(lines)}
    land = {**STORED, "type_ar": "أرض", "price_total": 5600000, "area_m2": 1120, "bedrooms": None, "bathrooms": None}
    assert _judge(stored=land, card={**CARD, "text": "SAR 5,600,000 | 1120 م²"}, page=page)["price"] == MATCH


def test_only_a_stated_per_metre_rate_makes_a_total():     # CodeRabbit on #11079: area × area is not a rate
    lines = ["السعر 900,000 ريال", "المساحة 1000 م²"]
    page = {**PAGE, "evidence_lines": lines, "text_head": " | ".join(lines), "_text": "\n".join(lines)}
    land = {**STORED, "type_ar": "أرض", "price_total": 1000000, "area_m2": 1000, "bedrooms": None, "bathrooms": None}
    assert _judge(stored=land, card={**CARD, "text": "SAR 1,000,000 | 1000 م²"}, page=page)["price"] == MISMATCH
    assert cp.paired_lines("عدد دورات المياه | ٠٤") == ["عدد دورات المياه 4"]
    assert cp.paired_lines("المساحة | 040.5 م²") == ["المساحة 040.5 م²"]
