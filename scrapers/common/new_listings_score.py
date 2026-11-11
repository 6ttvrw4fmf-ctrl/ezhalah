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
from scrapers.common.pii import redact_pii
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
# A new building is written «جديد», or in haraj's REGA block «New» / «اقل من سنة» (2026-11-03 score: haraj 23236720
# «عمر العقار: New», 23215277 «عمر العقار: اقل من سنة», both stored 0 by parse.py / normalize, scored MISMATCH).
NEW_WORDS = r"(?:جديد|new(?![a-z])|less than (?:a |one )?year|اقل من سنه)"
NEW_BUILDING = re.compile(AGE_KW + r"\s*[:：]?\s*" + NEW_WORDS, re.I)

FIELDS: list[tuple[str, str, str, str]] = [
    ("region", "word", "region_ar", ""),
    ("city", "word", "city_ar", ""),
    ("district", "district", "district_ar", ""),
    ("deal", "deal", "deal_ar", ""),
    ("type", "word", "type_ar", ""),
    ("rent_period", "word", "rent_period_ar", ""),
    ("price", "price", "", r"ريال|ر\.س|SAR"),
    ("area", "number", "area_m2", r"م²|م2|متر|مساحه|Property Area"),
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
    lines = [x for x in lines if x and not SITE_PROMO_LINE.search(_TASHKEEL.sub("", x))]
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
            # The card prints the monthly line as Math.round(annual / 12) (src/lib/listingDisplay.ts monthlyLineText),
            # so a ÷12 with a fraction is never what a customer reads. superoffice 25881144 (11-10 score, job
            # 129653650048): page «1225.12 ريال شهري» shown as «1,225», price_annual 14701 (bigint, law conflict #60),
            # served 1225.083 → scored MISMATCH on a card that reads «1,225». Compare the figure the card prints too;
            # a different figure still scores wrong.
            if out[name] != MATCH and isinstance(stored_v, float) and stored_v != int(stored_v):
                if _cmp_number(int(stored_v + 0.5), lines, whole, kw) == MATCH:
                    out[name] = MATCH
            # Rule 5: a per-m² rate × size is the total the card SHOWS. A page that prints only that total
            # states our price, not another one. muktamel 17584328 (2026-10-14, re-read run 38530789154):
            # land rate 420 (the API's offer.price) × 690 m² = «289,800», the only figure on the page.
            ppm, area = stored.get("price_per_meter"), stored.get("area_m2")
            if (out[name] != MATCH and not stored.get("price_total") and not stored.get("price_annual")
                    and ppm and area):
                total = float(ppm) * float(area)
                if total == int(total) and _cmp_number(int(total), lines, whole, kw) == MATCH:
                    out[name] = MATCH
            # The same identity when the total IS stored: the page prints the rate and the EXACT size, and our total is
            # their product to the riyal. fursaghyr 1199451 (card parity 2026-11-08): the page's price is «684 SAR»,
            # «سعر المتر للأرض: 684», «مساحة العقار: 2194.62»; the site's total is 684 × 2194.62 = 1,501,120 (stored
            # verbatim, area stored as the integer 2194) and the page never prints it. The rate must be on the page
            # as a price, the size must be the stored one with its decimals; any other total still scores wrong.
            pt = stored.get("price_total")
            if (out[name] != MATCH and pt and ppm and area and float(pt) != float(ppm)
                    and _cmp_number(ppm, lines, whole, kw) == MATCH
                    and any(int(float(area)) in (int(float(a)), int(float(a) + 0.5))
                            and abs(float(ppm) * float(a) - float(pt)) < 1
                            for a in re.findall(r"(?<![\d.,])(\d+\.\d+)(?![\d.,])", whole))):
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
            if name == "bedrooms" and stored.get("platform") in TOTAL_ROOMS_ONLY_PLATFORMS:
                out[name] = PAGE_SILENT if stored.get(col) is None else MISMATCH
                continue
            if name == "bedrooms" and stored.get("platform") in TOTAL_ROOMS_PLATFORMS:
                out[name] = _cmp_bedrooms_beside_total_rooms(stored.get(col), lines, whole, kw)
                continue
            out[name] = _cmp_number(stored.get(col), lines, whole, kw)
            if name == "property_age":
                built = _structured_age(stored.get(col), lines, jsonld if page.get("jsonld") else "")
                if built is not None:
                    out[name] = built
            # An OPEN bucket «+7 غرف نوم» / «7+ حمامات» is a floor, not a count: Property Finder 24671162 (score run
            # 42343488034, 2026-11-07) prints «+7» while its own payload's bedrooms_value is 20 (bathrooms 9), and the
            # score read our 20 as a MISMATCH. A stored count AT OR ABOVE the bucket's floor, on the keyword's own line.
            # The bucket must sit in the SAME clause as this field's keyword: «عدد غرف النوم: 4، الحمامات: 7+» gives the
            # bathrooms a «7+», never the bedrooms (CodeRabbit on #11031).
            if (name in ("bedrooms", "bathrooms") and out[name] == MISMATCH and stored.get(col) is not None
                    and any(bucket_floor_next_to(kw, c, float(stored.get(col)),
                                                 ROOM_KW["bathrooms" if name == "bedrooms" else "bedrooms"])
                            for x in lines for c in CLAUSE_SPLIT.split(x))):
                out[name] = MATCH
            # ONE hall is written as the bare noun: haraj 21839188 «غرفة وصالة», 21839193 «4 غرف وصالة كبيره» (score run
            # 41009231494, 2026-10-30, backlog 1090) store living_rooms 1; the room line's «4» read as the hall count.
            if (name == "living_rooms" and out[name] != MATCH and stored.get(col) is not None
                    and float(stored.get(col)) == 1 and any(SINGLE_HALL.search(x) for x in lines)):
                out[name] = MATCH
            if (name in SINGLE_ROOM and out[name] == MISMATCH and stored.get(col) is not None
                    and float(stored.get(col)) == 1 and any(SINGLE_ROOM[name].search(x) for x in lines)
                    and not room_figure_stated(name, lines)):
                out[name] = MATCH
            # A home described FLOOR BY FLOOR states no total (🆕 2026-11-05): Property Finder's CRM block «تفاصيل الدور
            # الأرضي عدد المجالس: 1 ، دورات المياه: 3 ، الصالات: 1 ، غرف النوم: 2» (23817495, whose API says 5 bedrooms)
            # and muhaysini's «الدور الارضي: مجلس ودورة مياه … الدور الاول : غرفتين … دورة مياه» (23814169) count ONE
            # floor. Summing floors is a calculation we never make, so a NULL room count there is not a miss: the
            # 05:35 score counted 6 such we_miss on propertyfinder alone. Only a NULL we hold, only these room counts.
            if (name in PER_FLOOR_COUNTS and out[name] == WE_MISS and stored.get(col) is None
                    and PER_FLOOR.search(whole)):
                out[name] = PAGE_SILENT
        elif kind == "bool":
            out[name] = _cmp_bool(stored.get(col), lines, kw)
        elif kind == "district":
            out[name] = PAGE_SILENT if prose_only_district else _cmp_district(stored.get(col), whole_loc)
        elif kind == "deal":
            out[name] = _cmp_valued(stored.get(col), SITE_DEAL_MENU.sub("", whole), DEAL_KW)
        else:
            out[name] = _cmp_word(stored.get(col), whole, kw)
            if name == "direction_ar":
                lines = label_value_lines(lines, kw)
            if name == "direction_ar" and out[name] == WE_MISS and not facade_stated(lines, kw):
                out[name] = PAGE_SILENT
            # haraj's REGA licence block prints the facade in English («واجهة العقار: Eastern», 21831096, backlog 1090).
            if name == "direction_ar" and out[name] == MISMATCH and stored.get(col):
                en = FACADE_EN.get(norm(str(stored.get(col))))
                if en and any(re.search(kw, x) and re.search(en, x, re.I) for x in lines):
                    out[name] = MATCH
                # The facade as Arabic adjectives is the same facade: raghdan 23296394 (re-score 41595594386,
                # 2026-11-03) prints «جنوبية - شرقية» and we store «جنوب شرقي».
                ar = facade_adjectives(stored.get(col))
                if out[name] == MISMATCH and ar and any(re.search(kw, x) and re.search(ar, norm(x)) for x in lines):
                    out[name] = MATCH
                # …and in JSON-LD, which never reaches `lines`: aqarcity 31207 (17802282, score 2026-11-06) publishes
                # {"name": "الواجهة", "value": "جنوبية شرقية"} and we store «جنوب شرق». The label and its OWN value only
                # (normalised: «"name": "الواجهه", "value": "جنوبيه شرقيه"») — never a bearing in another property's value.
                if out[name] == MISMATCH and ar and re.search(r"(?:" + kw + r")[\"' \t,:]*(?:value[\"' \t,:]*)?" + ar, norm(whole)):
                    out[name] = MATCH
            # A single bearing is not a diagonal: stored «شرق» sits inside vmksa's «واجهة العقار جنوبية شرقية», and
            # _cmp_word's substring test called it a MATCH (CodeRabbit on #11465). When every facade line that states a
            # bearing states a diagonal, a one-word facade disagrees with it.
            if name == "direction_ar" and out[name] == MATCH and stored.get(col) and len(norm(str(stored.get(col))).split()) == 1:
                stated = [norm(x) for x in lines if re.search(kw, norm(x)) and re.search(r"شمال|جنوب|شرق|غرب", norm(x))]
                if stated and all(_DIAGONAL.search(x) for x in stated):
                    out[name] = MISMATCH
    return out


_DIAGONAL = re.compile(r"(?:شمال|جنوب)\S*\s*[-–/]?\s*(?:ال)?(?:شرق|غرب)")


def bucket_floor_next_to(kw: str, clause: str, stored: float, other_kw: str = "") -> bool:
    """An open bucket TIGHTLY attached to this field's keyword (within 12 chars, no other figure between) whose floor
    the stored count meets. «عدد غرف النوم: 4 الحمامات: 7+» (no separator) gives the «7+» to the bathrooms only, and
    «الحمامات: 7+ غرف النوم: 4» too: a bucket nearer the OTHER room field's keyword is that field's (CodeRabbit on
    #11053). «+7 غرف نوم» (bucket first) still belongs to the bedrooms."""
    def dist(k, m):
        return m.start() - k.end() if m.start() >= k.end() else k.start() - m.end()

    def labels(k, m):          # «الحمامات: 7+», «غرف النوم 7+» — the room phrase labels the figure right after it
        span = clause[k.end():m.start()] if k.end() <= m.start() else ""
        if other_kw and re.search(other_kw, span):     # «غرف: الحمامات: 7+» — the nearer label owns it
            return False
        return k.end() <= m.start() and re.fullmatch(r"\S*(?:\s+[^\s\d:：]+)?\s*[:：]?\s*", clause[k.end():m.start()]) is not None
    own = list(re.finditer(kw, clause))
    others = list(re.finditer(other_kw, clause)) if other_kw else []
    for m in OPEN_BUCKET.finditer(clause):
        if stored < int(m.group(1) or m.group(2)):
            continue
        near = [k for k in own if dist(k, m) <= 12 and not re.search(
            r"\d", clause[k.end():m.start()] if m.start() >= k.end() else clause[m.end():k.start()])]
        if not near:
            continue
        if any(labels(k, m) for k in near):
            return True
        if any(labels(o, m) for o in others):
            continue
        if not any(dist(o, m) < min(dist(k, m) for k in near) for o in others):
            return True
    return False


# «عدد الغرف» on these sites is REGA's numberOfRooms: the TOTAL room count, never bedrooms (👑 owner 2026-11-08, backlog
# 1519/1520: «store and show it as TOTAL ROOMS … never as bedrooms»; aqarcity 2026-07-28, tuba trap 3, haraj parse.py). The
# bedrooms keyword «غرف» also hits that label, so the score read a total-rooms figure as a bedroom statement: a NULL
# bedrooms beside «عدد الغرف: 4» scored WE_MISS (pushing a parser to copy the total in), and a stored 4 copied from it
# scored MATCH (blind to exactly the bug the owner ruled out). Here the label and its value are not a bedroom statement:
# the ad's own «4 غرف وصالة» still is. A stored count that only the total-rooms figure supports is a MISMATCH.
TOTAL_ROOMS_PLATFORMS = frozenset({"tuba", "aqarcity", "haraj"})
# On these two EVERY room count the page prints is REGA's total: aqarcity's title «200 م²، 6 غرف» and its «الغرف» / «6»
# cell (re-read 42460062892, 25437035, 2026-11-08), tuba's numberOfRooms that its UI labels «غرف النوم» (scrapers/tuba/run.py
# trap 3). Neither scraper ever writes bedrooms, so the page never states one: NULL is silence, any stored count is wrong.
# The branch dry re-score of 11-08 (42459382375) still read aqarcity bedrooms as we_miss 8 of 10 from those lines.
TOTAL_ROOMS_ONLY_PLATFORMS = frozenset({"tuba", "aqarcity"})
TOTAL_ROOMS = re.compile(r"عدد\s*(?:ال)?غرف(?!\s*(?:ال)?نوم)\s*[:：]?\s*(\d{1,3})?")
_BARE_COUNT_LINE = re.compile(r"^\s*(\d{1,3})\s*(?:غرف|غرفه)?\s*$")


def _cmp_bedrooms_beside_total_rooms(stored, lines: list[str], whole: str, kw: str) -> str:
    """Bedrooms on a total-rooms site: blank «عدد الغرف» and its value (inline or the next line), compare what is left
    with the normal number rule, and score a stored count that only the total supports as a MISMATCH."""
    totals: set[float] = set()
    kept: list[str] = []
    skip_next = False
    for i, x in enumerate(lines):
        if skip_next:
            skip_next = False
            m = _BARE_COUNT_LINE.match(x)
            if m:
                totals.add(float(m.group(1)))
                kept.append("")
                continue
        for m in TOTAL_ROOMS.finditer(x):
            if m.group(1):
                totals.add(float(m.group(1)))
            elif not x[m.end():].strip():
                skip_next = True          # label/value lines: «عدد الغرف» / «4»
        kept.append(TOTAL_ROOMS.sub(" ", x))
    verdict = _cmp_number(stored, kept, "\n".join(kept), kw)
    if stored is not None and verdict != MATCH and float(stored) in totals:
        return MISMATCH                   # the total rooms stored as bedrooms
    return verdict


ROOM_KW = {"bedrooms": r"غرف|غرفه نوم", "bathrooms": r"حمام|دوره مياه|دورات مياه|دوره المياه|دورات المياه"}
# «+7» / «7+» (Western or Arabic-Indic digits): an open room bucket, «N or more».
CLAUSE_SPLIT = re.compile(r"[،,|•؛;]")
OPEN_BUCKET = re.compile(r"(?<![\d.])\+\s*(\d{1,2})(?![\d.])|(?<![\d.])(\d{1,2})\s*\+")

# A site's own promo banner is not the ad. haraj prints partner offers under every ad (score dry run 41790110618,
# 2026-11-04): «استأجر الآن وادفع لاحقًا مع إيجاري ، تقسيط شهري مريح…» (Ejari) on 23431125 / 23409947 and «وفّي وسيط
# وتقسيط: سهِّل مشترياتك…» (Wafi) on 23449574 — none of it is in the seller's text, and each read as «we miss» a
# rent-now-pay-later / installment the ad never offers. Matched on the exact banner wording only.
_TASHKEEL = re.compile(r"[\u064B-\u0652]")
# The banner family, any partner: re-score 41792074733 also showed «… وادفع لاحقًا مع رايز ، تقسيط شهري مريح لشقتك
# المفضّلة» (23397679) and «استخدم وفّي للتقسيط المريح وحماية مدفوعاتك.» (23548231), in neither seller's text.
SITE_PROMO_LINE = re.compile(r"استاجر الان وادفع لاحقا مع \S+ ، تقسيط شهري مريح|^وفي وسيط وتقسيط|^استخدم وفي للتقسيط")

# One of the eight compass facades, as a REGA facade cell or a page label states it.
_FACADE_WORD = re.compile(r"(?:ال)?(شمال|جنوب|شرق|غرب)|(north|south|east|west)", re.I)
_FACADE_WORD_EN = {"north": "شمال", "south": "جنوب", "east": "شرق", "west": "غرب"}
_OPPOSITE = ({"شرق", "غرب"}, {"شمال", "جنوب"})


def facade_stated(lines: list[str], kw: str) -> bool:
    """Does a facade line state ONE facade the Advanced Filter could hold? haraj's REGA block prints the label on every
    ad: «واجهة العقار: لا يوجد», «واجهة العقار: -» (no facade) and «واجهة العقار: غربية - شرقية» (two opposite streets,
    a through plot, never one bearing) — 4 of 5 haraj direction «we miss» on 2026-11-04 (dry run 41790110618,
    23449578 / 23431076 / 23431125 / 23449477 / 23397687). A label alone, «none», opposite or dashed bearings → not stated."""
    for x in lines:
        m = re.search(kw, x)
        if not m:
            continue
        # The cell's own value only: up to the next REGA label, and never past 30 characters of prose.
        value = re.split(r"[|]|عدد الغرف|رقم المخطط|عرض الشارع", x[m.end():].lstrip(" :：-–"))[0][:30]
        bearings = {b.group(1) or _FACADE_WORD_EN[b.group(2).lower()] for b in _FACADE_WORD.finditer(value)}
        # «غربية - شمالية»: two bearings joined by « - » name two streets (a corner), the rule scrapers/haraj/parse.py
        # facade_of() stores by (23409982, re-score 41792074733); a diagonal is written without the dash.
        corner = len(bearings) == 2 and re.search(r"\s[-–]\s", value)
        if not bearings or corner or any(pair <= bearings for pair in _OPPOSITE):
            continue
        return True
    return False

# «صالة» alone (with «و» / «ال» glued on) is one hall; never «صالات» / «صالتين», never a figure right before it.
PER_FLOOR = re.compile(r"(?:تفاصيل\s+)?الدور\s*:?\s*(?:الارضي|الاول|الثاني|الثالث|العلوي)")
PER_FLOOR_COUNTS = frozenset({"living_rooms", "majlis_rooms", "bathrooms"})
SINGLE_HALL = re.compile(r"(?<![\u0621-\u064A\d])(?<!\d )(?:و|ب)?(?:ال)?صاله(?![\u0621-\u064A])")
# ONE bedroom / bathroom is written as the bare noun in a components list: sadiqeltajer 25456611 (2026-11-08 score,
# backlog 1350) «المكونات : صاله . غرفه . دورة مياة», stored 1 / 1, scored MISMATCH because the same description's
# area «246» and street «15» were the only figures. A service room («غرفة خادمة», «حمام سباحة») is not one, and a
# room word with a figure beside it anywhere on the page («3 غرف», «غرف النوم: 2») leaves the count to that figure.
_NOT_A_BEDROOM = r"(?:لل|ال|ل)?(?:خادمه|خادمات|سائق|حارس|غسيل|كهرباء|تخزين|ملابس|طعام|جلوس|سينما|العاب|معيشه|الخادمه)"
SINGLE_ROOM = {
    "bedrooms": re.compile(r"(?<![\u0621-\u064A\d])(?<!\d )(?:و|ب)?(?:ال)?غرفه(?:\s+(?:ال)?نوم)?(?![\u0621-\u064A])"
                           r"(?!\s+" + _NOT_A_BEDROOM + r"(?![\u0621-\u064A]))"),
    "bathrooms": re.compile(r"(?<![\u0621-\u064A\d])(?<!\d )(?:و|ب)?(?:ال)?(?:دوره\s+(?:ال)?مياه|حمام)(?![\u0621-\u064A])"
                            r"(?!\s+(?:ال)?(?:سباحه|بخار)(?![\u0621-\u064A]))"),
}
ROOM_FIGURE = {
    "bedrooms": re.compile(r"\d\s*(?:ال)?غرف|غرف(?:ه)?(?:\s*(?:ال)?نوم)?\s*[:：]?\s*\d"),
    "bathrooms": re.compile(r"\d\s*(?:ال)?(?:حمام|دور(?:ه|ات)\s+(?:ال)?مياه)|(?:حمام(?:ات)?|دور(?:ه|ات)\s+(?:ال)?مياه)\s*[:：]?\s*\d"),
}
_ROOM_WORD = {"bedrooms": r"غرف", "bathrooms": r"حمام|دور(?:ه|ات)\s+(?:ال)?مياه"}
_MANY_ROOMS = {
    "bedrooms": re.compile(r"غرفت(?:ين|ان)|(?<![\u0621-\u064A])(?:ال)?غرف(?![\u0621-\u064A])"
                           r"|\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+bed", re.I),
    "bathrooms": re.compile(r"حمام(?:ين|ان|ات)|دورت(?:ين|ان)\s*(?:ال)?مياه|دورات\s+(?:ال)?مياه"
                            r"|\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+bath", re.I),
}


_TOKEN = re.compile(r"[\u0621-\u064A]+|[A-Za-z]+|\d+(?:[.,]\d+)?\+?")
_ROOM_WINDOW = 4
_ROOM_TOKEN = {
    "bedrooms": re.compile(r"(?:و|ب|لل|ال)*غرف(?:ه|ة|تين|تان)?|bedrooms?|rooms?", re.I),
    "bathrooms": re.compile(r"(?:و|ب|لل|ال)*(?:حمام(?:ات|ين|ان)?|دور(?:ه|ة|ات|تين|تان))|bathrooms?|baths?|wc", re.I),
}
_FIELD_STOP = re.compile(r"(?:و|ب|ال)*(?:شارع|عرض|مساحه|مساحة|عمر|سعر|طابق|دور|الدور|ادوار|واجهه|واجهة|"
                         r"street|width|area|age|price|floor)", re.I)
_UNIT_AFTER = re.compile(r"(?:م|متر|مترمربع|m|sqm|ريال|sar)$", re.I)


def _token_count(toks: list[str], k: int) -> int | None:
    """The room count token k states, or None: a 1-2 digit figure not followed by a unit, or a number word."""
    t = toks[k]
    nxt = toks[k + 1] if k + 1 < len(toks) else ""
    if re.fullmatch(r"\d{1,2}\+?", t):
        return None if _UNIT_AFTER.match(nxt) else int(t.rstrip("+"))
    if t in WORD_NUMBERS:
        return WORD_NUMBERS[t]
    return EN_NUMBERS.get(t.lower())


def room_figure_stated(name: str, lines: list[str]) -> bool:
    """Does the page give this room count as a figure anywhere — beside the word, as a number word, or as the
    bare value on the line next to it («غرف النوم» / «3»)? Then the bare singular noun never decides it."""
    word = _ROOM_WORD[name]
    # A dual («غرفتين», «حمامين», «دورتين مياه»), a bare plural («غرف», «حمامات», «دورات مياه») or an English count
    # («two bedrooms») is a count too: the bare singular never outvotes it (CodeRabbit on #11280).
    if any(_MANY_ROOMS[name].search(x) for x in lines):
        return True
    room_tok = _ROOM_TOKEN[name]
    for i, x in enumerate(lines):
        if ROOM_FIGURE[name].search(x):
            return True
        toks = _TOKEN.findall(x)
        hits = [k for k, t in enumerate(toks) if room_tok.fullmatch(t)]
        # Any count within _ROOM_WINDOW tokens of THIS room word — a digit, or a number word the comparator itself
        # reads (WORD_NUMBERS / EN_NUMBERS) — states the count, unless every such count is 1: «غرفه نوم ماستر عددها
        # ثلاث», «2 bedrooms», «حمام: two» (CodeRabbit on #11280). An area «بمساحه 246 م» four tokens away from the
        # word is outside the window only when it is farther; a figure followed by a unit is never a room count.
        other = _ROOM_TOKEN["bathrooms" if name == "bedrooms" else "bedrooms"]
        counts = []
        for h in hits:
            for step in (-1, 1):            # walk out from the word; another room type's word ends its reach
                for k in range(h + step, h + step * (_ROOM_WINDOW + 1), step):
                    if not 0 <= k < len(toks) or other.fullmatch(toks[k]) or _FIELD_STOP.fullmatch(toks[k]):
                        break               # «غرفه نوم، شارع 15»: the 15 is the street's (CodeRabbit on #11280)
                    if (c := _token_count(toks, k)) is not None:
                        counts.append(c)
        if counts and any(c != 1 for c in counts):
            return True
        if hits and any(0 <= j < len(lines) and _token_count([lines[j].strip()], 0) not in (None, 1)
                        for j in (i - 1, i + 1)):
            return True                     # the bare value on the next line («غرف النوم» / «3»)
    return False


# The facades in English, as a REGA licence block prints them. A compound one too: haraj 22820527 prints
# «واجهة العقار: South west» and we store «جنوب غرب» (re-score 41406084400, 2026-11-02, scored MISMATCH).
FACADE_EN = {"شرق": r"\beast(?:ern)?\b", "غرب": r"\bwest(?:ern)?\b",
             "شمال": r"\bnorth(?:ern)?\b", "جنوب": r"\bsouth(?:ern)?\b"}
for _ar, _en in (("شمال شرق", "north[\\s-]*east"), ("شمال غرب", "north[\\s-]*west"),
                 ("جنوب شرق", "south[\\s-]*east"), ("جنوب غرب", "south[\\s-]*west")):
    FACADE_EN[_ar] = FACADE_EN[_ar + "ي"] = r"\b" + _en + r"(?:ern)?\b"


_FACADE_BASES = ("شمال", "جنوب", "شرق", "غرب")


# The next line is joined only when it IS a facade value (a bearing first): «الحي الشرقي» (a district) or another
# source's text never becomes the label's value (CodeRabbit on #10939).
_FACADE_VALUE_START = re.compile(r"^\s*(?:ال)?(?:شمال|جنوب|شرق|غرب)|^\s*(?:north|south|east|west)", re.I)


def label_value_lines(lines: list[str], kw: str) -> list[str]:
    """A label printed as its own line joins the value line after it. vmksa's feature block «<h2>واجهة العقار</h2>
    <span>جنوبية شرقية</span>» reaches us as «واجهة العقار | جنوبية شرقية», two lines, so a facade that equals ours
    (14110686 stores «جنوب شرق») scored MISMATCH and a stated one read as «not stated» (🔬 2026-11-06, ops_af_score
    vmksa 3 direction mismatches). Only a BARE label (at most one short word left beside the keyword) is joined."""
    out = list(lines)
    for i, x in enumerate(lines[:-1]):
        m = re.search(kw, x)
        rest = re.sub(r"[:：\-–|]", " ", re.sub(kw, "", x)).split()      # «واجهة العقار :» — the colon is not a word
        if m and len(rest) <= 1 and len(x) <= 24 and not (rest and _FACADE_VALUE_START.match(rest[0])) \
                and _FACADE_VALUE_START.match(lines[i + 1]):           # «واجهة جنوبية» already holds its value
            out[i] = x + " : " + lines[i + 1]
    return out


def facade_adjectives(stored) -> Optional[str]:
    """«جنوب شرقي» → a pattern for «جنوبيه - شرقيه» / «جنوبي شرقي» / «جنوبيه شرقيه» (norm folds ة→ه).
    Only the four bases, in the stored order; anything else returns None."""
    words = norm(str(stored or "")).replace("-", " ").split()
    bases = [w[:-1] if w.endswith("ي") else w for w in words]
    if not bases or len(bases) > 2 or any(b not in _FACADE_BASES for b in bases):
        return None
    return (r"(?<![\u0621-\u064A])" + r"\s*[-–/،,]?\s*(?:و)?".join(r"(?:ال)?" + b + r"(?:يه|ي)?" for b in bases)
            + r"(?![\u0621-\u064A])")


# «م» alone is metres too (🔬 2026-11-07): justsa prints «<span>عرض الشارع</span> <strong>18 م</strong>» (just.sa/l/595,
# re-read net.http_get 11-07) and the value line «18 م» never matched, so 15 of 15 sampled justsa street widths scored
# MISMATCH on a stored 18 that the page states — the same «tool, not the data» backlog 297 named on 10-09.
# Only a SPACED «م» («18 م»): a glued «250م» keeps its old reading, which the alshawaf related-table guard relies on.
_UNIT_TAIL = r"\s*(?:م2|م²|متر|m²|m2|ريال|ر\.س|(?<=\s)م)?\s*"


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
# …also when a glued meta description runs it straight into the NEXT label: aqaralriyadh 13105499 (🔬 2026-11-07, dry run
# af-score 42360463480: living_rooms MISMATCH 4 of 14) prints «…عدد الغرف: 4 غرفالصالات: صالتاندورات المياه: 3».
_NEXT_LABEL = r"(?:دورات|دوره|عدد|المساحه|المساحة|السعر|الحي|المدينه|المدينة|الغرف|الصالات|المجالس|الحمامات|عمر|الدور|الواجهه|الواجهة)"
DUAL_WORD = re.compile(r"(?<![\u0621-\u064A])(?:غرفتين|غرفتان|حمامين|حمامان|دورتين|دورتان|صالتين|صالتان|مجلسين|مجلسان|سنتين|سنتان|عامين|عامان)"
                       r"(?:(?![\u0621-\u064A])|(?=" + _NEXT_LABEL + r"))")
# «سنتين» is a two-year-old building: haraj 23236759 «عمر العقار: سنتين», stored 2 (branch re-score 41596198038, 2026-11-03).


# Three to ten are written as words too, on a source's own structured cell: aljassim's room cell reads «أربع غرف»
# (17947950, 2026-10-16: stored 4 from that cell, scored MISMATCH against the description's «غرفتين نوم»). A
# number word ON THE KEYWORD'S LINE states that figure, exactly like a digit there (norm() folds أ→ا, ة→ه).
WORD_NUMBERS = {"ثلاث": 3, "ثلاثه": 3, "اربع": 4, "اربعه": 4, "خمس": 5, "خمسه": 5, "ست": 6, "سته": 6,
                "سبع": 7, "سبعه": 7, "ثمان": 8, "ثماني": 8, "ثمانيه": 8, "تسع": 9, "تسعه": 9, "عشر": 10, "عشره": 10}
WORD_NUMBER = re.compile(r"(?<![\u0621-\u064A])(" + "|".join(sorted(WORD_NUMBERS, key=len, reverse=True))
                         + r")(?![\u0621-\u064A])")

EN_NUMBERS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
              "ten": 10, "eleven": 11, "twelve": 12}
EN_NUMBER = re.compile(r"(?<![A-Za-z])(" + "|".join(EN_NUMBERS) + r")(?![A-Za-z])", re.I)

WORDED_VALUE_LINE = re.compile(r"^\s*(" + "|".join(sorted(WORD_NUMBERS, key=len, reverse=True))
                               + r")\s*(?:سنوات|سنين|سنه|غرف|غرفه|صالات|دورات مياه)?\s*$")


# «سنتين» / «سنتان» alone on a value line (the dual states TWO), with an optional unit word after it.
DUAL_VALUE_LINE = re.compile(r"^\s*(?:سنتين|سنتان|عامين|عامان|غرفتين|غرفتان|حمامين|حمامان|دورتين|دورتان|صالتين|صالتان)\s*$")
# «اكثر من عشر سنوات», «أكثر من 10 سنوات», «+10 سنوات»: an open bucket whose floor is the figure (norm folds أ→ا).
AGE_FLOOR = re.compile(r"(?:اكثر|أكثر|فوق|اعلى|أعلى)\s+من\s+([\d٠-٩]{1,3}|" + "|".join(sorted(WORD_NUMBERS, key=len, reverse=True))
                       + r")(?![\u0621-\u064A\d])\s*(?:سنوات|سنه|سنة|سنين|عام|اعوام|أعوام)(?![\u0621-\u064A])")
# a year word: «اكثر من 10 اشهر» (months) is never a year floor, and a value line before the label must name years
AGE_UNIT = re.compile(r"(?:سنوات|سنه|سنة|سنين|سنتين|سنتان|عام|اعوام|أعوام)(?![\u0621-\u064A])")


def _age_floor(line: str, own: bool) -> Optional[float]:
    """The floor of an open age bucket on this line. A neighbour line must be nothing but the bucket («اكثر من عشر
    سنوات»); the label's own line may carry it after the label («عمر العقار: اكثر من عشر سنوات»)."""
    m = AGE_FLOOR.search(line or "")
    if not m or (not own and (line[:m.start()].strip() or line[m.end():].strip())):
        return None
    v = m.group(1)
    return float(WORD_NUMBERS[v]) if v in WORD_NUMBERS else float(v.translate(_DIGITS))


# A per-metre PRICE line is not an area statement: alshawaf's own node table prints «سعر المتر» / «1,800» (and its index
# «المتر 1,800»), and the area keyword «متر» read it as a stated area, so our 587 (the node's «المساحة» / «587م») scored
# MISMATCH and capped the 2026-11-09 night at 85 % (re-read run 42578333590: 25868220 / 25868063 / 25868148). An area
# says «587 متر» — the figure BEFORE the word; «(سعر) المتر N» — the definite word before the figure — is a price.
PER_METRE_PRICE = re.compile(r"سعر\s+(?:ال)?متر|(?<![ء-ي])المتر\s*[:：]?\s*[\d٠-٩]")
# The bare area label of a th/td table («<th>المساحة</th><td>587م</td>» → lines «المساحه» / «587م»).
AREA_LABEL_LINE = re.compile(r"^\s*(?:ال)?مساحه(?:\s+(?:ال)?(?:ارض|الارض|العقار))?\s*[:：]?\s*$")


# A BUILD YEAR the page publishes as a structured field is the age's statement, and it wins over prose (law: prose is
# never consulted for a field the site publishes structurally). 🔬 2026-11-10, backlog 1615, pages re-read via
# net.http_get: squares 13602726 prints the spec row «سنة البناء» / «2022» (stored 4) while its 2024 prose still says
# «عمر العقار : سنتين»; erapulse 648075's JSON-LD says «"yearBuilt":1993» (stored 33) while the page's OTHER ad's
# prose «عمر العقار: 3 سنوات» read as its age. Both scored MISMATCH on correct values. One year either way is the
# same building (the age turns on the month we cannot see).
BUILD_YEAR_LABEL = re.compile(r"^\s*(?:سنه|عام)\s+(?:ال)?(?:بناء|انشاء|إنشاء)\s*[:：]?\s*((?:19|20)\d\d)?\s*$")
JSONLD_YEAR_BUILT = re.compile(r'"yearBuilt"\s*:\s*"?((?:19|20)\d\d)"?')


def _structured_age(stored, lines: list[str], jsonld: str, now_year: Optional[int] = None) -> Optional[str]:
    """MATCH / MISMATCH / WE_MISS from the page's own build year, or None when the page publishes none."""
    now_year = now_year or datetime.now(timezone.utc).year
    years: list[int] = [int(m.group(1)) for m in JSONLD_YEAR_BUILT.finditer(jsonld or "")]
    for i, x in enumerate(lines):
        m = BUILD_YEAR_LABEL.match(x or "")
        if not m:
            continue
        if m.group(1):
            years.append(int(m.group(1)))
        elif i + 1 < len(lines) and re.match(r"^\s*(?:19|20)\d\d\s*$", lines[i + 1] or ""):
            years.append(int(lines[i + 1].strip()))
    years = [y for y in years if 1900 <= y <= now_year]
    if not years:
        return None
    if stored is None:
        return WE_MISS
    return MATCH if any(abs(float(stored) - (now_year - y)) <= 1 for y in years) else MISMATCH


# A bare singular year states ONE year, on the label's own line («عمر العقار: سنة») or as the label's value line
# («عمر العقار» / «سنة») — CodeRabbit on #11465. A calendar year after it («عمر العقار: عام 2020») is a date, not age 1. «\uFF1A» is the full-width colon some pages print.
_ONE_YEAR_ON_LABEL = re.compile("عمر العقار\\s*[:\uFF1A]?\\s*(?:سنه|سنة|عام)(?![\u0621-\u064A])(?!\\s*[\\d\u0660-\u0669])")
_ONE_YEAR_LINE = re.compile(r"^\s*(?:سنه|سنة|عام)\s*[.،,]?\s*$")


def _states_one_year(lines: list[str], kw_hits: list[int]) -> bool:
    return any(_ONE_YEAR_ON_LABEL.search(lines[i]) or (i + 1 < len(lines) and _ONE_YEAR_LINE.match(lines[i + 1]))
               for i in kw_hits)


def _cmp_number(stored, lines: list[str], whole: str, kw: str) -> str:
    kw_hits = [i for i, x in enumerate(lines) if re.search(kw, x) and not CONTROL_PROMPT.match(x)]
    if "مساحه" in kw:
        kw_hits = [i for i in kw_hits if not (PER_METRE_PRICE.search(lines[i]) and not re.search(r"مساحه|م²|م2", lines[i]))]
    # A LABEL («keyword:») that ENDS its line, its value cut off, states nothing ON that line: haraj's meta
    # description is cut off at «…نوع العقار: Apartment سعر الوحدة: 27000 عمر العقار:» (21839193, re-read run
    # 41288305920, 2026-11-01), and the other field's 27000 before it read as a stated age, scoring our 9 a
    # MISMATCH. That line is emptied; a label/value neighbour («عمر العقار» / «جديد») still counts.
    lines = ["" if i in kw_hits and re.search("(?:" + kw + r")\s*[:：]\s*$", x) else x for i, x in enumerate(lines)]
    if not AREA_UNIT.search(kw):
        lines = [x if i in kw_hits or not AREA_UNIT.search(x) else "" for i, x in enumerate(lines)]
    page_states = any(re.search(r"\d", lines[i]) for i in kw_hits)
    if "مساحه" in kw and not page_states:
        # a th/td area («المساحه» / «587م») states the figure on the line under its label
        page_states = any(AREA_LABEL_LINE.match(lines[i]) and i + 1 < len(lines)
                          and re.match(r"^\s*[\d٠-٩][\d٠-٩.,]*\s*م\s*$", lines[i + 1]) for i in kw_hits)
    if kw == AGE_KW and not page_states:
        page_states = _states_one_year(lines, kw_hits)   # «عمر العقار: سنة» states 1 with no digit (CodeRabbit on #11465)
    if stored is None:
        return WE_MISS if page_states else PAGE_SILENT
    pat = _num_pattern(stored)
    if float(stored) >= 1000:
        if pat.search(whole):
            return MATCH
        # The integer-area rule below holds for a big plot too: jurash 23304862 (2026-11-03 score) prints «مساحة
        # الأرض: 1247.5 م²» and we store 1248; only the under-1,000 branch knew it, so the night scored it wrong.
        if "مساحه" in kw and float(stored) == int(float(stored)):
            near = " | ".join(lines[j] for i in kw_hits for j in (i - 1, i, i + 1) if 0 <= j < len(lines))
            if any(int(float(m.group(1).replace(",", ".")) + 0.5) == int(float(stored))
                   for m in re.finditer(r"(?<![\d.,])(\d+[.,]\d+)(?![\d])", near)):
                return MATCH
            # A thousands separator before the decimals: dealapp 23647174 (2026-11-04 score, re-read 41793162129)
            # prints «1,157.55 م²» and we store 1158; the pattern above read «1,157» as 1.157.
            if any(int(float(m.group(1).replace(",", "")) + 0.5) == int(float(stored))
                   for m in re.finditer(r"(?<![\d.,])(\d{1,3}(?:,\d{3})+\.\d+)(?![\d])", near)):
                return MATCH
    else:
        # A small figure counts only next to its keyword: on the keyword's own line, or on a
        # neighbouring line that is NOTHING BUT the value («غرف النوم» / «4», «م²» / «240»).
        # A street width's own value line may glue its «م»: erapulse prints «<div>20م</div><div>عرض الشارع</div>»
        # (646396, net.http_get 2026-11-07). Street width only — a glued area «250م» keeps the alshawaf guard's meaning.
        tail = _UNIT_TAIL + r"(?:م)?\s*" if "الشارع" in kw else _UNIT_TAIL
        bare = re.compile(r"^" + _UNIT_TAIL + pat.pattern + tail + r"$")
        for i in kw_hits:
            if pat.search(lines[i]):
                return MATCH
            if any(0 <= j < len(lines) and bare.match(lines[j]) for j in (i - 1, i + 1)):
                return MATCH
            # The value line right under a BARE area label may glue its «م» (alshawaf «المساحة» / «587م», 2026-11-09).
            # Only under the label itself — a glued «422.22م» elsewhere (the related table) keeps meaning nothing.
            if ("مساحه" in kw and AREA_LABEL_LINE.match(lines[i]) and i + 1 < len(lines)
                    and re.match(r"^\s*" + pat.pattern + r"\s*م\s*$", lines[i + 1])):
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
        # A label/value page puts the worded figure on the NEXT line: reinvest 21664052 (2026-10-30, re-read run
        # 41098655633) prints «عمر العقار» / «ثلاث سنوات» (stored 3), and the bare «3179» of the row before read as
        # a stated age, so the night scored it a MISMATCH. Only a line that is nothing but the worded figure counts.
        worded |= {WORD_NUMBERS[m.group(1)] for i in kw_hits if i + 1 < len(lines)
                   for m in [WORDED_VALUE_LINE.match(lines[i + 1])] if m}
        # haraj's REGA licence block writes the figure in English: «عمر العقار: Nine Year» (21839193, stored 9; branch
        # re-score 41284494062, 2026-11-01). An English number word on the keyword's own line states that figure too.
        worded |= {EN_NUMBERS[m.group(1).lower()] for i in kw_hits for m in EN_NUMBER.finditer(lines[i])}
        if any(ONE_WORD.search(lines[i]) for i in kw_hits):
            worded.add(1)
        # A bare singular year right after the age label is ONE year: aqarcity 30135 (aqarcity_residential_listings:
        # 2292614, 2026-11-09 score) prints «… المساحة :109 متر مربع … عمر العقار: سنة. …» on one line; stored 1, and
        # the line's 109 made «page states» true, so the night scored it a MISMATCH.
        if kw == AGE_KW and _states_one_year(lines, kw_hits):
            worded.add(1)
        if any(DUAL_WORD.search(lines[i]) for i in kw_hits):
            worded.add(2)
        # A label/value page prints the figure on its OWN line, before or after the label (🔬 2026-11-08, backlog 1615,
        # pages re-read via net.http_get): abaad 577 «عمر العقار» / «سنتين» (stored 2); aqarcity 28335 renders its
        # spec as «ثلاث سنوات» / «عمر العقار» — the value FIRST (stored 3, the site's JSON-LD «عمر العقار: ثلاث
        # سنوات»). Only a line that is nothing but the worded figure counts, on either side.
        for i in kw_hits:
            for j in (i - 1, i + 1):
                if not 0 <= j < len(lines):
                    continue
                # a value BEFORE the label must be this field's own: an AGE value («… سنوات») that no other label
                # claims — «عمر العقار» / «ثلاث سنوات» / «غرف النوم» / «اربع غرف» gives the bedrooms nothing from the
                # age line above them (CodeRabbit on #11299)
                if j == i - 1 and (kw != AGE_KW or not AGE_UNIT.search(lines[j])
                                   or (j >= 1 and re.search(_NEXT_LABEL, lines[j - 1]))):
                    continue
                m = WORDED_VALUE_LINE.match(lines[j])
                if m:
                    worded.add(WORD_NUMBERS[m.group(1)])
                if DUAL_VALUE_LINE.match(lines[j]) and (kw == AGE_KW) == bool(re.match(r"^\s*(?:سنت|عام)", lines[j])):
                    worded.add(2)
        # An OPEN age bucket «اكثر من عشر سنوات» is a floor, not a count (abaad 1261, aqarcity 29885: stored 10): a stored
        # age at or above the floor agrees with it, below it contradicts it. On the label's line or its own value line.
        if kw == AGE_KW:
            floors = [f for i in kw_hits for j in (i - 1, i, i + 1) if 0 <= j < len(lines)
                      for f in [_age_floor(lines[j], own=(j == i))] if f is not None]
            if floors:
                return MATCH if any(float(stored) >= f for f in floors) else MISMATCH
        if worded:
            return MATCH if float(stored) in worded else MISMATCH
        if kw == AGE_KW and (NEW_BUILDING.search(" | ".join(lines[i] for i in kw_hits)) or any(
                i + 1 < len(lines) and re.match(r"^\s*" + NEW_WORDS + r"\s*$", lines[i + 1], re.I) for i in kw_hits)):
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


# «المطبخ غير مركب», «مصعد غير راكب» — the fixture is NOT installed: the ad states no yes (the owner's four outcomes,
# 2026-10-25; the shared reader serves it unknown). bahadhabab 10777803 «ومطبخ المطبخ غير مركب» was asked «kitchen» by
# the 2026-11-03 score and counted a findability miss on a correctly-NULL kitchen. Up to three plain words may stand
# between the fixture and its verdict; a comma or full stop ends it («مطبخ، مكيفات غير راكبة» keeps the kitchen).
def _not_installed(kw: str) -> str:
    return r"(?:" + kw + r")\w*(?:[^\S\n]+[^\s،,.؛;]+){0,3}?[^\S\n]+غير\s+(?:راكب|مركب)\w*"


# A COUNT of zero is not the fixture: abaad prints a chip «<strong>0</strong> مطبخ» (13214734, 2026-11-03 page re-read),
# which the reader joins as «مطبخ 0» or «0 مطبخ». The score asked «kitchen» of that villa and counted a miss.
def _zero_count(kw: str) -> str:
    return r"(?<![\d٠-٩.,])[0٠]\s*(?:" + kw + r")\w*|(?:" + kw + r")\w*\s*:?\s*[0٠](?![\d٠-٩.,])"


def unprepared(x: str, kw: str) -> str:
    x = re.sub(_zero_count(kw), " ", x)
    # «مصعد مؤسس», «مؤسس مصعد» — the lift is PREPARED, the same unknown as «تأسيس مصعد» (haraj 18784258, suwar 11747618:
    # both asked «elevator» by the 2026-11-03 score, both correctly NULL in the index).
    x = re.sub(r"(?:" + kw + r")\w*\s+(?:مؤسس|موسس)\w*|(?:مؤسس|موسس)\w*\s+(?:" + kw + r")\w*", " ", x)
    return re.sub(_not_installed(kw), " ", re.sub(PREPARED + "(?:" + kw + ")", " ", x))


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


# THE OWNER'S OWN «ONE DISTRICT» DECISIONS ARE THE SAME PLACE (🆕 2026-11-05). loc_district_alias holds the owner's
# rulings that two spellings are one district («المعيزيلة» → the catalogue's «حي المعيزلة», Riyadh, owner 2026-10-25,
# Apple Maps names المعيزلة at both centres); the index serves the catalogue name for every ad that writes the other.
# The 2026-11-05 05:35 score compared letters only and counted akariyoun 23729407 / 24208576 / … and raghdan
# 23726297 / 23726304 / … («دور للبيع في حي المعيزيلة») as 8 district MISMATCHES, capping both sites at 88.2%.
# Keys are norm_district_tok() forms (the table's own); a page word matches when ITS key is an alias of OUR key.
# Loaded once per run by load_owner_district_aliases(); empty (letters only) when nothing is loaded.
OWNER_DISTRICT_ALIASES: dict[str, frozenset[str]] = {}


def load_owner_district_aliases(client) -> None:
    rows = client.table("loc_district_alias").select("from_norm,to_norm").execute().data or []
    m: dict[str, set[str]] = defaultdict(set)
    for r in rows:
        if r.get("from_norm") and r.get("to_norm"):
            m[r["to_norm"]].add(r["from_norm"])
    OWNER_DISTRICT_ALIASES.clear()
    OWNER_DISTRICT_ALIASES.update({k: frozenset(v) for k, v in m.items()})


def _owner_alias_on_page(stored: str, whole: str) -> bool:
    from scrapers.common.arabic_location import norm_district_tok
    froms = OWNER_DISTRICT_ALIASES.get(norm_district_tok(stored))
    if not froms:
        return False
    words = re.findall(r"[\u0621-\u064A]+", whole)       # a two- or three-word name is matched whole, never in part
    return any(norm_district_tok(" ".join(words[i:i + n])) in froms
               for n in (1, 2, 3, 4) for i in range(len(words) - n + 1))


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
    if _owner_alias_on_page(stored, whole):
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


# almajdiah's «/rentals/<building>» page draws its unit rows («ترخيص الاعلان: 6201065960» / «العارض») with JavaScript
# after the first paint. Read before they are drawn, the visible text is only the project blurb and the company
# footer («حي القيروان», the head office), which scored the district of 161 / 183 / 160 MISMATCH on the card-parity
# nights 2026-11-07..09 while every drawn page said what we store. A page whose unit rows are not drawn has said
# nothing about a unit; a drawn row with another district still scores wrong.
_UNIT_ROWS_BY_SCRIPT = re.compile(r"^https?://(?:www\.)?almajdiah\.com/rentals/\d")
_UNIT_ROW_LABEL = re.compile(r">\s*ترخيص ال[اإ]علان\s*:?\s*<")


def page_lacks_its_ad(url: str | None, body: str) -> bool:
    if _UNIT_ROWS_BY_SCRIPT.match(url or ""):
        return not _UNIT_ROW_LABEL.search(body or "")
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


# A page's «similar ads» block is OTHER ads, and so is the footer under it: ashab 21679061 (2026-10-30, re-read
# runs 41088522215 / 41088846088) — the ad's own header badge says «بيع» (stored بيع), but the sibling cards under
# «عقارات مشابهة» carry «إيجار» badges, which scored the deal MISMATCH and capped the night. The site's own scraper
# stops at the same markers (scrapers/ashab/run.py::parse_page); the scorer reads exactly what the scraper reads.
# alshawaf 21664551 (2026-10-30, re-read runs 41089939871 / 41090169747): the node's own table says «المساحة 250م»
# (stored 250), and the «related listings» Views table under it (`…duplicate-of-frontpage-block-1`, trap 1 in
# scrapers/alshawaf/run.py) prints other plots' «المساحة 422.22م»; the area scored MISMATCH and capped the night.
# alshawaf 22426 (2026-11-08, backlog 1357): the related table under the node carried no «frontpage-block» id, so its
# cell «المساحة 500م» survived the cut and scored our 375 (the node's own «<th>المساحة</th><td>375م</td>») MISMATCH.
# A related row is a Views LISTING row (`headers="view-changed-table-column"`, the /table index's title cell); the
# node's own facts are a th/td table that never carries it. The scraper reads only the node block (trap 1).
_SIMILAR_BLOCK = {"ashab.sa": ('id="similar-properties"', "عقارات مشابهة"),
                  "alshawaf.com.sa": ("duplicate-of-frontpage-block-1", "view-changed-table-column")}
# The node block marker: a stop that comes BEFORE it would cut the ad itself, so for these hosts a stop is only
# honoured after the ad's own block has started.
_AD_BLOCK_START = {"alshawaf.com.sa": "duplicate-of-node-block-1"}


def drop_similar_block(url: str | None, body: str) -> str:
    for host, stops in _SIMILAR_BLOCK.items():
        if host in (url or "") and body:
            start = body.find(_AD_BLOCK_START[host]) if host in _AD_BLOCK_START else 0
            if start < 0:      # the ad's own block is not on this page: cut nothing (CodeRabbit on #11280)
                continue
            for stop in stops:
                if (k := body.find(stop, start)) > 0:
                    body = body[:max(body.rfind("<", 0, k), 0) or k]   # cut at the tag, not inside it
    return body


def scope_to_its_ad(url: str | None, body: str) -> str:
    body = drop_similar_block(url, body)
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


def wahadat_unit_lines(body: str, url: str, ad_number: str | None) -> list[str]:
    """wahadat's own figures for THIS unit, from the unitsData payload its project page ships (🆕 2026-11-02).

    Every unit of a project links to that project's page (scrapers/wahadat/run.py: no per-unit page exists), and the
    visible page prints only spans («111 - 136 م²») and the instalment calculator («القسط السنوي» / «القسط الشهري»),
    whose ريال figures read as a stated price: 8 of 10 sampled units scored a price MISMATCH on 2026-11-02 (score run
    41394865647, 22783632 stored 842,622) with no unit price printed at all. The unit's own record in the page payload
    states price and area; [] when the unit is not in it (sold / reserved / renamed: unknown, never wrong)."""
    if "wahadat.sa" not in (url or "") or not ad_number or not body:
        return []
    try:
        from scrapers.wahadat import run as wahadat
        _, units = wahadat.parse_project(body, url)
    except Exception:  # noqa: BLE001
        return []
    out: list[str] = []
    for u in units:
        if f"{wahadat.PREFIX}{wahadat.unit_uid(u)}" != ad_number:
            continue
        price, area = u.get("price"), u.get("area")
        if isinstance(price, (int, float)) and not isinstance(price, bool) and price > 0:
            out.append(f"السعر {int(price) if price == int(price) else price} ريال")
        if isinstance(area, (int, float)) and not isinstance(area, bool) and area > 0:
            out.append(f"المساحة {int(area) if area == int(area) else area} م²")
        break
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


def safa_page(url: str, fetch=None) -> dict | None:
    """A safa unit read from its OWN card and sheet (backlog 1087, 2026-10-30). safa has no page per unit: the
    stored link is a shared list page (/project/units/58?page=1&property_id=14144) carrying 21 OTHER units, and
    the unit's rooms, area and price live only in the POST /unit/details sheet (scrapers/safa/run.py). 21671007
    (3 rooms, re-read run 41088522215) scored bedrooms MISMATCH against «عدد الغرف 1» of a co-working unit on
    that list and capped the 10-30 night at 5. This restates the card's deal and type and the sheet's own
    facts, labelled; None when either cannot be read (unknown, never wrong)."""
    m = re.search(r"[?&]property_id=(\d+)", url or "")
    if not m:
        return None
    uid = m.group(1)
    try:
        from scrapers.safa import run as safa
        if fetch is not None:
            card_html, popup_html = fetch(url, uid)
        else:
            s = safa.session()
            body = safa._get(s, url)
            token = safa._csrf(body)
            card_html = dict(safa._CARD_RE.findall(body)).get(uid)
            popup_html = safa.fetch_unit(s, uid, token) if token and card_html else None
        if not card_html or not popup_html:
            return None
        card, popup = safa.parse_card(card_html), safa.parse_popup(popup_html)
    except Exception:  # noqa: BLE001
        return None
    lines = []

    def put(label, v, tail=""):
        if isinstance(v, bool) or v in (None, "", 0):
            return
        lines.append(f"{label} {str(v).strip()}{tail}")
    put("نوع الإعلان", card.get("deal_ar"))
    put("نوع العقار", card.get("type_ar"))
    put("الموقع", card.get("card_location"))
    put("المساحة", popup.get("area_total_raw"), " م²")
    put("عدد الغرف", popup.get("rooms"))
    put("دورات المياه", popup.get("bathrooms"))
    put("السعر", popup.get("price_raw"), " ريال")
    title = str(popup.get("unit_title") or card.get("unit_code") or "")
    lines += [y.strip() for y in f"{title}\n{popup.get('description') or ''}".splitlines() if y.strip()]
    return {"title": title, "meta": {}, "jsonld": [], "evidence_lines": lines[:200],
            "text_head": " | ".join(lines)[:1500]}


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


def muhaysini_page(url: str, fetch=None) -> dict | None:
    """A muhaysini ad read from the platform's OWN record (🆕 2026-11-07). aqaralmuhaysini.com/propertydetails/<id> is
    a Vue shell (re-read run 42352217629: title «أحمد المحيسني العقارية», no ad text), so the nightly score sampled
    10 muhaysini arrivals a night and decided 0 — the second-biggest site (1,116 arrivals on 11-07) unmeasured.
    This restates the record's REGA licence block (AdValidator.advertisement) and its own type, labelled the way
    the comparison reads; None when the record cannot be read or is not this id (unknown, never wrong)."""
    m = re.search(r"/propertydetails/(\d+)", url or "")
    if not m:
        return None
    try:
        if fetch is not None:
            rec = fetch(m.group(1))
        else:
            from scrapers.muhaysini import run as mh
            rec = mh.fetch_detail(mh.session(), m.group(1))
    except Exception:  # noqa: BLE001 — a failed read is unknown, never wrong
        return None
    if not isinstance(rec, dict):
        return None
    adv = (rec.get("AdValidator") or {}) if isinstance(rec.get("AdValidator"), dict) else {}
    rega = adv.get("advertisement") if isinstance(adv.get("advertisement"), dict) else {}
    loc = rega.get("location") if isinstance(rega.get("location"), dict) else {}
    lines: list[str] = []

    def put(label, v, tail=""):
        if isinstance(v, bool) or v in (None, "", 0, "0"):
            return
        lines.append(f"{label} {str(v).strip()}{tail}")
    put("نوع الإعلان", {"بيع": "للبيع", "للبيع": "للبيع", "ايجار": "للايجار", "للايجار": "للايجار"}.get(
        norm(str(rega.get("advertisementType") or "")).strip()))   # norm folds إ→ا (CodeRabbit on #11031)
    put("المنطقة", loc.get("region"))
    put("المدينة", (rec.get("City") or {}).get("name") if isinstance(rec.get("City"), dict) else None)
    put("المدينة", loc.get("city"))
    put("الحي", loc.get("district"))
    put("نوع العقار", (rec.get("PropertyType") or {}).get("name") if isinstance(rec.get("PropertyType"), dict) else None)
    put("المساحة", rega.get("propertyArea"), " م²")
    put("عدد الغرف", rega.get("numberOfRooms"))
    total = rega.get("landTotalPrice") or rega.get("landTotalAnnualRent")
    put("السعر", total or rega.get("propertyPrice"), " ريال")
    if total:
        put("سعر المتر", rega.get("propertyPrice"), " ريال")
    put("عرض الشارع", rega.get("streetWidth"))
    put("عمر العقار", rega.get("propertyAge"))
    title = str(rec.get("title") or "")
    lines += [y.strip() for y in f"{title}\n{rec.get('description') or ''}".splitlines() if y.strip()]
    return {"title": title, "meta": {}, "jsonld": [], "evidence_lines": lines[:200],
            "text_head": " | ".join(lines)[:1500]}


_MOBASHER_RECORDS: "dict | None" = None


def mobasher_page(url: str, fetch=None) -> dict | None:
    """A mobasher ad read from the platform's OWN discovery record (🆕 2026-11-10). mobasher.sa/direct/realestate/<slug>
    is a JS shell to the independent reader (re-read run 42773173060: title only), so the score compared our structured
    values with the seller's one-line prose: 26222806 stores propertySpace 300 / bathrooms 5 (the record's own fields)
    and the prose says «مساحة الأرض: 250 م²»; 25881325 stores askingPrice 3,100,000 and the prose names no price —
    both scored MISMATCH and capped the 11-10 night at 5 (mobasher 83.3 %). The scraper writes the box (Rule B), so
    the comparison reads the box. Keyed by the record's slugAr (listing_url = SITE + quote(slugAr)); the list is
    walked once per run; None when it cannot be read or lacks the ad (unknown, never wrong)."""
    global _MOBASHER_RECORDS
    m = re.search(r"mobasher\.sa/direct/realestate/([^?#]+)", url or "")
    if not m:
        return None
    from urllib.parse import unquote
    try:
        if _MOBASHER_RECORDS is None:
            if fetch is not None:
                items = fetch()
            else:
                from scrapers.mobasher import run as mb
                s, _ = mb.retry_smarter_session(mb.API, timeout=40)
                items = mb.walk(s)[0]
            _MOBASHER_RECORDS = {unquote(str((x.get("searchableAttributes") or {}).get("slugAr") or x.get("slugAr") or "")): x
                                 for x in items if isinstance(x, dict)}
        x = _MOBASHER_RECORDS.get(unquote(m.group(1)).rstrip("/"))
    except Exception:  # noqa: BLE001 — a failed read is unknown, never wrong
        return None
    if not isinstance(x, dict):
        return None
    a = x.get("searchableAttributes") if isinstance(x.get("searchableAttributes"), dict) else {}

    def g(k):
        return x.get(k) if x.get(k) not in (None, "") else a.get(k)
    lines: list[str] = []

    def put(label, v, tail=""):
        if isinstance(v, bool) or v in (None, "", 0, "0"):
            return
        lines.append(f"{label} {str(v).strip()}{tail}")
    put("نوع الإعلان", "للبيع" if x.get("listingType") == "DIRECT_SALE" else None)
    put("المنطقة", g("regionNameAr"))
    put("المدينة", g("cityNameAr"))
    put("الحي", g("neighborhoodNameAr"))
    put("نوع العقار", g("propertyTypeAr"))
    put("المساحة", g("propertySpace"), " م²")
    put("عدد الغرف", g("rooms"))
    put("دورات المياه", g("bathrooms"))
    put("السعر", g("askingPrice"), " ريال")
    put("عرض الشارع", g("streetWidth"))
    title = str(g("titleAr") or "")
    summary = re.sub(r"<[^>]+>", " ", str(g("summaryAr") or ""))
    lines += [title] if title else []
    # mobasher's summaryAr is ONE line («… * مساحة الأرض: 250 م². * مسطح البناء: أكثر من 500 م². * الواجهة: جنوبية.
    # …»), so every keyword matched it and read every number in it (11-10 branch score, 26222810: «واجهه 330 15 2009 4
    # 3 6.» scored direction MISMATCH). A keyword sees only its own sentence: split on the seller's bullets / full
    # stops / bars, never inside a number («6,228.25»).
    lines += [y.strip() for y in re.split(r"\n|\s\*\s|\|| [-–] |(?<!\d)\.(?!\d)|،", summary) if y and y.strip()]
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
               nufouth=None, dallali=None, dwelleo=None, safa=None) -> dict:
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
        # The source's own figure is read even when the source states NO period: a silent rent is labelled and
        # served ×12 by the index (judge_silent_rent_period_ar, owner 2026-10-31), so the index's 12,000 is not
        # what the page prints. raghdan 23296514 / 23296518 (2026-11-03 score): source 1,000 / 500, period NULL,
        # served سنوي 12,000 / 6,000 → read as wrong and capped the night at 5.
        if raw.get("rent_period") is not None or raw.get("price_annual") is not None:
            stored = {**stored, "source_rent_period": raw.get("rent_period"),
                      "source_price_annual": raw.get("price_annual")}
        key = f"{table}:{rid}"
        if not url:
            row["sampled"] += 1
            row["unreadable_pages"] += 1
            continue
        time.sleep(max(0.0, last + pace - time.monotonic()))
        last = time.monotonic()
        own = wasalt if ("wasalt.sa" in url or "wasalt.com" in url) else sanadak if "sanadak.sa" in url else None
        if "aqaralmuhaysini.com/propertydetails/" in url:
            own = muhaysini_page
        if "mobasher.sa/direct/realestate/" in url:
            own = mobasher_page
        if "dallali.com/advertisements/" in url:
            own = dallali or dallali_page
        if "safainv.sa" in url:
            own = safa or safa_page
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
            results = compare_listing(stored, page, skip_price=platform in SKIP_PRICE,
                                      prose_only_district=platform in PROSE_ONLY_DISTRICT)
            _log_verdicts(key, results, stored, page)   # wasalt / sanadak / … print their cause too (🆕 11-07)
            fold(row, key, results, stored)
            continue
        try:
            status, body = probe(url)
        except Exception:  # noqa: BLE001 — a transport failure has said nothing about the ad
            status, body = None, ""
        if status != 200 or not body or closed_ad_page(platform, status, body):
            row["sampled"] += 1
            row["unreadable_pages"] += 1
            continue
        raw_body = body
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
        if "wahadat.sa" in url:
            ad_number = (client.table(table).select("ad_number").eq("id", rid).limit(1).execute().data
                         or [{}])[0].get("ad_number")
            page = {**page, "evidence_lines": wahadat_unit_lines(raw_body, url, ad_number)
                    + list(page.get("evidence_lines") or [])}
        if "dwelleo.sa" in url:
            extra = (dwelleo or dwelleo_room_lines)(url)
            page = {**page, "evidence_lines": extra + list(page.get("evidence_lines") or [])}
        results = compare_listing(stored, page, skip_price=platform in SKIP_PRICE,
                                  prose_only_district=platform in PROSE_ONLY_DISTRICT)
        _log_verdicts(key, results, stored, page)
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


def _evidence_lines(page: dict) -> list[str]:
    """The page lines the comparator reads (title, meta, evidence lines, text head), PII-redacted for the log."""
    raw = ([page.get("title") or ""] + list((page.get("meta") or {}).values()) + list(page.get("evidence_lines") or [])
           + (page.get("text_head") or "").split(" | "))
    return [redact_pii(str(x)) for x in raw if x]


def _log_verdicts(key: str, results: dict, stored: dict, page: dict) -> None:
    """Print the ad, the value compared and the page line behind every mismatch / AF we-miss. Lines are
    PII-redacted (a seller can put a phone on a room line; CodeRabbit on #11031)."""
    # Which ad and which stored value: a site line says «furnished: mismatch=1» but not on which of the
    # sampled ads, so every AF cap had to be re-derived by hand (dwelleo #890, 2026-10-26).
    lines = None
    for name, verdict in results.items():
        if verdict not in (MISMATCH, WE_MISS) or (verdict == WE_MISS and name not in AF_FIELDS):
            continue
        lines = lines if lines is not None else _evidence_lines(page)
        kind, col, kw = next((k, c, w) for n, k, c, w in FIELDS if n == name)
        if verdict == MISMATCH:
            # …and the page line that disagreed (🆕 2026-11-07: the 05:35 log named rakez 24669873 bedrooms=2 and
            # propertyfinder 24671162 bedrooms=20 but not what the page said, so each cap took a source re-read).
            value = (stored.get("price_total") or stored.get("source_price_annual") or stored.get("price_annual")
                     or stored.get("price_per_meter")) if name == "price" else stored.get(col)
            if name == "price" and value and not stored.get("price_total") and (
                    stored.get("rent_period_ar") == "شهري" or stored.get("source_rent_period") == "monthly"):
                value = float(value) / 12          # the figure compare_listing compared (CodeRabbit on #11031)
            hits = [] if not kw else [_safe_evidence(kw, x) for x in lines if re.search(kw, norm(x))
                                      and (kind != "number" or re.search(r"\d", x))][:3]
            print(f"    mismatch {key} {name}: stored={value!r} page={hits!r}", flush=True)
        else:
            # Recall is the 10/10 blocker: name the page line that made the score say «we miss it».
            hit = next((x for x in lines if kw and re.search(kw, norm(x))), "")
            print(f"    we_miss {key} {name}: page={_safe_evidence(kw, hit) if hit else ''!r}", flush=True)


def _safe_evidence(kw: str, line: str) -> str:
    """The keyword and the figures/negation on that line — never the seller's prose, which can carry a person's name
    redact_pii does not catch («غرف النوم 4 للتواصل مع أحمد», CodeRabbit PDPL finding on #11031)."""
    n = norm(line)
    k = re.search(kw, n)
    # A phone is never evidence (PDPL; CodeRabbit findings on #11053). One rule, no per-format list: a CLUSTER is digit
    # groups joined only by non-letters («050/123/4567», «+1 (202) 555-0147», «050_123_4567»). A cluster carrying 9+
    # digits is dropped whole unless it is one well-formed grouped price («1,600,000», «2.500.000») whose digits are
    # not a phone shape («512,345,678»). Shorter clusters keep their figures. A real price that fails this is only
    # missing from the log; nothing reads the log back.
    phone = r"(?:00966|966)[15]\d{8}|0[15]\d{8}|5\d{8}"
    price = r"[1-9]\d{0,2}(?:([,.])\d{3})(?:\1\d{3})*(?:[.,]\d{1,2})?\+?"
    def _keep(m: re.Match) -> str:
        c = m.group(0)
        d = re.sub(r"\D", "", c)
        if len(d) < 9:
            return c
        if re.fullmatch(price, c.strip()) and not re.fullmatch(phone, d):
            return c
        # «غرف النوم 4 050/123/4567»: the room count before a space is not part of the phone; keep it alone.
        lead = re.match(r"(\d{1,3}\+?)\s+(.*)$", c, re.S)
        return f"{lead.group(1)} " if lead and len(re.sub(r"\D", "", lead.group(2))) >= 9 else " "
    unphoned = re.sub(r"\+?\d(?:[^0-9A-Za-z\u0621-\u064A]+\+?\d|\d)*\+?", _keep, n)   # any separator length
    nums = re.findall(r"[+]?\d[\d,.]*[+]?", unphoned)
    neg = "لا" if re.search(r"(?<![\u0621-\u064A])(?:لا|بدون|غير)(?![\u0621-\u064A])", n) else ""
    return " ".join(x for x in ((k.group(0) if k else ""), neg, " ".join(nums[:6])) if x)


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
    load_owner_district_aliases(client)
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
