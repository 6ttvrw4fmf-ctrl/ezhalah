"""Azure — azure.sa. One operator's gated residential compounds (Riyadh + one in Jeddah), long-term
rent only. Onboarding 2026-09-24 (batch 36, group compounds-a).

SOURCE SHAPE (measured live 2026-09-24 on all 16 compound pages):
  · CATALOGUE: /sitemap.xml lists 47 URLs; 25 are under /compounds/, of which 16 are compound pages
    (/compounds/<slug>) and 9 are «/compounds/<slug>/units» sub-pages: the compound's own
    «Floorplans» page, repeating the SAME unit-type list and adding per-floorplan areas that are
    mostly RANGES («109-120 m²», «289-291 m²»). They are the same units, not more listings, so they
    are not enumerated (a floorplan range is not an area; attributing one to a unit type would be
    a guess — left for the owner, see the onboarding report). Server-rendered; no JS needed.
  · GRAIN: a compound page carries «Available Unit Types», two tab panels of the SAME list:
        data-tabs-content-id="paid-type-tab-annually"  → «2 Bedroom Apartment … from 125 000 SAR»
        data-tabs-content-id="paid-type-tab-monthly"   → «2 Bedroom Apartment … from 11 146 SAR/MONTH»
    Per the owner's compound-site decision, EACH UNIT TYPE is one listing: ad_number = "AZR" +
    compound slug + "-" + the unit type's key (its own name, slugified; a repeated name gets -2, -3),
    listing_url = the compound page.
  · PRICE / PERIOD: the annual panel sits under the source's own «Paid annually» tab label, so the
    figure is stored unconverted in price_annual with rent_period 'annual'. «from» is the source's
    word — it is a starting price, kept as additional_info.price_note="from" and in price_evidence.
    The monthly panel is an INSTALLMENT figure (11 146 × 12 = 133,752 ≠ 125 000): it is never
    stored as the price, only kept as additional_info.monthly_installment_raw. No nightly/daily
    prices exist anywhere on the site.
  · STATUS: the hero badge <p class="text-tiny text-center">Fully <br/>Leased</p> (wadi, takhassusi)
    and «Coming Soon» (palma-i) are the source's own status words: a fully-leased compound is
    «مؤجر» and a coming-soon one is off-plan — both skipped on sight, tallied fully_leased /
    coming_soon. galleria is retail/offices with no unit list → no_units.
  · CITY: stated in the page's own <title> / og:description / intro («Compound In Al Narjis,
    Riyadh», «… in Jeddah», «… location of Riyadh, KSA»). qassim's page says BOTH «Al Qassim» (a
    region) and «Riyadh» (wrong; its map pin is in Buraydah) — two candidate cities is ambiguous,
    so it is skipped city_ambiguous, never guessed. A district is written only when the title's own
    district name maps with certainty to a catalogued Arabic district of that city.
  · TYPE: from the unit's own name — Apartment, Villa, Studio, Townhouse→Villa (fleet override),
    Penthouse→Apartment, a bare «2 Bedroom Duplex» → Duplex. Measured type_unmapped x8 on the full
    walk: KAFD's bare «1/2/3 Bedroom» and «4 Bedroom Triplex» (4), Salamah's «3/4 Bedroom Rooftop
    with terrace» (2), and galleria's «Retail from 200 sqm» / «Offices from 500 sqm» (2 — areas, not
    prices, on a retail/office building). None is folded into a neighbour.
  · MEASURED 2026-09-24: 16 compounds → 32 unit-type rows (11 compounds), skips fully_leased x2
    (wadi, takhassusi), coming_soon x1 (palma-i), city_ambiguous x1 (qassim), type_unmapped x8.
  · FURNISHED: the unit-types block states «Fully furnished» once for the whole list → furnished
    True on that page's units; absent → NULL.
  · PHOTOS: gallery <source data-srcset="https://azure.sa/media/cache/compound_amenity_image_xxl/
    uploads/<n>/gallery_<i>_<ts>.webp"> — one size kept. Fetched one: HTTP 200 image/webp.
  · REMOVAL ORACLE (measured 2026-09-24): an unknown compound slug answers a REAL HTTP 404 with
    «The page is not found» (3/3: two invented slugs and wadi/units — the leased compound has no
    floorplan page); 16/16 real compounds and 9/9 existing /units pages → 200.
    A unit type is gone when its compound 404s, or when the compound is served and either carries
    the Fully Leased / Coming Soon badge or no longer lists that unit name. prune_unseen runs only
    after a COMPLETE enumeration with an in-run positive control that fails CLOSED; every removal is
    re-probed through the shared liveness law. Absence from the sitemap alone is never death.
    The unit key for that re-probe comes from the row's OWN stored listing_url (its slug), never
    from re-splitting the ad_number — a hyphenated slug (al-reem, palma-i, palma-ii) makes that
    split ambiguous (review fix, 2026-09-24).
  · LANGUAGE: English only (no hreflang, no /ar). PDPL: only the operator's own switchboard number
    appears on pages; descriptions are redacted anyway.
"""
from __future__ import annotations

import argparse
import html as ihtml
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe, stored_listing_url  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402

BASE = "https://azure.sa"
SOURCE = "Azure"
PREFIX = "AZR"
PAUSE = 1.0


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")
    s.headers.update({"Accept": "text/html,application/xhtml+xml", "Accept-Language": "ar,en;q=0.7"})
    return s


_CITY_EN_AR = {"riyadh": "الرياض", "jeddah": "جدة", "qassim": "القصيم", "khobar": "الخبر",
               "dammam": "الدمام"}
# Title district → Arabic, only where certain; still verified against the city's catalog.
_DISTRICT_EN_AR = {
    ("الرياض", "narjis"): "حي النرجس", ("الرياض", "qurtubah"): "حي قرطبة",
    ("الرياض", "qurtobah"): "حي قرطبة", ("الرياض", "safa"): "حي الصفا",
    ("الرياض", "wadi"): "حي الوادي", ("الرياض", "alwadi"): "حي الوادي",
    ("الرياض", "hittin"): "حي حطين", ("الرياض", "qairawan"): "حي القيروان",
    ("الرياض", "rabwah"): "حي الربوة", ("الرياض", "malqa"): "حي الملقا",
    ("الرياض", "yasmin"): "حي الياسمين", ("الرياض", "sahafah"): "حي الصحافة",
    ("جدة", "salamah"): "حي السلامة", ("جدة", "shati"): "حي الشاطئ",
}
_TYPE_WORDS = (("studio", "استوديو"), ("townhouse", "فيلا"), ("town house", "فيلا"),
               ("villa", "فيلا"), ("penthouse", "شقة"), ("apartment", "شقة"))


def plain(s: Optional[str]) -> str:
    return re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", (s or "").replace("&nbsp;", " ")))).strip()


def unit_type_ar(name: str) -> Optional[str]:
    low = name.lower()
    for word, ar in _TYPE_WORDS:
        if re.search(r"\b" + re.escape(word) + r"s?\b", low):     # «4 Bedroom Villas» (palma-ii)
            return ar
    return "دوبلكس" if re.search(r"\bduplex(?:es)?\b", low) else None


def unit_key(name: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", name.lower())).strip("-")


_PANEL_RE = re.compile(r'data-tabs-content-id="paid-type-tab-(annually|monthly)"[^>]*>(.*?)</ul>', re.S)
_ITEM_RE = re.compile(r'<li class="cmp-units__units-text[^"]*">(.*?)</li>', re.S)
# The name is the <p class="text-lead-xl"> text before its <br/> — wrapped in a <span> on some
# pages (wadi) and bare on others (al-reem); the options line is the cmp-units__units-inner span.
_NAME_RE = re.compile(r'<p class="text-lead-xl[^"]*"[^>]*>(.*?)(?:<br\s*/?>|</p>)', re.S)
_INNER_RE = re.compile(r'cmp-units__units-inner[^"]*">(.*?)</span>', re.S)
_BTN_RE = re.compile(r'btn__text\s*"?\s*>\s*(.*?)\s*</span>', re.S)
_ANNUAL_RE = re.compile(r"^\s*(from\s+)?([\d\s,]+?)\s*SAR\s*$", re.I)
_BADGE_RE = re.compile(r'<p class="text-tiny text-center">(.*?)</p>', re.S)
_BED_RE = re.compile(r"(\d+)\s*Bedroom", re.I)


def panels(page_html: str) -> dict[str, list[dict[str, str]]]:
    """{'annually': [{name, inner, price_raw}, …], 'monthly': […]} in document order."""
    out: dict[str, list[dict[str, str]]] = {}
    for kind, body in _PANEL_RE.findall(page_html):
        items = []
        for it in _ITEM_RE.findall(body):
            nm, inn, btn = _NAME_RE.search(it), _INNER_RE.search(it), _BTN_RE.search(it)
            items.append({"name": plain(nm.group(1)) if nm else "",
                          "inner": plain(inn.group(1)) if inn else "",
                          "price_raw": plain(btn.group(1)) if btn else ""})
        out.setdefault(kind, []).extend(items)
    return out


def annual_price(price_raw: str) -> tuple[Optional[int], Optional[str]]:
    """«from 125 000 SAR» → (125000, "from"); «125 000 SAR» → (125000, None); anything else
    (a /MONTH figure, empty) → (None, None)."""
    m = _ANNUAL_RE.match(price_raw or "")
    if not m:
        return None, None
    return normalize.to_int(re.sub(r"[\s,]", "", m.group(2))), ("from" if m.group(1) else None)


def status_badge(page_html: str) -> Optional[str]:
    m = _BADGE_RE.search(page_html)
    return plain(m.group(1)).lower() if m else None


def page_city(page_html: str) -> tuple[Optional[str], str]:
    """(city_ar, skip_reason). Exactly one distinct city word across the page's own title,
    og:description and intro paragraph; zero → no_city, two or more → city_ambiguous."""
    title = plain(" ".join(re.findall(r"<title>(.*?)</title>", page_html, re.S)))
    og = " ".join(re.findall(r'<meta (?:property|name)="(?:og:)?description" content="([^"]*)"', page_html))
    intro = plain(" ".join(re.findall(r'cmp-units__text[^"]*"[^>]*>(.*?)</p>', page_html, re.S)))
    words = {w.lower() for w in re.findall(r"\b(Riyadh|Jeddah|Qassim|Khobar|Dammam)\b",
                                           f"{title} {og} {intro}", re.I)}
    if not words:
        return None, "no_city"
    if len(words) > 1:
        return None, "city_ambiguous"
    return _CITY_EN_AR[words.pop()], ""


def page_district(page_html: str, city_ar: str, city_id: int) -> tuple[Optional[str], Optional[str]]:
    """(district_ar, raw_en) from the title's own «In <District>, <City>» / «In <X> Neighborhood»."""
    title = plain(" ".join(re.findall(r"<title>(.*?)</title>", page_html, re.S)))
    m = (re.search(r"\bIn (?:the )?([A-Z][A-Za-z\-]+(?: [A-Z][A-Za-z\-]+)?)(?: District)?, [A-Z]", title)
         or re.search(r"\bIn ([A-Z][A-Za-z\-]+) Neighborhood\b", title))
    if not m:
        return None, None
    raw = m.group(1).strip()
    key = re.sub(r"^(?:al|an|ar|as)[\s-]+", "", raw.lower().replace("-", " ")).strip()
    cand = _DISTRICT_EN_AR.get((city_ar, key))
    return (find_district_in_text(cand, city_id) if cand else None), raw


def photos(page_html: str) -> Optional[list[str]]:
    urls = [u for u in dict.fromkeys(re.findall(r'data-srcset="(https://azure\.sa/media/cache/[^"]+\.webp)"', page_html))
            if "_xxl/" in u or "_xl/" in u]
    return urls[:20] or None


def map_units(url: str, page_html: str) -> tuple[list[dict], str, dict[str, int]]:
    """Every unit type on one compound page as its own row.
    Returns (rows, page_skip_reason_if_no_rows, per-unit skip tally)."""
    badge = status_badge(page_html) or ""
    if "leased" in badge:
        return [], "fully_leased", {}
    if "coming" in badge:
        return [], "coming_soon", {}
    # ponytail: no third badge shape has ever been observed live (measured 2026-09-24: all 16
    # real pages -> None/"coming soon"/"fully leased" only); a bare "available" substring match
    # would also misfire on a positive badge like "2 Units Available". Add a real branch, with a
    # fixture, once such a badge is actually seen on the source.
    pan = panels(page_html)
    annual = pan.get("annually") or []
    if not annual:
        return [], "no_units", {}
    city_ar, why = page_city(page_html)
    if not city_ar:
        return [], why, {}
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return [], "city_not_in_catalog", {}
    district_ar, district_en = page_district(page_html, city_ar, city_id)
    monthly = pan.get("monthly") or []
    monthly_by_name = {m["name"]: m["price_raw"] for m in monthly} if len(monthly) == len(annual) else {}
    furnished = bool(re.search(r"Unit Types</i>.*?Fully furnished", page_html, re.S))
    slug = url.rstrip("/").split("/")[-1]
    name_h1 = re.search(r"<h1[^>]*>(.*?)</h1>", page_html, re.S)
    compound = plain(name_h1.group(1)) if name_h1 else None
    intro = plain(" ".join(re.findall(r'cmp-units__text[^"]*"[^>]*>(.*?)</p>', page_html, re.S))) or None
    pics = photos(page_html)

    rows: list[dict] = []
    skips: dict[str, int] = {}
    seen_keys: dict[str, int] = {}
    for u in annual:
        type_ar = unit_type_ar(u["name"])
        property_type = normalize.map_type_exact(type_ar) if type_ar else None
        if not property_type:
            skips["type_unmapped"] = skips.get("type_unmapped", 0) + 1
            continue
        amount, note = annual_price(u["price_raw"])
        key = unit_key(u["name"])
        seen_keys[key] = seen_keys.get(key, 0) + 1
        if seen_keys[key] > 1:
            key = f"{key}-{seen_keys[key]}"
        bm = _BED_RE.search(u["name"])
        row: dict[str, Any] = {
            "ad_number": f"{PREFIX}{slug}-{key}",
            "listing_url": url,
            "source": SOURCE,
            "active": True,
            "title": " – ".join(x for x in (compound, u["name"]) if x) or None,
            "description": redact_pii(intro) if intro else None,
            "property_type": property_type,
            "transaction_type": "Rent",
            "city": normalize.map_city(city_ar),
            "city_ar": city_ar,
            "city_id": city_id,
            "region_id": region_id,
            "district_ar": district_ar,
            "neighborhood": district_en,
            "bedrooms": normalize.to_int(bm.group(1)) if bm else None,
            "price_annual": amount,
            # The «Paid annually» tab is the source's own period word for this figure.
            "rent_period": "annual" if amount is not None else None,
            "photo_urls": pics,
            "price_evidence": normalize.price_evidence(
                field="paid-type-tab-annually btn__text", raw=u["price_raw"] or None,
                stored=amount, kind="annual", origin="structured"),
            "additional_info": {k: v for k, v in {
                "unit_type": u["name"], "unit_options": u["inner"] or None, "compound": compound,
                "price_note": note, "monthly_installment_raw": monthly_by_name.get(u["name"]),
            }.items() if v is not None},
        }
        if furnished:
            row["furnished"] = True
        # «Optional: Terrace, Backyard» is an OPTION the source offers, not a fact about the unit —
        # it is kept as text in additional_info.unit_options and never becomes an amenity column.
        rows.append(row)
    return rows, ("" if rows else "no_mappable_units"), skips


def fetch_compounds(s: cc.Session, limit: int = 0) -> list[str]:
    r = s.get(f"{BASE}/sitemap.xml", timeout=40)
    if r.status_code != 200:
        return []
    urls = sorted({u.rstrip("/") for u in re.findall(r"<loc>([^<]+)</loc>", r.text)
                   if re.match(rf"{re.escape(BASE)}/compounds/[a-z0-9\-]+/?$", u)})
    return urls[:limit] if limit else urls


# ── removal oracle (see the module header for the measurement) ───────────────────────────────────
def _unit_signal(candidate_keys: tuple[str, ...]):
    """candidate_keys tries the LITERAL (un-stripped) key first, falling back to the ordinal-
    stripped one — see key_of() for why both are needed: a unique unit whose own name ends in a
    bare number (e.g. "Villa 5" -> key "villa-5") is indistinguishable, by the ad_number string
    alone, from a write-time dedup suffix on a repeated name (e.g. two "Villa"s -> "villa-2").
    Stripping unconditionally reads the first case as "villa", which then matches NOTHING live
    on the page (the page's own key IS "villa-5") and falsely reports it gone."""
    def signal(status, body, _moved):
        if status in (404, 410):
            return "gone"
        if status != 200 or "paid-type-tab-annually" not in body and "cmp-units" not in body:
            return None
        badge = status_badge(body) or ""
        if "leased" in badge or "coming" in badge:
            return "gone"                       # the same status words the crawl skips on sight
        keys = [unit_key(u["name"]) for u in (panels(body).get("annually") or [])]
        if not keys:
            return None
        return "live" if any(c in keys for c in candidate_keys) else "gone"
    return signal


def _make_verify_gone(control: Optional[dict]):
    url_for = stored_listing_url(("azure_residential_listings",))

    def key_of(ad_number: str) -> Optional[str]:
        """Recover the unit's own key from its ad_number via the row's OWN stored listing_url —
        never by re-splitting the ad_number string. Both the compound slug and the unit key can
        contain hyphens (al-reem, palma-i, palma-ii), so a generic regex split cannot tell them
        apart and silently mis-extracts the key for every hyphenated-slug compound (found in
        review, 2026-09-24 — this is exactly the failure class verify_gone exists to prevent)."""
        url = url_for(ad_number)
        if not url:
            return None
        slug = url.rstrip("/").split("/")[-1]
        head = f"{PREFIX}{slug}-"
        if not ad_number.startswith(head):
            return None
        # The remainder may be a genuine unit key ending in a digit ("villa-5"), OR a genuine key
        # with a write-time dedup ordinal appended ("villa-2" for the second unit named "Villa").
        # Return BOTH candidates, literal first — _unit_signal tries the literal (correct for the
        # first case) before falling back to the stripped one (correct for the second).
        literal = ad_number[len(head):] or None
        stripped = re.sub(r"-\d+$", "", ad_number[len(head):]) or None
        if not literal:
            return ()
        return (literal,) if literal == stripped else (literal, stripped)

    def probe(ad_number: str, canary=None):
        keys = key_of(ad_number)
        if not keys:
            return "unknown", f"{ad_number!r} is not a {PREFIX}<compound>-<unit key> ad number"
        return LivenessProbe(platform="azure", signal=_unit_signal(keys), session=session,
                             url_for=url_for, canary=canary).verify_gone(ad_number)

    def canary() -> tuple[bool, str]:
        if not control:
            return False, "no row from this run to use as a positive control"
        verdict, why = LivenessProbe(
            platform="azure", signal=_unit_signal((unit_key(control["additional_info"]["unit_type"]),)),
            session=session, url_for=lambda _ad: control["listing_url"]).verify_gone(control["ad_number"])
        return verdict == "live", f"positive control {control['ad_number']}: {why}"

    return lambda ad_number: probe(ad_number, canary=canary)


def _tally(skipped: dict[str, int]) -> str:
    return ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("azure")
    res: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        urls = fetch_compounds(s, limit=args.limit)
        if not urls:
            raise RuntimeError("sitemap returned no /compounds/<slug> urls")
        print(f"{SOURCE}: {len(urls)} compounds discovered", flush=True)
        complete = True
        for u in urls:
            try:
                r = s.get(u, timeout=45)
            except Exception:  # noqa: BLE001
                skipped["unreachable"] = skipped.get("unreachable", 0) + 1
                complete = False
                continue
            if r.status_code != 200:
                skipped[f"http_{r.status_code}"] = skipped.get(f"http_{r.status_code}", 0) + 1
                complete = complete and r.status_code == 404
                continue
            rows, why, unit_skips = map_units(u, r.text)
            for k, v in unit_skips.items():
                skipped[k] = skipped.get(k, 0) + v
            if not rows:
                skipped[why] = skipped.get(why, 0) + 1
            for row in rows:
                db.mark_direct_alive(row, oracle="azure.compound_page.unit_type_list")
            res.extend(rows)
            time.sleep(PAUSE)
        notes = _tally(skipped)
        if skipped:
            print("  skipped (not guessed): " + notes)
        if args.type == "commercial":
            res = []          # compounds are residential by definition on this source
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} unit types (nothing written)")
            for r0 in res[:40]:
                print(f"   {r0['ad_number']:38} {str(r0['property_type']):10} {str(r0['city_ar']):8} "
                      f"d={str(r0['district_ar'])[:12]:12} bd={str(r0['bedrooms']):>3} "
                      f"pa={r0.get('price_annual')} rp={r0.get('rent_period')} "
                      f"f={r0.get('furnished')} ph={len(r0.get('photo_urls') or [])}")
            return 0
        # Public upsert_azure_*_batch wrappers are added centrally later; same shared writer.
        db._wasalt_batch("azure_residential_listings", res)
        superseded = db.retire_superseded_siblings(
            res_table="azure_residential_listings", com_table="azure_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads=set(), source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s)")
        pruned = 0
        if args.type == "all" and complete:
            n = db.prune_unseen("azure_residential_listings", {r["ad_number"] for r in res},
                                source=SOURCE, verify_gone=_make_verify_gone(res[0] if res else None))
            if n < 0:
                print("  ⚠ prune guard tripped — kept existing active rows")
            else:
                pruned = n
        elif args.type == "all":
            print("  ⚠ enumeration incomplete (unreachable/5xx pages) — prune skipped")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(urls), rows_upserted=len(res),
                             notes=f"pruned={pruned} {notes}"[:300],
                             check_tables=["azure_residential_listings",
                                           "azure_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} unit types upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                       notes=(f"{e}"[:250] + " | skips: " + (_tally(skipped) or "none"))[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
