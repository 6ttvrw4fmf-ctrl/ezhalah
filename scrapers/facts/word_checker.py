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
import re
import sys
import unicodedata
from typing import Any, Optional

from scrapers.common import normalize as N
from scrapers.facts.extract import _STRIP_RE, _TRANS, BOOL_FACTS, NUM_FACTS, TEXT_FACTS, norm, sanitize

MODEL = "word-checker-v1"
MAX_TEXT = 8000
_W = re.compile(r"\w")
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
    desc = description or ""
    if "<" in desc and ">" in desc:
        desc = N.html_block_lines(desc)
    lines = [title or ""] + re.split(r"[\r\n]+", desc)
    out = "\n".join(s for ln in lines if ln.strip() and (s := sanitize(None, ln)))
    return _COLON_NO.sub(r"\1،", unicodedata.normalize("NFKC", out))[:MAX_TEXT]


# A form value «لا» ends its clause: «مفروشة: لا يُعرف حي الأمل …», «مؤثثة: لا تتضمن …», «مفروش: لا **المرافق:**»
# (muhaysini; full run 458 furnished rows read as yes). «… : لا يوجد» stays one negation.
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
_NOT_ALLOWED = r"(?:غير مسموح|ممنوع|ممنوعه|ممنوعين|لا نقبل|ما نقبل|لا يسمح|لا يقبل|لا نسمح)"
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
    "furnished": ["^موثث", ("re:(?:بدون|بلا|من غير|غير) (?:ال)?(?:اثاث|تاثيث|موثث)", False), "re:(?:مع|شامل|شامله) (?:ال)?اثاث",
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
    "yard": ["^حوش", "^احواش", "^فناء", "^yard", "courtyard"],
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
    "wifi": ["واي فاي", "وايفاي", "^انترنت", "^نت$", "wifi", "wi fi", "internet"],
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
    "free_maintenance": ["re:(?:ال)?صيانه (?:ال)?مجاني(?:ه|ا)?", "re:خدم(?:ه|ات) (?:ال)?صيانه",
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
    "playstation": ["^بلايستيشن", "^بليستيشن", "بلاي ستيشن", "^سوني$", "^playstation", "^ps[45]$"],
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
    "dunes_view": ["re:(?:اطلاله|باطلاله) (?:علي |ع )?(?:ال)?(?:رمال|طعوس|نفود|كثبان)", "^طعوس", "^طعس$", "^نفود", "^كثبان", "^رمال$"],
    "women_section": ["re:قسم (?:لل|ال)?(?:نساء|حريم|نسائي)", "re:جناح (?:لل|ال)?(?:نساء|حريم|نسائي)", "women s section", "ladies section"],
    # «جناحين» only as two sections, never two master bedrooms (excluded below); «شقتين» left out — it is a count
    "two_sections": ["^قسمين$", "^قسمان$", "^جناحين$", "^جناحان$", "re:قسم (?:لل|ال)?رجال و ?قسم (?:لل|ال)?نساء", "two sections"],
    "events_hall": ["re:(?:صاله|قاعه|صالات|قاعات) (?:ال)?(?:مناسبات|افراح|احتفالات)", "events hall", "wedding hall"],
    "privacy_screen": ["^ساتر", "^سواتر", "re:خصوصيه (?:تامه|كامله)", "^مستور$", "^مستوره$", "privacy screen"],
    "trees": ["^اشجار", "^مشجره", "^مشجر$", "^مزروعه", "^مزروع$"],
    "for_families": ["^للعوائل", "^للعائلات", "re:عوائل فقط", "^عائلي$", "^عائليه$", "for families",
                     (rf"re:{_NOT_ALLOWED} {_TO}(?:عوائل|عائلات)", False), (rf"re:{_ALLOWED} {_TO}(?:عوائل|عائلات)", True)],
    "for_youth": ["^للشباب", "^شباب$", "^للعزاب", "for youth",
                  (rf"re:{_NOT_ALLOWED} {_TO}(?:شباب|عزاب)(?:ي|يه)?", False), (rf"re:{_ALLOWED} {_TO}(?:شباب|عزاب)(?:ي|يه)?", True)],
    "for_events": ["^مناسبات", "^للمناسبات", "^حفلات", "^للحفلات", "^تخرج$", "re:عيد ميلاد", "re:اعياد ميلاد", "for events",
                   (rf"re:{_NOT_ALLOWED} {_TO}(?:مناسبات|حفلات)", False), (rf"re:{_ALLOWED} {_TO}(?:مناسبات|حفلات)", True)],
    "for_newlyweds": ["^عرسان", "^للعرسان", "^للعرايس", "re:شهر (?:ال)?عسل", "honeymoon", "newlyweds"],
    # a bare «بقي» also means «remaining» («بقي شقة واحدة») — only next to دباب / بانشي
    "quad_bikes": ["^دباب", "^دبابات", "^بانشي", "re:(?:دباب|دبابات|بانشي) (?:و)?بقي", "re:بقي (?:و)?(?:دباب|دبابات|بانشي)", "quad bike", "atv"],
    "horses_stable": ["^خيل$", "^خيول$", "^اسطبل", "^اصطبل", "re:ركوب (?:ال)?خيل", "horse riding", "stable"],
    # «جمال» alone is beauty — only «ركوب الجمال»
    "camels": ["^ابل$", "^هجن$", "re:ركوب (?:ال)?(?:جمال|ابل|هجن)", "camels"],
    "toilets_on_site": ["re:دورات (?:ال)?مياه", "re:دوره (?:ال)?مياه", "^حمامات", "^حمام$", "toilets"],
    "lighting": ["^اناره", "^اضاءه", "^انارات", "lighting"],
    "artesian_well": ["re:(?:بئر|بير) ارتوازي", "^ارتوازي", "re:ابار ارتوازيه", "artesian"],
    "solar_power": ["re:طاقه شمسيه", "re:الواح شمسيه", "re:خلايا شمسيه", "solar"],
    "palms": ["^نخيل$", "^نخل$", "^نخله$", "^نخلات$", "re:\\d+ نخله", "palm trees", "palms"],
    "fruit_trees": ["re:اشجار مثمره", "^ليمون$", "^زيتون$", "^برتقال$", "^عنب$", "^رمان$", "^تين$", "^مانجو$", "^حمضيات$",
                    "fruit trees"],
    "fodder_crops": ["^برسيم", "^اعلاف$", "^قمح$", "^شعير$", "^خضار$", "^محاصيل$", "fodder", "crops"],
    "greenhouses": ["re:بيوت محميه", "re:بيت محمي", "^صوبه", "^صوب$", "re:صوب زراعيه", "greenhouse"],
    # a bare «تعمل» / «إنتاج» is any machine or any company — only the farm's own producing words
    "producing_farm": ["^منتجه$", "^شغاله$", "re:مزرعه (?:منتجه|شغاله|تعمل)", "re:انتاج (?:ال)?(?:تمور|نخيل|اعلاف|خضار|محاصيل|زيتون)",
                       "producing farm"],
    "animal_pens": ["^حظيره", "^حظائر", "re:حوش (?:ال)?(?:غنم|اغنام|ماشيه|مواشي)", "^شبوك", "^شبك$", "^زريبه", "^زرايب"],
    "poultry": ["^دواجن", "^دجاج$", "re:مزرعه دواجن", "poultry"],
    # the ad says there IS a house / villa on the property; a bare «سكن» is anyone's housing («سكن عمال», «سكن عوائل»)
    "farm_house": ["re:(?:فيها|بها|فيه|به|يوجد|توجد|مع|تحتوي علي|تشمل|وبها|وفيها) (?:ال)?(?:فيلا|فله|بيت|منزل|استراحه)",
                   "re:(?:فيلا|فله|بيت|منزل) داخل (?:ال)?مزرعه", "re:مزرعه (?:ب|مع )(?:فيلا|فله|بيت|منزل)"],
    "farm_rest_house": ["re:استراحه داخل", "re:(?:فيها|بها|يوجد|توجد|مع|وبها|وفيها) (?:ال)?استراحه", "^استراحه$"],
    "workers_housing": ["re:سكن (?:لل|ال)?عمال", "re:غرف(?:ه)? (?:لل|ال)?(?:عمال|عامل)", "workers housing", "labour housing"],
    "fence": ["^مسوره", "^مسور$", "^سور$", "^شبوك", "re:مسور(?:ه)? بالكامل", "fenced"],
    "main_road": ["re:(?:علي|ع) (?:ال)?(?:طريق|خط|دائري)(?!\\w)", "re:طريق (?:ال)?(?:ملك|امير)(?!\\w)", "re:شارع (?:رئيسي|تجاري|عام)",
                  "re:شارعين تجاريين", "main road", "main street"],
    "good_soil": ["re:صالحه للزراعه", "re:تربه (?:خصبه|صالحه)", "re:ارض خصبه", "fertile"],
    # ── GROUP B — residential land (owner handoff 2026-11-01) ──
    "three_streets": ["re:(?:ثلاث|ثلاثه|3) شوارع", "three streets"],
    # a bare «جاهزة» is any unit («جاهزة للسكن», «جاهزة للإفراغ») — only the land's own readiness
    "ready_to_build": ["re:جاهزه للبناء", "^مستويه$", "re:منسوب جاهز", "re:(?:ارض|الارض|قطعه|القطعه) جاهزه", "ready to build"],
    "raised_plot": ["re:(?:ارض|الارض|قطعه|القطعه) مرتفعه", "re:منسوب(?:ها)? مرتفع", "^مرتفعه$", "elevated plot"],
    "residential_commercial": ["re:سكني(?:ه)? و?تجاري(?:ه)?", "re:تجاري(?:ه)? و?سكني(?:ه)?", "residential commercial"],
    "all_services": ["re:(?:جميع|كامل|كافه|كل) (?:ال)?خدمات", "^مخدومه", "^مخدوم$", "re:(?:ال)?خدمات (?:متوفره|متوفر|واصله|مكتمله)",
                     "re:(?:متوفر|متوفره|مكتمل|مكتمله) (?:بها |فيها )?(?:جميع |كل |كافه )?(?:ال)?خدمات", "all services"],
    "asphalt": ["^مسفلت", "^مسفلته", "^سفلته", "^اسفلت", "asphalt", "paved"],
    "street_lights": ["re:اناره (?:ال)?شوارع", "re:اناره (?:ال)?شارع", "^ارصفه", "^رصيف$", "re:اناره و ?ارصفه", "street lights", "pavements"],
    # a bare «معتمد» is also an office / agent («مكتب معتمد») — excluded below
    "approved_plan": ["re:مخطط (?:معتمد|رسمي)", "^معتمد$", "^معتمده$", "approved plan"],
    # «تفويض من المالك» is an agent's authorisation — excluded below
    "direct_owner": ["re:من (?:ال)?مالك(?: مباشره)?", "re:(?:ال)?مالك مباشره", "re:بدون (?:عموله|وسيط|وسطاء|سعي)", "direct from owner",
                     "no commission"],
    "inside_project": ["re:(?:داخل|ضمن) (?:ال)?(?:مخطط|مشروع)", "inside project"],
    # what MAY be built (the permit guard's own words): the span carries them, so the guard reads nothing before it
    "floors_allowed": ["re:عدد (?:ال)?ادوار (?:ال)?مسموح", "re:نظام (?:ال)?بناء", "re:نسبه (?:ال)?بناء", "^ارتداد", "^ارتدادات",
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
    "glass_front": ["re:واجه(?:ه|ات) (?:ال)?(?:زجاج|زجاجيه)", "^زجاج$", "^زجاجيه$", "glass front", "glass facade"],
    # «الواجهة: شمالية» is the plot's facing — excluded below
    "frontage": ["^واجهه", "^واجهتين", "^واجهتان", "^واجهات", "frontage"],
    "in_mall": ["^مول$", "re:مجمع تجاري", "^سنتر$", "^بلازا", "re:مركز تجاري", "re:داخل (?:ال)?مول", "in mall", "shopping centre",
                "shopping center"],
    "in_tower": ["^برج$", "re:داخل (?:ال)?برج", "in tower"],
    # «رقم رخصة فال» / «رقم الترخيص» is the REGA ad licence on every ad; «رخصة بناء» is a permit — excluded below
    "license": ["re:سجل تجاري", "^رخصه$", "re:رخصه بلدي", "^ترخيص$", "^بلدي$", "commercial register", "licensed"],
    "food_allowed": ["re:(?<!لا )(?<!ما )(?:يصلح|تصلح|يناسب|تناسب|مناسب|مناسبه) (?:ل|ك|لل)?(?:مطعم|كافيه|مقهي|كوفي|مطاعم|كافيهات)",
                     "^مطعم$", "^كافيه$", "^مقهي$", "^مطاعم$", "^كافيهات$",
                     (rf"re:{_NOT_ALLOWED} {_TO}(?:مطعم|كافيه|مقهي|مطاعم|كافيهات)", False),
                     (rf"re:{_ALLOWED} {_TO}(?:مطعم|كافيه|مقهي|مطاعم|كافيهات)", True)],
    "takeover": ["^تقبيل", "^للتقبيل", "^خلو$", "takeover"],
    "first_tenant": ["re:اول (?:ساكن|مستاجر)", "re:(?:جديد|جديده)? ?لم (?:يسكن|تسكن)", "re:لم (?:يستخدم|تستخدم|يسكن|تسكن)", "first tenant",
                     "never occupied"],
    "internet": ["^انترنت", "^الياف$", "^فايبر", "^نت$", "internet", "fibre", "fiber"],
    "civil_defense": ["re:(?:ال)?دفاع (?:ال)?مدني", "re:(?:ال)?انذار (?:ال)?حريق", "^طفايات", "re:طفاي(?:ه|ات) (?:ال)?حريق", "civil defense",
                      "civil defence"],
    "high_ceiling": ["re:(?:سقف|اسقف) (?:عالي|عاليه|مرتفع|مرتفعه)", "re:ارتفاع (?:ال)?(?:سقف|اسقف)", "re:ارتفاع عالي", "high ceiling"],
    "hangar": ["^هنجر", "^هناجر", "^هنقر", "^هنقار", "hangar"],
    # «عازل للصوت» is soundproof — excluded below
    "insulated_panel": ["re:(?:ساندوتش|ساندويتش|ساندوش|سندوتش|سندويتش) (?:بانل|بنل)", "^بانل$", "^معزول", "^عازل$", "sandwich panel",
                        "insulated panel"],
    # «تكييف وتبريد» is the AC — excluded below
    "cold_storage": ["^مبرد$", "^مبرده$", "^تبريد$", "^ثلاجات", "^مجمد", "re:غرف(?:ه)? (?:ال)?تبريد", "cold storage", "cold room"],
    "concrete_floor": ["re:ارضي(?:ه|ات) (?:ال)?(?:خرسانه|خرسانيه|ايبوكسي|ابوكسي|اسمنتيه|اسمنت|سمنت)", "^ايبوكسي", "^ابوكسي", "epoxy",
                       "concrete floor"],
    "loading_dock": ["re:رصيف (?:لل|ال)?تحميل", "re:منص(?:ه|ات) (?:ال)?تحميل", "loading dock", "loading bay"],
    "big_gate": ["re:بوابه كبيره", "re:بوابات كبيره", "^بوابه", "^بوابات", "big gate", "large gate"],
    "truck_access": ["re:دخول (?:ال)?(?:شاحنات|تريلات|سطحات)", "^تريلات", "^تريلا$", "^سطحات", "^شاحنات", "truck access", "trucks"],
    "crane": ["^رافعه", "^رافعات", "^ونش", "^اوناش", "^كرين", "crane"],
    "racks": ["^ارفف", "^رفوف", "re:رفوف (?:ال)?تخزين", "racks", "shelving"],
    "office_inside": ["re:مكتب (?:اداري )?داخل", "re:(?:فيه|فيها|به|بها|يوجد|توجد|مع|وبه|وبها) مكتب", "re:مكاتب داخليه", "office inside"],
    "heavy_power": ["re:(?:3|ثلاث|ثلاثه) فاز", "re:ثري فيز", "re:محول (?:ال)?(?:كهرباء|كهربائي|كهربا)", "re:قوه كهربائيه", "^محول$",
                    "3 phase", "three phase"],
    "industrial_area": ["re:الصناعيه", "re:(?:ال)?مدينه (?:ال)?صناعيه", "re:منطقه صناعيه", "industrial area", "industrial city"],
    "car_service": ["re:مغسله (?:ال)?سيارات", "^بنشر", "re:صيانه (?:ال)?سيارات", "^تشحيم", "^سمكره", "re:ورشه (?:ال)?سيارات", "^ورشه$",
                    "car service"],
    "meeting_room": ["re:(?:قاعه|غرفه|قاعات|غرف) (?:ال)?اجتماعات", "meeting room"],
    "reception": ["^استقبال", "^ريسبشن", "^رسبشن", "reception"],
    "coworking": ["re:مساح(?:ه|ات) (?:ال)?عمل(?: مشتركه)?", "re:مكاتب مشتركه", "^كوركنج", "^كوركينج", "coworking", "co working"],
    "private_office": ["re:مكتب (?:خاص|اداري)", "re:مكاتب (?:خاصه|اداريه)", "private office"],
    "central_ac": ["re:(?:تكييف|تكيف|مكيف|مكيفات) (?:مركزي|مركزيه)", "central ac", "central air"],
    # contents of a building: a holding word or a count before the plural
    "shops_inside": ["re:(?:فيه|فيها|به|بها|يوجد|توجد|يحتوي|تحتوي|تضم|يضم|مكون من|مكونه من|يتكون من|تتكون من|وبها|وفيها|عدد) (?:علي )?(?:\d+ )?(?:ال)?(?:محلات|معارض|محلين|محلان|معرضين)",
                     "re:\d+ (?:محلات|معارض|محل|معرض)", "re:محلات تجاريه", "shops inside"],
    "offices_inside": ["re:(?:فيه|فيها|به|بها|يوجد|توجد|يحتوي|تحتوي|تضم|يضم|مكون من|مكونه من|يتكون من|تتكون من|وبها|وفيها|عدد) (?:علي )?(?:\d+ )?(?:ال)?(?:مكاتب|مكتبين)",
                      "re:\d+ (?:مكاتب|مكتب)", "re:مكاتب اداريه", "offices inside"],
    "apartments_inside": ["re:(?:فيه|فيها|به|بها|يوجد|توجد|يحتوي|تحتوي|تضم|يضم|مكون من|مكونه من|يتكون من|تتكون من|وبها|وفيها|عدد) (?:علي )?(?:\d+ )?(?:ال)?(?:شقق|شقتين|شقتان)",
                          "re:\d+ (?:شقق|شقه)", "apartments inside"],
    "staff_housing_inside": ["re:سكن (?:لل|ال)?(?:عمال|موظفين|عزاب)", "staff housing"],
    "restaurant_cafe": ["^مطعم$", "^كافيه$", "^مقهي$", "^مطاعم$", "^كافيهات$", "restaurant", "cafe"],
    # «حمام ومغسلة» is the basin, «مغسلة ملابس» the laundry — excluded below
    "car_wash": ["re:مغسله (?:ال)?سيارات", "^مغسله$", "car wash"],
    "market": ["^بقاله", "^ماركت", "^تموينات", "re:سوبر ماركت", "^سوبرماركت", "re:ميني ماركت", "supermarket", "grocery"],
    # «المؤجر والمستأجر» are the contract's parties, not an income — excluded below; «مستثمر» left out (an invitation)
    "earning_income": ["^مؤجر$", "^مؤجره$", "^موجر$", "^موجره$", "^ماجر$", "^ماجره$", "^دخل$", "^عائد$", "re:عائد سنوي", "re:دخل (?:سنوي|شهري)",
                       "rental income", "rented out"],
    "stars_mentioned": ["re:(?:خمس|اربع|ثلاث|سبع|\d) نجوم", "^نجوم$", "^نجمه$", "re:\d stars?", "star hotel"],
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
_PREPARED = tuple(_n(w) for w in N._PREPARED_ONLY + ("تمديد", "تمديدات", "امكانيه", "بالامكان", "قابل",
                                                        "قابليه", "يمكن", "ممكن", "يصلح"))
_PREPARED_PLACE = tuple(_n(w) for w in ("مكان", "مساحه", "موقع"))   # «مكان مسبح», «مكان للمصعد»
_PLACE_FACTS = frozenset({"pool", "elevator"})
# NEARBY: about the street, not the unit — no row. The scrapers' _PROXIMITY plus the words a view/distance uses.
_NEAR = tuple(_n(w) for w in N._PROXIMITY + ("قريب", "قريبه", "قرب", "بالقرب", "بجوار", "جوار", "مجاور", "مجاوره",
                                               "يبعد", "تبعد", "يطل", "تطل", "مطل", "مطله", "اطلاله", "باطلاله",
                                               "دقائق", "دقايق", "دقيقه", "near", "nearby", "close", "minutes",
                                               "walking", "overlooking", "views"))
_NEAR_WORDS = frozenset(w for w in _NEAR if " " not in w)
_NEAR_PHRASES = tuple(w for w in _NEAR if " " in w)
_PARTIAL = tuple(_n(w) for w in N._PARTIAL_ONLY + N._FLOOR_COVERING)
_PARTIAL_BEFORE = tuple(_n(w) for w in N._PARTIAL_BEFORE)

# Negators that TOUCH the token. One word («غير», «بدون») or two («لا يوجد», «لا نقبل»).
_NEG1 = frozenset(_n(w) for w in ("غير", "بدون", "بلا", "لايوجد", "لاتوجد", "مافيه", "مافي", "no", "without", "not",
                                   "non", "ليس", "ليست"))      # «ليست منحة» (owner handoff 2026-11-01)
_NEG2 = frozenset(_n(w) for w in ("لا يوجد", "لا توجد", "لا يتوفر", "لا تتوفر", "ما فيه", "ما في", "لا يشمل",
                                   "لا تشمل", "عدم وجود", "لا نقبل", "لا يقبل", "من غير", "ما يوجد", "is not"))
# …and AFTER it: «مطبخ غير راكب», «مفروشة: لا», «الضمانات ومدتها: لا يوجد», «المطابخ: 0».
_POST_NOT = tuple(_n(w) for w in ("متوفر", "موجود", "متاح", "مشمول", "شامل"))
_POST_NOT_FACT = {"kitchen": ("راكب", "مركب"), "air_conditioner": ("راكب", "مركب"), "furnished": ("مفروش", "مؤثث")}

_BEARINGS = ("شمال", "جنوب", "شرق", "غرب", "الشمال", "الجنوب", "الشرق", "الغرب", "وجه", "الوجه", "واجه", "الواجه", "يحد",
             "حدود")
# Per-fact context words: (excluded if one of the 2 words BEFORE starts with…, excluded if one of the 2 AFTER…)
_EXCLUDE: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "electricity": (("غرف", "ضمان", "تمديد", "لوح", "نظام", "انظمه", "فاتور", "فواتير", "مولد", "سباك", "اعمال", "كيبل",
                     "كابل", "مفاتيح", "افياش", "شرك", "محط", "برج", "ابراج", "خط", "خطوط", "تاسيس", "مصعد",
                     "اسلاك", "توصيل", "رسوم"),
                    ("مستقل", "منفصل", "مشترك", "علي حساب", "غير مشمول")),
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
    "sports_court": ((), ("اطفال", "الاطفال", "للاطفال", "الحي", "عام", "عامه", "بلدي", "البلديه")),
    "annex": (("حمام", "دوره", "دورات", "مطبخ", "غرف", "غرفه"),
              ("به", "بها", "بالغرفه", "بالصاله", "بالمطبخ", "بالمجلس", "بغرفه", "بالمبني", "بالفيلا")),
    "storage": (("خلف", "بجوار", "مقابل", "صناعي", "صناعيه"),     # «خلف مخازن …» is an address, «أرض صناعية ومستودعات» the type
                ("للايجار", "للبيع", "تجاري", "صناعي", "تجاريه", "صناعيه", "مبرد", "مبرده", "للتاجير")),
    "garden": (_BEARINGS + ("مناسب", "مثالي", "خلف", "مقابل"),   # «الوجهة: غرب حديقة» is a boundary; «مناسب للحديقة» a maybe
               ("عامه", "عام", "الحي", "العامه")),
    "parking": (_BEARINGS, ()),                                  # «جنوب: مواقف ثم شارع» is a boundary
    # «خزان المياه مستقل» is a tank, «دورة مياه مستقلة» a bathroom — not a meter (checked only on the
    # «مياه مستقل» / «كهرباء مستقلة» shapes; «خزانات وعدادات مستقلة» names the meter itself)
    "separate_water_meter": (("خزان", "دور", "حمام", "مغسل", "سخان", "تحلي", "فلتر", "مضخ", "بئر", "بير"), ()),
    "separate_electricity_meter": (("غرف", "لوح", "مولد", "تمديد", "خزان"), ()),
    "laundry_room": ((), ("سيار", "السيار", "صحون", "الصحون", "اطباق", "الاطباق", "مواعين")),   # «غسالة صحون» is a dishwasher
    "kitchen": (("ادوات", "سطح"), ()),
    "pool": (("ادوات", "مستلزمات"), ("table",)),                 # «pool table» is billiards
    # bench-v2: «مدخل مكيّف», «مداخل مكيفة», «ممرات مكيفة» — the building's lobby, not the unit's AC
    "air_conditioner": (("مدخل", "مداخل", "ممر", "لوبي", "ردهه", "بهو", "مصلي"), ()),
    "furnished": (("محل", "معرض", "مستودع", "محلات", "معارض"), ()),
    # ── group A (owner handoff 2026-11-01) ──
    "fire_pit": ((), ("غاز", "الغاز", "كهربائي", "كهربائيه", "مطبخ", "المطبخ")),       # «موقد غاز» is the kitchen stove
    "playstation": (("شاشه", "شاشات", "تلفزيون", "تلفاز", "تلفزيونات"), ()),            # «شاشة سوني» is a TV brand
    "mandi_pit": (("مطعم", "مطاعم", "محل"), ()),
    "tent": ((), ()),
    "two_sections": ((), ("نوم", "ماستر", "رئيسيه", "رئيسيين", "رئيسيتين")),              # «جناحين نوم» are bedrooms
    "for_youth": (("شارع", "حي", "طريق", "مركز", "نادي", "مخطط"), ()),                    # «شارع الشباب» is an address
    "toilets_on_site": ((), ("سباحه", "بخار", "مغربي", "تركي", "شمسي", "شمس", "زاجل")),   # «حمام سباحة» is the pool
    "lighting": ((), ("طبيعيه", "طبيعي")),                                              # «إضاءة طبيعية» is daylight
    "palms": (("حي", "شارع", "طريق", "مخطط", "مجمع", "مركز", "برج", "فندق", "مول", "واحه"), ()),   # «حي النخيل»
    "fruit_trees": (("حي", "شارع", "طريق", "مخطط", "مجمع", "عصير", "محل"), ()),
    "fodder_crops": (("سوق", "محل", "بقاله", "مطعم"), ()),                               # «سوق الخضار» is a market
    "poultry": (("مطعم", "مطاعم", "محل", "بروست"), ()),
    "farm_house": ((), ("شعر", "الشعر", "درج", "الدرج", "عمال", "العمال", "موظفين")),       # «مع بيت شعر», «بيت الدرج»
    "farm_rest_house": ((), ("للايجار", "للبيع", "يوميه", "يومي", "للتقبيل", "للتاجير")),  # the listing's own type
    "dunes_view": (("حي", "شارع", "طريق", "مخطط", "مجمع"), ()),                           # «حي الرمال», «حي النفود»
    "horses_stable": (("حي", "شارع", "طريق", "مخطط"), ()),
    "main_road": ((), ("الصحيح", "صحيح")),
    # ── group B (owner handoff 2026-11-01) ──
    "raised_plot": (("سعر", "اسعار", "قيمه", "ايجار", "اسقف", "سقف", "ارتفاع", "نسبه", "طلب"), ()),   # a high price / ceiling
    "all_services": ((), ("قريبه", "قريب", "بالقرب", "المجاوره", "مجاوره", "حولها", "حوله")),       # «جميع الخدمات قريبة»
    "street_lights": ((), ("تحميل", "للتحميل", "تنزيل")),                                        # «رصيف تحميل» is a dock
    "approved_plan": (("مكتب", "مسوق", "وسيط", "مقاول", "مهندس", "مقيم", "مثمن", "وكيل"), ()),
    "direct_owner": (("تفويض", "توكيل", "وكاله", "بتفويض", "مفوض", "مفوضين", "وكيل", "موكل"), ()),
    "no_services": (("مواد", "بترول", "نفط"), ()),                                                # «مواد خام»
    # ── group C (owner handoff 2026-11-01) ──
    "frontage": (("اتجاه", "الاتجاه"), ("شماليه", "جنوبيه", "شرقيه", "غربيه", "شمال", "جنوب", "شرق", "غرب", "بحريه", "حجر")),
    "in_tower": ((), ("كهرباء", "الكهرباء", "مياه", "المياه", "اتصالات", "الاتصالات", "مراقبه")),     # «برج كهرباء» is a pylon
    "license": (("رقم", "برقم"), ("بناء", "البناء", "فال", "اعلان", "الاعلان", "هدم", "حفر", "ترميم", "تسوير", "الهيئه", "هيئه")),
    "insulated_panel": ((), ("صوت", "للصوت", "الصوت", "صوتي", "صوتيا")),                             # «عازل للصوت» is soundproof
    "cold_storage": (("تكييف", "تكيف", "مكيف", "مكيفات", "نظام", "انظمه"), ()),                     # «نظام تبريد» is the AC
    "car_wash": (("حمام", "دوره", "بانيو", "جناح", "مرحاض"), ("ملابس", "يد", "ايدي", "رخام", "وشطاف", "شطاف")),
    "earning_income": (("بين", "حقوق", "التزامات", "توقيع"), ("والمستاجر", "المستاجر", "ومستاجر")),  # the contract's parties
    "rooms_suites": ((), ("خادمه", "خدامه", "شغاله", "نساء", "حريم", "نسائي", "ماستر", "رئيسي", "نوم", "سائق", "رجال", "الرجال",
                          "خاص", "ضيوف", "للضيوف")),
    "mosque": (("شارع", "طريق", "حي", "مخطط", "دوار", "ميدان"), ()),                                 # «شارع المسجد» is an address
    "market": (("شارع", "طريق", "حي"), ()),
    "reception": (("صاله", "غرفه", "مجلس", "صالة"), ()),                                           # «صالة استقبال» is a living room
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
_NEAR_AFTER = tuple(_n(w) for w in ("قريب", "بالقرب", "مجاور", "بجوار", "مقابل"))
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


def _bare(w: str) -> str:
    """A context word without its proclitics: «بدورة» → «دوره», «لحمام» → «حمام», «وبخزان» → «خزان»."""
    w = w[1:] if w.startswith("و") and len(w) > 3 else w
    w = w[1:] if w[:1] in ("ب", "ل", "ف") and len(w) > 3 else w
    return _strip_wa(w)


def _strip_wa(w: str) -> str:
    for p in ("وال", "و", "ال"):
        if w.startswith(p) and len(w) > len(p) + 1:
            return w[len(p):]
    return w


# «يوجد» / «توجد» ASSERTS what follows: «بدون سطح يوجد مكيفات» = no roof, there ARE air conditioners. A negator
# may touch it («لا يوجد»), but no catalogue word before it can carry an earlier «بدون» across it (🔬 2026-11-01:
# 12 aqar ads served AC unknown against their own yes box, ops_text_facts_conflicts).
_AFFIRM = frozenset(_n(w) for w in ("يوجد", "توجد"))


def _negated_before(prev: list[str]) -> Optional[int]:
    """How many words back the negation starts, or None. A list of catalogue words may sit in between."""
    j = len(prev)
    affirmed = False
    for _ in range(3):
        if j >= 1 and (prev[j - 1] in _NEG1 or _strip_wa(prev[j - 1]) in _NEG1):
            return len(prev) - (j - 1)
        if j >= 2 and (" ".join(prev[j - 2:j]) in _NEG2 or (_strip_wa(prev[j - 2]) + " " + prev[j - 1]) in _NEG2):
            return len(prev) - (j - 2)
        if affirmed:
            return None
        if j >= 1 and _strip_wa(prev[j - 1]) in _LIST_WORDS | {"اي", "وجود", "يوجد"}:
            affirmed = _strip_wa(prev[j - 1]) in _AFFIRM
            j -= 1
            continue
        return None
    return None


# The NEXT label of a REGA licence block is not a descriptor of this word: «… ماء، كهرباء النزاعات: لا يوجد» says the
# ad has no DISPUTES, not no electricity (🔬 2026-11-01: 12 dealapp/aqar ads, ops_text_facts_conflicts).
_FORM_LABELS = frozenset(_n(w) for w in ("النزاعات", "نزاعات", "الالتزامات", "التزامات", "الحقوق", "القيود", "الرهن",
                                          "الرهون", "الضمانات"))
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
            return True
    if fact not in _BILL_FACTS:
        return False
    p = [_strip_wa(x) if x.startswith("و") else x for x in prev[-3:]]
    if len(p) >= 2 and p[-2] == "لا" and _starts(p[-1], _BILLING):
        return True
    if len(p) >= 3 and p[-3] == "لا" and _starts(p[-2], _BILLING) and _strip_wa(prev[-1]) in _LIST_WORDS:
        return True                          # «لا يشمل الماء والكهرباء» — the bill list reaches the second utility
    return False


def _negated_after(nxt: list[str], fact: str) -> int:
    """How many words after the token belong to a post-negation («غير راكب», «لا», «لا يوجد», «0»), else 0."""
    for skip in (0, 1):                      # one descriptor may sit between: «مطبخ عربي غير راكب», «الضمانات ومدتها لا يوجد»
        w = nxt[skip:]
        if skip and (not nxt or _strip_wa(nxt[0]) in _LIST_WORDS or nxt[0].isdigit() or nxt[0] in _FORM_LABELS):
            break
        if len(w) >= 2 and w[0] == "غير" and _starts(w[1], _POST_NOT + tuple(_n(x) for x in _POST_NOT_FACT.get(fact, ()))):
            return skip + 2
        if len(w) >= 1 and w[0] in ("لايوجد", "لاتوجد"):
            return skip + 1
        if len(w) >= 2 and w[0] == "لا" and w[1] in ("يوجد", "توجد", "يتوفر", "تتوفر"):
            return skip + 2
        if len(w) >= 1 and w[0] == "لا" and (len(w) == 1 or w[1] == "غير"):
            return skip + 1
        if not skip and w and w[0] in ("0", "no", "none"):
            return 1
    return 0


# A DISTRICT NAME IS NOT A FACT (🔬 2026-11-02): «حي الخزان» read water_tank = yes, «حي الحديقة» garden, «حي المستودعات»
# storage, «حي الشرفة» balcony — ~100 ads on 9+ sites, every one in that district. The word right before the token
# says it is a place: «حي» with its glued prepositions. (Jeddah's «مشرفة» is the glued case, N._inside_a_name.)
_DISTRICT_WORDS = frozenset(_n(w) for w in ("حي", "بحي", "وحي", "لحي", "فحي", "وبحي", "بالحي", "الحي"))


def _judge(fact: str, t: str, s: int, e: int, forced: Optional[bool], n_words: int,
           cue_in: bool = False, near_in: bool = False) -> tuple[Optional[bool], int, int]:
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
    if any(_starts(w, _PREPARED) for w in p2 + n2) or "prepared for" in " ".join(n2):
        return None, s, e
    if fact in _PLACE_FACTS and any(_starts(w, _PREPARED_PLACE) for w in p2):
        return None, s, e
    g5 = " ".join(gp[-5:])                           # «توجد رخصة بناء تسوير وملاحق»: allowed to build ≠ built
    if any(_strip_wa(w) in ("رخصه", "تصريح", "يسمح", "مسموح") for w in gp[-5:]) and "اعلان" not in g5 and "فال" not in g5 \
            or "نظام البناء" in g5:
        return None, s, e
    if fact == "furnished" and (any(_starts(w, _PARTIAL) for w in n2) or any(_starts(w, _PARTIAL_BEFORE) for w in prev[-1:])):
        return None, s, e
    p5 = gp[-5:]
    if any(_strip_wa(w) in _NEAR_WORDS or w in _NEAR_WORDS for w in p5) or any(p in " ".join(p5) for p in _NEAR_PHRASES):
        return None, s, e
    n3 = gn[:3]                                      # English puts it AFTER: «car park nearby», «pool and gym nearby»
    if "nearby" in n3 or "close by" in " ".join(n3):
        return None, s, e
    if fact in _PUBLIC_FACTS and (any(_starts(w, _NEAR_AFTER) for w in gn[:4]) or (near_in and n_words <= 3)):
        return None, s, e
    ex_before, ex_after = _EXCLUDE.get(fact, ((), ()))
    if fact in _METER_FACTS and "عداد" in t[ws:e]:
        ex_before = ()                               # «خزانات وعدادات مستقلة» names the meter itself
    if fact in _NEEDS_CUE and p2 and _starts(p2[-1], _CUES):
        ex_before, ex0 = (), ex_before               # «3 غرف واصل كهرباء»: the cue sits between (AI teacher pass 2026-10-27)
        if _starts(p2[-1], ("عداد",)):
            if _negated_before(prev[:-1]) is not None or head in ("غير",):
                return None, s, e                    # «لا يوجد عداد ماء»: a missing meter is not «no water»
            if any(_starts(_strip_wa(w), ex0) or _starts(w, ex0) for w in p2[:-1]):
                return None, s, e                    # «رسوم / تأسيس / توصيل عداد كهرباء»: a fee or a set-up, not a supply
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
    back = _negated_before(prev)
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


def _clauses(text: str) -> list[tuple[int, str]]:
    out, pos = [], 0
    for m in N._CLAUSE_BREAK_RE.finditer(text):
        if m.start() > pos:
            out.append((pos, text[pos:m.start()]))
        pos = m.end()
    if pos < len(text):
        out.append((pos, text[pos:]))
    return out


def _num_hits(fact: str, t: str, ci: int) -> list[Hit]:
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
            if fact == "bathrooms" and any(_strip_wa(w) in ("كل", "لكل", "بكل") for w in before[-3:]):
                continue                      # «كل شقه 2 دورات مياه»: a per-unit count, not the home's
            if any(w in _NEAR_WORDS for w in before):
                continue
            if any(_strip_wa(w).startswith(x) for w in before for x in ("نظام", "رخص", "تصريح", "يسمح", "مسموح", "حتي")):
                continue                      # «نظام البناء 3 ادوار», «تصريح حتى 12 دور»: what may be built, not what is
            if fact == "floors" and ("ارضي" in t[max(0, m.start() - 12):m.end() + 12] or after.lstrip().startswith("مي")):
                continue                      # «دورين مياه» is a typo for two bathrooms                      # «ارضي + دورين» — ground floor + two? ambiguous: no row
            hits.append(Hit(fact, v, m.start(), m.end(), ci))
    return hits


def _blank_place_names(t: str, names: tuple[str, ...]) -> str:
    """The ad's OWN district / city names, blanked (same length, so quote offsets hold) before any fact is read.

    Backlog 1188 (🔬 2026-11-02): «حي X» is caught in _judge, but a title that is a URL slug — abaad 13214542
    «دور-بيشة-الخزان» (type-city-district) — has no «حي» before the name, and district «الخزان» read water_tank = yes.
    The listing already KNOWS its place, so its own names are removed as whole words: no stem list, no guessing.
    Only the exact normalised name goes («الخزان»); a bare «خزان ماء» in the same ad is still read."""
    for name in names:
        nn = norm(name or "").strip()
        if len(nn) >= 3:
            t = re.sub(r"(?<!\S)" + re.escape(nn) + r"(?!\S)", lambda m: " " * len(m.group(0)), t)
    return t


def check(text: str, place_names: tuple[str, ...] = ()) -> list[dict[str, Any]]:
    """Facts the ad's text states: [{fact, value_bool|value_num|value_text, quote}], quote = the ad's own span.
    place_names: the listing's own district / city — never read as a fact (_blank_place_names)."""
    if not text:
        return []
    raw = unicodedata.normalize("NFKC", text)
    full_norm = norm(raw)
    clauses = [(off, c) + norm_map(c) for off, c in _clauses(raw)]
    if place_names:
        clauses = [(off, c, _blank_place_names(t, place_names), idx) for off, c, t, idx in clauses]
    bool_hits: dict[str, dict[bool, tuple[int, int, int]]] = {}
    num_hits: dict[str, list[Hit]] = {}
    cue_in = near_in = False
    void = {j for ci, (_o, _c, t, _i) in enumerate(clauses) if any(p in t for p in _NOT_STATED) for j in (ci - 1, ci)}
    for ci, (_off, _c, t, _idx) in enumerate(clauses):
        if not t or ci in void:
            continue
        words = t.split()
        n_words = len(words)
        for fact, pats in _PATTERNS.items():
            for rx, forced in pats:
                for m in rx.finditer(t):
                    v, qs, qe = _judge(fact, t, m.start(), m.end(), forced, n_words, cue_in, near_in)
                    if v is not None:
                        bool_hits.setdefault(fact, {}).setdefault(v, (ci, qs, qe))
        # what this clause hands to the next one: a cue (or a cued utility list going on), a «nearby» heading
        # (a cue alone does not carry: «لا يوجد مصعد, مياه …» must not cue the next clause)
        cue_in = (any(_starts(w, _CUES) for w in words) and any(_starts(_strip_wa(w), _UTILITY) for w in words)) \
            or (cue_in and _starts(_strip_wa(words[0]), _UTILITY))
        # a heading ENDS with the nearby word: «خدمات قريبة:», «بالقرب من:», «Nearby:»
        near_in = any(_strip_wa(w) in _NEAR_WORDS or w in _NEAR_WORDS for w in words[-2:]) or (near_in and n_words <= 3)
        for fact in _COUNT_RES:
            num_hits.setdefault(fact, []).extend(_num_hits(fact, t, ci))
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
    if bath_hits:
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
    return out


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
        ("لا يوجد مصعد", {"elevator": False}, ()),
        ("ولا يوجد مصعد في المبنى", {"elevator": False}, ()),
        ("مفروشة: لا", {"furnished": False}, ()),
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
        ("غرفتين و2 حمام", {"bathrooms": 2.0}, ()),
        ("دورة مياه واحدة", {"bathrooms": 1.0}, ()),
        ("مسبح و حمام سباحة", {}, ("bathrooms",)),
        ("دورة مياه خارجية", {}, ("bathrooms",)),
        ("3 دورات مياه بكل شقة", {}, ("bathrooms",)),
        ("عمارة 8 شقق كل شقة 2 دورات مياه", {}, ("bathrooms",)),
        ("الدور الاول 3 دورات مياه والارضي دورتين مياه", {}, ("bathrooms",)),
        ("مجلس رجال . دورة مياه تخدم القسم الرجالي . 3 غرف نوم . 2دورة مياه .", {}, ("bathrooms",)),
        ("3 دورات مياه ودورة مياه خارجية", {"bathrooms": 3.0}, ()),
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
        ("موقد غاز في المطبخ", {}, ("fire_pit",)),
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
        ("صالة مناسبات", {"events_hall": True, "for_events": True}, ()),
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
        ("ركوب الخيل", {"horses_stable": True}, ()),
        ("خيول للركوب", {"horses_stable": True}, ()),
        ("مزرعة الخيليين", {}, ("horses_stable",)),
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
        ("غير مخدومة", {"all_services": False, "no_services": True}, ()),
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
        ("ارتداد 3 متر", {"floors_allowed": True}, ()),
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
        ("بدون زجاج", {"glass_front": False}, ()),
        ("محل واجهتين", {"frontage": True}, ()),
        ("واجهات على الشارع", {"frontage": True}, ()),
        ("الواجهة: شمالية", {}, ("frontage",)),
        ("محل داخل مول", {"in_mall": True}, ()),
        ("مجمع تجاري", {"in_mall": True}, ()),
        ("بلازا", {"in_mall": True}, ()),
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
        ("لم يستخدم", {"first_tenant": True}, ()),
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
        ("بدون بوابه", {"big_gate": False}, ()),
        ("دخول الشاحنات", {"truck_access": True}, ()),
        ("مدخل تريلات وسطحات", {"truck_access": True}, ()),
        ("لا يسمح بدخول الشاحنات", {}, ("truck_access",)),
        ("رافعة 5 طن", {"crane": True}, ()),
        ("ونش وكرين", {"crane": True}, ()),
        ("بدون رافعه", {"crane": False}, ()),
        ("رفوف تخزين", {"racks": True}, ()),
        ("أرفف حديد", {"racks": True}, ()),
        ("بدون رفوف", {"racks": False}, ()),
        ("مكتب داخل المستودع", {"office_inside": True, "storage": True}, ()),
        ("فيه مكتب إداري", {"office_inside": True, "private_office": True}, ()),
        ("بدون مكتب", {}, ("office_inside",)),
        ("كهرباء 3 فاز", {"heavy_power": True}, ()),
        ("محول كهرباء خاص", {"heavy_power": True}, ()),
        ("ثلاث فاز", {"heavy_power": True}, ()),
        ("بدون محول", {"heavy_power": False}, ()),
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
        ("مبنى يحتوي على مكاتب", {"offices_inside": True}, ()),
        ("عدد المكاتب 10", {"offices_inside": True}, ()),
        ("مكتب للإيجار", {}, ("offices_inside",)),
        ("عمارة فيها 8 شقق", {"apartments_inside": True, "apartments_count": 8.0}, ()),
        ("تتكون من شقتين", {"apartments_inside": True, "apartments_count": 2.0}, ()),
        ("شقة للإيجار", {}, ("apartments_inside",)),
        ("سكن عمال", {"staff_housing_inside": True, "workers_housing": True}, ()),
        ("سكن موظفين", {"staff_housing_inside": True}, ()),
        ("بدون سكن عزاب", {"staff_housing_inside": False}, ()),
        ("فيه مطعم وكافيه", {"restaurant_cafe": True, "food_allowed": True}, ()),
        ("مقهى في الدور الأرضي", {"restaurant_cafe": True}, ()),
        ("بجوار مطعم", {}, ("restaurant_cafe",)),
        ("مغسلة", {}, ()),
        ("مغسلة سيارات", {"car_wash": True}, ()),
        ("يوجد مغسله", {"car_wash": True}, ()),
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
    assert "garden" not in facts_of(clean_text("فيلا-الرياض-الحديقة", "فيلا للبيع"), ("الحديقة", "الرياض"))
    both = facts_of(clean_text("دور-بيشة-الخزان", "دور للبيع مع خزان ماء"), ("الخزان", "بيشة"))
    assert both.get("water_tank") is True, both          # a real «خزان ماء» in the same ad is still read
    assert facts_of(slug, ("",)) == facts_of(slug) and facts_of(slug, ("ال",)) == facts_of(slug)   # empty / too-short names: no-op
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
