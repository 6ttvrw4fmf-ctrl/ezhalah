"""SuperOffice («سوبر أوفيس», superoffice.sa) — a Riyadh serviced-office operator. Onboarding 2026-09-27
(owner: «yeah lets add it» — the AVAILABLE private offices only). Rewritten 2026-10-29 for the new site.

SOURCE SHAPE (measured live 2026-10-29 — the site was rebuilt on Next.js around 2026-10-28)
==========================================================================================
The old Laravel site is gone: /sitemap.xml now 301s to /sitemap/pages.xml (no office pages), so every
run from 10-28 read 0 rows. The new site:
  · /sitemap/offices.xml lists the branches' service pages, among them
    /branch/<branch>/private-office for al-aarid, as-suwaidi, al-rawdah (al-narjis has none yet).
    Only «مكاتب خاصة» (private-office) carries individual coded offices; every other service
    (coworking, virtual office, meeting rooms, parking, warehouse …) is a priced SERVICE with no unit
    identity on the page → out of scope, as before.
  · each branch page server-renders, inside its RSC payload (self.__next_f.push), the office list's
    first window: {"units":[{id, code, branchSlug, branchNameAr, areaSqm, photoUrl, termPrices[], status
    "AVAILABLE"}…], "totalCount": 51, "hasMore": true}. That window is the 8 cheapest AVAILABLE offices
    («51 من 1066 متاح في السويدي»). Measured totals: al-aarid 18, as-suwaidi 51, al-rawdah 168.
  · every office has its own page /branch/<branch>/unit/<code> (404 for a code that does not exist,
    404 under the wrong branch) carrying a schema.org Product JSON-LD whose
    offers.availability is InStock for a free office and OutOfStock for a booked one, plus the
    office's own address line («السويدي، الدريهمية، الرياض 12791»), the «ما الذي يشمله» list and the
    description.

WHY ONLY THE SERVER-RENDERED WINDOW (robots.txt)
------------------------------------------------
«عرض المزيد» loads the rest from /api/office-listing?service=private-office&offset=N&limit=8, and the
site's robots.txt says `Disallow: /api`. This fleet never calls a path robots.txt disallows
(scrapers/razre, wahadat, arkaan), so the crawl reads only the server-rendered pages: the window per
branch + /services/private-office. An office the window stopped showing is NOT gone — its own page is
read (below) and only that page may retire it. Whether to read the API is an owner decision.

TRAPS
-----
1. ONLY an AVAILABLE office whose OWN page says InStock is a listing. A booked office reads OutOfStock.
2. PRICE = SOURCE, PERIOD = SOURCE: the single-period term the site prices («شهري», MONTH×1 — else
   YEAR×1) is the price; it is VAT-inclusive, the figure the card prints («1,118 ريال شهريًا»).
   to_int truncates halalas (1358.5 → 1,358); the shared rent_period_from_ad reads the term's own label
   (monthly → stored ×12, the fleet convention). Multi-month bundles (3/6/12 months, 5-year contract)
   are kept in additional_info, never used as the rent.
3. DISTRICT comes from the office's own address line, one «،» part at a time; road/building parts are
   skipped («طريق الملك عبدالعزيز» is not the district الملك عبدالعزيز). The line opens with the BRANCH
   label («السويدي، الدريهمية، …»): that part is read only when no other part names a district (العارض's
   line names only العارض).
4. `areaSqm` (0.55-4.45 for offices priced 906-3,161 a month) is not a floor area anyone can rent by →
   area_m2 NULL; the raw figure is kept in additional_info.
5. The photo is the JSON-LD `image` when the office has its own, else the card photo the site shows.
6. PDPL: the 920 number and info@ address are the company's switchboard in the page chrome — never read.

LIVENESS
--------
Each office's own page is read during the crawl → db.mark_direct_alive. Removal: prune_unseen and,
when its guard refuses, strike_read_gone, both with read_own_page as the oracle:
  · new office (SPO-<branch>-<code>): 404/410 or OutOfStock → gone; InStock → live; else unknown.
  · old office (SPO<old slug>, the 28 rows of the old site): its old /ar/office-details/<slug> URL
    answering 301/308 to a CATEGORY page (/branch/<b>/<service> or /services/<service>) → gone — the
    site itself retired the page (an unknown slug answers 404, so the redirect is a deliberate mapping);
    404/410 → gone; anything else (200, a redirect to a /unit/ page, 403, 5xx, timeout) → unknown.
A "gone" counts only after an office this crawl saw reads live the same way (control).
"""
from __future__ import annotations

import argparse
import html as ihtml
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urljoin, urlparse

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http import retry_smarter_session  # noqa: E402
from scrapers.common.pii import redact_capture, redact_pii, strip_pii_fields  # noqa: E402

BASE = "https://superoffice.sa"
SOURCE = "سوبر أوفيس"
PREFIX = "SPO"
SLUG = "superoffice"
CITY_AR = "الرياض"          # every branch is in Riyadh; the address line must still name it
SERVICE = "private-office"
SITEMAP = f"{BASE}/sitemap/offices.xml"
DIRECT_ALIVE_ORACLE = "superoffice.unit_page.jsonld_offer_availability"

_BRANCH_RE = re.compile(r"<loc>https://superoffice\.sa/branch/([a-z0-9-]+)/private-office</loc>")
_PUSH_RE = re.compile(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)')
_LDJSON_RE = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)
_ROAD_RE = re.compile(r"(طريق|شارع|المبنى|مبنى)\b")
# a CATEGORY page the old office URLs now redirect to — never a /unit/ page
_CATEGORY_PATH_RE = re.compile(r"^/(?:ar/|en/)?(?:branch/[a-z0-9-]+/[a-z0-9-]+|services/[a-z0-9-]+)/?$")


class Gone(Exception):
    pass


def get(s: cc.Session, url: str) -> str:
    for attempt in range(3):
        try:
            r = s.get(url, timeout=40)
            if r.status_code in (404, 410):
                raise Gone(url)
            r.raise_for_status()
            return r.text
        except Gone:
            raise
        except Exception:  # noqa: BLE001
            if attempt == 2:
                raise
            time.sleep(2 + attempt * 3)
    return ""


def _text(s: str) -> str:
    return re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def ad_number_for(branch: str, code: str) -> str:
    return f"{PREFIX}-{branch}-{code}"


def unit_url(branch: str, code: str) -> str:
    return f"{BASE}/branch/{branch}/unit/{code}"


def split_ad_number(ad_number: str) -> Optional[tuple[str, str]]:
    """SPO-<branch>-<code> → (branch, code); None for an old-site ad number (SPO<slug>)."""
    if not ad_number.startswith(PREFIX + "-"):
        return None
    branch, _, code = ad_number[len(PREFIX) + 1:].rpartition("-")
    return (branch, code) if branch and code and re.fullmatch(r"[A-Za-z0-9]+", code) else None


# ── list pages ───────────────────────────────────────────────────────────────────────────────────
def branches_from_sitemap(xml: str) -> list[str]:
    return list(dict.fromkeys(_BRANCH_RE.findall(xml or "")))


def _flight(page: str) -> str:
    """The page's RSC payload: every self.__next_f.push([1,"…"]) string, decoded and joined."""
    return "".join(json.loads(m.group(1)) for m in _PUSH_RE.finditer(page or ""))


def parse_listing_page(page: str) -> dict[str, Any]:
    """The office list the page server-renders: {"units": [...], "totalCount", "hasMore"}.
    Raises ValueError when the page carries no private-office list (an unreadable page, not an empty one)."""
    t = _flight(page)
    i = t.find('"serviceSlug":"private-office"')
    j = t.find('"initial":{"units":', i if i >= 0 else 0)
    if i < 0 or j < 0:
        raise ValueError("no private-office list in the page payload")
    obj, _ = json.JSONDecoder().raw_decode(t, j + len('"initial":'))
    if not isinstance(obj, dict) or not isinstance(obj.get("units"), list):
        raise ValueError("office list is not a {units: [...]} object")
    return obj


# ── an office's own page ─────────────────────────────────────────────────────────────────────────
def _product_ld(page: str) -> Optional[dict]:
    for m in _LDJSON_RE.finditer(page or ""):
        try:
            d = json.loads(m.group(1))
        except ValueError:
            continue
        if isinstance(d, dict) and d.get("@type") == "Product":
            return d
    return None


def _breadcrumb_label(page: str, url: Optional[str]) -> Optional[str]:
    """The office's own label as the site prints it («H-19»): its BreadcrumbList item for this URL."""
    for m in _LDJSON_RE.finditer(page or ""):
        try:
            d = json.loads(m.group(1))
        except ValueError:
            continue
        if isinstance(d, dict) and d.get("@type") == "BreadcrumbList":
            for it in d.get("itemListElement") or []:
                if isinstance(it, dict) and url and str(it.get("item") or "").rstrip("/") == url.rstrip("/"):
                    return str(it.get("name") or "").strip() or None
    return None


def parse_unit_page(page: str) -> dict[str, Any]:
    ld = _product_ld(page) or {}
    offer = ld.get("offers") if isinstance(ld.get("offers"), dict) else {}
    avail = str(offer.get("availability") or "").rsplit("/", 1)[-1] or None
    img = ld.get("image")
    addr = re.search(r">العنوان</h2>\s*<p[^>]*>(.*?)</p>", page or "", re.S)
    inc = re.search(r">ما الذي يشمله</h2>\s*<ul[^>]*>(.*?)</ul>", page or "", re.S)
    desc = re.search(r">الوصف</h2>\s*<p[^>]*>(.*?)</p>", page or "", re.S)
    return {
        "url": ld.get("url") or offer.get("url"),
        "name": ld.get("name"),
        "label": _breadcrumb_label(page, ld.get("url") or offer.get("url")),
        "description": _text(desc.group(1)) if desc else (ld.get("description") or ""),
        "price": offer.get("price"),
        "availability": avail,
        "images": [x for x in (img if isinstance(img, list) else [img] if img else []) if isinstance(x, str)],
        "address": _text(addr.group(1)) if addr else None,
        "includes": [x for x in (_text(li) for li in re.findall(r"<li[^>]*>(.*?)</li>", inc.group(1), re.S))
                     if x] if inc else [],
    }


def _single_period_term(unit: dict) -> Optional[dict]:
    terms = [t for t in unit.get("termPrices") or [] if isinstance(t, dict)
             and t.get("durationCount") == 1 and t.get("price")]
    for kind in ("MONTH", "YEAR"):
        for t in terms:
            if t.get("unitType") == kind:
                return t
    return None


def _district(addr: str, city_id, branch_ar: Optional[str]) -> Optional[str]:
    parts = [p.strip() for p in addr.split("،")
             if p.strip() and CITY_AR not in p and not _ROAD_RE.match(p.strip())]
    for use in ([p for p in parts if p != branch_ar], parts):
        hits = {find_district_in_text(p, city_id) for p in use} - {None}
        if hits:
            return hits.pop() if len(hits) == 1 else None   # two districts named → ambiguous → NULL
    return None


def map_unit(unit: dict, page: dict) -> tuple[Optional[tuple[dict, str]], str]:
    branch, code = unit.get("branchSlug") or "", unit.get("code") or ""
    if not branch or not code:
        return None, "no_branch_or_code"
    if unit.get("status") != "AVAILABLE":
        return None, f"status_{unit.get('status') or 'none'}"
    url = unit_url(branch, code)
    if (page.get("url") or "").rstrip("/") != url:      # the page must be THIS office (the sanadak lesson)
        return None, "page_is_not_this_office"
    if page.get("availability") != "InStock":
        return None, f"page_{page.get('availability') or 'no_availability'}"
    term = _single_period_term(unit)
    if not term:
        return None, "no_single_period_price"
    ptype = normalize.map_type_exact("مكتب")
    label = f"مكتب {page.get('label') or code}"          # «مكتب H-19», as the card prints it
    price_text = f"{term['price']} ريال {term.get('labelAr') or ''}".strip()
    price = normalize.to_int(str(term["price"]))
    if not price or price <= 0:
        return None, "no_price"
    period, annual = normalize.rent_period_from_ad(price, price_text, None, label)

    addr = page.get("address") or ""
    if CITY_AR not in addr:
        return None, "city_not_in_address"
    city_id, region_id = to_catalog(CITY_AR)
    district_ar = _district(addr, city_id, unit.get("branchNameAr")) if city_id else None
    includes = page.get("includes") or []
    row: dict[str, Any] = {
        "ad_number": ad_number_for(branch, code),
        "listing_url": url,
        "source": SOURCE,
        "active": True,
        "title": redact_pii(label) or None,
        "description": redact_pii((page.get("description") or "")[:4000]) or None,
        "property_type": ptype,
        "transaction_type": "Rent",
        "city": normalize.map_city(CITY_AR),
        "city_ar": CITY_AR,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_ar,
        "area_m2": None,
        "license_number": None,
        "photo_urls": list(dict.fromkeys(page.get("images") or ([unit["photoUrl"]] if unit.get("photoUrl") else []))),
        "rent_period": period,
        "price_annual": annual,
    }
    for item in includes:
        row.update(normalize.amenities_from_text(item))
    if any(i.startswith("مؤثث") for i in includes):     # «مؤثث بالكامل وجاهز للاستخدام»
        row["furnished"] = True
    row["price_evidence"] = normalize.price_evidence(
        field="termPrices[MONTH×1].price" if term.get("unitType") == "MONTH" else "termPrices[YEAR×1].price",
        raw=price_text, stored=annual, kind="annual", unit="total", origin="html")
    info = {
        "source_unit_id": unit.get("id"),
        "unit_code": code,
        "branch": unit.get("branchNameAr"),
        "branch_slug": branch,
        "space_kind_ar": "مكاتب خاصة",
        "address_ar": addr or None,
        "price_text": price_text,
        "term_prices": [{"label_ar": t.get("labelAr"), "price": t.get("price")}
                        for t in unit.get("termPrices") or [] if isinstance(t, dict)] or None,
        "source_area_sqm_raw": unit.get("areaSqm"),
        "includes_ar": includes or None,
    }
    row["additional_info"] = redact_capture(strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [], {})}))
    row["source_capture"] = redact_capture(strip_pii_fields({"schema": "superoffice.next.v2", "unit": {
        k: unit.get(k) for k in ("id", "code", "branchSlug", "areaSqm", "status", "startingPrice")},
        "page": {k: page.get(k) for k in ("url", "name", "price", "availability", "address")}}))
    db.mark_direct_alive(row, oracle=DIRECT_ALIVE_ORACLE)
    return (row, normalize.category_for_type(ptype).lower()), ""


# ── Own-page oracle ──────────────────────────────────────────────────────────────────────────────
def read_own_page(s, ad_number: str) -> tuple[str, str]:
    """One office's own page. New office: 404/410 or OutOfStock → gone, InStock → live. Old-site office:
    its old URL redirecting to a category page (or 404/410) → gone. Anything else → unknown."""
    if not ad_number.startswith(PREFIX):
        return "unknown", f"{ad_number!r} is not a {PREFIX} ad number"
    parts = split_ad_number(ad_number)
    url = unit_url(*parts) if parts else f"{BASE}/ar/office-details/{ad_number[len(PREFIX):]}"
    try:
        r = s.get(url, timeout=40, allow_redirects=False)
    except Exception as e:  # noqa: BLE001 — a failed fetch is UNKNOWN
        return "unknown", f"fetch failed: {type(e).__name__}"
    code = r.status_code
    if code in (404, 410):
        return "gone", f"HTTP {code}"
    if not parts:
        if code in (301, 308):
            loc = (getattr(r, "headers", None) or {}).get("location") or (
                getattr(r, "headers", None) or {}).get("Location") or ""
            target = urlparse(urljoin(url, loc))
            if target.netloc in ("superoffice.sa", "www.superoffice.sa") and _CATEGORY_PATH_RE.match(target.path):
                return "gone", f"old office page HTTP {code} → category {target.path}"
            return "unknown", f"old office page HTTP {code} → {loc or 'no location'}"
        return "unknown", f"old office page HTTP {code}"
    if code != 200:
        return "unknown", f"HTTP {code}"
    page = parse_unit_page(r.text or "")
    if (page.get("url") or "").rstrip("/") != url:
        return "unknown", f"page is not this office (url {page.get('url')!r})"
    if page.get("availability") == "OutOfStock":
        return "gone", "offer availability OutOfStock (booked)"
    if page.get("availability") == "InStock":
        return "live", "offer availability InStock"
    return "unknown", f"offer availability {page.get('availability')!r}"


def make_verify_gone(s, control_ads) -> Any:
    """verify_gone: "gone" only after an office this run saw reads live the same way."""
    controls = sorted(a for a in control_ads if split_ad_number(a))[:3]
    memo: list[tuple[bool, str]] = []

    def control() -> tuple[bool, str]:
        if not memo:
            res = (False, "no office seen this run to use as control")
            for ad in controls:
                v, why = read_own_page(s, ad)
                if v == "live":
                    res = (True, f"control {ad} reads live")
                    break
                res = (False, f"control {ad}: {v} ({why})")
            memo.append(res)
        return memo[0]

    def verify_gone(ad_number: str) -> tuple[str, str]:
        v, why = read_own_page(s, ad_number)
        if v != "gone":
            return v, why
        ok, cwhy = control()
        return ("gone", f"{why}; {cwhy}") if ok else ("unknown", f"{why}, but {cwhy}")
    return verify_gone


def prune_table(tbl: str, seen: set, verify_gone) -> int:
    """Absence only nominates: every kill needs the office's own page to read gone (verify_gone at
    grace). When the guard refuses (-1) — the first run after the rebuild re-sees none of the 28 old
    rows — strike only ads whose own page reads gone, within the collapse cap."""
    n = db.prune_unseen(tbl, seen, source=SOURCE, verify_gone=verify_gone)
    if n < 0:
        print(f"  ⚠ {tbl}: prune guard tripped — reading the unseen offices' own pages", flush=True)
        n = db.strike_read_gone(tbl, seen, SOURCE, verify_gone=verify_gone)
    return n


def collect_units(s, branches: list[str]) -> tuple[dict[str, dict], dict[str, int], int]:
    """Every office the server-rendered pages show, keyed by ad number; (units, totals per branch, unreadable)."""
    units: dict[str, dict] = {}
    totals: dict[str, int] = {}
    unreadable = 0
    pages = [(b, f"{BASE}/branch/{b}/{SERVICE}") for b in branches] + [(None, f"{BASE}/services/{SERVICE}")]
    for branch, url in pages:
        try:
            lst = parse_listing_page(get(s, url))
        except Exception as e:  # noqa: BLE001
            print(f"  ✗ {url}: {type(e).__name__}: {e}", flush=True)
            unreadable += 1
            continue
        if branch:
            totals[branch] = int(lst.get("totalCount") or 0)
        for u in lst["units"]:
            if isinstance(u, dict) and u.get("branchSlug") and u.get("code"):
                units.setdefault(ad_number_for(u["branchSlug"], u["code"]), u)
        time.sleep(0.3)
    return units, totals, unreadable


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    # 3 browser profiles DIRECT, then the residential proxy when the job has it (owner 10-05:
    # every crawler on the shared resilient path; backlog 63). The session owns the profile.
    s, tried = retry_smarter_session(BASE, timeout=40)
    print(f"  route: {' · '.join(tried)}", flush=True)
    branches = branches_from_sitemap(get(s, SITEMAP))
    print(f"{SOURCE}: {len(branches)} branch private-office page(s) on its sitemap: {branches}", flush=True)
    units, totals, unreadable = collect_units(s, branches) if branches else ({}, {}, 1)
    print(f"  {len(units)} office(s) in the server-rendered windows; site totals {totals} "
          f"(the rest load from /api, which robots.txt disallows)", flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        for ad, u in units.items():
            try:
                page = parse_unit_page(get(s, unit_url(u["branchSlug"], u["code"])))
            except Gone:
                skipped["gone_404"] = skipped.get("gone_404", 0) + 1
                continue
            except Exception:  # noqa: BLE001
                unreadable += 1
                continue
            got, why = map_unit(u, page)
            if not got:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            row, cat = got
            (com if cat == "commercial" else res).append(row)
            time.sleep(0.3)
        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items())), flush=True)
        if dry:
            print(f"DRY: {len(res)} residential + {len(com)} commercial ({unreadable} unreadable)")
            for row in res + com:
                print("   ", json.dumps({k: row.get(k) for k in
                      ("ad_number", "property_type", "price_annual", "rent_period", "district_ar", "furnished")},
                      ensure_ascii=False)[:260], len(row["photo_urls"]))
            return 0

        db.upsert_superoffice_residential_batch(res)
        db.upsert_superoffice_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="superoffice_residential_listings", com_table="superoffice_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        # Every page read → the windows are what the site serves today. An office outside them is only a
        # candidate; read_own_page decides (grace 3, collapse cap, control).
        complete = unreadable == 0 and len(branches) > 0
        verify_gone = make_verify_gone(s, {r["ad_number"] for r in res + com})
        for tbl, rr in (("superoffice_residential_listings", res), ("superoffice_commercial_listings", com)):
            if rr and complete:
                n = prune_table(tbl, {r["ad_number"] for r in rr}, verify_gone)
                if n > 0:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print(f"  NOT pruning: {unreadable} page(s) unreadable", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(units), rows_upserted=len(res) + len(com),
                             check_tables=["superoffice_residential_listings", "superoffice_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(units), rows_upserted=0, notes=str(e)[:300])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
