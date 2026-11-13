"""Card parity (2026-11-06): our card vs the source page, field by field. Pure judge, both ways + planted mismatches."""
from scrapers.common import card_parity as cp
from scrapers.common.new_listings_score import MATCH, MISMATCH, PAGE_SILENT, UNREADABLE

STORED = {"platform": "aqar", "city_ar": "الرياض", "district_ar": "حي النرجس", "deal_ar": "بيع", "type_ar": "شقة",
          "price_total": 850000, "area_m2": 140, "bedrooms": 3, "bathrooms": 2, "license_number": "7200767759",
          "card_licence": "7200767759", "has_photo": True}
LINES = ["شقة للبيع في حي النرجس الرياض", "السعر 850,000 ريال", "المساحة 140 م²", "3 غرف نوم", "2 دورات مياه",
         "رقم رخصة الإعلان 7200767759"]
PAGE = {"title": "شقة للبيع", "meta": {}, "jsonld": [], "evidence_lines": LINES, "text_head": " | ".join(LINES),
        "_text": "\n".join(LINES)}
CARD = {"text": "SAR 850,000 | 140 م² | 3 غرف | 2 حمام | حي النرجس، الرياض | رقم رخصة الإعلان 7200767759",
        "photo": True, "opened_ok": True}


def _judge(stored=STORED, card=CARD, page=PAGE, link="ok", photo=True):
    return cp.judge(stored, card, page, platform="aqar", link_kind=link, page_photo=photo)


def test_a_faithful_card_matches_every_field():
    v = _judge()
    for f in ("price", "area", "bedrooms", "bathrooms", "city", "district", "licence", "photo", "link"):
        assert v[f] == MATCH, (f, v[f])


def test_planted_licence_not_on_card_is_match_since_2026_11_13():   # the 11-06 Falcon finding, re-read 11-13
    """11-06: a card that never showed the licence was the finding. 11-13 (owner, #12123): the card never prints the
    licence by design — it stays on the ad page — so a card without it is MATCH when the page and our row agree."""
    v = cp.judge(STORED, {**CARD, "text": CARD["text"].replace("7200767759", "")}, PAGE, platform="aqar", link_kind="ok")
    assert v["licence"] == cp.MATCH


def test_planted_dead_link_is_caught():                    # the 11-05 Dwelleo finding
    assert _judge(link="dead")["link"] == MISMATCH
    assert _judge(card={**CARD, "opened_ok": False})["link"] == MISMATCH
    assert cp.judge(STORED, CARD, PAGE, platform="aqar", link_kind="moved", link_repaired=True,
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


def test_an_area_line_that_says_metre_is_not_a_rate():      # CodeRabbit (Major) on #11084
    lines = ["المساحة بالمتر: 1,000", "السعر 900,000 ريال"]
    page = {**PAGE, "evidence_lines": lines, "text_head": " | ".join(lines), "_text": "\n".join(lines)}
    land = {**STORED, "type_ar": "أرض", "price_total": 1000000, "area_m2": 1000, "bedrooms": None, "bathrooms": None}
    assert _judge(stored=land, card={**CARD, "text": "SAR 1,000,000 | 1000 م²"}, page=page)["price"] == MISMATCH


def test_rows_shape_panel_licence_is_read():          # 🔧 11-07: aqargate's rows panel read as «we miss it»
    from scrapers.common.card_parity import panel_licence
    assert panel_licence({"rega_ad_license_number": "7200423552"}) == "7200423552"
    assert panel_licence([{"key": "usage", "label": "Property usage", "value": "سكني"},
                          {"key": "rega_ad_license_number", "label": "Ad license number", "value": "7100267912"}]) == "7100267912"
    assert panel_licence([{"key": "adlic", "label": "Ad license number", "value": "7200111222"}]) == "7200111222"
    assert panel_licence({"rows": [{"key": "adlic", "label": "Ad license number", "value": "7200111222"}]}) == "7200111222"
    assert panel_licence([{"key": "usage", "label": "Property usage", "value": "سكني"}]) is None
    assert panel_licence(None) is None
    assert panel_licence({}) is None


def test_licence_digits_and_unlabelled_rows():        # CodeRabbit on #11140
    from scrapers.common.card_parity import panel_licence
    assert panel_licence({"rega_ad_license_number": "٧٢٠٠٤٢٣٥٥٢"}) == "7200423552"
    assert panel_licence([{"key": "rega_ad_license_number", "value": "7100000000"},
                          {"key": "rega_ad_license_number", "label": "Ad license number", "value": "٧٢٠٠٤٢٣٥٥٢"}]) == "7200423552"
    assert panel_licence([{"key": "rega_ad_license_number", "label": "", "value": "7100000000"}]) is None
    assert panel_licence({"rega_ad_license_number": "&#55;200423552"}) == "7200423552"
    assert panel_licence([{"key": "adlic", "label": "Ad license number", "value": "&#55;200423552"}]) == "7200423552"


def test_stored_of_reads_a_rows_panel_licence():      # CodeRabbit on #11140: exercise stored_of itself
    from scrapers.common.card_parity import stored_of

    class Q:
        def __init__(self, data): self._d = data
        def select(self, *a): return self
        def eq(self, *a): return self
        def limit(self, *a): return self
        def execute(self): return type("R", (), {"data": self._d})()

    class C:
        def table(self, name):
            if name == "search_listings_ar":
                return Q([{"license_number": None}])
            return Q([{"listing_url": "https://x/1", "additional_info": {"rows": [
                {"key": "adlic", "label": "Ad license number", "value": "7200111222"}]}}])

    stored, url = stored_of(C(), "aqargate_listings", 1)
    assert stored["card_licence"] == "7200111222"
    assert url == "https://x/1"


def test_a_total_rooms_site_card_never_matches_a_bedroom_count():
    # 👑 2026-11-08: tuba / aqarcity print only REGA total rooms; a bedroom count on their card is never the source's.
    tuba = dict(STORED, platform="tuba")
    v = cp.judge(tuba, CARD, PAGE, platform="tuba", link_kind="ok", page_photo=True)
    assert v["bedrooms"] == MISMATCH, v


def test_exit_code_is_red_when_ads_were_picked_but_no_card_was_read():
    """CodeRabbit on #10958: run_journeys() ignored the journey's exit code, so a PR dry-run that read every source
    page and not one card still returned 0. Ads picked + production quiet + zero cards = the journey died = red."""
    base = {"ads": 6, "cards": 0, "sources": 6, "sites": 3, "pick_errors": 0,
            "busy_chunks": 0, "unreadable_chunks": 0, "dead_chunks": 1}
    assert cp.exit_code(base) == 1                                      # a quiet chunk read no card: the journey died
    assert cp.exit_code({**base, "cards": 6, "dead_chunks": 0}) == 0    # every chunk read cards: green
    assert cp.exit_code({**base, "dead_chunks": 0, "busy_chunks": 1}) == 0   # cards skipped on purpose: not a death
    assert cp.exit_code({**base, "ads": 0, "sites": 0, "dead_chunks": 0}) == 0   # nothing to sample: honest green
    assert cp.exit_code({**base, "ads": 0, "sites": 0, "dead_chunks": 0, "pick_errors": 2}) == 1   # picking failed
    assert cp.exit_code({**base, "cards": 6, "sites": 0, "dead_chunks": 0}) == 1   # ads read, no site row: red
    # CodeRabbit on #11512: one busy chunk must not mask a dead quiet chunk, and an unreadable load check is red
    assert cp.exit_code({**base, "cards": 6, "busy_chunks": 1, "dead_chunks": 1}) == 1
    assert cp.exit_code({**base, "dead_chunks": 0, "unreadable_chunks": 1}) == 1
    assert cp.exit_code({**base, "cards": 6, "dead_chunks": 0, "busy_chunks": 2, "unreadable_chunks": 1}) == 1


def test_main_loop_tells_unreadable_load_from_busy_and_counts_a_dead_chunk():
    """The accounting lives in main(): read its source so the three counters are fed from the right branches."""
    import inspect
    src = inspect.getsource(cp.main)
    assert 'busy.startswith("load unreadable")' in src and 'totals["unreadable_chunks"] += 1' in src
    assert 'elif picks and not cards:' in src and 'totals["dead_chunks"] += 1' in src
    assert 'totals["busy_chunks"] += 1' in src
    # database_quiet() really does return that prefix on repeated RPC errors
    class Boom:
        def rpc(self, *_a, **_k):
            raise RuntimeError("down")
    assert (cp.database_quiet(Boom(), tries=2, wait_s=0) or "").startswith("load unreadable")


def _page(lines, meta=None):
    return {**PAGE, "title": "عقار", "meta": meta or {}, "evidence_lines": lines, "text_head": " | ".join(lines),
            "_text": "\n".join(lines)}


_LAND = {**STORED, "type_ar": "أرض", "price_total": None, "area_m2": 370, "bedrooms": None, "bathrooms": None}


def test_a_printed_zero_is_not_a_price_but_a_real_figure_is():      # macsaib 13604785 (alert 13960, 2026-11-09)
    meta = {"description": "للبيع قطعة ارض - حي حويلان - 370 م² - 0 ريال"}
    silent = _page(["السعر للمتر: 0", "المساحة 370 م²"], meta)
    assert _judge(stored=_LAND, card=None, page=silent)["price"] == PAGE_SILENT
    priced = _page(["السعر للمتر: 0", "المساحة 370 م²"], {"description": "للبيع قطعة ارض - 370 م² - 450,000 ريال"})
    assert _judge(stored=_LAND, card=None, page=priced)["price"] == "we_miss"          # the page states one: we miss it
    both = _page(["السعر 450,000 ريال", "المساحة 370 م²"], meta)
    assert _judge(stored=_LAND, card=None, page=both)["price"] == "we_miss"            # a zero beside a real price
    apart = _page(["السعر 450000 بالريال", "المساحة 370 م²"], meta)
    assert _judge(stored=_LAND, card=None, page=apart)["price"] == "we_miss"           # figure not beside the word


def test_the_pages_own_per_metre_label_is_our_rate_only_when_equal():   # macsaib 13604800 and 13604790
    meta = {"description": "ارض تجارية سكنية للبيع حي الصفاء - 0 ريال"}
    land = {**_LAND, "area_m2": None, "price_per_meter": 750}
    same = _page(["السوم : 600 للمتر والحد 750", "السعر للمتر: 750"], meta)
    assert _judge(stored=land, card=None, page=same)["price"] == MATCH
    other = _page(["السعر للمتر: 800"], meta)
    assert _judge(stored=land, card=None, page=other)["price"] == MISMATCH
    # 13604790: the office removed its rate («السعر للمتر: 0») and we still store 550 — that one is REAL
    gone = _page(["السعر للمتر: 0", "المساحة 506 م²"], meta)
    assert _judge(stored={**land, "price_per_meter": 550, "area_m2": 506}, card=None, page=gone)["price"] == MISMATCH


def test_a_detail_page_printing_our_rate_matches_only_when_rate_times_area_is_our_total():   # villassa 13108884 / 13108862
    plot = {**_LAND, "price_total": 700000, "price_per_meter": 1400, "area_m2": 500}
    page = _page(["1,400 ريال", "ريال", "المساحة 500 م²"])
    assert _judge(stored=plot, card=None, page=page)["price"] == MATCH
    odd = {**_LAND, "price_total": 1037933, "price_per_meter": 1300, "area_m2": 798}     # ad 21: 798.41 m² printed
    assert _judge(stored=odd, card=None, page=_page(["1,300 ريال", "المساحة 798 م²"]))["price"] == MATCH
    assert _judge(stored=plot, card=None, page=_page(["1,500 ريال", "المساحة 500 م²"]))["price"] == MISMATCH
    assert _judge(stored={**plot, "price_total": 900000}, card=None, page=page)["price"] == MISMATCH   # not rate × area
    two = _page(["1,400 ريال", "650,000 ريال", "المساحة 500 م²"])
    assert _judge(stored=plot, card=None, page=two)["price"] == MISMATCH                 # the page prints another total


_OFFICE_FOOTER = "موقعنا الجغرافي : العنوان الاول الدمام حي احد شارع عمر بن الخطاب - العنوان الثانى جدة حي السامر شارع وهيب"


def _district(stored_district, lines, text=None):
    page = _page(lines)
    if text is not None:
        page["_text"] = text
    return cp.judge({**STORED, "district_ar": stored_district}, None, page, platform="x", link_kind=None)["district"]


def test_the_pages_own_district_label_is_ours_only_when_it_names_ours():   # fursaghyr 4367079 (alert 13974, 2026-11-09)
    deed = "حي واحة مكة التطويري الأول المعدل بمدينة مكة المكرمة مساحة الوحدة من الأرض 39.235 متر"
    label = "نوع العقار: شقة المنطقة: منطقة مكة المكرمة الحي: %s المدينة: مكة المكرمة الشارع: حارثة"
    assert _district("أم الجود", [deed], label % "أم الجود " + deed) == "match"
    assert _district("أم الجود", [deed], label % "حي أم الجود " + deed) == "match"
    # the label names another district, or a longer name that only starts with ours: still wrong
    assert _district("أم الجود", [deed], label % "الشوقية " + deed) == "mismatch"
    assert _district("الناصرية", [deed], label % "الناصرية الغربية " + deed) == "mismatch"
    # two labels, one of them not ours: still wrong
    assert _district("أم الجود", [deed], label % "أم الجود" + " الحي: العوالي " + deed) == "mismatch"
    # no label at all: the deed prose is all the page says, and it is not ours
    assert _district("أم الجود", [deed], deed) == "mismatch"


def test_the_offices_own_address_is_not_the_ads_district():                # sqcc 13707588 (alert 13928, 2026-11-09)
    ad = ["أرض للبيع", "المساحة 600 م²"]
    assert _district("الشاطئ", ad + [_OFFICE_FOOTER]) == "page_silent"
    # the ad itself names another district: still wrong, footer or not
    assert _district("الشاطئ", ad + ["أرض للبيع في حي النزهة", _OFFICE_FOOTER]) == "mismatch"
    assert _district("الشاطئ", ad + ["فيلا في حي النزهة - " + _OFFICE_FOOTER]) == "mismatch"
    assert _district("الشاطئ", ad + ["أرض للبيع في حي النزهة"]) == "mismatch"
    # ours is on the page: unchanged
    assert _district("الشاطئ", ad + ["حي الشاطئ", _OFFICE_FOOTER]) == "match"



def test_licence_is_not_asked_of_the_card_since_2026_11_13():
    """Owner 2026-11-13 (#12123): the card never prints the REGA licence; it stays on the ad page. A card whose text
    lacks the number is MATCH when the page and our row carry the same licence — never CARD_MISSING (13:33 UTC 11-13:
    justsa, muktamel, nawafeth, nufouth, reinvest all read card_missing for this one owner decision)."""
    from scrapers.common import card_parity as cp
    stored = {"card_licence": "7200012345", "price": None}
    page = {"_text": "رقم رخصة الإعلان 7200012345", "price": None}
    card = {"text": "شقة للبيع الرياض حي الملقا 850,000 ر.س", "photo": True, "opened_ok": True}
    out = cp.judge(stored, card, page, platform="justsa", link_kind="ok")
    assert out["licence"] == cp.MATCH
    # the data halves still judge: a page that prints another licence and never ours is a MISMATCH …
    other = {"_text": "رقم رخصة الإعلان 7200099999", "price": None}
    assert cp.judge(stored, card, other, platform="justsa", link_kind="ok")["licence"] == cp.MISMATCH
    # … and a row without the licence the page prints is WE_MISS
    assert cp.judge({"price": None}, card, page, platform="justsa", link_kind="ok")["licence"] == cp.WE_MISS
