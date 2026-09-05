"""Rawasi Dark Real Estate (rawasi-dark.com / رواسي دارك العقارية) — Eastern-Province brokerage.

WHAT THE SITE IS. A single licensed Saudi broker (REGA/FAL chrome: رقم رخصة فال 1200003456,
رخصة هيئة العقار 1200042221) publishing its own SALE-ONLY catalog at /properties. Small and real:
101 listings across 7 cities, concentrated in الدمام (55) / الأحساء (31) / الخبر (11).

EXTRACTION MECHANISM. Next.js App Router, server-rendered. Each catalog page ships its 10 listing
objects as JSON inside the RSC flight payload — `self.__next_f.push([1,"<json string>"])` — so a
plain HTTPS GET with a normal desktop UA is sufficient: no browser, no cookies, no JS, no API.
We concatenate the unescaped flight chunks in document order and brace-match every `{"id":"…}`
object that carries a `statusText` key. Pagination is `?page=N`, 1-indexed, 10 per page; an
out-of-range page returns HTTP 200 with ZERO objects, so the stop condition is "0 objects", never
a status code. Detail pages (`/properties/{id}`) re-emit NO JSON and render the price in
Arabic-Indic digits with U+066C separators — they are never read for a canonical field; the
catalog integer is the only clean price path. A fabricated id 404s, which is the per-listing
liveness oracle.

REALNESS EVIDENCE (verified live 2026-09-02, 12 catalog fetches). 101 unique cuids, 0 duplicated
across pages; 97 unique titles, 100 unique descriptions; 65 distinct districts (البادية، القزاز،
العدامة، حرض، الهفوف، شاطئ نصف القمر، ضاحية الملك فهد …); prices 515,000 → 120,000,000 SAR;
areas 200 → 4,590,000 m²; createdAt spread 2026-04 → 2026-07 with updatedAt as fresh as
2026-09-03. No lorem, no demo rows, no seeded repeats. robots.txt is a 404 (nothing disallowed);
no CAPTCHA, no bot wall, no rate limiting observed — every hit is an origin render
(`x-vercel-cache: MISS`), so the crawl is deliberately slow.

WHAT THIS SOURCE DOES NOT PUBLISH — and therefore stays NULL, always:
  bedrooms, bathrooms  — absent from the schema. 39/101 descriptions mention غرف and 19/101 mention
                         دورات مياه, as PROSE only. Mining prose into a filterable field is banned.
  rent price / period  — 101/101 statusText == «للبيع». ZERO rent inventory. The only «إيجار»
                         strings in the corpus are rental-yield notes inside free text; deal is
                         pinned to statusText and is never derived from a description.
  price_per_meter      — the source publishes a TOTAL and nothing else. Never derived from it.
  property age, furnishing, coordinates, per-listing ad licence — the two licence numbers on the
                         site are page chrome printed on every page (and they disagree with each
                         other), so no listing gets one.

  python -m scrapers.rawasidark.run --type all --limit 15 --dry-run   # validate: prints rows, ZERO writes
  python -m scrapers.rawasidark.run --type all --limit 15             # validation upsert, NO prune
  python -m scrapers.rawasidark.run --type all                        # full crawl + prune
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from typing import Any, Optional

from curl_cffi import requests as cc

from scrapers.common import normalize as N

BASE = "https://www.rawasi-dark.com"
SOURCE = "Rawasi Dark"
MAX_PAGES = 60          # hard stop; today's catalog is 11 pages. Guards a pagination bug, not the site.
THROTTLE_S = 2.5        # origin-rendered on every hit, single-broker site — stay slow.

# The RSC sentinels this payload uses. `$undefined` is a real JSON string meaning "no value";
# `$D` prefixes an ISO date. Both must be decoded, never stored verbatim.
RSC_UNDEFINED = "$undefined"

# Per-platform EXACT-match type overrides (contract: normalize.map_type_exact). Only the four
# labels the shared Arabic map cannot resolve correctly on its own. Every value is an EXISTING
# canonical type — nothing new is invented here:
#   «عمارة تجارية» — the shared map's substring pass reads the «عمارة» inside it and returns
#       Building (residential). The source says تجارية, so it is the canonical Commercial Building.
#   «محطة وقود»   — same station the shared map already knows as «محطة بنزين» → Gas Station.
#   «تاون هاوس»   — the fleet-wide Townhouse fold (TYPE_MAP_EN 'Townhouse': 'Villa').
#   «شقق مفروشة»  — resolves to Apartment by substring anyway; pinned so a future map edit can't
#       silently move it. Furnishing itself is NOT captured as a field (the source has no such flag).
TYPE_OVERRIDES = {
    "عمارة تجارية": "Commercial Building",
    "محطة وقود": "Gas Station",
    "تاون هاوس": "Villa",
    "شقق مفروشة": "Apartment",
}

# One city (1 listing) the shared Arabic map has no key for. The value is NOT a new judgment: the
# shared CITY_MAP_EN already folds 'Al Aflaj' → 'As Sulayyil' fleet-wide, so this reuses the
# existing decision rather than minting a second answer for the same town.
CITY_OVERRIDES = {"الأفلاج": "As Sulayyil"}

# The source's own deal vocabulary. Anything outside this map is QUARANTINED (row skipped, loudly)
# rather than guessed — this source is 101/101 sale, and a rent value appearing here means the
# catalog changed and the sale-only assumption must be re-verified before ingest.
DEAL_MAP = {"للبيع": "Buy"}

# ── PDPL: strip broker phones and contact CTAs from user-visible text (same shape as october) ──
_PHONE = re.compile(r"(?:\+?9665\d{7,}|\b0?5\d{8}\b|\b9[02]0\d{6,}\b|\b800\d{6,}\b|wa\.me/\S+|"
                    r"https?://chat\.whatsapp\.com/\S+)")
_CUT = re.compile(r"(للتواصل|للحجز|للاستفسار|اتصل|تواصل|واتساب|وتساب|واتس|جوال|الجوال|المعلن|الوسيط|"
                  r"المسوق|اسم المعلن|رقم الجوال|hotline|whatsapp|call us|"
                  # This source appends a fixed broker contact BANNER to 68/101 ad bodies:
                  # «🏢 مكتب رواسي دارك العقارية» then «📞 للتواصل …» + the phone + a WhatsApp
                  # group invite. Truncating at «للتواصل» alone left the office header and a
                  # dangling ☎ emoji on 67 user-visible descriptions — a contact CTA is still a
                  # contact CTA once its digits are gone. Cut at the banner's FIRST marker.
                  r"مكتب رواسي|📞|📱|☎)", re.I)


def _redact(text: Optional[str]) -> Optional[str]:
    """Truncate at the first contact CTA, then sweep any phone/WhatsApp link that survived."""
    if not text:
        return None
    m = _CUT.search(text)
    if m:
        text = text[:m.start()]
    text = _PHONE.sub(" ", text)
    text = re.sub(r"[ \t]+", " ", re.sub(r"\n{3,}", "\n\n", text)).strip()
    # The cut lands mid-ornament («———\n\n🏢 » before «مكتب رواسي»), so drop the trailing run of
    # non-word characters it leaves behind. \w is Unicode here, so Arabic letters and digits are
    # never touched — only dividers, emoji and punctuation that were leading INTO the CTA.
    return re.sub(r"\W+$", "", text).strip() or None


def _session() -> cc.Session:
    return cc.Session(impersonate="chrome124", timeout=30)


# ── RSC flight payload → listing objects ─────────────────────────────────────────────────────────
_PUSH = re.compile(r'self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\s*\]\)')


def _flight(html: str) -> str:
    """Concatenate the page's RSC flight chunks, in document order, unescaped.

    Each chunk is a JSON *string literal*, so json.loads() is the correct un-escaper — a manual
    replace of \\" would mangle real backslashes inside descriptions.
    """
    out = []
    for lit in _PUSH.findall(html):
        try:
            out.append(json.loads(lit))
        except Exception:
            continue
    return "".join(out)


def _objects(flight: str) -> list[dict]:
    """Every balanced `{"id":"…"}` object in the flight text that carries a `statusText` key.

    Brace-matching (rather than a regex) because descriptions contain braces, quotes and escapes;
    the scanner tracks string state and backslash escapes so it stops at the listing's OWN closing
    brace. The `statusText` requirement is what separates a listing from the other id-bearing
    objects Next.js emits (routing/segment metadata).
    """
    out: list[dict] = []
    i = 0
    while True:
        start = flight.find('{"id":"', i)
        if start < 0:
            return out
        i = start + 1
        depth = 0
        in_str = False
        esc = False
        for k in range(start, len(flight)):
            c = flight[k]
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif in_str:
                in_str = c != '"'
            elif c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    try:
                        obj = json.loads(flight[start:k + 1])
                        if isinstance(obj, dict) and "statusText" in obj:
                            out.append(obj)
                    except Exception:
                        pass
                    break


def _val(o: dict, key: str):
    """A raw field, with the RSC `$undefined` sentinel decoded to None."""
    v = o.get(key)
    return None if v == RSC_UNDEFINED else v


def _date(v) -> Optional[str]:
    """`$D2026-07-22T00:21:34.815Z` → the ISO8601 string. Non-`$D` values pass through."""
    if not isinstance(v, str) or not v:
        return None
    return v[2:] if v.startswith("$D") else v


def _photos(o: dict) -> list[str]:
    """Real gallery URLs only.

    30/101 listings have `images: []` and `imageUrl: "/images/logo.png"` — the site's own
    "no photo" placeholder, which is the brokerage logo and not a picture of the property. It is
    dropped, so a photoless listing stays honestly photoless.
    """
    imgs = o.get("images")
    urls = [u for u in imgs if isinstance(u, str) and u.startswith("http")] if isinstance(imgs, list) else []
    if urls:
        return urls
    single = o.get("imageUrl")
    return [single] if isinstance(single, str) and single.startswith("http") else []


def _positive_int(v) -> Optional[int]:
    """The source encodes an UNPUBLISHED number as 0 (price on 1 listing, area on 5).

    Those are not real zeros — they are silence — so they become None, which the upsert guard then
    drops rather than writing NULL over a value a previous crawl read. Shipping them as 0 would be
    the NULL→0 display regression already on record.
    """
    n = N.to_int_numeric(v)
    return n if n and n > 0 else None


def map_object(o: dict) -> Optional[tuple[dict, str]]:
    """One catalog object → (row, category). None when the row must be quarantined."""
    pid = (o.get("id") or "").strip()
    status = (o.get("statusText") or "").strip()
    raw_type = (o.get("type") or "").strip()
    if not pid or not raw_type:
        return None

    deal_token = DEAL_MAP.get(status)
    if deal_token is None:
        print(f"⚠ quarantined {pid}: unmapped statusText {status!r} — deal is never guessed", flush=True)
        return None

    # Provably TOTAL for the null-deal guard (scrapers/common/tests/test_deal_mapping_total.py):
    # a NULL transaction_type is dropped by the search-sync eligibility filter, so that lint
    # requires the written value to be provably "Buy"/"Rent" by AST. The quarantine directly
    # above already returned for every non-canonical deal, so this re-expression cannot change
    # behaviour — it only makes the totality the guard enforces visible to the linter.
    transaction_type = "Rent" if deal_token == "Rent" else "Buy"

    property_type = N.map_type(raw_type, TYPE_OVERRIDES)
    if not property_type:
        print(f"⚠ quarantined {pid}: unmapped type {raw_type!r} — no canonical label invented", flush=True)
        return None
    category = N.category_for_type(property_type)

    raw_city = (o.get("city") or "").strip()
    # `location` is always "city، district" (verified 101/101). The district is taken as PUBLISHED —
    # canonicalization happens downstream; the card shows the source's own text.
    loc = (o.get("location") or "")
    district = loc.split("،", 1)[1].strip() if "،" in loc else None
    city = N.map_city(raw_city, CITY_OVERRIDES)

    raw_price = o.get("price")
    price_total = _positive_int(raw_price)
    street_width = N.to_int_numeric(_val(o, "streetWidth"))

    # Complete source payload, once: every raw key exactly as published (dates de-sentinelled so
    # they are readable), so a field we don't map today never needs a re-scrape. `userId` is empty
    # on 101/101 and is the only identity-shaped key; it is dropped rather than stored.
    #
    # PDPL, capture half: the ad body is scrubbed of CONTACT IDENTIFIERS ONLY (the broker's phone
    # and its WhatsApp group invite — the shared redact_capture() catches wa.me/api.whatsapp.com
    # but not `chat.whatsapp.com/<invite>`, which appears on 68/101 of this source's rows).
    # Everything else survives byte-identical — licence and registry numbers, parcel/plan numbers,
    # areas, prices, dimensions — because destroying regulatory or structured data to fix a privacy
    # bug is not a fix, and no future field is ever derived from a group invite link.
    capture = {
        "schema": "rawasidark.catalog.v1",
        **{k: v for k, v in o.items() if k not in ("userId", "createdAt", "updatedAt", "description")},
        "description": _PHONE.sub(" ", o.get("description") or "") or None,
        "createdAt": _date(o.get("createdAt")),
        "updatedAt": _date(o.get("updatedAt")),
    }

    # additional_info uses the whitelisted-key object shape the result card renders.
    info: dict[str, Any] = {"status_ar": status, "type_ar": raw_type}
    if district:
        info["district_ar"] = district
    if street_width:                      # 62/101 publish it; the rest say `$undefined` → omitted
        info["street_width"] = street_width

    row = {
        "ad_number": pid,                 # the source's own stable cuid, and the detail URL segment
        "listing_url": f"{BASE}/properties/{pid}",
        "source": SOURCE,
        "active": True,
        "property_type": property_type,
        "transaction_type": transaction_type,
        "city": city,
        "region": N.region_for_city(city),
        "neighborhood": district,
        "area_m2": _positive_int(o.get("area")),
        # NOT PUBLISHED by this source in any structured field — prose is never mined for them.
        "bedrooms": None,
        "bathrooms": None,
        # PRICE = SOURCE: the catalog integer is a TOTAL sale price. This source publishes no
        # per-metre rate and no rent, so those stay NULL — never derived from the total or the area.
        "price_total": price_total,
        "price_annual": None,
        "price_per_meter": None,
        "rent_period": None,
        "photo_urls": _photos(o),
        "title": _redact(o.get("title")),
        "description": _redact(o.get("description")),
        "additional_info": info,
        "source_capture": capture,
        "price_evidence": N.price_evidence(
            field="rsc.catalog.price", raw=raw_price, stored=price_total,
            kind="total", unit="total", origin="structured",
        ),
    }
    return row, category


def crawl(limit: int = 0) -> tuple[list[dict], list[dict], int]:
    """Walk /properties?page=N until a page yields zero objects. Returns (residential, commercial, seen)."""
    s = _session()
    seen_ids: set[str] = set()
    res: list[dict] = []
    com: list[dict] = []
    for page in range(1, MAX_PAGES + 1):
        try:
            r = s.get(f"{BASE}/properties?page={page}")
        except Exception as e:
            raise RuntimeError(f"page {page} fetch failed: {e}") from e
        if r.status_code != 200:
            raise RuntimeError(f"page {page} returned HTTP {r.status_code}")
        objs = _objects(_flight(r.text))
        if page == 1 and not objs:
            # FAIL LOUD. Extraction rides on Next.js flight internals; a silent empty sweep would
            # read as "every listing delisted" and hand prune_unseen a catalog-wipe.
            raise RuntimeError("page 1 yielded 0 listing objects — RSC payload shape changed")
        if not objs:
            break
        for o in objs:
            pid = (o.get("id") or "").strip()
            if not pid or pid in seen_ids:
                continue
            seen_ids.add(pid)
            mapped = map_object(o)
            if not mapped:
                continue
            row, cat = mapped
            (com if cat == "Commercial" else res).append(row)
            if limit and len(res) + len(com) >= limit:
                return res, com, len(seen_ids)
        # The ONLY stop condition is "0 objects" (checked at the top of the loop). A short page must
        # NEVER end the sweep: one unparseable object would truncate the catalog mid-way, and a
        # truncated sweep is what hands prune_unseen a "seen" set that reads as mass delisting. The
        # same trap fires if the site ever changes its page size. One extra HTTP request buys that.
        time.sleep(THROTTLE_S)
    return res, com, len(seen_ids)


_SELFTEST_HTML = (
    '<script>self.__next_f.push([1,"a:[{\\"id\\":\\"c1\\",\\"title\\":\\"ارض\\",'
    '\\"location\\":\\"الدمام، البادية\\",\\"price\\":0,\\"area\\":483,'
    '\\"streetWidth\\":\\"$undefined\\",\\"type\\":\\"عمارة تجارية\\",'
    '\\"imageUrl\\":\\"/images/logo.png\\",\\"statusText\\":\\"للبيع\\",'
    '\\"createdAt\\":\\"$D2026-07-22T00:21:34.815Z\\",\\"updatedAt\\":\\"$D2026-09-03T02:39:45.216Z\\",'
    '\\"userId\\":\\"\\",\\"city\\":\\"الدمام\\",'
    '\\"description\\":\\"ركنية {نافذ} 6 م\\\\nللتواصل 0562263857\\",\\"images\\":[]}]"])</script>'
)


def _selftest() -> int:
    """Offline asserts on the fragile pure logic — the brace matcher, the sentinels, the invariants."""
    objs = _objects(_flight(_SELFTEST_HTML))
    assert len(objs) == 1, objs                       # brace-matched past the braces INSIDE the description
    row, cat = map_object(objs[0])
    assert row["ad_number"] == "c1"
    assert row["listing_url"].endswith("/properties/c1")
    assert row["price_total"] is None                 # price 0 is silence, never a stored 0
    assert row["area_m2"] == 483
    assert row["bedrooms"] is None and row["bathrooms"] is None
    assert row["price_annual"] is None and row["rent_period"] is None and row["price_per_meter"] is None
    assert row["neighborhood"] == "البادية" and row["city"] == "Dammam"
    assert row["region"] == "Eastern Province"
    assert row["photo_urls"] == []                    # the logo placeholder is not a photo
    assert "street_width" not in row["additional_info"]   # $undefined → omitted, never 0
    assert "0562263857" not in (row["description"] or "") and "للتواصل" not in (row["description"] or "")
    assert row["property_type"] == "Commercial Building" and cat == "Commercial"
    assert row["source_capture"]["createdAt"] == "2026-07-22T00:21:34.815Z"
    assert "userId" not in row["source_capture"]
    assert row["source_capture"]["price"] == 0                       # raw value preserved verbatim
    assert "0562263857" not in row["source_capture"]["description"]  # capture carries no contact PII
    assert "ركنية" in row["source_capture"]["description"]           # …and loses nothing else
    assert map_object({**objs[0], "statusText": "للإيجار"}) is None   # unmapped deal → quarantine
    # PDPL: the whole broker banner goes, not just its digits — header, ☎ marker and invite link.
    banner = ("ارض على شارع 20\n———\n🏢 مكتب رواسي دارك العقارية\n\n📞 للتواصل (اتصال / واتساب):\n"
              "0562263857 – بوعبدالعزيز\nhttps://chat.whatsapp.com/BatwDEe1EaHF3dx9YmGFcE")
    assert _redact(banner) == "ارض على شارع 20", repr(_redact(banner))
    print("✓ rawasidark self-test passed")
    return 0


def _print_rows(rows: list[dict], as_json: bool) -> None:
    for r in rows:
        if as_json:
            print(json.dumps(r, ensure_ascii=False, default=str))
            continue
        print("  ", {k: r.get(k) for k in (
            "ad_number", "property_type", "transaction_type", "city", "region",
            "neighborhood", "area_m2", "bedrooms", "price_total", "price_annual", "rent_period")})
        print("     title:", (r.get("title") or "")[:70])
        print("     photo:", (r["photo_urls"] or ["(none)"])[0][:74], f"({len(r['photo_urls'])} imgs)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="stop after N parsed listings; upsert them, NO prune")
    ap.add_argument("--dry-run", action="store_true",
                    help="print normalized rows as JSON and write NOTHING to the database")
    ap.add_argument("--self-test", action="store_true", help="offline parser asserts, no network")
    args = ap.parse_args()

    if args.self_test:
        return _selftest()

    if args.dry_run:
        # No db import at all on this path: the "zero writes" promise is structural, not a flag check.
        res, com, seen = crawl(limit=args.limit)
        if args.type != "all":
            res, com = ([] if args.type == "commercial" else res), (com if args.type == "commercial" else [])
        _print_rows(res + com, as_json=True)
        print(f"✓ DRY RUN {SOURCE}: {seen} listings seen → {len(res)} residential + "
              f"{len(com)} commercial normalized, 0 database writes", flush=True)
        return 0

    from scrapers.common import db   # noqa: PLC0415 — deliberately not imported on the dry-run path

    run_id = None if args.limit else db.begin_run("rawasidark")
    seen = 0
    try:
        res, com, seen = crawl(limit=args.limit)
        if args.type != "all":
            res, com = ([] if args.type == "commercial" else res), (com if args.type == "commercial" else [])

        if res:
            db.upsert_rawasidark_residential_batch(res)
        if com:
            db.upsert_rawasidark_commercial_batch(com)

        if args.limit:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial upserted (no prune)")
            _print_rows((res + com)[:8], as_json=False)
            return 0

        pruned = 0
        for tbl, rows_seen in (("rawasidark_residential_listings", res),
                               ("rawasidark_commercial_listings", com)):
            nn = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source=SOURCE)
            if nn < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += nn
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned}",
                             check_tables=["rawasidark_residential_listings",
                                           "rawasidark_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard — failing CI instead of a silent success.",
                  flush=True)
        return 0 if healthy else 1
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
