"""نفوذ (nufouth.com) P0s: an ad-level price is a SUM, and on a sale ad the «annual_rent» field
holds the SALE price.

Three independent ways this source can print a wrong number on a card, all measured live on
2026-09-20 over the 270 properties its API answers for:

1. `ad.annual_rent` == `annual_rent_sum` == the SUM over the ad's units. N4990's ADV-00271 carries
   1,645,000 across seven معارض: unit 1 is 470 m² at 1,645,000, units 2-7 are 65 m² each and
   publish "0". Reading the ad-level figure for those six prints 1,645,000 on a 65 m² shop —
   a ~25× error on six cards in one ad.
2. On a SALE ad, `unit.annual_rent` is the SALE price, not rent (all 18 sale units). N5011 is the
   worst shape: ad.annual_rent 110,000 looks exactly like a real annual rent, ad.selling_price is
   1,900,000, and unit.annual_rent is "1,900,000". Choosing the field by "whichever is non-zero"
   instead of by `ad_type` books a 1.9M villa sale as a 110k rental, or as a 1.9M RENT.
3. `custom_price_meter` is DERIVED سعر المتر. N5011's 504.59 × 218 m² = 110,001 — within 1 of that
   same decoy rent figure — while the villa actually sells for 1,900,000.

PROVENANCE, stated exactly (re-fetched live 2026-09-21 and diffed field by field):
  · Every field below is copied from a live `get_property_data` response, with the values it held on
    that date — including the long `details` prose, which an earlier draft had trimmed. A trimmed
    description drops amenity-bearing text («مطبخ مجهّز», «مستودع», «مدخلين منفصلين» on N5011), so a
    fixture that trims it is testing a different listing.
  · Each fixture carries only the KEYS map_listing reads, not the whole payload (images, fees,
    marketing links are omitted). Omitting a key the code never reads is not an edit of the listing.
  · Two tests are SYNTHETIC and say so in their own docstrings: the ad-type field-selection test
    (a real ad's figures under a units list it does not have) and the ppm-promotion guard (a
    priceless unit given a non-zero ppm). Neither shape exists live; both pin a rule against a future
    data shift. Nothing else here is constructed.

Every assertion runs the SHIPPING functions (`run.map_listing`, `run._amenities`, `run._photo_urls`,
`run.session`, `run.main`) — never a re-implementation. The two DB-backed location helpers are the
only things stubbed, because the barrier is offline.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.nufouth import run as R  # noqa: E402

# --- offline stand-ins for the only two DB-backed helpers -------------------------------------
_CATALOG = {"مكة المكرمة": (21, 2), "الرياض": (1, 1), "المدينة المنورة": (3, 3)}
R.to_catalog = lambda city_ar, region_hint=None: _CATALOG.get((city_ar or "").strip(), (None, None))
R.find_district_in_text = lambda text, city_id: (text or "").strip() or None


# ============================ REAL PAYLOAD FRAGMENTS =========================================
# N4990 «الصفا - الموسى» — مجمع تجاري in مكة المكرمة, ad ADV-00271, seven معارض under ONE rent.
N4990 = {
    "property": {"code": "N4990", "property_type": "مجمع تجاري", "city": "مكة المكرمة",
                 "district": "حي العزيزية", "property_area": 2500},
    "services": ["انترنت فايبر", "بهو واسع", "نظافة دورية", "حارس عقار", "حراسات أمنية"],
    "faclities": ["غرفة حارس", "مدخل سياره", "مواقف خاصة", "مصلى"],
    "features": ["إنترنت فايبر", "كاميرات المراقبة", "واجهة رخام"],
}
N4990_AD = {"name": "ADV-00271", "ad_type": "ايجار", "status": "نشط", "annual_rent": 1645000.0,
            "selling_price": 0.0, "total_area": 469.98, "ad_license_no": "7200762568 ",
            "custom_sell_property": 0}
# The PRICED unit: 470 m², publishes its own 1,645,000. Its ppm 3500 × 470 reproduces it exactly —
# which is why ppm is treated as the site's own division and never as an independent fact.
N4990_U1 = {"name": "(1-معرض)-الصفا - الموسى -N4990", "unit_type": "معرض", "unit_no": "1",
            "space": 470.0, "area": 470.0, "annual_rent": "1,645,000", "selling_price": "0",
            "custom_price_meter": 3500.0, "no_of_rooms": 0, "no_of_bathrooms": 3,
            "air_contioning": "تكييف مركزي", "finishing": "مشطب",
            "details": "يتكوّن العقار من 7 معارض متصلة، بمساحة إجمالية تبلغ 470 متر مربع، "
                       "مجهّزة بتكييف مركزي لضمان بيئة مريحة وجو مناسب للعمل. توفر هذه المساحة "
                       "الكبيرة إمكانيات واسعة لاستخدامات تجارية متنوعة، مع مراعاة الراحة "
                       "والفعالية في توزيع المعارض.",
            "service": ["نظافة دورية"], "feature": ["مصاعد"], "facility": ["مكيفات مركزيه"],
            "images_unit_main": ["/files/WhatsApp Image 2025-11-16 at 2.18.07 PM.jpeg"]}
# The PRICELESS unit: 65 m², publishes "0". The ad above still says 1,645,000.
N4990_U2 = {"name": "(2-معرض)-الصفا - الموسى -N4990", "unit_type": "معرض", "unit_no": "2",
            "space": 65.0, "area": 65.0, "annual_rent": "0", "selling_price": "0",
            "custom_price_meter": 0.0, "no_of_rooms": 0, "no_of_bathrooms": 1,
            "air_contioning": "تكييف مركزي", "finishing": "مشطب", "details": "",
            "service": [], "feature": [], "facility": [], "images_unit_main": []}

# N5011 «فيلا منال - العارض» — a SALE whose annual_rent field is populated three different ways.
N5011 = {"property": {"code": "N5011", "property_type": "فيلا", "city": "الرياض",
                      "district": "حي العارض", "property_area": 218},
         "services": [], "faclities": ["حوش", "مدخل سياره", "غرفة خادمة"],
         "features": ["إنترنت فايبر", "واجهة حجر"]}
N5011_AD = {"name": "ADV-00680", "ad_type": "بيع", "status": "نشط", "annual_rent": 110000.0,
            "selling_price": 1900000.0, "total_area": 0.0, "ad_license_no": "7200862295",
            "custom_sell_property": 0}
N5011_U = {"name": "(1-فيلا)-فيلا منال - العارض-N5011", "unit_type": "فيلا", "unit_no": "1",
           "space": 218.0, "area": 218.0, "annual_rent": "1,900,000",
           "selling_price": "1,900,000", "custom_price_meter": 504.59, "no_of_rooms": 6,
           "no_of_bathrooms": 6, "air_contioning": "سبلت",
           "details": ("فيلا فاخرة للبيع تتكون من :\n\nالملحق الخارجي والحوش:\nحوش واسع\n"
                       "ملحق خارجي\nمدخل سيارة\nمدخلين منفصلين\n\nالدور الأرضي:\nمجلس\nمقلط\n"
                       "مطبخ مجهّز\n2 دورات مياه\nمستودع\n\nالدور الأول:\n4 غرف نوم، منها غرفتان "
                       "ماستر مع دورات مياه خاصة\nصالة واسعة\nمطبخ\n3 دورات مياه\n\nالدور الثاني:\n"
                       "غرفة نوم ماستر\nصالة\nسطح\n\nالفيلا تجمع بين الفخامة والراحة، مع توزيع "
                       "مثالي للمساحات يوفر الخصوصية لجميع أفراد الأسرة، بالإضافة إلى حوش ومداخل "
                       "متعددة لسهولة الوصول والسيولة في الحركة."),
           "service": [], "feature": ["مكيفات راكبة", "مؤثثة"],
           "facility": ["مدخل سياره", "غرفة خادمة", "حوش"],
           "images_unit_main": ["/files/WhatsApp Image 2026-02-02 at 6.34.12 PM (7).jpeg"]}

# H133 «عمارة الصويدرة» — the unit that STATES it has no air conditioning.
H133 = {"property": {"code": "H133", "property_type": "عمارة", "city": "المدينة المنورة",
                     "district": "حي الصويدرة"},
        "services": ["نظافة دورية"], "faclities": [], "features": []}
H133_AD = {"name": "ADV-00810", "ad_type": "ايجار", "status": "نشط", "annual_rent": 11000.0,
           "selling_price": 0.0, "custom_sell_property": 0}
H133_U = {"name": "(3-شقة)-عمارة الصويدرة - حيا مرزوق الحربي F-H133", "unit_type": "شقة",
          "unit_no": "3", "space": 0.0, "area": 0.0, "annual_rent": "11,000",
          "selling_price": "0", "no_of_rooms": 5, "no_of_bathrooms": 2, "air_contioning": "بدون",
          "details": ("شقة سكنية تتكون من  خمس غرف واسعة ، بالإضافة إلى دورتي مياه  ومطبخ مستقل "
                      "بمساحة مناسبة يتيح سهولة الحركة والتنظيم.\n\nتتميز الشقة بتوزيع داخلي مدروس "
                      "يحقق الاستفادة المثلى من المساحات، مما يجعلها خيارًا مثاليًا للعائلات "
                      "الباحثة عن السكن المريح والعملي في آنٍ واحد.\n"),
          "service": [], "feature": [], "facility": [], "images_unit_main": []}

# N5345 «عمارة بن دخيل - النرجس» — the elevator is stated ONLY as the broken plural «مصاعد»,
# on the PROPERTY's feature list, and this unit publishes no price of its own.
N5345 = {"property": {"code": "N5345", "property_type": "عمارة سكنية تجارية", "city": "الرياض",
                      "district": "حي النرجس"},
         "services": ["انترنت فايبر", "بهو واسع", "حارس عقار", "مداخل معطرة"],
         "faclities": ["مواقف خاصة"],
         "features": ["تصميم حديث", "دفاع مدني مرخص", "كاميرات المراقبة", "مصاعد", "واجهة رخام"]}
N5345_AD = {"name": "ADV-01318", "ad_type": "ايجار", "status": "نشط", "annual_rent": 351000.0,
            "selling_price": 0.0, "custom_sell_property": 0}
N5345_U2 = {"name": "(2-معرض)-عمارة بن دخيل - النرجس-N5345", "unit_type": "معرض", "unit_no": "2",
            "space": 0.0, "area": 0.0, "annual_rent": "0", "selling_price": "0",
            "custom_price_meter": 0.0, "no_of_rooms": 0, "no_of_bathrooms": 0,
            "air_contioning": "", "details": "", "service": [], "feature": [], "facility": [],
            "images_unit_main": []}

# N2060 «استراحة الغنامية» — a SALE ad whose annual_rent field holds a real-looking 15,000 beside a
# selling_price of 401,000. The only shape in the source where the two fields disagree.
N2060 = {"property": {"code": "N2060", "property_type": "استراحة", "city": "الرياض",
                      "district": "حي الغنامية", "property_area": 320},
         "services": [], "faclities": [], "features": []}
N2060_AD = {"name": "ADV-00683", "ad_type": "بيع", "status": "نشط", "annual_rent": 15000.0,
            "selling_price": 401000.0, "total_area": 0.0, "custom_sell_property": 0,
            "ad_license_no": "7200863522"}

URL = "https://nufouth.com/latest-offers/commercial-for-rent?ads-N4990=1"


def _row(msg, ad, unit, url=URL):
    row, category, why = R.map_listing(msg, ad, unit, url)
    assert row is not None, f"expected a row, got skip_reason={why!r}"
    return row, category


# ============================ 1. THE AD-LEVEL SUM ============================================
def test_ad_level_rent_is_a_sum_and_is_never_a_units_price():
    """N4990 ADV-00271: 1,645,000 belongs to unit 1 (470 m²) and to NO other unit in the ad."""
    priced, _ = _row(N4990, N4990_AD, N4990_U1)
    assert priced["price_annual"] == 1645000
    assert priced["area_m2"] == 470

    silent, _ = _row(N4990, N4990_AD, N4990_U2)
    assert silent["area_m2"] == 65, "the 65 m² unit must keep its own area"
    # The whole point: no price was published for this unit, so there is none.
    assert silent["price_annual"] is None
    assert silent.get("price_total") is None
    assert silent["price_annual"] != N4990_AD["annual_rent"]
    # …and a NULL price must not drag a period along with it.
    assert silent.get("rent_period") is None

    # The two units of one ad are distinct listings, not one row overwriting the other.
    assert priced["ad_number"] != silent["ad_number"]


def test_ppm_times_area_is_not_invented_when_no_price_is_published():
    """N4990's silent units carry ppm 0 — there is nothing to multiply, so nothing is stored."""
    silent, _ = _row(N4990, N4990_AD, N4990_U2)
    assert silent["price_annual"] is None
    assert "price_meter" not in silent["additional_info"], "ppm 0 is not a published per-metre rate"



def test_a_priceless_unit_with_a_published_ppm_is_never_given_ppm_times_area():
    """SYNTHETIC — no live unit has price 0 beside a non-zero ppm (measured over all 335).

    Pins the one reading a future edit could slip in: «فراغ السعر؟ احسبه من سعر المتر». A total
    built here is a number the source never printed, so the price stays NULL and ppm stays evidence.
    """
    unit = dict(N4990_U2, custom_price_meter=800.0, space=100.0, area=100.0)
    row, _ = _row(N4990, N4990_AD, unit)
    assert row["price_annual"] is None and row.get("price_total") is None
    assert row.get("rent_period") is None
    assert row["additional_info"]["price_meter"] == 800.0

# ============================ 2. THE SALE AD'S «annual_rent» =================================
def test_sale_ad_reads_selling_price_and_never_the_annual_rent_field():
    """N5011: the only correct number is 1,900,000, as a SALE total."""
    row, category = _row(N5011, N5011_AD, N5011_U)
    assert row["transaction_type"] == "Buy"
    assert category == "residential"
    assert row["price_total"] == 1900000

    # A Buy row may not carry a rent at all — not the decoy ad-level 110,000, not the sale price
    # relabelled as rent, and not a rent period.
    assert row.get("price_annual") is None
    assert row.get("rent_period") is None
    assert row["price_total"] != 110000, "ad.annual_rent on a sale ad is not this listing's price"

    # ppm × area = 504.59 × 218 = 110,001, one riyal from the decoy. It is never the total.
    assert row["price_total"] != round(504.59 * 218)
    assert row["additional_info"]["price_meter"] == 504.59, "ppm is kept, as evidence only"


def test_the_price_field_is_chosen_by_ad_type_not_by_which_one_is_non_zero():
    """SYNTHETIC — a defensive invariant, NOT an observed live exposure.

    Stated plainly because an earlier draft overclaimed it. The rule — choose the price field by
    `ad_type`, never by whichever field happens to be non-zero — is correct and worth pinning, but
    NO production row can currently tell the two readings apart:
      · At the UNIT level this source mirrors the sale price into `annual_rent`, so on all 18 sale
        units both fields hold the same number.
      · The 3 sale ads whose AD-level fields disagree (N2060 15,000 vs 401,000, N5011 110,000 vs
        1,900,000, R107 85,000 vs 1,500,000) each have exactly ONE unit, so shipping code reads the
        unit's own field and never those ad-level figures.
      · On all 11 genuine whole-property ads (units empty) the two fields are one-zero or identical
        (N4470 53,000,000 = 53,000,000; R104 4,200,000 = 4,200,000).
    Measured 2026-09-21 over all 335 candidates: every one yields the same price under either
    reading.

    So this test constructs the shape on purpose: N2060's real ad figures, with `unit=None` — a
    whole-property offer, which N2060 is NOT in production. It exists so that a future listing that
    really is whole-property AND has disagreeing fields cannot print 15,000 on a 401,000 sale.
    """
    ad = dict(N2060_AD)
    assert ad["annual_rent"] == 15000.0 and ad["selling_price"] == 401000.0

    row, _ = _row(N2060, ad, None)
    assert row["transaction_type"] == "Buy"
    assert row["price_total"] == 401000, "a sale is priced from selling_price, whatever rent says"
    assert row["price_total"] != 15000, "ad.annual_rent on a sale ad is not the sale price"
    assert row.get("price_annual") is None and row.get("rent_period") is None

    # The mirror image: a RENT ad is priced from annual_rent even if a selling_price sits beside it.
    rent = dict(ad, ad_type="ايجار")
    row2, _ = _row(N2060, rent, None)
    assert row2["transaction_type"] == "Rent"
    assert row2["price_annual"] == 15000 and row2["rent_period"] == "annual"
    assert row2.get("price_total") is None
    assert row2["price_annual"] != 401000, "selling_price must never be published as a rent"


def test_rent_ad_states_an_annual_period_and_only_alongside_a_price():
    """The field is `annual_rent` and the site labels it «الإيجار السنوي» — the period is STATED."""
    row, _ = _row(H133, H133_AD, H133_U)
    assert row["transaction_type"] == "Rent"
    assert row["price_annual"] == 11000
    assert row["rent_period"] == "annual"
    assert row.get("price_total") is None
    # A monthly figure would be a 12× error on the card; nothing here may read as monthly.
    assert row["rent_period"] != "monthly"


# ============================ 3. AMENITIES: FOUR OUTCOMES ====================================
def test_silence_is_null_never_false():
    """N4990's unit 2 mentions no kitchen and no furnishing. Absent means NULL, not "no"."""
    row, _ = _row(N4990, N4990_AD, N4990_U2)
    for col in ("kitchen", "furnished", "maid_room", "driver_room", "laundry_room"):
        assert col not in row, f"{col} was silent in the source and must not be reported as False"


def test_stated_absence_is_false_not_null():
    """H133's unit states air_contioning «بدون» — WITHOUT. That is the source saying no."""
    row, _ = _row(H133, H133_AD, H133_U)
    assert row["air_conditioner"] is False
    # Measured on 58 of 324 units; losing it to NULL would silently discard a source-stated fact.
    assert row["air_conditioner"] is not None


def test_prepared_only_air_conditioning_stays_null():
    """«مؤسس» is PREPARED for air conditioning, which is not having it."""
    prepared = dict(H133_U, air_contioning="مؤسس")
    row, _ = _row(H133, H133_AD, prepared)
    assert "air_conditioner" not in row


def test_broken_plural_elevator_is_read_from_the_property_list():
    """N5345 states its lift only as «مصاعد». The shared token list carries «مصعد», and a broken
    plural does not substring-match its singular, so this column used to sit NULL on 62 of 270
    properties."""
    row, _ = _row(N5345, N5345_AD, N5345_U2)
    assert row["elevator"] is True


def test_the_plural_rewrite_does_not_defeat_negation_or_proximity():
    """The rewrite replaces the word IN PLACE, so amenities_from_text's windows still measure the
    same distances around it. If it ever became a deletion or an unconditional set, these break."""
    assert R._amenities({}, None, "العمارة بدون مصاعد")["elevator"] is False
    assert "elevator" not in R._amenities({}, None, "المبنى قريب من مصاعد المجمع المجاور")


def test_a_shared_lobby_feature_is_not_this_units_amenity():
    """«مداخل مكيفة» (19× in the source) says the BUILDING's entrances are air-conditioned — the
    same kind of claim as «قريب من حديقة», and not evidence that this unit has air conditioning.
    No listing currently depends on this (every property publishing the token also states AC some
    other way); it is a guard so a data shift cannot turn a lobby into a fabricated True."""
    assert "air_conditioner" not in R._amenities({"services": ["مداخل مكيفة"]}, None, None)
    # The singular — the unit's OWN entrance — must still be read.
    assert R._amenities({"faclities": ["مدخل سياره"]}, None, None)["car_entrance"] is True


def test_named_lists_outrank_prose_so_proximity_cannot_erase_a_structured_fact():
    """amenities_from_text stops at a token's FIRST occurrence. With one blob, a description's
    «قريب من مواقف» would suppress the facility list's «مواقف خاصة» and lose a real True."""
    msg = {"faclities": ["مواقف خاصة"]}
    assert R._amenities(msg, None, "الموقع قريب من مواقف عامة")["parking"] is True


# ============================ 4. WHAT MUST BE SKIPPED ========================================
def test_an_ad_that_is_not_active_is_skipped():
    for status in ("منتهي", "ملغي", ""):
        row, _cat, why = R.map_listing(N4990, dict(N4990_AD, status=status), N4990_U1, URL)
        assert row is None and why.startswith("status_"), f"{status!r} published anyway: {why!r}"


def test_a_type_that_will_not_map_is_skipped_not_guessed():
    """Mixed-use «ارض سكنية تجارية» cannot be one category, and «صراف» has no canonical type.
    N5345's own property_type «عمارة سكنية تجارية» is why its whole-property ad would skip too."""
    for type_ar in ("ارض سكنية تجارية", "صراف", "فيلا دوبلكس", "برج", "كمباوند"):
        row, _cat, why = R.map_listing(N4990, N4990_AD, dict(N4990_U1, unit_type=type_ar), URL)
        assert row is None and why == "type_unmapped", f"{type_ar!r} was guessed: {why!r}"
    row, _cat, why = R.map_listing(N5345, N5345_AD, None, URL)
    assert row is None and why == "type_unmapped"


def test_a_city_the_catalog_cannot_place_is_skipped_not_guessed():
    """to_catalog decides what a real city is — never the source's own label."""
    row, _cat, why = R.map_listing(
        {**N4990, "property": dict(N4990["property"], city="بالحمر")}, N4990_AD, N4990_U1, URL)
    assert row is None and why == "city_not_in_catalog"


def test_an_unknown_deal_is_skipped_rather_than_defaulted_to_rent():
    row, _cat, why = R.map_listing(N4990, dict(N4990_AD, ad_type="مزاد"), N4990_U1, URL)
    assert row is None and why.startswith("deal_unknown")


# ============================ 5. THE FIELDS THAT SILENTLY BREAK EVERYTHING ===================
def test_session_requests_arabic_or_every_city_comes_back_english():
    """Measured on N4685: with no Accept-Language the SAME endpoint returns city "Riyadh", which
    to_catalog cannot place — so every listing skips and the run finalizes green with 0 rows.
    The header is executed here, not asserted from a comment."""
    s = R.session()
    assert "ar" in s.headers.get("Accept-Language", ""), "Arabic Accept-Language is mandatory"
    # impersonate owns the User-Agent; overriding it contradicts the TLS fingerprint.
    assert not any(k.lower() == "user-agent" for k in s.headers)


def test_photo_paths_are_percent_encoded_and_absolute():
    """Real paths carry spaces, parentheses and Arabic; unencoded they break an <img>."""
    urls = R._photo_urls(N5011_U["images_unit_main"],
                         ["<div class='swiper-slide'><img src='/files/صور_العقار_2.jpg'/></div>"])
    assert urls[0] == ("https://nufouth.com/files/WhatsApp%20Image%202026-02-02%20at%20"
                       "6.34.12%20PM%20%287%29.jpeg")
    assert " " not in urls[0] and urls[1].startswith("https://nufouth.com/files/%D8%B5")


def test_area_and_room_counts_of_zero_are_null_not_zero():
    """0 is this source's "not stated" for area, rooms and bathrooms alike."""
    row, _ = _row(H133, H133_AD, H133_U)          # space 0.0
    assert row["area_m2"] is None
    row2, _ = _row(N5345, N5345_AD, N5345_U2)     # rooms 0, bathrooms 0
    assert row2["bathrooms"] is None and row2["bedrooms"] is None


def test_rooms_are_bedrooms_only_in_a_dwelling():
    """`no_of_rooms` on a معرض/مكتب is that unit's room count, not a bedroom count — it must never
    answer a bedroom filter. It is still kept as evidence."""
    shop = dict(N4990_U1, no_of_rooms=4)
    row, _ = _row(N4990, N4990_AD, shop)
    assert row["bedrooms"] is None
    assert row["additional_info"]["source_rooms"] == 4

    home, _ = _row(H133, H133_AD, H133_U)         # شقة with no_of_rooms 5
    assert home["bedrooms"] == 5


def test_arabic_indic_digits_parse_as_digits():
    """٠-٩ are real digits. normalize.to_int handles them; _pos must not lose that."""
    assert R._pos("٣٢٠") == 320
    assert R._pos("١,٦٤٥,٠٠٠") == 1645000
    assert R._pos("0") is None and R._pos(0.0) is None and R._pos(None) is None


def test_listing_url_is_the_deep_link_not_the_broken_B_path():
    """/B/<code> serves HTTP 500 for most codes (H626, H133, R10045, N5175 — persistently), so the
    stored URL is the site's own `?ads-<CODE>=1` deep link."""
    row, _ = _row(N4990, N4990_AD, N4990_U1)
    assert row["listing_url"] == URL
    assert "/B/" not in row["listing_url"] and "ads-N4990=1" in row["listing_url"]


def test_city_and_district_reach_the_row_in_arabic():
    row, _ = _row(N4990, N4990_AD, N4990_U1)
    assert row["city_ar"] == "مكة المكرمة"
    assert row["district_ar"] == "حي العزيزية"
    assert row["city_id"] == 21 and row["region_id"] == 2
    assert row["source"] == "نفوذ"
    assert row["ad_number"].startswith("NFZN4990")
    # The REGA advertising licence the source publishes on all 324 units is kept.
    assert row["additional_info"]["ad_license_no"] == "7200762568 "
    # …and reaches the real column listing_extra_attrs reads, plus the card's own key.
    assert row["license_number"] == "7200762568"
    assert row["additional_info"]["rega_ad_license_number"] == "7200762568"



# ============================ 6. THE RUN LEDGER ==============================================
def test_the_skip_tally_reaches_end_run_so_an_empty_run_says_why(monkeypatch):
    """Runs the REAL main(): every skip reason must land in scrape_runs.notes, not only stdout."""
    calls = {}
    props = {"N4990": {**N4990, "ads": [{"ad": N4990_AD, "units": [
                 N4990_U1, dict(N4990_U2, unit_type="صراف")]}]},
             "N0000": {**N4990, "ads": []}}
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "session", lambda: None)
    monkeypatch.setattr(R, "fetch_index", lambda s: {c: URL for c in props})
    monkeypatch.setattr(R, "fetch_property", lambda s, c: props[c])
    monkeypatch.setattr(R.db, "begin_run", lambda src: 1)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda t, rows: None)
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **k: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda *a, **k: 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **k: calls.update(k) or True)

    assert R.main() == 0
    assert calls["ok"] is True and calls["rows_upserted"] == 1
    assert "type_unmappedx1" in calls["notes"] and "no_active_adsx1" in calls["notes"]


def test_the_apis_labelled_facts_reach_their_af_columns():
    for prop, frontage, floor, want in (
        ({"street_width": "15.00", "age_property": 10}, ["شمال"], "الأرضي", (15, "شمال", 10, 0)),
        ({"street_width": "25.00-15", "age_property": None}, ["شمال", "غرب"], "الفيلا كامله",
         (None, None, None, None)),                               # two streets / not a floor
        ({"street_width": "13.5"}, ["جنوب شرقي"], "الثاني", (None, "جنوب شرق", None, 2)),
    ):
        msg = {**N5011, "property": {**N5011["property"], **prop}, "frontage": frontage}
        row, _ = _row(msg, N5011_AD, {**N5011_U, "unit_floor": floor})
        got = (row["street_width_m"], row["direction"], row["property_age"], row["floor_number"])
        assert got == want, (prop, frontage, floor)
        assert row["additional_info"].get("lng") == msg["property"].get("long")
