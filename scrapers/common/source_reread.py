"""Re-read original ads and put what the PAGE says next to what WE store (docs/ops/
NEW_LISTINGS_ENGINEER.md, step 6 "Re-read against the original ad, two independent ways").

This is way (b), the independent reading: it never runs our scraper's parser. For each listing it
saves the page's own structured data (JSON-LD, meta tags), the lines of visible text that carry a
price, size, rooms or an amenity, and the start of the visible text, beside every normal-filter and
Advanced-Filter value we serve for that listing. A parser bug can't hide here, because nothing here
parses the way our parser does. Way (a) (the site's own production parser on a fresh page) is the
engineer's to add per website.

READ-ONLY: it writes nothing to the database. Pages are fetched through the deletion tier's own
transport (`cleanup._probe`: it keeps the real status, and reaches wasalt only through the real
browser), and each page gets the shared verdict (`classify_response`).

  python -m scrapers.common.source_reread --ids aqar_residential_listings:123,wasalt_residential_listings:9
  python -m scrapers.common.source_reread --platform gathern --n 20 --new-hours 24
"""
from __future__ import annotations

import argparse
import html
import json
import os
import random
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from scrapers.common.cleanup import PLATFORMS, _probe
from scrapers.common.db import sb
from scrapers.common.liveness_contract import classify_response

STORED = ("platform,source_table,listing_id,region_ar,city_ar,district_ar,deal_ar,type_ar,rent_period_ar,"
          "price_total,price_annual,price_per_meter,payment_monthly,area_m2,bedrooms,bathrooms,property_age,"
          "furnished,elevator,parking,kitchen,air_conditioner,maid_room,driver_room,private_entrance,"
          "rent_now_pay_later,installment_available,installment_amount,direction_ar,street_width_m,"
          "floor_number,license_number,first_seen_at,production_ready,has_photo")

# Lines of visible text worth a human's eye: money, size, rooms, and the Advanced Filter words.
# «السعر» is a label in its own right: abaad prints «إجمالي السعر» / «290720» with the currency as an IMAGE,
# so neither line matched and the score read the description's «السوم 300,000» as the price (17954821,
# 2026-10-16, re-read run 38916643786) — while «سعر المتر» survived only because it says «متر».
EVIDENCE = re.compile(
    r"(ريال|ر\.س|SAR|السعر|م²|م2|m²|متر|مساحة|غرف|غرفة|حمام|دورات? مياه|مفروش|مؤثث|مصعد|موقف|مطبخ|مكيف|تكييف|"
    r"غرفة (?:خادمة|سائق)|مدخل خاص|عمر العقار|سنوي|شهري|للبيع|للإيجار|حي\s)")
TAG = re.compile(r"<[^>]+>")
DROP = re.compile(r"<(script|style|noscript|svg)[^>]*>.*?</\1>", re.S | re.I)
JSONLD = re.compile(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', re.S | re.I)
META = re.compile(r'<meta\s+[^>]*(?:property|name)=["\']([^"\']+)["\'][^>]*content=["\']([^"\']*)["\']', re.I)
TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.S | re.I)
# An UNTICKED checklist item a theme prints with an ✗ (WordPress «WP Residence»: `<div class="listing_detail
# not_present …"><i class="fas fa-times"></i>مصعد</div>`) is the theme listing its whole taxonomy, not the ad
# saying anything. Read as a line it became «the page says مصعد» (eastabha 2026-10-17, re-read 39020724177).
NOT_PRESENT = re.compile(r'<div[^>]*class="[^"]*\bnot_present\b[^"]*"[^>]*>.*?</div>', re.S | re.I)
# ANOTHER listing's card is not this ad. ksaaqar ends every page with related ads, each an `<a href=
# "https://ksaaqar.com/ad/…"><h5>title</h5></a>`; 12226090 (a Makkah sale) scored «kitchen» from a Jeddah
# rental's card title «… غرفتين وصالة ومطبخ …» (CI re-read 39021296467, 🔬 2026-10-17, backlog 628).
RELATED_CARD = re.compile(r'<a href="https://ksaaqar\.com/ad/[^"]*">\s*<h5>.*?</h5>\s*</a>', re.S | re.I)
# maqrat prints other ads under the ad as result cards, each with its OWN description and a link to its own
# /Property/Details/<id>: 13605201 (no description of its own) scored «furnished» from ad 72's card sentence
# «يوجد شقة في نفس المشروع داخليه مؤثثة», and 18862188 scored «kitchen» from four other ads' cards
# (CI re-read 41292070655, 🔬 2026-11-01, backlog 1123).
RESULT_CARD_TEXT = re.compile(r'<p class="(?:result-card-description|property-showcase-location)\b[^"]*"[^>]*>.*?</p>',
                              re.S | re.I)


# A spec table renders its label and its value as two elements («عدد غرف النوم» / «1»): split on tags they
# become two lines, and the bare value never matched EVIDENCE, so the reader kept the label and lost the
# figure. reinvest 17384274 (2026-10-12) then showed only the description's «3 غرف نوم» and scored our
# structured bedrooms = 1 a mismatch although the page's own table says «عدد غرف النوم 1». A short value
# line straight after an evidence label is kept WITH its label.
# The unit may be written in Latin letters: akariyoun prints «مساحة العقار: 578 m²» (17512660 / 17512661,
# 2026-10-13); with only the Arabic units the value line was dropped, the description's «المساحة : 900م» was
# all that reached the score, and our structured 578 scored a mismatch on both ads.
SHORT_VALUE = re.compile(r"^[\d٠-٩][\d٠-٩.,٬]*(?:\s*(?:م²|م2|متر|m²|m2|sqm|ريال|ر\.س|سنة|سنوات))?$|^(?:نعم|لا|جديد|يوجد|لا يوجد)$")


def _with_values(lines: list[str]) -> list[str]:
    out: list[str] = []
    for i, x in enumerate(lines):
        if not EVIDENCE.search(x):
            continue
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        out.append(f"{x} {nxt}" if nxt and not EVIDENCE.search(nxt) and SHORT_VALUE.match(nxt) else x)
    return out


# Hosts the shared probe cannot read in time, read the way their own scraper reads them. muktamel answers
# its listing pages slowly: the probe's 25 s per profile timed out on 5/5 pages (re-read run 38224014958,
# the 10-12 and 10-13 scores: «unreadable»), while scrapers/muktamel/run.py (chrome124 + Arabic
# Accept-Language, 45 s, 3 tries) verified 3,504 of them alive the same day (backlog #456). The READER
# only; cleanup._probe (the liveness path) is untouched.
SLOW_HOSTS = {"muktamel.com": 45}


def read_page(url: str) -> tuple[int | None, str]:
    host = (urlsplit(url).netloc or "").lower()
    budget = next((t for h, t in SLOW_HOSTS.items() if host == h or host.endswith("." + h)), None)
    if budget is None:
        return _probe(url)
    from curl_cffi import requests as _cc
    s = _cc.Session(impersonate="chrome124")
    s.headers.update({"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                      "Accept-Language": "ar,en-US;q=0.7,en;q=0.6"})
    for attempt in range(3):
        try:
            r = s.get(url, timeout=budget, allow_redirects=True)
            return r.status_code, (r.text or "")
        except Exception:
            time.sleep(1.0 * (attempt + 1))
    return None, ""


# A page that states a field only in its own app payload, with its own label for it. sanadak renders its
# spec from the Next.js flight data: `{"label":"area_m2","key":"lotSize"}` and `"lotSize":760` (17502436,
# re-read run 38361883389). The visible text then carries only the description («المساحة : 150م تقريباً»),
# so the score compared our 760 with prose and called 4 of 5 sanadak areas wrong. The PAGE says which key is
# its area; that pair becomes one evidence line, read without our parser.
_PAYLOAD_LABEL = re.compile(r'"label":"area_m2","key":"(\w+)"')


def _payload_area_lines(body: str) -> list[str]:
    flat = (body or "").replace('\\', "")
    out = []
    for key in dict.fromkeys(_PAYLOAD_LABEL.findall(flat)):
        m = re.search(r'"' + re.escape(key) + r'":(\d+(?:\.\d+)?)[,}]', flat)
        if m:
            out.append(f"مساحة العقار {m.group(1)} م²")
    return out


# The same for the ad's PLACE: a page whose app payload carries the district as a structured field
# (`"neighborhoodNameAr":"حي …"`, `"districtNameAr"`, `"district_ar"`) gets it as one evidence line, so the score
# does not fall back on the seller's description. (Written for mobasher 17693081 on 2026-10-14; a later re-read
# showed mobasher's served HTML does NOT carry the field at all — that site is handled by PROSE_ONLY_DISTRICT in
# new_listings_score.py. This reader rule stays for any page that does.)
_PAYLOAD_PLACE = re.compile(r'"(?:neighborhoodNameAr|districtNameAr|district_ar)":"([^"]{2,60})"')


def _payload_place_lines(body: str) -> list[str]:
    flat = (body or "").replace('\\', "")
    out = []
    for name in dict.fromkeys(_PAYLOAD_PLACE.findall(flat)):
        name = name.strip()
        out.append(name if name.startswith("حي ") else f"حي {name}")
    return out


# A spec table whose label and value sit in SIBLING elements, so the visible-text split puts them on different
# lines and drops the bare value. hajer (WordPress «Real Estate Manager»: «<strong class="rem-single-field-title">
# عدد غرف النوم</strong> … <span class="rem-single-field-value">3</span>») kept only the label line; the score
# then read the description's «غرفتين نوم» / «غرفتين ماستر» as the count and called 17663701 (6) and 17663672
# (3) wrong (2026-10-14). The pair is rejoined as one line «LABEL VALUE», read without our parser.
_REM_PAIR = re.compile(r'rem-single-field-title"[^>]*>([^<]{1,40})</strong>(.*?)(?=rem-single-field-title"|$)', re.S)
_REM_VALUE = re.compile(r'rem-single-field-value[^>]*>(.*)', re.S)


def _label_value_lines(body: str) -> list[str]:
    out = []
    for m in _REM_PAIR.finditer(body or ""):
        v = _REM_VALUE.search(m.group(2)[:2000])
        if not v:
            continue
        value = re.sub(r"\s+", " ", html.unescape(TAG.sub(" ", v.group(1)))).strip()[:60]
        label = re.sub(r"\s+", " ", html.unescape(m.group(1))).strip()
        if label and value:
            out.append(f"{label} {value}")
    return out


# A chip whose NUMBER comes first: abaad prints «<strong>6</strong> حمام», «<strong>8</strong> غرف نوم»,
# «<strong>3</strong> صالات». The visible-text split puts each figure on the line BEFORE its label, so
# _with_values glued every label to the NEXT chip's figure («حمام 8», «غرف نوم 3») and the score called
# 18623200's 8 bedrooms / 6 bathrooms wrong (2026-10-19, re-read run 39215583152). The pair is rejoined as
# one line «LABEL VALUE», read without our parser.
_CHIP_PAIR = re.compile(r"<strong>\s*(\d{1,3})\s*</strong>\s*([^<>\d]{2,30}?)\s*<")


def _number_first_lines(body: str) -> list[str]:
    out = []
    for m in _CHIP_PAIR.finditer(body or ""):
        label = re.sub(r"\s+", " ", html.unescape(m.group(2))).strip()
        if label and EVIDENCE.search(label):
            out.append(f"{label} {m.group(1)}")
    return out


def page_evidence(body: str) -> dict:
    """What a person (or the page's own structured data) says, with no parser of ours involved."""
    body = RESULT_CARD_TEXT.sub(" ", body or "")   # every reader below (labels, numbers, lines) sees the ad, not its neighbours
    jsonld = []
    for block in JSONLD.findall(body or ""):
        try:
            jsonld.append(json.loads(html.unescape(block.strip())))
        except ValueError:
            jsonld.append({"_unparsed": block.strip()[:500]})
    meta = {k: html.unescape(v) for k, v in META.findall(body or "")
            if k.startswith(("og:", "twitter:", "description", "product:"))}
    title = TITLE.search(body or "")
    text = TAG.sub("\n", DROP.sub(" ", RELATED_CARD.sub(" ", NOT_PRESENT.sub(" ", body or ""))))
    lines = [re.sub(r"\s+", " ", html.unescape(x)).strip() for x in text.split("\n")]
    lines = [x for x in lines if x]
    return {
        "title": html.unescape(title.group(1).strip()) if title else None,
        "meta": meta,
        "jsonld": jsonld[:5],
        # 400, not 60: a rakez project page lists every unit (price · rooms · area), and unit #C22 of
        # project 34830 (17539724, 890,000 / 161 m², re-read run 38361960175) sits past line 60, so the
        # score only saw the OTHER units and called our exact values wrong (backlog #124). The job log
        # still prints only the first n_evidence lines.
        "evidence_lines": (_payload_area_lines(body) + _payload_place_lines(body) + _label_value_lines(body)
                           + _number_first_lines(body) + _with_values(lines))[:400],
        "text_head": " | ".join(lines)[:1500],
    }


# Blocks of a page's JSON-LD that describe a PERSON, never the property: their `image` is an avatar or
# a logo (dealapp's offers.seller.image showed «page images 1» on an ad with no photo). We store no
# seller data and never read these blocks (PDPL), so they count for nothing.
_NOT_THE_PROPERTY = ("seller", "author", "agent", "provider", "contactPoint", "brand", "publisher")


def page_image_count(page: dict) -> int | None:
    """How many images the PAGE's own structured data lists (JSON-LD `image`, any depth), counted
    without our parser; None when the page carried no JSON-LD to count from. Photos are part of the
    New Listings check (owner 2026-10-03), and the artifact that holds the JSON-LD is unreachable
    from a cloud session, so the count has to be readable from the job log."""
    blocks = (page or {}).get("jsonld") or []
    if not blocks:
        return None

    def walk(node) -> int:
        if isinstance(node, dict):
            n = 0
            for k, v in node.items():
                if k in _NOT_THE_PROPERTY:
                    continue   # the agent's avatar is not a photo of the property (backlog 8, dealapp)
                if k == "image":
                    n += len(v) if isinstance(v, list) else (1 if v else 0)
                else:
                    n += walk(v)
            return n
        if isinstance(node, list):
            return sum(walk(x) for x in node)
        return 0

    return sum(walk(b) for b in blocks)


def page_image_paths(page: dict) -> list[str]:
    """Where in the page's JSON-LD each `image` sits, e.g. ['itemOffered.image x1', 'image x4'], so a
    scraper that reads only one of those places can be told from a page that lists no image at all."""
    out: list[str] = []

    def walk(node, path: str) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                here = f"{path}.{k}" if path else k
                if k == "image":
                    n = len(v) if isinstance(v, list) else (1 if v else 0)
                    if n:
                        out.append(f"{here} x{n}")
                else:
                    walk(v, here)
        elif isinstance(node, list):
            for x in node:
                walk(x, path)

    for b in (page or {}).get("jsonld") or []:
        walk(b, "")
    return out


_LOG_FIELDS = ("city_ar", "district_ar", "deal_ar", "type_ar", "rent_period_ar", "price_total", "price_annual",
               "area_m2", "bedrooms", "bathrooms")


def page_structured_props(page: dict, limit: int = 40) -> list[str]:
    """The page's OWN structured facts, as «name=value», from schema.org `additionalProperty` and
    `amenityFeature` at any depth of its JSON-LD. Trap 1 of the 🔬 rulebook: «the site doesn't publish
    that field» must be proven from the raw payload, and the artifact holding the JSON-LD cannot be
    downloaded from a cloud session — so the names (and short values) go to the job log. Only these two
    lists are walked: never `seller`, `author` or any contact block (PDPL)."""
    out: list[str] = []

    def walk(node) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                if k in ("seller", "author", "agent", "provider", "contactPoint", "telephone", "email"):
                    continue
                if k in ("additionalProperty", "amenityFeature") and isinstance(v, list):
                    for x in v:
                        if isinstance(x, dict) and x.get("name") is not None:
                            out.append(f"{x.get('name')}={str(x.get('value'))[:40]}")
                else:
                    walk(v)
        elif isinstance(node, list):
            for x in node:
                walk(x)

    for b in (page or {}).get("jsonld") or []:
        walk(b)
    return out[:limit]


def log_lines(item: dict, n_evidence: int = 15) -> list[str]:
    """The comparison as plain log lines. The reread.json artifact cannot be downloaded from a cloud
    agent session (its blob host is refused by the egress proxy, measured 2026-10-02), so the
    stored-vs-page facts must also be readable from the job log itself."""
    st = item.get("stored") or {}
    page = item.get("page") or {}
    out = [f"== {item.get('table')}:{item.get('id')} status={item.get('status')} verdict={item.get('verdict')}",
           f"   url: {item.get('url')}",
           "   stored: " + " | ".join(f"{k}={st.get(k)}" for k in _LOG_FIELDS if st.get(k) is not None),
           f"   page title: {page.get('title')}",
           f"   page images (JSON-LD): {page_image_count(page)} | og:image: {bool((page.get('meta') or {}).get('og:image'))} "
           f"| we serve a photo: {st.get('has_photo')} | image at: {page_image_paths(page)}"]
    og = (page.get("meta") or {}).get("og:image")
    if og:
        # The VALUE, not just its presence: a site-wide default og:image (logo, banner) and a real
        # listing photo both read «og:image: True» (2026-10-07: aqarnajran 0% photos could not be
        # told apart from source truth because only the boolean was printed).
        out.append(f"   og:image value: {str(og)[:200]}")
    props = page_structured_props(page)
    if props:
        out.append("   page structured props: " + " | ".join(props))
    out += [f"   page: {x[:200]}" for x in (page.get("evidence_lines") or [])[:n_evidence]]
    return out


def parse_ids(spec: str) -> list[tuple[str, int]]:
    """'table:id,table:id' → [(table, id)]. Anything malformed is refused, never guessed."""
    out = []
    for part in filter(None, (p.strip() for p in spec.split(","))):
        table, _, rid = part.partition(":")
        if not table or not rid.isdigit():
            raise ValueError(f"bad --ids entry {part!r}; expected table:id")
        out.append((table, int(rid)))
    return out


# Which KEY of wasalt's page JSON states a fact (trap 1: «the site doesn't publish it» must be proven from the
# raw payload). The score flattens propertyDetailsV3 into text lines and loses the key; this prints the path.
_WASALT_FACT = re.compile(r"elevat|lift|مصعد|kitchen|مطبخ|bath|حمام|دورات|amenit|feature|facing|direction|واجهة|builtUpArea|plotArea|landArea|unitArea|propertyArea|مساحة|م²|bedroom|غرف", re.I)


def wasalt_fact_paths(data, limit: int = 60) -> list[str]:
    from scrapers.common.af_score import _WASALT_SKIP
    pd = (((data or {}).get("props") or {}).get("pageProps") or {}).get("propertyDetailsV3")
    out: list[str] = []

    def walk(node, path: str, key: str = "") -> None:
        if len(out) >= limit or (key and _WASALT_SKIP.search(key)):
            return
        if isinstance(node, dict):
            leaves = {k: v for k, v in node.items() if isinstance(v, (str, int, float, bool)) and not _WASALT_SKIP.search(str(k))}
            if 0 < len(node) <= 6 and len(leaves) == len(node) and any(_WASALT_FACT.search(str(v)) for v in leaves.values()):
                out.append(f"{path} = {json.dumps(leaves, ensure_ascii=False)[:200]}")   # a small {key, label, value} row
                return
            for k, v in node.items():
                walk(v, f"{path}.{k}", str(k))
        elif isinstance(node, list):
            for i, x in enumerate(node[:30]):
                walk(x, f"{path}[{i}]", key)
        elif node not in (None, "") and (_WASALT_FACT.search(path) or _WASALT_FACT.search(str(node)[:200])):
            out.append(f"{path} = {str(node)[:160]}")

    walk(pd, "propertyDetailsV3")

    # Every price the page carries, whatever the fact filter kept: settling a «hundreds of billions» land
    # (backlog 371/392, PRICE = SOURCE) needs salePrice / conversionPrice / per-metre as Wasalt serves them.
    def prices(node, path: str) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                if isinstance(v, (int, float, str)) and not isinstance(v, bool) and _PRICE_KEY.search(str(k)) \
                        and v not in ("", None):
                    line = f"{path}.{k} = {str(v)[:40]}"
                    if line not in out:
                        out.append(line)
                else:
                    prices(v, f"{path}.{k}")
        elif isinstance(node, list):
            for i, x in enumerate(node[:30]):
                prices(x, f"{path}[{i}]")

    prices(pd, "propertyDetailsV3")
    return out


_PRICE_KEY = re.compile(r"price", re.I)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", default="", help="table:id,… exactly these listings")
    ap.add_argument("--platform", default="", help="sample this website's new listings instead")
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--new-hours", type=int, default=24)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--around", default="", help="print the page HTML around this word (markup diagnostic)")
    a = ap.parse_args()
    client = sb()

    if a.ids:
        wanted = parse_ids(a.ids)
    elif a.platform:
        since = (datetime.now(timezone.utc) - timedelta(hours=a.new_hours)).isoformat()
        rows = (client.table("search_listings_ar").select("source_table,listing_id")
                .eq("platform", a.platform).gte("first_seen_at", since).limit(2000).execute().data or [])
        rng = random.Random(a.seed)
        wanted = [(r["source_table"], int(r["listing_id"])) for r in rng.sample(rows, min(a.n, len(rows)))]
    else:
        print("give --ids or --platform", file=sys.stderr)
        return 2

    out = []
    for table, rid in wanted:
        stored = (client.table("search_listings_ar").select(STORED).eq("source_table", table)
                  .eq("listing_id", rid).limit(1).execute().data or [{}])[0]
        raw = (client.table(table).select("listing_url,neighborhood").eq("id", rid).limit(1).execute().data or [{}])[0]
        url = raw.get("listing_url")
        item = {"table": table, "id": rid, "url": url, "stored": stored,
                "card_district_raw": raw.get("neighborhood")}
        if url:
            status, body = read_page(url)
            platform = stored.get("platform") or table.split("_")[0]
            item["status"] = status
            item["verdict"] = classify_response(status, body or "",
                                                dead_marker=PLATFORMS.get(platform, {}).get("dead_marker"))
            item["page"] = page_evidence(body or "")
            if a.around and body:
                # Searched in the DECODED markup: alsaedan and arkaan write their Arabic as HTML entities, so a raw
                # search for «موقف» or «ثلاث دورات» found nothing on pages that print it (🔬 2026-10-17).
                hay = html.unescape(body)
                for m in list(re.finditer(re.escape(a.around), hay))[:3]:
                    snip = hay[max(0, m.start() - 400):m.end() + 200]
                    snip = re.sub(r"(?:\+?966|0)?5\d{8}|\d{9,}", "<num>", snip)   # PDPL: no phone ever printed
                    print(f"   around «{a.around}»: {snip!r}", flush=True)
            if "wasalt" in table:
                try:
                    from scrapers.common.cleanup import _wasalt_browser, _wasalt_browser_enabled
                    if _wasalt_browser_enabled():
                        data, _st, _n = _wasalt_browser().page_data(url)
                        for line in wasalt_fact_paths(data):
                            print(f"   wasalt key: {line}", flush=True)
                except Exception as e:  # noqa: BLE001 — a diagnostic never fails the re-read
                    print(f"   wasalt key probe failed: {e!r}", flush=True)
        out.append(item)

    text = json.dumps(out, ensure_ascii=False, indent=1, default=str)
    with open("reread.json", "w", encoding="utf-8") as f:
        f.write(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(f"### Source re-read: {len(out)} listing(s)\n\n")
            for it in out:
                f.write(f"- `{it['table']}:{it['id']}` status={it.get('status')} verdict={it.get('verdict')}\n")
    for it in out:
        print("\n".join(log_lines(it)), flush=True)
    print(f"re-read {len(out)} listing(s) → reread.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
