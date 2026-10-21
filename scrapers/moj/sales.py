"""Weekly: the Ministry of Justice's own district sales figures → public.moj_district_sales.

Source: the ministry's PUBLIC real-estate deals report (Power BI, open data, cite «وزارة العدل», never
alter a number). The ad page (src/data/adPageData.ts → fetchMojSales) reads one row per city_ar ·
district_ar · class and prints it unaltered, with the period taken from the row's own two dates.

Per (MoJ district «المدينة/الحي», class ∈ {سكني, تجاري}) over the latest 12 months of deals the
ministry HAS — anchored on the max deal date in its data, never on today's date:
  deals    = «عدد الصفقات»                 avg_deal = «متوسط سعر الصفقة»
  avg_ppm  = «متوسط سعر المتر المربع» — THEIR mean of per-deal m² prices. Never sum(price)/sum(area).
  p10/p90  = nearest-rank percentiles of the per-deal «السعر بالريال السعودي» (one row per «الرقم
             المرجعي للصفقة»), so both are real deal prices. Hidden (NULL) unless the deal rows are
             complete for that group: count == deals AND their mean == avg_deal.
  window_from/to = min/max deal date in the window; source_refreshed_at = LastRefresh.

Matching (a wrong district is worse than none): city + district after strip «حي », ة→ه, أإآ→ا, ى→ي,
collapsed spaces, plus the region. Exactly one of our (city_ar, district_ar) pairs → matched and keyed
by OUR spelling; zero → unmatched; several, or several MoJ districts onto one of ours → ambiguous.
Unmatched/ambiguous rows are stored with city_ar/district_ar NULL and anon RLS never returns them.

Fails loudly (non-zero exit → red run → alert) and writes NOTHING if the endpoint, model or columns
change, a response is truncated, the window's totals don't add up, or the live truth check
(الرياض/الرمال سكني, 2025-10-10 → 2026-05-18) does not reproduce exactly.

(The migration that created its table calls this file scrapers/moj/run.py; it is sales.py so the listing
fleet's */run.py checks do not mistake it for a listing scraper.)

Usage (from the repo root):
    python -m scrapers.moj.sales --dry-run     # fetch + validate + match, print the report, no writes
    python -m scrapers.moj.sales               # same, then upsert in batches, then the monitor
    python -m scrapers.moj.sales --monitor     # monitor only: 3 random stored rows vs a fresh read
"""
from __future__ import annotations

import argparse
import http.client
import json
import random
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

URL = "https://wabi-west-europe-d-primary-api.analysis.windows.net/public/reports/querydata?synchronous=true"
RESOURCE_KEY = "4b99c877-0115-4e0a-b12f-72212fa3833c"
MODEL_ID = 2121030
APP_CONTEXT = {"DatasetId": "7fdd0ba8-e178-40e7-9314-a94cb1352bfc",
               "Sources": [{"ReportId": "1181f279-22fa-4b84-92db-93e05fd36fb8", "VisualId": "d02221fe7eb02a8e0818"}]}
ENTITY = "TransactionSale"
CLASSES = ("سكني", "تجاري")

# Politeness + hard caps: one request at a time, a pause between them, bounded retries, bounded run.
PAUSE_S = 3.0
RETRIES = 3
BACKOFF_S = (15, 45, 120)
TIMEOUT_S = 120
MAX_REQUESTS = 60
MAX_RESPONSE_BYTES = 25_000_000
WINDOW_ROWS = 30_000            # rows asked for per request; a truncated answer is split or fails
MIN_GROUPS = 1_000              # fewer district·class groups than this = a broken read, not a quiet week
ALL_TIME_DEALS_FLOOR = 712_741  # the report's all-time «عدد الصفقات» on 2026-10-10; it only grows
STALE_DAYS = 120                # anon RLS hides a row whose window_to has not advanced for this long
BATCH = 500
# THE ARCHIVE (owner 2026-10-21: «make sure we're capturing everything»). The card's tables keep only the
# latest 12 months, only سكني/تجاري and only deals whose district matches ours: 80,289 of the 715,322 deals the
# ministry published (Jan 2023 → Sep 2026). public.moj_sales_archive keeps EVERY published deal — every year,
# every class (سكني, تجاري, زراعي, سكني تجاري), matched or not — exactly as the ministry wrote it, for the price
# estimate. Service-role only (no anon policy): the ad page keeps reading the card tables, unchanged.
# The ministry's «نوع العقار», «رقم القطعة», «المخطط» and «البلوك» columns exist but are EMPTY on all 715,322 deals
# (measured 2026-10-21), so there is nothing more to keep from them; ARCHIVE_COLUMNS is the whole filled set.
ARCHIVE_TABLE = "moj_sales_archive"
ARCHIVE_OVERLAP_DAYS = 45       # every run re-reads its last weeks: late registrations land on past dates
ARCHIVE_MAX_REQUESTS = 400      # the one-off backfill reads ~45 months, halving any month over WINDOW_ROWS
ARCHIVE_MIN_REF_SHARE = Decimal("0.99")  # distinct deal refs read vs the ministry's own «عدد الصفقات» for the span

# The truth check every run must reproduce exactly before it may write anything.
TRUTH = {"area": "الرياض/الرمال", "cls": "سكني", "from": "2025-10-10", "to": "2026-05-18",
         "deals": 285, "avg_deal": Decimal("1390633.21"), "avg_ppm": Decimal("4449.37"),
         "p10": Decimal("430000"), "p90": Decimal("1646500"),
         "window_from": "2025-10-10", "window_to": "2026-05-18",
         "total_over_total": Decimal("3723.79")}  # a DIFFERENT quantity; must never equal avg_ppm


class SourceChanged(RuntimeError):
    """The ministry's endpoint, model, columns or totals are not what this job was built against."""


# ── query building ────────────────────────────────────────────────────────────────────────────────
def _ref(kind: str, prop: str) -> dict:
    return {kind: {"Expression": {"SourceRef": {"Source": "t"}}, "Property": prop}}


def col(p: str) -> dict: return _ref("Column", p)
def mea(p: str) -> dict: return _ref("Measure", p)
def agg(p: str, fn: int) -> dict: return {"Aggregation": {"Expression": col(p), "Function": fn}}  # 3 min, 4 max
def _lit(v: str) -> dict: return {"Literal": {"Value": "'%s'" % v.replace("'", "''")}}
def _day(iso: str) -> dict: return {"Literal": {"Value": "datetime'%sT00:00:00'" % iso}}
def is_in(p: str, vals) -> dict: return {"Condition": {"In": {"Expressions": [col(p)], "Values": [[_lit(v)] for v in vals]}}}
def on_or_after(p: str, iso: str) -> dict: return {"Condition": {"Comparison": {"ComparisonKind": 2, "Left": col(p), "Right": _day(iso)}}}
def on_or_before(p: str, iso: str) -> dict: return {"Condition": {"Comparison": {"ComparisonKind": 4, "Left": col(p), "Right": _day(iso)}}}


DATE = "التاريخ الميلادي"


def body(select: list[tuple[str, dict]], where: list[dict]) -> dict:
    sel = [dict(expr, Name=name) for name, expr in select]
    q = {"Version": 2, "From": [{"Name": "t", "Entity": ENTITY, "Type": 0}], "Select": sel}
    if where:
        q["Where"] = where
    binding = {"Primary": {"Groupings": [{"Projections": list(range(len(sel)))}]},
               "DataReduction": {"DataVolume": 4, "Primary": {"Window": {"Count": WINDOW_ROWS}}}, "Version": 1}
    return {"version": "1.0.0", "cancelQueries": [], "modelId": MODEL_ID,
            "queries": [{"Query": {"Commands": [{"SemanticQueryDataShapeCommand": {"Query": q, "Binding": binding}}]},
                         "QueryId": "", "ApplicationContext": APP_CONTEXT}]}


# ── decoding (the DSR wire format: S schema, C values, R repeat bits, Ø null bits, ValueDicts) ─────
def decode(resp: dict, names: list[str]) -> tuple[list[dict], bool]:
    """Rows as {name: value} + whether the answer is complete. Raises SourceChanged on any error shape
    or when the answer's columns are not exactly the ones asked for."""
    try:
        data = resp["results"][0]["result"]["data"]
        dsr, desc = data["dsr"], data["descriptor"]
    except (KeyError, IndexError, TypeError) as e:
        raise SourceChanged(f"unexpected response shape: {json.dumps(resp, ensure_ascii=False)[:600]}") from e
    if "DS" not in dsr or "odata.error" in json.dumps(dsr.get("DataShapes", ""), ensure_ascii=False):
        raise SourceChanged(f"query refused: {json.dumps(dsr, ensure_ascii=False)[:800]}")
    by_id = {s["Value"]: s["Name"] for s in desc["Select"]}
    if sorted(by_id.values()) != sorted(names):
        raise SourceChanged(f"columns changed: asked {names}, got {list(by_id.values())}")
    ds = dsr["DS"][0]
    if "odata.error" in json.dumps(ds, ensure_ascii=False)[:2000]:
        raise SourceChanged(f"query error: {json.dumps(ds, ensure_ascii=False)[:800]}")
    dicts = ds.get("ValueDicts", {})
    rows: list[dict] = []
    schema: list[dict] | None = None
    prev: list | None = None
    for ph in ds.get("PH", []):
        for r in ph.get("DM0", []):
            if "S" in r:
                schema = r["S"]
            if schema is None:
                raise SourceChanged("row before schema")
            if "C" not in r:  # keyed form: {"G0": v, "M0": v}
                vals = [r.get(s["N"]) for s in schema]
                vals = [dicts[s["DN"]][v] if s.get("DN") and isinstance(v, int) else v for s, v in zip(schema, vals)]
            else:
                rep, nul, it, vals = r.get("R", 0), r.get("Ø", 0), iter(r["C"]), []
                for i, s in enumerate(schema):
                    if rep >> i & 1:
                        if prev is None:
                            raise SourceChanged("repeat bit on the first row")
                        vals.append(prev[i])
                    elif nul >> i & 1:
                        vals.append(None)
                    else:
                        v = next(it)
                        vals.append(dicts[s["DN"]][v] if s.get("DN") and isinstance(v, int) else v)
            prev = vals
            rows.append({by_id[s["N"]]: v for s, v in zip(schema, vals)})
    complete = ds.get("IC") is True and "RT" not in ds
    return rows, complete


# ── pure helpers ──────────────────────────────────────────────────────────────────────────────────
def day(v) -> str | None:
    """A Power BI datetime (epoch ms, UTC midnight) → 'YYYY-MM-DD'."""
    if v is None:
        return None
    return datetime.fromtimestamp(int(v) / 1000, timezone.utc).date().isoformat()


def money(v) -> Decimal:
    """The ministry's number at the precision it is displayed: 2 decimals, half-up, from its exact text."""
    return Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def deal_day(v) -> str | None:
    """The ministry's per-deal date («تاريخ الصفقة ميلادي» arrives as 'YYYY/MM/DD' text) → 'YYYY-MM-DD'; None if unreadable."""
    if v is None:
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return day(v)
    try:
        return date.fromisoformat(str(v).strip()[:10].replace("/", "-")).isoformat()
    except ValueError:
        return None


def window(anchor: date) -> tuple[date, date]:
    """The latest 12 months the ministry HAS: (anchor − 12 months, anchor]. anchor = max deal date in
    its data — never today's date (its data trails the calendar by months)."""
    try:
        back = anchor.replace(year=anchor.year - 1)
    except ValueError:  # 29 Feb
        back = anchor.replace(year=anchor.year - 1, day=28)
    return back + timedelta(days=1), anchor


def nearest_rank(sorted_vals: list[Decimal], num: int, den: int) -> Decimal:
    """The p = num/den percentile by nearest rank — always one of the real deal prices."""
    k = -(-num * len(sorted_vals) // den)  # ceil, integer-exact
    return sorted_vals[max(k, 1) - 1]


def spread(prices: list[Decimal] | None, deals: int, avg_deal: Decimal) -> tuple[Decimal | None, Decimal | None]:
    """p10/p90 only when the deal rows are the whole group: same count and same mean as the
    ministry's own measures. Anything less → (None, None): hidden, never estimated."""
    if not prices or len(prices) != deals:
        return None, None
    if abs(money(sum(prices) / len(prices)) - avg_deal) > Decimal("0.01"):
        return None, None
    v = sorted(prices)
    return nearest_rank(v, 1, 10), nearest_rank(v, 9, 10)


_HAY = re.compile(r"^حي\s+")


def norm(s: str | None) -> str:
    """Spelling-only normalisation, NOT fuzzy: ة→ه, أإآ→ا, ى→ي, collapse spaces, then strip a leading «حي »
    (letters first, so the ministry's «حى الورود» loses its prefix too)."""
    s = (s or "").translate(str.maketrans({"ة": "ه", "أ": "ا", "إ": "ا", "آ": "ا", "ى": "ي"}))
    return _HAY.sub("", re.sub(r"\s+", " ", s).strip())


def norm_region(s: str | None) -> str:
    return norm(re.sub(r"^(?:ال)?منطقة\s+", "", (s or "").strip()))


def split_area(area: str | None, city: str | None) -> tuple[str, str] | None:
    """«المدينة/الحي» → (city, district) when the prefix IS the row's city; anything else → None."""
    if not area or "/" not in area:
        return None
    c, d = area.split("/", 1)
    if not d.strip() or norm(c) != norm(city):
        return None
    return c.strip(), d.strip()


def match(moj: list[tuple[str, str, str]], ours: list[dict]) -> dict[tuple[str, str], tuple[str, str | None, str | None]]:
    """(moj_region, moj_area) → (status, city_ar, district_ar). Exactly one of ours ↔ exactly one MoJ
    district, or nothing. `moj` items are (region, area, city); `ours` rows carry region_ar/city_ar/district_ar."""
    pair_regions: dict[tuple[str, str], set[str]] = defaultdict(set)
    for o in ours:
        regs = pair_regions[(o["city_ar"], o["district_ar"])]   # registers the pair even with no region
        if o.get("region_ar"):
            regs.add(norm_region(o["region_ar"]))
    by_key: dict[tuple[str, str], set[tuple[str, str]]] = defaultdict(set)
    for pair in pair_regions:
        by_key[(norm(pair[0]), norm(pair[1]))].add(pair)
    out: dict[tuple[str, str], tuple[str, str | None, str | None]] = {}
    claimed: dict[tuple[str, str], list[tuple[str, str]]] = defaultdict(list)
    for region, area, city in moj:
        parts = split_area(area, city)
        cands = by_key.get((norm(parts[0]), norm(parts[1]))) if parts else None
        if not cands:
            out[(region, area)] = ("unmatched", None, None)
            continue
        if len(cands) > 1:
            out[(region, area)] = ("ambiguous", None, None)
            continue
        pair = next(iter(cands))
        regs = pair_regions[pair]
        if len(regs) > 1:          # our pair spans regions: the ad page could not tell them apart
            out[(region, area)] = ("ambiguous", None, None)
        elif norm_region(region) not in regs:
            out[(region, area)] = ("unmatched", None, None)
        else:
            out[(region, area)] = ("matched", *pair)
            claimed[pair].append((region, area))
    for pair, keys in claimed.items():
        if len(keys) > 1:          # several MoJ districts onto one of ours: never pick one
            for k in keys:
                out[k] = ("ambiguous", None, None)
    return out


def build_rows(aggs: list[dict], deal_rows: list[dict], ours: list[dict], refreshed_at: str, fetched_at: str) -> tuple[list[dict], dict]:
    """The rows to upsert (every MoJ district·class in the window, matched or not) + coverage stats."""
    prices: dict[tuple[str, str, str], list[Decimal]] = defaultdict(list)
    for r in deal_rows:
        if r["price"] is not None:
            prices[(r["region"], r["area"], r["cls"])].append(Decimal(str(r["price"])))
    areas = {(a["region"], a["area"]): a["city"] for a in aggs}
    m = match([(rg, ar, c) for (rg, ar), c in areas.items()], ours)
    rows, stats = [], defaultdict(int)
    for a in aggs:
        if a["cls"] not in CLASSES or a["region"] is None or a["area"] is None:
            continue
        if a["deals"] is None or a["avg_deal"] is None or a["avg_ppm"] is None or a["mn"] is None or a["mx"] is None:
            stats["skipped_incomplete"] += 1   # never write a half row
            continue
        deals, avg_deal = int(a["deals"]), money(a["avg_deal"])
        p10, p90 = spread(prices.get((a["region"], a["area"], a["cls"])), deals, avg_deal)
        status, city_ar, district_ar = m[(a["region"], a["area"])]
        stats[f"{a['cls']}:{status}"] += 1
        if p10 is None:
            stats["spread_hidden"] += 1
        rows.append({"moj_region": a["region"], "moj_area": a["area"], "property_class": a["cls"],
                     "match_status": status, "city_ar": city_ar, "district_ar": district_ar,
                     "deals": deals, "avg_deal": str(avg_deal), "avg_ppm": str(money(a["avg_ppm"])),
                     "p10_deal": None if p10 is None else str(p10), "p90_deal": None if p90 is None else str(p90),
                     "window_from": day(a["mn"]), "window_to": day(a["mx"]),
                     "source_refreshed_at": refreshed_at, "fetched_at": fetched_at, "updated_at": fetched_at})
    return rows, dict(stats)


def deal_table_rows(deal_rows: list[dict], aggs: list[dict], ours: list[dict], fetched_at: str) -> list[dict]:
    """One row per deal of a MATCHED district·class — the rows the ad page lists as «the same transactions» — every
    value the ministry's own: its date, its m², its price, ITS per-deal m² price (never price ÷ area recomputed here).
    A deal missing any of them is left out, never half-written; an unmatched area has no district to show under."""
    areas = {(a["region"], a["area"]): a["city"] for a in aggs}
    m = match([(rg, ar, c) for (rg, ar), c in areas.items()], ours)
    out = []
    for r in deal_rows:
        if r.get("cls") not in CLASSES or r.get("region") is None or r.get("area") is None:
            continue
        hit = m.get((r["region"], r["area"]))
        if not hit or hit[0] != "matched":
            continue
        d = deal_day(r.get("date"))
        if d is None or r.get("ref") is None or r.get("price") is None or r.get("area_m2") is None or r.get("ppm") is None:
            continue
        try:
            area_m2, price, ppm = Decimal(str(r["area_m2"])), money(r["price"]), money(r["ppm"])
        except (InvalidOperation, ValueError):
            continue
        if not (area_m2 > 0 and price >= 0 and ppm >= 0):
            continue
        out.append({"moj_region": r["region"], "moj_area": r["area"], "property_class": r["cls"], "deal_ref": str(r["ref"]),
                    "deal_date": d, "area_m2": str(area_m2), "price": str(price), "ppm": str(ppm),
                    "city_ar": hit[1], "district_ar": hit[2], "fetched_at": fetched_at})
    return out


def archive_rows(raw: list[dict], fetched_at: str) -> tuple[list[dict], int]:
    """Every readable deal, as the ministry wrote it — any class, matched or not. Only a row with no deal ref or no
    readable date is left out (it has no key); a missing number stays NULL, never invented. One row per key: the
    upsert cannot carry the same key twice in a batch, and the ministry repeats a deal across its m² values."""
    out: dict[tuple, dict] = {}
    skipped = 0
    for r in raw:
        d, ref = deal_day(r.get("date")), r.get("ref")
        if d is None or ref is None or str(ref).strip() == "":
            skipped += 1
            continue
        def num(v, exact=False):
            if v is None:
                return None
            try:
                return str(Decimal(str(v)) if exact else money(v))
            except (InvalidOperation, ValueError):
                return None
        row = {"moj_region": r.get("region") or "", "moj_city": r.get("city") or "", "moj_area": r.get("area") or "",
               "property_class": r.get("cls") or "", "deal_ref": str(ref).strip(), "deal_date": d,
               "area_m2": num(r.get("area_m2"), exact=True), "price": num(r.get("price")), "ppm": num(r.get("ppm")),
               "fetched_at": fetched_at}
        out[(row["moj_region"], row["moj_area"], row["property_class"], row["deal_ref"], row["area_m2"])] = row
    return list(out.values()), skipped


def archive_span(anchor: str, first: str, stored_max: str | None) -> tuple[str, str]:
    """What one run reads: everything from the ministry's first date when the archive is empty (the backfill),
    else the last ARCHIVE_OVERLAP_DAYS before what we hold through the ministry's newest date."""
    if not stored_max:
        return first, anchor
    start = max(date.fromisoformat(first), date.fromisoformat(stored_max) - timedelta(days=ARCHIVE_OVERLAP_DAYS))
    return start.isoformat(), anchor


def archive_complete(rows: list[dict], ministry_total: int) -> str | None:
    """None when the distinct deals read cover the ministry's own count for the span; else why not."""
    refs = len({(r["moj_region"], r["moj_area"], r["property_class"], r["deal_ref"]) for r in rows})
    if ministry_total and Decimal(refs) < ARCHIVE_MIN_REF_SHARE * ministry_total:
        return f"read {refs} distinct deals, the ministry counts {ministry_total} for the span: partial read"
    return None


# ── the ministry (sequential, paused, retried, capped) ────────────────────────────────────────────
def _tls() -> ssl.SSLContext:
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


class Ministry:
    def __init__(self, post=None, sleep=time.sleep, cap: int | None = None):
        self.n = 0
        self.cap = cap or MAX_REQUESTS
        self._post = post or self._http
        self._sleep = sleep

    @staticmethod
    def _http(payload: bytes) -> bytes:
        req = urllib.request.Request(URL, data=payload, method="POST", headers={
            "Content-Type": "application/json", "X-PowerBI-ResourceKey": RESOURCE_KEY,
            "User-Agent": "Ezhalah-OpenData/1.0 (weekly read of the public MoJ deals report)"})
        with urllib.request.urlopen(req, timeout=TIMEOUT_S, context=_tls()) as r:
            raw = r.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise SourceChanged(f"response over {MAX_RESPONSE_BYTES} bytes")
        return raw

    def query(self, select: list[tuple[str, dict]], where: list[dict]) -> tuple[list[dict], bool]:
        payload = json.dumps(body(select, where), ensure_ascii=False).encode()
        for attempt in range(RETRIES + 1):
            if self.n >= self.cap:
                raise SourceChanged(f"hard cap: {self.cap} requests in one run")
            if self.n:
                self._sleep(PAUSE_S)
            self.n += 1
            try:
                resp = json.loads(self._post(payload))
                return decode(resp, [n for n, _ in select])
            except SourceChanged:
                raise
            except (urllib.error.URLError, http.client.HTTPException, TimeoutError, ConnectionError, json.JSONDecodeError) as e:
                if isinstance(e, urllib.error.HTTPError) and e.code in (400, 401, 403, 404):
                    raise SourceChanged(f"HTTP {e.code} — endpoint or resource key changed") from e
                if attempt == RETRIES:
                    raise
                print(f"⚠ ministry: {str(e)[:120]} — retry {attempt + 1}/{RETRIES} in {BACKOFF_S[attempt]}s", flush=True)
                self._sleep(BACKOFF_S[attempt])
        raise AssertionError("unreachable")

    # one-row reads
    def meta(self) -> dict:
        rows, _ = self.query([("maxd", agg(DATE, 4)), ("mind", agg(DATE, 3)), ("all_deals", mea("عدد الصفقات")),
                              ("refreshed", agg("LastRefresh", 4))], [])
        if len(rows) != 1 or None in rows[0].values():
            raise SourceChanged(f"meta read: {rows}")
        r = rows[0]
        return {"anchor": day(r["maxd"]), "first": day(r["mind"]), "all_deals": int(r["all_deals"]),
                "refreshed_at": datetime.fromtimestamp(int(r["refreshed"]) / 1000, timezone.utc).isoformat()}

    def total(self, start: str, end: str, where: list[dict] = (), classes: tuple[str, ...] | None = CLASSES) -> int:
        cls = [is_in("تصنيف العقار", classes)] if classes else []
        rows, _ = self.query([("n", mea("عدد الصفقات"))],
                             [on_or_after(DATE, start), on_or_before(DATE, end), *cls, *where])
        return int(rows[0]["n"]) if rows and rows[0]["n"] is not None else 0

    def aggregates(self, start: str, end: str, where: list[dict] = ()) -> list[dict]:
        rows, complete = self.query(
            [("region", col("المنطقة")), ("city", col("المدينة")), ("area", col("الحي")), ("cls", col("تصنيف العقار")),
             ("deals", mea("عدد الصفقات")), ("avg_deal", mea("متوسط سعر الصفقة")), ("avg_ppm", mea("متوسط سعر المتر المربع")),
             ("mn", agg(DATE, 3)), ("mx", agg(DATE, 4)),
             # read only so the truth check can prove the ministry's m² measure is still THEIR mean of
             # per-deal prices and not total ÷ total; never stored, never used for avg_ppm
             ("sum_price", mea("السعر بالريال السعودي")), ("sum_area", mea("إجمالي المساحة بالمتر المربع"))],
            [on_or_after(DATE, start), on_or_before(DATE, end), is_in("تصنيف العقار", CLASSES), *where])
        if not complete:
            raise SourceChanged("district aggregates came back truncated")
        return rows

    def deals(self, start: str, end: str, where: list[dict] = ()) -> list[dict]:
        """Deal-level rows (one per «الرقم المرجعي للصفقة») between two dates, each with the ministry's own deal
        date, m² and per-deal m² price (kept in moj_district_deals, shown unaltered); a truncated slice is halved."""
        rows, complete = self.query(
            [("region", col("المنطقة")), ("area", col("الحي")), ("cls", col("تصنيف العقار")),
             ("ref", col("الرقم المرجعي للصفقة")), ("price", mea("السعر بالريال السعودي")),
             ("date", col("تاريخ الصفقة ميلادي")), ("area_m2", col("المساحة")), ("ppm", mea("سعر المتر المربع"))],
            [on_or_after(DATE, start), on_or_before(DATE, end), is_in("تصنيف العقار", CLASSES), *where])
        if complete:
            return rows
        a, b = date.fromisoformat(start), date.fromisoformat(end)
        if a >= b:
            raise SourceChanged(f"one day ({start}) holds more than {WINDOW_ROWS} deals")
        mid = a + (b - a) // 2
        return self.deals(start, mid.isoformat(), where) + self.deals((mid + timedelta(days=1)).isoformat(), end, where)

    def archive_deals(self, start: str, end: str) -> list[dict]:
        """EVERY published deal between two dates — no class filter, city kept — for public.moj_sales_archive.
        A truncated slice is halved, exactly like deals()."""
        rows, complete = self.query(
            [("region", col("المنطقة")), ("city", col("المدينة")), ("area", col("الحي")), ("cls", col("تصنيف العقار")),
             ("ref", col("الرقم المرجعي للصفقة")), ("price", mea("السعر بالريال السعودي")), ("date", col("تاريخ الصفقة ميلادي")),
             ("area_m2", col("المساحة")), ("ppm", mea("سعر المتر المربع"))],
            [on_or_after(DATE, start), on_or_before(DATE, end)])
        if complete:
            return rows
        a, b = date.fromisoformat(start), date.fromisoformat(end)
        if a >= b:
            raise SourceChanged(f"one day ({start}) holds more than {WINDOW_ROWS} deals")
        mid = a + (b - a) // 2
        return self.archive_deals(start, mid.isoformat()) + self.archive_deals((mid + timedelta(days=1)).isoformat(), end)

    def month_slices(self, start: date, end: date, read=None) -> list[dict]:
        read = read or self.deals
        out, a = [], start
        while a <= end:
            nxt = (a.replace(day=1) + timedelta(days=32)).replace(day=1)
            b = min(nxt - timedelta(days=1), end)
            out += read(a.isoformat(), b.isoformat())
            a = nxt
        return out


def one_area(mj: Ministry, region: str | None, area: str, cls: str, start: str, end: str) -> dict:
    """An independent per-district read (its own filters, its own deal rows) — the truth check and the
    monitor both go through here, not through the bulk path."""
    where = [is_in("الحي", [area]), is_in("تصنيف العقار", [cls])] + ([is_in("المنطقة", [region])] if region else [])
    aggs = mj.aggregates(start, end, where)
    if len(aggs) != 1:
        raise SourceChanged(f"{area}/{cls}: expected one group, got {len(aggs)}")
    rows, _ = build_rows(aggs, mj.deals(start, end, where), [], "", "")
    if aggs[0]["sum_price"] is not None and aggs[0]["sum_area"]:
        rows[0]["total_over_total"] = str(money(Decimal(str(aggs[0]["sum_price"])) / Decimal(str(aggs[0]["sum_area"]))))
    return rows[0]


def truth_check(mj: Ministry) -> None:
    t = TRUTH
    r = one_area(mj, None, t["area"], t["cls"], t["from"], t["to"])
    got = {"deals": r["deals"], "avg_deal": Decimal(r["avg_deal"]), "avg_ppm": Decimal(r["avg_ppm"]),
           "p10": r["p10_deal"] and Decimal(r["p10_deal"]), "p90": r["p90_deal"] and Decimal(r["p90_deal"]),
           "window_from": r["window_from"], "window_to": r["window_to"],
           "total_over_total": r.get("total_over_total") and Decimal(r["total_over_total"])}
    want = {k: t[k] for k in got}
    if got != want:
        raise SourceChanged(f"truth check failed for {t['area']} {t['cls']}: got {got}, want {want}")


def fetch(mj: Ministry) -> dict:
    """Everything one run needs, validated end to end. Raises before any write on any inconsistency."""
    meta = mj.meta()
    if meta["all_deals"] < ALL_TIME_DEALS_FLOOR:
        raise SourceChanged(f"all-time deals {meta['all_deals']} < {ALL_TIME_DEALS_FLOOR}: the model changed")
    truth_check(mj)
    start, end = window(date.fromisoformat(meta["anchor"]))
    total = mj.total(start.isoformat(), end.isoformat())
    aggs = mj.aggregates(start.isoformat(), end.isoformat())
    summed = sum(int(a["deals"] or 0) for a in aggs)
    if summed != total:
        raise SourceChanged(f"district groups sum to {summed} deals, the window holds {total}: partial read")
    if len(aggs) < MIN_GROUPS:
        raise SourceChanged(f"only {len(aggs)} district·class groups: broken read")
    deal_rows = mj.month_slices(start, end)
    return {**meta, "start": start.isoformat(), "end": end.isoformat(), "window_deals": total,
            "aggs": aggs, "deal_rows": deal_rows}


# ── the database ──────────────────────────────────────────────────────────────────────────────────
def _db():
    from scrapers.common.db import _execute, sb
    return sb(), _execute


def load_ours() -> list[dict]:
    client, ex = _db()
    data = ex(client.rpc("moj_our_districts", {}), what="moj_our_districts").data
    if not isinstance(data, list) or len(data) < 1_000:
        raise RuntimeError(f"our district list looks broken: {str(data)[:200]}")
    return data


def stored_rows(columns: str) -> list[dict]:
    client, ex = _db()
    out, page = [], 1000
    while True:
        chunk = ex(client.table("moj_district_sales").select(columns).order("moj_area").order("moj_region")
                   .order("property_class").range(len(out), len(out) + page - 1), what="moj read").data
        out += chunk
        if len(chunk) < page:
            return out


def write(rows: list[dict]) -> None:
    client, ex = _db()
    for i in range(0, len(rows), BATCH):
        ex(client.table("moj_district_sales").upsert(rows[i:i + BATCH], on_conflict="moj_region,moj_area,property_class"),
           what=f"moj upsert {i}")


def write_deals(rows: list[dict], window_start: str) -> None:
    """Upsert the window's matched deals, then prune the ones that fell out of the anchored window (the card's period
    moved on). ponytail: one global prune by date — the window is global; a district that stops matching keeps its
    old rows until they age out."""
    client, ex = _db()
    for i in range(0, len(rows), BATCH):
        ex(client.table("moj_district_deals").upsert(rows[i:i + BATCH], on_conflict="moj_region,moj_area,property_class,deal_ref"),
           what=f"moj deals upsert {i}")
    ex(client.table("moj_district_deals").delete().lt("deal_date", window_start), what="moj deals prune")


def archive_stored_max() -> str | None:
    client, ex = _db()
    data = ex(client.table(ARCHIVE_TABLE).select("deal_date").order("deal_date", desc=True).limit(1), what="archive max").data
    return data[0]["deal_date"] if data else None


def write_archive(rows: list[dict]) -> None:
    """Upsert only — the archive never prunes; a deal the ministry once published stays."""
    client, ex = _db()
    for i in range(0, len(rows), BATCH):
        ex(client.table(ARCHIVE_TABLE).upsert(rows[i:i + BATCH], on_conflict="moj_region,moj_area,property_class,deal_ref,area_m2"),
           what=f"archive upsert {i}")


def run_archive(dry_run: bool, post=None, sleep=time.sleep, stored_max=None, write=None) -> dict:
    """Read the span (backfill or overlap), prove it complete against the ministry's own count, then upsert."""
    mj = Ministry(post=post, sleep=sleep, cap=ARCHIVE_MAX_REQUESTS)
    meta = mj.meta()
    if stored_max is None and not dry_run and post is None:
        stored_max = archive_stored_max()
    start, end = archive_span(meta["anchor"], meta["first"], stored_max)
    raw = mj.month_slices(date.fromisoformat(start), date.fromisoformat(end), read=mj.archive_deals)
    rows, skipped = archive_rows(raw, datetime.now(timezone.utc).isoformat())
    total = mj.total(start, end, classes=None)
    why = archive_complete(rows, total)
    if why:
        raise SourceChanged(why)
    classes: dict[str, int] = defaultdict(int)
    for r in rows:
        classes[r["property_class"]] += 1
    report = {"archive_from": start, "archive_to": end, "ministry_deals": total, "rows": len(rows),
              "skipped_unkeyable": skipped, "by_class": dict(classes), "requests": mj.n}
    if not dry_run:
        (write or write_archive)(rows)
    return report


def guard_against_regression(meta: dict, stored: list[dict]) -> None:
    """The ministry's data never moves backwards; if its anchor is older than what we already store, the
    model changed — write nothing."""
    latest = max((r["window_to"] for r in stored if r.get("match_status") == "matched"), default=None)
    if latest and meta["anchor"] < latest:
        raise SourceChanged(f"anchor {meta['anchor']} is older than our stored window_to {latest}")


# ── the monitor: OUR stored claim vs a fresh, independent read ─────────────────────────────────────
FIELDS = ("deals", "avg_deal", "avg_ppm", "p10_deal", "p90_deal", "window_from", "window_to")


def compare(stored: dict, fresh: dict) -> list[str]:
    def v(x, k):
        val = x.get(k)
        return None if val is None else (str(val)[:10] if k.startswith("window") else Decimal(str(val)))
    return [f"{k}: stored {stored.get(k)} vs ministry {fresh.get(k)}" for k in FIELDS if v(stored, k) != v(fresh, k)]


def monitor(mj: Ministry, rng: random.Random, n: int = 3) -> list[dict]:
    """n random rows the ad page can show; each re-read through the per-district path over its own
    stored window. Any difference means OUR stored claim is wrong (or stale) — raise."""
    cols = "moj_region,moj_area,property_class,match_status,city_ar,district_ar," + ",".join(FIELDS)
    shown = [r for r in stored_rows(cols) if r["match_status"] == "matched" and r["deals"] >= 10]
    picks = rng.sample(shown, min(n, len(shown)))
    out, bad = [], []
    for s in picks:
        f = one_area(mj, s["moj_region"], s["moj_area"], s["property_class"], s["window_from"], s["window_to"])
        diffs = compare(s, f)
        out.append({"stored": s, "fresh": f, "diffs": diffs})
        if diffs:
            bad.append(f"{s['city_ar']} · {s['district_ar']} · {s['property_class']}: " + "; ".join(diffs))
    if bad:
        raise SourceChanged("stored MoJ rows disagree with a fresh read:\n  " + "\n  ".join(bad))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--monitor", action="store_true")
    ap.add_argument("--dump", help="write the run's rows + report as JSON here")
    ap.add_argument("--archive", action="store_true", help="only the full archive (backfill when empty, else the overlap)")
    args = ap.parse_args()
    t0 = time.time()
    if args.archive:
        rep = run_archive(args.dry_run)
        print(json.dumps(rep, ensure_ascii=False, indent=1), flush=True)
        print(("(dry run, nothing written) " if args.dry_run else "✓ archive upserted ") + f"{rep['rows']} rows in {round(time.time() - t0, 1)}s", flush=True)
        return 0
    mj = Ministry()
    if not args.monitor:
        got = fetch(mj)
        ours = load_ours()
        stored = stored_rows("moj_region,moj_area,property_class,match_status,window_to")
        guard_against_regression(got, stored)
        fetched_at = datetime.now(timezone.utc).isoformat()
        rows, stats = build_rows(got["aggs"], got["deal_rows"], ours, got["refreshed_at"], fetched_at)
        deal_table = deal_table_rows(got["deal_rows"], got["aggs"], ours, fetched_at)
        report = {k: got[k] for k in ("anchor", "first", "all_deals", "refreshed_at", "start", "end", "window_deals")}
        shown = [r for r in rows if r["match_status"] == "matched" and r["deals"] >= 10]
        owner = sorted((r for r in rows if r["match_status"] != "matched" and r["deals"] >= 10), key=lambda r: -r["deals"])
        report.update(groups=len(got["aggs"]), deal_rows=len(got["deal_rows"]), rows=len(rows), stats=stats,
                      deals_table_rows=len(deal_table),
                      shown_on_ad_page=len(shown),
                      not_matched_with_10_plus_deals=[f"{r['match_status']} {r['moj_area']} {r['property_class']} {r['deals']}" for r in owner[:40]],
                      requests=mj.n, seconds=round(time.time() - t0, 1))
        print(json.dumps(report, ensure_ascii=False, indent=1), flush=True)
        if args.dump:
            json.dump({"report": report, "rows": rows}, open(args.dump, "w"), ensure_ascii=False)
        if args.dry_run:
            return 0
        write(rows)
        print(f"✓ upserted {len(rows)} rows in {round(time.time() - t0, 1)}s", flush=True)
        write_deals(deal_table, got["start"])
        print(f"✓ upserted {len(deal_table)} deals, pruned those before {got['start']}", flush=True)
    if not args.monitor:
        rep = run_archive(args.dry_run)
        print("✓ archive: " + json.dumps(rep, ensure_ascii=False), flush=True)
    for c in monitor(mj, random.Random()):
        s, f = c["stored"], c["fresh"]
        print(f"✓ monitor {s['city_ar']} · {s['district_ar']} · {s['property_class']}: "
              + ", ".join(f"{k}={s[k]}" for k in FIELDS) + f"  | fresh: " + ", ".join(f"{k}={f[k]}" for k in FIELDS), flush=True)
    print(f"done: {mj.n} ministry requests, {round(time.time() - t0, 1)}s", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
