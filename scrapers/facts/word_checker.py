"""Word checker — reads facts out of an ad's OWN text with fixed word lists. Free, deterministic, and every
row carries the ad's words as proof. The owner's VECTOR COMBO (2026-10-24): THIS decides yes/no; the vectors
(scrapers/facts/words.py) only help FIND ads and words it missed — a vector never writes a yes or a no.

    python -m scrapers.facts.word_checker --selftest          # no network, no env

SOURCE IS TRUTH — three outcomes per fact, exactly as the LLM run (scrapers/facts/extract.py):
  true   the ad names it                          «مسبح خاص», «عدد المجالس: 2»
  false  the ad explicitly negates it             «بدون مسبح», «غير مفروشة», «لا يوجد مصعد», «مفروشة: لا», «المطابخ: 0»
  none   silent, PREPARED/POSSIBLE only («مصعد مؤسس», «تأسيس مسبح», «يمكن عمل مسبح»), or NEARBY («قريب من حديقة»)
Two statements in one ad that disagree («مصعد … بدون مصعد») have not stated the fact → none
(normalize.amenities_from_text's rule). No opinions (big, luxury, view) are in the catalogue at all.

REUSE, not a silent fork: the guard vocabularies (_PREPARED_ONLY, _PROXIMITY, _NEGATORS, _PARTIAL_*,
_FLOOR_COVERING, _EMBEDDED_IN_NAME), the clause splitter, the scrapers' own amenity tokens (_AMENITY_TOKENS,
every one of them, matched the same loose way) and the labelled-age reader are IMPORTED from
scrapers/common/normalize.py, so a word a scraper learns there is learned here too. The text normaliser and
the PDPL sanitizer are the LLM run's (extract.norm / extract.sanitize), so the two runs read the same text.
It does not call amenities_from_text() itself because it needs the matched SPAN for proof (that helper
returns only a bool) and the catalogue is three times larger. Where it is STRICTER than that helper it says
so inline — e.g. a negator must touch the token (or a list of catalogue words before it), not sit anywhere in
a 12-character window: «بدون عمولة ومطبخ راكب» has a kitchen.
"""
from __future__ import annotations

import argparse
import bisect
import re
import sys
import unicodedata
from typing import Any, Optional

from scrapers.common import normalize as N
from scrapers.facts.extract import _STRIP_RE, _TRANS, BOOL_FACTS, NUM_FACTS, TEXT_FACTS, norm, sanitize

MODEL = "word-checker-v1"
MAX_TEXT = 8000
_W = re.compile(r"[^\W_]")   # letters and digits; «_» is a bullet mark («_مسبح وجم», dealapp 21612879, 🔬 2026-11-14)
# A SHORT AD IS READ WHEN IT IS A PHRASE, NOT A LABEL (2026-10-30, backlog 936). Under 20 folded characters used to be
# skipped outright, so bahadhabab 10777798 «مفروشه سنه كامله» (16) never answered furnished. A lone word («مصعد») is
# still never a fact: it reads like a field label with no value, so a short text needs two words or more.
MIN_NORM_CHARS = 20
MIN_SHORT_WORDS = 2


def readable(folded: str) -> bool:
    """Is this folded (norm) ad text enough to read facts from? Long enough, or a short phrase of 2+ words."""
    return len(folded) >= MIN_NORM_CHARS or len(folded.split()) >= MIN_SHORT_WORDS


# ── text: line-preserving PDPL sanitize, then a normaliser that remembers where each char came from ─────────
def clean_text(title: Optional[str], description: Optional[str]) -> str:
    """Title + description, PDPL-sanitised with the LLM run's sanitizer LINE BY LINE (it folds newlines,
    and a line break is a clause break here — «الشقة غير مؤثثة\\nمطبخ» must not read kitchen = no).
    HTML blocks (wasalt) become lines first."""
    desc = _STREET_ADDRESS.sub(" ، ", description or "")
    if (o := _OTHER_OFFERS.search(desc)):   # the broker's list of OTHER ads closes the ad: nothing after it is this unit's
        desc = desc[:o.start()]
    title = _STREET_ADDRESS.sub(" ، ", title or "")
    if "<" in desc and ">" in desc:
        desc = N.html_block_lines(desc)
    lines = [title or ""] + re.split(r"[\r\n]+", desc)
    out = "\n".join(s for ln in lines if ln.strip() and (s := sanitize(None, ln)))
    if _NO_EMOJI.search(out):   # a ✅ / ❌ list: each tick ends its item so a ❌ never runs on into a ✅
        out = _NO_EMOJI.sub(" بدون ", _MARK_EMOJI.sub(" ، ", out))
    return _COLON_NO.sub(r"\1،", unicodedata.normalize("NFKC", out))[:MAX_TEXT]


# A form value «لا» ends its clause: «مفروشة: لا يُعرف حي الأمل …», «مؤثثة: لا تتضمن …», «مفروش: لا **المرافق:**»
# (muhaysini; full run 458 furnished rows read as yes). «… : لا يوجد» stays one negation.
# A no-entry mark in front of a word is the ad saying NO («الأنشطة غير مرغوبة 🚫 مطاعم 🚫 محل شيشه», 2026-11-03 audit):
# the normaliser drops emoji, so the mark becomes the word «بدون» before it is lost and the negator rule applies.
# …and a tick mark ends the clause, so a no before it does not run on into the next item («❌ مسبح ✅ مجلس»).
_MARK_EMOJI = re.compile(r"[\u2705\u2714\u2611]\uFE0F?")   # only inside a ✅/❌ list: a plain tick list keeps its header («ضمانات تشمل: ✅ …»)
# The street the ad is ON is an address, never a feature (2026-11-03 audit round 2: aqar titles «… للبيع في شارع بير قحطان,
# حي …» read as a well, «في شارع الحمام» as toilets, «في شارع الشلال» as a waterfall). «في شارع X,» up to the comma goes.
_STREET_ADDRESS = re.compile(r"في شارع [^,،|\n]{1,60}[,،]")
# A broker's footer listing OTHER offers (🔬 2026-11-04 elevator precision sample: dealapp 7058934 «🌟 أفضل 5 عروض حصرية
# لدينا (حتى الآن): 🔥 تاون هاوس علوي بمصعد | مخطط رسن طيبة | 280 م …» served lift = yes on a ground-floor unit). The
# heading sits after the ad's own text (9 active dealapp ads, ~83% of the way in), so the description ends there.
_OTHER_OFFERS = re.compile(r"(?:أفضل|افضل)\s+[0-9٠-٩]+\s+عروض|عروض(?:نا)?\s+(?:أخرى|اخرى|حصرية|حصريه)\s+(?:لدينا|متوفرة|متوفره)")
_NO_EMOJI = re.compile(r"[\U0001F6AB\u274C\u26D4\u2716\u274E]\uFE0F?(?!\s*(?:بدون|بلا|لا|غير|ما|مافي|مافيه|ممنوع|يمنع|ليس|no)(?!\w))")
# (…unless the ad already wrote the no itself: «🚫 بدون سعي» is one no, not two)
_COLON_NO = re.compile(r"(:[\s*]*لا)(?=\s+(?!(?:يوجد|توجد|يتوفر|تتوفر|غير)(?!\w))\S)")


def norm_map(raw: str) -> tuple[str, list[int]]:
    """extract.norm(raw) plus, for every output char, the index in `raw` it came from (raw is NFKC already)."""
    out: list[str] = []
    idx: list[int] = []
    for i, ch in enumerate(raw):
        if _STRIP_RE.match(ch):
            continue
        for c in ch.translate(_TRANS).lower():
            if _W.match(c):
                out.append(c)
                idx.append(i)
            elif out and out[-1] != " ":
                out.append(" ")
                idx.append(i)
    while out and out[-1] == " ":
        out.pop()
        idx.pop()
    return "".join(out), idx


def _n(s: str) -> str:
    return norm(s)


# ── the catalogue: fact → token specs ─────────────────────────────────────────────────────────────────────
# A spec is one of:
#   "word"     loose substring, the scrapers' own way (every _AMENITY_TOKENS entry is used like this)
#   "^word"    must START a word (after an optional و/ف/ب/ل/ال/وال/بال/فال/لل) — «سطح» must not fire inside «مسطح»
#   "^word$"   …and END it — «خزان» must not fire on «خزانه» (a wardrobe), «بير» not on «كبير»
#   "re:…"     a regex on the normalised clause, word-start anchored the same way
# (spec, value) forces the value: («مدخل واحد», False) is an explicit «not two entrances».
_PROCLITIC = r"(?:وال|بال|فال|لل|ال|و|ف|ب|ل)?"

_INHERITED = {   # catalogue key → normalize._AMENITY_TOKENS key (balcony_terrace is the column's name)
    "elevator": "elevator", "kitchen": "kitchen", "air_conditioner": "air_conditioner", "parking": "parking",
    "maid_room": "maid_room", "driver_room": "driver_room", "laundry_room": "laundry_room",
    "balcony": "balcony_terrace", "private_entrance": "private_entrance", "car_entrance": "car_entrance",
    "optical_fibers": "optical_fibers", "furnished": "furnished",
}
_METER = r"(?:مستقل|مستقله|منفصل|منفصله|خاص|خاصه)"
_WATER = r"(?:ال)?(?:مياه|ماء|مويه)"
_POWER = r"(?:ال)?(?:كهرباء|كهربائي|كهربا|كهربه|كهرب)"
# who may rent (singles / families): «مسموح للعزاب» is a yes, «غير مسموح / ممنوع / لا نقبل …» an explicit no
_NOT_ALLOWED = r"(?:غير مسموح|ممنوع|ممنوعه|ممنوعين|لا نقبل|ما نقبل|لا يسمح|لا يقبل|لا نسمح|يمنع|نعتذر من|نعتذر عن|لا نؤجر|ما نؤجر|لا اؤجر|لا استقبل|لا نستقبل|ما نستقبل)(?: (?:سكن|تاجير|ال?سكن|ال?تاجير))?"
_ALLOWED = r"(?<!غير )(?<!لا )(?<!ما )(?:مسموح|مسموحه|يسمح|نسمح|نقبل|يقبل)"
_TO = r"(?:لل|ل|ب|بال|ال|وال)?"
_WHO_MAY_RENT = frozenset({"singles", "families"})
# …and the «who / what is it for» facts of the 2026-11-01 handoff read «مسموح» / «ممنوع» the same way
_PERMIT_FACTS = _WHO_MAY_RENT | {"for_families", "for_youth", "for_events", "food_allowed"}
_BILL = r"(?:كهرباء|كهربا|كهربه|كهرب|ماء|مياه|مويه|فواتير|فاتوره|خدمات|غاز)"   # what a rent may include (bills_included)

FACT_TOKENS: dict[str, list[Any]] = {
    "elevator": ["^اصانصير", "^اسانسير", "^اصنصير", "^اسنسير"],
    "kitchen": ["^مطابخ"],                                      # «المطابخ: 1» (sakan/tuba count label)
    "air_conditioner": ["^تكيف$"],
    "parking": ["^باركينج", "^باركنج", "^براكنق", "^براكنج", "^باركين", "^باركنق", "^بركنج"],  # transliterations
    "maid_room": ["غرفة عاملة", "غرفة للعاملة", "غرفة العاملة", "غرفة للخادمة", "غرفة الخادمة", "غرف خادمات",
                  "غرفة للشغالة", "غرفة الشغالة", "غرفة خدامة",
                  # AI teacher pass 2026-10-27: «جناح خادمة», «غرفة نوم للخادمة», «قسم للشغاله», «ملحق خاص بالعاملة»,
                  # «غرفة خاصة بالخادمة», the typos «حادمه» / «عرفة خادمة»
                  r"re:(?:غرفه|عرفه|جناح|قسم|ملحق|غرفه نوم) (?:خاص(?:ه)? )?(?:لل|بال|ال|ب)?(?:خادمه|خدامه|حادمه|شغاله|عامله)"],
    "driver_room": ["غرفة سواق", "غرفة سايق", "غرفة للسائق", "غرفة السائق", "غرفة للسواق", "غرفة السواق",
                    "re:غرف (?:لل|ال)?سائقين", "غرفة سائقين"],
    "laundry_room": [],
    "balcony": ["^بلكون", "^بالكون", "^شرفات", "balcon"],
    "private_entrance": ["مداخل خاصة", "مداخل مستقلة", ("re:مدخل (?:ال)?مشترك", False)],
    "car_entrance": ["مدخل للسيارة", "مدخل للسيارات", "مدخل سيارتين"],
    "optical_fibers": ["re:(?:ال)?الياف (?:ال)?(?:ضوئيه|بصريه)", "fibreoptic", "^fiber", "^fibre"],
    # Silent-ads teacher pass (facts-silent-2026-10-26): short-stay sellers (gathern, aqarmonthly) write the furniture
    # itself — «بأثاث مودرن / فاخر / مريح / عصري / راقي / أنيق», «بتأثيث فندقي», «متكاملة الأثاث», «مجهزة بالكامل» — 118 of
    # 124 AI furnished rows were this shape and the reader had none of them. A described piece of furniture is the
    # seller naming it; «بدون تأثيث» / «غير مؤثث» stay an explicit no.
    "furnished": ["^موثث", ("re:(?:بدون|بلا|من غير|غير) (?:ال)?(?:اثاث|تاثيث|موثث)", False),
                  # 🔬 2026-11-05 «doesn't say» audit (69,723 yearly ads, the AI reader's 609 answers read by hand):
                  # typos no other word shares («ماثثة بالكامل», «مأثثه», «مرفروشة», «مفروووووش»), office furniture
                  # («أثاث مكتبي راقٍ وجاهز»), and a no that names the furniture («لا تتوفر أثاث», «عدم وجود أثاث»,
                  # «الأثاث غير موجود»). Not «موثق» (= notarised), not «مجهزة» (equipped) — those stay silent.
                  "^ماثث", "^مرفروش", "re:مفرو{2,}ش", "re:(?:ب|و|وب)?(?:ال)?اثاث (?:ال)?مكتبي",
                  ("re:(?:لا (?:يتوفر|تتوفر|يوجد|توجد|يشمل|تشمل)|لايوجد|لاتوجد|عدم (?:وجود|توفر)) (?:ال)?(?:اثاث|تاثيث)", False),
                  ("re:(?:ال)?اثاث غير (?:موجود|متوفر|مشمول)", False),
                  # «سعرها بدون فرش وتكيف» (🔬 2026-11-05) — «فرش» alone is the furnishing; a floor covering names its floor
                  ("re:(?:بدون|بلا|من غير) (?:ال)?فرش(?!\S)(?! (?:ال)?(?:ارض|موكيت|بلاط|سيراميك|رخام|باركيه|عشب|نجيل))", False), "re:(?:مع|شامل|شامله) (?:ال)?اثاث",
                  "re:(?:ب|و|وب)?(?:ال)?اثاث (?:مودرن|فاخر|مريح|عصري|راقي|انيق|هادي|كامل|جديد|حديث|فندقي)",
                  "re:(?:ب|و|وب)?تاثيث (?:فندقي|كامل|فاخر|مودرن|عصري|راقي)", "re:متكامل(?:ه)? (?:ال)?اثاث",
                  # AI teacher pass 2026-10-27: «بأثاثها العصري», «أثاث فخم», «فرش راقٍ / فاخر / كامل»
                  "re:(?:ب|و|وب)?(?:ال)?اثاثها (?:ال)?(?:عصري|مودرن|فاخر|راقي|انيق|كامل|فخم)",
                  "re:(?:ب|و|وب)?(?:ال)?اثاث (?:فخم|كامل)", "re:فرش (?:راقي|راق|فاخر|كامل|فندقي|جديد|فخم)"],
    # AI teacher pass 2026-10-27 (ops_ai_facts_reader_gaps, 5,123 electricity rows the reader had no row for): the
    # dialect word «كهرب» («شامل كهرب ومويه», «ماء وكهرب راكب») and the typo «كهربه».
    "electricity": ["^كهرباء", "^كهربا$", "^كهرب$", "^كهربه$", "^electricity"],
    "water_supply": ["^مياه", "^ماء$", "^مويه$", "^مويا$", "re:waters?"],
    "sanitation": ["re:(?:ال)?صرف (?:ال)?صحي", "^sanitation", "^sewage", "^sewer"],
    "separate_electricity_meter": [
        rf"re:عداد(?:ات|ت)? {_POWER}(?: و{_WATER})? {_METER}",
        # AI teacher pass 2026-10-27: two or more meters ARE separate meters — «عدادين كهرباء», «3 عدادات كهرباء»,
        # «عدد 2 عداد كهرباء», «عداد كهرباء لكل دور / لكل شقه», «عدادات وخزانات مستقلة»
        rf"re:عداد(?:ين|ان) {_POWER}", rf"re:(?:[2-9]|[1-9]\d) عداد(?:ات)? {_POWER}", rf"re:عدد \d+ عداد(?:ات)? {_POWER}",
        rf"re:عداد(?:ات)? {_POWER} لكل", r"re:عدادات و ?خزانات (?:مستقل|مستقله|منفصل|منفصله)",
        rf"re:عداد(?:ات)? {_METER}",
        rf"re:{_POWER} (?:مستقل|مستقله|منفصل|منفصله)",
        rf"re:عداد(?:ات)? {_WATER} و{_POWER} {_METER}",
        (rf"re:عداد(?:ات)? (?:{_POWER} )?(?:مشترك|مشتركه)", False),
    ],
    "separate_water_meter": [
        rf"re:عداد(?:ات)? {_WATER}(?: و{_POWER})? {_METER}",
        rf"re:عداد(?:ات)? {_POWER} و{_WATER} {_METER}",
        rf"re:{_WATER} (?:مستقل|مستقله|منفصل|منفصله)",
        (rf"re:عداد(?:ات)? {_WATER} (?:مشترك|مشتركه)", False),
    ],
    "payment_monthly": ["re:(?:ال)?(?:دفع|دفعات|سداد|تسديد) (?:ال)?(?:شهري|شهريه|شهريا|بالشهر)",
                        "re:(?:ال)?(?:دفع|دفعات|سداد|تسديد) كل شهر",
                        "re:(?:ال)?(?:دفع|سداد) (?:ال)?ايجار (?:ال)?شهري", "monthly payment", "pay monthly"],
    "pool": ["^مسبح", "^مسابح", "re:(?:ال)?حوض (?:ال)?سباحه", "swimming pool", "re:pools?"],
    "gym": ["re:(?:ال)?نادي (?:ال)?(?:رياضي|صحي|رجالي|نسائي)", "re:(?:ال)?صاله (?:ال)?(?:رياضيه|العاب رياضيه)",
            "re:(?:ال)?(?:انديه|نوادي) (?:ال)?رياضيه", "^جيم$", "^gym", "^fitness", "health club"],
    "garden": ["^حديق", "re:gardens?"],                     # plural «حدائق» = the district's parks (bench-v1)
    "majlis": ["^مجلس", "^مجالس", "^majlis"],
    # Corner / on two (or more) streets (owner 2026-10-26, silent-ads teacher pass): the AI labelled «على شارعين» as
    # two_entrances — wrong label, real fact. Saved as its own fact (no filter column yet), the same words the street-width
    # reader already uses to refuse a width. A corner lot is a property fact, not an entrance.
    "corner_plot": ["^زاويه$", "^زاوية$", "^ركنيه$", "^ركني$", "re:(?:علي|على|ع) شارعين", "^شارعين$", "^شارعان$",
                    "re:(?:ثلاث|ثلاثه|اربع|اربعه|[2-4]) شوارع", "^corner"],
    "roof": ["^سطح$", "^سطحين$", "^سطحان$", "^سطوح$", "^روف$", "^roof"],
    "warranty": ["^ضمان", "^صمانات", "^ظمانات", "^warrant",
                 # AI teacher pass 2026-10-27: the hidden-defects INSURANCE developers sell as the building warranty —
                 # «تأمين ضد العيوب الخفية», «تأمين 10 سنوات», «تأمين التعاونية / ملاذ عشر سنوات»
                 r"re:تامين (?:ضد )?(?:ال)?عيوب", r"re:ضد (?:ال)?عيوب (?:ال)?خفيه", r"re:تامين (?:ال)?(?:تعاونيه|ملاذ)",
                 r"re:تامين \d+ (?:سنوات|سنه|سنين)"],  # common misspellings; never bare «صمان» (وادي الصمان)
    "water_tank": ["^خزان$", "^خزانات$", "^خزانين$", "^خزانان$", "water tank"],
    "well": ["^بئر$", "^بير$", "^ابار$", "^بئرين$", "^بيرين$", "^ارتوازي"],
    "annex": ["^ملحق$", "^ملاحق$", "^ملحقين$", "^annex"],
    "two_entrances": ["^مدخلين$", "^مدخلان$", "re:مدخل (?:لل|ال)?رجال و ?مدخل (?:لل|ال)?نساء", "two entrances",
                      ("re:مدخل واحد", False)],
    "yard": ["^حوش$", "^حوشين$", "^حوشان$", "^احواش", "^فناء", "^yard$", "^yards$", "courtyard"],   # «Yardville Compound» is a name
    "electronic_deed": ["re:(?:ال)?صك(?:وك)? (?:ال)?(?:الكتروني|اكتروني)(?:ه|ا)?", "electronic deed",
                        ("re:(?:ال)?صك (?:ال)?(?:يدوي|ورقي)", False)],
    "grill": ["^مشب$", "^مشبات$", "^شوايه$", "^شوايات$", "^شواء$", "^bbq", "barbecue"],
    "basement": ["^قبو$", "^بدروم", "^بيسمنت", "^basement"],
    "storage": ["^مستودع", "^مخزن$", "^مخازن$", "re:(?:ال)?غرف(?:ه)? (?:لل|ال)?تخزين", "^storage"],
    "garage": ["^كراج", "^جراج", "^قراج", "^garage"],
    # ── the 28 apartment chips (owner 2026-10-31 handoff): the Advanced Filter learns them from the ad's own words ──
    # self_checkin and smart_entry overlap on purpose (both fire on «دخول ذكي» / «قفل ذكي»).
    "self_checkin": ["دخول ذاتي", "دخول ذكي", "قفل ذكي", "تسجيل دخول ذاتي", "self check in", "self checkin", "smart lock"],
    # «نت» only as a whole word («بالنت», «والنت»); «انترنت» / «إنترنت» by their own start; wi-fi folds to «wi fi»
    "wifi": ["واي فاي", "وايفاي", "^انترنت", r"re:(?:(?<=ال)|(?<= )|^|(?<=\d))نت", "wifi", "wi fi", "internet"],   # «بنت» is a name, never «ب+نت»
    # ONLY the «included» phrasing — never a bare «كهرباء» / «ماء» (those are the supply facts, with their cues)
    "bills_included": [rf"re:(?:شامل|شامله|يشمل|تشمل) (?:لل|ال)?{_BILL}(?: و(?:ال)?{_BILL})*",
                       rf"re:(?:ال)?{_BILL}(?: و(?:ال)?{_BILL})* (?:مشمول|مشموله|مشمولين|مشمولات)",
                       rf"re:(?:ال)?{_BILL}(?: و(?:ال)?{_BILL})* (?:علي|ع) (?:ال)?مالك",
                       "bills included", "utilities included", "including bills", "including utilities"],
    "jacuzzi": ["^جاكوزي", "^جكوزي", "jacuzzi"],
    "smart_tv": ["re:(?:شاشه|شاشات|تلفزيون|تلفزيونات|تلفاز) (?:ذكي|ذكيه|سمارت)", "سمارت تي في", "غرفة سينما", "سينما منزلية",
                 "^سينما$", "^بروجكتر", "^بروجيكتر", "smart tv", "^cinema", "projector"],
    "billiards": ["^بليارد", "billiard", "pool table"],
    "cleaning_service": ["re:خدم(?:ه|ات) (?:ال)?(?:تنظيف|نظافه)", "تنظيف يومي", "تنظيف اسبوعي", "cleaning service",
                         "housekeeping"],
    "soundproof": ["re:عازل(?:ه|ات)? (?:لل|ال)?صوت", "عزل صوت", "soundproof"],
    "cameras": ["^كاميرات", "^كامرات", "كاميرا مراقبة", "cctv", "security camera"],
    "guard": ["^حارس$", "^حراسه$", "^حراس$", "re:حارس (?:لل|ال)?(?:عماره|مبني|بنايه|برج)", "نظام امن", "security guard"],
    "smart_entry": ["دخول ذكي", "قفل ذكي", "مدخل ذكي", "smart entry", "smart lock"],
    "smart_home": ["سمارت هوم", "منزل ذكي", "بيت ذكي", "re:نظام (?:ال)?(?:منزل|بيت) (?:ال)?ذكي", "نظام ذكي", "smart home"],
    # «تمديد» is a PREPARED word for every other fact; here the piping IS the feature, so the regex owns the word
    "central_gas": ["غاز مركزي", "re:تمديد(?:ات)? (?:ال)?غاز (?:ال)?مركزي", "خزان غاز طبيعي", "central gas"],
    "sauna": ["^ساونا", "غرفة بخار", "sauna", "steam room"],
    "kids_play_area": ["re:(?:منطقه|مناطق|ملعب|ملاعب|العاب|صاله|ساحه) (?:العاب )?(?:لل|ال)?اطفال", "kids play area",
                       "playground", "play area"],
    "nursery": ["^حضانه", "nursery"],
    "free_maintenance": ["re:(?:ال)?صيانه (?:ال)?مجاني(?:ه|ا)?",
                         "re:(?:ال)?صيانه (?:علي|ع) (?:ال)?مالك", "free maintenance"],
    "intercom": ["^انتركوم", "^انتركم", "^intercom"],
    "fire_system": ["re:نظام (?:ال)?(?:اطفاء|حريق)", "re:(?:ال)?انذار (?:ال)?حريق", "re:كاشف(?:ات)? (?:ال)?دخان",
                    "re:طفاي(?:ه|ات) (?:ال)?حريق", "fire alarm", "fire system", "smoke detector", "fire extinguisher"],
    "ev_charger": ["re:(?:شاحن|شواحن) (?:ال)?(?:سيارات|سياره) (?:ال)?كهربائي(?:ه)?",
                   "re:(?:شاحن|شواحن) (?:ال)?كهربائي(?:ه)? (?:لل|ال)?سيار(?:ات|ه)", "ev charger", "ev charging"],
    "central_vacuum": ["مكنسة مركزية", "مكانس مركزية", "central vacuum"],
    # a bare «عازل» is the soundproof fact's ambiguity — only the thermal / water kinds count here
    "insulation": ["عزل حراري", "عزل مائي", "عازل حراري", "عازل مائي", "عزل فوم", "^عوازل", "re:معزول(?:ه)? (?:حراريا|مائيا)",
                   "thermal insulation", "waterproofing"],
    "dining_majlis": ["^مقلط", "re:(?:مجلس|صاله|غرفه) (?:ال)?طعام", "dining majlis", "dining room"],
    "own_bathroom": ["re:(?:حمام|حمامات|دوره مياه|دورات مياه) (?:خاص|خاصه)", "private bathroom", "ensuite", "en suite"],
    "fridge": ["^ثلاج", "fridge", "refrigerator"],
    "whole_floor": ["re:(?:ال)?(?:دور|طابق) (?:بال|ال)?كامل", "whole floor", "entire floor"],
    # «مسموح» is the permit guard's word for every other fact; here the ad's yes / no is exactly that word
    "singles": ["^عزاب", "singles", (rf"re:{_NOT_ALLOWED} {_TO}عزاب(?:ي|يه)?", False), (rf"re:{_ALLOWED} {_TO}عزاب(?:ي|يه)?", True)],
    "families": ["^عوائل", "^عائلات", "families", (rf"re:{_NOT_ALLOWED} {_TO}(?:عوائل|عائلات)", False),
                 (rf"re:{_ALLOWED} {_TO}(?:عوائل|عائلات)", True)],
    # ── the villa facts (owner 2026-11-01): seven text facts, each a future Advanced Filter chip. `well` already sits
    # above (its place guard: «بير السلم», «بير عثمان»). A fact is true only when the ad SAYS it; the shared guards
    # («بدون», «لا يوجد», «قريب من», «يمكن عمل») apply unchanged. ──
    "women_majlis": ["re:مجلس (?:ال)?(?:نساء|حريم|نسائي|نسوان)", "re:مجالس (?:ال)?(?:نساء|حريم|نسائيه)",
                     "women s majlis", "ladies majlis"],
    # «ري» alone is two letters inside many words — only with its system / method / network word
    "irrigation": ["re:نظام (?:ال)?ري", "re:شبك(?:ه|ات) (?:ال)?ري", "re:(?:ال)?ري (?:ال)?(?:الي|اوتوماتيكي|اوتوماتيك|اتوماتيك|تلقائي|بالتنقيط)",
                   "irrigation", "sprinkler"],
    # a bare «ملعب» as a whole word (the owner's list); the plural «ملاعب» is the district's pitches, like «حدائق» (garden)
    "sports_court": ["^ملعب$", "re:ملعب (?:ال)?(?:تنس|اسكواش|سكواش|بادل|كره (?:ال)?(?:سله|قدم|طائره|يد))",
                     "tennis court", "squash court", "basketball court", "football pitch", "padel court"],
    "outdoor_kitchen": ["re:مطبخ خارجي", "re:مطابخ خارجيه", "outdoor kitchen"],
    "outdoor_diwaniya": ["re:ديوانيه خارجيه", "re:ديوانيات خارجيه", "outdoor diwaniya"],
    "waterfall": ["^شلال$", "^شلالات$", "waterfall"],
    # ── GROUP A — countryside / short stays / villa extras (owner handoff 2026-11-01, PR feat/af-words-all-groups).
    # Same contract as every fact above: true only when the ad SAYS it, the shared negation / nearby / prepared
    # guards apply unchanged, a phrase may feed two facts (precedent: self_checkin + smart_entry). Written on the
    # normalised text (ة→ه, ى→ي, أإآ→ا; ؤ and ئ stay). ──
    # «دفعة واحدة» is one payment, an explicit not-split; «دفع شهري» also feeds payment_monthly
    "split_payments": ["^دفعات$", "^دفعتين$", "^دفعتان$", "re:(?:علي|ع) دفعات", "re:(?:ال)?دفع (?:ال)?شهري",
                       "re:تقسيط (?:ال)?ايجار", "re:(?:ال)?ايجار (?:بال)?تقسيط", "re:\\d+ دفعات", "instalments", "installments",
                       ("re:دفعه واحده", False)],
    "heated_pool": ["re:مسبح (?:مدفا|مدفئ|دافئ|دافي|مسخن|ساخن|حار)", "re:تدفئه (?:ال)?مسبح", "re:مسبح (?:ب|مع )?تدفئه", "heated pool"],
    "kids_pool": ["re:مسبح (?:لل|ال)?اطفال", "re:مسبح صغير (?:لل|ال)?اطفال", "kids pool", "children s pool"],
    "water_slide": ["^زحليقه", "^زحليقات", "^زحاليق", "^زحلاقه", "^زحلاقات", "^زحلقه", "re:(?:ال)?العاب مائيه", "water slide"],
    # the view word is the nearby guard's own («يطل», «اطلاله»): the span must START with it
    "sea_view": ["re:(?:اطلاله|اطلالات|باطلاله) (?:علي |ع )?(?:ال)?بحر(?:يه)?", "re:(?:يطل|تطل|مطل|مطله) (?:علي |ع )?(?:ال)?بحر",
                 "re:(?:علي|ع) (?:ال)?بحر(?!\\w)", "re:(?:شاطئ|شاطي) خاص", "re:واجهه بحريه", "sea view", "beachfront", "private beach"],
    "football_pitch": ["re:ملعب (?:كره|كوره)(?: (?:ال)?قدم)?", "re:ملعب (?:ال)?(?:صابوني|عشب|عشبي|نجيل)", "football pitch", "soccer"],
    "playstation": ["^بلايستيشن", "^بليستيشن", "بلاي ستيشن", "^playstation", "^ps[45]$"],
    "inflatable_games": ["^نطيطه", "^نطيطات", "^نطاطه", "^نطاطات", "re:(?:ال)?العاب هوائيه", "^ترامبولين", "^ترامبلين", "trampoline",
                         "bouncy castle"],
    "sound_system": ["re:نظام (?:ال)?صوت(?:ي)?", "^سماعات", "^صوتيات", "^سبيكر", "re:جهاز (?:ال)?صوت", "sound system", "speakers"],
    # «موقد غاز» is the kitchen stove
    "fire_pit": ["^موقد", "^حطب$", "re:جلسه (?:ال)?نار", "re:مكان (?:لل|ال)?نار", "re:حفره (?:ال)?نار", "fire pit", "firepit"],
    "bait_shaar": ["re:بيت (?:ال)?شعر", "re:بيوت (?:ال)?شعر", "re:خيمه (?:ال)?شعر"],
    "mandi_pit": ["^مندي$", "re:حفره (?:ال)?مندي", "^تنور$", "^مدفن$"],
    "outdoor_seating": ["re:جلسه (?:ال)?(?:خارجيه|ارضيه|عربيه|حديقه)", "re:جلسات (?:ال)?(?:خارجيه|ارضيه|عربيه)",
                        "re:جلسه (?:في )?(?:ال)?حديقه", "outdoor seating"],
    "tent": ["^خيمه", "^خيم$", "^خيام"],
    "dunes_view": ["re:(?:اطلاله|باطلاله) (?:علي |ع )?(?:ال)?(?:رمال|طعوس|نفود|كثبان)", "^طعوس", "^طعس$", "^نفود", "^كثبان"],   # bare «الرمال» = حي الرمال (2026-11-03: 11 of 12 sampled)
    "women_section": ["re:قسم (?:لل|ال)?(?:نساء|حريم|نسائي)", "re:جناح (?:لل|ال)?(?:نساء|حريم|نسائي)", "women s section", "ladies section"],
    # «جناحين» only as two sections, never two master bedrooms (excluded below); «شقتين» left out — it is a count
    "two_sections": ["^قسمين$", "^قسمان$", "^جناحين$", "^جناحان$", "re:قسم (?:لل|ال)?رجال و ?قسم (?:لل|ال)?نساء", "two sections"],
    "events_hall": ["re:(?:صاله|قاعه|صالات|قاعات) (?:ال)?(?:مناسبات|افراح|احتفالات)", "events hall", "wedding hall"],
    "privacy_screen": ["^ساتر", "^سواتر", "re:خصوصيه (?:تامه|كامله)", "^مستور$", "^مستوره$", "privacy screen"],
    "trees": ["^اشجار", "^مشجره", "^مشجر$", "^مزروعه", "^مزروع$"],
    "for_families": ["^للعوائل", "^للعائلات", "re:عوائل فقط", "re:(?:سكن|استراحه|شاليه|منتجع|مخيم|مزرعه) (?:ال)?عائلي(?:ه)?(?!\\w)", "for families",   # «صالة عائلية» is a room (2026-11-03 audit round 2)
                     (rf"re:{_NOT_ALLOWED} {_TO}(?:عوائل|عائلات)", False), (rf"re:{_ALLOWED} {_TO}(?:عوائل|عائلات)", True)],
    "for_youth": ["^للشباب$", "^شباب$", "^للعزاب", "for youth",
                  (rf"re:{_NOT_ALLOWED} {_TO}(?:شباب|عزاب)(?:ي|يه)?", False), (rf"re:{_ALLOWED} {_TO}(?:شباب|عزاب)(?:ي|يه)?", True)],
    "for_events": ["^مناسبات", "^للمناسبات", "^حفلات", "^للحفلات", "^تخرج$", "re:عيد ميلاد", "re:اعياد ميلاد", "for events",
                   (rf"re:{_NOT_ALLOWED} {_TO}(?:مناسبات|حفلات)", False), (rf"re:{_ALLOWED} {_TO}(?:مناسبات|حفلات)", True)],
    "for_newlyweds": ["^عرسان", "^للعرسان", "^للعرايس", "re:شهر (?:ال)?عسل", "honeymoon", "newlyweds"],
    # a bare «بقي» also means «remaining» («بقي شقة واحدة») — only next to دباب / بانشي
    "quad_bikes": ["^دباب", "^دبابات", "^بانشي", "re:(?:دباب|دبابات|بانشي) (?:و)?بقي", "re:بقي (?:و)?(?:دباب|دبابات|بانشي)", "quad bike", "atv"],
    "horses_stable": ["^خيل$", "^خيول$", "^اسطبل", "^اصطبل", "re:ركوب (?:ال)?خيل", "horse riding", "horse stable", "stables"],   # bare «stable» is «stable returns» (P2 13085, 2026-11-08)
    # «جمال» alone is beauty — only «ركوب الجمال»
    "camels": ["re:(?:(?<= )|^)(?:و|ال|وال|بال)?ابل(?!\\w)", "^هجن$", "re:ركوب (?:ال)?(?:جمال|ابل|هجن)", "camels"],
    "toilets_on_site": ["re:دورات (?:ال)?مياه", "re:دوره (?:ال)?مياه", "re:دورت(?:ين|ي|ا) (?:ال)?مياه", "^حمامات", "^حمام$", "toilets"],
    "lighting": ["^اناره", "^اضاءه", "^انارات", "lighting"],
    "artesian_well": ["re:(?:بئر|بير) ارتوازي", "^ارتوازي", "re:ابار ارتوازيه", "artesian"],
    "solar_power": ["re:طاقه شمسيه", "re:الواح شمسيه", "re:خلايا شمسيه", "solar"],
    "palms": ["re:(?<!ال)نخيل(?!\\w)", "^نخل$", "^نخله$", "^نخلات$", "re:\\d+ نخله", "palm trees", "palms"],
    "fruit_trees": ["re:اشجار مثمره", "^ليمون$", "^زيتون$", "^برتقال$", "^عنب$", "^رمان$", "^مانجو$", "^حمضيات$",
                    "fruit trees"],
    "fodder_crops": ["^برسيم", "^اعلاف$", "^قمح$", "^شعير$", "^محاصيل$", "fodder", "crops"],
    "greenhouses": ["re:بيوت محميه", "re:بيت محمي", "^صوبه", "re:صوب زراعيه", "greenhouse"],
    # a bare «تعمل» / «إنتاج» is any machine or any company — only the farm's own producing words
    "producing_farm": ["re:مزرعه (?:منتجه|شغاله|تعمل)", "re:انتاج (?:ال)?(?:تمور|نخيل|اعلاف|خضار|محاصيل|زيتون)",
                       "producing farm"],
    "animal_pens": ["^حظيره", "^حظائر", "re:حوش (?:ال)?(?:غنم|اغنام|ماشيه|مواشي)", "^شبوك", "^زريبه", "^زرايب"],
    "poultry": ["^دواجن", "^دجاج$", "re:مزرعه دواجن", "poultry"],
    # the ad says there IS a house / villa on the property; a bare «سكن» is anyone's housing («سكن عمال», «سكن عوائل»)
    "farm_house": ["re:(?:فيها|بها|فيه|به|يوجد|توجد|مع|تحتوي علي|تشمل|وبها|وفيها) (?:ال)?(?:فيلا|فله|بيت|منزل|استراحه)",
                   "re:(?:فيلا|فله|بيت|منزل) داخل (?:ال)?مزرعه", "re:مزرعه (?:ب|مع )(?:فيلا|فله|بيت|منزل)"],
    "farm_rest_house": ["re:استراحه داخل", "re:(?:فيها|بها|يوجد|توجد|مع|وبها|وفيها) (?:ال)?استراحه", "^استراحه$"],
    "workers_housing": ["re:سكن (?:لل|ال)?عمال", "re:غرف(?:ه)? (?:لل|ال)?(?:عمال|عامل)", "workers housing", "labour housing"],
    "fence": ["^مسوره", "^مسور$", "^سور$", "^شبوك", "re:مسور(?:ه)? بالكامل", "fenced"],
    "main_road": ["re:(?:علي|ع) (?:ال)?(?:طريق|خط|دائري)(?!\\w)", "re:(?:تطل|يطل|مطل|مطله|واجهه|واجهتها) (?:علي|ع) (?:ال)?طريق", "re:(?:علي|ع) شارع (?:رئيسي|تجاري|عام)",
                  "re:شارعين تجاريين", "main road", "main street"],
    "good_soil": ["re:صالحه للزراعه", "re:تربه (?:خصبه|صالحه)", "re:ارض خصبه", "fertile"],
    # ── GROUP B — residential land (owner handoff 2026-11-01) ──
    "three_streets": ["re:(?:ثلاث|ثلاثه|3) شوارع", "three streets"],
    # a bare «جاهزة» is any unit («جاهزة للسكن», «جاهزة للإفراغ») — only the land's own readiness
    "ready_to_build": ["re:جاهزه للبناء", "^مستويه$", "re:منسوب جاهز", "re:(?:ارض|الارض|قطعه|القطعه) جاهزه", "ready to build"],
    "raised_plot": ["re:(?:ارض|الارض|قطعه|القطعه) مرتفعه", "re:منسوب(?:ها)? مرتفع", "elevated plot"],
    "residential_commercial": ["re:سكني(?:ه)? و?تجاري(?:ه)?", "re:تجاري(?:ه)? و?سكني(?:ه)?", "residential commercial"],
    "all_services": ["re:(?:جميع|كامل|كافه|كل) (?:ال)?خدمات", "re:(?:منطقه|حي|ارض|الارض|موقع|الموقع|مخطط|القطعه) (?:ال)?(?:مخدوم|مخدومه)", "re:(?:ال)?خدمات (?:متوفره|متوفر|واصله|مكتمله)",
                     "re:(?:متوفر|متوفره|مكتمل|مكتمله) (?:بها |فيها )?(?:جميع |كل |كافه )?(?:ال)?خدمات", "all services"],
    "asphalt": ["^مسفلت", "^مسفلته", "^سفلته", "^اسفلت", "asphalt", "paved"],
    "street_lights": ["re:اناره (?:ال)?شوارع", "re:اناره (?:ال)?شارع", "^ارصفه", "^رصيف$", "re:اناره و ?ارصفه", "street lights", "pavements"],
    # a bare «معتمد» is also an office / agent («مكتب معتمد») — excluded below
    "approved_plan": ["re:مخطط (?:(?:سكني|تجاري|زراعي|صناعي) )?(?:معتمد|معتمده|رسمي)", "re:معتمد(?:ه)? من (?:ال)?(?:امانه|بلديه)",
                      "approved plan"],   # a bare «معتمد» is a soil report, a broker, a street (2026-11-03: 4 of 5)
    # «تفويض من المالك» is an agent's authorisation — excluded below
    "direct_owner": ["re:من (?:ال)?مالك(?: مباشره)?", "re:(?:ال)?مالك مباشره", "re:بدون (?:عموله|وسيط|وسطاء|سعي)", "direct from owner",
                     "no commission"],
    "inside_project": ["re:(?:داخل|ضمن) (?:ال)?(?:مخطط|مشروع)", "inside project"],
    # what MAY be built (the permit guard's own words): the span carries them, so the guard reads nothing before it
    "floors_allowed": ["re:عدد (?:ال)?ادوار (?:ال)?مسموح", "re:نظام (?:ال)?بناء", "re:نسبه (?:ال)?بناء",   # a setback is not a floors rule (2026-11-03 audit round 2)
                      
                       "re:(?:مسموح|يسمح) (?:ب|بال)?(?:بناء )?(?:\d+ )?(?:ادوار|دورين|دور|طوابق)", "floors allowed"],
    "grant_land": ["^منحه$", "re:ارض منحه", "re:منحه ملكيه", "grant land"],
    # the VALUE of a services field, never across the next label: aqar's «لا يوجد خدمات العقار: كهرباء, مياه» HAS services
    "no_services": ["re:(?:ارض|الارض|قطعه) خام", "^خام$", "re:(?:بدون|لا يوجد|لا توجد|لايوجد|لاتوجد|من غير) خدمات(?! (?:ال)?(?:عقار|ارض|قطعه))",
                    "re:(?:ال)?خدمات(?: (?:ال)?(?:عقار|ارض|قطعه))? (?:لا يوجد|لا توجد|لايوجد|لاتوجد|غير متوفره|غير متوفر|غير موجوده)",
                    "re:(?:بدون|لا يوجد|لا توجد|لايوجد|لاتوجد|من غير) (?:كهرباء|كهربا|كهربه|ماء|مياه|مويه)", "re:غير مخدومه", "no services",
                    "raw land"],
    # ── GROUP C — commercial (owner handoff 2026-11-01). own_toilet is NOT registered: own_bathroom above already
    # reads «حمام خاص» / «دورة مياه خاصة». food_allowed (may it be a restaurant) and restaurant_cafe (it holds one)
    # share the bare words on purpose; offices_inside and private_office overlap on «مكاتب إدارية». ──
    "mezzanine": ["^ميزانين", "^ميزنين", "^ميزان$", "mezzanine"],
    "pantry": ["^بوفيه", "re:مطبخ تحضيري", "^بانتري", "^بنتري", "pantry"],
    "glass_front": ["re:واجه(?:ه|ات) (?:ال)?(?:زجاج|زجاجيه)", "glass front", "glass facade"],
    # «الواجهة: شمالية» is the plot's facing — excluded below
    "frontage": ["re:واجه(?:ه|ات) (?:تجاري|تجاريه|علي|ع|بطول|بعرض|طولها|عرضها|\\d)", "re:واجه(?:ه|ات) (?:ال)?(?:زجاج|زجاجيه)", "^واجهتين$", "^واجهتان$", "frontage"],
    "in_mall": ["re:(?:داخل|في|ضمن) (?:ال)?(?:مول|مجمع تجاري|مركز تجاري|سنتر|بلازا)", "in mall", "shopping centre",   # a bare «X مول» is a landmark (2026-11-03 audit round 2)
                "shopping center"],
    "in_tower": ["^برج$", "re:داخل (?:ال)?برج", "in tower"],
    # «رقم رخصة فال» / «رقم الترخيص» is the REGA ad licence on every ad; «رخصة بناء» is a permit — excluded below
    "license": ["re:سجل تجاري", "^رخصه$", "re:رخصه بلدي", "^ترخيص$", "commercial register", "licensed"],
    "food_allowed": ["re:(?<!لا )(?<!ما )(?:يصلح|تصلح|يناسب|تناسب|مناسب|مناسبه) (?:ل|ك|لل)?(?:مطعم|كافيه|مقهي|كوفي|مطاعم|كافيهات)",
                     (rf"re:{_NOT_ALLOWED} {_TO}(?:مطعم|كافيه|مقهي|مطاعم|كافيهات)", False),
                     (rf"re:{_ALLOWED} {_TO}(?:مطعم|كافيه|مقهي|مطاعم|كافيهات)", True)],
    "takeover": ["^تقبيل", "^للتقبيل", "^خلو$", "takeover"],
    "first_tenant": ["re:اول (?:ساكن|مستاجر)", "re:(?:جديد|جديده)? ?لم (?:يسكن|تسكن)", "re:لم (?:يسكن|تسكن)", "first tenant",
                     "never occupied"],
    "internet": ["^انترنت", "^الياف$", "^فايبر", r"re:(?:(?<=ال)|(?<= )|^|(?<=\d))نت", "internet", "fibre", "fiber"],
    "civil_defense": ["re:(?:ال)?دفاع (?:ال)?مدني", "re:(?:ال)?انذار (?:ال)?حريق", "^طفايات", "re:طفاي(?:ه|ات) (?:ال)?حريق", "civil defense",
                      "civil defence"],
    "high_ceiling": ["re:(?:سقف|اسقف) (?:عالي|عاليه|مرتفع|مرتفعه)", "re:ارتفاع (?:ال)?(?:سقف|اسقف)", "re:ارتفاع عالي", "high ceiling"],
    "hangar": ["^هنجر", "^هناجر", "^هنقر", "^هنقار", "hangar"],
    # «عازل للصوت» is soundproof — excluded below
    "insulated_panel": ["re:(?:ساندوتش|ساندويتش|ساندوش|سندوتش|سندويتش) (?:بانل|بنل)", "^بانل$", "re:الواح معزوله", "sandwich panel",
                        "insulated panel"],
    # «تكييف وتبريد» is the AC — excluded below
    "cold_storage": ["re:مستودع(?:ات)? (?:مبرد|مبرده|تبريد|مجمد)", "re:غرف(?:ه)? (?:ال)?(?:تبريد|تجميد)", "cold storage", "cold room"],
    "concrete_floor": ["re:ارضي(?:ه|ات) (?:ال)?(?:خرسانه|خرسانيه|ايبوكسي|ابوكسي|اسمنتيه|اسمنت|سمنت)", "^ايبوكسي", "^ابوكسي", "epoxy",
                       "concrete floor"],
    "loading_dock": ["re:رصيف (?:لل|ال)?تحميل", "re:منص(?:ه|ات) (?:ال)?تحميل", "loading dock", "loading bay"],
    "big_gate": ["re:بواب(?:ه|ات) (?:كبير|كبيره|ضخم|ضخمه|عريض|عريضه|للشاحنات|شاحنات)", "big gate", "large gate"],
    "truck_access": ["re:دخول (?:ال)?(?:شاحنات|تريلات|سطحات)", "^تريلات", "^تريلا$", "^سطحات", "^شاحنات", "truck access", "trucks"],
    "crane": ["^رافعه", "^رافعات", "^ونش$", "^ونشات$", "^اوناش$", "^كرين", "crane"],   # «ونشتري» = «و»+«نشتري»
    "racks": ["^ارفف", "^رفوف", "re:رفوف (?:ال)?تخزين", "racks", "shelving"],
    "office_inside": ["re:مكتب (?:اداري )?داخل", "re:(?:فيه|فيها|به|بها|يوجد|توجد|مع|وبه|وبها) مكتب", "re:مكاتب داخليه", "office inside"],
    "heavy_power": ["re:(?:3|ثلاث|ثلاثه) فاز", "re:ثري فيز", "re:محول (?:ال)?(?:كهرباء|كهربائي|كهربا)", "re:قوه كهربائيه",
                    "3 phase", "three phase"],
    "industrial_area": ["re:الصناعيه", "re:(?:ال)?مدينه (?:ال)?صناعيه", "re:منطقه صناعيه", "industrial area", "industrial city"],
    "car_service": ["re:مغسله (?:ال)?سيارات", "^بنشر", "re:صيانه (?:ال)?سيارات", "^تشحيم", "^سمكره", "re:ورشه (?:ال)?سيارات",
                    "car service"],
    "meeting_room": ["re:(?:قاعه|غرفه|قاعات|غرف) (?:ال)?اجتماعات", "meeting room"],
    "reception": ["^استقبال", "^ريسبشن", "^رسبشن", "reception"],
    "coworking": ["re:مساحات (?:ال)?عمل(?: مشتركه)?", "re:مساحه عمل(?: مشتركه)?", "re:مساحه العمل (?:ال)?مشتركه", "re:مكاتب مشتركه", "^كوركنج", "^كوركينج", "coworking", "co working"],
    "private_office": ["re:مكتب (?:خاص|اداري)", "re:مكاتب (?:خاصه|اداريه)", "private office"],
    "central_ac": ["re:(?:تكييف|تكيف|مكيف|مكيفات) (?:مركزي|مركزيه)", "central ac", "central air"],
    # contents of a building: a holding word or a count before the plural
    "shops_inside": ["re:(?:فيه|فيها|به|بها|يوجد|توجد|يحتوي|تحتوي|تضم|يضم|مكون من|مكونه من|يتكون من|تتكون من|وبها|وفيها|عدد) (?:علي )?(?:\d+ )?(?:ال)?(?:محلات|معارض|محلين|محلان|معرضين)",
                     "re:\d+ (?:محلات|معارض|محل|معرض)", "re:محلات تجاريه", "shops inside"],
    "offices_inside": ["re:(?:فيه|فيها|به|بها|يوجد|توجد|يحتوي|تحتوي|تضم|يضم|مكون من|مكونه من|يتكون من|تتكون من|وبها|وفيها|عدد) (?:علي )?(?:\d+ )?(?:ال)?(?:مكاتب|مكتبين)",
                      "re:(?<!\\d)\\d{1,2} (?:مكاتب|مكتب)(?!\\w)", "re:مكاتب اداريه", "offices inside"],
    "apartments_inside": ["re:(?:فيه|فيها|به|بها|يوجد|توجد|يحتوي|تحتوي|تضم|يضم|مكون من|مكونه من|يتكون من|تتكون من|وبها|وفيها|عدد) (?:علي )?(?:\d+ )?(?:ال)?(?:شقق|شقتين|شقتان)",
                          "re:\d+ (?:شقق|شقه)", "apartments inside"],
    "staff_housing_inside": ["re:سكن (?:لل|ال)?(?:عمال|موظفين)", "staff housing"],
    "restaurant_cafe": ["^مطعم$", "^مقهي$", "re:كوفي شوب", "restaurant", "cafe"],   # «كافية» = enough, «مطاعم» = nearby (2026-11-03 audit round 2)
    # «حمام ومغسلة» is the basin, «مغسلة ملابس» the laundry — excluded below
    "car_wash": ["re:مغسله (?:ال)?سيارات", "re:غسيل (?:ال)?سيارات", "car wash"],   # bare «مغسلة» = washbasin (2026-11-03 audit round 2)
    "market": ["^بقاله", "^ماركت", "^تموينات", "re:سوبر ماركت", "^سوبرماركت", "re:ميني ماركت", "supermarket", "grocery"],
    # «المؤجر والمستأجر» are the contract's parties, not an income — excluded below; «مستثمر» left out (an invitation)
    "earning_income": ["^مؤجر$", "^مؤجره$", "^موجر$", "^موجره$", "^ماجر$", "^ماجره$", "re:(?:ال)?عائد (?:\\d|سنوي|شهري)", "re:(?:ال)?دخل (?:ال)?(?:سنوي|شهري) ?\\d?", "re:دخل (?:سنوي|شهري)",
                       "rental income", "rented out"],
    "stars_mentioned": ["re:(?:خمس|اربع|ثلاث|سبع|\d) ?نجوم", "re:تصنيف (?:ال)?(?:فندق )?\\S* ?نجوم", "re:\d stars?", "star hotel"],
    # «جناح خادمة» / «جناح نساء» / «جناحين نوم» are the villa's — excluded below; «عدد الغرف» left out (every aqar form)
    "rooms_suites": ["re:غرف و ?اجنحه", "^اجنحه", "^جناح$", "rooms and suites", "suites"],
    "oil_change": ["re:تغيير (?:ال)?(?:زيت|زيوت)", "^تشحيم", "^بنشر", "oil change"],
    "pumps": ["^مضخات", "^مضخه", "^طرمبات", "^طرمبه", "pumps"],
    "mosque": ["^مسجد", "^مصلي$", "^جامع$", "mosque", "prayer room"],
    # a bare «أدوار» is the floors COUNT — only what may be built
    "building_rules": ["re:نسبه (?:ال)?بناء", "^ارتداد", "^ارتدادات", "re:نظام (?:ال)?بناء", "re:عدد (?:ال)?ادوار (?:ال)?مسموح",
                       "re:(?:مسموح|يسمح) (?:ب|بال)?(?:بناء )?(?:\d+ )?(?:ادوار|دورين|دور|طوابق)", "building rules"],
}
for _k, _src in _INHERITED.items():
    FACT_TOKENS[_k] = list(N._AMENITY_TOKENS[_src]) + FACT_TOKENS[_k]
# washing machine rides the existing laundry_room fact (owner 2026-10-31); «غسالة صحون» is excluded below
FACT_TOKENS["laundry_room"] += ["^غساله$", "^غسالات$", "washing machine"]

# Not read from prose (the LLM run found 0 rows: a platform feature, not something ads say).
NOT_IN_PROSE = frozenset({"installment_available", "rent_now_pay_later"})
assert set(FACT_TOKENS) | NOT_IN_PROSE == BOOL_FACTS, set(FACT_TOKENS) ^ BOOL_FACTS

# Words that are themselves a catalogue thing — a negator may reach across a LIST of them:
# «بدون مكيفات ومطبخ» negates both, «بدون عمولة ومطبخ» negates nothing.
_LIST_WORDS = frozenset(_n(w) for w in (
    "مكيفات", "مكيف", "مطبخ", "مصعد", "مسبح", "اثاث", "مواقف", "موقف", "حوش", "سطح", "ملحق", "مجلس", "خزان",
    "خزانات", "عداد", "كهرباء", "مياه", "ماء", "صرف", "تكييف", "حديقه", "كراج", "مستودع", "بلكونه", "بئر",
    # the apartment chips a negator may reach across (owner 2026-10-31): «بدون واي فاي وكاميرات وثلاجه»
    "واي", "فاي", "وايفاي", "نت", "انترنت", "كاميرات", "ثلاجه", "جاكوزي", "ساونا", "حارس", "حراسه", "انتركوم", "غساله",
    # the villa facts (owner 2026-11-01): «بدون مسبح وشلال وملعب»
    "شلال", "شلالات", "ملعب", "ديوانيه",
    # group A (owner handoff 2026-11-01): «بدون مسبح وخيمة ونطيطة»
    "خيمه", "نطيطه", "زحليقه", "سماعات", "بلايستيشن", "دباب", "اناره", "سور", "نخيل", "مشب", "اشجار"))

# ── guards ────────────────────────────────────────────────────────────────────────────────────────────────
# PREPARED / POSSIBLE: the thing is not there yet — no row (the scrapers' _PREPARED_ONLY + «possible» words).
# «موسس / موسسة» is «مؤسس» typed without the hamza (🔬 2026-11-04 elevator precision sample: aqar 17753855
# «موسسة مصعد», 14874158 «موسس مصعد» served lift = yes; 2 of 25 sampled yeses).
# «تسليك» is the conduit laid FOR a fixture, not the fixture: «الشقه يوجد بها تسليك مكيف اسبلت للصاله» (aqar 15702793),
# «تسليك التكييف جاهز» (manafe project 297's spec list). 🔬 2026-11-09: 6 of 12 served aqar AC yeses whose text says
# «تسليك … مكيف/تكييف» had no other AC statement; the af-score asked AC of manafe 13707996 / 13708034 for the same words.
_PREPARED = tuple(_n(w) for w in N._PREPARED_ONLY + ("تمديد", "تمديدات", "امكانيه", "بالامكان", "قابل",
                                                        "قابليه", "يمكن", "ممكن", "يصلح", "موسس", "موسسه",
                                                        "تسليك", "وتسليك", "تسليكات"))
_PREPARED_PLACE = tuple(_n(w) for w in ("مكان", "مساحه", "موقع"))   # «مكان مسبح», «مكان للمصعد»
_PLACE_FACTS = frozenset({"pool", "elevator"})
# a washing machine's SPOT, never the machine (🔬 2026-11-10) — only for the washer word «غسالة»: «ركن غسيل», «مكان غسيل
# ملابس» are a laundry space and stay yeses (haraj 18743786, dealapp 21427433 in the real-ad lock)
_WASHER_SPOT = frozenset(_n(w) for w in ("ركن", "مخرج", "مخارج", "موقع", "لموقع", "مكان", "لمكان", "توصيله", "توصيلة",
                                          "وصله", "وصلة", "تمديد", "تمديدات"))
# a forecast of income, never income the property earns (🔬 2026-11-10)
_FORECAST = frozenset(_n(w) for w in ("متوقع", "المتوقع", "متوقعه", "المتوقعه", "تحقيق",
                                       "لتحقيق", "يحقق", "تحقق", "تقديري", "تقديريه", "تقديرية", "المحتمل", "محتمل"))
# NEARBY: about the street, not the unit — no row. The scrapers' _PROXIMITY plus the words a view/distance uses.
_NEAR = tuple(_n(w) for w in N._PROXIMITY + ("قريب", "قريبه", "قرب", "بالقرب", "بجوار", "جوار", "مجاور", "مجاوره",
                                               "بقرب", "قربها", "قربه", "مقابله", "جنب", "بجنب", "دقيقتين", "دقيقتان",
                                               "يبعد", "تبعد", "يطل", "تطل", "مطل", "مطله", "اطلاله", "باطلاله",
                                               "دقائق", "دقايق", "دقيقه", "near", "nearby", "close", "minutes",
                                               "walking", "overlooking", "views",
                                               # «بجواره مقهى دانكن» — «next to it» (🔬 2026-11-04 café audit)
                                               "بجواره", "بجوارها", "بجانبه", "بجانبها", "جواره", "جوارها"))
# A DISTANCE points at its place with «من / عن» (🔬 2026-11-04 live walk): «على مقربة جدًا من حديقة», «على بُعد خطوات من
# المسجد», «على مسافة 3 كم من جامعة», «على بعد 20 د عن المسجد». Only a fact AFTER that «من / عن» is the nearby place —
# «🔸المسجد على بعد خطوات 🔸موقف خاص 🔸غرفة سائق» keeps its own parking and driver's room. (A bare «بعد» is «after».)
# «يتكون من / مكون من» is «consists of», never a distance: aqar 15131878 «… 3020م 💥يتكون من حوش سيارات مصعد» read the
# plot's «م» (metres) + «من» as «N metres from …» and silenced the lift (elevator recall sample 2026-11-04).
_DISTANCE_TO = re.compile(r"(?:علي (?:بعد|مقربه|مسافه)|بمقربه|خطوات|بضع خطوات|(?<!\S)(?:د|كم|كيلو|م|متر))(?: \S+){0,4} "
                          r"(?<!يتكون )(?<!تتكون )(?<!مكون )(?<!مكونه )(?<!يتالف )(?<!تتالف )(?:من|عن)(?: \S+){0,3}$")
_NEAR_WORDS = frozenset(w for w in _NEAR if " " not in w)
# «Shared Walking Path • مسبح • Swimming Pool»: a walking PATH is a facility in the list, not «walking distance» (🔬 2026-11-13
# pool recall sample, aqar 20965749); «مكانس كهربائيه مسبح» — vacuum cleaners, not «مكان مسبح» (aqar 14998996).
_WALK_FACILITY = frozenset({"path", "paths", "track", "tracks", "trail", "trails"})


def _drop_walk_facility(words: list[str]) -> list[str]:
    """«walking path / track» is a facility; drop that «walking» before the nearby checks read it."""
    return [w for k, w in enumerate(words) if not (w == "walking" and k + 1 < len(words) and words[k + 1] in _WALK_FACILITY)]
_NEAR_PHRASES = tuple(w for w in _NEAR if " " in w)
_PARTIAL = tuple(_n(w) for w in N._PARTIAL_ONLY + N._FLOOR_COVERING)
_PARTIAL_BEFORE = tuple(_n(w) for w in N._PARTIAL_BEFORE)

# Negators that TOUCH the token. One word («غير», «بدون») or two («لا يوجد», «لا نقبل»).
_NEG1 = frozenset(_n(w) for w in ("غير", "كغير", "بدون", "بلا", "لايوجد", "لاتوجد", "مافيه", "مافي", "مافيها", "no", "without", "not",
                                   "non", "ليس", "ليست", "عدا", "ماعدا", "باستثناء"))      # «ليست منحة» (owner handoff 2026-11-01)
_NEG2 = frozenset(_n(w) for w in ("لا يوجد", "لا توجد", "لا يتوفر", "لا تتوفر", "ما فيه", "ما في", "ما فيها", "لا يحتوي", "لا تحتوي", "لا يشمل",
                                   "لا تشمل", "عدم وجود", "لا نقبل", "لا يقبل", "من غير", "ما يوجد", "is not"))
# …and AFTER it: «مطبخ غير راكب», «مفروشة: لا», «الضمانات ومدتها: لا يوجد», «المطابخ: 0».
_POST_NOT = tuple(_n(w) for w in ("متوفر", "موجود", "متاح", "مشمول", "شامل"))
_POST_NOT_FACT = {"kitchen": ("راكب", "مركب"), "air_conditioner": ("راكب", "مركب"), "furnished": ("مفروش", "مؤثث")}

_BEARINGS = ("شمال", "جنوب", "شرق", "غرب", "الشمال", "الجنوب", "الشرق", "الغرب", "وجه", "الوجه", "واجه", "الواجه", "يحد",
             "حدود")
# Per-fact context words: (excluded if one of the 2 words BEFORE starts with…, excluded if one of the 2 AFTER…)
# 🔬 2026-11-13 (P1 14340 «كل خدمات» / «ومناسبات» still served after #11820): words that make «كل خدمات» someone
# else's or a set-up, an exception before an event word, and a «nearby» read a little past the 2-word window.
_SERVICES_NOT_OWN = frozenset({"مؤسس", "مؤسسه", "تاسيس"})   # «شامل جميع الخدمات ⚡ الكهرباء» stays a yes
_SERVICES_COVER = frozenset({"يشمل", "تشمل", "يشملها"})       # «ويشمل كل خدمات العمارة»: only with the building's noun after
_BUILDING_NOUNS = frozenset({"عماره", "مبني", "برج", "مجمع", "كمباوند"})   # compared after _strip_wa (drops «ال»)
_EXCEPT_WORDS = frozenset({"عدا", "ماعدا", "باستثناء", "خلا"})
_NEAR_LATER_BREAK = ("⭐", "✅", "✔", "•", "🔸", "🔹", "-", ".", "،", ",", "؛", ":")


def _near_later(words: list[str]) -> bool:
    """«كل خدمات شمال الرياض قريبة»: a «قريب / بالقرب» within the next 4 words, before a clause break."""
    for w in words:
        if any(b in w for b in _NEAR_LATER_BREAK):
            return False
        if w.startswith("و") or _strip_wa(w) in ("بموقع", "موقع", "موقعها", "موقعه"):
            return False                             # «… بجميع الخدمات وقريبة من الطريق»: «و» opens the NEXT item;
                                                     # «متوفرة في موقع قريب من الطريق»: the LOCATION is near; a bare «في» is not a new
                                                     # subject — «جميع الخدمات في مكان قريب» stays silent (CodeRabbit #12178)
        if _starts(w, ("قريب", "بالقرب")):
            return True
    return False


_EXCLUDE: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "electricity": (("غرف", "ضمان", "تمديد", "لوح", "نظام", "انظمه", "فاتور", "فواتير", "مولد", "سباك", "اعمال", "كيبل",
                     "كابل", "مفاتيح", "افياش", "شرك", "محط", "برج", "ابراج", "خط", "خطوط", "تاسيس", "مصعد",
                     "اسلاك", "توصيل", "رسوم"),
                    ("مستقل", "منفصل", "مشترك", "علي حساب", "غير مشمول", "سنه", "سنوات", "سنين")),
    "water_supply": (("دور", "حمام", "خزان", "سخان", "تصريف", "مضخ", "بئر", "بير", "ابار", "تسريب", "ضمان",
                      "سباك", "تحلي", "فلتر", "شرب", "نافور", "شلال", "تمديد", "فاتور", "فواتير", "دورات",
                      "مسبح", "احواض", "توصيل", "رسوم", "صرف", "عين"),
                     ("مستقل", "منفصل", "مشترك", "حلوه", "البحر", "الامطار", "امطار", "جوفي", "الشرب")),
    "sanitation": (("تمديد", "ضمان", "سباك", "محط", "تاسيس"), ()),
    "majlis": (("طريق", "شارع", "حي", "مخرج"), ("التعاون", "الوزراء", "الشوري", "اداره", "الاداره", "البلدي",
                                                 "الامن", "الشيوخ", "النواب", "الامناء")),
    "warranty": (("يقبل", "نقبل", "قبول", "مقبول", "مستفيد", "مستفيدي"),
                 ("الاجتماعي", "اجتماعي", "بنكي", "البنكي", "مالي", "الجديه", "جديه", "حقوق", "الحقوق", "السكني",
                  "الدفع", "دفع", "المستاجر", "التامين",
                  # bench-v1: a rental / income / comfort promise is not a building warranty
                  "توفير", "تاجير", "التاجير", "مستاجر", "دخل", "الدخل", "عائد", "العائد", "ايجار", "الايجار",
                  "الخصوصيه", "خصوصيه", "سير", "راحه", "الراحه")),
    "roof": (("مستوي", "مستوى"), ("المطبخ", "مطبخ", "رخام", "جرانيت", "عمل", "الارض", "البحر", "الطاوله")),
    "water_tank": ((), ("ملابس", "مطبخ", "المطبخ", "حائط", "جداري", "دولاب", "خشب", "حائطيه", "ملابس",
                        "غاز", "الغاز", "وقود", "ديزل")),            # «خزان غاز» is the gas fact, not a water tank
    "well": ((), ("السلم", "سلم", "الدرج", "درج", "المصعد", "مصعد", "عثمان", "سلوي")),
    # «ملعب أطفال» is the kids_play_area fact; «ملعب الحي» / «ملعب عام» the neighbourhood's (owner 2026-11-01)
    "sports_court": ((), ("اطفال", "الاطفال", "للاطفال", "الحي", "عام", "عامه", "بلدي", "البلديه", "الجوهره", "الملك", "الامير", "مدينه", "الجراد", "الراكه", "الانماء", "الشرائع", "جامعه")),
    "annex": (("حمام", "دوره", "دورات", "مطبخ", "غرف", "غرفه"),
              ("به", "بها", "بالغرفه", "بالصاله", "بالمطبخ", "بالمجلس", "بغرفه", "بالمبني", "بالفيلا")),
    "storage": (("خلف", "بجوار", "مقابل", "صناعي", "صناعيه", "يصلح", "تصلح", "مناسب", "مناسبه", "مثالي", "مثاليه", "ينفع", "تنفع", "لبناء", "لانشاء", "او"),     # «خلف مخازن …» is an address, «أرض صناعية ومستودعات» the type
                ("للايجار", "للبيع", "تجاري", "صناعي", "تجاريه", "صناعيه", "مبرد", "مبرده", "للتاجير")),
    # «أرض سكنية شارع وحديقة»: the plot's neighbours, not its garden (🔬 2026-11-11 garden sample, aqar 3543112)
    "garden": (_BEARINGS + ("مناسب", "مثالي", "خلف", "مقابل"),   # «الوجهة: غرب حديقة» is a boundary
               # «حديقة الإمام وبجانبها ملعب», «حديقة الملك عبدالله»: a named public park (aqar 10513608, 2026-11-11)
               ("عامه", "عام", "الحي", "العامه", "الملك", "الامير", "الامام", "الشيخ", "الملكه", "الاميره")),
    "parking": (_BEARINGS, ()),
    # A POSSIBLE use or the STREET's shops are not shops inside the property (🔬 2026-11-07 two-way sample, 4 of 25
    # served yeses wrong): «مناسبة لمحلات تجارية» (aqar 20809503), «منها: كافيه أو مطعم 🏪 4 محلات حسب الرخصة» (9566204),
    # «شارعها تجاري مقام فيه محلات بالعماير الي امامها» (39729)
    "shops_inside": (("مناسب", "مناسبه", "يصلح", "تصلح", "مثالي", "مثاليه", "ينفع", "تنفع", "لبناء", "لانشاء", "مقام",
                      "يمكن", "ممكن", "امكانيه", "بامكانيه", "قابل", "قابله"),
                     ("حسب", "بالعماير", "بالعمائر", "بالعماره المقابله", "المقابله", "المجاوره",
                      # «كما يوجد ٦ محلات تجارية بالقرب من …» (aqar 20476375): the shops are nearby
                      "بالقرب", "قريب", "قريبه", "بجوار", "مجاوره")),                                  # «جنوب: مواقف ثم شارع» is a boundary
    # «خزان المياه مستقل» is a tank, «دورة مياه مستقلة» a bathroom — not a meter (checked only on the
    # «مياه مستقل» / «كهرباء مستقلة» shapes; «خزانات وعدادات مستقلة» names the meter itself)
    "separate_water_meter": (("خزان", "دور", "حمام", "مغسل", "سخان", "تحلي", "فلتر", "مضخ", "بئر", "بير"), ()),
    "separate_electricity_meter": (("غرف", "لوح", "مولد", "تمديد", "خزان"), ()),
    "laundry_room": ((), ("سيار", "السيار", "صحون", "الصحون", "اطباق", "الاطباق", "مواعين")),   # «غسالة صحون» is a dishwasher
    "kitchen": (("ادوات",), ()),          # «سطح مطبخ» (a countertop) is checked adjacent only — «سطح واسع مطبخ راكب» has both
    "pool": (("ادوات", "مستلزمات"), ("table",                    # «pool table» is billiards
                                    # «المسبح غير مجهز» (aqarmonthly 14439308, ialqarawi 12594693, 🔬 2026-11-14): not fitted,
                                    # nothing to swim in — silent. «مسبح غير مستخدم» (unused) still exists and stays a yes.
                                    "غير مجهز", "غير مجهزه", "غير جاهز", "غير جاهزه")),
    # bench-v2: «مدخل مكيّف», «مداخل مكيفة», «ممرات مكيفة» — the building's lobby, not the unit's AC
    "air_conditioner": (("مدخل", "مداخل", "ممر", "لوبي", "ردهه", "بهو", "مصلي"), ()),
    "furnished": (("محل", "معرض", "مستودع", "محلات", "معارض"), ()),
    # ── group A (owner handoff 2026-11-01) ──
    "fire_pit": ((), ("غاز", "الغاز", "كهربائي", "كهربائيه", "مطبخ", "المطبخ")),       # «موقد غاز» is the kitchen stove
    "playstation": (("شاشه", "شاشات", "تلفزيون", "تلفاز", "تلفزيونات"), ()),            # «شاشة سوني» is a TV brand
    "mandi_pit": (("مطعم", "مطاعم", "محل"), ()),
    "tent": ((), ()),
    "two_sections": ((), ("نوم", "ماستر", "رئيسيه", "رئيسيين", "رئيسيتين")),              # «جناحين نوم» are bedrooms
    "for_youth": (("شارع", "حي", "طريق", "مركز", "نادي", "مخطط", "مسجد", "جامع"), ()),                    # «شارع الشباب» is an address
    "toilets_on_site": (("كيشاني", "سيراميك", "السيراميك", "بلاط", "عازل", "العازل", "عزل", "سخانات", "سخان", "طارده"),   # the home's
                        ("سباحه", "بخار", "مغربي", "تركي", "شمسي", "شمس", "زاجل")),   # bathrooms' tiles / insulation / heaters (🔬 11-09)   # «حمام سباحة» is the pool
    "lighting": ((), ("طبيعيه", "طبيعي")),                                              # «إضاءة طبيعية» is daylight
    "palms": (("حي", "شارع", "طريق", "مخطط", "مجمع", "مركز", "برج", "فندق", "مول", "واحه"), ()),   # «حي النخيل»
    "fruit_trees": (("حي", "شارع", "طريق", "مخطط", "مجمع", "عصير", "محل"), ()),
    "fodder_crops": (("سوق", "محل", "بقاله", "مطعم"), ()),                               # «سوق الخضار» is a market
    "poultry": (("مطعم", "مطاعم", "محل", "بروست"), ()),
    "farm_house": ((), ("شعر", "الشعر", "درج", "الدرج", "عمال", "العمال", "موظفين")),       # «مع بيت شعر», «بيت الدرج»
    "farm_rest_house": (("لبناء", "بناء"), ("للايجار", "للبيع", "يوميه", "يومي", "للتقبيل", "للتاجير")),  # the listing's own type
    "dunes_view": (("حي", "شارع", "طريق", "مخطط", "مجمع", "مكتب", "مؤسسه", "شركه"), ()),                           # «حي الرمال», «حي النفود»
    "horses_stable": (("حي", "شارع", "طريق", "مخطط", "ابا", "ابو", "تنفع", "مناسب", "مناسبه", "يصلح"), ()),
    "main_road": (("شمال", "جنوب", "شرق", "غرب", "الشمال", "الجنوب", "الشرق", "الغرب", "تقاطع", "خلف", "بين"),
                  ("الصحيح", "صحيح")),
    # ── group B (owner handoff 2026-11-01) ──
    "raised_plot": (("سعر", "اسعار", "قيمه", "ايجار", "اسقف", "سقف", "ارتفاع", "نسبه", "طلب"), ()),   # a high price / ceiling
    "all_services": (("حولها", "حوله", "حواليها", "حواليه", "جنبها", "جنبه"),                       # «حولها كل خدمات»: around it
                     ("قريبه", "قريب", "بالقرب", "المجاوره", "مجاوره", "حولها", "حوله",            # «جميع الخدمات قريبة»
                      )),      # «كل خدمات الشقه مستقله»: separate utilities (P2 13085, 🔬 2026-11-11);
                                                  # «جميع خدمات الشقة متوفرة» stays a yes (CodeRabbit on #11820)
    "street_lights": (("جوهره"), ("تحميل", "للتحميل", "تنزيل", "للتنزيل", "والتحميل")),                                        # «رصيف تحميل» is a dock
    "approved_plan": (("مكتب", "مسوق", "وسيط", "مقاول", "مهندس", "مقيم", "مثمن", "وكيل"), ()),
    "direct_owner": (("تفويض", "توكيل", "وكاله", "بتفويض", "مفوض", "مفوضين", "وكيل", "موكل"), ()),
    "no_services": (("مواد", "بترول", "نفط", "شارع"), ()),                                                # «مواد خام»
    # ── group C (owner handoff 2026-11-01) ──
    "frontage": (("اتجاه", "الاتجاه"), ("شماليه", "جنوبيه", "شرقيه", "غربيه", "شمال", "جنوب", "شرق", "غرب", "بحريه", "حجر",
                                         "العقار", "الارض", "المبني", "الوحده", "eastern", "western", "northern", "southern")),   # «واجهة العقار: Eastern / -» is a facing
    "in_tower": (("شارع", "حي"), ("كهرباء", "الكهرباء", "مياه", "المياه", "اتصالات", "الاتصالات", "مراقبه")),     # «برج كهرباء» is a pylon
    "license": (("رقم", "برقم", "صاحب", "انتهاء", "تاريخ"), ("بناء", "البناء", "فال", "اعلان", "الاعلان", "هدم", "حفر", "ترميم", "تسوير", "الهيئه", "هيئه", "موثوق", "المعلن", "معلن", "الوسيط")),
    "insulated_panel": ((), ("صوت", "للصوت", "الصوت", "صوتي", "صوتيا")),                             # «عازل للصوت» is soundproof
    "cold_storage": (("تكييف", "تكيف", "مكيف", "مكيفات", "نظام", "انظمه"), ()),                     # «نظام تبريد» is the AC
    "car_wash": (("حمام", "دوره", "بانيو", "جناح", "مرحاض"), ("ملابس", "يد", "ايدي", "رخام", "وشطاف", "شطاف")),
    # «مجهزة بمضخة الحريق» (a fire pump) and «صب بمضخة» (concrete poured by pump) are not a station's fuel pumps
    # (aqar 2026-11-05 evidence-phrase review, «بمضخه» on 25 ads; the chip is the 🛢️ station cohort's)
    "pumps": (("صب", "بالصب", "وصب"), ("حريق", "الحريق", "للحريق", "الاطفاء", "اطفاء")),
    "earning_income": (("بين", "حقوق", "التزامات", "توقيع"), ("والمستاجر", "المستاجر", "ومستاجر")),  # the contract's parties
    # 2026-11-03 audit round 2: a contact line, a hall, a city name, a delivery bike
    "elevator": (("التاسيس", "بالتاسيس", "لتاسيس", "وتاسيس"), ()),                     # «وتم التأسيس للمصعد»
    "staff_housing_inside": (("يصلح", "تصلح", "مناسب", "مناسبه", "مثالي", "مثاليه", "ينفع", "تنفع", "لبناء", "لانشاء", "او"), ()),
    "workers_housing": (("يصلح", "تصلح", "مناسب", "مناسبه", "مثالي", "مثاليه", "ينفع", "تنفع", "لبناء", "لانشاء", "او"), ()),
    "wifi": ((), ("فلكس", "فليكس")),                                                       # «نت فلكس» is Netflix
    "internet": ((), ("فلكس", "فليكس")),
    "truck_access": (("يسع", "يتسع", "سعه", "سعته", "لثلاث", "لثلاثه"), ("ماء", "مياه", "طن", "ونصف")),   # a tank «يسع 3 تريلات»
    "smart_tv": (("فوكس", "vox", "ريل"), ("فوكس", "vox", "ريل")),                          # «سينما فوكس» is a cinema nearby
    "smart_home": (("بوابه", "بوابات", "دخول", "الدخول", "مدخل", "قفل"), ()),              # «بوابات بنظام ذكي»
    "singles": (("يمنع", "نؤجر", "اؤجر", "استقبل", "نستقبل", "نعتذر"), ()),                       # the positive word inside a refusal («يمنع سكن العزاب»)
    "office_inside": (("التواصل", "تواصل", "اتصل", "بالتواصل", "تواصلوا", "راسل"), ()),
    # «غرفة حفلات ومناسبات», «قاعة اجتماعات ومناسبات», «منطقة احتفالات ومناسبات للسكان»: the building's own room; «هدايا
    # ومناسبات», «ورد … ومناسبات»: what a shop sells (P2 13085 «ومناسبات», aqar 1783289 / 19532680, 🔬 2026-11-11)
    "for_events": (("قاعه", "صاله", "قاعات", "صالات", "لاقامه", "غرفه", "هدايا", "هديه", "ورود", "ورد",
                    "اجتماعات", "احتفالات", "منطقه"), ()),
    "industrial_area": (("الجبيل", "جبيل", "ينبع", "شارع"), ()),
    "quad_bikes": (("توصيل", "لتوصيل", "مندوب", "مناديب"), ()),
    "camels": (("قرين", "جرين"), ()),                                                    # «قرين ابل» is a brand
    "rooms_suites": (("علي", "شارع"), ("خادمه", "خدامه", "شغاله", "نساء", "حريم", "نسائي", "ماستر", "رئيسي", "نوم", "سائق", "رجال", "الرجال",
                          "خاص", "ضيوف", "للضيوف")),
    "mosque": (("شارع", "طريق", "حي", "مخطط", "دوار", "ميدان", "شمال", "جنوب", "شرق", "غرب"), ()),   # «جنوب مسجد قباء» is a bearing                                 # «شارع المسجد» is an address
    "market": (("شارع", "طريق", "حي"), ()),
    "reception": (("صاله", "غرفه", "مجلس", "صالة"),
                  ("عروض", "العروض", "طلب", "الطلب", "استفسار", "الاستفسار", "اتصال", "الاتصال", "ملاحظ", "الضيوف", "ضيوف")),                                           # «صالة استقبال» is a living room
}
# Facts that only count with a context word near them (or as a bare list item) — «واصل كهرباء»,
# «خدمات العقار: كهرباء، مياه»; never a bare «مياه» inside a sentence (it is a bathroom, a well, a sea …).
_CUES = tuple(_n(w) for w in ("واصل", "واصله", "موصل", "موصله", "خدمات", "الخدمات", "المرافق", "مرافق", "يوجد",
                              "توجد", "موجود", "متوفر", "متوفره", "يتوفر", "تتوفر", "توفر", "شامل", "شامله", "مع",
                              "services", "utilities", "has", "have", "connected", "connection", "connections",
                              "included", "includes", "including", "supply",
                              # AI teacher pass 2026-10-27 (muhaysini / dealapp generated prose, rent-inclusive stays):
                              "امداد", "موثوق", "توفير", "توفر", "توافر", "متاح", "وصول", "مزود", "مجهز", "متصل",
                              "شبكه", "يشمل", "تشمل", "مشمول", "راكب", "راكبه", "واصلين", "واصلات", "مفصول", "عداد"))
_NEEDS_CUE = frozenset({"electricity", "water_supply"})
# A utility word that carries a list on into the next clause: «خدمات العقار: Electricity, Waters الضمانات …» —
# the comma ends the clause, so «Waters» has no cue of its own (bench-v1: ~340 water/electricity misses).
_UTILITY = tuple(_n(w) for w in ("كهرب", "مياه", "ماء", "مويه", "صرف", "هاتف", "الياف", "electricity", "water",
                                 "sanitation", "fibre", "fiber", "telephone", "phone"))
# Public amenities a neighbourhood also has: «مسجد وحديقة قريبة من العمارة», «حديقة … مقابل العمارة»,
# and the items of a «خدمات قريبة: مسجد - حديقة» list — the nearby word may come AFTER, or a clause before.
_PUBLIC_FACTS = frozenset({"garden", "pool", "gym", "parking", "nursery", "kids_play_area", "sports_court",
                           "football_pitch", "events_hall", "mosque", "market", "in_mall", "restaurant_cafe", "food_allowed"})
_NEAR_AFTER = tuple(_n(w) for w in ("قريب", "بالقرب", "مجاور", "بجوار", "مقابل", "مقربه", "خطوات",
                                     # «مسجد قباء: ١٠ دقائق», «🌳 حديقة الرائد — دقيقة واحدة»
                                     "دقيقه", "دقائق", "دقايق", "دقيقتين", "دقيقتان"))
# «🕌 المسجد على بُعد خطوات», «مسجد الحي على بُعد 100 م»: the distance comes right AFTER the public place (a unit's own
# «مسبح خاص على بعد دقائق من البحر» keeps its pool — «خاص» before the distance is the unit's)
_DISTANCE_AFTER = (_n("علي بعد"), _n("علي مسافه"))
# A PUBLIC PLACE named after «خلف / أمام / جنبها / ومقابلها / ظهيرة / 4 كيلو» is a landmark, not part of the unit
# («خلف شبيلي مول», «تتوفر جنبها … سوبرماركت», «ومقابلها مسجد», 2026-11-03 audit round 2). These words are too common to
# silence every fact — «غرفة غسيل خلف الحديقة 🔸مطبخ» has a kitchen — so they apply to these public places only.
_NEAR_PUBLIC = frozenset(_n(w) for w in ("جنبها", "جنبه", "خلف", "خلفها", "خلفه", "امام", "امامها", "امامه", "مقابلها",
                                         "ظهيره", "كيلو", "كم", "تفتح", "behind",
                                         # 🔬 2026-11-04 public-place audit: «ملاصق لمسجد التقوى», «حولها حدايق ومسجد», «يفتح علي حديقه»,
                                         # «محيطه به خدمات كاملة (… مسجد)», the typo «وبلقرب من الحديقة»
                                         "ملاصق", "ملاصقه", "حولها", "حوله", "يفتح", "محيطه", "يحيط", "تحيط", "يحيطها",
                                         "تحيطها", "بلقرب"))
# …and a public place the ad OWNS says so: «مرافق المشروع: مصلى», «سوبر ماركت داخل المجمع», «يضم مسجد»
# «… رخصة انشاء وبها مسبح»: a «has» word opening a new item after a permit says the place HAS it (🔬 2026-11-13).
_HAS_CUES = frozenset(_n(w) for w in ("بها", "فيها", "به", "فيه", "يوجد", "توجد", "يحتوي", "تحتوي"))
_OWN_CUES = tuple(_n(w) for w in ("داخل", "بالمجمع", "بالمشروع", "بالعماره", "بالمبني", "مرافق", "يضم", "تضم",
                                   "يحتوي", "تحتوي", "يوجد", "توجد", "لسكان", "للسكان", "خاص", "خاصه", "مميزات",
                                   "متكامل", "متكامله"))      # «*خدمات متكاملة* 🔸 ممشى وحديقة» — the project's own list
# AREA talk is not the ad's own place: «تتميز المنطقة بتوفر خدمات … والسوبرماركت», «يتميز الموقع بتوفر جميع الخدمات مسجد/بقالة»
_AREA_WORDS = frozenset(_n(w) for w in ("المنطقه", "الحي", "الموقع"))
_SERVICE_WORDS = tuple(_n(w) for w in ("خدمات", "الخدمات", "بتوفر", "تتوفر", "يتوفر", "مخدوم", "مخدومه"))
# the object that closes a near phrase as one item: «قريب من الخدمات» / «بالقرب من جميع الخدمات» / «قريب من المرافق»
_SERVICES_OBJECT = frozenset(_n(w) for w in ("خدمات", "الخدمات", "المرافق", "مرافق"))
# …and «و بها / وفيها / ويوجد» after the nearby object turns back to the unit: aqar 15315855 «قريب من الدائري و بها
# مصعد» (elevator recall sample 2026-11-04). Unit facts only, like the rule above.
_UNIT_AGAIN = frozenset(_n(w) for w in ("بها", "فيها", "يوجد", "توجد", "يتوفر", "تتوفر"))
_PURE_PUBLIC_FACTS = frozenset({"mosque", "market", "restaurant_cafe", "in_mall"})
# The PLOT'S NEIGHBOUR is not the ad's own (🔬 2026-11-04): «شارع 10 جنوبي وحديقة», «من الغرب: حديقة + مواقف», «واجهة:
# غربية على حديقة», «ربع واجهة على جامع», «مشروعنا مباشر على حديقه». A compass direction, a facade, a boundary or
# «مباشرة» just before a public place makes it the neighbour — unless the ad says it has it («فيلا شمالية فيها حديقة»).
_BOUNDARY_STEMS = tuple(_n(w) for w in ("شمال", "جنوب", "شرق", "غرب", "جهه", "جهتين", "جهات", "واجهه", "واجهتين",
                                         "واجهات", "يحد", "حدود", "مباشر"))
_OWN_AFTER = frozenset(_n(w) for w in ("خاص", "خاصه", "مستقل", "مستقله", "لسكان", "للسكان"))
# …unless the very next words name the NEIGHBOURHOOD as the owner: «ملعب كرة قدم خاص بالحي», «نادي لسكان الحي» are the
# district's, not the home's (CodeRabbit on #10948: the lift above turned «واجهة على ملعب خاص بالحي» into football_pitch)
_NBHD_OWNER = frozenset(_n(w) for w in ("الحي", "بالحي", "للحي", "حي", "المخطط", "بالمخطط", "للمخطط", "المنطقة",
                                         "بالمنطقة", "للمنطقة", "المدينة", "بالمدينة", "للمدينة", "لاهل", "لأهل", "للجميع",
                                         "للعموم", "عام", "عامة", "مخطط", "منطقة", "مدينة"))


def _owned_after(gn: list[str]) -> bool:
    """True when an ownership word («خاص», «مستقل», «لسكان») follows the place within two words and the word right
    after it does not hand it to the neighbourhood («خاص بالحي», «لسكان المدينة»). Only that one word: in «خاص للفيلا
    بالحي» the villa is the owner and «بالحي» says where the villa is."""
    for k, w in enumerate(gn[:2]):
        if _strip_wa(w) in _OWN_AFTER:
            nxt = gn[k + 1:k + 2]
            return not any(x in _NBHD_OWNER or _strip_wa(x) in _NBHD_OWNER for x in nxt)
    return False
_POOL_FACTS = frozenset({"pool", "heated_pool", "kids_pool"})
# «لا تطل على مسبح» denies the view and says nothing of a pool; «مطلة على المسبح البلدي» is the town's
_VIEW_NEG = frozenset(_n(w) for w in ("لا", "ليس", "ليست", "غير", "بدون", "بلا", "ما", "مو", "مش"))
_PUBLIC_POOL = frozenset(_n(w) for w in ("البلدي", "بلدي", "العام", "عام", "العامه", "عامه", "الاولمبي", "اولمبي"))
_GOVERNS_NEAR = frozenset(_n(w) for w in ("بجوار", "جوار", "بجانب", "جنب", "مقابل", "امام", "قرب", "قريب", "قريبه", "بالقرب"))
_HAS_CUES = tuple(_n(w) for w in ("فيها", "فيه", "بها", "به", "تحتوي", "يحتوي", "يوجد", "توجد", "يضم", "تضم", "داخل"))


def _is_boundary(w: str) -> bool:
    """«جنوبي», «الشمال», «واجهة» (its «و» is the word's own, not «and»), «وغرباً»."""
    for x in (w, _strip_wa(w)):
        if _starts(x, _BOUNDARY_STEMS) or (x.startswith("ال") and _starts(x[2:], _BOUNDARY_STEMS)):
            return True
    return False
_NEAR_PUBLIC_FACTS = frozenset({"mosque", "market", "in_mall", "in_tower", "restaurant_cafe", "food_allowed", "sports_court",
                                "football_pitch", "events_hall", "nursery", "garden",
                                "gym",
                                # «قريبة من المرافق العامة: 🏫 مدارس 🏥 مستشفيات 🛍️ محلات تجارية» — the area's shops (🔬 2026-11-07
                                # two-way sample, aqar 12726261)
                                "shops_inside"})   # «إطلالة ونافذة على: حديقة، جامع، ونادي صحي» is the view, not the unit's gym (🔬 2026-11-06)
# A UNIT FIXTURE is never «nearby» (🔬 2026-11-04 live walk, dealapp): «بلكونة مطلة على لاندسكيب 🔹مكيفات راكبة»,
# «قريب من المسجد عدد 9 مكيفات راكبه», «20 دقيقة من روشن ❄ تكييف» — the near word belongs to the bullet before, the AC
# is the unit's. Kept to the AC: a kitchen or a lift CAN be a nearby place's («قريب من مطبخ السلطان», a tower's lifts).
# Furniture is never a nearby place either (🔬 2026-11-05): «قريبة من المروج بدون اثاث» is the flat's own no.
_NEAR_NEVER_FACTS = frozenset({"air_conditioner", "furnished"})
# A furnished word right after the KITCHEN is the kitchen's («مطبخ ماثث», «مطبخ مؤثث بدون اجهزة»), not the home's (🔬 2026-11-14)
_KITCHEN_WORDS = frozenset(_n(w) for w in ("مطبخ", "المطبخ", "مطابخ", "المطابخ", "بمطبخ", "بالمطبخ", "للمطبخ", "لمطبخ"))
# A horse word inside a POSSIBLE use or an activity list is not horses on the plot (🔬 2026-11-14, P2 13085 «الخيل»)
# «مناسب للعائلات» / «الأنشطة المتوفرة … تشمل ركوب الخيل» are not possible uses (CodeRabbit #12188), so only these words.
_POSSIBLE_ACTIVITY = frozenset(_n(w) for w in ("مثالي", "مثاليه", "لمشاريع", "مشاريع", "لمزاوله", "لمزواله", "لممارسه",
                                               "يصلح", "تصلح"))
# A possible-use LIST opener reaches every item after it in the clause, however long the list (🔬 2026-11-14, P1 14340,
# dealapp 24545744 «مناسبة لعدة أنشطة استثمارية: 🔹 منتجع سياحي 🔹 … 🔹 مشروع فعاليات ومناسبات خاصة»)
# «تصلح لإقامة مشروع قصور أفراح ومناسبات» (dealapp 21597198) is a project to build; «تصلح للمناسبات» stays a yes.
_POSSIBLE_OPENER = re.compile(r"مناسب(?:ه)?\s+ل(?:عده|انشطه|مشاريع)|انشطه\s+استثماري|لاقامه\s+مشروع")
# …and an existence word between the possible use and the horses says the plot HAS them («مثالية للاستثمار، يوجد اسطبل خيل»)
_HAS_NOW = frozenset(_n(w) for w in ("يوجد", "توجد", "فيها", "فيه", "بها", "به", "يتوفر", "تتوفر", "متوفر", "متوفره",
                                     "تشمل", "يشمل", "نوفر", "داخل"))
# A VIEW is not a distance (🔬 2026-11-05): «صالة معيشة مطلة بلكونة مطبخ أمريكي» has a balcony and a kitchen. A view word only
# silences what can be outside (a park, a pool, a sea) — never the home's own rooms.
_SEPARATE = frozenset(_n(w) for w in ("مستقل", "مستقله", "منفصل", "منفصله", "مستقلة", "منفصلة"))
_UNIT_NOUNS = frozenset(_n(w) for w in ("الشقه", "الشقة", "الوحده", "الوحدة", "العقار", "الفيلا", "الدور", "المحل",
                                        "شقه", "وحده", "عقار", "فيلا", "دور", "محل"))
_ROAD_NAMED = frozenset(_n(w) for w in ("الدائري", "السريع", "العام", "الرئيسي", "الدولي", "السريعه", "الرئيسيه",
                                        "المسمى", "المسمي"))   # «الطريق المسمى طريق الملك فهد» (CodeRabbit on #11820)
_VIEW_WORDS = frozenset(_n(w) for w in ("مطل", "مطله", "تطل", "يطل", "اطلاله", "باطلاله", "overlooking", "views"))
_UNIT_ROOMS = frozenset({"kitchen", "balcony", "maid_room", "driver_room", "laundry_room", "majlis", "dining_majlis", "elevator",
                         "storage", "roof", "annex", "furnished", "two_entrances", "private_entrance", "car_entrance",
                         "toilets_on_site"})   # «غرفه مطله للحوش) عدد (۳) دورات مياه» (aqar 15126306, CodeRabbit #11820)
# A NEARBY LIST item names a PLACE (🔬 2026-11-04 café audit): «Close to shops, restaurants, and markets». The list ends at
# the first item that is not a place — DealApp's REGA list «مصعد ، قريب من الخدمات ، نوافذ زجاج ، موقف سيارات» goes on
# with the unit's own features — and it only ever silences the public places of _NEAR_PUBLIC_FACTS (never parking).
_PLACE_WORDS = tuple(_n(w) for w in (
    "مسجد", "مساجد", "جامع", "جوامع", "مدرس", "مدارس", "مستشفي", "مستشفيات", "مستوصف", "سوق", "اسواق", "مول", "مولات",
    "مطعم", "مطاعم", "مقهي", "مقاهي", "كافيه", "كافيهات", "كوفي", "حديقه", "حدائق", "بقاله", "بقالات", "سوبرماركت",
    "صيدليه", "صيدليات", "جامعه", "جامعات", "مركز", "مراكز", "محطه", "بنك", "بنوك", "مغسله", "مغاسل", "فندق", "فنادق",
    "shop", "school", "hospital", "mall", "market", "restaurant", "cafe", "café", "park", "mosque", "bank", "grocer",
    "supermarket", "pharmac", "universit", "hotel", "service", "attraction", "coffee",
    "تموينات", "بلديه", "بحيره", "شارع", "الشارع", "طريق", "مطار", "كليه", "ممشي", "كورنيش", "مدينه", "مصلي",
    "نادي", "اندية", "نوادي", "جيم", "gym"))
_METER_FACTS = frozenset({"separate_water_meter", "separate_electricity_meter"})
_DIGITS = "0123456789"


def _compile(spec: str) -> re.Pattern[str]:
    if spec.startswith("re:"):
        return re.compile(rf"(?:(?<= )|^|(?<=\d)){_PROCLITIC}(?:{spec[3:]})(?!\w)")
    if spec.isascii() and len(spec) <= 4 and not spec.startswith("^"):
        spec = f"^{spec}$"                          # «a/c», «lift»: folded to «a c», a loose hit fires inside «a car»
    start, end = spec.startswith("^"), spec.endswith("$")
    core = re.escape(_n(spec.strip("^$")))
    # a word may start right after a glued digit: «2مجلس», «1مطبخ» (bench-v1)
    return re.compile((rf"(?:(?<= )|^|(?<=\d)){_PROCLITIC}" if start else "") + core + (r"(?!\w)" if end else ""))


_PATTERNS: dict[str, list[tuple[re.Pattern[str], Optional[bool]]]] = {
    fact: [(_compile(s[0]), s[1]) if isinstance(s, tuple) else (_compile(s), None) for s in specs]
    for fact, specs in FACT_TOKENS.items()
}


def _word_bounds(t: str, s: int, e: int) -> tuple[int, int]:
    ws = t.rfind(" ", 0, s) + 1
    we = t.find(" ", e)
    return ws, (len(t) if we < 0 else we)


def _starts(word: str, stems: tuple[str, ...]) -> bool:
    w = word[1:] if word.startswith("و") and len(word) > 3 else word
    return any(word.startswith(x) or w.startswith(x) for x in stems)


# «موقد» is both a fire pit («موقد نار / حطب», «موقد (مشب)», «جلسة خارجية مع موقد») and the kitchen cooktop («مطبخ مجهز
# بالفرن والموقد», «موقد سيراميكي», «موقد أربعة عيون كهربائي», «ثلاجة، موقد، غلاية»). 🔬 2026-11-08 two-way sample: 28 of 30
# served apartment «موقد» yeses were the stove. Order of evidence (CodeRabbit on #11295):
#   1. a cooktop word right after it («موقد سيراميكي / كهرباء / مسطح / غاز / عينين») → the stove;
#   2. a fire word within 4 («نار», «حطب», «مشب», «فحم») → the fire pit;
#   3. a seating / outdoor word right beside it («جلسة خارجية مع موقد», «موقد خارجي») → the fire pit;
#   4. a kitchen / appliance word within 7, in the same sentence → the stove.
# Neither → unchanged (a bare «موقد» in a chalet stays the fire pit it was). The window crosses list commas — «ثلاجة،
# فرن، موقد» puts each item in its own clause — but never «.», «!», «؟» or a new line: «مطبخ فيه فرن.\nموقد حجري في
# الصالة» keeps its fire pit.
_FIRE_CUES = tuple(_n(w) for w in ("نار", "النار", "حطب", "الحطب", "للحطب", "بالحطب", "مشب", "المشب", "فحم", "الفحم", "جمر",
                                   "تدفئه", "fire", "wood"))
_FIRE_NEAR = tuple(_n(w) for w in ("خارجي", "خارجيه", "شتوي", "شتويه", "حوش", "الحوش", "جلسه", "الجلسه"))
# «نار» alone is a WEAK fire word: «موقد نار» is also how a gas / electric burner is named in a kitchen list (🔬 2026-11-09,
# 9 of 21 served home «موقد» yeses: «اجهزة الطبخ : ميكرويف ثلاجة صغيرة وموقد نار وغلاية», «مطبخ مجهز بالكامل (موقد نار
# كهريائي», «اسطوانه غاز موقد نار ثلاجه», «المطبخ : … قدور , كاسات , موقد نار»). It still beats a kitchen word unless that
# kitchen word is there and no seating / outdoor word sits within 4 («جلسة خارجية مع موقد نار», «5- جلسة ارضية مع موقد نار»).
_WEAK_FIRE = tuple(_n(w) for w in ("نار", "النار", "للنار"))
_COOKTOP_AFTER = tuple(_n(w) for w in ("سيراميك", "مسطح", "سطحي", "كهرب", "غاز", "الغاز", "عين", "عيون", "بوتجاز", "built",
                                       "انفرا", "حراري", "مزدوج", "طبخ", "طهي", "ستيل", "اربع", "اربعه", "ثلاث", "خمس",
                                       "لطبخ", "لطهي", "كهري"))
_STOVE_CUES = tuple(_n(w) for w in ("فرن", "الفرن", "افران", "شفاط", "الشفاط", "ثلاج", "الثلاج", "ميكرو", "الميكرو", "مايكرو",
                                    "المايكرو", "مكرو", "غلاي", "الغلاي", "غساله", "الغساله", "مطبخ", "المطبخ", "طبخ", "الطبخ",
                                    "طهي", "الطهي", "عين", "عيون", "سيراميك", "مسطح", "سطحي", "كهرب", "غاز", "الغاز", "بوتجاز",
                                    "built", "اجهز", "الاجهز", "ادوات", "صحون", "الصحون", "فريزر", "قهوه", "القهوه", "اسطوان",
                                    "مزدوج", "انفرا", "حراري", "ستيل", "اطباق", "الاطباق", "قدور", "القدور", "ملاعق",
                                    "كاسات", "اواني", "الاواني", "اوني", "سرفيس", "لطبخ", "لطهي", "كهري"))
_LAND_USE_WORD = r"(?:ال)?(?:سكني|سكنيه|تجاري|تجاريه|زراعي|زراعيه|صناعي|صناعيه)"
_LAND_WANTED = frozenset(_n(w) for w in ("مطلوب", "مطلوبه", "نشتري", "نبحث", "نرغب", "شراء"))
_LAND_USE_WORD_RE = re.compile(r"(?:و)?" + _LAND_USE_WORD)
_LAND_USE_OF = {"سكني": "سكني", "تجار": "تجاري", "زراع": "زراعي", "صناع": "صناعي"}
_LAND_USE = re.compile(
    r"(?<!\w)(?:"
    r"(?:و|ب|ل|ال|وال|بال)?(?:ارض|ارضين|اراضي|ارضيه|قطعه|قطعتين|قطع)(?:[ _](?:ال)?(?:زاويه|مميزه|مميز|فضاء))?(?: (?:للبيع|للايجار))?"
    r"|(?:و|ب)?صك(?: (?:ال)?(?:الكتروني|الكترونى))?"
    r"|(?:استخدام|استخدامات) (?:ال)?(?:عقار|ارض)|(?:ال)?(?:استخدام|استخدامات)|نوع (?:ال)?ارض|تصريح بناء|رخصه بناء"
    r")[ _]+(?P<u>" + _LAND_USE_WORD + r")(?:[ _]+(?:او |و)?(?P<u2>" + _LAND_USE_WORD + r"))?(?!\w)")
_LAND_CONVERT = re.compile(r"(?<!\w)(?:لل|ل|ب)?(?:تحويل|تحول|تحويلها|تحويله|تغيير|تغييرها|تغييره|تغير)(?:\s+\S+){0,3}?\s+(?:الي\s+|لل|ل)?"
                           + _LAND_USE_WORD + r"(?!\w)")
# «أرض سكنية قابلة للتحويل» names no destination but still says the use may change (CodeRabbit on #11819)
_LAND_CONVERTIBLE = re.compile(r"(?<!\w)و?(?:قابل|قابله|يمكن|ممكن|امكانيه)\s+(?:لل|ل)?(?:تحويل|تحويلها|تحويله|تغيير|تغييرها|تغييره)(?!\w)"
                               # «يمكن تحويل ثمن العقار إلى حساب بنكي» is a payment, not the use (CodeRabbit on #11819)
                               r"(?!\s+(?:ال)?(?:ثمن|مبلغ|المبلغ|الدفع|دفعه|العربون|الي حساب|لحساب))")
# a use the ad DENIES or only calls POSSIBLE is not its use (CodeRabbit on #11819: «ليست أرض سكنية», «يمكن استخدام
# العقار تجاري», «تصلح ارض تجارية»)
_LAND_NOT_STATED = frozenset(_n(w) for w in ("ليست", "ليس", "غير", "مو", "مش", "لا", "يمكن", "ممكن", "بالامكان", "تصلح",
                                             "يصلح", "مناسب", "مناسبه", "قابل", "قابله", "امكانيه"))
_SENTENCE_END = re.compile(r"[.!?؟\n]")


def _stove_not_fire(raw: str, clauses: list, ci: int, t: str, s: int, e: int) -> bool:
    """True when this «موقد» is the kitchen cooktop (see the order above)."""
    ws, we = _word_bounds(t, s, e)
    if not _strip_wa(_bare(t[ws:we])).startswith(("موقد", "الموقد")):
        return False
    # «!» / «؟» are not clause breaks, so a sentence can end INSIDE this clause («مطبخ فيه فرن! موقد حجري»): cut the
    # window there too (CodeRabbit on #11295), via the clause's own raw text and its position map.
    c_raw, idx = clauses[ci][1], clauses[ci][3]
    lo, hi, left_open, right_open = 0, len(t), True, True
    if idx and ws < len(idx):
        ends = [m.end() for m in _SENTENCE_END.finditer(c_raw[:idx[ws]])]
        if ends:
            lo = next((k for k, r in enumerate(idx) if r >= ends[-1]), ws)
            left_open = False
        nxt = _SENTENCE_END.search(c_raw, idx[min(we, len(idx)) - 1] + 1)
        if nxt:
            hi = next((k for k, r in enumerate(idx) if r >= nxt.start()), len(t))
            right_open = False
    before, after = t[lo:ws].split(), t[we:max(we, hi)].split()
    for k in range(ci - 1, max(-1, ci - 4), -1) if left_open else ():   # earlier clauses, only across a list separator
        if _SENTENCE_END.search(raw[clauses[k][0] + len(clauses[k][1]):clauses[k + 1][0]]):
            break
        before = clauses[k][2].split() + before
    for k in range(ci + 1, min(len(clauses), ci + 4)) if right_open else ():
        if _SENTENCE_END.search(raw[clauses[k - 1][0] + len(clauses[k - 1][1]):clauses[k][0]]):
            break
        after = after + clauses[k][2].split()
    if any(_starts(_bare(w), _COOKTOP_AFTER) for w in after[:2]):
        return True
    near4 = before[-4:] + after[:4]
    strong = [w for w in near4 if _starts(_bare(w), _FIRE_CUES) and not _strip_wa(_bare(w)) in _WEAK_FIRE]
    if strong:
        return False
    if any(_starts(_bare(w), _FIRE_CUES) for w in near4):          # only a weak «نار»
        if any(_starts(_bare(w), _FIRE_NEAR) for w in near4):
            return False
        return any(_starts(_bare(w), _STOVE_CUES) for w in before[-7:] + after[:7])
    if any(_starts(_bare(w), _FIRE_NEAR) for w in before[-2:] + after[:2]):
        return False
    return any(_starts(_bare(w), _STOVE_CUES) for w in before[-7:] + after[:7])


def _bare(w: str) -> str:
    """A context word without its proclitics: «بدورة» → «دوره», «لحمام» → «حمام», «وبخزان» → «خزان»."""
    w = w[1:] if w.startswith("و") and len(w) > 3 else w
    w = w[1:] if w[:1] in ("ب", "ل", "ف") and len(w) > 3 else w
    return _strip_wa(w)


# «قابل للتفاوض» is NEGOTIABLE, never «can be fitted» (🔬 2026-11-04, dealapp 17491376 «المطبخ راكب المكيفات راكبه وقابل
# للتفاوض» read no AC): that «قابل» is dropped before the PREPARED words look at the neighbours.
_NEGOTIABLE = ("للتفاوض", "للتفاهم", "للنقاش", "للسوم", "للمساومه")


def _not_negotiable(words: list[str]) -> list[str]:
    return [w for k, w in enumerate(words)
            if not (_strip_wa(w) in ("قابل", "قابله") and words[k + 1:k + 2] and words[k + 1].startswith(_NEGOTIABLE))]


# A «prepared / possible» word governs ITS OWN object (🔬 2026-11-05, Property Finder review): «تكييف سبليت تأسيس مصعد»
# has a split AC and a prepared lift; «مطبخ موسس مصعد», «غرفه خادمه تأسيس مصعد», «بمصعدين يمكن تأجير» keep their kitchen,
# maid room and lifts. BEFORE the hit it applies when adjacent («تأسيس مصعد») or one qualifier / make-verb away («تأسيس كامل
# للتكييف», «يمكن عمل مسبح»); AFTER the hit it applies («مصعد مؤسس», «مسبح خارجي مؤسس») unless it governs the next word
# («… تأسيس مصعد», «موسس مصعد») — and a make-verb next («مسبح يمكن عمله») still belongs to the hit.
_PREP_QUALIFIERS = tuple(_n(w) for w in ("كامل", "كامله", "بالكامل", "جاهز", "جاهزه", "فقط", "لجميع", "جميع", "لكل", "كل"))
_PREP_MAKE = tuple(_n(w) for w in ("عمل", "انشاء", "اضافه", "تركيب", "بناء", "تحويل", "استخدام", "استغلال", "تجهيز", "توفير"))
# «يمكن / قابل …» take a VERB after them («يمكن تأجير», «قابل للتفاوض») — they govern it unless it is a make-verb («يمكن عمله»);
# «تأسيس / مؤسس …» govern the next word only when it is itself a fixture («تأسيس مصعد»), not «تأسيس أمريكي».
_PREP_VERBAL = tuple(_n(w) for w in ("يمكن", "ممكن", "امكانيه", "بالامكان", "يصلح", "قابل", "قابليه"))
_PREPARABLE = tuple(_n(w) for w in ("مصعد", "مصاعد", "اصنصير", "مسبح", "تكييف", "تكيف", "مكيف", "مكيفات", "فايبر", "الياف",
                                     "كهرباء", "سخان", "مطبخ", "كاميرات", "انتركم", "غاز", "شاحن",
                                     # «تسليك إنترنت / دش / مجاري» governs its OWN object, never a fitted AC before it
                                     # (CodeRabbit on #11470: «مكيفات راكبة وتسليك إنترنت» lost its AC)
                                     "انترنت", "الانترنت", "نت", "دش", "ستلايت", "مجاري", "صرف", "تلفون", "هاتف"))


def _bare_l(w: str) -> str:
    """«للاستخدام» → «استخدام», «لعمل» → «عمل»: the object after «قابل / يمكن» often carries «ل»."""
    for p_ in ("وال", "لل", "ال", "ل", "و"):
        if w.startswith(p_) and len(w) > len(p_) + 2:
            return w[len(p_):]
    return w


# A two-word object of a prepared word: «تسليك واي فاي» lays cabling for Wi-Fi, never for a fitted AC before it
# (CodeRabbit on #11470; «واي» alone looks like «و + اي» to the single-word check above).
_PREPARABLE_PHRASES = ((_n("واي"), _n("فاي")),)


def _prepared_applies(before: list[str], after: list[str], hit: str = "") -> bool:
    # «تمديد نحاس للمكيفات», «تأسيس كامل لمصعد»: a hit that starts with «ل / لل» is the prepared word's own object
    if hit.startswith("ل") and any(_starts(w, _PREPARED) for w in before[-3:]):
        return True
    if before:
        if _starts(before[-1], _PREPARED):
            return True
        if len(before) > 1 and _starts(before[-2], _PREPARED) and (
                _starts(_bare_l(before[-1]), _PREP_QUALIFIERS) or _starts(_bare_l(before[-1]), _PREP_MAKE)):
            return True
    for k, w in enumerate(after[:2]):
        if not _starts(w, _PREPARED):
            continue
        nxt = after[k + 1] if k + 1 < len(after) else ""
        if nxt and ((_starts(_bare_l(nxt), _PREPARABLE) and not (nxt.startswith("و") and _strip_wa(nxt) != nxt))
                    or tuple(after[k + 1:k + 3]) in _PREPARABLE_PHRASES or _strip_wa(nxt) in ("وايفاي", "wifi")
                    or (_starts(_strip_wa(w), _PREP_VERBAL) and not _starts(_bare_l(nxt), _PREP_MAKE))):
            continue                                # it governs the next word, not this hit
        return True
    return False


def _strip_wa(w: str) -> str:
    for p in ("وال", "و", "ال"):
        if w.startswith(p) and len(w) > len(p) + 1:
            return w[len(p):]
    return w


# «يوجد» / «توجد» ASSERTS what follows: «بدون سطح يوجد مكيفات» = no roof, there ARE air conditioners. A negator
# may touch it («لا يوجد»), but no catalogue word before it can carry an earlier «بدون» across it (🔬 2026-11-01:
# 12 aqar ads served AC unknown against their own yes box, ops_text_facts_conflicts).
_AFFIRM = frozenset(_n(w) for w in ("يوجد", "توجد"))


# «لا يوجد في المبنى مصعد», «لا يوجد بالعمارة مصعد» (CodeRabbit on #11820): ONE place phrase may sit between the no and
# the item — it says where the lift is missing, not that something else is.
_NEG_PLACES = frozenset(_n(w) for w in ("المبنى", "المبني", "العماره", "العمارة", "الشقه", "الشقة", "العقار", "الفيلا",
                                         "الفله", "الدور", "البيت", "المنزل", "الموقع"))
_NEG_PLACES_B = frozenset("ب" + w for w in _NEG_PLACES)


def _negated_before(prev: list[str]) -> Optional[int]:
    """How many words back the negation starts, or None. A list of catalogue words may sit in between."""
    j = len(prev)
    affirmed = False
    placed = False
    for _ in range(6):     # «لا يوجد مطبخ أو مكيفات أو مصعد متوفر»: a longer denied list (CodeRabbit on #11820)
        if j >= 1 and (prev[j - 1] in _NEG1 or _strip_wa(prev[j - 1]) in _NEG1):
            return len(prev) - (j - 1)
        if j >= 2 and (" ".join(prev[j - 2:j]) in _NEG2 or (_strip_wa(prev[j - 2]) + " " + prev[j - 1]) in _NEG2):
            return len(prev) - (j - 2)
        if affirmed:
            return None
        if not placed and j == len(prev) and j >= 3 and prev[j - 2] == "في" and prev[j - 1] in _NEG_PLACES:
            placed = True
            j -= 2
            continue
        if not placed and j == len(prev) and j >= 2 and prev[j - 1] in _NEG_PLACES_B:
            placed = True
            j -= 1
            continue
        # «او» joins a denied list like «و» does: «لا يوجد مطبخ أو مكيفات راكبة» denies the ACs too (reinvest 19994388,
        # 🔬 2026-11-11 — read when a trailing «لا يوجد» after «راكبة» stopped answering for them)
        if j >= 1 and _strip_wa(prev[j - 1]) in _LIST_WORDS | {"اي", "وجود", "يوجد", "او"}:
            affirmed = _strip_wa(prev[j - 1]) in _AFFIRM
            j -= 1
            continue
        return None
    return None


# The NEXT label of a REGA licence block is not a descriptor of this word: «… ماء، كهرباء النزاعات: لا يوجد» says the
# ad has no DISPUTES, not no electricity (🔬 2026-11-01: 12 dealapp/aqar ads, ops_text_facts_conflicts).
_FORM_LABELS = frozenset(_n(w) for w in ("النزاعات", "نزاعات", "الالتزامات", "التزامات", "الحقوق", "القيود", "الرهن",
                                          "الرهون", "الضمانات",
                                          # «عداد كهرب مستقل ملاحظات: * لا يوجد حوش» (reinvest 19994388, 🔬 2026-11-11):
                                          # a NOTES heading opens the next list, its «لا يوجد» is the yard's
                                          "ملاحظات", "الملاحظات", "ملاحظه", "الملاحظه", "تنبيه", "تنبيهات"))
# Whether a RENT includes the bill is not whether the unit has the supply: «لا يشمل الكهرباء», «الماء: غير شامل»,
# «المياه متوفرة (غير مشمولة)» (🔬 2026-11-01: ~35 ads served electricity / water unknown against a yes box).
_BILLING = tuple(_n(w) for w in ("شامل", "مشمول", "يشمل", "تشمل"))


# A TRAILING «غير شامل» on any fact is about the price, not the thing: «مطبخ راكب (غير شامل)», «مصعد غير شامل»,
# «مؤثثة بالكامل غير شامل», «صرف صحي (غير شامل)» — the thing is named, what the rent covers is not our question.
# A LEADING «لا يشمل» is a bill only on a utility («لا يشمل الأثاث» stays an honest unfurnished).
_BILL_FACTS = _NEEDS_CUE | {"sanitation"}


def _billing_not_supply(fact: str, prev: list[str], nxt: list[str]) -> bool:
    for skip in (0, 1):
        w = nxt[skip:]
        if skip and (not nxt or _strip_wa(nxt[0]) in _LIST_WORDS):
            break
        if len(w) >= 2 and _strip_wa(w[0]) == "غير" and _starts(w[1], _BILLING):
            if fact == "furnished" and len(w) >= 3 and w[2].startswith("ال"):
                return False                 # «مؤثثة بالكامل غير شامل الجاكوزي» (🔬 2026-11-05): the jacuzzi is billed, not the furniture
            return True
    if fact not in _BILL_FACTS:
        return False
    p = [_strip_wa(x) if x.startswith("و") else x for x in prev[-3:]]
    if len(p) >= 2 and p[-2] == "لا" and _starts(p[-1], _BILLING):
        return True
    if len(p) >= 3 and p[-3] == "لا" and _starts(p[-2], _BILLING) and _strip_wa(prev[-1]) in _LIST_WORDS:
        return True                          # «لا يشمل الماء والكهرباء» — the bill list reaches the second utility
    return False


# «مطبخ راكب لا يوجد مكيفات», «مطبخ راكب لا يتوفر مصعد», «مكيفات ومطبخ راكب لا يوجد أي تعاملات» (🔬 2026-11-11 kitchen
# recall sample, aqar 23092840 / 22064297 / 14846870 / 9242120 / 14860625): the «لا يوجد» opens the NEXT item — the
# ACs, the lift, the payments — so it is not this token's no. «مطبخ لا يوجد», «المطبخ: لا يوجد», «مطبخ لا يوجد حاليا»
# and «… لا يوجد فيها» stay a no.
_NEG_TAIL = frozenset(_n(w) for w in ("في", "فيه", "فيها", "به", "بها", "له", "لها", "معه", "معها", "حاليا", "حالياً", "ابدا",
                                      "اطلاقا", "نهائيا", "للاسف", "بالشقه", "بالعقار", "بالفيلا", "بالدور"))


def _affirmed(descriptor: str, fact: str) -> bool:
    """The word between the token and a trailing «لا يوجد» already says it is there: «مطبخ راكب», «مصعد متوفر»."""
    return _starts(_strip_wa(descriptor), _POST_NOT + tuple(_n(x) for x in _POST_NOT_FACT.get(fact, ())))


def _negates_next_item(rest: list[str]) -> bool:
    """True when words follow a «لا يوجد» that are another item, not this token's tail."""
    # «لا يوجد في المبنى مصعد»: a place, THEN an item — the lift is the no, not the fitted kitchen (CodeRabbit on #11820).
    # «لا يوجد في الشقة» (nothing after the place) stays a tail.
    if len(rest) >= 3 and rest[0] == "في" and rest[2] not in _NEG_TAIL and _strip_wa(rest[2]) not in _NEG_TAIL \
            and not rest[2].isdigit():
        return True
    return bool(rest) and not rest[0].isdigit() and _strip_wa(rest[0]) not in _NEG_TAIL and rest[0] not in _NEG_TAIL


def _negated_after(nxt: list[str], fact: str) -> int:
    """How many words after the token belong to a post-negation («غير راكب», «لا», «لا يوجد», «0»), else 0."""
    for skip in (0, 1):                      # one descriptor may sit between: «مطبخ عربي غير راكب», «الضمانات ومدتها لا يوجد»
        w = nxt[skip:]
        # A «و»-joined FIXTURE co-subject shares the «غير راكب» verdict (🔬 2026-11-03, manzo 21173178 «المكيفات والمطبخ:
        # غير راكبة» served the ACs as yes): only for the not-installed facts, only «غير راكب/مركب», only one «و» word.
        if (skip and nxt and fact in _POST_NOT_FACT and nxt[0].startswith("و") and _strip_wa(nxt[0].rstrip(":")) in _LIST_WORDS
                and len(w) >= 2 and w[0] == "غير" and _starts(w[1], tuple(_n(x) for x in _POST_NOT_FACT[fact]))):
            return skip + 2
        if skip and (not nxt or _strip_wa(nxt[0]) in _LIST_WORDS or nxt[0].isdigit() or nxt[0] in _FORM_LABELS):
            break
        if (fact == "furnished" and len(w) >= 3 and w[0] == "غير" and w[1] in ("شامل", "شامله", "مشمول")
                and w[2].startswith("ال")):
            return 0                         # «مؤثثة بالكامل غير شامل الجاكوزي» (🔬 2026-11-05): the jacuzzi is not included
        if len(w) >= 2 and w[0] == "غير" and _starts(w[1], _POST_NOT + tuple(_n(x) for x in _POST_NOT_FACT.get(fact, ()))):
            return skip + 2
        if len(w) >= 1 and w[0] in ("لايوجد", "لاتوجد"):
            return 0 if skip and _affirmed(nxt[0], fact) and _negates_next_item(w[1:]) else skip + 1
        # «مطبخ: (لم يُركب وقيمته على المستأجر …)» (dealapp 22700725, 2026-11-05 two-way sample): «not fitted» is a no
        if len(w) >= 2 and w[0] == "لم" and _starts(w[1], ("يركب", "تركب", "يتم", "يتوفر", "تتوفر", "يوجد", "توجد")):
            return skip + 2
        if len(w) >= 2 and w[0] == "لا" and w[1] in ("يوجد", "توجد", "يتوفر", "تتوفر"):
            return 0 if skip and _affirmed(nxt[0], fact) and _negates_next_item(w[2:]) else skip + 2
        if len(w) >= 1 and w[0] == "لا" and (len(w) == 1 or w[1] == "غير"):
            return skip + 1
        if not skip and w and (w[0] in ("0", "no", "none") or (fact == "furnished" and w[0] == "unfurnished")):
            return 1                         # «Furnished: Unfurnished» (manzo 21173202): the label's value speaks
    return 0


# A DISTRICT NAME IS NOT A FACT (🔬 2026-11-02): «حي الخزان» read water_tank = yes, «حي الحديقة» garden, «حي المستودعات»
# storage, «حي الشرفة» balcony — ~100 ads on 9+ sites, every one in that district. The word right before the token
# says it is a place: «حي» with its glued prepositions. (Jeddah's «مشرفة» is the glued case, N._inside_a_name.)
_DISTRICT_WORDS = frozenset(_n(w) for w in ("حي", "بحي", "وحي", "لحي", "فحي", "وبحي", "بالحي", "الحي"))


_LEAD_VERB_FACTS = frozenset({"shops_inside", "offices_inside", "apartments_inside"})
_LEAD_VERBS = frozenset(_n(w) for w in ("يوجد", "توجد", "فيه", "فيها", "به", "بها", "يحتوي", "تحتوي", "يضم", "تضم"))
_EXIST_VERBS = frozenset(_n(w) for w in ("يوجد", "توجد", "يحتوي", "تحتوي", "يضم", "تضم"))


def _judge(fact: str, t: str, s: int, e: int, forced: Optional[bool], n_words: int,
           cue_in: bool = False, near_in: bool = False, list_in: bool = False) -> tuple[Optional[bool], int, int]:
    """The outcome of ONE token hit: (True|False|None, quote start, quote end) in the normalised clause.
    cue_in / near_in: the clause before carried a utility list / a «nearby» heading on into this one."""
    ws, we = _word_bounds(t, s, e)
    prev = t[:ws].split()
    nxt = t[we:].split()
    head = t[ws:s]                                   # the glued part of the word before a loose hit
    if fact == "balcony" and N._inside_a_name(t, s, t[s:e]):
        return None, s, e
    if prev and prev[-1] in _DISTRICT_WORDS:         # «حي الخزان», «بحي الحديقة»: the ad's district, not a fact (🔬 11-02)
        return None, s, e
    if fact == "majlis" and nxt[:1] and nxt[0] in ("طعام", "الطعام"):   # «مجلس طعام» is the dining_majlis fact
        return None, s, e
    if fact == "warranty":
        word = t[ws:we]
        if word in ("لضمان", "ولضمان"):              # «لضمان الخصوصية» = "to ensure", not a warranty
            return None, s, e
        lab = 2 if nxt[:2] == ["و", "مدتها"] else 1 if nxt[:1] == ["ومدتها"] else 0
        if lab:                                      # the REGA form LABEL «الضمانات ومدتها: …» — only its value speaks
            v = nxt[lab:]
            if v[:1] and v[0] in ("لا", "لايوجد", "لاتوجد", "no", "none"):
                n = lab + (2 if v[0] == "لا" and v[1:2] in (["يوجد"], ["توجد"]) else 1)
                return False, ws, we + len(" ".join([""] + nxt[:n]))
            if v[:1] and (v[0][:1].isdigit() or _starts(v[0], ("متوفر", "يوجد", "توجد", "موجود", "متاح", "ضمان", "yes"))):
                return True, ws, we + len(" ".join([""] + nxt[:lab + 1]))   # AI teacher pass 2026-10-27
            return None, s, e                        # «-», empty, or a value whose own words say what it is
    # guards read words without a glued count: «2دورات مياه» is still a bathroom (offsets keep `prev`)
    gp = [w.lstrip(_DIGITS) or w for w in prev]
    gn = [w.lstrip(_DIGITS) or w for w in nxt]
    p2, n2 = gp[-2:], gn[:2]
    # a PUBLIC place keeps the old reading: «خدمات سيرا على الاقدام مثل بقالة … ومقهى السعر قابل للتفاوض» is a nearby café
    neg = (lambda ws_: ws_) if fact in _PUBLIC_FACTS or fact in _NEAR_PUBLIC_FACTS else _not_negotiable
    if fact in _PERMIT_FACTS:                       # «لا يمكن تأجير عزاب» / «مايمكن للعزاب»: «cannot» is an explicit no
        w3 = [_strip_wa(w) for w in gp[-3:]]
        if any(w in ("مايمكن", "مايصلح") or (w in ("يمكن", "ممكن", "يصلح") and k > 0 and w3[k - 1] in ("لا", "ما", "غير"))
               for k, w in enumerate(w3)):
            return False, ws, we
    public = fact in _PUBLIC_FACTS or fact in _NEAR_PUBLIC_FACTS   # public places keep the strict window (precision first)
    # …except the POOL, which reads «prepared» like the home's own facts: in «مسبح تأسيس مصعد» / «مسبح مؤسس مصعد» the
    # «تأسيس» governs the elevator after it, not the pool before (🔬 2026-11-06 two-way sample, aqar 17595 / 83389)
    public = public and fact != "pool"
    if (any(_starts(w, _PREPARED) for w in gp[-2:] + gn[:2]) if public
            else _prepared_applies(neg(gp[-3:] + [""])[:-1], neg(gn[:4]), t[ws:we])) or "prepared for" in " ".join(n2):
        return None, s, e
    # «مصعد جاهز أو تأسيس مرحلة أولى حسب تجهيز الوحدة» (aqarcity 9340308, 🔬 2026-11-14): installed OR only prepared,
    # depending on the unit — neither is stated, so silent. Only an «أو» right before a prepared word, within 3 words.
    if any(gn[k] in ("او", "أو") and _starts(_strip_wa(gn[k + 1]), _PREPARED) for k in range(min(3, len(gn) - 1))):
        return None, s, e
    if fact in _PLACE_FACTS and any(_starts(w, _PREPARED_PLACE) and not _strip_wa(w).startswith(_n("مكانس")) for w in p2):
        return None, s, e
    g5 = " ".join(gp[-5:])                           # «توجد رخصة بناء تسوير وملاحق»: allowed to build ≠ built
    w5 = gp[-5:]
    pk = max((k for k, w in enumerate(w5) if _strip_wa(w) in ("رخصه", "تصريح", "يسمح", "مسموح")), default=-1)
    has_after = pk >= 0 and any(w.startswith("و") and _strip_wa(w) in _HAS_CUES for w in w5[pk + 1:])
    if (pk >= 0 and not has_after) and "اعلان" not in g5 and "فال" not in g5 \
            or "نظام البناء" in g5:
        return None, s, e                            # …but «عليها رخصة انشاء وبها قسم معزول بمسبح»: «وبها» says the
                                                     # plot HAS it (🔬 2026-11-13 pool recall, aqar 27587225)
    # A floor covering usually comes with its proclitic: «سطح مفروش بنجيل», «مفروشة بالموكيت», «حوش مفروش بالعشب»
    # (dealapp 438767 / 598307 / 493432 served furnished = yes, 2026-11-04) — so the word is read bare too.
    if fact == "furnished" and (any(_starts(w, _PARTIAL) or _starts(_bare(w), _PARTIAL) for w in n2)
                                or any(_starts(w, _PARTIAL_BEFORE) for w in prev[-1:])):
        return None, s, e
    p5 = _drop_walk_facility(gp[-5:])
    # «قريب من الخدمات» is a COMPLETE item: the near word's object is «the services», so the words after it are the unit's
    # own (🔬 2026-11-04, muhaysini 14819114 «مميزات العقار موقع قريب من الخدمات موقف سيارات مصعد غرفة غسيل», 14817077
    # «وقريب من الخدمات مدخلان للشقة مصعدين متوفر»: the lift and the parking read as nearby — 6 of 25 sampled
    # unbacked elevator yeses were real). Unit facts only: a PUBLIC place keeps every nearby check below.
    if fact not in _NEAR_PUBLIC_FACTS and fact not in _PUBLIC_FACTS:
        at = max((k for k, w in enumerate(p5) if _strip_wa(w) in _NEAR_WORDS or w in _NEAR_WORDS), default=-1)
        if at >= 0 and any(_strip_wa(w) in _SERVICES_OBJECT or _strip_wa(w) in _UNIT_AGAIN for w in p5[at + 1:]):
            p5 = p5[at + 1:]
    near5 = [w for w in p5 if _strip_wa(w) in _NEAR_WORDS or w in _NEAR_WORDS]
    # …and the POOL a room overlooks is the home's (🔬 2026-11-06 two-way sample: 8 of 25 aqar villas that say «صالة كبيرة
    # مطلة على المسبح», «إطلالة مباشرة على المسبح», «ملحق كبير مطل على المسبح» served no pool) — a public pool is rare;
    # a public SEA / PARK / mosque view stays nearby, those facts are not here.
    if (fact in _UNIT_ROOMS or (fact in _POOL_FACTS and not any(p5[k] in _VIEW_NEG and (_strip_wa(p5[k + 1]) in _VIEW_WORDS or p5[k + 1] in _VIEW_WORDS)
                                                 for k in range(len(p5) - 1))
                                and not any(_strip_wa(w) in _PUBLIC_POOL for w in gn[:2]))) \
            and near5 and all(_strip_wa(w) in _VIEW_WORDS or w in _VIEW_WORDS for w in near5):
        p5 = [w for w in p5 if w not in near5]       # a view word next to the home's own room says nothing about the room
    # «… محطة المترو ٧ دقائق موقف خاص» (dealapp 23282670, 🔬 2026-11-06): «خاص» right after the parking makes it the
    # home's own — the distance list before it no longer reaches it. Parking only; «موقف عام» stays nearby.
    own_parking = (fact == "parking" and bool(gn[:1]) and _strip_wa(gn[0]) in ("خاص", "خاصه", "مستقل", "مستقله", "مخصص")
                   and not any(_strip_wa(w) in ("تابع", "تابعه", "يتبع", "تتبع") for w in gn[1:3])   # «… تابع للمسجد»: the place's
                   and not (gp[-1:] and (gp[-1] in ("من", "عن")                # «قريب من موقف خاص»: still the near word's object
                                         or _n(gp[-1]) in _GOVERNS_NEAR))   # «بجوار موقف خاص»; «٧ دقائق موقف خاص» stays own
                   and not (gn[1:2] and gn[1].startswith(("بال", "لل"))          # «مواقف خاصة بالمول»: another place's,
                            and not _starts(_bare_l(gn[1][1:] if gn[1].startswith("ب") else gn[1]),
                                            ("شقه", "فيلا", "فله", "وحده", "عماره", "مبني", "دور", "منزل", "بيت", "سكن",
                                             "عقار", "سكان", "ساكن", "مستاجر"))))  # but «موقف خاص بالشقة» is the home's
    if not own_parking and fact not in _NEAR_NEVER_FACTS and (any(_strip_wa(w) in _NEAR_WORDS or w in _NEAR_WORDS for w in p5)
                                          or any(p in " ".join(p5) for p in _NEAR_PHRASES)
                                          or _DISTANCE_TO.search(" ".join(gp[-8:]))):
        return None, s, e
    # …but an item the ad gives to the home («نادي رياضي مستقل للفيلا») is not the list's, whatever list it sits in
    if fact in _NEAR_PUBLIC_FACTS and ((list_in and not _owned_after(gn))
                                       or any(_strip_wa(w) in _NEAR_PUBLIC or w in _NEAR_PUBLIC for w in p5)):
        return None, s, e
    if fact in _NEAR_PUBLIC_FACTS:
        # a near word up to 9 words back in the same clause («قريب من الدانوب و لولو هايبر ماركت»), unless the ad says it
        # owns the place after that word («قريب من الخدمات ويوجد بالمجمع مسجد»)
        w9 = _drop_walk_facility(gp[-9:])
        at = max((k for k, w in enumerate(w9) if _strip_wa(w) in _NEAR_WORDS or w in _NEAR_WORDS
                  or _strip_wa(w) in _NEAR_PUBLIC or w in _NEAR_PUBLIC), default=-1)
        if at >= 0 and not any(_starts(_strip_wa(w), _OWN_CUES) for k, w in enumerate(w9[at + 1:], at + 1)
                               if k != _near_object_at(w9, at)):
            return None, s, e
    if fact in _NEAR_PUBLIC_FACTS:
        w4 = gp[-4:]
        at = max((k for k, w in enumerate(w4) if _is_boundary(w)), default=-1)
        if at >= 0 and not any(_starts(w, _HAS_CUES) or _starts(_strip_wa(w), _HAS_CUES) for w in w4[at + 1:]) \
                and not _owned_after(gn):   # «واجهة شمالية ونادي رياضي خاص» is the home's; «خاص بالحي» is not
            return None, s, e
    if fact in _PURE_PUBLIC_FACTS:
        w8 = [_strip_wa(w) for w in gp[-8:]]
        if any(w in _AREA_WORDS or "ال" + w in _AREA_WORDS for w in w8) and any(_starts(w, _SERVICE_WORDS) for w in w8) \
                and not any(_starts(w, _OWN_CUES) for w in w8):
            return None, s, e
    n3 = gn[:3]                                      # English puts it AFTER: «car park nearby», «pool and gym nearby»
    if "nearby" in n3 or "close by" in " ".join(n3):
        return None, s, e
    distance_after = any(" ".join(gn[:3]).startswith(d) or " ".join(gn[1:3]).startswith(d) for d in _DISTANCE_AFTER) \
        and not (gn[:1] and _strip_wa(gn[0]) in ("خاص", "خاصه", "مستقل", "مستقله", "داخلي", "داخليه"))
    near_after = False
    for w in gn[:4]:                                 # «مسبح خاص على بعد دقائق من البحر»: the unit's own pool — an ownership
        if _starts(_strip_wa(w), _OWN_CUES):         # word before the distance ends the look-ahead
            break
        if _strip_wa(w) in ("موقع", "الموقع", "موقعه", "موقعها", "موقعنا"):
            break                                    # «موقف سياره 🚗 موقع مميز قريب من الخدمات»: a new subject (dealapp 7439621)
        if _strip_wa(w) in ("سعر", "السعر", "سعرها", "سعره", "سوم", "السوم", "بيع", "البيع", "للبيع", "ايجار", "الايجار", "للايجار"):
            break                                    # «ومسبح السوم مليون والبيع قريب»: the price / sale is the new subject (🔬 11-06)
        if _starts(w, _NEAR_AFTER):
            near_after = True
            break
    if fact in _PUBLIC_FACTS and (near_after or distance_after or (near_in and n_words <= 3)):
        return None, s, e
    ex_before, ex_after = _EXCLUDE.get(fact, ((), ()))
    if fact in _METER_FACTS and "عداد" in t[ws:e]:
        ex_before = ()                               # «خزانات وعدادات مستقلة» names the meter itself
    if fact == "kitchen" and p2 and _starts(_strip_wa(p2[-1]), ("سطح", "اسطح")):
        return None, s, e                            # «سطح مطبخ» / «أسطح المطبخ» is a countertop
    if fact == "corner_plot" and _n(t[ws:we]).lstrip("و").startswith("للزاوي"):
        return None, s, e                            # «مليون و٣٥٠ للزاوية», «سعر موحد للزاوية والشارع»: the price of a
                                                     # project's corner unit, not this ad's plot (P2 13085, 2026-11-06)
    if fact == "corner_plot" and p2 and _strip_wa(p2[-1]) in (_n("سعر"), _n("السعر"), _n("سوم"), _n("السوم")):
        return None, s, e                            # «سعر الزاوية/مليون و 50 الف … سعر البطن/مليون» (hajer 10674101,
                                                     # 🔬 2026-11-11): the corner UNIT's price among several units
    if fact == "laundry_room" and p2 and p2[-1] in ("حي", "بحي", "العدل"):
        return None, s, e                            # «حي العدل الغسالة»: a Makkah district, not a washing machine
    if fact in ("kitchen", "laundry_room") and p2 and _starts(_strip_wa(p2[-1]), (_n("مجهز"), _n("مهيا"), _n("مهيأ"))) \
            and _n(t[ws:we]).lstrip("و").startswith("ل"):
        return None, s, e                            # «ممر مجهز لمطبخ»: a space prepared FOR a kitchen, not a kitchen
                                                     # (P2 13085 «لمطبخ», aqar 5830, 🔬 2026-11-10). «مطبخ مجهز» stays a yes.
    if fact == "laundry_room" and p2 and _strip_wa(p2[-1]) in _WASHER_SPOT and "غسال" in _n(t[ws:we]):
        return None, s, e                            # «مجهز لموقع الغسالة», «ركن الغسالة», «مخرج الغسالة»: the washer's
                                                     # spot or hook-up, not a washing machine (P2 13085 «الغساله», aqar
                                                     # 71281 / 6477635, 🔬 2026-11-10)
    if fact == "earning_income" and (any(_strip_wa(w) in _FORECAST for w in gp[-3:])
                                     or any(_strip_wa(w.strip(":：")) in _FORECAST for w in gn[:3])):
        return None, s, e                            # «دخل شهري: متوقع للشقه بعد التاثيث», «فرص تحقيق دخل شهري»: a
                                                     # forecast, not income the property earns (P2 13085 «دخل شهري», aqar
                                                     # 113914 / 38786, 🔬 2026-11-10)
    if fact == "main_road" and (_n(t[ws:we]).endswith("الطريق") or (_n(t[ws:we]).endswith("طريق") and (not gn or gn[0].startswith("و")))) \
            and (_starts(_strip_wa(t[ws:we].split()[0]), tuple(_VIEW_WORDS)) or any(_strip_wa(w) in _VIEW_WORDS for w in p2)) \
            and not (gn[:1] and (gn[0] in _ROAD_NAMED or _strip_wa(gn[0]) in _ROAD_NAMED or "ال" + _strip_wa(gn[0]) in _ROAD_NAMED)):
        return None, s, e                            # «بلكونه (شرفه) مطلة على الطريق», «شقه … مطله على الطريق»: a view of
                                                     # «the road», not a plot on a main road (P2 13085, 5 of 5 aqar,
                                                     # 🔬 2026-11-11). «مطلة على الطريق الدائري» and «على طريق الملك فهد» stay.
    if fact == "all_services" and not _strip_wa(t[ws:we].split()[-1]).startswith(_n("مخدوم")) \
            and (gn[:1] and _strip_wa(gn[0]) in _SEPARATE
                                   or len(gn) >= 2 and _strip_wa(gn[0]) in _UNIT_NOUNS and _strip_wa(gn[1]) in _SEPARATE):
        return None, s, e                            # «كل خدمات الشقه مستقله / منفصلة»: separate utilities; «جميع
                                                     # الخدمات ومطبخ مستقل» keeps it — the kitchen is separate (CodeRabbit #11820);
                                                     # «أرض مخدومة مستقلة بصك» keeps it — «مستقلة» is the plot's (CodeRabbit #11820)
    if fact == "garden" and p2 and _strip_wa(p2[-1]) in ("شارع", "شارعين") and t[ws:we].startswith("و") \
            and not _owned_after(gn):
        return None, s, e                            # «أرض سكنية شارع وحديقة»: the plot's neighbours (aqar 3543112);
                                                     # «على شارع وبها حديقة خاصة» keeps its own (CodeRabbit on #11820)
    if fact == "all_services" and (any(_strip_wa(w) in _SERVICES_NOT_OWN for w in gp[-3:])
                                   or (any(_strip_wa(w) in _SERVICES_COVER for w in gp[-3:])
                                       and any(_strip_wa(w) in _BUILDING_NOUNS for w in gn[:2]))):
        return None, s, e                            # «ويشمل كل خدمات العمارة» (the rent covers the building's services),
                                                     # «منطقة مؤسس فيها كل خدمات التاون هاوس من خزان المياة» (a utility
                                                     # zone): neither says the home is connected (P1 14340, aqar 25431484 /
                                                     # 35244, 🔬 2026-11-13)
    if fact == "all_services" and not _strip_wa(t[ws:we].split()[-1]).startswith(_n("مخدوم")) and _near_later(gn[:4]):
        return None, s, e                            # «كل خدمات شمال الرياض قريبة»: the services NEAR it, read past the
                                                     # 2-word window (P1 14340, aqar 15134259, 🔬 2026-11-13)
    if fact in ("air_conditioner", "central_ac") \
            and _strip_wa(_n(t[ws:we]).split()[0]) in ("التكييف", "تكييف", "التكيف", "تكيف") \
            and any(_starts(_strip_wa(w), ("تمديد",)) for w in gp[-3:]) \
            and not any(_starts(_strip_wa(w), ("راكب", "مركب", "موجود", "متوفر", "يعمل", "شغال")) for w in gn[:3]):
        # only an INSTALLED word keeps the AC: «تكييف سبليت راكب» yes; «والتكييف المركزي» names a type, so pipework alone
        # stays silent (CodeRabbit #12178)
        return None, s, e                            # «خزان المياة وتمديدات السباكة و التكييف»: the AC PIPEWORK, not AC
                                                     # units (aqar 35244 / 7041221 / 9605735, 🔬 2026-11-13)
    if fact == "bills_included" and gn[:1] and _starts(_strip_wa(gn[0]), ("العقار", "عقار")):
        return None, s, e                            # «مكتب النطاق الشامل للخدمات العقاريه»: an office's NAME, not bills in
                                                     # the rent (P2 13085 «الشامل للخدمات», 4 of 4 aqar, 🔬 2026-11-13)
    if fact == "kitchen" and re.match(r"^(?:ل|لل)مطابخ", _n(t[ws:we]).lstrip("و")):
        return None, s, e                            # «معرض للمطابخ» (a showroom), «تكييف كاسيت للمطابخ», «مراوح شفط
                                                     # للمطابخ»: something FOR the kitchens, not a fitted kitchen (P2 13085
                                                     # «للمطابخ», 4 of 4 aqar, 🔬 2026-11-13; like «للحمامات» 11-09)
    if fact in ("optical_fibers", "internet") and ((p2 and p2[-1] == "glass") or (gn[:1] and gn[0] == "glass")
                                     or _n(t[ws:we]).startswith(("fiberglass", "fibreglass"))):
        return None, s, e                            # «أرضيات Glass Fiber», «fiber glass»: a building material, not optical
                                                     # fibre internet (P2 13085 «fiber», aqar 9561593, 🔬 2026-11-13)
    if fact == "for_events" and any(_strip_wa(w) in _EXCEPT_WORDS for w in gp[-4:]):
        return None, s, e                            # «للايجار الشهري عدا الإيجازات الدراسية ومناسبات الأعياد»: an
                                                     # exception to the rent, not events allowed (P1 14340, aqar 12109734)
    if fact == "for_events" and _n(t[ws:we]).startswith("و") and len(gp) >= 3 \
            and _strip_wa(gp[-3]) in ("قاعه", "صاله", "قاعات", "صالات"):
        return None, s, e                            # «قاعة استقبال ضيوف ومناسبات»: the compound's hall, named one word
                                                     # past the 2-word window (P1 14340, aqar 8853052, 🔬 2026-11-13)
    if fact == "for_events" and p2 and _strip_wa(p2[-1]) in ("غرف", "الغرف"):
        return None, s, e                            # «غرف مناسبات واسعة»: the building's event ROOMS — the plural only, so
                                                     # «غرفتين ومسموح للمناسبات» keeps its permission (CodeRabbit on #11820)
    if fact == "reception" and re.match(r"^(?:ل|لل)استقبال(?:ك|كم|كن|كي)$", _n(t[ws:we]).lstrip("و")):
        return None, s, e                            # «جاهزة لاستقبالك», «بيتك جاهز لاستقبالك»: «ready to welcome YOU»,
                                                     # marketing, never a reception desk (P2 13085, 5 of 5 aqar, 🔬 2026-11-09)
    if fact == "toilets_on_site" and _n(t[ws:we]).lstrip("و").startswith("للحمام"):
        return None, s, e                            # «عزل مائي للحمامات», «سخانات للحمامات والمطبخ», «السيراميك للحمامات»:
                                                     # work done FOR the home's own bathrooms, not toilets on the site
                                                     # (P2 13085, 5 of 5 aqar, 🔬 2026-11-09)
    if fact == "pumps" and _n(t[ws:we]).lstrip("و").startswith("بمضخه"):
        return None, s, e                            # «بمضخة» = equipped WITH a pump: the pool's, well's, tank's or fire
                                                     # system's («مسبح … بمضخه وفلتر», «بئر ارتوازي بمضخة», «خزان … مزود
                                                     # بمضخة سكالا», «نظام إطفاء … بمضخة») — never a station's fuel pumps
                                                     # (P1 13301, 7 served ads, 2026-11-06; a station says «N مضخات»)
    if fact == "air_conditioner" and ("مكيفات" in t[ws:we] or _strip_wa(t[ws:we]) in ("تكييف", "تكيف")):
        ex_before = ()                               # «مدخلان🔹 مكيفات راكبة», «مدخلان للشقة تكييف سبيلت»: the home's; a lobby is «مدخل مكيف»
    if fact in _NEEDS_CUE and p2 and _starts(p2[-1], _CUES):
        ex_before, ex0 = (), ex_before               # «3 غرف واصل كهرباء»: the cue sits between (AI teacher pass 2026-10-27)
        if _starts(p2[-1], ("عداد",)):
            if _negated_before(prev[:-1]) is not None or head in ("غير",):
                return None, s, e                    # «لا يوجد عداد ماء»: a missing meter is not «no water»
            if any(_starts(_strip_wa(w), ex0) or _starts(w, ex0) for w in p2[:-1]):
                return None, s, e                    # «رسوم / تأسيس / توصيل عداد كهرباء»: a fee or a set-up, not a supply
    if fact == "furnished" and p2 and _strip_wa(p2[-1].strip("()[]:-")) in _KITCHEN_WORDS \
            and not _n(t[ws:we]).rstrip("()[]:-.").endswith("ه"):
        return None, s, e                            # «مطبخ ماثث», «مطبخ ( مأثث) بدون اجهزة»: the KITCHEN is fitted, the
                                                     # home is not said to be furnished (P2 13085 «ماثث», haraj 20944851,
                                                     # aqarcity 17945592, 🔬 2026-11-14). The FEMININE «ومطبخ مفروشه
                                                     # بالكامل» agrees with the flat, not the (masculine) kitchen: kept
                                                     # (propertyfinder 23820293, aqar 14850742, aqarmonthly 7060038)
    if any(_starts(_strip_wa(w), ex_before) or _starts(w, ex_before) or _starts(_bare(w), ex_before) for w in p2) or \
            any(_starts(w, ex_after) for w in n2) or any(x in " ".join(n2) for x in ex_after if " " in x):
        return None, s, e
    if fact in _NEEDS_CUE and not (any(_starts(w, _CUES) for w in gp[-3:] + gn[:1]) or n_words <= 3
                                   or (cue_in and not prev)):
        return None, s, e
    if forced is not None:
        return forced, ws, we
    if fact in _PERMIT_FACTS and any(_strip_wa(w).startswith("ممنوع") for w in gp[-3:]):
        return False, ws, we                         # «ممنوع العزاب»: the bare word's own no (the forced regex agrees)
    if _billing_not_supply(fact, prev, nxt):
        return None, s, e
    if head in ("un", "غير") or head.endswith("غير"):
        return False, ws, we
    # A FORM VALUE decides its own label (🔬 2026-11-05, dealapp 22700725 «❄️ مكيفات: (لايوجد) 🚗 موقف سيارة: (نعم )»):
    # the «لايوجد» belongs to the ACs before, and «نعم» right after the item is the item's own yes.
    if any(_strip_wa(w) == "نعم" for w in gn[:2]) and not _negated_after(nxt, fact):
        return True, ws, we + len(" ".join([""] + nxt[:1 + [_strip_wa(w) for w in gn[:2]].index("نعم")]))
    # A NEGATED LEAD VERB (🔬 2026-11-07, two-way sample): the shops / offices / apartments regexes START with the verb
    # («يوجد محلات», «فيها محلات», «تحتوي على محلات»), so the «لا / ما» before it was alone in `prev` and «لا يوجد
    # محلات» was served as a YES. The look-back now sees the verb too; «كما يوجد محلات» is not a negation.
    lead = t[s:e].split()[:1]
    if fact in _LEAD_VERB_FACTS and lead and _strip_wa(lead[0]) in _LEAD_VERBS and prev:
        nb = _negated_before(prev + [lead[0]])
        # the negator RIGHT before the verb: «لا يوجد» (two words) or a one-word negator «ليس يضم» (CodeRabbit on #11068)
        if nb == 2 or (prev and (prev[-1] in _NEG1 or _strip_wa(prev[-1]) in _NEG1)):
            qs = len(" ".join(prev[:-1])) + (1 if len(prev) > 1 else 0)
            return False, qs, we
    # …and an un-negated EXISTENCE verb that opens the match affirms it: «لا يوجد مصعد ويوجد محلات» has shops (the old
    # look-back walked past «مصعد» to the lift's «لا يوجد»). Prepositions keep the look-back: «لا يوجد بها محلات» is a no.
    verb_affirms = fact in _LEAD_VERB_FACTS and bool(lead) and _strip_wa(lead[0]) in _EXIST_VERBS
    if fact in _UNIT_ROOMS and prev and _strip_wa(prev[-1].strip("(")) in _EXCEPT_WORDS and "غسال" not in _n(t[ws:we]) \
            and (fwd_ex := _negated_after(nxt, fact)):
        # «باستثناء المطبخ غير راكب»: the room's OWN trailing verdict is the evidence, never the exception word
        # (CodeRabbit #12178: the quote read «باستثناء المطبخ»)
        return False, ws, we + len(" ".join([""] + nxt[:fwd_ex]))
    if fact in _UNIT_ROOMS and prev and _strip_wa(prev[-1].strip("(")) in _EXCEPT_WORDS and "غسال" not in _n(t[ws:we]):
        return None, s, e                            # «مكيفات مخفية (ماعدا غرفة السائق … مكيفات سبيلت)», «جميع الغرف
                                                     # ماعدا غرفة السائق»: the room EXISTS — it is the exception to
                                                     # something else, never a «no» (aqar 14875791, 21286, 17657272,
                                                     # 🔬 2026-11-13). An APPLIANCE stays a no: «جميع الاجهزه ماعدا
                                                     # الثلاجة وغسالة الملابس» (aqar 71606) has no washer.
    back = None if verb_affirms else _negated_before(prev)
    if back is not None:
        qs = len(" ".join(prev[:len(prev) - back])) + (1 if len(prev) > back else 0)
        return False, qs, we
    fwd = _negated_after(nxt, fact)
    if fwd:
        tail = we + len(" ".join([""] + nxt[:fwd]))
        return False, ws, tail
    return True, ws, we


# ── numbers ───────────────────────────────────────────────────────────────────────────────────────────────
_BEARING = r"(?:ال)?(?:شمال|جنوب|شرق|غرب)(?:ي|يه|ا)?"
_UNIT = r"(?:م|متر|مترا|ميتر|m)"
_SH = r"(?:ب|ال|بال|و|وال)?شارع"
_STREET_RES = (
    re.compile(rf"عرض (?:ال)?شارع ?(\d{{1,3}})(?: ?{_UNIT})?(?!\w)"),
    re.compile(rf"(?:(?<= )|^){_SH} (?:بعرض ?|عرض ?|عرضه ?)?(\d{{1,3}}) ?{_UNIT}(?!\w)(?: ({_BEARING})(?!\w))?"),
    re.compile(rf"(?:(?<= )|^){_SH} (?:بعرض ?|عرض ?)?(\d{{1,3}}) ({_BEARING})(?!\w)"),
    re.compile(rf"(?:(?<= )|^){_SH} (?:بعرض|عرض) ?(\d{{1,3}})(?!\w)"),
    re.compile(rf"(?:(?<= )|^){_SH} ({_BEARING}) (?:بعرض ?|عرض ?)?(\d{{1,3}})(?: ?{_UNIT})?(?!\w)"),
    re.compile(rf"(?:(?<= )|^)({_BEARING}) (?:بعرض|عرض) ?(\d{{1,3}}) ?{_UNIT}(?!\w)"),
    re.compile(r"(\d{1,3}) ?m (?:wide |width )?street|street width (?:of )?(\d{1,3})"),
)
_WASALT_WIDTH = re.compile(rf"بعرض ?(\d{{1,3}}) ?{_UNIT}(?!\w)")
_CORNER = re.compile(r"(?:(?<= )|^)(?:وال|ال|و|ب|علي )?(?:زاويه|زاوية|ركنيه|ركني|شارعين|شارعان|ثلاث شوارع|ثلاثه شوارع|"
                     r"اربع شوارع|اربعه شوارع|[2-4] شوارع|corner)(?!\w)")
_N_STREETS = re.compile(r"يحدها ([2-9]) شارع")

_WORD_NUM = {"واحد": 1, "واحده": 1, "دورتين": 2, "دورتان": 2, "دورتا": 2, "دورتي": 2, "حمامين": 2, "حمامان": 2, "دورين": 2, "دوران": 2, "طابقين": 2, "شقتين": 2, "شقتان": 2, "محلين": 2, "محلان": 2,
             "ثلاث": 3, "ثلاثه": 3, "اربع": 4, "اربعه": 4, "خمس": 5, "خمسه": 5, "ست": 6, "سته": 6, "سبع": 7,
             "سبعه": 7, "ثمان": 8, "ثماني": 8, "ثمانيه": 8, "تسع": 9, "تسعه": 9, "عشر": 10, "عشره": 10}
_EN_NUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
           "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
           "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20}
_NUMW = r"(ثلاث|ثلاثه|اربع|اربعه|خمس|خمسه|ست|سته|سبع|سبعه|ثمان|ثماني|ثمانيه|تسع|تسعه|عشر|عشره)"
_COUNT_RES: dict[str, tuple[re.Pattern[str], ...]] = {
    "floors": (
        re.compile(r"عدد (?:ال)?(?:ادوار|ادور|طوابق) ?(\d{1,2})(?!\w)"),
        re.compile(r"عدد (?:ال)?(?:ادوار|ادور|طوابق) (دور|دورين|دوران|ثلاث|ثلاثه|اربع|اربعه|خمس|خمسه)(?!\w)"),
        re.compile(r"(?:(?<= )|^)(\d{1,2}) ?(?:ادوار|ادور|طوابق)(?!\w)"),
        re.compile(rf"(?:(?<= )|^){_NUMW} (?:ادوار|ادور|طوابق)(?!\w)"),
        re.compile(r"(?:(?<= )|^)(?:ال|و|وال|ب)?(دورين|دوران|طابقين)(?!\w)"),
        re.compile(r"(?:(?<= )|^)(?:من )?دور (واحد)(?!\w)"),
    ),
    "apartments_count": (
        re.compile(r"عدد (?:ال)?(?:شقق|وحدات)(?: (?:ال)?سكنيه)? ?(\d{1,3})(?!\w)"),
        re.compile(r"(?:(?<= )|^)(\d{1,3}) ?شقق(?!\w)"),
        re.compile(r"(?:(?<= )|^)(\d{2,3}) ?شقه(?!\w)"),
        re.compile(rf"(?:(?<= )|^){_NUMW} شقق(?!\w)"),
        re.compile(r"(?:مكون|مكونه|تتكون|يتكون|تضم|يضم|تحتوي|يحتوي)(?: من)? (\d{1,3}) ?(?:شقق|شقه|وحدات|وحده)(?!\w)"),
        re.compile(r"(?:مكون|مكونه|تتكون|يتكون|تضم|يضم|تحتوي|يحتوي)(?: من)? (شقتين|شقتان)(?!\w)"),
    ),
    # BATHROOMS (backlog 1168, owner 2026-11-02: every ad in «الشقق والسكن المشترك» states it, we must carry it).
    # Proven on the sites' own pages: aqar 6863619 «ثلاث دورات مياه», muhaysini 6040 «دورتا مياه (2)», dealapp 586613
    # «دورتين مياه». A pool («حمام سباحه»), an outside toilet and a per-unit count are skipped below (_BATH_SKIP_AFTER).
    "bathrooms": (
        re.compile(r"عدد (?:ال)?(?:حمامات|دورات (?:ال)?مياه) ?(\d{1,2})(?!\w)"),
        # 🔬 2026-11-05 yearly-rent bathroom audit: the label with its value and no «عدد» — wasalt 481847 «الحمامات ٥»,
        # muhaysini «الحمامات: 3». Not a number that belongs to the next item («الحمامات 3 غرف»).
        re.compile(r"(?:(?<= )|^)ال(?:حمامات|دورات (?:ال)?مياه) (\d{1,2})(?!\w)(?! ?(?:غرف|غرفه|غرفة|صال|مطبخ|مطابخ|مجلس|مجالس|دور|ادوار|م |متر|شقق|شقه|محل|مكيف))"),
        re.compile(r"(?:(?<= )|^)و?(\d{1,2}) ?(?:دورات|دوره) (?:ال)?مياه(?!\w)"),
        re.compile(r"(?:(?<= )|^)و?(\d{1,2}) ?(?:حمامات|حمام)(?!\w)"),
        re.compile(rf"(?:(?<= )|^)و?{_NUMW} (?:دورات (?:ال)?مياه|حمامات)(?!\w)"),
        re.compile(r"(?:(?<= )|^)(?:ال|و|وال|ب)?(دورتين|دورتان|دورتا|دورتي|دورين|دوران) (?:ال)?مياه(?!\w)"),
        re.compile(r"(?:(?<= )|^)(?:ال|و|وال|ب)?(حمامين|حمامان)(?!\w)"),
        re.compile(r"(?:(?<= )|^)(?:دوره (?:ال)?مياه|حمام) (واحد|واحده)(?!\w)"),
    ),
    "shops_count": (
        re.compile(r"عدد (?:ال)?(?:محلات|معارض|فتحات)(?: (?:ال)?تجاريه)? ?(\d{1,3})(?!\w)"),
        re.compile(r"(?:(?<= )|^)(\d{1,3}) ?(?:محلات|معارض|فتحات)(?!\w)"),
        re.compile(r"(?:(?<= )|^)(\d{2,3}) ?محل(?!\w)"),
        re.compile(rf"(?:(?<= )|^){_NUMW} (?:محلات|معارض|فتحات)(?!\w)"),
        re.compile(r"(?:(?<= )|^)(?:عدد )?(محلين|محلان)(?!\w)"),
    ),
}
_COUNT_RANGE = {"floors": (1, 60), "apartments_count": (2, 500), "shops_count": (1, 300), "bathrooms": (1, 20)}
# one UN-numbered bathroom («دورة مياه»), singular: alongside a counted one it makes the stated count incomplete
_BATH_BARE = re.compile(r"(?:(?<= )|^)(?:ال|و|وال|ب|ل)?دوره (?:ال)?مياه(?!\w)")
# the span of a labelled bathroom total: «عدد دورات المياه 3» / «الحمامات ٥» (the first two bathroom patterns)
_BATH_LABEL = re.compile(r"(?:عدد |ال(?:حمامات|دورات))")
# a pool, an outside / annex toilet, or a per-unit / per-room count is not the home's bathroom count
_BATH_SKIP_AFTER = ("سباح", "خارج", "بالخارج", "ملحق", "بالملحق", "بالحوش", "بالسطح", "للسائق", "السائق", "بكل", "لكل",
                    "في كل", "كل شقه", "كل غرفه", "مشترك")
# a per-floor count or an availability count is not the building's count
_COUNT_SKIP_AFTER = ("كل دور", "بكل دور", "لكل دور", "في الدور", "بالدور", "متاح", "متوفر", "للايجار", "للبيع",
                     "شاغر", "مؤجر", "ماجر", "مستاجر", "ونصف")
_AGE_EXTRA = re.compile(r"(?:(?<= )|^)و?(?:عمره|عمرها|عمر (?:ال)?(?:عقار|عماره|فيلا|فله|بيت|منزل|مبني|بناء|شقه)) ?(\d{1,2}) ?"
                        r"(?:سنه|سنوات|سنين|عام|اعوام)(?!\w)")
_AGE_EN = re.compile(r"(?:العمر|عمر (?:ال)?عقار) (one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|"
                     r"fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty) ?years?(?!\w)")
_AGE_OPEN = re.compile(r"اكثر من|فوق|يتجاوز|تجاوز|اقل من|حوالي|تقريبا|\+")
_BOUNDARY_LABEL = re.compile(r"(?:ال)?(?:اطوال|ابعاد|اضلاع|مقاسات|حدود)(?: (?:ال)?(?:قطعه|ارض|الارض|القطعه))? ?"
                             r"((?:\d{1,4} ?(?:م|متر)? ?(?:x|في|و|بطول|عمق)? ?){2,8})")
_BOUND_SIDE = re.compile(rf"({_BEARING}) [^ ]*(?: [^ ]+){{0,5}}? بطول ?(\d{{1,4}})")


# PDPL: a person's name in a quote or a value («ملك فلان بن فلان» in a boundaries cell) drops the WHOLE row —
# the sanitizer strips phones and kunyas, not «بن / ابن / بنت / آل» names (raghdan boundaries, 2026-10-25).
# A street, mosque or school named after a person keeps its row: «شارع … بن …» within four words.
_NAME_MARKS = frozenset({"بن", "ابن", "بنت", "ال"})       # «آل» folds to «ال»; the article never stands alone
_NAMED_PLACES = tuple(_n(w) for w in ("شارع", "طريق", "ميدان", "دوار", "جسر", "مسجد", "جامع", "مدرسة", "مستشفى",
                                       "حي", "مخطط", "مجمع", "مركز", "جامعة", "كلية", "برج"))


def names_a_person(text: str) -> bool:
    w = norm(text).split()
    return any(x in _NAME_MARKS and i + 1 < len(w)
               and not any(_strip_wa(p).startswith(_NAMED_PLACES) or p.startswith(_NAMED_PLACES)
                           for p in w[max(0, i - 4):i])
               for i, x in enumerate(w))


# «… مثل المياه وتكييف الهواء ومواقف السيارات، حيث لم يتم ذكرها في العرض» (muhaysini, 89 of 19,816 ads):
# the ad says these were NOT stated — that clause and the list right before it are silent (bench-v3).
_NOT_STATED = tuple(_n(w) for w in ("لم يتم ذكر", "لم يذكر", "لم تذكر", "غير مذكور", "not mentioned", "not stated"))


class Hit:
    __slots__ = ("fact", "value", "s", "e", "clause")

    def __init__(self, fact: str, value: Any, s: int, e: int, clause: int):
        self.fact, self.value, self.s, self.e, self.clause = fact, value, s, e, clause


# A spaced «*» is a bullet between items («* مدارس * سوبر ماركت»); «*المميزات:*» (bold) and «3*4» are not.
_STAR_BULLET_RE = re.compile(r"(?<=\s)\*+(?=\s)")


# The near phrase's OWN object is not an own cue (🔬 2026-11-07 two-way sample, aqar 12726261): in «قريبة من المرافق
# العامة: 🏫 مدارس 🏥 مستشفيات 🛍️ محلات تجارية» the «المرافق» is what the flat is near, not «مرافق المشروع», so the
# area's shops / market / mosque after it are the area's. Only that one word: «قريب من الخدمات ويوجد بالمجمع مسجد» still
# owns its mosque («يوجد»), and a second «مرافق» later in the clause still counts.
# «قريب من أهم الخدمات والمرافق🔥:- 🕌 مسجد 🌳 حديقة» (aqar 15006770 / 15017963, 🔬 2026-11-11 garden sample): «أهم / أبرز /
# كافة» before the services word is the same heading
_NEAR_OBJECT_SKIP = frozenset(_n(w) for w in ("من", "جميع", "كل", "لجميع", "لكل", "الى", "إلى", "ل", "جدا", "جداً",
                                              "اهم", "ابرز", "افضل", "كافه", "كافة", "مختلف"))


def _near_object_at(words: list[str], at: int) -> int:
    """Index of the near word's object in `words` (the first word after `at` past «من / جميع / كل»), when that object
    is a services word («الخدمات», «المرافق»); -1 otherwise."""
    k = at + 1
    while k < len(words) and _strip_wa(words[k]) in _NEAR_OBJECT_SKIP:
        k += 1
    return k if k < len(words) and (_strip_wa(words[k]) in _SERVICES_OBJECT or words[k] in _SERVICES_OBJECT) else -1


# A NEARBY-SERVICES HEADING names the AREA's places after it (🔬 2026-11-07, backlog 1507: of 19 real aqar served yeses
# after «قريب من … الخدمات», 9 were the area's): «بالقرب من جميع الخدمات التي تحتاجها، وتشمل: 🕌 جامع 🛒 سوبرماركت 🌿
# حديقة» (13447339), «قريبه من كل الخدمات /حديقة /مسجد.» (15125261), «بقربه من خدمات متعددة : حدائق / مدارس / مسجد»
# (15130356), «قريب جدا من الخدمات بشكل عام تموينات - محل غاز - مطعم» (8798208). The heading runs on through list
# separators («،», «/», «-», «•», emoji) and stops at «.», a new line or an own cue — «قريبه من الخدمات • يوجد نادي
# رياضي», «قريب من كل الخدمات *مع مرافق داخلية:* نادي رياضي», «خدمات الكامبوند نادي صحي» stay the ad's own.
_SVC_NEAR = frozenset(_NEAR_WORDS) | frozenset(_n(w) for w in ("القرب", "بقربه", "بقربها", "بقرب", "لقربه", "لقربها"))
_SVC_STOP = frozenset(_n(w) for w in ("المشروع", "للمشروع", "بالمشروع", "مشروع", "المجمع", "للمجمع", "بالمجمع", "مجمع",
                                      "الكامبوند", "الكمباوند", "كمباوند", "كامبوند", "بالكمباوند", "المبني", "العماره",
                                      "للعماره", "بالعماره", "للسكان"))


# «المبنى الآخر», «العمارة المجاورة»: ANOTHER building — its services are the area's, not the ad's (CodeRabbit on #11820)
_OTHER_PLACE = frozenset(_n(w) for w in ("الاخر", "الآخر", "الاخري", "الأخرى", "المجاور", "المجاوره", "المجاورة",
                                         "المقابل", "المقابله", "المقابلة"))


def _svc_heading_end(words: list[str]) -> int:
    """Index just past «<near word> من [جميع/كل] الخدمات/المرافق/خدمات …» in `words`, or -1."""
    for k, w in enumerate(words):
        if _strip_wa(w) in _SVC_NEAR or w in _SVC_NEAR:
            j = k + 1
            while j < len(words) and _strip_wa(words[j]) in _NEAR_OBJECT_SKIP:
                j += 1
            if j < len(words) and _starts(_strip_wa(words[j]), _SERVICES_OBJECT):
                # «الخدمات والمرافق» is ONE heading object: the «مرافق» joined to it is not «مرافق المشروع» (🔬 2026-11-11)
                while j + 1 < len(words) and words[j + 1].startswith("و") and _starts(_strip_wa(words[j + 1]), _SERVICES_OBJECT):
                    j += 1
                return j + 1
    return -1


def _svc_stops(w: str) -> bool:
    return _starts(_strip_wa(w), _OWN_CUES) or _strip_wa(w) in _SVC_STOP or w in _SVC_STOP or _strip_wa(w) in _HAS_CUES


def _owns_item(words: list[str]) -> bool:
    """An own cue in a nearby / view list item makes it the ad's own: «خاص بالحي» stays the district's, «مدرسة فيها نادي»
    stays the school's (the list goes on)."""
    return any((_starts(_strip_wa(w), _OWN_CUES)
                and not (k + 1 < len(words) and (words[k + 1] in _NBHD_OWNER or _strip_wa(words[k + 1]) in _NBHD_OWNER)))
               or (_strip_wa(w) in _HAS_CUES and not (k and _starts(_strip_wa(words[k - 1]), _PLACE_WORDS)))
               for k, w in enumerate(words))


def _clauses(text: str) -> list[tuple[int, str]]:
    out, pos = [], 0
    for m in N._CLAUSE_BREAK_RE.finditer(text):
        if m.start() > pos:
            out.append((pos, text[pos:m.start()]))
        pos = m.end()
    if pos < len(text):
        out.append((pos, text[pos:]))
    return out


# A NUMBERED LIST's index is not a count (🔬 2026-11-05). haraj 20997332: «1-مدخل مستقل 2-حـوش طولي 3-غـرفه 4-دورة مـياه»
# — norm() turns the «-» into a space, so «4-دورة مـياه» read as FOUR bathrooms on a one-bathroom flat, and 740 served
# bathroom answers on 11-05 were quoted from a «N-» / «N)» list item. An index belongs to a run of three or more
# consecutive numbers, each written with a list mark, in order through the ad; a number in that run says nothing about
# how many (silence = unknown, never a guess).
_LIST_MARK = re.compile(r"(?<![0-9٠-٩\w])([0-9٠-٩]{1,2}) ?(?:[-–)]|\.(?![0-9٠-٩]))")
_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def _list_index_values(raw: str) -> frozenset[int]:
    seq = [int(m.group(1).translate(_AR_DIGITS)) for m in _LIST_MARK.finditer(raw)]
    out: set[int] = set()
    for i, start in enumerate(seq):
        chain, want = [start], start + 1
        for v in seq[i + 1:]:
            if v == want:
                chain.append(v)
                want += 1
        if len(chain) >= 3:
            out.update(chain)
    return frozenset(out)


def _is_list_index(v: int, raw_clause: str, idx: frozenset[int]) -> bool:
    return v in idx and any(int(m.group(1).translate(_AR_DIGITS)) == v for m in _LIST_MARK.finditer(raw_clause))


def _num_hits(fact: str, t: str, ci: int, raw_clause: str = "", list_idx: frozenset[int] = frozenset()) -> list[Hit]:
    hits = []
    lo, hi = _COUNT_RANGE[fact]
    for rx in _COUNT_RES[fact]:
        for m in rx.finditer(t):
            g = m.group(1)
            v = int(g) if g.isdigit() else _WORD_NUM.get(g)
            if v is None or not lo <= v <= hi:
                continue
            after = t[m.end():m.end() + 14]
            before = t[max(0, m.start() - 30):m.start()].split()[-5:]
            if any(after.lstrip().startswith(x) for x in _COUNT_SKIP_AFTER):
                continue
            if fact == "bathrooms" and any(after.lstrip().startswith(x) for x in _BATH_SKIP_AFTER):
                continue
            if g.isdigit() and _is_list_index(v, raw_clause, list_idx):
                continue                      # «4-دوره مياه» in «1- … 2- … 3- … 4- …»: the item's number, not a count
            if fact == "bathrooms" and any(_strip_wa(w) in ("كل", "لكل", "بكل") for w in before[-3:]):
                continue                      # «كل شقه 2 دورات مياه»: a per-unit count, not the home's
            if any(w in _NEAR_WORDS for w in before):
                continue
            if fact == "shops_count" and (any(_starts(_strip_wa(w), _EXCLUDE["shops_inside"][0]) for w in before[-3:])
                                          # «خلف العمارة 4 محلات»: shops behind / opposite the building (CodeRabbit on #11068)
                                          or any(_strip_wa(w) in _NEAR_PUBLIC or w in _NEAR_PUBLIC for w in before[-3:])
                                          or any(_starts(_strip_wa(w), _EXCLUDE["shops_inside"][1])
                                                 for w in t[m.end():].split()[:2])):
                continue                      # «تصلح 4 محلات», «4 محلات حسب الرخصة»: what COULD be there (🔬 2026-11-07)
            if any(_strip_wa(w).startswith(x) for w in before for x in ("نظام", "رخص", "تصريح", "يسمح", "مسموح", "حتي")):
                continue                      # «نظام البناء 3 ادوار», «تصريح حتى 12 دور»: what may be built, not what is
            if fact == "floors" and ("ارضي" in t[max(0, m.start() - 12):m.end() + 12] or after.lstrip().startswith("مي")):
                continue                      # «دورين مياه» is a typo for two bathrooms                      # «ارضي + دورين» — ground floor + two? ambiguous: no row
            hits.append(Hit(fact, v, m.start(), m.end(), ci))
    return hits


_PLACE_KIND_WORDS = tuple(_DISTRICT_WORDS) + tuple(_n(w) for w in ("مدينه", "بمدينه", "مدينة", "محافظه", "بمحافظه", "محافظة"))


def _blank_place_names(t: str, names: tuple[str, ...]) -> str:
    """The ad's OWN district / city names, blanked (same length, so quote offsets hold) before any fact is read.

    Backlog 1188 (🔬 2026-11-02): «حي X» is caught in _judge, but a title that is a URL slug — abaad 13214542
    «دور-بيشة-الخزان» (type-city-district) — has no «حي» before the name, and district «الخزان» read water_tank = yes.
    The listing already KNOWS its place, so its own names are removed as whole words: no stem list, no guessing.
    Only the exact normalised name goes («الخزان»); a bare «خزان ماء» in the same ad is still read.

    The kind word right before it goes WITH it (🔬 2026-11-05 yearly-rent furnished audit): blanking only the name left
    «في حي          مؤثثه بالكامل», and _judge reads any word after «حي» as a district — so the ad's own «مؤثثة بالكامل»,
    «( مؤثثة)», «مفروش» after «بحي الملقا / حي المعذر / حي المهدية» answered nothing (aqar 14861704, 14852480, 16198971,
    22605359), and so did every other fact written straight after the ad's own district."""
    for name in names:
        # stored names carry their kind word — abaad's district_ar is «حي الخزان», the slug says «الخزان»
        nn = re.sub(r"^(?:حي|مدينه|مدينة|محافظه|محافظة)\s+", "", norm(name or "").strip())
        if len(nn) >= 3:
            t = re.sub(r"(?<!\S)(?:(?:" + "|".join(sorted(_PLACE_KIND_WORDS, key=len, reverse=True)) + r")\s+)?"
                       + re.escape(nn) + r"(?!\S)", lambda m: " " * len(m.group(0)), t)
    return t


_ADL_PAIR = re.compile(r"(العدل\s+)(ال?غسال\S*)")
_ADL_GHASSALA = re.compile(r"(العدل)([ \t]*[-–—،,|/]+[ \t]*)(ال?غس[اٱ]ل\S*)( ?)")


def check(text: str, place_names: tuple[str, ...] = ()) -> list[dict[str, Any]]:
    """Facts the ad's text states: [{fact, value_bool|value_num|value_text, quote}], quote = the ad's own span.
    place_names: the listing's own district / city — never read as a fact (_blank_place_names)."""
    if not text:
        return []
    raw = unicodedata.normalize("NFKC", text)
    # «حي العدل - الغسالة» / «العدل، الغسالة»: one Makkah address, not a clause break before a washing machine — the
    # separator becomes blanks of the same length (quotes keep their offsets) so _judge sees «العدل» before it.
    raw = _ADL_GHASSALA.sub(lambda m: m.group(1) + " " * len(m.group(2)) + m.group(3) + ("،" if m.group(4) else ""), raw)
    # …and the clause break moves to AFTER the address, so «مسبح حي العدل - الغسالة لا يوجد مصعد» keeps «لا يوجد» with
    # the lift, not the pool (CodeRabbit on #10943)
    full_norm = norm(raw)
    clauses = [(off, c) + norm_map(c) for off, c in _clauses(raw)]
    if place_names:
        # «حي العدل الغسالة»: the Makkah address goes WITH the district name — blanking «العدل» alone left «الغساله»
        # for the reader to take as a washing machine (CodeRabbit on #10943)
        clauses = [(off, c, _blank_place_names(_ADL_PAIR.sub(lambda m: m.group(1) + " " * len(m.group(2)), t),
                                               place_names), idx) for off, c, t, idx in clauses]
    bool_hits: dict[str, dict[bool, tuple[int, int, int]]] = {}
    num_hits: dict[str, list[Hit]] = {}
    cue_in = near_in = near_list = use_list = False
    prev_end = 0
    list_idx = _list_index_values(raw)
    void = {j for ci, (_o, _c, t, _i) in enumerate(clauses) if any(p in t for p in _NOT_STATED) for j in (ci - 1, ci)}
    svc_on = False
    for ci, (_off, _c, t, _idx) in enumerate(clauses):
        # A NEARBY LIST runs on across commas (🔬 2026-11-04 café audit): «Close to shops, restaurants, and markets»,
        # «قريبة من جميع الخدمات: مسجد، بقالة، مغسلة، مطعم» — each item is its own clause, so the near word was lost.
        # Only a comma continues the list: a new line, «.», «•» or «-» starts the ad's own feature list.
        sep = raw[prev_end:_off].strip()
        prev_end = _off + len(_c)
        comma = bool(sep) and set(sep) <= set("،,-•|▫▪+")  # a list mark continues a nearby list; «.» or a new line ends it
        # a clause that was ONLY the ad's own place name is blanks now (_blank_place_names) — nothing to read, and
        # words[0] below would crash the whole run (2026-11-03: every shard of facts-words died on «… مياه وكهرباء، بيشة»)
        if not t.strip() or ci in void:
            near_list = False
            use_list = use_list and comma
            svc_on = svc_on and "." not in sep and "\n" not in sep   # a skipped clause after «.» still ends the heading
            continue
        words = t.split()
        # an item that STARTS with a place runs on as the list's item however long the clause is: «إطلالة ونافذة على: حديقة،
        # جامع، ونادي صحي خدمات الموقع القريبة: * مدارس» (aqar 15128626, 🔬 2026-11-06 — the view's gym served as the unit's)
        list_base = near_list and comma and (len(words) <= 5 or _starts(_strip_wa(words[0]), _PLACE_WORDS)) \
            and any(_starts(_strip_wa(w), _PLACE_WORDS) or _strip_wa(w) in _SERVICES_OBJECT for w in words)
        # «بالقرب من المسجد، المدارس، الخدمات، والحديقة» (aqar 14865940, 🔬 2026-11-11): «الخدمات» is an ITEM of the list,
        # so the park after it is still the area's
        list_in = list_base and not _owns_item(words) and not any(
            (_strip_wa(w) in _SVC_STOP or w in _SVC_STOP)
            and not (k + 1 < len(words) and (words[k + 1] in _OTHER_PLACE or _strip_wa(words[k + 1]) in _OTHER_PLACE))   # «حديقة المبنى الآخر»: another
            for k, w in enumerate(words))                                              # building's, the list goes on (CodeRabbit #11820)   # «خدمات المبنى»: the building's own
        # …but only the ITEM continues the list: a spaced «*» bullet starts the next one (🔬 2026-11-07, P1 13301). aqar
        # 15128626 «إطلالة ونافذة على: حديقة، جامع، ونادي صحي خدمات الموقع القريبة: * مدارس … * اتحاد ملاك مجاناً مميزات
        # المشروع» — «مميزات» 60 words and eight bullets later is the project's heading, not the gym's owner. The item's
        # own words decide, and only for a hit inside the item; a hit in a later bullet keeps the whole-clause answer, so
        # this can only silence a view's / a nearby list's item, never add a yes.
        item_end = -1
        star = _STAR_BULLET_RE.search(_c) if list_base and not list_in else None
        if star:
            cut = bisect.bisect_left(_idx, star.start())
            head = t[:cut].split()
            if head and any(_starts(_strip_wa(w), _PLACE_WORDS) for w in head) and not _owns_item(head):
                item_end = cut
        # the nearby-services heading (🔬 2026-11-07, backlog 1507): [svc_from, svc_to) of `t` holds the AREA's places
        starts_at = [m.start() for m in re.finditer(r"\S+", t)]
        svc_from = svc_to = -1
        hs = _svc_heading_end(words)
        if hs >= 0:
            stop = next((k for k in range(hs, len(words)) if _svc_stops(words[k])), len(words))
            if stop > hs:
                svc_from, svc_to = starts_at[hs], (starts_at[stop] if stop < len(words) else len(t))
            svc_on = stop == len(words)
        elif svc_on and "." not in sep and "\n" not in sep:
            # the heading carried on from the clause before covers THIS clause up to its first stop word: «بالقرب من
            # جميع الخدمات التي تحتاجها، وتشمل: 🕌 جامع 🛒 سوبرماركت 🌿 حديقة … 🏢 مميزات العمارة» (aqar 13447339,
            # backlog 1507) — the own cue «مميزات» at the END used to drop the whole carried range, so the AREA's
            # mosque / market / garden before it read as the flat's own (🔬 2026-11-08)
            stop = next((k for k, w in enumerate(words) if _svc_stops(w)), len(words))
            if stop > 0:
                svc_from, svc_to = 0, (starts_at[stop] if stop < len(words) else len(t))
            svc_on = stop == len(words)
        else:
            svc_on = False
        n_words = len(words)
        for fact, pats in _PATTERNS.items():
            for rx, forced in pats:
                for m in rx.finditer(t):
                    v, qs, qe = _judge(fact, t, m.start(), m.end(), forced, n_words, cue_in, near_in,
                                       list_in or m.end() <= item_end or svc_from <= m.start() < svc_to)
                    if v is True and fact == "fire_pit" and _stove_not_fire(raw, clauses, ci, t, m.start(), m.end()):
                        v = None                     # «مطبخ … (ثلاجة، فرن، موقد، شفاط)», «موقد سيراميكي»: the kitchen
                                                     # cooktop, not a fire pit (🔬 2026-11-08: 28 of 30 served apartment
                                                     # «موقد» yeses were the stove)
                    if v is True and fact in ("horses_stable", "for_events"):
                        before = [_strip_wa(w) for w in t[:m.start()].split()]
                        # for_events reads only the explicit list opener: «المخيم خيار مثالي لقضاء أوقات ممتعة» is an
                        # ideal stay, not a possible use (real-ad lock, gathern 23125750)
                        at = max((k for k, w in enumerate(before) if w in _POSSIBLE_ACTIVITY), default=-1) \
                            if fact == "horses_stable" else -1
                        opener = _POSSIBLE_OPENER.search(t[:m.start()])   # «مناسبة لعدة أنشطة استثمارية: 🔹 …» (any distance)
                        if opener and at < 0:
                            at = len(t[:opener.start()].split())
                        if not any(w in _HAS_NOW for w in before[at + 1:]) and (
                                at >= 0 and (at >= len(before) - 8 or opener)
                                or (at < 0 and use_list and comma and fact == "horses_stable")):
                            v = None                 # «مثالية لمشاريع المستودعات، اسطبلات الخيل», «لمزاولة الأنشطة المختلفة
                                                     # كركوب الخيل»: a possible use, not horses on the plot — and the list
                                                     # goes on across commas (P2 13085 «الخيل», aqar 1769697, haraj
                                                     # 27188602, 🔬 2026-11-14). Only a yes is silenced; a «no» stays.
                    if v is not None:
                        bool_hits.setdefault(fact, {}).setdefault(v, (ci, qs, qe))
        use_list = (use_list and comma) or any(_strip_wa(w) in _POSSIBLE_ACTIVITY for w in words)
        # what this clause hands to the next one: a cue (or a cued utility list going on), a «nearby» heading
        # (a cue alone does not carry: «لا يوجد مصعد, مياه …» must not cue the next clause)
        cue_in = (any(_starts(w, _CUES) for w in words) and any(_starts(_strip_wa(w), _UTILITY) for w in words)) \
            or (cue_in and _starts(_strip_wa(words[0]), _UTILITY))
        # a heading ENDS with the nearby word: «خدمات قريبة:», «بالقرب من:», «Nearby:»
        # …but a VIEW word ending an item («/بلكونة مطلة / موقف خاص», dealapp 17549152) describes that item, not a heading
        near_in = any((_strip_wa(w) in _NEAR_WORDS or w in _NEAR_WORDS) and not (_strip_wa(w) in _VIEW_WORDS or w in _VIEW_WORDS)
                      for w in _drop_walk_facility(words)[-2:]) or (near_in and n_words <= 3)
        near_list = list_in or any(_strip_wa(w) in _NEAR_WORDS or w in _NEAR_WORDS or _strip_wa(w) in _NEAR_PUBLIC
                                   or w in _NEAR_PUBLIC or _is_boundary(w) for w in _drop_walk_facility(words)) \
            or any(p in t for p in _NEAR_PHRASES)
        for fact in _COUNT_RES:
            num_hits.setdefault(fact, []).extend(_num_hits(fact, t, ci, _c, list_idx))
        # street width — collected, judged across the whole ad below
        for rx in _STREET_RES:
            for m in rx.finditer(t):
                g = [x for x in m.groups() if x and x.isdigit()]
                if not g:
                    continue
                bearing = next((x for x in m.groups() if x and not x.isdigit()), None)
                nxt = t[m.end():].split()[:1]
                two = bool(nxt and nxt[0].isdigit())
                num_hits.setdefault("street_width_m", []).append(
                    Hit("street_width_m", (int(g[0]), bearing, two), m.start(), m.end(), ci))
        for m in _WASALT_WIDTH.finditer(t):
            if "شارع" in t[:m.start()].split()[-4:]:
                num_hits.setdefault("street_width_m", []).append(
                    Hit("street_width_m", (int(m.group(1)), None, False), m.start(), m.end(), ci))
        for rx in (_AGE_EXTRA, _AGE_EN):
            for m in rx.finditer(t):
                if _AGE_OPEN.search(t[m.start():m.end() + 10]):
                    continue
                g = m.group(1)
                v = int(g) if g.isdigit() else _EN_NUM[g]
                num_hits.setdefault("property_age_years", []).append(Hit("property_age_years", v, m.start(), m.end(), ci))
    # AI teacher pass 2026-10-27: «عداد كهرباء مستقل» / «الكهرباء مستقل» is a connected supply as well as a meter —
    # the supply fact inherits the meter's yes (never its no: «عداد مشترك» says nothing about the supply)
    # …but only when the meter's own words NAME the utility: «عدادات مستقلة» alone is a meter, not proof of power
    # (benchmark facts-words-bench-v4: 112 electricity rows quoted a bare «عدادات مستقلة»)
    for meter, supply, word in (("separate_electricity_meter", "electricity", "كهرب"),
                                ("separate_water_meter", "water_supply", ("مياه", "ماء", "مويه", "موي"))):
        if True in bool_hits.get(meter, {}) and supply not in bool_hits:
            ci, qs, qe = bool_hits[meter][True]
            span = clauses[ci][2][qs:qe]
            if any(w in span for w in ((word,) if isinstance(word, str) else word)):
                bool_hits[supply] = {True: bool_hits[meter][True]}
    out: list[dict[str, Any]] = []

    def quote_of(ci: int, s: int, e: int) -> str:
        _off, c, t, idx = clauses[ci]
        while s < e and t[s] == " ":
            s += 1
        while e > s and t[e - 1] == " ":
            e -= 1
        return c[idx[s]: idx[e - 1] + 1].strip() if e > s else ""

    def emit(fact: str, value: Any, q: str) -> None:
        nq = norm(q)
        if not nq or nq not in full_norm:          # PROOF OR DROP — the same check the LLM run passed
            return
        if names_a_person(q) or (isinstance(value, str) and names_a_person(value)):
            return                                 # PDPL: never store a person's name, drop the whole row
        row = {"fact": fact, "value_bool": None, "value_num": None, "value_text": None, "quote": q[:300]}
        row["value_bool" if isinstance(value, bool) else "value_text" if isinstance(value, str) else "value_num"] = value
        out.append(row)

    for fact, by_val in bool_hits.items():
        if len(by_val) == 1:                       # both a yes and a no → the ad has not stated it
            v, (ci, s, e) = next(iter(by_val.items()))
            emit(fact, v, quote_of(ci, s, e))
    # a counted «2 دورة مياه» next to an UN-numbered «دورة مياه» elsewhere (wasalt 5952515: «دورة مياه تخدم القسم
    # الرجالي … 2دورة مياه» — the page totals 3) is two statements that do not add up to a stated count → none
    bath_hits = num_hits.get("bathrooms", [])
    # 🔬 2026-11-05: a LABELLED total («عدد دورات المياه 3», «الحمامات ٥») is the home's total — haraj 18924617 «مجلس مستقل
    # مع دورة مياه … عدد دورات المياه 3» answered nothing because the majlis's own bathroom voided it. Labelled hits win;
    # an unlabelled count next to an unnumbered one still says nothing (the total may be 3 or 4).
    labelled = [h for h in bath_hits if _BATH_LABEL.match(clauses[h.clause][2][h.s:h.e])]
    if labelled:
        num_hits["bathrooms"] = bath_hits = labelled
    if bath_hits and not labelled:
        for ci, (_off, _c, t, _idx) in enumerate(clauses):
            if ci in void:
                continue
            for m in _BATH_BARE.finditer(t):
                if any(h.clause == ci and h.s <= m.start() < h.e for h in bath_hits):
                    continue
                if any(t[m.end():m.end() + 14].lstrip().startswith(x) for x in _BATH_SKIP_AFTER + ("واحد",)):
                    continue
                num_hits["bathrooms"] = []
                break
            if not num_hits["bathrooms"]:
                break
    for fact in ("floors", "apartments_count", "shops_count", "bathrooms", "property_age_years"):
        hits = num_hits.get(fact, [])
        if len({h.value for h in hits}) == 1:      # several different counts → none, never a pick
            emit(fact, float(hits[0].value), quote_of(hits[0].clause, hits[0].s, hits[0].e))
    # A STATED NUMBER OF SHOPS says the building has shops (🔬 2026-11-07 two-way recall sample: 15 of 25 building ads
    # that state their shops carried no answer — «عباره عن أربع محلات», «الدور الأرضي:- ثلاث معارض», «5محلات و4شقق»: the
    # count was read, the yes was not). Only when the ad said nothing else about shops either way.
    sc = next((r for r in out if r["fact"] == "shops_count"), None)
    # «فتحات» is left out: on a showroom («معرض مكون من ٣ فتحات») it is the frontage openings, not three shops.
    if sc and (sc["value_num"] or 0) >= 1 and "shops_inside" not in bool_hits and "فتح" not in norm(sc["quote"]):
        emit("shops_inside", True, sc["quote"])
    # age: the scrapers' own labelled-prose reader on the raw text (open bounds stay unknown)
    if "property_age_years" not in {r["fact"] for r in out} and not num_hits.get("property_age_years"):
        ages = {}
        for _off, c, _t, _idx in clauses:
            for m in N._LABELLED_AGE_RE.finditer(c):
                a = N.exact_age(m.group(1))
                if a is not None and not _AGE_OPEN.search(norm(c[m.start():m.end() + 12])):
                    ages.setdefault(a, m.group(0).strip())
        if len(ages) == 1:
            a, q = next(iter(ages.items()))
            emit("property_age_years", float(a), q)
    # street width: exactly one street. A corner word, «يحدها 2 شارع», two numbers, two widths or two
    # bearings → none (a corner plot with one street named is still a corner plot — report gotcha).
    sw = num_hits.get("street_width_m", [])
    if sw and not _CORNER.search(full_norm) and not _N_STREETS.search(full_norm) and not any(h.value[2] for h in sw):
        widths = {h.value[0] for h in sw}
        bearings = {N.one_direction(h.value[1]) for h in sw if h.value[1]}
        w = next(iter(widths))
        if len(widths) == 1 and len(bearings) <= 1 and 4 <= w <= 150:
            h = sw[0]
            emit("street_width_m", float(w), quote_of(h.clause, h.s, h.e))
    # boundaries: a labelled lengths list («الاطوال 20 × 30») or ≥2 sides «شمالا … بطول 20»
    for _off, c, t, idx in clauses:
        m = _BOUNDARY_LABEL.search(t)
        if m and len(re.findall(r"\d+", m.group(1))) >= 2:
            emit("boundaries", " ".join(quote_of_t(c, t, idx, m.start(), m.end()).split()), quote_of_t(c, t, idx, m.start(), m.end()))
            break
    else:
        sides = [(ci, m) for ci, (_o, _c, t, _i) in enumerate(clauses) for m in _BOUND_SIDE.finditer(t)]
        if len({N.one_direction(m.group(1)) for _ci, m in sides} - {None}) >= 2:
            ci0, m0 = sides[0]
            ci1, m1 = sides[-1]
            if ci0 == ci1:
                q = quote_of(ci0, m0.start(), m1.end())
                emit("boundaries", " ".join(q.split())[:300], q)
    # LAND USE (owner decision 2026-11-08, backlog 1650/1718): what a plain «أرض» ad says its land is zoned for. Only a
    # head that NAMES the land or its deed carries it — «ارض/قطعه/اراضي (زاويه|مميزه)? سكنيه», «صك زراعي», «استخدام
    # العقار: تجاري», «نوع الارض: صناعي», «تصريح بناء سكني». «شارع تجاري», «موقع تجاري», «السجل التجاري», «مشروع سكني»,
    # «مجمع سكني» never: they are a street, a pitch, a broker licence, a building. Two different uses anywhere in the ad
    # («ارض زاويه تجاريه سكنيه», «استخدام العقار: سكني-تجاري»), a conversion («قابله للتحويل») or a near word before the
    # head («قريبه من ارض تجاريه») → none: silence is unknown, never a pick.
    land_uses: dict[str, tuple[int, int, int]] = {}
    near_carry = False
    for ci, (_o, _c, t, _i) in enumerate(clauses):
        # «قريبة من حي، فيه أرض تجارية»: a clause that opens with «فيه / بها / منها» continues the neighbour the last
        # clause was near to (CodeRabbit on #11819)
        carried = near_carry and bool(t.split()) and _strip_wa(t.split()[0]) in _NEAR_RELATIVE
        near_carry = _near_open(_c, t, _i, len(t))
        if _LAND_CONVERT.search(t) or _LAND_CONVERTIBLE.search(t):
            land_uses["?"] = (ci, 0, 0)
            continue
        for m in _LAND_USE.finditer(t):
            before = t[:m.start()].split()[-3:]
            # a wanted request runs to the end of its clause: «مطلوب من مالك الأرض قطعة أرض تجارية» (CodeRabbit on #11819)
            # «السعر قابل للتفاوض أرض سكنية»: the price is negotiable, not the use (CodeRabbit on #11819)
            hedges = [w for k, w in enumerate(before) if w in _LAND_NOT_STATED
                      and not (k + 1 < len(before) and before[k + 1].startswith(_n("للتفاوض")[:5]))]
            # a near word owns everything after it up to the next heading — see _near_open (CodeRabbit on #11819)
            if _near_open(_c, t, _i, m.start(), carried) or hedges \
                    or any(_strip_wa(w) in _LAND_WANTED for w in t[:m.start()].split()):
                continue           # «قريبه من ارض تجاريه», a broker's «مطلوب اراضي تجاريه»: not this ad's land
            nxt = clauses[ci + 1][2].split()[:1] if ci + 1 < len(clauses) and not t[m.end():].strip() else []
            more = _LAND_USE_WORD_RE.fullmatch(nxt[0]).group(0) if nxt and _LAND_USE_WORD_RE.fullmatch(nxt[0]) else None
            for u in (m.group("u"), m.group("u2"), more):    # «( تجاري / سكني )»: «/» breaks the clause, not the pair
                if u:
                    land_uses.setdefault(_LAND_USE_OF[u.removeprefix("و").removeprefix("ال")[:4]], (ci, m.start(), m.end()))
    if len(land_uses) == 1 and "?" not in land_uses:
        u, (ci, s0, e0) = next(iter(land_uses.items()))
        emit("land_use_ar", u, quote_of(ci, s0, e0))
    return out


# A NEAR WORD OWNS WHAT FOLLOWS IT UNTIL A HEADING (CodeRabbit on #11819, 2026-11-11). «قريبة من حي تتوفر فيه قطع
# متعددة منها أرض تجارية» — however many words later, the land is the neighbourhood's; a word window cannot see that, so
# none is used. What ends the reach is a new heading: a «: / ⸻ / —» in the RAW clause (norm_map strips them, so they are
# found through its position map — «قريب من شارع الملك وصف العقار: صك سكني»), or a description label even without its
# colon («… وصف العقار صك سكني»). aqar 1341293 («قريب من جميع الخدمات ⸻ وصف العقار: ارض مسوره صك سكني») is the lock's
# witness. Known price: «وقريبة من الخدمات أرض سكنية» stays unstated — silence is unknown; a neighbour's use is a lie.
_NEAR_HEADING_RAW = re.compile(r"[:⸻—]")
_NEAR_HEADING_WORDS = frozenset(_n(w) for w in ("وصف", "الوصف", "نوع", "استخدام", "الاستخدام", "مواصفات", "المواصفات",
                                                 "تفاصيل", "التفاصيل", "بيانات", "معلومات"))
_NEAR_RELATIVE = frozenset(_n(w) for w in ("فيه", "فيها", "به", "بها", "منها", "منه", "يوجد", "توجد", "تتوفر", "يتوفر",
                                            "يضم", "تضم"))


def _near_open(c: str, t: str, idx: list[int], end: int, near: bool = False) -> bool:
    """True when a near word stands in t[:end] with no heading between it and end. `near` is the state carried in from
    the clause before («قريبة من حي، فيه …»); a heading in this clause ends it too (CodeRabbit on #11819)."""
    start = 0
    raw_end = idx[end] if end < len(idx) else len(c)       # the head's own raw position: a collapsed space maps short
    cut = [h.end() for h in _NEAR_HEADING_RAW.finditer(c, 0, raw_end)]
    if cut:
        start = bisect.bisect_left(idx, cut[-1], 0, end)
        near = False
    words = t[start:end].split()
    for w in words:
        if w in _NEAR_HEADING_WORDS or _strip_wa(w) in _NEAR_HEADING_WORDS:   # «وصف» starts with «و» itself
            near = False
        elif w in _NEAR_WORDS or (w.startswith("و") and w[1:] in _NEAR_WORDS):
            near = True
    return near


def quote_of_t(c: str, t: str, idx: list[int], s: int, e: int) -> str:
    while e > s and t[e - 1] == " ":
        e -= 1
    return c[idx[s]: idx[e - 1] + 1].strip() if e > s else ""


def facts_of(text: str, place_names: tuple[str, ...] = ()) -> dict[str, Any]:
    """{fact: value} — a convenience view of check() for tests and the finder."""
    return {r["fact"]: next(r[k] for k in ("value_bool", "value_num", "value_text") if r[k] is not None)
            for r in check(text, place_names)}


# ── self-check: real tricky phrases from the LLM run's report (FACTS_EXTRACT_TEST_2026-10-24.md) ──────────
def selftest() -> None:
    # 936: a short phrase is read, a lone word is not
    assert readable(norm("مفروشه سنه كامله")) and not readable(norm("مصعد")) and not readable(norm("")), "readable"
    for s in ("مَسْبَحٌ، وحديقة", "شارع ١٥ م", "Fully FURNISHED — شقة!", "ﻻ يوجد مصعد"):
        assert norm_map(unicodedata.normalize("NFKC", s))[0] == norm(s), s

    def f(text: str) -> dict[str, Any]:
        return facts_of(clean_text(None, text))

    cases: list[tuple[str, dict[str, Any], tuple[str, ...]]] = [
        # (text, must-have {fact: value}, must-NOT-have facts)
        ("فيلا بدون مسبح", {"pool": False}, ()),
        ("شقة غير مفروشة", {"furnished": False}, ()),
        # 🔬 2026-11-05 yearly-rent furnished audit (126,831 ads)
        ("وضع التأثيث مذكور كغير مُؤثث؛ ضع في الاعتبار", {"furnished": False}, ()),   # muhaysini 17581075: «كغير» = as un-
        ("قريبة من المروج بدون اثاث 🌹 عوائل موقع مميز", {"furnished": False}, ()),   # aqar 14849641: the near word is the place's
        ("غرفة نظيفة سعرها بدون فرش وتكيف 18,000 سنوي", {"furnished": False}, ()),    # aqar 11494692
        ("الصالة بدون فرش موكيت", {}, ("furnished",)),                                  # a floor covering, not furniture
        ("قريب من معارض المفروشات", {}, ("furnished",)),
        ("غرفتين وصاله ومطبخ ماثثة بالكامل يوجد فرن غاز", {"furnished": True}, ()),            # haraj 23236459
        # P2 13085 «ماثث» (🔬 2026-11-14): a masculine furnished word right after the kitchen is the kitchen's
        ("حمام فيها مطبخ ماثث الارضيات سرميك", {"kitchen": True}, ("furnished",)),                     # haraj 20944851
        ("غرفة بمطبخ ماثث بدون اجهزة", {}, ("furnished",)),                                              # CodeRabbit #12188
        ("مطبخ ( مأثث) بدون اجهزة. ⁠٣ دورات مياه", {"kitchen": True}, ("furnished",)),                   # aqarcity 17945592
        ("ثلاث دورات مياه مطبخ مؤثث كامل دورة غسيل او خادمة بلكونه", {"kitchen": True}, ("furnished",)),  # aqar 15126526
        ("غرفتين وصاله وحمام ومطبخ مفروشه الايجار 6000 شهري", {"furnished": True}, ()),                 # propertyfinder 23820293
        ("ثلاث غرف وصاله وثلاث دورات مياه ومطبخ مؤثثه بالكامل باثاث فاخر", {"furnished": True}, ()),     # aqarmonthly 7060038
        ("استديو للايجار سويت غرفه ودورة مياه ماثث", {"furnished": True}, ()),                          # haraj 25938268
        ("شقق مرفروشة للإيجار الشهري والسنوي", {"furnished": True}, ()),                       # dealapp 21598204
        ("شقق للإيجار في جدة مفروووووش شقق مكونة من غرفتين", {"furnished": True}, ()),          # dealapp 17640912
        ("نظافة يومية - أثاث مكتبي راقٍ وجاهز - خصوصية", {"furnished": True}, ()),             # aqar 15113813
        ("بينما لا تتوفر أثاث في الشقة، فإنها تمنح المستأجرين حرية", {"furnished": False}, ()),  # tuba 13261374
        ("الحالة: الصور هذي الأثاث غير موجود .", {"furnished": False}, ()),                   # haraj 18784245
        ("- Furnished: Unfurnished\nAmenities:", {"furnished": False}, ()),                    # manzo 21173202
        ("استديو للعازبات مؤثثة بالكامل غير شامل الجاكوزي", {"furnished": True}, ()),          # dealapp 19862005
        ("عقد موثق في الشهر العقاري", {}, ("furnished",)),                                     # «موثق» = notarised
        ("شقة مجهزة بالكامل", {}, ("furnished",)),                                              # equipped is not furnished
        ("شقق مؤثثة وغير مؤثثة", {}, ("furnished",)),                                          # both offered: no answer
        ("مطبخ غير شامل الأجهزة", {}, ()),
        ("لا يوجد مصعد", {"elevator": False}, ()),
        ("ولا يوجد مصعد في المبنى", {"elevator": False}, ()),
        ("مفروشة: لا", {"furnished": False}, ()),
        ("سطح مفروش بنجيل صناعي", {}, ("furnished",)),            # dealapp 438767: a turf roof, not furniture
        ("غرفة النوم مفروشة بالموكيت", {}, ("furnished",)),        # dealapp 598307: carpeted
        ("حوش كبير مفروش بالعشب ومظلل", {}, ("furnished",)),       # dealapp 493432: a grassed yard
        ("شقة مفروشة بالكامل", {"furnished": True}, ()),
        # silent-ads teacher pass 2026-10-26: the furniture named by its kind
        ("شقة بأثاث مودرن ومريح", {"furnished": True}, ()),
        ("استديو مريح بتأثيث فندقي للإيجار اليومي", {"furnished": True}, ()),
        ("ومتكاملة الاثاث والادوات الكهربائية", {"furnished": True}, ()),
        ("مطبخ مجهز بالكامل", {}, ("furnished",)),
        ("شقة بدون تأثيث", {"furnished": False}, ()),
        ("شقة غير مؤثثة بصالة واسعة", {"furnished": False}, ()),
        ("شقة بصالة انيقة وغرفة نوم", {}, ("furnished",)),
        ("مفروش: لا (غير مفروش)", {"furnished": False}, ()),
        ("مطبخ غير راكب", {"kitchen": False}, ()),
        # 🔬 2026-11-03 manzo 21173178: a «و»-joined fixture shares the verdict, both ways round; a comma list does not
        ("المكيفات والمطبخ: غير راكبة", {"kitchen": False, "air_conditioner": False}, ()),
        ("المطبخ والمكيفات غير راكبة", {"kitchen": False, "air_conditioner": False}, ()),
        ("مطبخ، مكيفات غير راكبة", {"kitchen": True, "air_conditioner": False}, ()),
        ("مكيفات ومطبخ راكب", {"kitchen": True, "air_conditioner": True}, ()),
        # 🔬 2026-11-04 live walk: a near word or an entrance in the bullet BEFORE does not take the unit's AC away
        ("بلكونة بانورامية مطله على لاندسكيب 🔹مكيفات راكبة", {"air_conditioner": True}, ()),
        ("قريب من المسجد عدد 9 مكيفات راكبه", {"air_conditioner": True}, ()),
        ("20 دقيقة من واجهة روشن ❄ تكييف", {"air_conditioner": True}, ()),
        ("مدخلان للشقة مكيفات جديدة", {"air_conditioner": True}, ()),
        ("🔸مدخل سيارة ✅ مكيفات راكبة", {"air_conditioner": True}, ()),
        ("ممرات واسعة مكيفة", {}, ("air_conditioner",)),
        ("مدخل فندقي مكيف", {}, ("air_conditioner",)),
        ("قريب من: 🔸 مسجد 🔸 حديقة", {}, ("garden", "mosque")),
        # «قابل للتفاوض» is negotiable, never «can be fitted»; a public place keeps the old reading
        ("المطبخ راكب المكيفات راكبه وقابل للتفاوض", {"kitchen": True, "air_conditioner": True}, ()),
        ("السعر قابل للتفاوض مطبخ راكب", {"kitchen": True}, ()),
        ("مكيفات قابلة للتركيب", {}, ("air_conditioner",)),
        ("خدمات سيرا على الاقدام مثل بقالة ومغسلة ملابس وصالون حلاقة ومقهى السعر قابل للتفاوض", {}, ("restaurant_cafe",)),
        # a NEARBY LIST runs on across commas through place items — never past a non-place item, never onto parking
        ("Close to shops, restaurants, and markets", {}, ("restaurant_cafe", "market")),
        ("قريبة من جميع الخدمات: مسجد، بقالة، مغسلة، مطعم وكافيه", {}, ("restaurant_cafe", "mosque")),
        ("بالقرب من الجامعة ، مسجد ، مدرسة متوسطة، مركز تسوق ، وحديقة", {}, ("mosque", "garden")),
        ("بجواره مقهى دانكن", {}, ("restaurant_cafe",)),
        ("Directly behind Al-Romansiah Restaurant", {}, ("restaurant_cafe",)),
        ("مميزات العقار : مصعد ، قريب من الخدمات ، نوافذ زجاج ، موقف سيارات", {"elevator": True, "parking": True}, ()),
        ("حوش ، قريب من الخدمات ، موقف سيارات", {"parking": True}, ()),
        # «قريب من الخدمات» is one item; the lift after it is the unit's own (muhaysini 14819114 / 14817058, 2026-11-04)
        ("مميزات العقار موقع قريب من الخدمات موقف سيارات مصعد غرفة غسيل", {"elevator": True}, ()),
        ("نوافذ زجاجية بالقرب من الخدمات موقف سيارات مصعد", {"elevator": True}, ()),
        ("قريب من الخدمات حوش غرفة سائق تأسيس مصعد", {}, ("elevator",)),
        ("قريب من الخدمات مسجد ومدارس", {}, ("mosque",)),
        ("مميزات العقار قريب من الدائري و بها مصعد عرض الشارع ٢٠م", {"elevator": True}, ()),
        ("قريب من الدائري و بها مسجد", {}, ("mosque",)),
        ("مخطط نمار 3020م 💥يتكون من حوش سيارات مصعد مدخلين ومجلس رجال", {"elevator": True}, ()),
        ("على بعد 200 م من المسجد", {}, ("mosque",)),
        ("تكيف مركزي _مجلس - تفتح علي مرفق ومسجد - موسسة مصعد • غرفه سائق", {}, ("elevator",)),
        ("تكيف مركزى - دبل هيت - موسس مصعد - مسبح", {}, ("elevator",)),
        ("دور أرضي ملك مجلس ومطبخ 🌟 أفضل 5 عروض حصرية لدينا (حتى الآن): 🔥 تاون هاوس علوي بمصعد | مخطط رسن طيبة", {"kitchen": True}, ("elevator",)),
        ("Recreation center , restaurant, café, library", {"restaurant_cafe": True}, ()),
        ("قريب من الخدمات\nمسبح خاص\nموقف خاص", {"pool": True, "parking": True}, ()),
        # a distance points at its place with «من / عن»; the next bullet's own features stay (🔬 2026-11-04)
        ("🌳 على مقربة جدًا من حديقة", {}, ("garden",)),
        ("🕌 المسجد على بُعد خطوات", {}, ("mosque",)),
        ("على بعد 20 د عن المسجد النبوي", {}, ("mosque",)),
        ("🔸المسجد على بعد خطوات 🔸موقف خاص 🔸غرفة سائق", {"parking": True, "driver_room": True}, ("mosque",)),
        ("مسبح خاص على بعد دقائق من البحر", {"pool": True}, ()),
        # public places: adjacent / around / opens onto / a list after a near word / minutes / area talk (🔬 2026-11-04)
        ("موقع مميز ملاصق لمسجد التقوى", {}, ("mosque",)),
        ("الشارع الشمالي يفتح على خدمات وحديقة ومسجد", {}, ("mosque", "garden")),
        ("تتوفر جنبها جميع الخدمات ( سوبرماركت - مغاسل - مسجد - مدارس )", {}, ("mosque", "market")),
        ("مسجد قباء: ١٠ دقائق", {}, ("mosque",)),
        ("تتميز المنطقة بتوفر خدمات أساسية مثل المدارس والسوبرماركت والحدائق", {}, ("market",)),
        ("خدمات المشروع - العاب اطفال - حضانة - حديقة خارجية ( لاند سكيب ) - مصلى", {"mosque": True, "garden": True}, ()),
        ("ميني سوبر ماركت داخل المجمع", {"market": True}, ()),
        ("وبلقرب من كرنيش جدة *خدمات متكاملة* 🔸 ممشى وحديقة 🔸 منطقة العاب اطفال", {"garden": True}, ()),
        # the plot's neighbour (🔬 2026-11-04): a direction / facade / «مباشرة» right before the park or mosque
        ("شارع : 20 م جنوبي + حديقة", {}, ("garden",)),
        ("على شارع 30م ومن جهتين حديقه", {}, ("garden",)),
        ("ربع واجهة على جامع حديث", {}, ("mosque",)),
        ("موقع مباشر: مباشرة على مسجد وحديقة", {}, ("mosque", "garden")),
        ("الواجهة شمالية + حديقة خاصة", {"garden": True}, ()),
        # a prepared / possible word governs its own object; a view word never silences the home's own rooms (🔬 2026-11-05)
        ("مميزات إضافية: تكييف سبليت تأسيس مصعد تأسيس فايبر", {"air_conditioner": True}, ("elevator",)),
        ("صاله نساء مطبخ تأسيس مصعد درج داخلي", {"kitchen": True}, ("elevator",)),
        ("مطبخ مع غرفه خادمه تأسيس مصعد", {"kitchen": True, "maid_room": True}, ("elevator",)),
        ("دور 1 بمصعدين يمكن تأجير", {"elevator": True}, ()),
        ("دور 4 بمصعد لا يمكن تأجير عزاب فقط عوائل", {"elevator": True, "singles": False, "families": True}, ()),
        ("دور 1 بمصعدين يمكن تأجير عزاب او عوائل", {"elevator": True, "singles": True, "families": True}, ()),
        ("سباكة ( GS أصلي ) تكييف أسبليت ( تأسيس أمريكي )", {}, ("air_conditioner",)),
        ("يمكن عمل مسبح", {}, ("pool",)),
        ("مسبح خارجي مؤسس", {}, ("pool",)),
        ("صالة معيشة مطلة بلكونة مطبخ أمريكي", {"kitchen": True, "balcony": True}, ()),
        ("سطح واسع مطبخ راكب بدواليب حديثة", {"kitchen": True}, ()),
        ("مطبخ 3 دورات مياه مدخلان للشقة تكييف سبيلت", {"air_conditioner": True}, ()),
        ("مدخل مكيف أنيق", {}, ("air_conditioner",)),
        ("مصعد راكب - تمديد نحاس للمكيفات - قريب من محطة الميترو", {"elevator": True}, ("air_conditioner",)),
        ("مطبخ (SPLIT) (غير راكب)", {"kitchen": False}, ()),
        ("مطبخ راكب ومكيفات راكبة", {"kitchen": True, "air_conditioner": True}, ()),
        ("بدون مكيفات ومطبخ", {"air_conditioner": False, "kitchen": False}, ()),
        ("بدون عمولة ومطبخ راكب", {"kitchen": True}, ()),
        # 🔬 2026-11-01 (ops_text_facts_conflicts): «يوجد» asserts; a REGA label is not a descriptor; a bill is not a supply
        ("بدون سطح يوجد مكيفات", {"air_conditioner": True, "roof": False}, ()),
        ("الخدمات: ماء، كهرباء النزاعات: لا يوجد", {"electricity": True}, ()),
        ("شقة للايجار لا يشمل الكهرباء والماء", {}, ("electricity", "water_supply")),
        ("لا يشمل الماء والكهرباء", {}, ("electricity", "water_supply")),
        ("الماء: غير شامل", {}, ("water_supply",)),
        ("المياه متوفرة (غير مشمولة)", {}, ("water_supply",)),
        ("لا يوجد كهرباء", {"electricity": False}, ()),
        ("مياه لا يوجد", {"water_supply": False}, ()),
        ("مطبخ راكب (غير شامل)", {}, ("kitchen",)),
        ("وصرف صحي (غير شامل)", {}, ("sanitation",)),
        ("بدون سطح يوجد موقف", {"parking": True}, ()),
        ("شقة غير مفروشة", {"furnished": False}, ()),
        ("unfurnished apartment", {"furnished": False}, ()),
        ("مصعد مؤسس", {}, ("elevator",)),
        ("تأسيس مسبح", {}, ("pool",)),
        ("يمكن عمل مسبح", {}, ("pool",)),
        ("مكان مخصص لمسبح", {}, ("pool",)),
        ("قريب من حديقة الحي والمسجد", {}, ("garden",)),
        ("بجوار المسجد والحديقة", {}, ("garden",)),
        ("حديقة خلفية", {"garden": True}, ()),
        ("غرفة كهرباء", {}, ("electricity",)),
        ("واصل كهرباء\nواصل مياه", {"electricity": True, "water_supply": True}, ()),
        ("خدمات العقار: كهرباء، مياه، صرف صحي", {"electricity": True, "water_supply": True, "sanitation": True}, ()),
        ("دورة مياه للضيوف", {}, ("water_supply",)),
        ("عداد كهرباء مستقل", {"separate_electricity_meter": True, "electricity": True}, ()),   # 2026-10-27: a meter is a supply
        ("عداد كهرباء ومياه مستقل", {"separate_electricity_meter": True, "separate_water_meter": True}, ()),
        ("لا يوجد عداد ماء", {}, ("water_supply",)),
        ("عداد الماء مشترك", {"separate_water_meter": False}, ()),
        ("شارع ٢٥", {}, ("street_width_m",)),
        ("شارع 25 م", {"street_width_m": 25.0}, ()),
        # bathrooms (backlog 1168): the count the ad states, never a pool, an outside toilet or a per-unit count
        ("ثلاث غرف نوم وثلاث دورات مياه", {"bathrooms": 3.0}, ()),
        ("دورتا مياه (2)", {"bathrooms": 2.0}, ()),
        ("صالة ودورتين مياه ومطبخ", {"bathrooms": 2.0}, ()),
        ("عدد دورات المياه: 4", {"bathrooms": 4.0}, ()),
        # 🔬 2026-11-05 yearly-rent bathroom audit: a labelled total is the total
        ("النوم ٤ من ضمنها غرفة ماستر\nالحمامات ٥\nمجلس ، صالة", {"bathrooms": 5.0}, ()),             # wasalt 481847
        ("عامله1 مجلس مستقل مع دورة مياه 1 مطبخ1 عدد دورات المياه 3 عمر العقار اربع سنوات", {"bathrooms": 3.0}, ()),  # haraj 18924617
        ("غرفة + ركن مطبخ + دورة مياه عدد دورات المياه : 1 1 مكيف سبيلت راكب", {"bathrooms": 1.0}, ()),  # haraj 18942937
        ("الحمامات 3 غرف نوم", {}, ("bathrooms",)),                                                       # the 3 is the rooms'
        ("• مجلس مستقل بدورة مياه • غرفة نوم ماستر • صالة • 3 دورات مياه", {}, ("bathrooms",)),          # 3 or 4: unstated
        ("غرفتين و2 حمام", {"bathrooms": 2.0}, ()),
        ("دورة مياه واحدة", {"bathrooms": 1.0}, ()),
        ("مسبح و حمام سباحة", {}, ("bathrooms",)),
        ("دورة مياه خارجية", {}, ("bathrooms",)),
        ("3 دورات مياه بكل شقة", {}, ("bathrooms",)),
        ("عمارة 8 شقق كل شقة 2 دورات مياه", {}, ("bathrooms",)),
        ("الدور الاول 3 دورات مياه والارضي دورتين مياه", {}, ("bathrooms",)),
        ("مجلس رجال . دورة مياه تخدم القسم الرجالي . 3 غرف نوم . 2دورة مياه .", {}, ("bathrooms",)),
        ("3 دورات مياه ودورة مياه خارجية", {"bathrooms": 3.0}, ()),
        # a numbered list's index is not a count (haraj 20997332, 2026-11-05)
        ("1-مدخل مستقل 2-حـوش طولي 3-غـرفه 4-دورة مـياه", {}, ("bathrooms",)),
        ("مميزات: 1) مجلس 2) صالة 3) دورات مياه 4) مطبخ", {}, ("bathrooms",)),
        ("الشقة: 3 غرف نوم - 2 دورات مياه - مطبخ راكب", {"bathrooms": 2.0}, ()),
        ("4 غرف و3 دورات مياه", {"bathrooms": 3.0}, ()),
        # …while the Saudi «N- room» style is a COUNT (real aqar ads 24033379, 23720768, 21604430, 23287543)
        ("مطبخ راكب 3- غرف 2-دورات مياة 1- صالة مكيفه بالكامل اسبلت", {"bathrooms": 2.0}, ()),
        ("المواصفات: 3-غرف 3-دورات مياه 1-مطبخ 1-صاله 2-خزان سفلي وعلوي مستقل 1-موقف سيارة خاص", {"bathrooms": 3.0}, ()),
        ("مكونات الشقه : ٣- غرف نوم ( ١ - ماستر) ٤- دورة مياه صاله يوجد منور", {"bathrooms": 4.0}, ()),
        ("مكونه من 2- غرف نوم 1- صالة 1- مجلس 2- دورة مياة 1- ارتداد خلفي 1- مطبخ مستقل", {"bathrooms": 2.0}, ()),
        ("عرض الشارع: 15", {"street_width_m": 15.0}, ()),
        ("زاوية على شارع 20م شرقي", {}, ("street_width_m",)),
        ("شارع 15 م شمالي، شارع 20 م غربي", {}, ("street_width_m",)),
        ("عرض الشارع 15 × 20", {}, ("street_width_m",)),
        ("يحدها 1 شارع: شمالية٬ بعرض 16 م", {"street_width_m": 16.0}, ()),
        ("يحدها 2 شارع: شمالية٬ بعرض 16 م، غربية٬ بعرض 12 م", {}, ("street_width_m",)),
        ("خزانة ملابس", {}, ("water_tank",)),
        ("خزان علوي وسفلي مستقل", {"water_tank": True}, ()),
        ("بير السلم", {}, ("well",)),
        ("مجلس كبير", {"majlis": True}, ("well",)),
        # corner / two streets is saved as its own fact, never as two entrances, and still refuses a street width
        ("أرض زاوية على شارعين 20م و15م", {"corner_plot": True}, ("two_entrances", "street_width_m")),
        ("فلة زاويه على شارعين", {"corner_plot": True}, ("two_entrances",)),
        ("ارض على ثلاث شوارع", {"corner_plot": True}, ("two_entrances",)),
        ("شقة بمدخلين", {"two_entrances": True}, ("corner_plot",)),
        ("بئر ارتوازي", {"well": True}, ()),
        ("مسطح البناء 300", {}, ("roof",)),
        ("سطح خاص", {"roof": True}, ()),
        ("نقبل الضمان الاجتماعي", {}, ("warranty",)),
        ("جميع الضمانات متوفرة", {"warranty": True}, ()),
        ("الضمانات ومدتها: لا يوجد", {"warranty": False}, ()),
        ("حمام ملحق بالغرفة", {}, ("annex",)),
        ("دورين وملحق", {"annex": True, "floors": 2.0}, ()),
        ("طريق مجلس التعاون", {}, ("majlis",)),
        ("مجلس رجال", {"majlis": True}, ()),
        ("عدد المجالس: 0", {"majlis": False}, ()),
        ("المطابخ: 1", {"kitchen": True}, ()),
        ("عمر العقار 5 سنوات", {"property_age_years": 5.0}, ()),
        ("عمر العقار أكثر من 10 سنوات", {}, ("property_age_years",)),
        ("ضمانات تصل الى 25 سنه", {"warranty": True}, ("property_age_years",)),
        ("عمر العقار: ten year", {"property_age_years": 10.0}, ()),
        ("مستودع للايجار", {}, ("storage",)),
        ("مطبخ مع مستودع", {"storage": True, "kitchen": True}, ()),
        ("حوش + كراج + مدخلين", {"yard": True, "garage": True, "parking": True, "two_entrances": True}, ()),
        ("For Rent | Yardville Compound Apartments", {}, ("yard",)),        # 🔬 2026-11-05 Property Finder: a compound's name
        ("villa with a private yard and a pool", {"yard": True}, ()),
        ("مدخل واحد", {"two_entrances": False}, ()),
        ("مكونة من 4 شقق", {"apartments_count": 4.0}, ()),
        ("يوجد في كل دور شقتين", {}, ("apartments_count",)),
        ("3 محلات تجارية", {"shops_count": 3.0}, ()),
        ("الاطوال 20 × 30", {"boundaries": "الاطوال 20 × 30"}, ()),
        ("صك الكتروني جاهز للافراغ", {"electronic_deed": True}, ()),
        ("مشب خارجي", {"grill": True}, ()),
        ("مواقف بدروم خاصة", {"basement": True, "parking": True}, ()),
        ("نادي رياضي رجالي ونسائي", {"gym": True}, ()),
        ("بالقرب من نادي رياضي", {}, ("gym",)),
        ("car park nearby", {}, ("parking",)),
        ("Pool and gym nearby", {}, ("pool", "gym")),
        ("swimming pool close by", {}, ("pool",)),
        ("private parking, gym nearby", {"parking": True}, ("gym",)),
        # bench-v1 (facts-words-bench-v1) false-yes classes and obvious misses, each a real ad's words
        ("الضمانات ومدتها: - الالتزامات الآخرى على العقار: لا", {}, ("warranty",)),   # a form LABEL, no value
        ("الضمانات و مدتها: لايوجد وصف موقع العقار", {"warranty": False}, ()),
        ("لضمان الخصوصية والأمان", {}, ("warranty",)),
        ("ضمان توفير مستأجر لمدة 5 سنوات", {}, ("warranty",)),
        ("الصمانات تصل الي 25سنه", {"warranty": True}, ()),
        ("شقة في شارع وادي الصمان", {}, ("warranty",)),
        ("مسجد وحديقة قريبه من العمارة", {}, ("garden",)),
        ("يوجد حديقة مع العاب اطفال مقابل العمارة", {}, ("garden",)),
        ("الوجهه :غرب حديقة", {}, ("garden",)),
        ("مخطط يحتوي على حدائق وشوارع", {}, ("garden",)),
        ("*خدمات قريبة* مسجد - حديقة - مدارس", {}, ("garden",)),
        ("جنوب: مواقف ثم شارع", {}, ("parking",)),
        ("باركينج خاص لكل شقة", {"parking": True}, ()),
        ("دورة مياه مستقلة", {}, ("separate_water_meter", "water_supply")),
        ("خزان المياه مستقل", {"water_tank": True}, ("separate_water_meter",)),
        # full run (facts-words-2026-10-25) hand check: a proclitic hid the bathroom — 900 rows repaired
        ("غرفة نوم بدورة مياه مستقلة", {}, ("separate_water_meter", "water_supply")),
        ("- مفروشة: لا يُعرف حي الأمل بأجوائه الهادئة", {"furnished": False}, ()),
        ("- **مفروش**: لا **المرافق:** - الكهرباء", {"furnished": False}, ()),
        ("جناح بحمام ومغسلة, لدورة مياه مستقلة", {}, ("separate_water_meter",)),
        ("خزانات وعدادات مستقلة", {"separate_electricity_meter": True}, ()),
        ("2دورات مياة موقف خاص", {"parking": True}, ("water_supply",)),
        ("1مجلس 1غرفة طعام 1مطبخ", {"majlis": True, "kitchen": True}, ()),
        ("خلف مخازن العناية", {}, ("storage",)),
        ("خدمات العقار: Electricity, Waters الضمانات ومدتها: لا يوجد",
         {"electricity": True, "water_supply": True, "warranty": False}, ()),
        ("لا يوجد مصعد, مياه حلوة", {"elevator": False}, ("water_supply",)),
        ("Floor has electricity and water Connections", {"electricity": True, "water_supply": True}, ()),
        ("شارع شرقي 15 الأطوال", {"street_width_m": 15.0}, ()),
        ("بشارع عرض 15 متر", {"street_width_m": 15.0}, ()),
        ("زاوية شارع شمالي 20 شرقي 15", {}, ("street_width_m",)),
        ("تتكون من اربع ادور", {"floors": 4.0}, ()),
        ("ثلاث ادور ونصف", {}, ("floors",)),
        ("عماره زاويه اربع شقق", {"apartments_count": 4.0}, ()),
        ("حاليا ثلاث شقق ماجره", {}, ("apartments_count",)),
        ("عمر العقار/ 5 سنين", {"property_age_years": 5.0}, ()),
        ("غرفة سائق موقف سياره 🚗 موقع مميز قريب من الخدمات وخلف المروه سنتر", {"parking": True, "driver_room": True}, ()),
        ("موقف سيارات قريب من البرج", {}, ("parking",)),
        ("عمرها ٦سنوات", {"property_age_years": 6.0}, ()),
        # bench-v2 hand check (facts-words-bench-v2): the lobby, a permit, the wiring brand, the zoning
        ("*مدخل مكيّف* *مصعدين*", {"elevator": True}, ("air_conditioner",)),
        ("توجد رخصة بناء تسوير وملاحق", {}, ("annex",)),
        ("رقم رخصة فال: 1200 مجلس", {"majlis": True}, ()),
        ("• نظام الكهرباء: الفنار • السباكة", {}, ("electricity",)),
        ("خدمات أخرى مثل المياه وتكييف الهواء ومواقف السيارات، حيث لم يتم ذكرها في العرض. مطبخ راكب",
         {"kitchen": True}, ("parking", "air_conditioner", "water_supply")),
        ("نظام البناء: سكني 3 ادوار", {}, ("floors",)),
        # PDPL: a neighbour's name in a boundaries cell drops the whole row; a street named after a person does not
        ("شمالاً: ملك فلان بن فلان بطول 20م، جنوباً: شارع بعرض 15م بطول 20م", {}, ("boundaries",)),
        ("الحدود: شمالا آل فلان بطول 20 جنوبا شارع بطول 20", {}, ("boundaries",)),
        ("الاطوال 20 × 30 على طريق الملك فلان بن فلان", {"boundaries": "الاطوال 20 × 30"}, ()),
        ("الدفع شهري", {"payment_monthly": True}, ()),
        ("لا نقبل الدفع الشهري", {"payment_monthly": False}, ()),
        ("مسبح خاص", {"pool": True}, ()),
        ("حوض سباحه", {"pool": True}, ()),
        ("الشقة لا تطل على مسبح", {}, ("pool",)),
        ("شقة بدون مصعد تطل على مسبح", {"pool": True}, ()),
        ("الشقة مطلة على المسبح البلدي", {}, ("pool",)),
        ("فيلا مطلة على مسبح مدفأ", {"pool": True, "heated_pool": True}, ()),
        ("المسبح موسس والمصعد راكب", {}, ("pool",)),
        ("بجوار موقف خاص", {}, ("parking",)),
        ("فيلا بمسبح سعرها قريب من مليون", {"pool": True}, ()),
        ("شقة قريبة من مسجد فيه موقف خاص تابع للمسجد", {}, ("parking",)),
        # AI teacher pass 2026-10-27 — the phrasings the paid reader found on ads the word reader had no row for
        ("مكونة من: 3 غرف واصل كهرباء واصل مياه", {"electricity": True, "water_supply": True}, ()),
        ("ماء وكهرب راكب", {"electricity": True, "water_supply": True}, ()),
        ("المرافق: - الكهرباء: إمدادات كهربائية موثوقة - إمدادات المياه: وصول مستمر إلى المياه",
         {"electricity": True, "water_supply": True}, ()),
        ("تشمل المرافق: - إمدادات الكهرباء لضمان الطاقة الموثوقة - إمدادات المياه للاحتياجات اليومية",
         {"electricity": True, "water_supply": True}, ("warranty",)),
        ("الإيجار يشمل الكهرباء والماء", {"electricity": True, "water_supply": True}, ()),
        ("شامل كهرب ومويه", {"electricity": True, "water_supply": True}, ()),
        ("موقف خاص عداد كهرباء المساحة 116متر", {"electricity": True, "parking": True}, ()),
        ("الكهرباء مستقل", {"separate_electricity_meter": True, "electricity": True}, ()),
        ("عداد كهرباء مشترك", {"separate_electricity_meter": False}, ("electricity",)),
        ("رسوم عداد كهرباء على المشتري", {}, ("electricity",)),
        ("تأسيس عداد الكهرباء", {}, ("electricity",)),
        ("مجدد فيها الكهرباء والسباكة", {}, ("electricity",)),
        ("عدادين كهرباء", {"separate_electricity_meter": True, "electricity": True}, ()),
        ("عدد 2 عداد كهرباء", {"separate_electricity_meter": True}, ()),
        ("عداد كهرباء لكل دور", {"separate_electricity_meter": True}, ()),
        ("عداد كهربائي مستقل", {"separate_electricity_meter": True}, ()),
        ("عدادات مستقلة لكل شقة", {"separate_electricity_meter": True}, ("electricity",)),
        ("الضمانات ومدتها: متوفرة الضمانات", {"warranty": True}, ()),
        ("الضمانات ومدتها: 10 سنوات التعاونيه للتامين", {"warranty": True}, ()),
        ("الضمانات ومدتها: لا يوجد", {"warranty": False}, ()),
        ("تأمين ضد العيوب الخفية", {"warranty": True}, ()),
        ("تأمين التعاونية عشر سنوات", {"warranty": True}, ()),
        ("براكنق خاص بالدور الثاني", {"parking": True}, ()),
        ("جناح خادمة مع غرفة غسيل", {"maid_room": True}, ()),
        ("غرفة نوم للخادمة", {"maid_room": True}, ()),
        ("قسم للشغاله غرفه وحمام", {"maid_room": True}, ()),
        ("بأثاثها العصري والأنيق", {"furnished": True}, ()),
        ("تشطيب فاخر وفرش راقٍ جدًا", {"furnished": True}, ()),
        ("يوجد بعض الاثاث", {}, ("furnished",)),
        ("مكيف سبليت", {"air_conditioner": True}, ()),
        ("غرفة خادمة مع دورة مياه", {"maid_room": True}, ("water_supply",)),
        ("حي المشرفة", {}, ("balcony",)),
        ("ارض للبيع حي الخزان مدينة تربة", {}, ("water_tank",)),
        ("فيلا بحي الحديقة بالمدينة المنورة", {}, ("garden",)),
        ("شقة للايجار في حي المستودعات", {}, ("storage",)),
        ("شقة في حي الشرفة", {}, ("balcony",)),
        ("فيلا مع حديقة خاصة وخزان ماء", {"garden": True, "water_tank": True}, ()),
        ("شقة كبيرة", {}, ("well",)),
        # ── the 28 apartment chips (owner 2026-10-31): one yes each, the old guards still hold ──
        ("شقة بنظام دخول ذاتي", {"self_checkin": True}, ()),
        ("self check-in with smart lock", {"self_checkin": True, "smart_entry": True}, ()),
        ("قفل ذكي ودخول ذكي", {"self_checkin": True, "smart_entry": True}, ()),
        ("واي فاي مجاني", {"wifi": True}, ()),
        ("شقة مع إنترنت وتلفزيون", {"wifi": True}, ()),
        ("مع النت والكهرباء", {"wifi": True}, ()),
        ("بدون واي فاي", {"wifi": False}, ()),
        ("لا يوجد انترنت", {"wifi": False}, ()),
        ("مفروشة بالكامل", {}, ("wifi",)),                         # «نت» never fires inside another word
        ("شامل الكهرباء والماء", {"bills_included": True}, ()),
        ("الإيجار يشمل الفواتير", {"bills_included": True}, ()),
        ("الفواتير مشمولة بالإيجار", {"bills_included": True}, ()),
        ("الكهرباء على المالك", {"bills_included": True}, ()),
        ("bills included", {"bills_included": True}, ()),
        ("غير شامل الكهرباء", {"bills_included": False}, ()),
        ("كهرباء وماء", {}, ("bills_included",)),
        ("واصل كهرباء وماء", {}, ("bills_included",)),
        ("شقة بجاكوزي خاص", {"jacuzzi": True}, ()),
        ("بدون جاكوزي", {"jacuzzi": False}, ()),
        ("شاشة ذكية في كل غرفة", {"smart_tv": True}, ()),
        ("غرفة سينما مع بروجكتر", {"smart_tv": True}, ()),
        ("طاولة بلياردو", {"billiards": True}, ("pool",)),
        ("pool table and gym", {"billiards": True, "gym": True}, ("pool",)),
        ("خدمة تنظيف يومية", {"cleaning_service": True}, ()),
        ("housekeeping included", {"cleaning_service": True}, ()),
        ("جدران عازلة للصوت", {"soundproof": True}, ("insulation",)),
        ("عزل صوتي ممتاز", {"soundproof": True}, ()),
        ("كاميرات مراقبة على مدار الساعة", {"cameras": True}, ()),
        ("بدون كاميرات", {"cameras": False}, ()),
        ("حارس للعمارة", {"guard": True}, ()),
        ("أمن وحراسة 24 ساعة", {"guard": True}, ()),
        ("غرفة حارس", {"guard": True}, ()),
        ("مدخل ذكي", {"smart_entry": True}, ("self_checkin",)),
        ("نظام سمارت هوم", {"smart_home": True}, ()),
        ("نظام المنزل الذكي", {"smart_home": True}, ()),
        ("تمديد غاز مركزي", {"central_gas": True}, ()),
        ("خزان غاز طبيعي", {"central_gas": True}, ("water_tank",)),
        ("ساونا وغرفة بخار", {"sauna": True}, ()),
        ("منطقة ألعاب أطفال", {"kids_play_area": True}, ()),
        ("ملعب للأطفال", {"kids_play_area": True}, ()),
        ("قريب من ملعب أطفال", {}, ("kids_play_area",)),
        ("حضانة أطفال داخل المجمع", {"nursery": True}, ()),
        ("قريب من حضانة", {}, ("nursery",)),
        ("خدمات قريبة: حضانة - مسجد", {}, ("nursery",)),
        ("صيانة مجانية طوال السنة", {"free_maintenance": True}, ()),
        ("الصيانة على المالك", {"free_maintenance": True}, ()),
        ("انتركوم مرئي", {"intercom": True}, ()),
        ("إنتركم", {}, ()),                                         # a lone word is never a fact
        ("نظام إطفاء حريق وكاشف دخان", {"fire_system": True}, ()),
        ("طفايات حريق في كل دور", {"fire_system": True}, ()),
        ("شاحن سيارات كهربائية", {"ev_charger": True}, ()),
        ("ev charger in the garage", {"ev_charger": True, "garage": True}, ()),
        ("مكنسة مركزية", {"central_vacuum": True}, ()),
        ("عزل حراري ومائي", {"insulation": True}, ("soundproof",)),
        ("عوازل حرارية", {"insulation": True}, ()),
        ("عازل", {}, ("insulation", "soundproof")),
        ("مقلط ومجلس رجال", {"dining_majlis": True, "majlis": True}, ()),
        ("صالة طعام واسعة", {"dining_majlis": True}, ()),
        ("مجلس طعام", {"dining_majlis": True}, ("majlis",)),
        ("غرفة نوم بحمام خاص", {"own_bathroom": True}, ()),
        ("دورة مياة خاصة", {"own_bathroom": True}, ("water_supply",)),
        ("ثلاجة وغسالة", {"fridge": True, "laundry_room": True}, ()),
        ("بدون ثلاجه", {"fridge": False}, ()),
        ("غسالة ملابس", {"laundry_room": True}, ()),
        ("washing machine", {"laundry_room": True}, ()),
        ("غسالة صحون", {}, ("laundry_room",)),
        # a view list's gym is not the unit's (P2 13085, aqar 15128626 / 15017191, 2026-11-06)
        ("* إطلالة ونافذة على: حديقة، جامع، ونادي صحي خدمات الموقع القريبة: * مدارس تعليمية", {}, ("gym", "mosque", "garden")),
        # …and with the rest of the REAL ad after it: «مميزات المشروع» eight bullets later is not the gym's owner (🔬 2026-11-07)
        ("* إطلالة ونافذة على: حديقة، جامع، ونادي صحي خدمات الموقع القريبة: * مدارس تعليمية * سوبر ماركت * مطاعم "
         "الضمانات والمواصفات العالية > تطبيق أعلى معايير الجودة * 1 سنة: اتحاد ملاك مجاناً مميزات المشروع والخدمات الفاخرة "
         "* التصميم والتشطيب: تصميم مودرن", {}, ("gym", "mosque", "garden")),
        # a project's own «*» list stays its own (aqar 14840793, 12107689)
        ("مميزات المجمع: * مسبح * صالة رياضية * حضانة أطفال * مواقف سيارات", {"gym": True, "pool": True}, ()),
        ("✓ تأثيث فاخر ومتكامل ✓ مطبخ مجهز بالكامل ✓ خدمات فندقية ونادي صحي ومسبح ✓ أمن وحراسة", {"gym": True}, ()),
        ("قريب من الخدمات، مدرسة كبيرة للبنات والشقة بها نادي رياضي", {"gym": True}, ()),
        ("قريب من الخدمات، مدرسة فيها نادي رياضي، مسجد", {}, ("gym", "mosque")),
        ("واجهة شمالية ونادي رياضي خاص", {"gym": True}, ()),
        ("واجهة شمالية على ملعب كرة قدم خاص بالحي", {}, ("football_pitch", "sports_court")),
        ("واجهة شمالية ونادي رياضي لسكان الحي", {}, ("gym",)),
        ("واجهة شمالية ونادي رياضي مستقل للفيلا", {"gym": True}, ()),
        ("واجهة شمالية ونادي رياضي لسكان المدينة", {}, ("gym",)),
        ("واجهة شمالية ونادي رياضي لسكان المنطقة", {}, ("gym",)),
        ("واجهة شمالية ونادي رياضي خاص للفيلا بالحي", {"gym": True}, ()),
        ("قريب من الخدمات، نادي رياضي مستقل للفيلا", {"gym": True}, ()),
        ("قريب من الخدمات، نادي رياضي خاص بالحي، مسجد", {}, ("gym", "mosque")),
        ("البرج جديد ويوجد به نادي رياضي وكذلك مسبح", {"gym": True}, ()),
        ("قريب من الخدمات، نادي رياضي لسكان المبنى", {"gym": True}, ()),
        ("قريب من الخدمات، مدرسة، جيم، مسجد", {}, ("gym", "mosque")),
        # P2 13085 (2026-11-06), real served sentences
        ("فرصة استثماريه للبيع عمارة مكه المكرمة حي العدل الغسالة العقار عمره 21 سنه", {}, ("laundry_room",)),
        ("شقة للإيجار بمكة المكرمة حي العدل الغساله العليا ٤ غرف الدور الاول ركنيه مصعد", {}, ("laundry_room",)),
        ("عمارة للبيع مكة حي العدل - الغسالة عمرها 10 سنوات", {}, ("laundry_room",)),
        ("شقة للإيجار مكة العدل، الغسالة الدور الثاني", {}, ("laundry_room",)),
        ("ستوديو غرفة مع بوفية ودورة مياه مؤثث بالكامل مع توفر الغسالة والثلاجة", {"laundry_room": True}, ()),
        ("السعر مليون 700 الف للزاويه مليون 650 الف للبطن قابل للتفاوض", {}, ("corner_plot",)),
        ("السعر مليون و ٢٥٠ للبطون ومليون و٣٥٠ للزاوية", {}, ("corner_plot",)),
        ("💰 السعر: 390,000 ريال (سعر موحد للزاوية والشارع)", {}, ("corner_plot",)),
        ("🏢 اختر مساحة العمل التي تناسب نجاحك ابدأ أعمالك من مكتب جاهز", {}, ("coworking",)),
        ("3- مساحة العمل ( Workspace ) مساحة : ٨٦.٢٩م2", {}, ("coworking",)),
        ("مساحات عمل مشتركة ومكاتب خاصة", {"coworking": True}, ()),
        ("مساحة عمل مشتركة", {"coworking": True}, ()),
        # the pool a room overlooks is the home's (🔬 2026-11-06 two-way sample, aqar 6645260 / 8036456 / 14871554)
        ("الدور الأرضي مجلس رجال 🔘 صاله كبيره مطله على المسبح🔘 مطبخ 🔘 دورات مياة", {"pool": True}, ()),
        ("الصاله مفتوحه على الدرج . * ملحق كبير مطل على المسبح . * مواقف سيارات", {"pool": True}, ()),
        ("دوبلكس للبيع تصميم عصري مع صالات واسعة وإطلالة على المسبح!", {"pool": True}, ()),
        ("قريب من مسبح الأولمبي", {}, ("pool",)),
        ("موقف سياره يتسع لسيارتين مسبح تأسيس مصعد تكييف دكت", {"pool": True}, ("elevator",)),   # aqar 17595
        ("حوش امامي وخلفي فيه مسبح مؤسس", {}, ("pool",)),
        ("امكانية اضافة مسبح السعر", {}, ("pool",)),
        # «خاص» right after the parking: the home's, whatever distance list came before (dealapp 23282670, 2026-11-06)
        ("وعن محطة المترو المسار الازرق (بنك ساب) ٧ دقائق موقف خاص جميع الخدمات متوفره", {"parking": True}, ()),
        ("دقيقتين عن المول موقف خاص بالشقة", {"parking": True}, ()),
        ("قريب من مواقف خاصة بالمول", {}, ("parking",)),
        ("قريب من موقف خاص", {}, ("parking",)),
        # a price / sale word starts a new subject: «والبيع قريب» is the sale, not a nearby pool (aqar 41587, 2026-11-06)
        ("ونخل وبير ماء ومسبح السوم مليون والبيع قريب مكتب اتحاد النجاح للعقارات", {"pool": True}, ()),
        ("وبالقرب من الجامع السوم ١٨٥ والبيع قريب باذن الله", {}, ("mosque",)),
        ("✅ لا يوجد مصعد. ✅ لا يوجد موقف خاص داخل العقار.", {"parking": False}, ()),
        ("دور كامل للإيجار", {"whole_floor": True}, ()),
        ("شقة في الدور الأول", {}, ("whole_floor",)),
        ("للعزاب فقط", {"singles": True}, ()),
        ("مسموح للعزاب", {"singles": True}, ()),
        ("غير مسموح للعزاب", {"singles": False}, ()),
        ("ممنوع العزاب", {"singles": False}, ()),
        ("سكن عوائل", {"families": True}, ()),
        ("للعوائل فقط", {"families": True}, ("singles",)),
        ("لا نقبل العوائل", {"families": False}, ()),
        # the villa facts (owner 2026-11-01): said → yes, negated → no, nearby / prepared / a place name → nothing
        ("مجلس نساء ومجلس رجال", {"women_majlis": True, "majlis": True}, ()),
        ("مجلس حريم مستقل", {"women_majlis": True}, ()),
        ("فيلا بدون مجلس نسائي", {"women_majlis": False}, ()),
        ("حديقة بنظام ري آلي", {"irrigation": True, "garden": True}, ()),
        ("شبكة ري بالتنقيط", {"irrigation": True}, ()),
        ("حديقة بدون نظام ري", {"irrigation": False}, ()),
        ("يمكن عمل نظام ري", {}, ("irrigation",)),
        ("ملعب تنس خاص", {"sports_court": True}, ()),
        ("ملعب كرة قدم", {"sports_court": True}, ()),
        ("فيلا مع ملعب ومسبح", {"sports_court": True, "pool": True}, ()),
        ("لا يوجد ملعب", {"sports_court": False}, ()),
        ("قريب من ملاعب الحي", {}, ("sports_court",)),
        ("ملعب أطفال", {"kids_play_area": True}, ("sports_court",)),
        ("مطبخ خارجي ومطبخ داخلي", {"outdoor_kitchen": True, "kitchen": True}, ()),
        ("مطبخ خارجى", {"outdoor_kitchen": True}, ()),
        ("بدون مطبخ خارجي", {"outdoor_kitchen": False}, ()),
        ("ديوانية خارجية", {"outdoor_diwaniya": True}, ()),
        ("ديوانيه خارجيه مع مشب", {"outdoor_diwaniya": True, "grill": True}, ()),
        ("لا توجد ديوانية خارجية", {"outdoor_diwaniya": False}, ()),
        ("شلال ومسبح", {"waterfall": True, "pool": True}, ()),
        ("حديقة بها شلالات", {"waterfall": True}, ()),
        ("بدون شلال", {"waterfall": False}, ()),
        ("بئر ماء", {"well": True}, ()),
        ("بدون بئر", {"well": False}, ()),
        # ── GROUP A (owner handoff 2026-11-01): two yeses (a spelling variant among them), one no / near-miss each ──
        ("الإيجار على دفعات", {"split_payments": True}, ()),
        ("دفعتين سنوياً", {"split_payments": True}, ()),
        ("الدفع شهري", {"split_payments": True, "payment_monthly": True}, ()),
        ("الإيجار دفعة واحدة", {"split_payments": False}, ()),
        ("مسبح مدفأ", {"heated_pool": True, "pool": True}, ()),
        ("مسبح دافي للشتاء", {"heated_pool": True}, ()),
        ("مسبح بدون تدفئة", {}, ("heated_pool",)),
        ("مسبح أطفال ومسبح كبير", {"kids_pool": True, "pool": True}, ()),
        ("مسبح للأطفال", {"kids_pool": True}, ()),
        ("بدون مسبح للأطفال", {"kids_pool": False}, ()),
        ("زحليقة مائية", {"water_slide": True}, ()),
        ("زحاليق مائيه والعاب مائية", {"water_slide": True}, ()),
        ("بدون زحليقه", {"water_slide": False}, ()),
        ("إطلالة بحرية مباشرة", {"sea_view": True}, ()),
        ("شاليه على البحر مع شاطئ خاص", {"sea_view": True}, ()),
        ("قريب من البحر", {}, ("sea_view",)),
        ("يبعد 5 دقائق عن البحر", {}, ("sea_view",)),
        ("ملعب كرة قدم", {"football_pitch": True, "sports_court": True}, ()),
        ("ملعب صابوني", {"football_pitch": True}, ()),
        ("قريب من ملعب كرة", {}, ("football_pitch",)),
        ("بلايستيشن 5", {"playstation": True}, ()),
        ("بلاي ستيشن وسوني", {"playstation": True}, ()),
        ("شاشة سوني", {}, ("playstation",)),
        ("نطيطة للأطفال", {"inflatable_games": True}, ()),
        ("ألعاب هوائية وترامبولين", {"inflatable_games": True}, ()),
        ("بدون نطيطه", {"inflatable_games": False}, ()),
        ("نظام صوتي متكامل", {"sound_system": True}, ()),
        ("سماعات وسبيكر", {"sound_system": True}, ()),
        ("لا يوجد سماعات", {"sound_system": False}, ()),
        ("جلسة نار وحطب", {"fire_pit": True}, ()),
        ("موقد خارجي", {"fire_pit": True}, ()),
        # 🔬 2026-11-09: «تسليك» (conduits laid) is a preparation, not fitted AC — real sentences
        ("مكونه من 3غرف +3حمامات + مطبخ امريكي مع صاله الشقه يوجد بها تسليك مكيف اسبلت للصاله", {}, ("air_conditioner",)),
        ("منتهي من الكهرباء واللياسه والسباكه وتسليك تكيف سبيلت اللياسه داخلي وخارجي", {}, ("air_conditioner",)),
        ("ملاحظه :تسليك المكيفات جميعها اسبلت كذلك الفله بناء شخصي", {}, ("air_conditioner",)),
        ("المواصفات أرضيات سيراميك أسقف جبس دش مركزي مصعد خدمة انترنت حمامات تسليك التكييف جاهز كاميرات مراقبة", {}, ("air_conditioner",)),
        # … while fitted AC beside the conduits still reads yes
        ("جميع المكيفات المركبة من ماركة جري نوع كونسيل وجميع تسليك مكيفات الغرفة مجهزة لنظام السبلت", {"air_conditioner": True}, ()),
        ("مكيفات راكبة وتسليك إنترنت", {"air_conditioner": True}, ()),   # CodeRabbit on #11470
        ("مكيفات راكبة وتسليك واي فاي", {"air_conditioner": True}, ()),
        ("مطبخ راكب ومكيفات راكبة وتسليك دش", {"air_conditioner": True, "kitchen": True}, ()),
        # 🔬 2026-11-09 (P2 13085): «لاستقبالك» is a welcome, «للحمامات» work for the home's bathrooms — real aqar sentences
        ("لا تشيل هم التجهيز… بيتك شبه مكتمل وجاهز لاستقبالك 🌟", {}, ("reception",)),
        ("شقة متكاملة تجمع بين الراحة والخصوصية وسهولة المعيشة، وجاهزة لاستقبالك!", {}, ("reception",)),
        ("🔑 أحضر حقائبك… شقتك جاهزة لاستقبالك!", {}, ("reception",)),
        ("👈عزل مائي للحمامات والمطابخ 👈عزل حرارى للسطوح", {}, ("toilets_on_site",)),
        ("🔸️تم عمل العازل للحمامات بالكامل.", {}, ("toilets_on_site",)),
        ("🔸️تم الانتهاء من عمل فرشة النظافه لكامل الدور . 🔸كيشاني الحمامات جاهز.", {}, ("toilets_on_site",)),
        ("• مكيفات راكبة ❄️ • سخانات للحمامات والمطبخ • موقف سيارة خاص في القبو", {}, ("toilets_on_site",)),
        ("كاميرات مراقبة لحماية العقار. 🎥 شبوك طاردة للحمام. جميع الخدمات واصلة", {}, ("toilets_on_site",)),   # pigeons
        ("موقد غاز في المطبخ", {}, ("fire_pit",)),
        # 🔬 2026-11-08: the kitchen cooktop is not a fire pit (28 of 30 served apartment «موقد» yeses) — real sentences
        ("المطبخ والأجهزة: - 6 مكيفات سبليت. - ميكروويف. - شواية. - موقد سيراميكي. - جميع الأجهزة إيطالية الصنع", {}, ("fire_pit",)),
        ("مطبخ مفتوح ومجهز بالفرن والموقد وغسالة الصحون وغسالة الملابس", {}, ("fire_pit",)),
        ("مطبخ متكامل يحتوي على ثلاجة، فرن، مايكرويف، موقد، غسالة، وغلاية", {}, ("fire_pit",)),
        ("مطبخ كامل بجميع الأجهزة الكهربائية وأدوات الطبخ ومنها فرن كهربائي أو ميكرويف ، موقد أربعة عيون كهربائي، ثلاجة كبيرة", {}, ("fire_pit",)),
        ("مطبخ راكب + موقد و شفاط - مجهزه كامل الشقة بمكيفات اسبلت", {}, ("fire_pit",)),
        ("ومطبخ يحتوي على موقد مسطح ,ثلاجة , مايكرو ويف وايضا على دورتين مياة", {}, ("fire_pit",)),
        ("تحتوي على مكيف جديد وحمام مع سخان ومطبخ راكب وخزانة كبيرة ومؤثثة سرير مع مرتبة وغاز وموقد عينين", {}, ("fire_pit",)),
        # … while a fire cue keeps it, even inside a kitchen list
        ("ومطبخ مجهز بثلاجة وغلاية وفرن وفريزر وموقد حطب، بالإضافة إلى دورات مياه", {"fire_pit": True}, ()),
        ("ومطبخ متوفر به فرن,ثلاجه,غلايه وفريزر مستقل و العديد من المرافق مثل ركن شواء,موقد حطب,مسطح اخضر", {"fire_pit": True}, ()),
        ("وادوات نظافة وجلسة خارجية مع موقد نار وادواتة التراثية", {"fire_pit": True}, ()),
        ("المكان مزود بغرفة مستقلة تحتوي على موقد (مشب) يضفي لمسة دفء", {"fire_pit": True}, ()),
        # 🔬 2026-11-09: «موقد نار» inside a kitchen list is the burner (9 of 21 served home «موقد» yeses) — real sentences
        ("يتوفر ايضا اجهزة الطبخ : ميكرويف ثلاجة صغيرة وموقد نار وغلاية الدورؤالأول فوق الأرضي", {}, ("fire_pit",)),
        ("ومكرويف وموقد نار للطبخ وغسالة ملابس ومنشر ملابس", {}, ("fire_pit",)),
        ("- المطبخ : يحتوي على صحون , ملاعق , شوكة , قدور , كاسات , موقد نار - أدوات السلامة : كاشف دخان", {}, ("fire_pit",)),
        ("مطبخ مجهز بالكامل (موقد نار كهريائي . غلاية ماء . ميكرويف . ثلاجة فيريزر غسالة ملابس )", {}, ("fire_pit",)),
        ("مؤثثه يوجد بها دوره مياه سرير مكيف سخان مياه اسطوانه غاز موقد نار ثلاجه مدخل خاص ومستقل", {}, ("fire_pit",)),
        ("وصاله مطله على المسبح وشاشه 75 بوصه اشتراك نتفلكس مطلخ متكامل ب موقد نار وغلايه", {}, ("fire_pit",)),
        # … while «نار» beside a seating / outdoor word, or a strong fire word, keeps the fire pit
        ("4-جلسة خارجية كراسي مرتفعه مع موقد نار 5- جلسة ارضية مع موقد نار 6-دورتين مياه ومغسلتين ومطبخ", {"fire_pit": True}, ()),
        ("عبارة عن خيمتين فيها مشب وموقد نار ودفاية وجلسة خارجية ومطبخ فية اوني طبخ الذبائح", {"fire_pit": True}, ()),
        ("يتميز الاستوديو بمدفأة داخلية، وموقد نار خارجي، ومطبخ مجهز بالكامل، وعوازل صوتية", {"fire_pit": True}, ()),
        # CodeRabbit on #11295: a seating word must not veto a cooktop, and the previous SENTENCE lends no stove word
        ("جلسة خارجية، مطبخ مجهز بموقد سيراميكي", {}, ("fire_pit",)),
        ("مطبخ فيه فرن.\nموقد حجري في الصالة", {"fire_pit": True}, ()),
        ("مطبخ فيه فرن! موقد حجري في الصالة", {"fire_pit": True}, ()),
        # 1507: a carried nearby-services heading runs up to the first own cue, not «all or nothing» (aqar 13447339)
        ("شقة مميزة في موقع ممتاز ومخدوم، بالقرب من جميع الخدمات التي تحتاجها، وتشمل: 🕌 جامع 🛒 سوبرماركت 🍽️ مطاعم 🌿 حديقة 💊 صيدلية 🧺 مغسلة 📚 قرطاسية 🏢 مميزات العمارة: • عمارة هادئة", {}, ("garden", "mosque", "market")),
        ("بالقرب من جميع الخدمات، وتشمل: مسجد وبقالة 🏢 مميزات المجمع يوجد حديقة خاصة", {"garden": True}, ("mosque",)),
        ("موقد حجري في الصالة؟ مطبخ فيه فرن", {"fire_pit": True}, ()),
        ("بيت شعر كبير", {"bait_shaar": True}, ()),
        ("خيمة شعر", {"bait_shaar": True, "tent": True}, ()),
        ("بدون بيت شعر", {"bait_shaar": False}, ()),
        ("حفرة مندي", {"mandi_pit": True}, ()),
        ("مندي وتنور", {"mandi_pit": True}, ()),
        ("مطعم مندي قريب", {}, ("mandi_pit",)),
        ("جلسة خارجية", {"outdoor_seating": True}, ()),
        ("جلسات أرضية وجلسه عربية", {"outdoor_seating": True}, ()),
        ("بدون جلسة خارجية", {"outdoor_seating": False}, ()),
        ("خيمة كبيرة", {"tent": True}, ()),
        ("خيام للضيوف", {"tent": True}, ()),
        ("لا توجد خيمه", {"tent": False}, ()),
        ("إطلالة على الرمال", {"dunes_view": True}, ()),
        ("طعوس ونفود", {"dunes_view": True}, ()),
        ("حي الرمال", {}, ("dunes_view",)),
        ("قسم نساء مستقل", {"women_section": True}, ()),
        ("جناح للنساء", {"women_section": True}, ()),
        ("بدون قسم نساء", {"women_section": False}, ()),
        ("قسمين منفصلين", {"two_sections": True}, ()),
        ("قسم رجال وقسم نساء", {"two_sections": True, "women_section": True}, ()),
        ("جناحين نوم ماستر", {}, ("two_sections",)),
        ("صالة مناسبات", {}, ("for_events",)),
        ("قاعة أفراح", {"events_hall": True}, ()),
        ("قريب من قاعة مناسبات", {}, ("events_hall", "for_events")),
        ("سواتر على كامل الحدود", {"privacy_screen": True}, ()),
        ("خصوصية تامة ومستورة", {"privacy_screen": True}, ()),
        ("بدون ساتر", {"privacy_screen": False}, ()),
        ("أشجار كثيرة", {"trees": True}, ()),
        ("مزرعة مشجرة", {"trees": True}, ()),
        ("مزروعة نخيل", {"trees": True, "palms": True}, ()),
        ("بدون أشجار", {"trees": False}, ()),
        ("للعوائل فقط", {"for_families": True, "families": True}, ()),
        ("شاليه عائلي", {"for_families": True}, ()),
        ("غير مسموح للعوائل", {"for_families": False}, ()),
        ("للشباب فقط", {"for_youth": True}, ()),
        ("مناسب للعزاب", {"for_youth": True, "singles": True}, ()),
        ("ممنوع الشباب", {"for_youth": False}, ()),
        ("شارع الشباب", {}, ("for_youth",)),
        ("للمناسبات والحفلات", {"for_events": True}, ()),
        ("حفلات تخرج وعيد ميلاد", {"for_events": True}, ()),
        ("لا نقبل المناسبات", {"for_events": False}, ()),
        ("للعرسان", {"for_newlyweds": True}, ()),
        ("مناسب لشهر العسل", {"for_newlyweds": True}, ()),
        ("بدون عرسان", {"for_newlyweds": False}, ()),
        ("دباب وبانشي", {"quad_bikes": True}, ()),
        ("دبابات للتأجير", {"quad_bikes": True}, ()),
        ("بقي شقة واحدة", {}, ("quad_bikes",)),
        ("اسطبل خيل", {"horses_stable": True}, ()),
        # 🔬 2026-11-08 P2 13085: English «stable» is an adjective in investment ads (aqar 6981031, 15537845, maqrat 13605153)
        ("Ideal opportunity for investors seeking stable returns", {}, ("horses_stable",)),
        ("Suitable for investment and generating stable annual income", {}, ("horses_stable",)),
        ("Farm with horse stables and a guest house", {"horses_stable": True}, ()),
        ("ركوب الخيل", {"horses_stable": True}, ()),
        ("خيول للركوب", {"horses_stable": True}, ()),
        ("مزرعة الخيليين", {}, ("horses_stable",)),
        # P2 13085 «الخيل» (🔬 2026-11-14): a possible use or an activity list is not horses on the plot
        ("الأرض مثالية لمشاريع المستودعات، اسطبلات الخيل، المزارع، أو الاستراحات", {}, ("horses_stable",)),   # aqar 1769697
        ("مساحات واسعة و كبيرة لمزوالة الأنشطة المختلفة كركوب الخيل!", {}, ("horses_stable",)),             # haraj 27188602
        ("ولعشاق الخيل… نوفر تجربة ركوب حصان مجاناً داخل المضمار", {"horses_stable": True}, ()),           # gathern 21147934
        ("مخيم لقضاء أجواء ممتعة مع الخيل", {"horses_stable": True}, ()),                                   # gathern 21144915
        ("الأنشطة المتوفرة داخل المخيم تشمل ركوب الخيل", {"horses_stable": True}, ()),                    # CodeRabbit #12188
        ("أرض مثالية للاستثمار، يوجد اسطبل خيل", {"horses_stable": True}, ()),                             # CodeRabbit #12188
        ("مناسب للعائلات، خيل للركوب", {"horses_stable": True}, ()),                                       # CodeRabbit #12188
        ("مناسبة لعدة أنشطة استثمارية: 🔹 منتجع سياحي وتأجير يومي 🔹 شاليهات ريفية للعوائل 🔹 مشروع فعاليات ومناسبات خاصة",
         {}, ("for_events",)),                                                                             # dealapp 24545744
        ("تصلح لإقامة مشروع قصور أفراح ومناسبات أو أي مشروع استثمار", {}, ("for_events",)),               # dealapp 21597198
        ("استراحة تصلح للمناسبات والحفلات", {"for_events": True}, ()),                                     # suitable for events = the chip
        ("وسماعه تصلح للمناسبات (المكان يعتبر قسمين بمدخل واحد) يوجد حواجز لفصل القسمين المسبح غير مجهز", {}, ("pool",)),  # aqarmonthly 14439308
        ("مسبح غير مجهز حظيرة ماشية باب كراج شرائح", {}, ("pool",)),                                       # ialqarawi 12594693
        ("مسبح غير مستخدم، مع إمكانية ردمه والاستفادة من مساحته", {"pool": True}, ()),                    # aqar 12069307: it exists
        ("منطقة انتضار واستقبال مبردة _مسبح وجم وغرفة رعاية اطفال", {"pool": True}, ()),                  # dealapp 21612879: «_» is a bullet
        ("2 غرف نوم ماستر _مطبخ _ سطح _ مدخل سيارة", {"kitchen": True}, ()),                                # dealapp 22671555
        ("🛗 مصعد جاهز أو تأسيس مرحلة أولى حسب تجهيز الوحدة", {}, ("elevator",)),                         # aqarcity 9340308
        ("مصعد راكب أو حسب الطلب", {"elevator": True}, ()),                                                   # «أو» alone is not prepared
        ("شاليه كبير للعائلة ويخدم كثيراً الجمعات العائلية ومناسبات الخطوبة والملكة", {"for_events": True}, ()),  # gathern 21142142
        ("إبل وهجن", {"camels": True}, ()),
        ("ركوب الجمال", {"camels": True}, ()),
        ("مكان جمال", {}, ("camels",)),
        ("دورات مياه للرجال والنساء", {"toilets_on_site": True}, ("water_supply",)),
        ("حمامات خارجية", {"toilets_on_site": True}, ()),
        ("حمام سباحة خاص", {}, ("toilets_on_site",)),
        ("إنارة كاملة", {"lighting": True}, ()),
        ("انارة واضاءة ليلية", {"lighting": True}, ()),
        ("إضاءة طبيعية", {}, ("lighting",)),
        ("بئر ارتوازي", {"artesian_well": True, "well": True}, ()),
        ("بير ارتوازي عميق", {"artesian_well": True}, ()),
        ("بدون بئر ارتوازي", {"artesian_well": False}, ()),
        ("طاقة شمسية", {"solar_power": True}, ()),
        ("ألواح شمسيه", {"solar_power": True}, ()),
        ("بدون طاقة شمسية", {"solar_power": False}, ()),
        ("نخيل منتج", {"palms": True}, ()),
        ("50 نخلة", {"palms": True}, ()),
        ("حي النخيل", {}, ("palms",)),
        ("أشجار مثمرة", {"fruit_trees": True, "trees": True}, ()),
        ("ليمون وزيتون", {"fruit_trees": True}, ()),
        ("حي الزيتون", {}, ("fruit_trees",)),
        ("مزروعة برسيم", {"fodder_crops": True, "trees": True}, ()),
        ("أعلاف وقمح", {"fodder_crops": True}, ()),
        ("سوق الخضار", {}, ("fodder_crops",)),
        ("بيوت محمية", {"greenhouses": True}, ()),
        ("صوب زراعية", {"greenhouses": True}, ()),
        ("بدون بيوت محميه", {"greenhouses": False}, ()),
        ("مزرعة منتجة", {"producing_farm": True}, ()),
        ("شغالة وإنتاج تمور", {"producing_farm": True}, ()),
        ("مكيفات تعمل", {}, ("producing_farm",)),
        ("حظيرة غنم", {"animal_pens": True}, ()),
        ("حوش غنم وشبوك", {"animal_pens": True, "fence": True, "yard": True}, ()),
        ("بدون حظيره", {"animal_pens": False}, ()),
        ("مزرعة دواجن", {"poultry": True}, ()),
        ("دجاج بلدي", {"poultry": True}, ()),
        ("مطعم دجاج", {}, ("poultry",)),
        ("فيها فيلا", {"farm_house": True}, ()),
        ("بيت داخل المزرعة", {"farm_house": True}, ()),
        ("مع بيت شعر", {"bait_shaar": True}, ("farm_house",)),
        ("سكن عمال", {"workers_housing": True}, ("farm_house",)),
        ("فيها استراحة", {"farm_rest_house": True, "farm_house": True}, ()),
        ("استراحة داخل المزرعة", {"farm_rest_house": True}, ()),
        ("استراحة للإيجار اليومي", {}, ("farm_rest_house",)),
        ("غرف عمال", {"workers_housing": True}, ()),
        ("سكن للعمال", {"workers_housing": True}, ()),
        ("بدون سكن عمال", {"workers_housing": False}, ()),
        ("مسورة بالكامل", {"fence": True}, ()),
        ("مسوّرة وسور", {"fence": True}, ()),
        ("بدون سور", {"fence": False}, ()),
        ("على طريق رئيسي", {"main_road": True}, ()),
        ("على شارع تجاري", {"main_road": True}, ()),
        ("على طريق الملك فهد", {"main_road": True}, ()),
        ("قريب من الطريق الدائري", {}, ("main_road",)),
        ("صالحة للزراعة", {"good_soil": True}, ()),
        ("تربة خصبة", {"good_soil": True}, ()),
        ("غير صالحه للزراعة", {"good_soil": False}, ()),
        ("أرض زاوية", {"corner_plot": True}, ()),
        # ── GROUP B (owner handoff 2026-11-01): residential land ──
        ("أرض على ثلاث شوارع", {"three_streets": True, "corner_plot": True}, ()),
        ("3 شوارع", {"three_streets": True}, ()),
        ("على شارعين", {"corner_plot": True}, ("three_streets",)),
        ("أرض جاهزة للبناء", {"ready_to_build": True}, ()),
        ("مستوية ومنسوب جاهز", {"ready_to_build": True}, ()),
        ("شقة جاهزة للسكن", {}, ("ready_to_build",)),
        ("غير جاهزه للبناء", {"ready_to_build": False}, ()),
        ("أرض مرتفعة", {"raised_plot": True}, ()),
        ("منسوب مرتفع عن الشارع", {"raised_plot": True}, ()),
        ("أسقف مرتفعة", {}, ("raised_plot",)),
        ("سعر مرتفع", {}, ("raised_plot",)),
        ("أرض سكني تجاري", {"residential_commercial": True}, ()),
        ("سكنية تجارية", {"residential_commercial": True}, ()),
        ("أرض سكنية", {}, ("residential_commercial",)),
        ("جميع الخدمات متوفرة", {"all_services": True}, ()),
        ("أرض مخدومة", {"all_services": True}, ()),
        ("كامل الخدمات", {"all_services": True}, ()),
        ("جميع الخدمات قريبة", {}, ("all_services",)),
        ("غير مخدومة", {}, ("all_services",)),
        ("شوارع مسفلتة", {"asphalt": True}, ()),
        ("سفلتة وإنارة وأرصفة", {"asphalt": True, "street_lights": True, "lighting": True}, ()),
        ("بدون سفلتة", {"asphalt": False}, ()),
        ("إنارة الشوارع", {"street_lights": True}, ()),
        ("رصيف وانارة", {"street_lights": True}, ()),
        ("رصيف تحميل", {}, ("street_lights",)),
        ("مخطط معتمد", {"approved_plan": True}, ()),
        ("مخطط رسمي معتمد", {"approved_plan": True}, ()),
        ("مكتب معتمد", {}, ("approved_plan",)),
        ("البيع من المالك مباشرة", {"direct_owner": True}, ()),
        ("بدون عمولة", {"direct_owner": True}, ()),
        ("بدون وسيط", {"direct_owner": True}, ()),
        ("تفويض من المالك", {}, ("direct_owner",)),
        ("بدون عمولة ومطبخ راكب", {"direct_owner": True, "kitchen": True}, ()),
        ("داخل مخطط", {"inside_project": True}, ()),
        ("ضمن مشروع", {"inside_project": True}, ()),
        ("خارج المخطط", {}, ("inside_project",)),
        ("نظام البناء: سكني 3 ادوار", {"floors_allowed": True}, ("floors",)),
        ("مسموح 4 أدوار", {"floors_allowed": True}, ("floors",)),
        ("نسبة البناء 60%", {"floors_allowed": True}, ()),
        ("ارتداد 3 متر", {}, ("floors_allowed",)),
        ("عمارة 3 أدوار", {"floors": 3.0}, ("floors_allowed",)),
        ("أرض منحة", {"grant_land": True}, ()),
        ("منحة ملكية", {"grant_land": True}, ()),
        ("ليست منحه", {"grant_land": False}, ()),
        ("أرض خام", {"no_services": True}, ()),
        ("بدون خدمات", {"no_services": True}, ()),
        ("الخدمات: لا يوجد", {"no_services": True}, ()),
        ("خدمات العقار: لا يوجد", {"no_services": True}, ()),
        ("بدون كهرباء", {"no_services": True, "electricity": False}, ()),
        ("لا يوجد كهرباء", {"no_services": True, "electricity": False}, ()),
        ("بدون مياه", {"no_services": True}, ()),
        ("استخدامات العقار: لا يوجد خدمات العقار: كهرباء, مياه", {"electricity": True, "water_supply": True}, ("no_services",)),
        ("مواد خام", {}, ("no_services",)),
        ("جميع الخدمات", {"all_services": True}, ("no_services",)),
        # ── GROUP C (owner handoff 2026-11-01): commercial ──
        ("محل مع ميزانين", {"mezzanine": True}, ()),
        ("ميزان كامل", {"mezzanine": True}, ()),
        ("بدون ميزانين", {"mezzanine": False}, ()),
        ("مكتب مع بوفيه", {"pantry": True}, ()),
        ("مطبخ تحضيري وبانتري", {"pantry": True}, ()),
        ("لا يوجد بوفيه", {"pantry": False}, ()),
        ("واجهة زجاجية", {"glass_front": True, "frontage": True}, ()),
        ("واجهات زجاج", {"glass_front": True}, ()),
        ("بدون زجاج", {}, ("glass_front",)),   # round 2: bare «زجاج» is window glass, so no answer either way
        ("محل واجهتين", {"frontage": True}, ()),
        ("واجهات على الشارع", {"frontage": True}, ()),
        ("الواجهة: شمالية", {}, ("frontage",)),
        ("محل داخل مول", {"in_mall": True}, ()),
        ("محل داخل مجمع تجاري", {"in_mall": True}, ()),
        ("مجمع تجاري", {}, ("in_mall",)),
        ("خلف شبيلي مول", {}, ("in_mall",)),
        ("قريب من مول", {}, ("in_mall",)),
        ("مكتب داخل برج", {"in_tower": True}, ()),
        ("برج تجاري", {"in_tower": True}, ()),
        ("برج كهرباء", {}, ("in_tower",)),
        ("سجل تجاري ساري", {"license": True}, ()),
        ("رخصة بلدي", {"license": True}, ()),
        ("ترخيص جاهز", {"license": True}, ()),
        ("رقم رخصة فال: 1200", {}, ("license",)),
        ("رقم الترخيص: 7200012345", {}, ("license",)),
        ("رخصة بناء", {}, ("license",)),
        ("بدون رخصه", {"license": False}, ()),
        ("يصلح مطعم", {"food_allowed": True}, ()),
        ("مناسب لكافيه", {"food_allowed": True}, ()),
        ("مسموح مطعم", {"food_allowed": True}, ()),
        ("لا يصلح مطعم", {}, ("food_allowed",)),
        ("غير مسموح مطاعم", {"food_allowed": False}, ()),
        ("قريب من مطعم", {}, ("food_allowed", "restaurant_cafe")),
        ("للتقبيل", {"takeover": True}, ()),
        ("تقبيل محل", {"takeover": True}, ()),
        ("خلو 50 ألف", {"takeover": True}, ()),
        ("بدون خلو", {"takeover": False}, ()),
        ("أول ساكن", {"first_tenant": True}, ()),
        ("جديد لم يسكن", {"first_tenant": True}, ()),
        ("لم يستخدم", {}, ("first_tenant",)),
        ("ساكن سابق", {}, ("first_tenant",)),
        ("إنترنت وألياف", {"internet": True, "wifi": True}, ()),
        ("فايبر سريع", {"internet": True}, ()),
        ("بدون انترنت", {"internet": False}, ()),
        ("مطابق للدفاع المدني", {"civil_defense": True}, ()),
        ("إنذار حريق وطفايات", {"civil_defense": True, "fire_system": True}, ()),
        ("بدون دفاع مدني", {"civil_defense": False}, ()),
        ("سقف عالي", {"high_ceiling": True}, ()),
        ("ارتفاع السقف 6 متر", {"high_ceiling": True}, ()),
        ("أسقف مرتفعه", {"high_ceiling": True}, ("raised_plot",)),
        ("سقف منخفض", {}, ("high_ceiling",)),
        ("هنجر مساحة 500", {"hangar": True}, ()),
        ("هناجر وهنقر", {"hangar": True}, ()),
        ("بدون هنجر", {"hangar": False}, ()),
        ("ساندوتش بانل", {"insulated_panel": True}, ()),
        ("ساندويتش بنل معزول", {"insulated_panel": True}, ()),
        ("عازل للصوت", {"soundproof": True}, ("insulated_panel",)),
        ("مستودع مبرد", {"cold_storage": True}, ("storage",)),
        ("غرف تبريد وثلاجات", {"cold_storage": True}, ()),
        ("نظام تبريد مركزي", {}, ("cold_storage",)),
        ("أرضية إيبوكسي", {"concrete_floor": True}, ()),
        ("ارضية خرسانة", {"concrete_floor": True}, ()),
        ("أرضية رخام", {}, ("concrete_floor",)),
        ("رصيف تحميل", {"loading_dock": True}, ()),
        ("منصة تحميل وتنزيل", {"loading_dock": True}, ()),
        ("بدون رصيف تحميل", {"loading_dock": False}, ()),
        ("بوابة كبيرة", {"big_gate": True}, ()),
        ("بوابات للشاحنات", {"big_gate": True}, ()),
        ("بدون بوابه", {}, ("big_gate",)),
        ("بوابة كبيرة للشاحنات", {"big_gate": True}, ()),
        ("تبعد 300 متر عن بوابة الأعمال", {}, ("big_gate",)),
        ("دخول الشاحنات", {"truck_access": True}, ()),
        ("مدخل تريلات وسطحات", {"truck_access": True}, ()),
        ("لا يسمح بدخول الشاحنات", {}, ("truck_access",)),
        ("رافعة 5 طن", {"crane": True}, ()),
        ("ونش وكرين", {"crane": True}, ()),
        ("بدون رافعه", {"crane": False}, ()),
        # ── 2026-11-03 precision audit (owner: «make sure everything I select appears like matches»): each line is a
        #    REAL ad sentence that the reader used to answer yes, sampled from production listing_text_facts.
        ("نبيع ونشتري في الخبر والدمام والظهران", {}, ("crane",)),
        ("غسالة ونشافة وثلاجة", {}, ("crane",)),
        ("ونش 10 طن", {"crane": True}, ()),
        ("شقة للبيع في شارع خديجة بنت خويلد, حي طويق", {}, ("wifi", "internet")),
        ("بنت هاوس للإيجار دورين", {}, ("wifi", "internet")),
        ("مع النت والكهرباء", {"wifi": True, "internet": True}, ()),
        ("نت سريع", {"wifi": True}, ()),
        ("شقه للايجار بالدور الثاني بالرمال", {}, ("dunes_view",)),
        ("أحياء مدينة الرياض (المونسيه.قرطبه .الرمال .القادسيه)", {}, ("dunes_view",)),
        ("مطبخ + غرفة شغالة بدورات مياه خاصة", {}, ("producing_farm",)),
        ("مزرعة شغالة ومنتجة", {"producing_farm": True}, ()),
        ("أسقف مرتفعة أبواب مرتفعة نوافذ واسعة", {}, ("raised_plot",)),
        ("مداخل مرتفعة ومنظمة ودرج رخامي", {}, ("raised_plot",)),
        ("نوافذ وتوزيع للشبابيك ممتاز", {}, ("for_youth",)),
        ("يسعدنا استقبال عروضكم العقارية واستفساراتكم", {}, ("reception",)),
        ("استقبال العروض والطلبات العقارية", {}, ("reception",)),
        ("موظفو استقبال محترفون", {"reception": True}, ()),
        ("محل تجاري بحي النرجس جنوب طريق الملك سلمان", {}, ("main_road",)),
        ("على طريق الملك فهد مباشرة", {"main_road": True}, ()),
        ("بقرب ملعب كرة قدم وبادل وممشى", {}, ("sports_court", "football_pitch")),
        ("قربها من الراشد مول", {}, ("in_mall",)),
        ("يناسب جميع الانشطة عدا ( المطاعم والمقاهي )", {}, ("restaurant_cafe", "food_allowed")),
        ("الأنشطة غير مرغوبة 🚫 مطاعم 🚫 محل شيشه", {}, ("restaurant_cafe",)),
        ("❌ مسبح ✅ مجلس", {"pool": False, "majlis": True}, ()),
        ("🚫 بدون سعي (توفير مباشر للعميل!)", {"direct_owner": True}, ()),
        # ── round 2 (2026-11-03): real ad sentences the reader used to answer yes ──
        ("مجلس رجال , صالة عائلية , مطبخ", {}, ("for_families",)),
        ("مدخل عائلي للصالة", {}, ("for_families",)),
        ("استراحة عائلية للإيجار", {"for_families": True}, ()),
        ("غرفة نوم ماستر ارتداد مصعد", {}, ("floors_allowed",)),
        ("مساحة كافية وما فيها ضيق", {}, ("restaurant_cafe", "food_allowed")),
        ("قريب من المدارس + جامع كبير + سوبرماركت + مطاعم", {}, ("restaurant_cafe", "food_allowed")),
        ("زجاج دبل Low-E لعزل الحرارة", {}, ("glass_front",)),
        ("في شارع طريق الملك خالد فرعي", {}, ("main_road",)),
        ("على طريق الملك فهد مباشرة", {"main_road": True}, ()),
        ("سباكة 25 سنة عازل 10 سنوات", {}, ("insulated_panel",)),
        ("ساندوتش بانل", {"insulated_panel": True}, ()),
        ("تقارير مسجله بنظام بلدي", {}, ("license",)),
        ("رخصة فال: 1100218114 رخصة موثوق", {}, ("license",)),
        ("الخدمات ١٠٠٠ مكتب ١٠٠٠ تامين ٥٠٠ مويه", {}, ("offices_inside",)),
        ("التواصل مع مكتب الوهابي للعقارات", {}, ("office_inside",)),
        ("مجمع سكني رويا النخيل", {}, ("palms",)),
        ("20 نخلة", {"palms": True}, ()),
        ("فيلا للبيع في مدينة الجبيل الصناعية", {}, ("industrial_area",)),
        ("المفاتيح شركة سوني 25 سنه ضمان", {}, ("playstation",)),
        ("شارع ثنيان ابا الخيل", {}, ("horses_stable",)),
        ("شارع محمد علي جناح", {}, ("rooms_suites",)),
        ("شارع خام 21", {}, ("no_services",)),
        ("توصيل دبابات", {}, ("quad_bikes",)),
        ("تبعد 300 متر عن بوابة الأعمال", {}, ("big_gate",)),
        ("فرصة دخل تستفيد منها", {}, ("earning_income",)),
        ("العائد 8% سنويا", {"earning_income": True}, ()),
        ("شارع المبرد, حي الحزم", {}, ("cold_storage",)),
        ("مكيفات تبريد وتدفئة", {}, ("cold_storage",)),
        ("مستودع مبرد", {"cold_storage": True}, ()),
        ("مسجد. قاعة مناسبات. حراسة", {}, ("for_events",)),
        ("مقلط مخدومة بدورة مياه", {}, ("all_services",)),
        ("أرض مخدومة بالكامل", {"all_services": True}, ()),
        ("مسجد الشباب دقيقة", {}, ("for_youth",)),
        ("سباكة قرين ابل", {}, ("camels",)),
        ("السعر فابل للتفاوض", {}, ("camels",)),
        ("غرف تين نوم", {}, ("fruit_trees",)),
        ("مكتب نفود العاصمة للعقارات", {}, ("dunes_view",)),
        ("متجر خضار وفواكه", {}, ("fodder_crops",)),
        ("سور شبك حديد", {}, ("animal_pens",)),
        ("المكيفات جديدة لم تستخدم", {}, ("first_tenant",)),
        ("عرض الشارع لكل ورشة", {}, ("car_service",)),
        ("موقع مميز لبناء استراحة", {}, ("farm_rest_house",)),
        ("خدمة صيانة على مدار الساعة", {}, ("free_maintenance",)),
        ("ضمان كهرباء ٢٥ سنه", {}, ("electricity",)),
        ("وتم التأسيس للمصعد", {}, ("elevator",)),
        ("خلف لولو ماركت", {}, ("market",)),
        ("ومقابلها مسجد", {}, ("mosque",)),
        ("شارع عرض60 الواجهةجنوبية", {}, ("frontage",)),
        ("واجهة جميلة مع تراس", {}, ("frontage",)),
        ("محل واجهة على شارع تجاري", {"frontage": True}, ()),
        ("🚫دفعات شهرية مافيه", {"split_payments": False}, ()),
        ("مميزات الموقع: ✔️ جنوب مسجد قباء ✔️ بالقرب من ممشى الهجرة", {}, ("mosque",)),
        ("صاحب الترخيص : مؤسسة تاريخ انتهاء الترخيص : 17/07/2027", {}, ("license",)),
        ("الترخيص الحالي: تخزين", {"license": True}, ()),
        ("مساحة العقار: 600 واجهة العقار: Eastern", {}, ("frontage",)),
        ("واجهة العقار: - عدد الغرف", {}, ("frontage",)),
        ("محل واجهة على شارع تجاري", {"frontage": True}, ()),
        ("غرفة غسيل منفصلة خلف الحديقة 🔸مطبخ", {"kitchen": True}, ()),
        ("مسبح خارجي امامه تراس للجلوس", {"balcony": True}, ()),
        ("خلف الجمرات كل غرفه بدورة مياه خاصه", {"own_bathroom": True}, ()),
        ("غرفة خادمة مع دورة مياه – غرفة غسيل – مكيفات سبليت", {"laundry_room": True}, ()),
        ("بدون تعب التجهيز والتأسيس ✔ مكاتب خاصة", {"private_office": True}, ()),
        ("مجهزة بمكان لتأسيس مصعد", {}, ("elevator",)),
        ("فيلا للبيع في شارع بير قحطان, حي النرجس", {}, ("well",)),
        ("شقة للإيجار في شارع الحمام, حي العليا", {}, ("toilets_on_site",)),
        ("فيلا للبيع في شارع الشلال, حي الملقا", {}, ("waterfall",)),
        ("فيلا بها بئر ارتوازي", {"well": True}, ()),
        ("تقدم لكم شركة نجمة", {}, ("stars_mentioned",)),
        ("جلسة شواء رائعة تحت النجوم", {}, ("stars_mentioned",)),
        ("فندق خمس نجوم", {"stars_mentioned": True}, ()),
        ("بهو استقبال فندقي 5نجوم", {"stars_mentioned": True}, ()),
        ("على بعد دقائق من كورنيش أبحر ملعب الجوهرة", {}, ("sports_court",)),
        ("للبيع ارض حي الجراد خلف ملعب الجراد", {}, ("sports_court",)),
        ("تصلح مستودعات او سكن عمال او منتزه", {}, ("staff_housing_inside", "workers_housing")),
        ("مناسبة للمستودعات والأنشطة الصناعية", {}, ("storage",)),
        ("شقه ممتازه جدا سكن عزاب تتكون من ثلاث غرف", {}, ("staff_housing_inside",)),
        ("الجيران عوائل، يمنع سكن العزاب", {"singles": False}, ()),
        ("ولا نؤجر العزاب", {"singles": False}, ()),
        ("شاشة ذكية تدعم نت فلكس وشاهد", {}, ("wifi",)),
        ("الخزان الأرضي يسع 3 تريلات ماء", {}, ("truck_access",)),
        ("بالقرب من جدة سيتي ووك وفندق هيلتون وسينما فوكس", {}, ("smart_tv",)),
        ("بوابات حديثة بنظام ذكي", {}, ("smart_home",)),
        ("مباشر مع المالك نورة الحوشاني", {}, ("yard",)),
        ("رصيف للتنزيل والتحميل", {}, ("street_lights",)),
        ("تتوفر جنبها جميع الخدمات ( سوبرماركت - مسجد )", {}, ("market",)),
        ("فلل للبيع خلف حدائق ومسجد", {}, ("mosque",)),
        ("يتوفر تقرير فحص تربة هندسي معتمد وجاهز", {}, ("approved_plan",)),
        ("على شارع 20 يليه ميدان معتمد في المخطط", {}, ("approved_plan",)),
        ("معلن عقاري معتمد وموثق", {}, ("approved_plan",)),
        ("مخطط سكني معتمد", {"approved_plan": True}, ()),
        ("رفوف تخزين", {"racks": True}, ()),
        ("أرفف حديد", {"racks": True}, ()),
        ("بدون رفوف", {"racks": False}, ()),
        ("مكتب داخل المستودع", {"office_inside": True, "storage": True}, ()),
        ("فيه مكتب إداري", {"office_inside": True, "private_office": True}, ()),
        ("بدون مكتب", {}, ("office_inside",)),
        ("كهرباء 3 فاز", {"heavy_power": True}, ()),
        ("محول كهرباء خاص", {"heavy_power": True}, ()),
        ("ثلاث فاز", {"heavy_power": True}, ()),
        ("بدون محول", {}, ("heavy_power",)),
        ("يوجد نص محول بالارض", {}, ("heavy_power",)),
        ("مستودع في الصناعية", {"industrial_area": True}, ()),
        ("المدينة الصناعية الثانية", {"industrial_area": True}, ()),
        ("قريب من الصناعية", {}, ("industrial_area",)),
        ("مغسلة سيارات وبنشر", {"car_service": True, "car_wash": True, "oil_change": True}, ()),
        ("ورشة سيارات وتشحيم", {"car_service": True}, ()),
        ("قريب من مغسلة سيارات", {}, ("car_service", "car_wash")),
        ("قاعة اجتماعات", {"meeting_room": True}, ()),
        ("غرفة اجتماعات مجهزة", {"meeting_room": True}, ()),
        ("بدون قاعة اجتماعات", {"meeting_room": False}, ()),
        ("استقبال ومكاتب", {"reception": True}, ()),
        ("ريسبشن", {}, ()),
        ("مكتب مع ريسبشن", {"reception": True}, ()),
        ("صالة استقبال", {}, ("reception",)),
        ("مساحة عمل مشتركة", {"coworking": True}, ()),
        ("مكاتب مشتركة وكوركنج", {"coworking": True}, ()),
        ("مكاتب خاصة", {"private_office": True}, ("coworking",)),
        ("مكتب خاص", {"private_office": True}, ()),
        ("مكاتب إدارية", {"private_office": True, "offices_inside": True}, ()),
        ("بدون مكتب خاص", {"private_office": False}, ()),
        ("تكييف مركزي", {"central_ac": True, "air_conditioner": True}, ()),
        ("مكيفات مركزية", {"central_ac": True}, ()),
        ("مركزي", {}, ("central_ac",)),
        ("مكنسة مركزية", {"central_vacuum": True}, ("central_ac",)),
        ("عمارة فيها محلات تجارية", {"shops_inside": True}, ()),
        ("يوجد 4 معارض", {"shops_inside": True, "shops_count": 4.0}, ()),
        ("محل للإيجار", {}, ("shops_inside",)),
        # a negated lead verb is a stated NO, never a yes (🔬 2026-11-07)
        # a stated count of shops is a yes; a possible count is nothing (🔬 2026-11-07)
        ("عباره عن أربع محلات وشقق", {"shops_inside": True, "shops_count": 4.0}, ()),
        ("الدور الأرضي:- ثلاث معارض . الدور الاول :- شقة", {"shops_inside": True, "shops_count": 3.0}, ()),
        ("تتكون العماره من 5محلات و4شقق", {"shops_inside": True, "shops_count": 5.0}, ()),
        ("داخلي تصلح 4 محلات وشقق", {}, ("shops_inside", "shops_count")),
        ("يمكن عمل ثلاث محلات", {}, ("shops_inside", "shops_count")),
        ("معرض للايجار مكون من ٣ فتحات مساحة كل فتحة ٦٠ متر", {"shops_count": 3.0}, ("shops_inside",)),
        ("منها: كافيه أو مطعم 4 محلات حسب الرخصة", {}, ("shops_inside", "shops_count")),
        ("لا يوجد محلات", {"shops_inside": False}, ()),
        ("ولا توجد محلات بالعمارة", {"shops_inside": False}, ()),
        ("ما فيها محلات", {"shops_inside": False}, ()),
        ("لا تحتوي على محلات", {"shops_inside": False}, ()),
        ("لا يوجد مكاتب", {"offices_inside": False}, ()),
        ("لا يوجد شقق", {"apartments_inside": False}, ()),
        ("كما يوجد محلات بالعمارة", {"shops_inside": True}, ()),
        ("لا يوجد مصعد ويوجد محلات", {"elevator": False, "shops_inside": True}, ()),
        # 🔬 2026-11-07 two-way sample: the area's shops, a possible use, the street's shops
        ("قريبة من المرافق العامة: 🏫 مدارس 🏥 مستشفيات 🛍️ محلات تجارية 🕌 مساجد", {}, ("shops_inside", "mosque")),
        ("قريبة من المرافق العامة: 🏫 مدارس 🏥 مستشفيات 🛍️ سوبرماركت", {}, ("market",)),
        ("قريب من الخدمات، مرافق المشروع: مسجد ونادي رياضي", {"mosque": True, "gym": True}, ()),
        # a nearby-services heading runs on through a list and stops at an own cue (🔬 2026-11-07, backlog 1507)
        ("بالقرب من جميع الخدمات التي تحتاجها، وتشمل: 🕌 جامع 🛒 سوبرماركت 🌿 حديقة", {}, ("mosque", "market", "garden")),
        ("●قريبه من كل الخدمات /حديقة /مسجد. ●قريبه من محطة المترو", {}, ("garden", "mosque")),
        ("قريب جدا من الخدمات بشكل عام تموينات - محل غاز - مطعم - مطاحن", {}, ("restaurant_cafe",)),
        ("قريبه من الخدمات • يوجد نادي رياضي • يوجد حضانه أطفال", {"gym": True, "nursery": True}, ()),
        ("بقربه من الخدمات والطرق الرئيسية، خدمات المشروع • العاب اطفال • حديقة خارجية • نادي رياضي", {"gym": True}, ()),
        ("قريب من كل الخدمات *مع مرافق داخلية:* نادي رياضي للرجال والنساء", {"gym": True}, ()),
        ("مناسبة لمغاسل السيارات مناسبة لمحلات تجارية مناسبة لدايف ثرو", {}, ("shops_inside",)),
        ("يمكن الاستفادة من الموقع بعدة خيارات، منها: ☕ كافيه أو مطعم 🏪 4 محلات حسب الرخصة", {}, ("shops_inside",)),
        ("شارعها تجاري مقام فيه محلات بالعماير الي امامها", {}, ("shops_inside",)),
        ("كما يوجد ٦ محلات تجارية بالقرب من العمارة", {}, ("shops_inside",)),
        ("خلف العمارة 4 محلات تجارية", {}, ("shops_inside", "shops_count")),
        ("عمارة مافيها محلات تجارية", {"shops_inside": False}, ()),
        ("ليس يضم مكاتب", {"offices_inside": False}, ()),
        ("🏬 4 محلات تجارية ✅ جميع الشقق مؤجرة ✅ جميع المحلات مؤجرة", {"shops_inside": True}, ()),
        ("عماره للبيع دورين ع 3 شوارع شرق جامع الحوطي فيها محلات تجارية مؤجرة وشقق", {"shops_inside": True}, ()),
        ("مبنى يحتوي على مكاتب", {"offices_inside": True}, ()),
        ("عدد المكاتب 10", {"offices_inside": True}, ()),
        ("مكتب للإيجار", {}, ("offices_inside",)),
        ("عمارة فيها 8 شقق", {"apartments_inside": True, "apartments_count": 8.0}, ()),
        ("تتكون من شقتين", {"apartments_inside": True, "apartments_count": 2.0}, ()),
        ("شقة للإيجار", {}, ("apartments_inside",)),
        ("سكن عمال", {"staff_housing_inside": True, "workers_housing": True}, ()),
        ("سكن موظفين", {"staff_housing_inside": True}, ()),
        ("بدون سكن عزاب", {}, ("staff_housing_inside",)),
        ("فيه مطعم وكافيه", {"restaurant_cafe": True}, ("food_allowed",)),
        ("مساحة كافية للاسترخاء ومواقف كافية", {}, ("restaurant_cafe", "food_allowed")),
        ("مقهى في الدور الأرضي", {"restaurant_cafe": True}, ()),
        ("بجوار مطعم", {}, ("restaurant_cafe",)),
        ("مغسلة", {}, ()),
        ("مغسلة سيارات", {"car_wash": True}, ()),
        ("يوجد مغسله", {}, ("car_wash",)),
        ("مجلس واسع مع دورة مياه + مغسلة خاصة بالمجلس", {}, ("car_wash",)),
        ("مغسلة سيارات", {"car_wash": True}, ()),
        ("جناح بحمام ومغسلة", {}, ("car_wash",)),
        ("مغسلة ملابس", {}, ("car_wash",)),
        ("بقالة في العمارة", {"market": True}, ()),
        ("سوبر ماركت وتموينات", {"market": True}, ()),
        ("قريب من بقالة", {}, ("market",)),
        ("عمارة مؤجرة بالكامل", {"earning_income": True}, ()),
        ("دخل سنوي 200 ألف", {"earning_income": True}, ()),
        ("العائد 8%", {"earning_income": True}, ()),
        ("عقد بين المؤجر والمستأجر", {}, ("earning_income",)),
        ("غير مؤجره", {"earning_income": False}, ()),
        # 🔬 2026-11-10, P2 13085 phrase review: a forecast, a washer's spot, a space prepared FOR a kitchen (real aqar lines)
        ("المكيفات راكبه دخل شهري: متوقع للشقه بعد التاثيث من ٢٠٠٠ إلى ٣٠٠٠ للشهر الواحد", {"air_conditioner": True}, ("earning_income",)),
        ("مرونة عالية في التأجير ويعزز فرص تحقيق دخل شهري مستقر", {}, ("earning_income",)),
        ("💰 العائد الاستثماري: • دخل شهري ثابت: 2,300 ريال", {"earning_income": True}, ()),
        ("▪️ ارتداد خلفي مجهز لموقع الغسالة ومخرج غاز ▪️ 3 غرف نوم", {}, ("laundry_room",)),
        ("تفاصيل العقار : غرفتين نوم يوجد ركن الغسالة مجلس", {}, ("laundry_room",)),
        ("مؤثث بالكامل مع توفر الغسالة والثلاجة", {"laundry_room": True}, ()),
        ("الملحق الخارجي: - غرفة نوم - حمام - ممر مجهز لمطبخ الطابق الأرضي", {}, ("kitchen",)),
        ("وغرفة خادمه بحمام بلاضافه لمطبخ كبير", {"kitchen": True}, ()),
        ("مكيفات مخفية (ماعدا غرفة السائق والعاملة المنزلية مكيفات سبيلت) ومراوح", {}, ("driver_room",)),   # aqar 14875791
        ("جميع الغرف مكيفة ماعدا المطبخ", {}, ("kitchen",)),
        ("المكيفات مركبة في جميع الغرف، باستثناء غرفة العاملة.", {}, ("maid_room",)),        # aqar 17657272
        ("وكل طابق مكون من أربع شقق باستثناء الملحق مكون من شقتين", {}, ("annex",)),         # aqar 21286
        ("الأجهزة الكهربائية كاملة ما عدا الغسالة", {"laundry_room": False}, ()),             # aqar 13470086
        ("ميزات المشروع / Project Features: • نادي رياضي • Gym • ممشى مشترك • Shared Walking Path • مسبح • Swimming Pool", {"pool": True}, ()),  # aqar 20965749
        ("وحدات ذكيه مكانس كهربائيه مسبح غرفة خادمه وسائق ديوانيه", {"pool": True}, ()),   # aqar 14998996
        ("مكان مسبح", {}, ("pool",)),
        ("تشمل الأرض جميع الخدمات من كهرباء وماء وصرف صحي", {"all_services": True}, ()),          # CodeRabbit #12178
        ("جميع الخدمات متوفرة في موقع قريب من الطريق", {"all_services": True}, ()),              # CodeRabbit #12178
        ("تمديدات كهرباء وتكييف سبليت راكب", {"air_conditioner": True}, ()),                      # CodeRabbit #12178
        ("تمديدات السباكة والتكييف المركزي", {}, ("air_conditioner", "central_ac")),              # CodeRabbit #12178
        ("تمديدات السباكة وتكييف مركزي", {}, ("air_conditioner", "central_ac")),                  # CodeRabbit #12178
        ("تمديدات كهرباء وتكييف مركزي راكب", {"central_ac": True, "air_conditioner": True}, ()),
        ("تكييف مركزي", {"central_ac": True}, ()),
        ("شترات كاملة لجميع النوافذ * مكيفات راكبة * أرضيات Glass Fiber * صيانة شاملة", {}, ("optical_fibers",)),  # aqar 9561593
        ("Fiber glass water tank", {}, ("optical_fibers", "internet")),
        ("أرضيات Glass Fiber * صيانة شاملة", {}, ("optical_fibers", "internet")),                 # CodeRabbit #12178
        ("جميع الخدمات في مكان قريب", {}, ("all_services",)),                                    # CodeRabbit #12178
        ("جميع التجهيزات متوفرة باستثناء المطبخ غير راكب", {"kitchen": False}, ()),               # CodeRabbit #12178
        ("High-speed fiber internet 📺 Smart TV", {"optical_fibers": True}, ()),
        ("ارض مسورة للايجار مساحتها 615م وعليها رخصة انشاء وبها قسم معزول بمسبح وغرف", {"pool": True}, ()),   # aqar 27587225
        ("توجد رخصة بناء تسوير وملاحق", {}, ("annex", "fence")),
        ("يوجد تصريح لبناء مسبح", {}, ("pool",)),
        ("a 5 minutes walking distance to the pool", {}, ("pool",)),
        ("لا يوجد غرفة سائق", {"driver_room": False}, ()),
        ("يمنع العزاب عدا الموظفين", {}, ()),
        ("فندق خمس نجوم", {"stars_mentioned": True}, ()),
        ("تصنيف 4 نجوم", {"stars_mentioned": True}, ()),
        ("قريب من فندق 5 نجوم", {}, ("stars_mentioned",)),
        ("غرف وأجنحة فندقية", {"rooms_suites": True}, ()),
        ("أجنحة مفروشة", {"rooms_suites": True}, ()),
        ("جناح خادمة", {"maid_room": True}, ("rooms_suites",)),
        ("جناح نساء", {"women_section": True}, ("rooms_suites",)),
        ("تغيير زيت", {"oil_change": True}, ()),
        ("تشحيم وتغيير زيوت", {"oil_change": True}, ()),
        ("بدون بنشر", {"oil_change": False}, ()),
        ("مضخات مياه", {"pumps": True}, ("water_supply",)),
        ("طرمبة ومضخة", {"pumps": True}, ()),
        ("بدون مضخات", {"pumps": False}, ()),
        # a form value decides its own label; «لم يُركب» is not fitted (dealapp 22700725, 2026-11-05)
        ("🍽 مطبخ: (لم يُركب وقيمته على المستأجر ) ❄️ مكيفات: (لايوجد) 🚗 موقف سيارة: (نعم ) 🔴( ملاحظة )",
         {"parking": True, "kitchen": False, "air_conditioner": False}, ()),
        ("مصعد: نعم", {"elevator": True}, ()),
        # an arrow bullet and a spaced «/» are list marks (dealapp 22662869, 17549152 — 2026-11-05 parking recall)
        ("الدور الارضي ⬅ مجلس ⬅ مطبخ ⬅ حوش مقابل المطبخ ⬅ دورتين مياه ⬅ موقف سيارة # الدور الأول", {"parking": True}, ()),
        ("ستديو (غرفة نوم) / صالة واسعة بمطبخ / دورة مياه /بلكونة مطلة / موقف خاص مظلل", {"parking": True}, ()),
        ("عمر العقار/ 5 سنين", {"property_age_years": 5.0}, ()),
        ("مجهزة حسب طلب الدفاع المدني بمضخة الحريق ووسائل السلامة", {}, ("pumps",)),
        ("حديد سابك • صب بمضخة • بلك عازل", {}, ("pumps",)),
        ("محطة وقود 6 مضخات ومغسلة سيارات", {"pumps": True}, ()),
        # «بمضخة» (with a pump) is another thing's equipment — real served sentences, P1 13301 (2026-11-06)
        ("مسبح ٩ في ٤ عمق من متر الی ۲ متر مغلق ابواب على القسمين بمضخه وفلتر وغرفة الفلتر", {}, ("pumps",)),
        ("مسوره بالكامل ويوجد بئر ارتوازي بمضخة وتعمل والكهرباء واصله", {}, ("pumps",)),
        ("خزان أرضي سعة 6000 لتر مزود بمضخة سكالا 2 وحساس قبل انتهاء الماء", {}, ("pumps",)),
        ("بئر جديد بعمق 120م، حجب كامل، بمضخة 3.5 حصان، ويصب في خزان دائري", {}, ("pumps",)),
        ("🔥 نظام إطفاء متوسط الخطورة بمضخة عالية الأداء وخزان إطفاء 35,000 لتر", {}, ("pumps",)),
        ("مستودع مرخص من بلدي ومن الدفاع المدني مجهز بمضخة كبيره ونظام الرش الالي وخراطيم", {}, ("pumps",)),
        ("بالإضافة إلى مسبح خارجي بمضخة هواء لدفع الماء، وجلسة خارجية مع ركن شواء", {}, ("pumps",)),
        ("مسجد داخل المجمع", {"mosque": True}, ()),
        ("مصلى للرجال والنساء", {"mosque": True}, ()),
        ("قريب من المسجد", {}, ("mosque",)),
        ("مسجد وحديقة قريبه من العمارة", {}, ("mosque", "garden")),
        ("شارع المسجد", {}, ("mosque",)),
        ("نسبة البناء 60%", {"building_rules": True}, ()),
        ("ارتداد أمامي 6 متر", {"building_rules": True}, ()),
        ("نظام البناء تجاري", {"building_rules": True}, ()),
        ("عمارة 4 أدوار", {"floors": 4.0}, ("building_rules",)),
        ("عدد الشقق 12", {"apartments_count": 12.0}, ()),
        ("عمارة فيها محلين", {"shops_count": 2.0}, ()),
        # 🔬 2026-11-11 (backlog 1718, owner's plain-«أرض» decision 2026-11-08): a land's use only from a head that names
        # the land or its deed; two uses, a conversion or a near word → none
        ("للبيع ارض زاوية سكنية شرق بريدة", {"land_use_ar": "سكني"}, ()),                 # aqar 6989916
        ("قطعة زراعيه للبيع – النبقية", {"land_use_ar": "زراعي"}, ()),                     # haraj 19324720
        ("ارض بصك زراعي", {"land_use_ar": "زراعي"}, ()),                                   # aqar 11510463
        ("ارض مميزة تجارية على خط الرياض", {"land_use_ar": "تجاري"}, ()),                  # aqar 21176062
        ("للبيع ارض صناعيه مساحة : 5000 متر", {"land_use_ar": "صناعي"}, ()),               # haraj 23548266
        ("الأرض بمخطط معتمد وصك الكتروني سكني", {"land_use_ar": "سكني"}, ()),              # aqar 10932898
        ("نوع الأرض : تجارية", {"land_use_ar": "تجاري"}, ()),
        ("الاستخدام: صناعي", {"land_use_ar": "صناعي"}, ()),
        ("ارض زاويه تجاريه سكنيه للايجار", {}, ("land_use_ar",)),                          # aqar 20871284
        ("استخدام العقار: سكني-تجاري. عدد الشوارع: شارع واحد", {}, ("land_use_ar",)),      # aqar 17753606
        ("ارض سكنية قريبة من ارض تجارية", {"land_use_ar": "سكني"}, ()),                 # the nearby one is not this land
        ("أرض زراعية قابلة للتحويل إلى سكني", {}, ("land_use_ar",)),
        ("خلف الأرض شارع تجاري • قريبه من جميع الخدمات", {}, ("land_use_ar",)),           # haraj 18743550
        ("موقع تجاري للبيع", {}, ("land_use_ar",)),                                       # haraj 20641041
        ("رخص فال السجل التجاري", {}, ("land_use_ar",)),                                   # haraj 18946243
        ("للبيع مجمع سكني مطل", {}, ("land_use_ar",)),
        ("مناسبة لإقامة مشروع استثماري أو قصر سكني", {}, ("land_use_ar",)),               # aqar 114530
        ("أرض ليست زراعية", {}, ("land_use_ar",)),
        ("أرض للبيع تجارية في حي طويق بالرياض", {"land_use_ar": "تجاري"}, ()),            # aqar 18818283
        ("ارض للبيع( سكنيه ) التفاصيل", {"land_use_ar": "سكني"}, ()),                       # aqar 10530615
        ("الارض للبيع تجاري سكني من المالك مباشرة", {}, ("land_use_ar",)),                # aqar 8017472
        ("مطلوب أراضي تجارية على شارع الملك عبدالعزيز", {}, ("land_use_ar",)),
        ("قطعتي ارض للبيع الاستخدام ( تجاري / سكني ) الارض على صكين", {}, ("land_use_ar",)),   # aqar 11518885
        # CodeRabbit on #11819 (6 findings, each a real sentence shape)
        ("استخدامات العقار: سكني", {"land_use_ar": "سكني"}, ()),
        ("أرض سكنية، الدفع عن طريق تحويل بنكي", {"land_use_ar": "سكني"}, ()),
        ("ليست أرض سكنية", {}, ("land_use_ar",)),
        ("يمكن استخدام العقار تجاري", {}, ("land_use_ar",)),
        ("أرض سكنية أو تجارية", {}, ("land_use_ar",)),
        ("أرض سكنية يمكن تغييرها إلى تجارية", {}, ("land_use_ar",)),
        ("مطلوب من مالك الأرض قطعة أرض تجارية", {}, ("land_use_ar",)),
        ("أرض سكنية قابلة للتحويل", {}, ("land_use_ar",)),
        ("السعر قابل للتفاوض أرض سكنية", {"land_use_ar": "سكني"}, ()),
        ("أرض سكنية ويمكن تحويلها", {}, ("land_use_ar",)),                                # CodeRabbit on #11819
        ("أرض سكنية يمكن تحويل ثمن العقار إلى حساب بنكي", {"land_use_ar": "سكني"}, ()),
        ("أرض للبيع وقريبة من أرض تجارية", {}, ("land_use_ar",)),
        ("أرض سكنية وقريبة من أرض تجارية", {"land_use_ar": "سكني"}, ()),
        # 🔬 2026-11-11 (P2 13085, backlog 1773): a view of «the road», a shop's goods, a building's own events room and
        # services AROUND the home are not the feature
        ("+ بلكونه (شرفه) مطلة على الطريق. شاشه TV", {}, ("main_road",)),                 # aqar 15126306
        ("٣ غرف نوم واسعه و مطله على الطريق صالون و سفره", {}, ("main_road",)),           # aqar 19285205
        ("ارض مطلة على الطريق الدائري", {"main_road": True}, ()),
        ("عمارة تطل على طريق الملك عبدالله", {"main_road": True}, ()),
        ("• هدايا ومناسبات ✔ واجهة واضحة", {}, ("for_events",)),                          # aqar_commercial 19532680
        ("* غرفة حفلات ومناسبات غرف سائقين", {}, ("for_events",)),                        # aqar 1783289
        ("استراحة للحفلات والمناسبات", {"for_events": True}, ()),
        ("حولها كل خدمات وفي بداية الحي", {}, ("all_services",)),                         # aqar 15789013
        ("المساحة: 130م² كل خدمات الشقه مستقله", {}, ("all_services",)),                 # aqar 15126557
        ("ارض واصل لها جميع الخدمات", {"all_services": True}, ()),
        # 🔬 2026-11-13 (P1 14340): «كل خدمات» the home does not have, «ومناسبات» that is not a permission
        ("وبالقرب منها كل الخدمات ولها عداد كهرباء مستقل الايجار الشهري 1650 ريال ويشمل كل خدمات العمارة", {}, ("all_services",)),  # aqar 25431484
        ("•منطقة مؤسس فيها كل خدمات التاون هاوس من خزان المياة وتمديدات السباكة", {}, ("all_services",)),   # aqar 35244
        ("⭐️ موقع استراتيجي مميز ⭐️ كل خدمات شمال الرياض قريبة 👷‍♂️إشراف مكتب هندسي", {}, ("all_services",)),  # aqar 15134259
        ("السعر الشهري 7000 ريال شامل جميع الخدمات ⚡ الكهرباء | 💧 المياه", {"all_services": True}, ()),   # aqar 17133512
        ("تواجد كثافه سكنيه الحي متوفر كل خدمات", {"all_services": True}, ()),                     # aqar 6987314 (like «الحي مخدوم»)
        ("موقع شقه ممتاز كل خدمات متوفره تتكون العماره ثلاث شوارع", {"all_services": True}, ()),   # aqar 9613080
        ("أرض مخدومة بجميع الخدمات وقريبة من الطريق", {"all_services": True}, ()),
        ("للايجار الشهري . عدا الإيجازات الدراسية ومناسبات الأعياد التفاصيل", {}, ("for_events",)),   # aqar 12109734
        ("مسبح نسائي قاعة استقبال صيوف ومناسبات واحتفالات قاعة اجتماعات", {}, ("for_events",)),       # aqar 8853052
        ("فرصة استثمارية قصر أفراح ومناسبات فاخر للإيجار", {"for_events": True}, ()),               # aqar 9152301
        ("من خزان المياة وتمديدات السباكة و التكييف واطلالات الغرف", {}, ("air_conditioner",)),       # aqar 35244
        ("تمديدات كهرباء وسباكة ومكيفات راكبة", {"air_conditioner": True}, ()),
        ("نحن مكتب النطاق الشامل للخدمات العقاريه رخصة وساطة", {}, ("bills_included",)),           # aqar 14869751
        ("الايجار شامل للخدمات", {"bills_included": True}, ()),
        ("للتقبيل معرض للمطابخ والخزائن مساحته 200 متر", {}, ("kitchen",)),                         # aqar 18683956
        ("التكييف مخفي راكب بالصالات والمجالس وتكييف كاسيت للمطابخ", {}, ("kitchen",)),             # aqar 7174053
        ("ومراوح شفط للمطابخ والحمامات - سخان مركزي", {}, ("kitchen",)),                            # aqar 14875791
        ("شقة 3 غرف ومطبخ راكب", {"kitchen": True}, ()),
        ("وغرفة خادمه بحمام بلاضافه لمطبخ كبير", {"kitchen": True}, ()),
        ("استراحة مناسبة لاستقبال الضيوف والمناسبات", {"for_events": True}, ()),
        # CodeRabbit on #11820
        ("شقة مطلة على طريق", {}, ("main_road",)),
        # a bare «طريق» then the next item is still a generic road view (CodeRabbit on #11820)
        ("شقة مطلة على طريق وبها مطبخ راكب", {"kitchen": True}, ("main_road",)),
        ("مطلة على طريق الملك فهد", {"main_road": True}, ()),
        ("عمارة مطلة على الطريق المسمى طريق الملك فهد", {"main_road": True}, ()),
        ("جميع خدمات الشقة متوفرة", {"all_services": True}, ()),
        ("شاليه فيه غرفتين ومسموح للمناسبات", {"for_events": True}, ()),
        ("شاليه فيه غرفتين ممنوع الحفلات", {"for_events": False}, ()),
        # 🔬 2026-11-11 garden precision sample (5 of 25 served yeses were nearby places)
        ("📍قريب من أهم الخدمات والمرافق🔥:- 🕌 مسجد 🌳 حديقة 🏃🏻‍♂️ ممشى الرحاب 🏥 مركز صحي", {}, ("garden",)),  # aqar 15006770
        ("- مجمع كفاءات الطبي. - حديقة الإمام وبجانبها ملعب.", {}, ("garden",)),                          # aqar 10513608
        ("◾️أرض سكنية شارع وحديقة في مركز البندرية", {}, ("garden",)),                                     # aqar 3543112
        ("موقع مميز بالقرب من المسجد، المدارس، الخدمات، والحديقة. تفاصيل العقار", {}, ("garden",)),        # aqar 14865940
        ("* حوش واسع. * مدخل سيارة. * حديقة خلفية. * مكيفات راكبة.", {"garden": True}, ()),                # aqar 14870810
        ("مخازن وحديقة خاصة. ☀️ الدور الأول: صالة عائلية", {"garden": True}, ()),                          # aqar 18338000
        ("فيلا على شارع وبها حديقة خاصة", {"garden": True}, ()),                                           # CodeRabbit on #11820
        ("فيلا على شارع وحديقة خاصة", {"garden": True}, ()),
        ("٣ غرف وصاله ٢ دورتين مياه مطبخ", {"toilets_on_site": True}, ()),                      # CodeRabbit on #11820
        ("3 غرف نوم دورتا مياه صالة واحدة", {"toilets_on_site": True}, ()),
        ("(ومنهم غرفه مطله للحوش) عدد (۳) دورات مياه. + بلكونه", {"toilets_on_site": True, "balcony": True}, ()),
        ("غرف مناسبات واسعة", {}, ("for_events",)),                                              # CodeRabbit on #11820
        ("قريب من المسجد، حديقة المبنى الآخر، بقالة", {}, ("garden", "market")),                 # CodeRabbit on #11820
        ("كل خدمات الشقة منفصلة", {}, ("all_services",)),
        ("جميع الخدمات ومطبخ مستقل", {"all_services": True}, ()),
        ("لا يوجد مطبخ أو مكيفات أو مصعد متوفر لا يوجد حوش", {"elevator": False}, ()),   # CodeRabbit on #11820: denied, never yes
        ("مطبخ راكب: لا يوجد في الشقة", {"kitchen": False}, ()),
        ("أرض سكنية شارع وحديقة خاصة بالحي", {}, ("garden",)),
        ("قريب من المسجد، خدمات المبنى، نادي رياضي، حضانة", {"gym": True}, ()),
        # 🔬 2026-11-11 kitchen recall sample: a «لا يوجد» that opens the NEXT item is not this one's no
        ("٣ غرف وصاله ٢ دورتين مياه مطبخ راكب لا يوجد مكيفات الشق الدور الاول", {"kitchen": True, "air_conditioner": False}, ()),  # aqar 23092840
        ("3 غرف + 2 دورة مياه + صالة + مطبخ راكب لا يتوفر مصعد .", {"kitchen": True, "elevator": False}, ()),   # aqar 9242120
        ("غرفتين نوم وصاله مكيفات ومطبخ راكب لا يوجد أي تعاملات ماليه خارج المكتب", {"kitchen": True}, ()),    # aqar 14860625
        ("المطبخ: لا يوجد", {"kitchen": False}, ()),
        ("مطبخ لا يوجد حاليا", {"kitchen": False}, ()),
        ("* لا يوجد مطبخ أو مكيفات راكبة لا يوجد حوش", {"kitchen": False, "air_conditioner": False}, ()),   # reinvest 19994388
        ("* 3 دورات مياه * عداد كهرب مستقل ملاحظات: * لا يوجد حوش أو ارتداد * الماء مشترك",
         {"separate_electricity_meter": True, "yard": False}, ()),                                          # reinvest 19994388
        ("مطبخ أمريكي راكب 4 مكيفات راكبة لا توجد منطقة خارجية موقف خاص", {"kitchen": True, "air_conditioner": True}, ()),  # muhaysini 25533105
        ("سعر الزاوية/مليون و 50 الف شامل السعي سعر البطن/مليون", {}, ("corner_plot",)),   # hajer 10674101, 2026-11-11
    ]
    bad = []
    for text, want, absent in cases:
        got = f(text)
        for k, v in want.items():
            if got.get(k) != v:
                bad.append(f"{text!r}: {k} want {v!r} got {got.get(k)!r}")
        for k in absent:
            if k in got:
                bad.append(f"{text!r}: {k} must be absent, got {got[k]!r}")
    assert not bad, "\n".join(bad)
    # proof: every quote is the ad's own words (norm(quote) inside norm(text)) and carries the negation it asserts
    rows = check(clean_text("فيلا للبيع", "بدون مسبح، مطبخ راكب.\nلا يوجد مصعد"))
    q = {r["fact"]: r["quote"] for r in rows}
    assert q == {"pool": "بدون مسبح", "kitchen": "مطبخ", "elevator": "لا يوجد مصعد"}, q
    # PDPL: the sanitizer runs per line — contact data never reaches a quote
    t = clean_text(None, "مسبح للتواصل 0501234567\nواتساب 966501234567\nمجلس")
    assert "050" not in t and "966" not in t and facts_of(t).get("majlis") is True, t
    assert names_a_person("ملك فلان بنت فلان") and names_a_person("آل فلان") and not names_a_person("مسجد فلان بن فلان")
    assert not names_a_person("بن") and not names_a_person("شارع 15 م")
    # backlog 1188: the ad's OWN place names are never a fact — the URL-slug title has no «حي» before the name
    slug = clean_text("دور-بيشة-الخزان", "دور للبيع")
    assert facts_of(slug).get("water_tank") is True, "premise: without its place names the slug reads water_tank"
    assert "water_tank" not in facts_of(slug, ("الخزان", "بيشة")), facts_of(slug, ("الخزان", "بيشة"))
    assert "water_tank" not in facts_of(slug, ("حي الخزان", "بيشة")), "abaad stores district_ar «حي الخزان»"
    assert "garden" not in facts_of(clean_text("فيلا-الرياض-الحديقة", "فيلا للبيع"), ("الحديقة", "الرياض"))
    # a clause that is only the place name, right after a cued utility list, must not crash the reader
    for only_place in ("يتوفر مياه وكهرباء\nالخزان\nدورة مياه", "يوجد كهرباء ومياه، بيشة، 2 دورة مياه"):
        assert facts_of(only_place, ("الخزان", "بيشة")).get("bathrooms") in (None, 1, 2), only_place
    both = facts_of(clean_text("دور-بيشة-الخزان", "دور للبيع مع خزان ماء"), ("الخزان", "بيشة"))
    assert both.get("water_tank") is True, both          # a real «خزان ماء» in the same ad is still read
    assert facts_of(slug, ("",)) == facts_of(slug) and facts_of(slug, ("ال",)) == facts_of(slug)   # empty / too-short names: no-op
    # 🔬 2026-11-05: the kind word goes with the name — «حي X مؤثثة» left «حي مؤثثة», and a word after «حي» reads as a district
    for text, place, fact in (("شقة فاخرة للايجار في حي الياسمين مؤثثة بالكامل", "حي الياسمين", "furnished"),   # aqar 14861704
                              ("شقة للايجار بحي الملقا ( مؤثثة) في فله دور ثاني", "حي الملقا", "furnished"),      # aqar 14852480
                              ("فيلا للبيع بحي الملقا مسبح وحديقة", "حي الملقا", "pool"),
                              ("شقة للايجار حي النرجس مطبخ راكب مكيفات", "حي النرجس", "kitchen"),
                              ("دور للايجار في حي العارض مدخل خاص", "العارض", "private_entrance")):
        assert facts_of(clean_text(None, text), (place, "الرياض")).get(fact) is True, (text, facts_of(clean_text(None, text), (place,)))
    assert "water_tank" not in facts_of(clean_text(None, "ارض للبيع حي الخزان مدينة تربة"), ("حي الخزان", "تربة"))
    print(f"word_checker selftest ok ({len(cases)} phrases)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("text", nargs="?")
    a = ap.parse_args()
    if a.selftest:
        selftest()
    elif a.text:
        for r in check(clean_text(None, a.text)):
            print(r)
    sys.exit(0)
