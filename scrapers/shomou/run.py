"""مكتب شموع العقار (shomoalaqar.com.sa) — a single-office Al-Ahsa brokerage on Drupal 8. Onboarding
2026-09-28 (owner: «yes build the 155» — the ads still inside their OWN end date).

SOURCE SHAPE (measured live 2026-09-28 over the whole catalogue, not sampled)
============================================================================
Same Drupal theme family as Bossbih (`field_nw_al_qar`, `field-als-r`, "Designed by AQEEL"), so the
price-label vocabulary, the Al-Ahsa district resolver and the type overrides are Bossbih's, imported.
  Index  `/?field_nw_al_qar_value=All&page=N` — a Views TABLE, 40 rows/page, 26 pages, 1,028 nids. Row
         links flip between `/N` and `/index.php/N` (page 0 vs the rest, same trap as Bossbih).
  Detail `/N` — ONE `<article data-history-node-id="N">` of `div.text-right.h1|h2` lines, in order:
         type · سكنية/تجارية · [صك/جاهز/عوائل] · deal · «المنطقة: الشرقية» · «المحافظة: الأحساء» ·
         «في <district>» · «المساحة N م» · «شارع N» · «واجهة العقار: X» · … · description · price LABEL
         · `<div content="14000">14,000 ريال</div>` · `<time datetime>` = «تاريخ إنتهاء الإعلان».

TRAPS
-----
1. THE AD'S OWN END DATE. The office never takes an ad down: 835 of 1,028 were past «تاريخ إنتهاء
   الإعلان» (the field ≈ ad date + 3 months), 155 in date, 38 carry a build year / Hijri date typed into
   that field. Only normalize.ad_expiry_state() == 'live' becomes a row; 'expired' and 'unknown' are
   skipped and counted, and the next crawl's seen-set prunes an ad the day its date passes.
2. The page carries OTHER listings below the article (a «related» table with their prices) and a
   district PLAN image («مخطط», files/2018-12/) that is not a photo. Everything is read from inside
   `<article>` only, and the article's node id must equal the nid asked for.
3. PRICE = SOURCE by LABEL (Bossbih's PRICE_LABELS, per-m² first): «المتر» → price_per_meter, never
   multiplied (no site total is printed here); «السعر/السوم/الحد» → total; «على السوم» is an invitation
   to bid — its placeholder figure (0 or 1) is NOT a price.
4. PERIOD = SOURCE: the price never states one. The shared rent_period_from_ad (owner 2026-09-26 order:
   the ad's own words tied to THIS price → ≤10,000 SAR looks monthly → else unstated) decides; 136 of
   143 rents stay period-NULL (owner 2026-09-21: they stay out of yearly/monthly rent searches).
5. CITY: the article states «المحافظة: الأحساء» — a governorate. Stored at that grain («الاحساء»),
   never a guessed town; the district name is matched against each Al-Ahsa town's catalog pool.
6. «رقم الترخيص 2100000432» and the FAL number are identical on EVERY page — the office's licence, not
   a per-ad licence → license_number stays NULL; both kept in additional_info.
7. PDPL: agent names, phones and an email are in the page chrome — never read. Description → redact_pii.

    python -m scrapers.shomou.run --dry-run      # zero DB writes
    python -m scrapers.shomou.run --type all     # full crawl + prune
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

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.bossbih.run import (  # noqa: E402  same theme, same town: one vocabulary, not two
    DWELLING_TYPES, LOCAL_SUBSTRING_TYPES, OFFICE_CITY_AR, REGION_HINT, RETIRED_TOKENS, TYPE_OVERRIDES,
    TYPE_UNMAPPABLE, _BED_RE, _area, _counts, _price_basis, resolve_district,
)
from scrapers.common import db, normalize as N  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.pii import redact_capture, redact_pii  # noqa: E402

BASE = "https://shomoalaqar.com.sa"
SOURCE = "Shomou"          # English slug; never «…Alaqar»: the app's fallback source token is 'aqar'
PREFIX = "SHQ"              # SHM is shmoualshmal's
SLUG = "shomou"
RES_TABLE = "shomou_residential_listings"
COM_TABLE = "shomou_commercial_listings"
MAX_PAGES = 60              # safety stop; the catalogue is 26 pages
PAUSE = 0.4

_NID_RE = re.compile(r'href="/(?:index\.php/)?(\d+)"')
_ARTICLE_RE = re.compile(r'<article data-history-node-id="(\d+)".*?</article>', re.S)
_DIV_RE = re.compile(r'<div( content="[\d.]+")? class="text-right h([12])">(.*?)</div>\s*(?=<div|<span|</div>|<ul)', re.S)
_END_RE = re.compile(r'<time datetime="([\d-]{10})')
_ALERT_RE = re.compile(r'class="alert alert-info">(.*?)</div>', re.S)
_IMG_RE = re.compile(r'(?:src|href)="((?:https://shomoalaqar\.com\.sa)?/sites/default/files/(?!2018-12/)[^"]+\.(?:jpe?g|png|webp))"', re.I)
_DEALS = {"للبيع": "Buy", "للايجار": "Rent", "للإيجار": "Rent"}
_TYPES = ("أرض", "شقة", "محل", "عمارة", "بيت", "فيلا", "دبلكس", "مزرعة", "استراحة")


def _text(fragment: str) -> str:
    t = re.sub(r"<br\s*/?>", " ", fragment or "")
    return re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", t))).strip()


def get(s: cc.Session, url: str) -> Optional[str]:
    for attempt in range(3):
        try:
            r = s.get(url, impersonate="chrome", timeout=40)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.text
        except Exception:  # noqa: BLE001
            if attempt == 2:
                raise
            time.sleep(2 + attempt * 3)
    return None


def parse_index(page: str) -> list[str]:
    body = page[page.find("<tbody>"):page.find("</tbody>")]
    return list(dict.fromkeys(_NID_RE.findall(body)))


def parse_detail(nid: str, page: str) -> Optional[dict[str, Any]]:
    """Everything the ad's own article publishes, verbatim. None if the page is not node `nid`."""
    m = _ARTICLE_RE.search(page)
    if not m or m.group(1) != nid:
        return None
    art = m.group(0)
    divs, levels, price, price_label, description = [], [], None, None, None
    for content, level, frag in _DIV_RE.findall(art):
        txt = _text(frag)
        if content:
            price = N.to_int(content.split('"')[1])
            price_label = divs[-1] if divs else None
            # the prose is the h2 line right before the label — never the floor line or a short tag
            prev = divs[-2] if len(divs) >= 2 and levels[-2] == "2" else ""
            description = prev if len(prev) >= 15 and not prev.startswith("الدور") else None
            continue
        divs.append(txt)
        levels.append(level)
    alert = _text(_ALERT_RE.search(page).group(1)) if _ALERT_RE.search(page) else ""
    end = _END_RE.search(art)
    title = re.search(r'<span property="schema:name" content="([^"]*)"', art)
    photos = [u if u.startswith("http") else BASE + u for u in dict.fromkeys(_IMG_RE.findall(art))]
    return {
        "nid": nid, "title": _text(title.group(1)) if title else None, "divs": divs, "price": price, "price_label": price_label,
        "description": description, "end_date": end.group(1) if end else None, "photos": photos,
        "office_licence": (re.search(r"رقم الترخيص:?\s*(\d+)", alert) or [None, None])[1],
        "fal_license": (re.search(r"فال\s*(\d+)", alert) or [None, None])[1],
        "posted": (re.search(r"(\d\d/\d\d/\d{4})", alert) or [None, None])[1],
    }


def _field(divs: list[str], prefix: str) -> Optional[str]:
    v = next((d[len(prefix):].strip(" :") for d in divs if d.startswith(prefix)), None)
    return v or None


def map_detail(d: dict[str, Any], today: Any = None) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason). row is None exactly when the source leaves it unpublishable."""
    divs = d["divs"]
    end_state = N.ad_expiry_state(d.get("end_date"), today)
    if end_state != "live":
        return None, "residential", f"ad_end_date_{end_state}"
    head = divs[:10]
    if any(tok in " ".join(divs) for tok in RETIRED_TOKENS):
        return None, "residential", "retired_or_auction"
    typ = next((x for x in head if x in _TYPES), None)
    cls = next((x for x in head if x in ("سكنية", "تجارية")), None)
    phrase = f"{typ or ''} {cls or ''}".strip()
    if not typ or any(tok in phrase for tok in TYPE_UNMAPPABLE):
        return None, "residential", "type_unmapped"
    ptype = N.map_type(phrase, TYPE_OVERRIDES) or next((t for tok, t in LOCAL_SUBSTRING_TYPES if tok in phrase), None)
    if not ptype:
        return None, "residential", "type_unmapped"
    category = N.category_for_type(ptype).lower()
    deal = next((_DEALS[x] for x in head if x in _DEALS), None)
    if not deal:
        return None, category, "no_deal_stated"
    transaction_type = "Rent" if deal == "Rent" else "Buy"

    gov = _field(divs, "المحافظة")
    district_raw = _field(divs, "في")
    if gov in ("الأحساء", "الاحساء", None):
        city_ar = OFFICE_CITY_AR
        city_id, region_id = to_catalog(city_ar, region_hint=REGION_HINT)
        district_ar = resolve_district(district_raw)
    else:                                   # the article names another governorate (1 row: الدمام)
        city_ar = gov
        city_id, region_id = to_catalog(gov, region_hint=REGION_HINT)
        district_ar = find_district_in_text(district_raw, city_id) if city_id and district_raw else None
    if not city_id:
        return None, category, "city_not_in_catalog"

    label, basis, kind = _price_basis(d.get("price_label"))
    amount = d.get("price") if label != "على السوم" else None   # an invitation to bid, not a figure
    amount = amount if amount and amount > 0 else None
    price_total = price_annual = price_per_meter = rent_period = None
    if amount and basis == "per_sqm":
        price_per_meter = amount            # never × area here (search layer derives the ≈ total)
    elif amount and basis == "total" and transaction_type == "Rent":
        rent_period, price_annual = N.rent_period_from_ad(amount, d.get("description"), None, phrase)
        if not rent_period:
            price_annual = amount           # unstated period: stored unconverted (fleet convention)
    elif amount and basis == "total":
        price_total = amount

    description = d.get("description")
    services = _field(divs, "الخدمات المتعلقة بالعقار") or ""
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{d['nid']}",
        "listing_url": f"{BASE}/{d['nid']}",
        "source": SOURCE,
        "active": True,
        "title": redact_pii(d.get("title")) or None,
        "description": redact_pii(description),
        # «الخدمات المتعلقة بالعقار: كهرباء وماء» — the source says YES; silence stays NULL, never False
        "electricity": True if "كهرباء" in services else None,
        "water_supply": True if re.search(r"ماء|مياه", services) else None,
        "property_type": ptype,
        "transaction_type": transaction_type,
        "city": N.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": _area(next((x for x in divs if x.startswith("المساحة")), "")),
        "bedrooms": (_counts(description, _BED_RE, {"غرفتين": 2, "غرفتان": 2, "غرفتي": 2, "غرفة": 1, "غرفه": 1})
                     if ptype in DWELLING_TYPES else None),
        "bathrooms": None,
        "street_width_m": N.one_street_width(_field(divs, "شارع") or ""),
        "direction": N.one_direction(_field(divs, "واجهة العقار")),
        "license_number": None,
        "price_total": price_total,
        "price_annual": price_annual,
        "price_per_meter": price_per_meter,
        "rent_period": rent_period,
        "photo_urls": d.get("photos") or [],
        "additional_info": redact_capture({k: v for k, v in {
            "price_label": label, "price_basis": basis, "price_kind": kind,
            "price_amount_raw": d.get("price"), "type_ar": phrase, "ad_end_date": d.get("end_date"),
            "posted_or_bumped": d.get("posted"), "governorate_ar": gov,
            "plot_plan": _field(divs, "رقم المخطط"), "advertiser_capacity": _field(divs, "صفة المعلن"),
            "services_ar": services or None, "office_licence": d.get("office_licence"),
            "fal_license": d.get("fal_license"), "city_basis": "source_states_governorate",
        }.items() if v not in (None, "")}),
        "source_capture": redact_capture({"schema": "shomou.article.v1", "nid": d["nid"], "divs": divs[:40],
                                          "price_attr": d.get("price"), "end_date": d.get("end_date")}),
    }
    row["price_evidence"] = N.price_evidence(
        field="article div[content]", raw=f"{d.get('price_label') or ''} {d.get('price') or ''}".strip(),
        stored=price_total or price_annual or price_per_meter,
        kind="per_meter" if price_per_meter else ("annual" if price_annual else "total"),
        unit="per_meter" if price_per_meter else "total", origin="html", authoritative_absent=False)
    return row, category, ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    s = cc.Session()

    nids: list[str] = []
    for page in range(MAX_PAGES):
        html = get(s, f"{BASE}/?field_nw_al_qar_value=All&page={page}") or ""
        got = [n for n in parse_index(html) if n not in nids]
        if not got:
            break
        nids += got
        time.sleep(PAUSE)
    if a.limit:
        nids = nids[:a.limit]
    print(f"{SOURCE}: {len(nids)} ad(s) on its index", flush=True)

    run_id = None if a.dry_run else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    unreadable = 0
    try:
        for nid in nids:
            try:
                page = get(s, f"{BASE}/{nid}")
                d = parse_detail(nid, page) if page else None
            except Exception:  # noqa: BLE001
                d = None
            if not d:
                unreadable += 1
                continue
            row, cat, why = map_detail(d)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
            else:
                (com if cat == "commercial" else res).append(row)
            time.sleep(PAUSE)
        print("  skipped (never guessed): " + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items())), flush=True)
        if a.dry_run:
            print(f"DRY: {len(res)} residential + {len(com)} commercial ({unreadable} unreadable)")
            for row in (res + com)[:15]:
                print("   ", json.dumps({k: row.get(k) for k in ("ad_number", "property_type", "transaction_type",
                      "price_total", "price_annual", "price_per_meter", "rent_period", "district_ar", "area_m2")},
                      ensure_ascii=False))
            return 0

        db.upsert_shomou_residential_batch(res)
        db.upsert_shomou_commercial_batch(com)
        db.retire_superseded_siblings(res_table=RES_TABLE, com_table=COM_TABLE, res_ads={r["ad_number"] for r in res},
                                      com_ads={r["ad_number"] for r in com}, source=SOURCE)
        # Complete walk only: an expired ad is on the index but not in the kept set → pruned today.
        complete = unreadable == 0 and len(nids) > 0 and not a.limit
        for tbl, rr in ((RES_TABLE, res), (COM_TABLE, com)):
            if complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print(f"  NOT pruning: {unreadable} of {len(nids)} page(s) unreadable", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(nids), rows_upserted=len(res) + len(com),
                             check_tables=[RES_TABLE, COM_TABLE])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(nids), rows_upserted=0, notes=str(e)[:300])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
