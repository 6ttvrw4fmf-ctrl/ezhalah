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

from scrapers.common.cleanup import _probe
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
    ("bathrooms", "number", "bathrooms", r"حمام|دوره مياه|دورات مياه"),
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
DISTRICT_ON_PAGE = re.compile(r"حي\s+\S+")
DEAL_KW = {"بيع": r"للبيع|شراء", "ايجار": r"للايجار|ايجار"}


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


def compare_listing(stored: dict, page: dict, *, skip_price: bool = False) -> dict[str, str]:
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
    out: dict[str, str] = {}
    for name, kind, col, kw in FIELDS:
        if name == "price":
            if skip_price:
                continue
            stored_v = stored.get("price_total") or stored.get("price_annual") or stored.get("price_per_meter")
            # The fleet stores a MONTHLY rent ×12 in price_annual (normalize.rent_period_from_ad) and the
            # card shows it ÷12; the page prints the monthly figure. Compare what the page prints
            # (superoffice 15485140, 2026-10-05: page «6288.40 ريال / شهر», stored 75456 = 6288×12).
            if (not stored.get("price_total") and stored.get("price_annual")
                    and stored.get("rent_period_ar") == "شهري"):
                stored_v = float(stored["price_annual"]) / 12
                if stored_v == int(stored_v):
                    stored_v = int(stored_v)
            out[name] = _cmp_number(stored_v, lines, whole, kw)
        elif kind == "number":
            out[name] = _cmp_number(stored.get(col), lines, whole, kw)
        elif kind == "bool":
            out[name] = _cmp_bool(stored.get(col), lines, kw)
        elif kind == "district":
            out[name] = _cmp_district(stored.get(col), whole)
        elif kind == "deal":
            out[name] = _cmp_valued(stored.get(col), whole, DEAL_KW)
        else:
            out[name] = _cmp_word(stored.get(col), whole, kw)
    return out


_UNIT_TAIL = r"\s*(?:م2|م²|متر|ريال|ر\.س)?\s*"


# A control prompt («اختر عدد الغرف», rakez's room picker) names a field without stating it; the unit
# prices listed under it are not a room count (rakez 15742193 / 15741402, 2026-10-06: 5/5 «mismatch»).
CONTROL_PROMPT = re.compile(r"^\s*اختر\s")


def _cmp_number(stored, lines: list[str], whole: str, kw: str) -> str:
    kw_hits = [i for i, x in enumerate(lines) if re.search(kw, x) and not CONTROL_PROMPT.match(x)]
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
        # «عمر العقار جديد» is how aqar (and others) publish a new building; we store it as 0. Read as
        # the figure 0 both ways: stored 0 + «جديد» is a MATCH, stored 5 + «جديد» stays a MISMATCH
        # (aqar 15415047, 2026-10-05: spec block «عمر العقار جديد», stored 0, was scored wrong).
        # The live page renders the spec as label/value LINES («عمر العقار» / «جديد»), so the word can sit
        # on the line after the label (aqar 15703930 / 15703349, 2026-10-06: stored 0, scored wrong
        # because the previous row's bare «220 م²» read as a stated age).
        if kw == AGE_KW and (NEW_BUILDING.search(" | ".join(lines[i] for i in kw_hits)) or any(
                i + 1 < len(lines) and re.match(r"^\s*جديد\s*$", lines[i + 1]) for i in kw_hits)):
            return MATCH if float(stored) == 0 else MISMATCH
        page_states = page_states or any(
            0 <= j < len(lines) and re.match(r"^\s*[\d,.٬]+" + _UNIT_TAIL + r"$", lines[j])
            for i in kw_hits for j in (i - 1, i + 1))
    return MISMATCH if page_states else PAGE_SILENT


def _cmp_bool(stored, lines: list[str], kw: str) -> str:
    hit = [x for x in lines if re.search(kw, x)]
    if not hit:
        return PAGE_SILENT
    page_yes = not all(re.search(NEG + "(?:" + kw + ")", x) for x in hit)
    if stored is None:
        return WE_MISS
    return MATCH if bool(stored) == page_yes else MISMATCH


def _cmp_district(stored, whole: str) -> str:
    page_names_one = bool(DISTRICT_ON_PAGE.search(whole))
    if not stored:
        return WE_MISS if page_names_one else PAGE_SILENT
    d = norm_district(stored)
    if d and d in whole:            # covers «حي X», bare «X», and a glued «X <city>» suffix
        return MATCH
    return MISMATCH if page_names_one else PAGE_SILENT


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


def score_site(client, platform: str, picks: list[tuple[str, int]], *, night: str,
               pace: float = PACE_S, probe=None) -> dict:
    probe = probe or _probe
    row = empty_row(night, platform)
    last = 0.0
    for table, rid in picks:
        stored = (client.table("search_listings_ar").select(STORED).eq("source_table", table)
                  .eq("listing_id", rid).limit(1).execute().data or [{}])[0]
        raw = (client.table(table).select("listing_url").eq("id", rid).limit(1).execute().data or [{}])[0]
        url = raw.get("listing_url")
        key = f"{table}:{rid}"
        if not url:
            row["sampled"] += 1
            row["unreadable_pages"] += 1
            continue
        time.sleep(max(0.0, last + pace - time.monotonic()))
        last = time.monotonic()
        try:
            status, body = probe(url)
        except Exception:  # noqa: BLE001 — a transport failure has said nothing about the ad
            status, body = None, ""
        if status != 200 or not body:
            row["sampled"] += 1
            row["unreadable_pages"] += 1
            continue
        fold(row, key, compare_listing(stored, page_evidence(body), skip_price=platform in SKIP_PRICE), stored)
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
            + (f" | {r['note']}" if r["note"] else ""))


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
    arrivals = new_listings(client, a.hours)
    sites = a.sites or sorted(arrivals)
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
