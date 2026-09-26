"""شركة المربعات العقارية (Squares) — squares.com.sa. WordPress, onboarding 2026-09-26.

SOURCE SHAPE (measured live 2026-09-26 over all 18 posts before any code was written)
======================================================================================
Plain WordPress with a `property` custom post type exposed on the public REST API:

    GET /wp-json/wp/v2/property?per_page=100&_embed=1   → the WHOLE catalogue in one page

`X-WP-Total: 18` is the source's own declared count and it matched the 18 rows returned, so one
GET is a complete enumeration and prune_unseen may run after it (the same self-declaring
completeness contract qmra uses).

*** THIS SOURCE PUBLISHES NO PRICE. *** Checked on the REST payload AND by rendering a detail page:
there is no price field, no price element, and only 3 of 18 descriptions mention a number in prose
at all. price_total/price_annual therefore stay unset and `price_evidence.found` is false — the
honest "never stated", exactly as on qmra. Nothing is inferred from the prose numbers, which are
plot dimensions and street widths as often as they are money.

TYPE COMES FROM THE POST'S OWN TERM ID, NOT FROM DOCUMENT ORDER. The REST payload carries
`class_list` with the authoritative per-post `property_type-<id>`, but the taxonomy REST routes are
closed (`rest_no_route`) so the id cannot be resolved to a name through the API. The detail page
DOES render the term as a link, but it renders sidebar/related links too — 34 type links across 18
pages — so scraping "the type on the page" would sometimes take a neighbour's. Measured, the FIRST
`property_type` link on a page is always the post's own (141→محل, 174→مول, 138→عمارة, 177→مزرعة,
136→فيلا on four separate posts), so this scraper builds an id→name map from those first links and
then resolves every post through its OWN class_list id. Document order is used to LEARN the map,
never to decide an individual listing.

LOCATION IS PROSE-DERIVED, and the source does state it: every title names a district
(«محلات تجارية بحي النسيم للبيع», «فيلا بحي الخليج للبيع», «مزرعة في حي هيث للبيع»). The
`property_city` term ids exist in class_list (114 ×14, 144 ×2, 154 ×1) but their names are NOT
resolvable — the taxonomy routes are closed and `?taxonomy=…&term_id=…` serves the homepage — so
the city is read from the text with the fleet's own find_district_in_text/to_catalog, never from an
unresolvable id. A listing whose location cannot be resolved keeps city_id/region_id NULL and is
simply not production_ready, which is the honest outcome.

*** DEAL IS READ FROM THE LISTING'S OWN TITLE, NOT FROM THE STATUS LINK. *** Learning the status
term the same first-link way produced a WRONG MAP: it put term 89 and term 90 both on «للبيع»,
because on the single rent post a sidebar sale link came first. That would have published this
source's one rental as a sale — a deal error, the worst kind. Every title states the deal in the
source's own words (measured 17 «للبيع» / 1 «للإيجار», 18 of 18), and that reading agrees exactly
with the authoritative per-post class_list term (90 on all 17 Buy, 89 on the 1 Rent). So the title
decides, the term id is kept as an independent cross-check, and a post whose two signals DISAGREE
is skipped and counted rather than guessed.
"""
from __future__ import annotations

import argparse
import html as ihtml
import json
import re
import sys
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, resolve_slug, to_catalog  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

BASE = "https://squares.com.sa"
LIST = f"{BASE}/wp-json/wp/v2/property"
SOURCE = "شركة المربعات العقارية"
PREFIX = "SQR"
SLUG = "squares"
IMPERSONATE = "chrome"
TIMEOUT = 40

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")
# The authoritative per-post status terms, measured 2026-09-26 against every title (18/18 agree):
# 90 appears on all 17 «للبيع» posts, 89 on the single «للإيجار» post.
_STATUS_DEAL = {"90": "Buy", "89": "Rent"}

_TYPE_LINK = re.compile(r'href="[^"]*/property_type/[^/"]+/?"[^>]*>([^<]{1,40})<')
_STATUS_LINK = re.compile(r'href="[^"]*/property_status/[^/"]+/?"[^>]*>([^<]{1,40})<')


def _clean(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    return _WS.sub(" ", _TAG.sub(" ", ihtml.unescape(s))).strip() or None


def _term_id(rec: dict, tax: str) -> Optional[str]:
    """The post's OWN term id for `tax`, from class_list — the authoritative per-post value."""
    for c in rec.get("class_list") or []:
        if c.startswith(f"{tax}-"):
            return c.split("-", 1)[1]
    return None


def fetch_catalogue(s: cc.Session) -> tuple[list[dict], Optional[int]]:
    r = s.get(f"{LIST}?per_page=100&_embed=1", impersonate=IMPERSONATE, timeout=TIMEOUT)
    r.raise_for_status()
    declared = r.headers.get("X-WP-Total") or r.headers.get("x-wp-total")
    return r.json(), (int(declared) if declared and declared.isdigit() else None)


def deal_from_title(title: str) -> Optional[str]:
    """Buy/Rent from the source's own title wording, or None if it states neither."""
    t = title or ""
    if "للإيجار" in t or "للايجار" in t:
        return "Rent"
    if "للبيع" in t:
        return "Buy"
    return None


def learn_type_map(s: cc.Session, rows: list[dict]) -> tuple[dict[str, str], dict[str, str]]:
    """(type_id→name, status_id→name) learned from each post's FIRST taxonomy link.

    See the module docstring: the first link is measurably the post's own. Learning a map and then
    resolving each post by its own class_list id means a page whose sidebar happens to come first
    can only corrupt the LEARNED NAME for that one id — which the caller can see — rather than
    silently mislabel that one listing.
    """
    tmap: dict[str, str] = {}
    smap: dict[str, str] = {}
    for rec in rows:
        tid, sid = _term_id(rec, "property_type"), _term_id(rec, "property_status")
        if (tid and tid in tmap) and (sid and sid in smap):
            continue
        link = rec.get("link")
        if not link:
            continue
        try:
            page = s.get(link, impersonate=IMPERSONATE, timeout=TIMEOUT).text
        except Exception:  # noqa: BLE001
            continue
        if tid and tid not in tmap:
            m = _TYPE_LINK.search(page)
            if m:
                tmap[tid] = _clean(m.group(1)) or ""
        if sid and sid not in smap:
            m = _STATUS_LINK.search(page)
            if m:
                # the rendered anchor sometimes carries a stray leading letter; keep the suffix
                v = _clean(m.group(1)) or ""
                smap[sid] = "للإيجار" if "إيجار" in v or "ايجار" in v else ("للبيع" if "بيع" in v else v)
    return tmap, smap


def map_listing(rec: dict, ptype_ar: str, deal: str) -> tuple[dict[str, Any], str]:
    pid = str(rec.get("id"))
    ptype = normalize.map_type_exact(ptype_ar)
    category = normalize.category_for_type(ptype).lower() if ptype else "residential"
    title = redact_pii(_clean((rec.get("title") or {}).get("rendered")) or "")
    body = _clean((rec.get("content") or {}).get("rendered")) or ""

    # The source states the location in its own words. resolve_slug is the fleet's DETERMINISTIC,
    # catalog-VALIDATED parse: it returns confidence='unresolved' rather than guessing, so a
    # listing whose city does not validate simply keeps NULLs and is not production_ready.
    # (An earlier draft of this scraper hardcoded الرياض as the only city it would try, which
    # silently mislocated «شقة مفروشة في درة العروس» — not a Riyadh property at all.)
    text = f"{title} {body}"
    loc = resolve_slug(text)
    city_ar = loc.get("city_ar")
    city_id = loc.get("city_id")
    region_id = loc.get("region_id")
    district_ar = loc.get("district_ar")
    if city_id and not district_ar:
        district_ar = find_district_in_text(text, city_id)

    photos = []
    for m in ((rec.get("_embedded") or {}).get("wp:featuredmedia") or []):
        u = m.get("source_url")
        if u:
            photos.append(u)

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}",
        "listing_url": rec.get("link"),
        "source": SOURCE,
        "active": True,
        "title": title or None,
        "description": redact_pii(body) or None,
        "property_type": ptype,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar) if city_ar else None,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "date_added": _clean(rec.get("date")),
        "photo_urls": photos or None,
    }
    # NO PRICE FIELD EXISTS ON THIS SOURCE — see the docstring. found=False says no price field was
    # ever read; authoritative_absent stays False because the source never states an explicit null.
    row["price_evidence"] = normalize.price_evidence(
        field=None, raw=None, stored=None,
        kind="total" if deal == "Buy" else "annual", unit="total", origin="api",
        authoritative_absent=False)
    row["images_evidence"] = {"observed": True, "container_present": bool(rec.get("featured_media")),
                              "key_present": bool(photos), "count": len(photos)}
    info = {
        "source_id": pid,
        "type_ar": ptype_ar,
        "type_term_id": _term_id(rec, "property_type"),
        "status_term_id": _term_id(rec, "property_status"),
        "city_term_id": _term_id(rec, "property_city"),   # kept raw: its NAME is not resolvable
        "modified": _clean(rec.get("modified")),
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v is not None})
    row["source_capture"] = strip_pii_fields({"schema": "squares.wp-v2-property.v1",
                                              "id": rec.get("id"), "slug": rec.get("slug"),
                                              "class_list": rec.get("class_list")})
    return row, category


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    s = cc.Session()
    rows, declared = fetch_catalogue(s)
    if a.limit:
        rows = rows[: a.limit]
    print(f"{SOURCE}: {len(rows)} posts (X-WP-Total={declared})", flush=True)
    tmap, smap = learn_type_map(s, rows)
    print(f"  learned {len(tmap)} type term(s), {len(smap)} status term(s)", flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        for rec in rows:
            tid = _term_id(rec, "property_type")
            ptype_ar = tmap.get(tid or "")
            if not ptype_ar:
                skipped[f"type_unresolved_{tid}"] = skipped.get(f"type_unresolved_{tid}", 0) + 1
                continue
            if not normalize.map_type_exact(ptype_ar):
                skipped[f"type_unmapped_{ptype_ar}"] = skipped.get(f"type_unmapped_{ptype_ar}", 0) + 1
                continue
            title = _clean((rec.get("title") or {}).get("rendered")) or ""
            deal = deal_from_title(title)
            if deal is None:
                skipped["deal_unstated_in_title"] = skipped.get("deal_unstated_in_title", 0) + 1
                continue
            # Independent cross-check against the post's own status term. They agreed 18/18 when
            # measured; a disagreement means one of the two readings is wrong and neither may be
            # trusted, so the listing is skipped rather than published under a guessed deal.
            sid = _term_id(rec, "property_status")
            by_term = _STATUS_DEAL.get(sid or "")
            if by_term and by_term != deal:
                k = f"deal_conflict_title_{deal}_vs_term_{by_term}"
                skipped[k] = skipped.get(k, 0) + 1
                continue
            row, cat = map_listing(rec, ptype_ar, deal)
            (com if cat == "commercial" else res).append(row)

        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items())), flush=True)
        if dry:
            print(f"DRY: {len(res)} residential + {len(com)} commercial")
            for row in (res[:3] + com[:2]):
                print("   ", json.dumps({k: row.get(k) for k in
                      ("ad_number", "property_type", "transaction_type", "city_ar",
                       "district_ar", "listing_url")}, ensure_ascii=False)[:190])
            return 0

        db.upsert_squares_residential_batch(res)
        db.upsert_squares_commercial_batch(com)
        for tbl, rr in (("squares_residential_listings", res),
                        ("squares_commercial_listings", com)):
            if rr:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE,
                                    reason="absent from the complete wp/v2/property catalogue")
                if n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        db.end_run(run_id, ok=True, rows_seen=len(rows), rows_upserted=len(res) + len(com))
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(rows), rows_upserted=0, error=str(e)[:500])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
