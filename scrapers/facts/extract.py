"""Facts-extraction TEST — an LLM reads an ad's own text and lists the facts it NAMES, with proof.

Owner, 2026-10-24: run it over a 10,000-ad sample first; the rows land in `public.listing_facts`
(nothing serves it) so accuracy can be judged against the sources' own structured fields before the
same reader runs over all ~404k ads. This touches NO *_listings table, NO RPC, NO scraper, NO edge
function other than the proxy `facts-extract`.

    python -m scrapers.facts.extract --run-id facts-test-2026-10-24 [--limit 10000] [--platforms aqar,haraj]
    python -m scrapers.facts.extract --selftest        # no network, no env

THE RULES THIS CODE ENFORCES (not just asks the model for):
  SOURCE IS TRUTH   three outcomes per fact: true (named) / false (explicitly negated) / no row (silent,
                    "prepared only", or about the neighbourhood). Nearby is never stored.
  PROOF OR DROP     every row's `quote` must be a literal substring of the normalised text we SENT
                    (both sides: no tatweel/diacritics/bidi marks, أإآ→ا, ى→ي, ة→ه, Arabic digits→ASCII,
                    punctuation and whitespace folded). A quote that is not found → the row is dropped
                    and counted as `unverified`.
  PDPL              phones (any shape, any digit set), emails, URLs, WhatsApp/contact clauses and
                    «أبو …» kunyas are stripped BEFORE the text leaves; a fact whose quote/value still
                    looks like contact data or a name is dropped and counted as `pii`.
  SPEND FAIL-CLOSED hard caps on calls and USD per run (stop at once); the proxy itself refuses when
                    public.ai_spend_gate() denies; a reasoning-tier reply (hidden tokens) stops the run.
                    Costs are logged per call to `listing_facts_runs`, NOT to ai_usage — the live
                    product's breaker sums every ai_usage row and must not see this batch.
  CHECKPOINT        at ≥500 ads the run stops itself (exit 3) if unverified > 5%, cost/ad > $0.001, or
                    JSON failures > 2% — "stop and fix before continuing", not "run on and hope".
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Optional

from scrapers.common.pii import redact_pii

# ── caps (hard; a flag may lower them, never raise them) ───────────────────────────────────────────
HARD_MAX_CALLS = 10_500
HARD_MAX_USD = 5.0
CHECKPOINT_ADS = 500
CHECKPOINT_UNVERIFIED = 0.05
CHECKPOINT_USD_PER_AD = 0.001
CHECKPOINT_JSON_FAIL = 0.02
REQUESTED_MODEL = "deepseek-chat"          # the non-reasoning alias; DeepSeek reports it as deepseek-flash
MAX_TEXT_CHARS = 3800                      # the proxy refuses > 4000
MIN_TEXT_CHARS = 30

# ── the catalogue (v1) ─────────────────────────────────────────────────────────────────────────────
EXISTING_BOOL = (
    "air_conditioner", "balcony", "car_entrance", "driver_room", "electricity", "elevator", "furnished",
    "garden", "gym", "installment_available", "kitchen", "laundry_room", "maid_room", "optical_fibers",
    "parking", "payment_monthly", "pool", "private_entrance", "rent_now_pay_later", "sanitation",
    "separate_electricity_meter", "separate_water_meter", "water_supply",
)
NEW_BOOL = ("majlis", "roof", "warranty", "water_tank", "well", "annex", "two_entrances", "yard",
            "electronic_deed", "grill", "basement", "storage", "garage",
            "corner_plot")   # corner / on two streets (owner 2026-10-26) — saved, no filter column yet
BOOL_FACTS = frozenset(EXISTING_BOOL + NEW_BOOL)
NUM_FACTS = frozenset(("street_width_m", "floors", "apartments_count", "shops_count", "property_age_years"))
TEXT_FACTS = frozenset(("boundaries",))

# fact → the source table's own structured column (the free ground truth). Every *_listings table
# shares the aqar column set (checked 2026-10-24 on aqar/wasalt/haraj/aqar_commercial/sakan).
GROUND_TRUTH = {
    "air_conditioner": "air_conditioner", "balcony": "balcony_terrace", "car_entrance": "car_entrance",
    "driver_room": "driver_room", "electricity": "electricity", "elevator": "elevator", "furnished": "furnished",
    "kitchen": "kitchen", "laundry_room": "laundry_room", "maid_room": "maid_room",
    "optical_fibers": "optical_fibers", "parking": "parking", "private_entrance": "private_entrance",
    "rent_now_pay_later": "rent_now_pay_later", "sanitation": "sanitation",
    "separate_electricity_meter": "separate_electricity_meter", "separate_water_meter": "separate_water_meter",
    "water_supply": "water_supply",
    "majlis": "reception_rooms_majlis",          # a count: >0 → true, 0 → false
    "street_width_m": "street_width_m", "property_age_years": "property_age", "apartments_count": "num_apartments",
}
GT_COLUMNS = tuple(sorted(set(GROUND_TRUTH.values())))

# ── the 10,000-ad plan (table → ads). --limit scales it; --platforms restricts it. ────────────────
PLAN: dict[str, int] = {
    "aqar_residential_listings": 4000,
    "wasalt_residential_listings": 1500,     # prose lives in ar_data.propertyInfo.description
    "haraj_residential_listings": 1500,
    # commercial ≈ 1,000
    "aqar_commercial_listings": 500, "dealapp_commercial_listings": 150, "haraj_commercial_listings": 150,
    "muhaysini_commercial_listings": 60, "sirdab_commercial_listings": 50, "ialqarawi_commercial_listings": 45,
    "abralosol_commercial_listings": 45,
    # small platforms ≈ 2,000, spread
    "dealapp_residential_listings": 200, "muhaysini_residential_listings": 200, "gathern_residential_listings": 150,
    "muktamel_residential_listings": 120, "dwelleo_residential_listings": 120, "tuba_residential_listings": 120,
    "aqarmonthly_residential_listings": 120, "abralosol_residential_listings": 100, "sakan_residential_listings": 100,
    "rakez_residential_listings": 100, "aqarcity_residential_listings": 80, "ialqarawi_residential_listings": 80,
    "arkaan_residential_listings": 80, "rightcompound_residential_listings": 60, "aqalemhajer_residential_listings": 50,
    "reinvest_residential_listings": 50, "mustqr_residential_listings": 50, "eaqartabuk_residential_listings": 40,
    "abaad_residential_listings": 40, "raghdan_residential_listings": 30, "sakani_residential_listings": 30,
    "therc_residential_listings": 30, "sukna_residential_listings": 20, "alshawaf_residential_listings": 20,
    "goldendeal_residential_listings": 10,
}
assert sum(PLAN.values()) == 10_000, sum(PLAN.values())


def platform_of(table: str) -> str:
    return table.rsplit("_", 2)[0]


# ── text normalisation (the proof check runs on BOTH sides of this) ───────────────────────────────
_STRIP_RE = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ​-‏‪-‮⁦-⁩؜﻿]")
_TRANS = str.maketrans("أإآىة٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "ااايه01234567890123456789")
_NON_WORD_RE = re.compile(r"[^\w]+", re.UNICODE)


def norm(s: str) -> str:
    """Fold spelling variants, marks, punctuation and whitespace so «مسبح، وحديقة» and «مسبح وحديقه» agree."""
    s = unicodedata.normalize("NFKC", s or "")
    s = _STRIP_RE.sub("", s).translate(_TRANS).lower()
    return " ".join(_NON_WORD_RE.sub(" ", s).split())


# ── PDPL: what leaves the building ────────────────────────────────────────────────────────────────
_URL_RE = re.compile(r"(?:https?://|www\.)\S+|\b\S+\.(?:com|sa|net|org|me)(?:/\S*)?", re.IGNORECASE)
_KUNYA_RE = re.compile(r"(?<![\w])(?:أبو|ابو|أم|ام|بو)\s+[ء-ي]{2,}")
_CONTACT_CLAUSE_RE = re.compile(r"واتس|whats|wa\.me|تلغرام|telegram|للتواصل|للاستفسار|اتصال|جوال|snap|سناب|انستا|insta", re.IGNORECASE)
_CLAUSE_SPLIT_RE = re.compile(r"([\n\r،,.;؛|•*\-]+)")
_PHONEISH_RE = re.compile(r"(?:[0-9٠-٩][\s\-.]?){7,}")


def sanitize(title: Optional[str], description: Optional[str]) -> str:
    """Title + description with contact data, URLs, kunyas and contact clauses removed, then the fleet
    PII redactor (phones in every shape/digit set, emails, labelled advertiser names)."""
    raw = "\n".join(x for x in (title or "", description or "") if x)
    raw = _URL_RE.sub(" ", raw)
    raw = _KUNYA_RE.sub(" ", raw)
    parts = _CLAUSE_SPLIT_RE.split(raw)
    kept = [p for p in parts if not _CONTACT_CLAUSE_RE.search(p)]
    raw = "".join(kept)
    out = redact_pii(raw) or ""
    out = out.replace("[redacted]", " ")
    out = " ".join(out.split())
    return out[:MAX_TEXT_CHARS]


def looks_pii(s: str) -> bool:
    return bool(s) and bool(_PHONEISH_RE.search(s) or "@" in s or _CONTACT_CLAUSE_RE.search(s)
                            or _KUNYA_RE.search(s) or _URL_RE.search(s))


# ── one model fact → one row, or a drop reason ────────────────────────────────────────────────────
_ARABIC_LETTER_RE = re.compile(r"[ء-ي]")


def _to_number(v: Any) -> Optional[float]:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v) if math.isfinite(float(v)) else None
    if isinstance(v, str):
        m = re.search(r"\d+(?:\.\d+)?", v.translate(_TRANS))
        return float(m.group(0)) if m else None
    return None


def validate(fact: dict[str, Any], norm_text: str) -> tuple[Optional[dict[str, Any]], str]:
    """Returns (row-fragment, 'ok') or (None, 'invalid'|'pii'|'unverified')."""
    key = fact.get("fact")
    value = fact.get("value")
    quote = fact.get("quote")
    if not isinstance(key, str) or not isinstance(quote, str) or not quote.strip() or len(quote) > 300:
        return None, "invalid"
    row: dict[str, Any] = {"quote": quote.strip(), "value_bool": None, "value_num": None, "value_text": None}
    if key == "other":
        label = fact.get("label")
        if not isinstance(label, str) or not (1 <= len(label.strip()) <= 30) or not _ARABIC_LETTER_RE.search(label) \
                or re.search(r"\d", label):
            return None, "invalid"
        row["fact"] = "other:" + " ".join(label.split())
        row["value_bool"] = True
    elif key in BOOL_FACTS:
        if isinstance(value, str) and value.lower() in ("true", "false"):
            value = value.lower() == "true"
        if not isinstance(value, bool):
            return None, "invalid"
        row["fact"], row["value_bool"] = key, value
    elif key in NUM_FACTS:
        n = _to_number(value)
        if n is None or not (0 < n < 10_000):
            return None, "invalid"
        row["fact"], row["value_num"] = key, n
    elif key in TEXT_FACTS:
        if not isinstance(value, str) or not value.strip() or len(value) > 300:
            return None, "invalid"
        row["fact"], row["value_text"] = key, " ".join(value.split())
    else:
        return None, "invalid"
    if looks_pii(row["quote"]) or looks_pii(row["value_text"] or "") or looks_pii(row["fact"]):
        return None, "pii"
    nq = norm(row["quote"])
    if not nq or nq not in norm_text:
        return None, "unverified"
    return row, "ok"


def source_value(fact: str, src: dict[str, Any]) -> Optional[str]:
    col = GROUND_TRUTH.get(fact)
    if not col or src.get(col) is None:
        return None
    v = src[col]
    if fact == "majlis":
        return str(int(v) > 0).lower()
    if isinstance(v, bool):
        return str(v).lower()
    return str(v)


# ── cost: the same formula as public.ai_usage_costed, flash tier ──────────────────────────────────
def usd_of(usage: dict[str, Any], at: datetime) -> float:
    peak = at.isoweekday() <= 5 and (1 <= at.hour < 4 or 6 <= at.hour < 10)
    hit_r, miss_r, out_r = (0.014, 0.44, 1.32) if peak else (0.007, 0.22, 0.66)
    prompt = usage.get("prompt_tokens") or 0
    hit = usage.get("cache_hit_tokens") or 0
    miss = usage.get("cache_miss_tokens")
    if miss is None:
        miss = max(prompt - hit, 0)
    out = usage.get("completion_tokens") or 0
    return (hit * hit_r + miss * miss_r + out * out_r) / 1e6


def parse_reply(content: str) -> Optional[dict[str, list[dict[str, Any]]]]:
    """{ad_id: [facts]} from the model's JSON, or None when it is not the promised shape."""
    try:
        data = json.loads(content)
    except Exception:
        a, b = content.find("{"), content.rfind("}")
        if a < 0 or b <= a:
            return None
        try:
            data = json.loads(content[a:b + 1])
        except Exception:
            return None
    ads = data.get("ads") if isinstance(data, dict) else None
    if not isinstance(ads, list):
        return None
    out: dict[str, list[dict[str, Any]]] = {}
    for ad in ads:
        if isinstance(ad, dict) and isinstance(ad.get("id"), str):
            facts = ad.get("facts")
            out[ad["id"]] = [f for f in facts if isinstance(f, dict)] if isinstance(facts, list) else []
    return out


# ── sampling (PostgREST only; no RPC, no SQL) ─────────────────────────────────────────────────────
def _text_col(table: str) -> str:
    return "ar_data->propertyInfo->>description" if table.startswith("wasalt_") else "description"


def sample_table(table: str, n: int, rng: random.Random) -> list[dict[str, Any]]:
    from scrapers.common.db import sb  # lazy: --selftest needs no credentials
    client = sb()
    tcol = _text_col(table)
    base_cols = ["id", "ad_number", "listing_url", "title", f"text:{tcol}"]
    cols = base_cols + list(GT_COLUMNS)

    def q(select: str):
        return client.table(table).select(select).eq("active", True).not_.is_(tcol, "null").order("id")

    # count via a 1-row GET: a HEAD count reads 0 on the pinned client (scrapers/common/tests/test_head_count_reads_zero.py)
    total = client.table(table).select("id", count="exact").eq("active", True).not_.is_(tcol, "null").limit(1).execute().count or 0
    page = 100
    rows: dict[str, dict[str, Any]] = {}

    def fetch(off: int, lim: int) -> list[dict[str, Any]]:
        # A small site's table may lack a ground-truth column (aqarcity/mustqr/raghdan have no `furnished`,
        # eaqartabuk no `num_apartments` — pilot 2026-10-25). Drop ONLY the named column and keep the rest.
        for _ in range(len(GT_COLUMNS)):
            try:
                return q(",".join(cols)).range(off, off + lim - 1).execute().data or []
            except Exception as e:
                m = re.search(r"column \w+\.(\w+) does not exist", str(e))
                if not m or m.group(1) not in cols or m.group(1) in base_cols:
                    raise
                cols.remove(m.group(1))
                print(f"  ! {table}: no column {m.group(1)} — sampling without it")
        return q(",".join(cols)).range(off, off + lim - 1).execute().data or []

    if total <= max(n * 3, 600):
        off = 0
        while off < total:
            for r in fetch(off, 1000):
                rows[str(r["id"])] = r
            off += 1000
    else:
        want = int(n * 1.4) + page
        offsets = sorted(rng.sample(range(0, max(total - page, 1)), k=min(total // page, math.ceil(want / page))))
        for off in offsets:
            for r in fetch(off, page):
                rows[str(r["id"])] = r
    good = []
    for r in rows.values():
        text = sanitize(r.get("title"), r.get("text"))
        if len(text) >= MIN_TEXT_CHARS and r.get("ad_number"):
            r["_text"] = text
            r["_table"] = table
            r["_platform"] = platform_of(table)
            good.append(r)
    rng.shuffle(good)
    print(f"  {table}: eligible seen {len(good)} of {total} active → taking {min(n, len(good))}")
    return good[:n]


def scale_plan(plan: dict[str, int], limit: int) -> dict[str, int]:
    """Scale a table→ads plan down to `limit` proportionally (every table keeps ≥ 1 ad)."""
    total = sum(plan.values())
    if limit >= total:
        return dict(plan)
    scaled = {t: max(1, round(n * limit / total)) for t, n in plan.items()}
    # trim rounding overshoot from the biggest entries
    while sum(scaled.values()) > limit:
        t = max(scaled, key=scaled.get)
        scaled[t] -= 1
    return scaled


def build_plan(limit: int, platforms: Optional[set[str]]) -> dict[str, int]:
    return scale_plan({t: n for t, n in PLAN.items() if not platforms or platform_of(t) in platforms}, limit)


# ── --silent: the ads the free word reader found NOTHING in (owner 2026-10-26, the teacher pass) ──────
# public.ops_text_facts_silent is a frozen snapshot of those ads (migration «ai teacher pass on the silent ads»);
# facts_silent_plan() gives the per-table counts and facts_silent_ids(table, n, seed) a seeded shuffle of one
# table's ids. The rows themselves are then read exactly as sample_table reads them (same columns, same
# ground-truth snapshot, same PDPL sanitising), so everything downstream is unchanged.
def silent_plan(limit: int, platforms: Optional[set[str]], counts: dict[str, int], category: str = "all") -> dict[str, int]:
    """category (owner 2026-10-26: «residential only, later commercial»): 'residential' keeps *_residential_listings,
    'commercial' keeps *_commercial_listings, 'all' keeps both."""
    keep = {t: n for t, n in counts.items() if n > 0 and (not platforms or platform_of(t) in platforms)
            and (category == "all" or t.endswith(f"_{category}_listings"))}
    return scale_plan(keep, limit)


def sample_silent(table: str, n: int, seed: int, mode: str = "silent") -> list[dict[str, Any]]:
    """Rows picked by id from a DB picker, then read exactly like sample_table (same columns, ground truth, PDPL).
    mode 'silent' = ops_text_facts_silent (facts_silent_ids); 'new' / 'backlog' = facts_ai_todo_ids — the ads the AI
    has never read, 'new' only those first seen in the last 3 days (owner 2026-10-26: the AI reads every new ad)."""
    from scrapers.common.db import sb
    client = sb()
    tcol = _text_col(table)
    base_cols = ["id", "ad_number", "listing_url", "title", f"text:{tcol}"]
    cols = base_cols + list(GT_COLUMNS)
    want = min(5000, int(n * 1.3) + 20)
    if mode == "silent":
        picked = client.rpc("facts_silent_ids", {"p_table": table, "p_limit": want, "p_seed": str(seed)}).execute().data
    else:
        picked = client.rpc("facts_ai_todo_ids", {"p_table": table, "p_limit": want, "p_mode": mode, "p_seed": str(seed)}).execute().data
    ids = [int(r["id"]) for r in (picked or [])]
    rows: list[dict[str, Any]] = []
    for i in range(0, len(ids), 100):
        chunk = ids[i:i + 100]
        for _ in range(len(GT_COLUMNS) + 1):
            try:
                rows += client.table(table).select(",".join(cols)).eq("active", True).in_("id", chunk).execute().data or []
                break
            except Exception as e:
                m = re.search(r"column \w+\.(\w+) does not exist", str(e))
                if not m or m.group(1) not in cols or m.group(1) in base_cols:
                    raise
                cols.remove(m.group(1))
                print(f"  ! {table}: no column {m.group(1)} — sampling without it")
    good = []
    for r in rows:
        text = sanitize(r.get("title"), r.get("text"))
        if len(text) >= MIN_TEXT_CHARS and r.get("ad_number"):
            r["_text"] = text
            r["_table"] = table
            r["_platform"] = platform_of(table)
            good.append(r)
    print(f"  {table}: silent ids {len(ids)} → eligible {len(good)} → taking {min(n, len(good))}")
    return good[:n]


# ── the proxy call ────────────────────────────────────────────────────────────────────────────────
def call_proxy(ads: list[dict[str, str]], run_id: str, provider: str = "", model: str = "") -> tuple[int, dict[str, Any]]:
    url = os.environ["SUPABASE_URL"].rstrip("/") + "/functions/v1/facts-extract"
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    req_body: dict[str, Any] = {"run_id": run_id, "ads": ads}
    if provider:                                   # owner 2026-10-27: pilot the OpenRouter reader key without flipping the default
        req_body["provider"] = provider
    if model:                                      # owner 2026-10-28: a pilot of another cheap model on the reader key
        req_body["model"] = model
    body = json.dumps(req_body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Authorization": f"Bearer {key}", "apikey": key, "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=170) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, {"error": f"http {e.code}"}
    except Exception as e:
        return 0, {"error": f"transport: {str(e)[:160]}"}


# ── the run ───────────────────────────────────────────────────────────────────────────────────────
class Stop(Exception):
    pass


def run(args: argparse.Namespace) -> int:
    from scrapers.common.db import sb
    client = sb()
    rng = random.Random(args.seed)
    platforms = set(args.platforms.split(",")) - {""} if args.platforms else None
    # THE MONTHLY CAP (owner 2026-10-26: 30 USD): public.facts_ai_budget() reads this month's cost log; a refusal ends
    # the run before any paid call, and the proxy asks the same function before every call (belt and braces).
    budget = client.rpc("facts_ai_budget", {"p_estimate_usd": round(args.limit * 0.0001, 4)}).execute().data or {}
    print(f"budget {budget.get('month')}: spent ${budget.get('spent_month')} of ${budget.get('cap')} (remaining ${budget.get('remaining')})")
    if not budget.get("allow"):
        print("STOP: the monthly AI facts budget would be exceeded — nothing read, nothing paid")
        return 0
    if args.mode == "silent":
        counts = {r["source_table"]: int(r["n"]) for r in (client.rpc("facts_silent_plan", {}).execute().data or [])}
        plan = silent_plan(args.limit, platforms, counts)
    elif args.mode in ("new", "backlog"):
        counts = {r["source_table"]: int(r["n"]) for r in (client.rpc("facts_ai_plan", {"p_mode": args.mode}).execute().data or [])}
        plan = silent_plan(args.limit, platforms, counts, args.category)
    else:
        plan = build_plan(args.limit, platforms)
    print(f"run {args.run_id}: mode {args.mode}; plan {sum(plan.values())} ads over {len(plan)} tables; caps calls≤{args.max_calls} usd≤${args.max_usd}")
    sample: list[dict[str, Any]] = []
    for table, n in plan.items():
        try:
            sample.extend(sample_table(table, n, rng) if args.mode == "sample" else sample_silent(table, n, args.seed, args.mode))
        except Exception as e:
            print(f"  ! {table}: sampling failed: {str(e)[:200]}")
    rng.shuffle(sample)
    print(f"sampled {len(sample)} ads")
    if args.skip_done:
        # Resume a stopped run: every ad this run already read has a row (a fact or the `_none` marker).
        done: set[tuple[str, str]] = set()
        off = 0
        while True:
            page = client.table("listing_facts").select("platform,listing_key").eq("run_id", args.run_id) \
                .order("id").range(off, off + 999).execute().data or []
            done.update((r["platform"], r["listing_key"]) for r in page)
            if len(page) < 1000:
                break
            off += 1000
        before = len(sample)
        sample = [r for r in sample if (r["_platform"], str(r["ad_number"])) not in done]
        print(f"--skip-done: {len(done)} (platform, ad) pairs already read in {args.run_id}; "
              f"{before - len(sample)} skipped, {len(sample)} to go")

    tot = Counter()
    usd_total = 0.0
    calls = 0
    checkpointed = False
    t_start = time.time()

    def log_call(row: dict[str, Any]) -> None:
        try:
            client.table("listing_facts_runs").insert({"run_id": args.run_id, **row}).execute()
        except Exception as e:
            print(f"  ! listing_facts_runs insert failed: {str(e)[:160]}")

    def store(rows: list[dict[str, Any]]) -> int:
        stored = 0
        for i in range(0, len(rows), 400):
            chunk = rows[i:i + 400]
            try:
                client.table("listing_facts").upsert(chunk, on_conflict="platform,listing_key,fact,run_id",
                                                    ignore_duplicates=True).execute()
                stored += len(chunk)
            except Exception as e:
                print(f"  ! listing_facts upsert failed: {str(e)[:200]}")
        return stored

    def process(batch: list[dict[str, Any]], depth: int = 0) -> None:
        nonlocal calls, usd_total
        if calls >= args.max_calls:
            raise Stop(f"call cap {args.max_calls} reached")
        if usd_total >= args.max_usd:
            raise Stop(f"usd cap ${args.max_usd} reached (${usd_total:.4f})")
        if calls and calls % 25 == 0:   # re-ask the monthly cap every 25 calls (≈ 400 ads); the proxy asks on every call
            b = client.rpc("facts_ai_budget", {"p_estimate_usd": 0}).execute().data or {}
            if not b.get("allow"):
                raise Stop(f"monthly AI facts budget reached: spent ${b.get('spent_month')} of ${b.get('cap')}")
        calls += 1
        ads = [{"id": f"{r['_platform']}:{r['ad_number']}", "text": r["_text"]} for r in batch]
        by_platform = dict(Counter(r["_platform"] for r in batch))
        t0 = time.time()
        status, resp = call_proxy(ads, args.run_id, args.provider, args.model)
        at = datetime.now(timezone.utc)
        usage = resp.get("usage") or {}
        # the provider's own bill when it sends one (OpenRouter usage.cost), else the DeepSeek token formula
        billed = resp.get("cost_usd")
        cost = (float(billed) if isinstance(billed, (int, float)) and billed >= 0 else usd_of(usage, at)) if status == 200 else 0.0
        usd_total += cost
        base = {"requested_model": resp.get("requested_model") or REQUESTED_MODEL, "model": resp.get("model"), "ads": len(batch),
                "prompt_tokens": usage.get("prompt_tokens"), "cache_hit_tokens": usage.get("cache_hit_tokens"),
                "cache_miss_tokens": usage.get("cache_miss_tokens"), "completion_tokens": usage.get("completion_tokens"),
                "usd": round(cost, 8), "http_status": status, "latency_ms": int((time.time() - t0) * 1000),
                "ads_by_platform": by_platform}
        err = str(resp.get("reason") or resp.get("error") or "")[:200]
        if status == 400 or (status == 503 and "spend gate" in err):
            log_call({**base, "json_ok": False, "note": f"fatal {status}: {err}"})
            raise Stop(f"proxy refused ({status}) — fail closed: {err}")
        if status != 200:
            # TRANSIENT, not fatal: the proxy's auth check reads the database with the caller's key and
            # the spend gate reads it again, so a PostgREST hiccup (schema reload, timeout) surfaces here
            # as 401/503/502. The first full run died at ad 3,776 on exactly one such 401 (2026-10-25).
            # Back off 5 s → 20 s → 60 s; a 401 that survives two retries IS a refusal and stops the run.
            log_call({**base, "json_ok": False, "note": f"http {status}: {err}"})
            tot["call_fail"] += 1
            if status == 401 and depth >= 2:
                raise Stop(f"proxy refused (401) three times — stopping: {err}")
            if depth < 3:
                time.sleep((5, 20, 60)[depth])
                return process(batch, depth + 1)
            tot["ads_lost"] += len(batch)
            return
        if (usage.get("reasoning_tokens") or 0) > 0:
            log_call({**base, "json_ok": False, "note": "reasoning tokens billed — wrong tier, stopping"})
            raise Stop(f"model billed {usage.get('reasoning_tokens')} reasoning tokens — not the flash/non-reasoning tier")
        model = str(resp.get("model") or "")
        if "flash" not in model and model != REQUESTED_MODEL:
            log_call({**base, "json_ok": False, "note": f"unexpected model {model!r}, stopping"})
            raise Stop(f"unexpected billed model {model!r}")
        parsed = parse_reply(resp.get("content") or "")
        if parsed is None or resp.get("finish_reason") == "length":
            tot["json_fail"] += 1
            log_call({**base, "json_ok": False, "facts_returned": 0,
                      "note": f"json {'truncated' if resp.get('finish_reason') == 'length' else 'unparseable'}"})
            if depth == 0 and len(batch) > 1:
                half = len(batch) // 2
                process(batch[:half], depth + 1)
                process(batch[half:], depth + 1)
                return
            tot["ads_lost"] += len(batch)
            return
        rows: list[dict[str, Any]] = []
        drops = Counter()
        drops_by_fact: dict[str, Counter] = {}   # a dropped row is never stored; its fact name survives here
        returned = 0
        for r in batch:
            ad_id = f"{r['_platform']}:{r['ad_number']}"
            ntext = norm(r["_text"])
            seen: set[str] = set()
            for f in parsed.get(ad_id, []):
                returned += 1
                row, why = validate(f, ntext)
                if row is None:
                    drops[why] += 1
                    name = f.get("fact")
                    if name == "other":
                        name = f"other:{f.get('label')}"
                    drops_by_fact.setdefault(str(name)[:60], Counter())[why] += 1
                    continue
                if row["fact"] in seen:
                    drops["invalid"] += 1
                    continue
                seen.add(row["fact"])
                rows.append({"run_id": args.run_id, "platform": r["_platform"], "table_name": r["_table"],
                             "listing_key": str(r["ad_number"]), "listing_url": r.get("listing_url"),
                             "model": resp.get("model"), "source_value": source_value(row["fact"], r), **row})
            if ad_id not in parsed:
                tot["ads_missing_in_reply"] += 1
        # An ad the model read but that yielded no stored fact leaves a `_none` marker row (quote ''), so
        # "ads seen" is exact per platform (coverage denominator) and --skip-done can resume a stopped run
        # without re-reading it. The report filters fact <> '_none'.
        seen_keys = {(r["platform"], r["listing_key"]) for r in rows}
        for r in batch:
            if (r["_platform"], str(r["ad_number"])) not in seen_keys:
                rows.append({"run_id": args.run_id, "platform": r["_platform"], "table_name": r["_table"],
                             "listing_key": str(r["ad_number"]), "listing_url": r.get("listing_url"),
                             "model": resp.get("model"), "fact": "_none", "value_bool": True, "value_num": None,
                             "value_text": None, "quote": "", "source_value": None})
        stored = store(rows) - sum(1 for r in rows if r["fact"] == "_none")   # facts stored, markers excluded
        tot["ads"] += len(batch)
        tot["facts_returned"] += returned
        tot["stored"] += stored
        tot["unverified"] += drops["unverified"]
        tot["pii"] += drops["pii"]
        tot["invalid"] += drops["invalid"]
        log_call({**base, "json_ok": True, "facts_returned": returned, "facts_stored": stored,
                  "dropped_unverified": drops["unverified"], "dropped_pii": drops["pii"], "dropped_invalid": drops["invalid"],
                  "drops_by_fact": {k: dict(v) for k, v in drops_by_fact.items()} or None})

    def checkpoint(final: bool = False) -> None:
        nonlocal checkpointed
        ads = tot["ads"] or 1
        returned = tot["facts_returned"] or 1
        unv = tot["unverified"] / returned
        cpa = usd_total / ads
        jf = tot["json_fail"] / max(calls, 1)
        print(f"[{'final' if final else 'checkpoint'}] ads={tot['ads']} calls={calls} usd=${usd_total:.4f} "
              f"(${cpa:.6f}/ad) stored={tot['stored']} returned={tot['facts_returned']} unverified={unv:.2%} "
              f"pii={tot['pii']} invalid={tot['invalid']} json_fail={jf:.2%} lost={tot['ads_lost']} "
              f"missing={tot['ads_missing_in_reply']} {int(time.time() - t_start)}s")
        if not final and not checkpointed and tot["ads"] >= CHECKPOINT_ADS:
            checkpointed = True
            bad = []
            if unv > CHECKPOINT_UNVERIFIED:
                bad.append(f"unverified {unv:.2%} > {CHECKPOINT_UNVERIFIED:.0%}")
            if cpa > CHECKPOINT_USD_PER_AD:
                bad.append(f"cost/ad ${cpa:.6f} > ${CHECKPOINT_USD_PER_AD}")
            if jf > CHECKPOINT_JSON_FAIL:
                bad.append(f"json failures {jf:.2%} > {CHECKPOINT_JSON_FAIL:.0%}")
            if bad:
                raise Stop("CHECKPOINT FAILED at 500 ads — fix before continuing: " + "; ".join(bad))

    rc = 0
    try:
        for i in range(0, len(sample), args.batch):
            process(sample[i:i + args.batch])
            if (i // args.batch) % 5 == 4 or tot["ads"] >= CHECKPOINT_ADS and not checkpointed:
                checkpoint()
    except Stop as e:
        print(f"STOP: {e}")
        rc = 3 if "CHECKPOINT" in str(e) else 2
    except KeyboardInterrupt:
        print("interrupted")
        rc = 130
    checkpoint(final=True)
    print(json.dumps({"run_id": args.run_id, "ads": tot["ads"], "calls": calls, "usd": round(usd_total, 4),
                      "stored": tot["stored"], "unverified": tot["unverified"], "pii": tot["pii"],
                      "invalid": tot["invalid"], "json_fail_calls": tot["json_fail"], "ads_lost": tot["ads_lost"],
                      "exit": rc}, ensure_ascii=False))
    return rc


# ── self-check: the pure logic, no network ────────────────────────────────────────────────────────
def selftest() -> None:
    # --silent plans from the live counts, proportionally, every table ≥ 1, never over the limit; a platform
    # filter and an empty table are honoured. build_plan still scales the fixed PLAN the same way.
    assert silent_plan(100, None, {"a_residential_listings": 700, "b_residential_listings": 300, "c_residential_listings": 0}) \
        == {"a_residential_listings": 70, "b_residential_listings": 30}
    sp = silent_plan(10, None, {"a_residential_listings": 9000, "b_residential_listings": 5})
    assert sp["b_residential_listings"] == 1 and sum(sp.values()) == 10, sp
    assert silent_plan(50, {"b"}, {"a_residential_listings": 100, "b_residential_listings": 100}) == {"b_residential_listings": 50}
    # category keeps one family of tables (residential first, commercial later — owner 2026-10-26)
    assert silent_plan(100, None, {"a_residential_listings": 100, "a_commercial_listings": 100}, "residential") == {"a_residential_listings": 100}
    assert silent_plan(100, None, {"a_residential_listings": 100, "a_commercial_listings": 100}, "commercial") == {"a_commercial_listings": 100}
    assert sum(silent_plan(100, None, {"a_residential_listings": 100, "a_commercial_listings": 100}, "all").values()) == 100
    assert sum(build_plan(10_000, None).values()) == 10_000 and sum(build_plan(500, None).values()) == 500
    assert norm("مَسْبَحٌ، وحديقة") == norm("مسبح وحديقه") == "مسبح وحديقه"
    assert norm("شارع ١٥ م") == "شارع 15 م"
    assert norm("مُؤَسَّس") == "مؤسس"
    s = sanitize("فيلا للبيع", "مسبح وحديقة. للتواصل 0501234567 أبو فهد واتساب 966501234567 www.x.com\nعداد مستقل")
    assert "0501234567" not in s and "966" not in s and "فهد" not in s and "x.com" not in s and "واتساب" not in s, s
    assert "مسبح وحديقة" in s and "عداد مستقل" in s, s
    s2 = sanitize(None, "شقة ٠٥٥ ١٢٣ ٤٥٦٧ مطبخ راكب")
    assert "١٢٣" not in s2 and "مطبخ راكب" in s2, s2
    assert sanitize(None, "x") == "x"
    nt = norm("فيلا: مسبح خارجي مكشوف، شارع بعرض 15 متر، بدون مصعد. مصعد مؤسس")
    ok, why = validate({"fact": "pool", "value": True, "quote": "مسبح خارجي مكشوف"}, nt)
    assert why == "ok" and ok["value_bool"] is True and ok["fact"] == "pool"
    ok, why = validate({"fact": "elevator", "value": False, "quote": "بدون مصعد"}, nt)
    assert why == "ok" and ok["value_bool"] is False
    ok, why = validate({"fact": "street_width_m", "value": "١٥", "quote": "شارع بعرض ١٥ متر"}, nt)
    assert why == "ok" and ok["value_num"] == 15.0, (ok, why)
    assert validate({"fact": "garden", "value": True, "quote": "حديقة واسعة"}, nt)[1] == "unverified"
    assert validate({"fact": "pool", "value": "yes", "quote": "مسبح"}, nt)[1] == "invalid"
    assert validate({"fact": "view", "value": True, "quote": "مسبح"}, nt)[1] == "invalid"
    assert validate({"fact": "other", "label": "اتصل 0501234567", "value": True, "quote": "مسبح"}, nt)[1] == "invalid"
    assert validate({"fact": "other", "label": "أبو فهد", "value": True, "quote": "مسبح"}, nt)[1] == "pii"
    ok, why = validate({"fact": "other", "label": "شبكة ري", "value": True, "quote": "مسبح خارجي"}, nt)
    assert why == "ok" and ok["fact"] == "other:شبكة ري"
    ok, why = validate({"fact": "boundaries", "value": "شمال 20 جنوب 20", "quote": "مسبح خارجي"}, nt)
    assert why == "ok" and ok["value_text"] == "شمال 20 جنوب 20"
    assert source_value("majlis", {"reception_rooms_majlis": 2}) == "true"
    assert source_value("majlis", {"reception_rooms_majlis": 0}) == "false"
    assert source_value("elevator", {"elevator": None}) is None
    assert source_value("street_width_m", {"street_width_m": 15}) == "15"
    assert source_value("pool", {}) is None
    off = usd_of({"prompt_tokens": 5000, "cache_hit_tokens": 1500, "cache_miss_tokens": 3500, "completion_tokens": 1000},
                 datetime(2026, 10, 25, 12, tzinfo=timezone.utc))   # Sunday → off-peak
    assert abs(off - (1500 * 0.007 + 3500 * 0.22 + 1000 * 0.66) / 1e6) < 1e-12, off
    pk = usd_of({"prompt_tokens": 5000, "cache_hit_tokens": 1500, "completion_tokens": 1000},
                datetime(2026, 10, 26, 7, tzinfo=timezone.utc))      # Monday 07:00 UTC → peak, miss derived
    assert abs(pk - (1500 * 0.014 + 3500 * 0.44 + 1000 * 1.32) / 1e6) < 1e-12, pk
    assert parse_reply('{"ads":[{"id":"a:1","facts":[{"fact":"pool","value":true,"quote":"x"}]}]}') == {"a:1": [{"fact": "pool", "value": True, "quote": "x"}]}
    assert parse_reply('junk {"ads":[{"id":"a:1","facts":[]}]} tail') == {"a:1": []}
    assert parse_reply("not json") is None and parse_reply('{"x":1}') is None
    p = build_plan(500, None)
    assert sum(p.values()) == 500 and 195 <= p["aqar_residential_listings"] <= 200, p
    assert set(build_plan(100, {"haraj"})) == {"haraj_residential_listings", "haraj_commercial_listings"}
    assert platform_of("rightcompound_residential_listings") == "rightcompound"
    print("selftest ok")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--run-id", default="")
    ap.add_argument("--limit", type=int, default=10_000)
    ap.add_argument("--platforms", default="", help="comma list of platform prefixes, e.g. aqar,haraj")
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--seed", type=int, default=20261024)
    ap.add_argument("--max-calls", type=int, default=HARD_MAX_CALLS)
    ap.add_argument("--max-usd", type=float, default=HARD_MAX_USD)
    ap.add_argument("--skip-done", action="store_true", help="resume: skip ads this run_id already read")
    ap.add_argument("--silent", action="store_true", help="alias of --mode silent")
    ap.add_argument("--mode", choices=("sample", "silent", "new", "backlog"), default="sample",
                    help="sample = the fixed 10k plan; silent = ads the reader found nothing in; new = ads first seen ≤ 3 days the AI "
                         "never read (the nightly run); backlog = any active ad the AI never read")
    ap.add_argument("--model", default="", help="OpenRouter only: one of the proxy's allowed cheap models (empty = its default)")
    ap.add_argument("--provider", choices=("", "deepseek", "openrouter"), default="",
                    help="which key the proxy spends: empty = the proxy's default (FACTS_PROVIDER), openrouter = the reader key pilot")
    ap.add_argument("--category", choices=("residential", "commercial", "all"), default="residential",
                    help="modes new/backlog only: which source tables (owner 2026-10-26: residential first, commercial later)")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        selftest()
        return 0
    if args.silent:
        args.mode = "silent"
    if not args.run_id and args.mode in ("new", "backlog"):
        args.run_id = f"facts-ai-{args.mode}-{datetime.now(timezone.utc):%Y-%m-%d}"
    if not args.run_id or not re.fullmatch(r"[A-Za-z0-9._-]{3,64}", args.run_id):
        ap.error("--run-id is required (letters, digits, . _ -)")
    args.max_calls = min(args.max_calls, HARD_MAX_CALLS)
    args.max_usd = min(args.max_usd, HARD_MAX_USD)
    args.batch = max(1, min(args.batch, 20))
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
