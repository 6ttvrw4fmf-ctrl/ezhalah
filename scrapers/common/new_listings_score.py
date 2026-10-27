"""New listings, measured against their own original ads — the 🆕 engineer's computed rating
(docs/ops/NEW_LISTINGS_ENGINEER.md, "Your score"; same shape as dead_visible_score for ♻️).

WHAT IT OPENS. search_listings_ar rows first seen in the last 24 h and production_ready — what a
customer can actually find — sampled per website (a small website: all of them or 5; a big one: 10).
Each sampled ad's original page is re-read through the SAME independent reader the engineer uses
(scrapers/common/source_reread.py: page_evidence over cleanup._probe — JSON-LD, meta, and the
visible lines that carry a price, size, rooms or an amenity; none of our parsers). Every field we
serve is compared with what the page itself says, field by field:

  match        the page agrees with the value we serve
  mismatch     the page clearly states something else
  we-miss      the page states it, we serve NULL / unknown
  page-silent  neither side claims it (NEVER counted as wrong — silent means unknown)
  unreadable   the page could not be read (NEVER counted as wrong)

Location is the owner's priority, so it is reported per level: region match, city match, district
match. District equivalence: «حي X» and «X» are the same, a numbered district folds onto the plain
name, and a glued city suffix («الرابية الهفوف») that CONTAINS our stored district is a match.

WHAT IT WRITES. Nothing on any listing. One row per website per night into ops_new_listings_score;
until that table exists it prints the rows and exits 0. Mismatch evidence is our own
"source_table:id" keys only — never a URL, a name or a phone (PDPL).

  python -m scrapers.common.new_listings_score                      # every website, write rows
  python -m scrapers.common.new_listings_score --sites aqar gathern --per-site 3 --dry-run --json
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from scrapers.common.cleanup import _probe  # noqa: F401  (kept for callers that patch it)
from scrapers.common.db import sb
from scrapers.common.source_reread import page_evidence

TABLE = "ops_new_listings_score"
PAGE = 1000                 # PostgREST max-rows per answer
BIG_NEW = 50                # a website with 50+ new listings tonight is big
N_BIG, N_SMALL = 10, 5      # rulebook double-check sizes: 10 on a big website; all or 5 on a small one
PACE_S = 1.0                # at most one page a second per website

# ── The rating rule: the owner tunes THESE, nothing else (NEW_LISTINGS_ENGINEER.md, "Your score") ──
RATING_10_NORMAL_ACCURACY = 0.99   # normal-filter fields: match / (match + mismatch)
RATING_10_AF_PRECISION = 0.99      # of our yes/no claims the page could judge, how many it agrees with
RATING_10_AF_RECALL = 0.90         # of what the page states, how many we captured (not NULL)
MIN_DECIDED_ADS = 5                # a website enters the 10/10 thresholds only with >= 5 decided ads
SITE_ACCURACY_FLOOR = 0.95         # ANY website below this on normal accuracy caps the rating…
FLOOR_CAP = 5                      # …at this

# Owner 2026-10-02: Gathern + Aqar Monthly stays are priced by length; never compare their price.
SKIP_PRICE = {"gathern", "aqarmonthly"}
# Websites whose served page names the district ONLY in the seller's free text, while the platform's own
# structured neighbourhood (which we serve) lives in an API the page HTML does not carry. mobasher 17693081
# (2026-10-14): API neighborhoodNameAr «حي الثقبة» (stored), page HTML contains «الثقبة» nowhere (re-read run
# 38527021238, around=الثقبة: 0 hits), description «مدينة الخبر، حي الحمراء». Prose is never the source field
# (rule 3), so on these pages the district is page-silent, never a mismatch.
PROSE_ONLY_DISTRICT = {"mobasher"}

MATCH, MISMATCH, WE_MISS, PAGE_SILENT, UNREADABLE = "match", "mismatch", "we_miss", "page_silent", "unreadable"

STORED = ("platform,source_table,listing_id,region_ar,city_ar,district_ar,deal_ar,type_ar,rent_period_ar,"
          "price_total,price_annual,price_per_meter,area_m2,bedrooms,bathrooms,property_age,furnished,"
          "elevator,parking,kitchen,air_conditioner,maid_room,driver_room,private_entrance,"
          "rent_now_pay_later,installment_available,balcony,pool,garden,living_rooms,majlis_rooms,"
          "total_floors,ac_type,furnishing_level,direction_ar,street_width_m,floor_number")


# ── Arabic normalisation (both sides of every comparison go through this) ──────────────────────

_DIGITS = {ord(a): w for a, w in zip("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")}


def norm(s: str) -> str:
    s = (s or "").translate(_DIGITS).replace("ـ", "")
    s = re.sub("[أإآ]", "ا", s)
    s = s.replace("ى", "ي").replace("ة", "ه")
    return re.sub(r"\s+", " ", s).strip()


def norm_district(s: str) -> str:
    """«حي النرجس 2» → «النرجس»: drop the «حي» word and a trailing fold number."""
    d = norm(s)
    d = re.sub(r"^حي\s+", "", d)
    return re.sub(r"\s*\d+$", "", d).strip()


# ── Field table: (name, kind, stored column(s), page keyword in NORMALISED spelling) ───────────
# kind: word = the stored words appear on the page; number = the stored figure appears (near its
# keyword when small); bool = the amenity word appears, negated or not; district/price are special.

NORMAL_FIELDS = ("region", "city", "district", "deal", "type", "rent_period", "price", "area", "bedrooms")

AGE_KW = r"عمر العقار"
NEW_BUILDING = re.compile(AGE_KW + r"\s*[:：]?\s*جديد")

FIELDS: list[tuple[str, str, str, str]] = [
    ("region", "word", "region_ar", ""),
    ("city", "word", "city_ar", ""),
    ("district", "district", "district_ar", ""),
    ("deal", "deal", "deal_ar", ""),
    ("type", "word", "type_ar", ""),
    ("rent_period", "word", "rent_period_ar", ""),
    ("price", "price", "", r"ريال|ر\.س|SAR"),
    ("area", "number", "area_m2", r"م²|م2|متر|مساحه"),
    ("bedrooms", "number", "bedrooms", r"غرف|غرفه نوم"),
    # Advanced Filter fields the app serves (the rulebook scorecard's af_n columns + bathrooms).
    ("bathrooms", "number", "bathrooms", r"حمام|دوره مياه|دورات مياه|دوره المياه|دورات المياه"),
    ("property_age", "number", "property_age", AGE_KW),
    ("street_width_m", "number", "street_width_m", r"عرض الشارع"),
    ("floor_number", "number", "floor_number", r"الطابق|رقم الدور"),
    ("living_rooms", "number", "living_rooms", r"صاله|صالات"),
    ("majlis_rooms", "number", "majlis_rooms", r"مجلس|مجالس"),
    ("total_floors", "number", "total_floors", r"عدد الادوار|عدد الطوابق"),
    # «مفروشات» / «مؤثثات» are FURNITURE (muktamel's nav: «شركات الصيانة ونقل المفروشات»), not «furnished».
    ("furnished", "bool", "furnished", r"مفروش(?!ات)|مؤثث(?!ات)"),
    ("elevator", "bool", "elevator", r"مصعد"),
    ("parking", "bool", "parking", r"موقف|مواقف|كراج|جراج"),
    ("kitchen", "bool", "kitchen", r"مطبخ"),
    ("air_conditioner", "bool", "air_conditioner", r"مكيف|تكييف"),
    ("maid_room", "bool", "maid_room", r"غرفه خادمه"),
    ("driver_room", "bool", "driver_room", r"غرفه سائق"),
    ("private_entrance", "bool", "private_entrance", r"مدخل خاص"),
    ("rent_now_pay_later", "bool", "rent_now_pay_later", r"ادفع لاحق|ايجار الان"),
    ("installment_available", "bool", "installment_available", r"تقسيط|اقساط"),
    ("balcony", "bool", "balcony", r"شرفه|بلكون"),
    ("pool", "bool", "pool", r"مسبح"),
    ("garden", "bool", "garden", r"حديقه"),
    ("direction_ar", "word", "direction_ar", r"واجهه|الاتجاه"),
    ("ac_type", "word", "ac_type", r"نوع التكييف"),
    ("furnishing_level", "word", "furnishing_level", r"مستوي التاثيث"),
]
AF_FIELDS = tuple(n for n, _, _, _ in FIELDS if n not in NORMAL_FIELDS)

NEG = r"(?:بدون|لا يوجد|لايوجد|بلا|غير)\s*"
# «حي» as its OWN word (or glued to «ب», «بحي حطين»), never the tail of «الحي»: mustqr's app-shell meta
# «تصفح حسب الحي والسعر» and aqalemhajer's «الضاحية الحي الاول» read as the page naming a district, so 4/4
# mustqr ads scored district MISMATCH on 2026-10-12 although nothing on the page names one (backlog #61).
DISTRICT_ON_PAGE = re.compile(r"(?<![^\s|،,(:\-–ب])حي\s+\S+")
# A line carrying a phone, a commercial registration or the word «هاتف» is the OFFICE's contact block,
# never the ad: aqalemhajer prints «الأحساء, الهفوف, حي الملك فهد, هاتف:…» under every ad (2026-10-12).
CONTACT_LINE = re.compile(r"هاتف|جوال|واتس|س\.ت|السجل التجاري|tel:|<num>|\d{9,}", re.I)
DEAL_KW = {"بيع": r"للبيع|شراء", "ايجار": r"للايجار|ايجار"}
# The site's own category menu is not the ad: ashab 21084822 (2026-10-27, re-read run 40470543056), a land
# plot for sale whose page states no deal word, carries the footer links «بيع / إيجار / استثمار» on three
# consecutive lines, and the bare «إيجار» scored a rent claim. Only that exact consecutive run is dropped.
SITE_DEAL_MENU = re.compile(r"(?m)^بيع\nايجار\nاستثمار$")


def _num_pattern(v) -> re.Pattern:
    """1250000 matches «1250000», «1,250,000», «1.250.000», «1 250 000»; 4.5 matches 4.5 / 4,5."""
    f = float(v)
    if f == int(f):
        d = str(int(f))
        parts = []
        while len(d) > 3:
            parts.insert(0, d[-3:])
            d = d[:-3]
        parts.insert(0, d)
        body = r"[,.٬\s]?".join(parts)
    else:
        body = str(v).replace(".", "[.,]")
    return re.compile(r"(?<![\d.,])" + body + r"(?![\d])")


def compare_listing(stored: dict, page: dict, *, skip_price: bool = False,
                    prose_only_district: bool = False) -> dict[str, str]:
    """Every field we serve vs what the page itself says. Pure; no client, no network."""
    # Line-scoped checks (a small number near its keyword, negation) need real page lines.
    # text_head is page lines joined with " | " (source_reread), so splitting recovers them;
    # JSON-LD only ever joins the whole-page word search, never a "line".
    lines = [norm(x) for x in ([page.get("title") or ""] + list((page.get("meta") or {}).values())
                               + (page.get("evidence_lines") or [])
                               + (page.get("text_head") or "").split(" | "))]
    lines = [x for x in lines if x]
    jsonld = norm(json.dumps(page.get("jsonld") or [], ensure_ascii=False))
    whole = "\n".join(lines + ([jsonld] if page.get("jsonld") else []))
    whole_loc = "\n".join([x for x in lines if not CONTACT_LINE.search(x)]
                          + ([jsonld] if page.get("jsonld") else []))
    out: dict[str, str] = {}
    for name, kind, col, kw in FIELDS:
        if name == "price":
            if skip_price:
                continue
            # PRICE = SOURCE: the source table's own price_annual and period when score_site read them. Since
            # the owner's yearly-pool rule (2026-10-25/26) the index serves a per-month rent under «سنوي», and a
            # cheap «yearly» figure ×12 (rent_price_annual_ar), so the index alone no longer says how the
            # site quoted it: ashab 20927683 (10-27) page «9,000» monthly, index سنوي 108,000 → scored wrong.
            annual = stored.get("source_price_annual") or stored.get("price_annual")
            stored_v = stored.get("price_total") or annual or stored.get("price_per_meter")
            # The fleet stores a MONTHLY rent ×12 in price_annual (normalize.rent_period_from_ad) and the
            # card shows it ÷12; the page prints the monthly figure. Compare what the page prints
            # (superoffice 15485140, 2026-10-05: page «6288.40 ريال / شهر», stored 75456 = 6288×12).
            if (not stored.get("price_total") and annual
                    and (stored.get("rent_period_ar") == "شهري" or stored.get("source_rent_period") == "monthly")):
                stored_v = float(annual) / 12
                if stored_v == int(stored_v):
                    stored_v = int(stored_v)
            out[name] = _cmp_number(stored_v, lines, whole, kw)
            # Rule 5: a per-m² rate × size is the total the card SHOWS. A page that prints only that total
            # states our price, not another one. muktamel 17584328 (2026-10-14, re-read run 38530789154):
            # land rate 420 (the API's offer.price) × 690 m² = «289,800», the only figure on the page.
            ppm, area = stored.get("price_per_meter"), stored.get("area_m2")
            if (out[name] != MATCH and not stored.get("price_total") and not stored.get("price_annual")
                    and ppm and area):
                total = float(ppm) * float(area)
                if total == int(total) and _cmp_number(int(total), lines, whole, kw) == MATCH:
                    out[name] = MATCH
            # A price written in words of thousands is the same figure: akariyoun 18605450 (2026-10-19, re-read
            # run 39215534393) prints «السعر : 150 الف ريال» and we store 150000; the score read «150» as a
            # different price. Thousands («الف/ألف») and millions («مليون») only, the figure exact.
            if out[name] != MATCH and stored_v:
                v = float(stored_v)
                # tuba 21078156 (2026-10-27, re-read run 40470538881) prints «SAR 990k» for our 990,000: a Latin
                # «k» right after the figure is thousands too (never «km», never a letter that starts a word).
                for unit, words in ((1_000_000, r"مليون"), (1_000, r"الف|ألف|آلاف|الاف|[kK](?![A-Za-z])")):
                    k = v / unit
                    if v >= unit and k == int(k) and re.search(
                            r"(?<![\d.,])" + str(int(k)) + r"\s*(?:" + words + r")(?!\S*\s*مليون)", whole):
                        out[name] = MATCH
                        break
        elif kind == "number":
            out[name] = _cmp_number(stored.get(col), lines, whole, kw)
        elif kind == "bool":
            out[name] = _cmp_bool(stored.get(col), lines, kw)
        elif kind == "district":
            out[name] = PAGE_SILENT if prose_only_district else _cmp_district(stored.get(col), whole_loc)
        elif kind == "deal":
            out[name] = _cmp_valued(stored.get(col), SITE_DEAL_MENU.sub("", whole), DEAL_KW)
        else:
            out[name] = _cmp_word(stored.get(col), whole, kw)
    return out


_UNIT_TAIL = r"\s*(?:م2|م²|متر|m²|m2|ريال|ر\.س)?\s*"


# A control prompt («اختر عدد الغرف», rakez's room picker) names a field without stating it; the unit
# prices listed under it are not a room count (rakez 15742193 / 15741402, 2026-10-06: 5/5 «mismatch»).
CONTROL_PROMPT = re.compile(r"^\s*اختر\s")


# An area figure is never another field's value: tuba prints an EMPTY «عمر العقار :» label with the
# next line «214.66 م²», which read as a stated age (af_score 2026-10-07: tuba property_age 10/10
# «mismatch», source-reread 37600467768). Only the area field may take a neighbour carrying m².
AREA_UNIT = re.compile(r"م²|م2|متر مربع|m²")


ONE_WORD = re.compile(r"(?<!\S)(?:واحد|واحده)(?!\S)")
# Arabic states TWO with the dual, not the digit: bossbih 17388816 prints «غرفتين» for its 2 bedrooms
# (2026-10-12: stored 2, scored MISMATCH). A dual on the keyword's own line states the figure 2.
DUAL_WORD = re.compile(r"(?<![\u0621-\u064A])(?:غرفتين|غرفتان|حمامين|حمامان|دورتين|دورتان|صالتين|صالتان|مجلسين|مجلسان)(?![\u0621-\u064A])")


# Three to ten are written as words too, on a source's own structured cell: aljassim's room cell reads «أربع غرف»
# (17947950, 2026-10-16: stored 4 from that cell, scored MISMATCH against the description's «غرفتين نوم»). A
# number word ON THE KEYWORD'S LINE states that figure, exactly like a digit there (norm() folds أ→ا, ة→ه).
WORD_NUMBERS = {"ثلاث": 3, "ثلاثه": 3, "اربع": 4, "اربعه": 4, "خمس": 5, "خمسه": 5, "ست": 6, "سته": 6,
                "سبع": 7, "سبعه": 7, "ثمان": 8, "ثماني": 8, "ثمانيه": 8, "تسع": 9, "تسعه": 9, "عشر": 10, "عشره": 10}
WORD_NUMBER = re.compile(r"(?<![\u0621-\u064A])(" + "|".join(sorted(WORD_NUMBERS, key=len, reverse=True))
                         + r")(?![\u0621-\u064A])")


def _cmp_number(stored, lines: list[str], whole: str, kw: str) -> str:
    kw_hits = [i for i, x in enumerate(lines) if re.search(kw, x) and not CONTROL_PROMPT.match(x)]
    if not AREA_UNIT.search(kw):
        lines = [x if i in kw_hits or not AREA_UNIT.search(x) else "" for i, x in enumerate(lines)]
    page_states = any(re.search(r"\d", lines[i]) for i in kw_hits)
    if stored is None:
        return WE_MISS if page_states else PAGE_SILENT
    pat = _num_pattern(stored)
    if float(stored) >= 1000:
        if pat.search(whole):
            return MATCH
    else:
        # A small figure counts only next to its keyword: on the keyword's own line, or on a
        # neighbouring line that is NOTHING BUT the value («غرف النوم» / «4», «م²» / «240»).
        bare = re.compile(r"^" + _UNIT_TAIL + pat.pattern + _UNIT_TAIL + r"$")
        for i in kw_hits:
            if pat.search(lines[i]):
                return MATCH
            if any(0 <= j < len(lines) and bare.match(lines[j]) for j in (i - 1, i + 1)):
                return MATCH
        # area_m2 is an integer column (backlog #123), so a page «232.8 م²» is stored as its nearest whole
        # number, 233. tuba 18258569 (2026-10-17): «المساحة:» / «232.8 م²» read as a contradiction of any
        # whole number. Half rounds up; a truncated 232 still scores wrong.
        if "مساحه" in kw and float(stored) == int(float(stored)):
            near = " | ".join(lines[j] for i in kw_hits for j in (i - 1, i, i + 1) if 0 <= j < len(lines))
            if any(int(float(m.group(1).replace(",", ".")) + 0.5) == int(float(stored))
                   for m in re.finditer(r"(?<![\d.,])(\d+[.,]\d+)(?![\d])", near)):
                return MATCH
        # «عمر العقار جديد» is how aqar (and others) publish a new building; we store it as 0. Read as
        # the figure 0 both ways: stored 0 + «جديد» is a MATCH, stored 5 + «جديد» stays a MISMATCH
        # (aqar 15415047, 2026-10-05: spec block «عمر العقار جديد», stored 0, was scored wrong).
        # The live page renders the spec as label/value LINES («عمر العقار» / «جديد»), so the word can sit
        # on the line after the label (aqar 15703930 / 15703349, 2026-10-06: stored 0, scored wrong
        # because the previous row's bare «220 م²» read as a stated age).
        # «دورة مياه واحدة» is gathern's way of printing ONE bathroom: the word, not the digit (af_score
        # 2026-10-07: gathern 12857258 / 13191014 / 13971729 stored 1, scored «mismatch» 3/3).
        # Every worded figure on a keyword line counts, like a digit there does: bossbih 18945171 / 18945121
        # (2026-10-20, re-read run 39384692527) print the ad's own «غرفتين نوم» AND, in the related-ads table under
        # it, another unit's «المساحة194مأربع غرف»; reading the number word first scored our 2 bedrooms a MISMATCH.
        worded = {WORD_NUMBERS[m.group(1)] for i in kw_hits for m in WORD_NUMBER.finditer(lines[i])}
        if any(ONE_WORD.search(lines[i]) for i in kw_hits):
            worded.add(1)
        if any(DUAL_WORD.search(lines[i]) for i in kw_hits):
            worded.add(2)
        if worded:
            return MATCH if float(stored) in worded else MISMATCH
        if kw == AGE_KW and (NEW_BUILDING.search(" | ".join(lines[i] for i in kw_hits)) or any(
                i + 1 < len(lines) and re.match(r"^\s*جديد\s*$", lines[i + 1]) for i in kw_hits)):
            return MATCH if float(stored) == 0 else MISMATCH
        page_states = page_states or any(
            0 <= j < len(lines) and re.match(r"^\s*[\d,.٬]+" + _UNIT_TAIL + r"$", lines[j])
            for i in kw_hits for j in (i - 1, i + 1))
    if page_states and _inside_a_printed_range(stored, [lines[i] for i in kw_hits] if float(stored) < 1000 else lines):
        return PAGE_SILENT
    return MISMATCH if page_states else PAGE_SILENT


# A project page prints its units as a SPAN («101 - 259 م²»): a unit inside the span is not a statement about that
# unit, so it is silence, never a mismatch; outside every span it still contradicts the page. wahadat 17399567
# (2026-10-12): stored unit 9 (163 m², 690,000) — exactly unit 9 of the page's own payload — scored MISMATCH
# against «101 - 259 م²» / «131 - 168 م²».
RANGE = re.compile(r"([\d٠-٩][\d٠-٩,.٬]*)\s*[-–—]\s*([\d٠-٩][\d٠-٩,.٬]*)")


def _num(x: str) -> float | None:
    try:
        return float(x.translate(_DIGITS).replace(",", "").replace("٬", ""))
    except ValueError:
        return None


def _inside_a_printed_range(stored, lines: list[str]) -> bool:
    v = float(stored)
    for x in lines:
        for m in RANGE.finditer(x):
            lo, hi = _num(m.group(1)), _num(m.group(2))
            if lo is not None and hi is not None and lo < hi and lo <= v <= hi:
                return True
    return False


# «تأسيس مصعد» is a lift SHAFT, prepared for a lift that is not there: it states nothing about having one
# (sakan 12612200, 2026-10-07: scored a «we miss» on a correctly-NULL elevator).
PREPARED = r"تاسيس\s*"


def unprepared(x: str, kw: str) -> str:
    return re.sub(PREPARED + "(?:" + kw + ")", " ", x)


def _cmp_bool(stored, lines: list[str], kw: str) -> str:
    hit = [x for x in (unprepared(y, kw) for y in lines) if re.search(kw, x)]
    if not hit:
        return PAGE_SILENT
    page_yes = not all(re.search(NEG + "(?:" + kw + ")", x) for x in hit)
    if stored is None:
        return WE_MISS
    return MATCH if bool(stored) == page_yes else MISMATCH


# Hofuf's ضاحية هجر sub-districts are written three ways for ONE place: the catalog's «الضاحية الرابع», and
# the sites' «حي الرابع بضاحية هجر» / «ضاحية هجر(الحي الرابع)» (backlog #153; the owner's naming decision
# #319). arkaan 17543658 / 17543664 / 17543667 / 17544564 (2026-10-13 re-score) were served «الضاحية الرابع
# / الخامس / الحادي عشر» for exactly those pages and scored 4 district mismatches. Only the SAME ordinal is
# the same place: «الرابع بضاحية هجر» never matches «الضاحية الخامس».
_HAJER_ORDINAL = r"(الاول|الثاني عشر|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|الحادي عشر)"
# bossbih / aqalemhajer write it a fourth way, «الضاحية الحي الخامس» (bossbih 18985501, 2026-10-20 re-read run
# 39384692527: page «الضاحية الحي الخامس (640/4)», served «ضاحية هجر(الحي الخامس)», scored MISMATCH). The stored
# value is aliased too, so either side may carry any of the four forms.
_HAJER_FORMS = (re.compile(r"(?:الحي\s+)?" + _HAJER_ORDINAL + r"\s+بضاحيه\s+هجر"),
                re.compile(r"ضاحيه\s+هجر\s*\(?\s*الحي\s+" + _HAJER_ORDINAL),
                re.compile(r"الضاحيه\s+الحي\s+" + _HAJER_ORDINAL))


def _hajer_aliases(whole: str) -> str:
    return " ".join("الضاحيه " + m.group(1) for rx in _HAJER_FORMS for m in rx.finditer(whole))


def _cmp_district(stored, whole: str) -> str:
    page_names_one = bool(DISTRICT_ON_PAGE.search(whole))
    if not stored:
        return WE_MISS if page_names_one else PAGE_SILENT
    d = norm_district(stored)
    if d and d in whole:            # covers «حي X», bare «X», and a glued «X <city>» suffix
        return MATCH
    if d and re.search(r"(?<!\S)" + re.escape(d) + r"(?!\S)", _hajer_aliases(whole)):
        return MATCH
    page_hajer = _hajer_aliases(whole) + " " + whole
    for m in re.finditer(r"الضاحيه " + _HAJER_ORDINAL, _hajer_aliases(d or "")):
        if re.search(r"(?<!\S)" + re.escape(m.group(0)) + r"(?!\S)", page_hajer):
            return MATCH
    # The article is not the name: the catalogue's «حي السدرة» is the page's «روشن سدرة» / «حي سدرة»
    # (eilmalriyada 18624025, 2026-10-19 re-read run 39215210951: its own district field says «حي سدرة»).
    # Whole words only, so «السدره» never matches inside another name.
    core = d[2:] if d.startswith("ال") else ""
    if len(core) >= 3 and re.search(r"(?<!\S)(?:حي\s+)?" + re.escape(core) + r"(?!\S)", whole):
        return MATCH
    return MISMATCH if page_names_one else PAGE_SILENT


# Websites whose listing URL serves a SHELL: the HTML carries no ad, the ad is drawn by JS from an API.
# ebriza (scrapers/ebriza/run.py, «THE HTML PAGE IS NOT THE ORACLE — the API is»): /for_sell/<id>/… renders
# the same 200 shell for any id; 17513425 (2026-10-13, re-read run 38360961845) showed the site title, the
# login banner and a featured ad «جدة - حي الزهراء» / «الغرف 1», and scored our الخرج / العيون villa (6 rooms)
# as 3 mismatches. Such a page has said nothing about the ad: unreadable, never wrong.
SHELL_PAGE_PLATFORMS = frozenset({"ebriza"})


# A closed ad's page is not the ad: aqarmonthly 18842133 (2026-10-20, re-read run 39384695539, verdict=dead) now
# serves «فيلا مفروشة للحجز في حي العارض» with the default villa image, and its leftovers scored our flat's 300 m²
# a MISMATCH that capped the night. The platform's own dead marker (scrapers/common/cleanup.PLATFORMS, the one
# liveness uses) decides; a closed ad is ♻️'s finding, and for the score the page has said nothing: unreadable.
def closed_ad_page(platform: str, status, body: str) -> bool:
    from scrapers.common.cleanup import PLATFORMS
    from scrapers.common.liveness_contract import DEAD, classify_response
    marker = PLATFORMS.get(platform, {}).get("dead_marker")
    return marker is not None and classify_response(status, body or "", dead_marker=marker) == DEAD


# A share link that names its ad by CODE in the query («/latest-offers?ads-N5470=1», nufouth) opens the ad in a JS
# modal: if the served HTML never contains that code, the page is the table of OTHER units and has said nothing
# about this ad. nufouth 17667724 (2026-10-14, re-read run 38527525460): «5470» appears nowhere in the body, one
# of the table's units is also in حي العارض (so is_other_ads_page saw «ours» and stood down), and «6 غرف» /
# «3 غرف» / «4 غرف» from other units scored our 2 bedrooms a MISMATCH.
_AD_CODE_IN_URL = re.compile(r"[?&]ads-([A-Za-z]*\d+)=")


def page_lacks_its_ad(url: str | None, body: str) -> bool:
    m = _AD_CODE_IN_URL.search(url or "")
    if not m:
        return False
    code = m.group(1)
    digits = re.sub(r"\D", "", code)
    return code not in (body or "") and not re.search(r"(?<!\d)" + digits + r"(?!\d)", body or "")


# The same table page DOES carry the ad when its code is on it, but as one card among the others: nufouth
# 18610653 (2026-10-19, re-read run 39215530774) — the card «الدمام · حي الخالدية الجنوبية - N4175» sits
# beside units in المحمدية / الياسمين / التعاون, and the whole page scored our 236 m² against their numbers.
# Read only the card that carries the code; a page without card markers is left as it is.
_CARD_START = re.compile(r'<div[^>]*class="[^"]*\bcard-item\b')


def scope_to_its_ad(url: str | None, body: str) -> str:
    m = _AD_CODE_IN_URL.search(url or "")
    if not m or not body:
        return body
    at = body.find("'" + m.group(1) + "'")
    if at < 0:
        at = body.find(m.group(1))
    starts = [s.start() for s in _CARD_START.finditer(body)]
    before = [s for s in starts if s <= at]
    if at < 0 or not before:
        return body
    after = [s for s in starts if s > at]
    return body[before[-1]:after[0] if after else len(body)]


def is_other_ads_page(stored: dict, page: dict) -> bool:
    """The page lists OTHER ads, not this one: three or more different districts on its lines, none of
    them ours, and a title naming none. nufouth's share link (/latest-offers?ads-N945=1) opens the ad in
    a JS modal; the static HTML is the «جدول الشواغر» table of other units (حي المحمدية · حي البحيرة ·
    حي الياسمين, «6 غرف», «4 غرف»), so 5/5 sampled ads scored district + rooms MISMATCH on 2026-10-12
    against ads that were never theirs. Such a page has said nothing about the ad: unreadable."""
    lines = [norm(x) for x in (page.get("evidence_lines") or []) + (page.get("text_head") or "").split(" | ")]
    named = {norm_district(m.group(0)) for x in lines if not CONTACT_LINE.search(x)
             for m in DISTRICT_ON_PAGE.finditer(x)}
    named.discard("")
    if len(named) < 3:
        return False
    ours = norm_district(stored.get("district_ar") or "")
    if ours and any(ours in n or n in ours for n in named):
        return False
    title = norm(page.get("title") or "")
    return not any(n in title for n in named)


def _cmp_valued(stored, whole: str, value_kw: dict[str, str]) -> str:
    any_stated = any(re.search(p, whole) for p in value_kw.values())
    if not stored:
        return WE_MISS if any_stated else PAGE_SILENT
    mine = value_kw.get(norm(str(stored)))
    if mine and re.search(mine, whole):
        return MATCH
    return MISMATCH if any_stated else PAGE_SILENT


def _cmp_word(stored, whole: str, kw: str) -> str:
    kw_present = bool(kw) and bool(re.search(kw, whole))
    if stored in (None, ""):
        return WE_MISS if kw_present else PAGE_SILENT
    if norm(str(stored)) in whole:
        return MATCH
    return MISMATCH if kw_present else PAGE_SILENT


# ── Aggregation and the rating ──────────────────────────────────────────────────────────────────

def empty_row(night: str, platform: str, **kw) -> dict:
    row = {"night": night, "platform": platform, "sampled": 0, "fields": {}, "normal_match": 0,
           "normal_mismatch": 0, "af_claimed": 0, "af_agree": 0, "af_page_states": 0, "af_captured": 0,
           "decided_ads": 0, "unreadable_pages": 0, "mismatch_ids": [], "note": None}
    row.update(kw)
    return row


def fold(row: dict, listing_key: str, results: dict[str, str], stored: dict) -> None:
    """One compared listing into its website's row."""
    row["sampled"] += 1
    decided = False
    wrong = False
    for name, verdict in results.items():
        f = row["fields"].setdefault(name, {MATCH: 0, MISMATCH: 0, WE_MISS: 0, PAGE_SILENT: 0, UNREADABLE: 0})
        f[verdict] += 1
        if verdict in (MATCH, MISMATCH):
            decided = True
            wrong = wrong or verdict == MISMATCH
        if name in NORMAL_FIELDS:
            if verdict == MATCH:
                row["normal_match"] += 1
            elif verdict == MISMATCH:
                row["normal_mismatch"] += 1
        else:
            col = next(c for n, _, c, _ in FIELDS if n == name)
            claimed = stored.get(col) is not None or (name == "price")
            if verdict in (MATCH, MISMATCH):          # the page stated it AND we claimed a value
                row["af_claimed"] += 1
                row["af_agree"] += 1 if verdict == MATCH else 0
            if verdict in (MATCH, MISMATCH, WE_MISS):  # the page stated it
                row["af_page_states"] += 1
                row["af_captured"] += 1 if claimed and verdict != WE_MISS else 0
    if decided:
        row["decided_ads"] += 1
    if wrong:
        row["mismatch_ids"].append(listing_key)


def normal_accuracy(row: dict) -> float | None:
    decided = row["normal_match"] + row["normal_mismatch"]
    return row["normal_match"] / decided if decided else None


def af_precision(row: dict) -> float | None:
    return row["af_agree"] / row["af_claimed"] if row["af_claimed"] else None


def af_recall(row: dict) -> float | None:
    return row["af_captured"] / row["af_page_states"] if row["af_page_states"] else None


def _ratio(num: int, den: int) -> float | None:
    return num / den if den else None


def fleet(rows: list[dict]) -> dict:
    nm = sum(r["normal_match"] for r in rows)
    nmm = sum(r["normal_mismatch"] for r in rows)
    miss_by_field: dict[str, int] = defaultdict(int)
    for r in rows:
        for name, f in r["fields"].items():
            if f[WE_MISS]:
                miss_by_field[name] += f[WE_MISS]
    return {
        "sites": len(rows), "sampled": sum(r["sampled"] for r in rows),
        "normal_accuracy": _ratio(nm, nm + nmm),
        "af_precision": _ratio(sum(r["af_agree"] for r in rows), sum(r["af_claimed"] for r in rows)),
        "af_recall": _ratio(sum(r["af_captured"] for r in rows), sum(r["af_page_states"] for r in rows)),
        "we_miss_by_field": dict(sorted(miss_by_field.items(), key=lambda kv: -kv[1])),
        "mismatch_ids": [i for r in rows for i in r["mismatch_ids"]],
        "unmeasured": [r["platform"] for r in rows if r["decided_ads"] == 0],
    }


def rating(rows: list[dict], *, complete: bool = True) -> tuple[int, str]:
    """The most the 🆕 engineer may rate tonight, read from the rows (constants above)."""
    low = [r["platform"] for r in rows
           if normal_accuracy(r) is not None and normal_accuracy(r) < SITE_ACCURACY_FLOOR]
    if low:
        return FLOOR_CAP, (f"capped at {FLOOR_CAP}: normal accuracy under "
                           f"{SITE_ACCURACY_FLOOR:.0%} on " + ", ".join(sorted(low)))
    f = fleet(rows)
    eligible = [r for r in rows if r["decided_ads"] >= MIN_DECIDED_ADS]
    ef = fleet(eligible) if eligible else None
    if (complete and rows and not f["unmeasured"] and ef
            and (ef["normal_accuracy"] or 0) >= RATING_10_NORMAL_ACCURACY
            and (ef["af_precision"] if ef["af_precision"] is not None else 1.0) >= RATING_10_AF_PRECISION
            and (ef["af_recall"] if ef["af_recall"] is not None else 1.0) >= RATING_10_AF_RECALL):
        return 10, (f"normal {ef['normal_accuracy']:.1%}, AF precision "
                    f"{ef['af_precision']:.1%}" if ef["af_precision"] is not None else "no AF claims")
    why = []
    if f["unmeasured"]:
        why.append("not measured: " + ", ".join(f["unmeasured"]))
    if not complete or not rows:
        why.append("not every website was measured")
    for k, v, line in (("normal_accuracy", f["normal_accuracy"], RATING_10_NORMAL_ACCURACY),
                       ("af_precision", f["af_precision"], RATING_10_AF_PRECISION),
                       ("af_recall", f["af_recall"], RATING_10_AF_RECALL)):
        if v is not None and v < line:
            why.append(f"{k} {v:.1%} < {line:.0%}")
    if not eligible:
        why.append(f"no website reached {MIN_DECIDED_ADS} decided ads")
    return 9, "; ".join(why) or "thresholds met but the night is not complete"


# ── Reading the database and the pages ──────────────────────────────────────────────────────────

def _all(q) -> list[dict]:
    out: list[dict] = []
    lo = 0
    while True:
        rows = q.range(lo, lo + PAGE - 1).execute().data or []
        out += rows
        if len(rows) < PAGE:
            return out
        lo += PAGE


def new_listings(client, hours: int) -> dict[str, list[tuple[str, int]]]:
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    rows = _all(client.table("search_listings_ar").select("platform,source_table,listing_id")
                .eq("production_ready", True).gte("first_seen_at", since).order("listing_id"))
    out: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for r in rows:
        out[r["platform"]].append((r["source_table"], int(r["listing_id"])))
    return dict(out)


def explicit_picks(tokens: list[str]) -> list[tuple[str, int]]:
    """«table:id» tokens given through --sites: exactly those ads, whatever their age (backlog #583,
    2026-10-26 — a scorer fix could only be proven on ads that happened to arrive again that night)."""
    out: list[tuple[str, int]] = []
    for t in tokens:
        table, sep, rid = t.partition(":")
        if sep and table and rid.isdigit():
            out.append((table, int(rid)))
    return out


def picks_by_platform(client, picks: list[tuple[str, int]]) -> dict[str, list[tuple[str, int]]]:
    out: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for table, rid in picks:
        r = (client.table("search_listings_ar").select("platform").eq("source_table", table)
             .eq("listing_id", rid).limit(1).execute().data or [{}])[0]
        out[r.get("platform") or table.split("_")[0]].append((table, rid))
    return dict(out)


def sample_size(n_new: int, per_site: int | None) -> int:
    if per_site:
        return min(per_site, n_new)
    return N_BIG if n_new >= BIG_NEW else min(N_SMALL, n_new)


def no_district_backlog(client) -> dict:
    """production_ready rows with NULL district: the number the owner watches shrink nightly."""
    total = (client.table("search_listings_ar").select("listing_id", count="exact")
             .eq("production_ready", True).is_("district_ar", "null").limit(1).execute().count or 0)
    per_site: dict[str, int] = defaultdict(int)
    if 0 < total <= 50000:
        for r in _all(client.table("search_listings_ar").select("platform")
                      .eq("production_ready", True).is_("district_ar", "null").order("listing_id")):
            per_site[r["platform"]] += 1
    out = {"total": total, "per_site": dict(sorted(per_site.items(), key=lambda kv: -kv[1]))}
    if total == 0:
        # Measured 2026-10-03: the anon key reads 0 here while the owner tracks a five-figure
        # backlog — a key under RLS may simply not see those rows. 0 is a claim, not proof.
        out["note"] = "0 through this key; confirm with the service key before calling the backlog cleared"
    return out


def muktamel_room_lines(url: str, fetch=None) -> list[str]:
    """muktamel's own room counts, from the offer record its page renders (backlog #547, 2026-10-16).

    The page is client-rendered: its «غرف النوم» / «دورات المياه» exist only inside a minified Nuxt payload the
    reader cannot see (re-read run 38918001860), so the score compared our structured bedRoomsCount /
    bathroomsCount with the description's prose and called 17886543 / 17886575 wrong. These lines restate the
    offer's own fields; [] when the record cannot be read (unknown, never wrong)."""
    m = re.search(r"/real-estates/(\d+)", url or "")
    if not m:
        return []
    if fetch is None:
        from scrapers.muktamel.run import fetch_one as fetch
    try:
        got = fetch(int(m.group(1)))
    except Exception:  # noqa: BLE001
        return []
    offer = ((got[1] if got else None) or {}).get("offer") or {}
    out = []
    for label, key in (("عدد غرف النوم", "bedRoomsCount"), ("عدد دورات المياه", "bathroomsCount")):
        v = offer.get(key)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            out.append(f"{label} {int(v)}")
    return out


def dwelleo_room_lines(url: str, fetch=None) -> list[str]:
    """dwelleo's own bedroom count, from the API record its page is rendered from (backlog #838, 2026-10-25).

    We store the record's structured `bedrooms` for a dwelling (scrapers/dwelleo/run.py), and a structured field
    beats prose (ADVANCED_FILTER_SOURCE_TRUTH). The page the reader sees carries the title prose, so the 10-24 score
    called 20013764 wrong (record 5, title «فيلا 4 غرف») and missed 20019678's «غرفة نوم واحدة» = stored 1: dwelleo
    94.7%, a cap from two ads we store right (re-read 40078610599). A Building's count is its room stock and we
    store none, so no line is given for it. [] when the record cannot be read (unknown, never wrong)."""
    from urllib.parse import unquote, urlparse
    slug = unquote(urlparse(url or "").path.rstrip("/").rsplit("/", 1)[-1])
    if "dwelleo.sa" not in (url or "") or not slug:
        return []
    try:
        from scrapers.dwelleo import run as dwelleo
        from scrapers.common import normalize
        rec = fetch(slug) if fetch is not None else dwelleo.fetch_detail(dwelleo.session(), slug)
        if not isinstance(rec, dict):
            return []
        type_ar = ((rec.get("property_type") or {}).get("name") or "").strip()
        if normalize.map_type_exact(type_ar, overrides=dwelleo._TYPE_OVERRIDES) not in dwelleo._DWELLINGS:
            return []
    except Exception:  # noqa: BLE001
        return []
    # The record's other structured rooms are read the same way (backlog #890, 2026-10-26, dry re-score run
    # 40288432059): prose «ست غرف نوم وخمس حمامات» scored stored bathrooms 5 wrong (19471735), and «صالة مع
    # بلكونة … شارع 30» scored stored living_rooms 1 wrong (19471811); the record says bathrooms 5 and livings 1.
    # floor_number is NOT restated: the page never shows it, and its 0 is ambiguous (19534092: record 0, prose
    # «في الطابق ٣»), so the score keeps reading the page there.
    out = []
    for key, label in (("bedrooms", "عدد غرف النوم"), ("bathrooms", "عدد الحمامات"), ("livings", "عدد الصالات")):
        v = rec.get(key)
        if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0:
            out.append(f"{label} {int(v)}")
    return out


def nufouth_page(url: str, ad_number: str | None, fetch=None) -> dict | None:
    """A nufouth ad read from its own record (backlog #683, 2026-10-23). The share link
    («/latest-offers?ads-N4175=1») opens the ad in a JS modal filled from get_property_data; the static HTML is
    the vacancy table of OTHER units, so the score called every nufouth page unreadable: 0 decided ads on
    10-20, 10-21, 10-22 and 10-23. This restates the record's own fields for THIS ad and unit (ad_number
    NFZ<code>A<ad>U<unit name hash | P>), labelled the way the modal prints them. None = unreadable."""
    m = re.search(r"[?&]ads-([HNR]\d+)=", url or "")
    a = re.match(r"^NFZ([HNR]\d+)A(\d+)U(P|[0-9a-f]{8})$", ad_number or "")
    if not m or not a or a.group(1) != m.group(1):
        return None
    code, ad_num, unit_key = a.groups()
    try:
        if fetch is None:
            from scrapers.nufouth import run as nufouth
            msg = nufouth.fetch_property(nufouth.session(), code)
        else:
            msg = fetch(code)
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(msg, dict):
        return None
    import hashlib
    prop = msg.get("property") or {}
    for item in msg.get("ads") or []:
        ad = (item or {}).get("ad") or {}
        if (re.sub(r"\D", "", str(ad.get("name") or "")) or "0") != ad_num:
            continue
        units = item.get("units") or []
        if unit_key == "P":
            unit = None if not units else False
        else:
            unit = next((u for u in units if hashlib.sha1(str((u or {}).get("name") or "").encode("utf-8"))
                         .hexdigest()[:8] == unit_key), False)
        if unit is False:
            return None
        src = unit if unit is not None else ad
        ad_type = str(ad.get("ad_type") or "").strip()
        lines = []

        def put(label, v, tail=""):
            if isinstance(v, bool) or v in (None, "", 0, "0"):
                return
            lines.append(f"{label} {str(v).strip()}{tail}")
        put("المدينة", prop.get("city"))
        put("الحي", prop.get("district"))
        put("نوع الإعلان", {"ايجار": "للايجار", "بيع": "للبيع"}.get(ad_type))
        put("نوع الوحدة", (unit or {}).get("unit_type") if unit else prop.get("property_type"))
        put("المساحة", ((unit or {}).get("space") or (unit or {}).get("area")) if unit
            else (ad.get("total_area") or prop.get("property_area")), " م²")
        if unit:
            put("عدد الغرف", unit.get("no_of_rooms"))
            put("دورات المياه", unit.get("no_of_bathrooms"))
        put("الإيجار السنوي" if ad_type == "ايجار" else "السعر",
            src.get("annual_rent") if ad_type == "ايجار" else src.get("selling_price"), " ريال")
        put("عرض الشارع", prop.get("street_width"))
        put("عمر العقار", prop.get("age_property"))
        text = str((unit or {}).get("details") if unit else ad.get("custom_property_details") or "")
        lines += [y.strip() for y in text.splitlines() if y.strip()]
        title = str((unit or {}).get("name") if unit else prop.get("name") or "")
        return {"title": title, "meta": {}, "jsonld": [], "evidence_lines": lines[:200],
                "text_head": " | ".join(lines)[:1500]}
    return None


_DALLALI_RECORDS: "dict | None" = None


def dallali_page(url: str, fetch=None) -> dict | None:
    """A dallali ad read from the storefront's own JSON feed (2026-10-23). dallali.com/advertisements/property/<uuid>
    is a client-rendered shell («دلّالي | نظام إدارة العقارات والوساطة العقارية في السعودية», re-read run
    39944419156): no ad text at all, so a template «إيجار» scored 20007459 — «شقة للبيع», REGA advertisementType
    «بيع», listing_type sale — a deal MISMATCH and capped the 10-23 night at 5 on one ad. This restates the
    listing object's own fields, labelled; None when the feed cannot be read or lacks the id (unknown, never
    wrong). The feed is walked once per run."""
    global _DALLALI_RECORDS
    m = re.search(r"/advertisements/property/([0-9a-fA-F-]{8,})", url or "")
    if not m:
        return None
    try:
        if _DALLALI_RECORDS is None:
            if fetch is not None:
                items = fetch()
            else:
                from scrapers.dallali import run as dallali
                s, _ = dallali.retry_smarter_session(f"{dallali.API}?purpose=all&page=1", timeout=40)
                items = dallali.walk(s)[0]
            _DALLALI_RECORDS = {str(x.get("id")): x for x in items if isinstance(x, dict)}
        x = _DALLALI_RECORDS.get(m.group(1))
    except Exception:  # noqa: BLE001
        return None
    if not x:
        return None
    rega = x.get("rega_display_data") or {}
    loc = rega.get("location") or {}
    lines = []

    def put(label, v, tail=""):
        if isinstance(v, bool) or v in (None, "", 0):
            return
        lines.append(f"{label} {str(v).strip()}{tail}")
    put("نوع الإعلان", {"sale": "للبيع", "rent": "للايجار"}.get(x.get("listing_type") or ""))
    put("المنطقة", loc.get("region"))
    put("المدينة", loc.get("city") or (x.get("property") or {}).get("city"))
    put("الحي", loc.get("district") or (x.get("property") or {}).get("district"))
    put("نوع العقار", rega.get("propertyType"))
    put("المساحة", rega.get("propertyArea"), " م²")
    put("عدد الغرف", rega.get("numberOfRooms"))
    put("السعر", x.get("price"), " ريال")
    put("عرض الشارع", rega.get("streetWidth"))
    title = str(x.get("title") or "")
    lines += [y.strip() for y in f"{title}\n{x.get('description') or ''}".splitlines() if y.strip()]
    return {"title": title, "meta": {}, "jsonld": [], "evidence_lines": lines[:200],
            "text_head": " | ".join(lines)[:1500]}


_TUBA_RECORDS: "dict | None" = None


def tuba_rega_lines(url: str, fetch=None) -> list[str]:
    """tuba's own REGA licence values for the ad, from the catalogue feed its grid is served from (#621, 2026-10-18).

    The page shows no structured street width; its description prose says «شارع 20 متر» while the REGA licence
    the platform stores says streetWidth 25 — and we store the licence (scrapers/tuba/run.py), because a
    structured field beats prose (ADVANCED_FILTER_SOURCE_TRUTH). The score read only the prose and called
    18258569 wrong, capping the 10-17 night on one ad. These lines restate the licence's own field; [] when
    the record cannot be read (unknown, never wrong). The catalogue is walked once per run."""
    global _TUBA_RECORDS
    from urllib.parse import unquote
    m = re.search(r"/property/([^/?#]+)", url or "")
    if not m:
        return []
    slug = unquote(m.group(1))
    try:
        from scrapers.tuba import run as tuba
        if _TUBA_RECORDS is None:
            items = fetch() if fetch is not None else tuba.fetch_catalogue(tuba.session())[0]
            _TUBA_RECORDS = {unquote(str(r.get("slug") or "")): r for r in items if isinstance(r, dict)}
        rec = _TUBA_RECORDS.get(slug)
        ar = tuba.rega(rec) if rec else {}
    except Exception:  # noqa: BLE001
        return []
    v = ar.get("streetWidth")
    if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0:
        return [f"عرض الشارع {int(v) if float(v).is_integer() else v}"]
    if isinstance(v, str) and re.fullmatch(r"\d+(?:\.\d+)?", v.strip()):
        return [f"عرض الشارع {v.strip()}"]
    return []


def score_site(client, platform: str, picks: list[tuple[str, int]], *, night: str,
               pace: float = PACE_S, probe=None, wasalt=None, sanadak=None, muktamel=None, tuba=None,
               nufouth=None, dallali=None, dwelleo=None) -> dict:
    if probe is None:
        # Imported here, not at module level: af_score and its hermetic check load this module with
        # source_reread stubbed, and they always pass their own probe.
        from scrapers.common.source_reread import read_page as probe
    # wasalt and sanadak are read the way af_score reads them (backlog #540 / #546, 2026-10-16). The shared
    # probe answers a live wasalt page with an empty body (liveness needs only the status), so wasalt scored
    # 0 decided ads every night (10-15: 5/5, 10-16: 10/10 unreadable). sanadak's page appends OTHER listings
    # («شقة للإيجار في جدة النهضة 3 غرفة 183.56 متر 2»), so 17944083 (228 m²) and 17662112 scored area
    # mismatches the ad never made; its own listing object is the ad. Lazy import: af_score imports this module.
    if wasalt is None or sanadak is None:
        from scrapers.common import af_score
        wasalt = wasalt or af_score.wasalt_page
        sanadak = sanadak or af_score.sanadak_page
    row = empty_row(night, platform)
    last = 0.0
    for table, rid in picks:
        stored = (client.table("search_listings_ar").select(STORED).eq("source_table", table)
                  .eq("listing_id", rid).limit(1).execute().data or [{}])[0]
        try:
            raw = (client.table(table).select("listing_url,price_annual,rent_period").eq("id", rid).limit(1)
                   .execute().data or [{}])[0]
        except Exception:  # noqa: BLE001 — a table without those columns still gives its URL
            raw = (client.table(table).select("listing_url").eq("id", rid).limit(1).execute().data or [{}])[0]
        url = raw.get("listing_url")
        if raw.get("rent_period") is not None:
            stored = {**stored, "source_rent_period": raw["rent_period"], "source_price_annual": raw.get("price_annual")}
        key = f"{table}:{rid}"
        if not url:
            row["sampled"] += 1
            row["unreadable_pages"] += 1
            continue
        time.sleep(max(0.0, last + pace - time.monotonic()))
        last = time.monotonic()
        own = wasalt if ("wasalt.sa" in url or "wasalt.com" in url) else sanadak if "sanadak.sa" in url else None
        if "dallali.com/advertisements/" in url:
            own = dallali or dallali_page
        if "nufouth.com" in url:
            ad_number = (client.table(table).select("ad_number").eq("id", rid).limit(1).execute().data
                         or [{}])[0].get("ad_number")
            own = (lambda u, _n=ad_number: (nufouth or nufouth_page)(u, _n))
        if own is not None:
            page = own(url)                 # the ad's own record; None = unreadable, never wrong
            if page is None:
                row["sampled"] += 1
                row["unreadable_pages"] += 1
                continue
            fold(row, key, compare_listing(stored, page, skip_price=platform in SKIP_PRICE,
                                           prose_only_district=platform in PROSE_ONLY_DISTRICT), stored)
            continue
        try:
            status, body = probe(url)
        except Exception:  # noqa: BLE001 — a transport failure has said nothing about the ad
            status, body = None, ""
        if status != 200 or not body or closed_ad_page(platform, status, body):
            row["sampled"] += 1
            row["unreadable_pages"] += 1
            continue
        body = scope_to_its_ad(url, body)
        page = page_evidence(body)
        if (platform in SHELL_PAGE_PLATFORMS or is_other_ads_page(stored, page)
                or page_lacks_its_ad(url, body)):
            row["sampled"] += 1
            row["unreadable_pages"] += 1
            continue
        if "muktamel.com" in url:
            extra = (muktamel or muktamel_room_lines)(url)
            page = {**page, "evidence_lines": extra + list(page.get("evidence_lines") or [])}
        if "tuba.com.sa" in url:
            extra = (tuba or tuba_rega_lines)(url)
            page = {**page, "evidence_lines": extra + list(page.get("evidence_lines") or [])}
        if "dwelleo.sa" in url:
            extra = (dwelleo or dwelleo_room_lines)(url)
            page = {**page, "evidence_lines": extra + list(page.get("evidence_lines") or [])}
        results = compare_listing(stored, page, skip_price=platform in SKIP_PRICE,
                                  prose_only_district=platform in PROSE_ONLY_DISTRICT)
        # Which ad and which stored value: a site line says «furnished: mismatch=1» but not on which of the
        # sampled ads, so every AF cap had to be re-derived by hand (dwelleo #890, 2026-10-26).
        for name, verdict in results.items():
            if verdict == MISMATCH:
                col = next(c for n, _, c, _ in FIELDS if n == name)
                print(f"    mismatch {key} {name}: stored={stored.get(col)!r}", flush=True)
        fold(row, key, results, stored)
    if row["unreadable_pages"]:
        row["note"] = f"{row['unreadable_pages']} page(s) unreadable (never counted as wrong)"
    return row


# ── Output ──────────────────────────────────────────────────────────────────────────────────────

# The table's own columns (supabase/migrations: ops_new_listings_score). Anything else a row carries
# (decided_ads, unreadable_pages, new_24h) is for the log only: sending it makes PostgREST refuse the
# whole upsert with PGRST204 «Could not find the '<col>' column», and until 2026-10-05 that refusal
# matched a loose "not find" filter below and was printed as «does not exist yet» — 0 rows written on
# every night the job ran.
COLUMNS = ("night", "platform", "sampled", "fields", "normal_match", "normal_mismatch", "af_claimed",
           "af_agree", "af_page_states", "af_captured", "mismatch_ids", "note")


def write_rows(client, rows: list[dict]) -> str:
    """Only a MISSING TABLE (PGRST205 / 42P01) prints instead of writing; every other refusal raises."""
    payload = [{k: r.get(k) for k in COLUMNS} for r in rows]
    try:
        client.table(TABLE).upsert(payload, on_conflict="night,platform").execute()
    except Exception as e:  # noqa: BLE001
        text = str(e)
        if "PGRST205" in text or "42P01" in text:
            return f"{TABLE} does not exist yet: rows printed only"
        raise
    return f"wrote {len(rows)} rows to {TABLE}"


def _pct(v: float | None) -> str:
    return "n/a" if v is None else f"{100 * v:.1f}%"


def _line(r: dict) -> str:
    return (f"{r['platform']}: sampled={r['sampled']} decided_ads={r['decided_ads']} "
            f"normal={_pct(normal_accuracy(r))} af_precision={_pct(af_precision(r))} "
            f"af_recall={_pct(af_recall(r))} mismatches={len(r['mismatch_ids'])}"
            + (f" | {r['note']}" if r["note"] else "")
            # Which field and which ad: without these the log names a cap but not its cause, and every
            # mismatch had to be re-derived by hand (10-16: wasalt 92.9% with 6 mismatches, no ids printed).
            + "".join(f"\n    {name}: " + " ".join(f"{k}={v}" for k, v in c.items() if v and k != MATCH)
                      for name, c in sorted((r.get("fields") or {}).items())
                      if c.get(MISMATCH) or c.get(WE_MISS))
            + (f"\n    ids: {' '.join(r['mismatch_ids'])}" if r["mismatch_ids"] else ""))


def main() -> int:
    ap = argparse.ArgumentParser(description="New listings vs their original ads: the nightly measurement")
    ap.add_argument("--sites", nargs="*", help="only these websites (default: every one with new listings)")
    ap.add_argument("--per-site", type=int, default=None, help="pages opened per website (default: 10 big / 5 small)")
    ap.add_argument("--hours", type=int, default=24)
    ap.add_argument("--pace", type=float, default=PACE_S)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="print the rows, write nothing")
    a = ap.parse_args()

    client = sb()
    rng = random.Random(a.seed)
    night = datetime.now(timezone.utc).date().isoformat()
    explicit = explicit_picks(a.sites or [])
    if explicit:
        # Re-scoring named ads (a proof that a reader fix decides them right) is never the night's score.
        a.dry_run = True
        arrivals = picks_by_platform(client, explicit)
    else:
        arrivals = new_listings(client, a.hours)
    sites = sorted(arrivals) if explicit else (a.sites or sorted(arrivals))
    rows: list[dict] = []
    for p in sites:
        picks = arrivals.get(p) or []
        if not picks:
            rows.append(empty_row(night, p, note="no new production-ready listings in the window"))
            continue
        chosen = rng.sample(picks, sample_size(len(picks), a.per_site))
        try:
            row = score_site(client, p, chosen, night=night, pace=a.pace)
        except Exception as e:  # noqa: BLE001 — one website failing never stops the fleet
            row = empty_row(night, p, note=f"error: {type(e).__name__}: {e}"[:300])
        row["new_24h"] = len(picks)
        rows.append(row)
        print(_line(row), flush=True)

    out = {"night": night, "fleet": fleet(rows), "rating": rating(rows, complete=not a.sites),
           "no_district_backlog": no_district_backlog(client), "sites": rows}
    out["written"] = "dry run: nothing written" if a.dry_run else write_rows(client, rows)
    if a.json:
        print(json.dumps(out, ensure_ascii=False, indent=1, default=str))
    else:
        f, (cap, why) = out["fleet"], out["rating"]
        print(f"fleet: normal={_pct(f['normal_accuracy'])} af_precision={_pct(f['af_precision'])} "
              f"af_recall={_pct(f['af_recall'])} sampled={f['sampled']} on {f['sites']} website(s)")
        print(f"no-district backlog: {out['no_district_backlog']['total']}")
        print(f"rating cap: {cap}/10 — {why}")
        print(out["written"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
