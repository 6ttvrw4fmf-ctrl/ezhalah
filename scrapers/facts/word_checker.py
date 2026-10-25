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
    return unicodedata.normalize("NFKC", out)[:MAX_TEXT]


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
_POWER = r"(?:ال)?(?:كهرباء|كهربا|كهرب)"

FACT_TOKENS: dict[str, list[Any]] = {
    "elevator": ["^اصانصير", "^اسانسير", "^اصنصير", "^اسنسير"],
    "kitchen": ["^مطابخ"],                                      # «المطابخ: 1» (sakan/tuba count label)
    "air_conditioner": ["^تكيف$"],
    "parking": ["^باركينج", "^باركنج"],                      # transliterations (bench-v1: «باركينج خاص»)
    "maid_room": ["غرفة عاملة", "غرفة للعاملة", "غرفة العاملة", "غرفة للخادمة", "غرفة الخادمة", "غرف خادمات",
                  "غرفة للشغالة", "غرفة الشغالة", "غرفة خدامة"],
    "driver_room": ["غرفة سواق", "غرفة سايق", "غرفة للسائق", "غرفة السائق", "غرفة للسواق", "غرفة السواق",
                    "re:غرف (?:لل|ال)?سائقين", "غرفة سائقين"],
    "laundry_room": [],
    "balcony": ["^بلكون", "^بالكون", "^شرفات", "balcon"],
    "private_entrance": ["مداخل خاصة", "مداخل مستقلة", ("re:مدخل (?:ال)?مشترك", False)],
    "car_entrance": ["مدخل للسيارة", "مدخل للسيارات", "مدخل سيارتين"],
    "optical_fibers": ["re:(?:ال)?الياف (?:ال)?(?:ضوئيه|بصريه)", "fibreoptic", "^fiber", "^fibre"],
    "furnished": ["^موثث", ("re:(?:بدون|بلا|من غير) (?:ال)?اثاث", False), "re:(?:مع|شامل|شامله) (?:ال)?اثاث"],
    "electricity": ["^كهرباء", "^كهربا$", "^electricity"],
    "water_supply": ["^مياه", "^ماء$", "^مويه$", "re:waters?"],
    "sanitation": ["re:(?:ال)?صرف (?:ال)?صحي", "^sanitation", "^sewage", "^sewer"],
    "separate_electricity_meter": [
        rf"re:عداد(?:ات)? {_POWER}(?: و{_WATER})? {_METER}",
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
    "roof": ["^سطح$", "^سطحين$", "^سطحان$", "^سطوح$", "^روف$", "^roof"],
    "warranty": ["^ضمان", "^صمانات", "^ظمانات", "^warrant"],  # common misspellings; never bare «صمان» (وادي الصمان)
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
}
for _k, _src in _INHERITED.items():
    FACT_TOKENS[_k] = list(N._AMENITY_TOKENS[_src]) + FACT_TOKENS[_k]

# Not read from prose (the LLM run found 0 rows: a platform feature, not something ads say).
NOT_IN_PROSE = frozenset({"installment_available", "rent_now_pay_later"})
assert set(FACT_TOKENS) | NOT_IN_PROSE == BOOL_FACTS, set(FACT_TOKENS) ^ BOOL_FACTS

# Words that are themselves a catalogue thing — a negator may reach across a LIST of them:
# «بدون مكيفات ومطبخ» negates both, «بدون عمولة ومطبخ» negates nothing.
_LIST_WORDS = frozenset(_n(w) for w in (
    "مكيفات", "مكيف", "مطبخ", "مصعد", "مسبح", "اثاث", "مواقف", "موقف", "حوش", "سطح", "ملحق", "مجلس", "خزان",
    "خزانات", "عداد", "كهرباء", "مياه", "ماء", "صرف", "تكييف", "حديقه", "كراج", "مستودع", "بلكونه", "بئر"))

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
                                   "non"))
_NEG2 = frozenset(_n(w) for w in ("لا يوجد", "لا توجد", "لا يتوفر", "لا تتوفر", "ما فيه", "ما في", "لا يشمل",
                                   "لا تشمل", "عدم وجود", "لا نقبل", "لا يقبل", "من غير", "ما يوجد", "is not"))
# …and AFTER it: «مطبخ غير راكب», «مفروشة: لا», «الضمانات ومدتها: لا يوجد», «المطابخ: 0».
_POST_NOT = tuple(_n(w) for w in ("متوفر", "موجود", "متاح", "مشمول", "شامل"))
_POST_NOT_FACT = {"kitchen": ("راكب", "مركب"), "air_conditioner": ("راكب", "مركب"), "furnished": ("مفروش", "مؤثث")}

_BEARINGS = ("شمال", "جنوب", "شرق", "غرب", "الشمال", "الجنوب", "الشرق", "الغرب", "وجه", "الوجه", "واجه", "الواجه", "يحد",
             "حدود")
# Per-fact context words: (excluded if one of the 2 words BEFORE starts with…, excluded if one of the 2 AFTER…)
_EXCLUDE: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "electricity": (("غرف", "عداد", "ضمان", "تمديد", "لوح", "نظام", "انظمه", "فاتور", "فواتير", "مولد", "سباك", "اعمال", "كيبل",
                     "كابل", "مفاتيح", "افياش", "شرك", "محط", "برج", "ابراج", "خط", "خطوط", "تاسيس", "مصعد",
                     "اسلاك", "توصيل", "رسوم"),
                    ("مستقل", "منفصل", "مشترك", "علي حساب", "غير مشمول")),
    "water_supply": (("دور", "حمام", "خزان", "عداد", "سخان", "تصريف", "مضخ", "بئر", "بير", "ابار", "تسريب", "ضمان",
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
    "water_tank": ((), ("ملابس", "مطبخ", "المطبخ", "حائط", "جداري", "دولاب", "خشب", "حائطيه", "ملابس")),
    "well": ((), ("السلم", "سلم", "الدرج", "درج", "المصعد", "مصعد", "عثمان", "سلوي")),
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
    "laundry_room": ((), ("سيار", "السيار")),
    "kitchen": (("ادوات", "سطح"), ()),
    "pool": (("ادوات", "مستلزمات"), ()),
    # bench-v2: «مدخل مكيّف», «مداخل مكيفة», «ممرات مكيفة» — the building's lobby, not the unit's AC
    "air_conditioner": (("مدخل", "مداخل", "ممر", "لوبي", "ردهه", "بهو", "مصلي"), ()),
    "furnished": (("محل", "معرض", "مستودع", "محلات", "معارض"), ()),
}
# Facts that only count with a context word near them (or as a bare list item) — «واصل كهرباء»,
# «خدمات العقار: كهرباء، مياه»; never a bare «مياه» inside a sentence (it is a bathroom, a well, a sea …).
_CUES = tuple(_n(w) for w in ("واصل", "واصله", "موصل", "موصله", "خدمات", "الخدمات", "المرافق", "مرافق", "يوجد",
                              "توجد", "موجود", "متوفر", "متوفره", "يتوفر", "تتوفر", "توفر", "شامل", "شامله", "مع",
                              "services", "utilities", "has", "have", "connected", "connection", "connections",
                              "included", "includes", "including", "supply"))
_NEEDS_CUE = frozenset({"electricity", "water_supply"})
# A utility word that carries a list on into the next clause: «خدمات العقار: Electricity, Waters الضمانات …» —
# the comma ends the clause, so «Waters» has no cue of its own (bench-v1: ~340 water/electricity misses).
_UTILITY = tuple(_n(w) for w in ("كهرب", "مياه", "ماء", "مويه", "صرف", "هاتف", "الياف", "electricity", "water",
                                 "sanitation", "fibre", "fiber", "telephone", "phone"))
# Public amenities a neighbourhood also has: «مسجد وحديقة قريبة من العمارة», «حديقة … مقابل العمارة»,
# and the items of a «خدمات قريبة: مسجد - حديقة» list — the nearby word may come AFTER, or a clause before.
_PUBLIC_FACTS = frozenset({"garden", "pool", "gym", "parking"})
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


def _strip_wa(w: str) -> str:
    for p in ("وال", "و", "ال"):
        if w.startswith(p) and len(w) > len(p) + 1:
            return w[len(p):]
    return w


def _negated_before(prev: list[str]) -> Optional[int]:
    """How many words back the negation starts, or None. A list of catalogue words may sit in between."""
    j = len(prev)
    for _ in range(3):
        if j >= 1 and (prev[j - 1] in _NEG1 or _strip_wa(prev[j - 1]) in _NEG1):
            return len(prev) - (j - 1)
        if j >= 2 and (" ".join(prev[j - 2:j]) in _NEG2 or (_strip_wa(prev[j - 2]) + " " + prev[j - 1]) in _NEG2):
            return len(prev) - (j - 2)
        if j >= 1 and _strip_wa(prev[j - 1]) in _LIST_WORDS | {"اي", "وجود", "يوجد"}:
            j -= 1
            continue
        return None
    return None


def _negated_after(nxt: list[str], fact: str) -> int:
    """How many words after the token belong to a post-negation («غير راكب», «لا», «لا يوجد», «0»), else 0."""
    for skip in (0, 1):                      # one descriptor may sit between: «مطبخ عربي غير راكب», «الضمانات ومدتها لا يوجد»
        w = nxt[skip:]
        if skip and (not nxt or _strip_wa(nxt[0]) in _LIST_WORDS or nxt[0].isdigit()):
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
    if any(_starts(_strip_wa(w), ex_before) or _starts(w, ex_before) for w in p2) or \
            any(_starts(w, ex_after) for w in n2) or any(x in " ".join(n2) for x in ex_after if " " in x):
        return None, s, e
    if fact in _NEEDS_CUE and not (any(_starts(w, _CUES) for w in gp[-3:] + gn[:1]) or n_words <= 3
                                   or (cue_in and not prev)):
        return None, s, e
    if forced is not None:
        return forced, ws, we
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

_WORD_NUM = {"واحد": 1, "دورين": 2, "دوران": 2, "طابقين": 2, "شقتين": 2, "شقتان": 2, "محلين": 2, "محلان": 2,
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
    "shops_count": (
        re.compile(r"عدد (?:ال)?(?:محلات|معارض|فتحات)(?: (?:ال)?تجاريه)? ?(\d{1,3})(?!\w)"),
        re.compile(r"(?:(?<= )|^)(\d{1,3}) ?(?:محلات|معارض|فتحات)(?!\w)"),
        re.compile(r"(?:(?<= )|^)(\d{2,3}) ?محل(?!\w)"),
        re.compile(rf"(?:(?<= )|^){_NUMW} (?:محلات|معارض|فتحات)(?!\w)"),
        re.compile(r"(?:(?<= )|^)(?:عدد )?(محلين|محلان)(?!\w)"),
    ),
}
_COUNT_RANGE = {"floors": (1, 60), "apartments_count": (2, 500), "shops_count": (1, 300)}
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
            if any(w in _NEAR_WORDS for w in before):
                continue
            if any(_strip_wa(w).startswith(x) for w in before for x in ("نظام", "رخص", "تصريح", "يسمح", "مسموح", "حتي")):
                continue                      # «نظام البناء 3 ادوار», «تصريح حتى 12 دور»: what may be built, not what is
            if fact == "floors" and ("ارضي" in t[max(0, m.start() - 12):m.end() + 12] or after.lstrip().startswith("مي")):
                continue                      # «دورين مياه» is a typo for two bathrooms                      # «ارضي + دورين» — ground floor + two? ambiguous: no row
            hits.append(Hit(fact, v, m.start(), m.end(), ci))
    return hits


def check(text: str) -> list[dict[str, Any]]:
    """Facts the ad's text states: [{fact, value_bool|value_num|value_text, quote}], quote = the ad's own span."""
    if not text:
        return []
    raw = unicodedata.normalize("NFKC", text)
    full_norm = norm(raw)
    clauses = [(off, c) + norm_map(c) for off, c in _clauses(raw)]
    bool_hits: dict[str, dict[bool, tuple[int, int, int]]] = {}
    num_hits: dict[str, list[Hit]] = {}
    cue_in = near_in = False
    for ci, (_off, _c, t, _idx) in enumerate(clauses):
        if not t:
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
    for fact in ("floors", "apartments_count", "shops_count", "property_age_years"):
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


def facts_of(text: str) -> dict[str, Any]:
    """{fact: value} — a convenience view of check() for tests and the finder."""
    return {r["fact"]: next(r[k] for k in ("value_bool", "value_num", "value_text") if r[k] is not None) for r in check(text)}


# ── self-check: real tricky phrases from the LLM run's report (FACTS_EXTRACT_TEST_2026-10-24.md) ──────────
def selftest() -> None:
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
        ("مفروش: لا (غير مفروش)", {"furnished": False}, ()),
        ("مطبخ غير راكب", {"kitchen": False}, ()),
        ("مطبخ (SPLIT) (غير راكب)", {"kitchen": False}, ()),
        ("مطبخ راكب ومكيفات راكبة", {"kitchen": True, "air_conditioner": True}, ()),
        ("بدون مكيفات ومطبخ", {"air_conditioner": False, "kitchen": False}, ()),
        ("بدون عمولة ومطبخ راكب", {"kitchen": True}, ()),
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
        ("عداد كهرباء مستقل", {"separate_electricity_meter": True}, ("electricity",)),
        ("عداد كهرباء ومياه مستقل", {"separate_electricity_meter": True, "separate_water_meter": True}, ()),
        ("لا يوجد عداد ماء", {}, ("water_supply",)),
        ("عداد الماء مشترك", {"separate_water_meter": False}, ()),
        ("شارع ٢٥", {}, ("street_width_m",)),
        ("شارع 25 م", {"street_width_m": 25.0}, ()),
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
        ("نظام البناء: سكني 3 ادوار", {}, ("floors",)),
        # PDPL: a neighbour's name in a boundaries cell drops the whole row; a street named after a person does not
        ("شمالاً: ملك فلان بن فلان بطول 20م، جنوباً: شارع بعرض 15م بطول 20م", {}, ("boundaries",)),
        ("الحدود: شمالا آل فلان بطول 20 جنوبا شارع بطول 20", {}, ("boundaries",)),
        ("الاطوال 20 × 30 على طريق الملك فلان بن فلان", {"boundaries": "الاطوال 20 × 30"}, ()),
        ("الدفع شهري", {"payment_monthly": True}, ()),
        ("لا نقبل الدفع الشهري", {"payment_monthly": False}, ()),
        ("مسبح خاص", {"pool": True}, ()),
        ("حوض سباحه", {"pool": True}, ()),
        ("مكيف سبليت", {"air_conditioner": True}, ()),
        ("غرفة خادمة مع دورة مياه", {"maid_room": True}, ("water_supply",)),
        ("حي المشرفة", {}, ("balcony",)),
        ("شقة كبيرة", {}, ("well",)),
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
