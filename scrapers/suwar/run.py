"""سوار العقارية — suwar.sa (WordPress, «property» post type + a hand-written detail page).

SOURCE SHAPE (probed live 2026-09-14 across ALL 167 listings before a line of this was written —
every percentage below is measured on the full set, not sampled):

  /wp-json/wp/v2/property?per_page=100&_embed=wp:term,wp:featuredmedia   → 167 posts, 2 pages
      · featured image on 167/167 (100%)
      · ONE taxonomy only: `property_feature` (warranties + amenities). There is no city, type,
        status or price taxonomy on this site — those live on the detail page.

  the detail page (post.link) carries the facts, two of them in real markup:
      · <span class="price">1,200,000</span>    166/167 (99%)   ← THE price
      · <span class="status">متاح</span>        165/167 (98%)   ← متاح / غير متاح
      · <p class="address">مكة, Saudi Arabia</p> 167/167 (100%) ← THE city, source-stated
      · <div class="text">…</div>               free-text spec prose (area/rooms/baths/…)

THE PRICE COMES FROM <span class="price">, NEVER FROM THE PROSE. The description writes prices in
words and in Arabic-Indic digits — «السعر / مليون و ٣٥٠ الف», «٥٢٠ ألف» — and a single page often
quotes TWO (front unit vs back unit, «السعر الاماميه / 630,000» + «السعر الخلفيه / 590,000»).
Re-deriving a number from that prose would manufacture figures the source did not choose. The site
has already resolved every one of those into the span itself; verified on the six hardest pages:
«مليون و ٣٥٠ الف»→1,350,000, «مليون و ٣٠٠ الف»→1,300,000, «مليون و ٨٥٠ الف»→1,850,000, and each
two-price page→the lower figure. So the span is read verbatim and the prose is never parsed for
money. (PRICE = SOURCE.)

«غير متاح» IS NOT INGESTED AS LIVE. 63 of the 167 are غير متاح — sold or withdrawn. They are mapped
with active=False rather than dropped, so a listing that flips back is not resurrected as new and
one that flips away is deactivated by its own source statement instead of by absence.

THE CITY IS READ, NEVER ASSUMED. <p class="address"> states it on 167/167. It matters: the site's
WhatsApp button is hardcoded to 'مكة' on every page, and one listing (id 1799, «حي السلامة, جدة»)
is in Jeddah — where حي السلامة ALSO exists. Defaulting the platform to Mecca would have filed a
Jeddah property under Mecca and matched it to the wrong حي السلامة.

THE DISTRICT COMES FROM THE TITLE, NOT THE DESCRIPTION. Both were measured. The description pushed
resolution from 85% to 93% — and every one of those extra 14 hits was the phrase «داخل حد الحرم»
(“inside the Haram boundary”, a religious/legal qualifier printed on half the ads) being read as
مكة's real حي الحرم. The prose is marketing copy, not a location statement; the title is where this
source states the place. 85% catalog-attested beats 93% with 14 invented.

TYPE is the title's own leading noun, with this site's typos spelled out explicitly (فبلا, ؤشقق) —
an unmapped type is skipped, never assumed.
DEAL is «تمليك» (freehold ownership) → Buy. 18 of the 167 omit it from the title or misspell it
(«تملي», «تملك»); all 18 print it on their own page, so the page is read rather than the platform
being defaulted to Buy. A listing that states it NOWHERE is still skipped.

A MALFORMED PRICE IS NULL. Listing 22360 publishes «640,00» — one zero short. 64,000 is neither
what they wrote nor what they meant, and 640,000 would be a figure the source never printed, so the
price is withheld and the rest of the listing still stored.
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

SITE = "https://suwar.sa"
REST = f"{SITE}/wp-json/wp/v2"
PER_PAGE = 100
# NO User-Agent HERE, deliberately. curl_cffi's `impersonate=` sets a COMPLETE, internally
# consistent browser header set at the C layer (UA, sec-ch-ua, Accept, …) to match the TLS/JA3
# fingerprint it presents. Overriding just the UA makes the fingerprint and the header disagree,
# which is exactly what bot detection looks for: rakez.sa (Cloudflare) answered 403 to every single
# endpoint with a hardcoded UA and 200 without it, TLS fingerprint otherwise identical (measured
# 2026-09-14). All 46 sibling scrapers already leave the UA alone; these two were the exception.
# Accept-Language is safe and stays — it was verified not to be the trigger.
HEADERS = {
    "Accept-Language": "ar,en;q=0.8",
}

# The site's own type nouns, INCLUDING its typos — measured over all 167 titles: فيلا x61, شقق x57,
# فبلا x2 (ف-ب-لا), روف x2, ؤشقق x1, أدوار x2. A token not in here is not guessed at.
_TYPE_WORDS: list[tuple[str, str]] = [
    ("فيلا", "فيلا"), ("فبلا", "فيلا"), ("فلة", "فيلا"), ("فله", "فيلا"),
    ("شقق", "شقة"), ("ؤشقق", "شقة"), ("شقة", "شقة"), ("شقه", "شقة"),
    ("أدوار", "دور"), ("ادوار", "دور"), ("دور", "دور"),
    ("روف", "شقة"),          # a «روف» on this site is the top-floor apartment, sold as a شقة
    ("عمارة", "عمارة"), ("عماره", "عمارة"),
    ("أرض", "أرض"), ("ارض", "أرض"),
]

# «تمليك» = sold freehold. This source publishes nothing else; a title without it is skipped.
_OWNERSHIP_TOKENS = ("تمليك", "للتمليك", "للبيع")

# property_feature term → our boolean column. Only terms whose meaning is unambiguous are mapped;
# the warranty terms (ضمان…, تأمين…) are preserved verbatim in additional_info instead, because
# they describe the CONTRACT, not the unit, and no column means "has a plumbing warranty".
_FEATURE_COLUMNS: dict[str, str] = {
    "مصعد": "elevator",
    "مؤسس مصعد": "elevator",          # lift shaft built and prepared — the source's own wording
    "موقف خاص": "parking",
    "مواقف خاصة": "parking",
    "غرفة سائق": "driver_room",
    "غرفة خادمة": "maid_room",
    "غرفة شغالة": "maid_room",
    "خزان مستقل": "separate_water_meter",
    # «كاميرات مراقبه» (CCTV) and «حوش» (yard) have NO column in the shared listing shape and are
    # deliberately NOT forced into a neighbouring one — they stay verbatim in additional_info.
}

LAST_FETCH_NOTE = "no pages attempted"


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome124")
    s.headers.update(HEADERS)
    return s


def _clean(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    t = ihtml.unescape(re.sub(r"<[^>]+>", " ", s))
    t = re.sub(r"\s+", " ", t).strip()
    return t or None


def _to_int(v: Any) -> Optional[int]:
    """Digits only, ASCII or Arabic-Indic. Never rounds, never infers."""
    if v is None:
        return None
    s = str(v).translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
    s = re.sub(r"[,\s]", "", s)
    m = re.match(r"^(\d+)(?:\.\d+)?$", s)
    if not m:
        return None
    n = int(m.group(1))
    return n if n > 0 else None


def _price_to_int(v: Any) -> Optional[int]:
    """A price whose thousands grouping is MALFORMED is NULL, never a silently rescued number.

    Six of this source's 166 price spans are malformed, and they are NOT all the same thing
    (measured 2026-09-14):

      RECOVERABLE — a MISPLACED comma. «1500,000», «1300,000», «1250,000». Every group after the
      first is still three digits, so the digits themselves are unambiguous: 1,500,000. Reading
      these is not a repair, it is just ignoring the separator.

      UNREADABLE — a MISSING digit. «640,00», «650,00» (group of two), and «1,50,0000» (groups of
      two and four). «640,00» could be 640,000 or 64,000 and nothing in the source decides which.
      Stripping the comma yields 64,000 — neither what they wrote nor what they meant — and would
      have shipped a 64,000-riyal Mecca apartment into the price filter. Choosing 640,000 instead
      would be inventing a figure the source never printed (PRICE = SOURCE). So: no price.

    Rule: every comma group AFTER the first must be exactly three digits. The first group may be
    any length. The rest of the listing (photo, area, district, rooms) is still perfectly good and
    is still stored; only the unreadable number is withheld.
    """
    if v is None:
        return None
    s = str(v).translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")).strip()
    if "," in s and not re.fullmatch(r"\d+(?:,\d{3})+", s):
        return None
    return _to_int(s)


def fetch_all(s: cc.Session) -> list[dict]:
    """Every property post, terms + featured media embedded.

    _embed NAMES both relations it parses. Asking for wp:term alone is what shipped aqaralsaudia
    with zero photos (2026-09-14) — WordPress only populates _embedded for relations you name.
    """
    global LAST_FETCH_NOTE
    LAST_FETCH_NOTE = "no pages attempted"
    out: list[dict] = []
    for page in range(1, 12):
        r = None
        last_exc: Optional[Exception] = None
        for attempt in range(3):          # a single flaky hop must not cost the run (شموع الشمال)
            try:
                r = s.get(f"{REST}/property?per_page={PER_PAGE}&page={page}"
                          f"&_embed=wp:term,wp:featuredmedia", timeout=45)
                break
            except Exception as e:
                last_exc = e
                if attempt < 2:
                    time.sleep(3 * (attempt + 1))
        if r is None:
            LAST_FETCH_NOTE = (f"page {page} raised {type(last_exc).__name__} on all 3 attempts: "
                               f"{str(last_exc)[:110]}")
            break
        if r.status_code == 400:
            LAST_FETCH_NOTE = f"stopped at page {page} (WP answers 400 past the last page)"
            break
        if r.status_code != 200:
            LAST_FETCH_NOTE = f"page {page} returned HTTP {r.status_code}"
            break
        try:
            batch = r.json()
        except Exception:
            LAST_FETCH_NOTE = f"page {page} body was not JSON (parked/blocked/truncated)"
            break
        if not isinstance(batch, list) or not batch:
            LAST_FETCH_NOTE = f"page {page} returned an empty list (end of source)"
            break
        out.extend(x for x in batch if isinstance(x, dict))
        if len(batch) < PER_PAGE:
            LAST_FETCH_NOTE = f"read {len(out)} posts over {page} page(s)"
            break
    return out


def _terms(post: dict) -> list[str]:
    """property_feature names embedded on this post."""
    names: list[str] = []
    for group in (post.get("_embedded") or {}).get("wp:term") or []:
        for t in group or []:
            if isinstance(t, dict) and t.get("taxonomy") == "property_feature" and t.get("name"):
                names.append(_clean(t["name"]) or "")
    return [n for n in names if n]


def _photos(post: dict) -> list[str]:
    urls: list[str] = []
    for group in (post.get("_embedded") or {}).get("wp:featuredmedia") or []:
        if isinstance(group, dict) and group.get("source_url"):
            urls.append(group["source_url"])
    return list(dict.fromkeys(u for u in urls if u))


# ── the detail page ─────────────────────────────────────────────────────────────────────────────
_RE_PRICE = re.compile(r'<span class="price">\s*([^<]{1,40}?)\s*</span>')
_RE_STATUS = re.compile(r'<span class="status">\s*([^<]{1,30}?)\s*</span>')
_RE_ADDRESS = re.compile(r'<p class="address">(.*?)</p>', re.S)
_RE_TEXTBLOCK = re.compile(r'<div class="text">(.*?)</div>', re.S)


def _plain(fragment: str) -> str:
    t = ihtml.unescape(re.sub(r"<[^>]+>", " ", fragment))
    return re.sub(r"\s+", " ", t).strip()


def fetch_detail(s: cc.Session, url: str) -> Optional[dict]:
    """The four facts the feed does not carry. Returns None when the page cannot be read — the
    caller then skips the listing rather than storing a row with a guessed price."""
    r = None
    for attempt in range(3):
        try:
            r = s.get(url, timeout=45)
            break
        except Exception:
            if attempt < 2:
                time.sleep(2 * (attempt + 1))
    if r is None or r.status_code != 200:
        return None
    t = r.text
    m_price, m_status, m_addr = _RE_PRICE.search(t), _RE_STATUS.search(t), _RE_ADDRESS.search(t)
    m_text = _RE_TEXTBLOCK.search(t)
    return {
        "price": _price_to_int(m_price.group(1)) if m_price else None,
        "status": _plain(m_status.group(1)) if m_status else None,
        "address": _plain(m_addr.group(1)) if m_addr else None,
        "text": _plain(m_text.group(1)) if m_text else "",
    }


# Spec prose, every spelling this source actually uses (measured over the 72 pages the first
# regex missed): مساحة/مساحه, «/» or «:», م/م2/م², ASCII or Arabic-Indic digits. A page that
# splits «مساحة الأرض» from «مساحة البناء» is deliberately NOT collapsed — see _area().
# «ال» is optional on every one of these: the source writes both «المساحة / 300 م» and
# «مساحة / 196 م». Requiring a word boundary before مساحة is what returned NULL area on every
# listing in the first dry run, while 95 of the 167 pages plainly state one.
_RE_AREA_PLAIN = re.compile(r"(?:ال)?مساح[ةه]\s*[/:]?\s*([\d٠-٩][\d٠-٩,\.]*)\s*(?:م\b|م2|م²|متر)")
# ال[أا]رض, because the source spells it both «الأرض» and «الارض».
_RE_AREA_LAND = re.compile(r"(?:ال)?مساح[ةه]\s*ال[أا]ر?ض\s*[/:]?\s*([\d٠-٩][\d٠-٩,\.]*)")
_RE_AREA_BUILT = re.compile(r"(?:ال)?مساح[ةه]\s*البنا[ءي]?\s*[/:]?\s*([\d٠-٩][\d٠-٩,\.]*)")
_RE_ROOMS = re.compile(r"(?:الغرف|غرف\s*النوم)\s*[/:]\s*([\d٠-٩]+)")
_RE_BATHS = re.compile(r"دورات\s*المياه\s*[/:]\s*([\d٠-٩]+)")
_RE_LIVING = re.compile(r"الصالات\s*[/:]\s*([\d٠-٩]+)")
_RE_MAJLIS = re.compile(r"المجالس\s*[/:]\s*([\d٠-٩]+)")


def _area(text: str) -> tuple[Optional[int], dict[str, int]]:
    """(area_m2, extras). When the page states plot AND built-up separately, area_m2 is the PLOT —
    that is what «المساحة» means for a Saudi villa and what a buyer filters on — and BOTH numbers
    are kept in additional_info so nothing the source published is lost."""
    extras: dict[str, int] = {}
    land = _to_int(m.group(1)) if (m := _RE_AREA_LAND.search(text)) else None
    built = _to_int(m.group(1)) if (m := _RE_AREA_BUILT.search(text)) else None
    if land:
        extras["area_land_m2"] = land
    if built:
        extras["area_built_m2"] = built
    if land:
        return land, extras
    if built:
        return built, extras
    plain = _to_int(m.group(1)) if (m := _RE_AREA_PLAIN.search(text)) else None
    return plain, extras


def _type_from_title(title: str) -> Optional[str]:
    for word, canonical in _TYPE_WORDS:
        if word in title:
            return normalize.map_type_exact(canonical)
    return None


def _city_from_address(address: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """(city_ar, district_hint) from «[حي X, ]<city>, Saudi Arabia». The city is the LAST segment
    before the country; anything before it is a district the source itself stated."""
    if not address:
        return None, None
    parts = [p.strip() for p in address.split(",") if p.strip()]
    parts = [p for p in parts if p.lower() not in ("saudi arabia", "السعودية", "المملكة العربية السعودية")]
    if not parts:
        return None, None
    return parts[-1], (parts[-2] if len(parts) >= 2 else None)


def map_listing(post: dict, detail: Optional[dict]) -> tuple[Optional[dict], str]:
    pid = post.get("id")
    if not isinstance(pid, int) or not detail:
        return None, ""
    title = _clean((post.get("title") or {}).get("rendered", "")) or ""
    if not title:
        return None, ""

    property_type = _type_from_title(title)
    if not property_type:
        return None, ""                              # unmapped type → skipped, never assumed
    # DEAL — stated in the title, else stated on the listing's own page. Reading the page is the
    # faithful option, not a default: measured 2026-09-14, 18 of the 167 omit the word from the
    # title (or misspell it «تملي»/«تملك») while all 18 print «تمليك»/«للتمليك» on the page itself.
    # A listing that states it NOWHERE is still skipped — the platform is never assumed to be Buy.
    if not any(tok in title for tok in _OWNERSHIP_TOKENS):
        if not any(tok in (detail.get("text") or "") for tok in _OWNERSHIP_TOKENS):
            return None, ""

    city_ar, district_hint = _city_from_address(detail.get("address"))
    city_id, region_id = to_catalog(city_ar) if city_ar else (None, None)

    # District: the source's OWN address segment first, then the title. The description is never
    # searched — «داخل حد الحرم» there resolved to مكة's real حي الحرم on 14 listings.
    district_ar = None
    if city_id:
        if district_hint:
            district_ar = find_district_in_text(district_hint, city_id)
        if not district_ar:
            district_ar = find_district_in_text(title, city_id)

    text = detail.get("text") or ""
    area_m2, area_extras = _area(text)
    bedrooms = _to_int(m.group(1)) if (m := _RE_ROOMS.search(text)) else None
    bathrooms = _to_int(m.group(1)) if (m := _RE_BATHS.search(text)) else None
    living = _to_int(m.group(1)) if (m := _RE_LIVING.search(text)) else None
    majlis = _to_int(m.group(1)) if (m := _RE_MAJLIS.search(text)) else None

    features = _terms(post)
    feature_cols = {col: True for name, col in _FEATURE_COLUMNS.items() if name in features}

    status = detail.get("status") or ""
    # «غير متاح» must be checked BEFORE «متاح» — it CONTAINS it.
    is_active = not status.startswith("غير") if status else True

    category = ("Residential" if normalize.category_for_type(property_type) == "Residential"
                else "Commercial")

    row = {
        "ad_number": f"SWR{pid}",
        "listing_url": post.get("link") or f"{SITE}/?p={pid}",
        "source": "Suwar",
        "active": is_active,
        "property_type": property_type,
        "transaction_type": "Buy",
        "area_m2": area_m2,
        "bedrooms": bedrooms,
        "bathrooms": bathrooms,
        "halls": living,                      # الصالات
        "reception_rooms_majlis": majlis,     # المجالس
        "price_total": detail.get("price"),
        "price_annual": None,                       # sale-only source; no period is manufactured
        "city": normalize.map_city(city_ar) if city_ar else None,
        "neighborhood": district_ar,
        "title": title,
        "description": _clean((post.get("content") or {}).get("rendered", "")),
        "photo_urls": _photos(post),
        "city_ar": city_ar,
        "district_ar": district_ar,
        "city_id": city_id,
        "region_id": region_id,
        "additional_info": {
            k: v for k, v in {
                "features_ar": features or None,
                "source_status": status or None,
                "source_address": detail.get("address"),
                **area_extras,
            }.items() if v not in (None, "", [], {})
        },
        **feature_cols,
    }
    return row, category.lower()


_DEAD_STATUSES = {"trash", "draft", "pending", "private", "expired"}


def _verify_gone(ad_number: str) -> tuple[str, str]:
    """Absence from the feed NEVER deactivates on its own — the source must SAY the ad is gone.

    Control-validated live 2026-09-14 against this platform's real retirement behaviour, the same
    way aqaralsaudia's was. suwar HARD-DELETES rather than flipping a status:
      · id 22413 (live)           → HTTP 200, status=publish
      · id 22400 (gone from feed) → HTTP 404, code=rest_post_invalid_id
      · id 999999 (never existed) → HTTP 404, code=rest_post_invalid_id
    Only a 404 the API ITSELF attributes to rest_post_invalid_id counts as gone. A bare 404 (a WAF
    page, a routing change), any 401/403/408/429/5xx, an unparseable body and an id mismatch are all
    UNKNOWN — they hold the strike without deactivating. The status limb is implemented too so a
    future draft/trash post cannot read as alive.

    Returns ('gone'|'live'|'unknown', evidence). UNKNOWN NEVER KILLS.
    """
    pid = ad_number.replace("SWR", "")
    try:
        r = cc.get(f"{REST}/property/{pid}", headers=HEADERS, timeout=30)
    except Exception as e:
        return "unknown", f"probe raised {type(e).__name__}: {str(e)[:90]}"
    try:
        body = r.json()
    except Exception:
        return "unknown", f"REST {r.status_code} with an unparseable body"
    if r.status_code == 404:
        if isinstance(body, dict) and body.get("code") == "rest_post_invalid_id":
            return "gone", "REST 404 rest_post_invalid_id — the post was deleted at source"
        code = body.get("code") if isinstance(body, dict) else None
        return "unknown", f"404 without rest_post_invalid_id (code={code!r})"
    if r.status_code == 200 and isinstance(body, dict):
        if str(body.get("id")) != str(pid):
            return "unknown", f"id mismatch: asked {pid}, got {body.get('id')}"
        status = str(body.get("status") or "")
        if status in _DEAD_STATUSES:
            return "gone", f"REST 200 but status={status}"
        if status == "publish":
            return "live", "REST 200 status=publish — still published"
        return "unknown", f"unrecognised status={status!r}"
    return "unknown", f"REST {r.status_code}"


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--limit-test", type=int, default=0,
                   help="If >0, only process this many posts and DON'T upsert (dry run).")
    args = p.parse_args()

    s = session()
    run_id = None if args.limit_test else db.begin_run("suwar")
    res_rows: list[dict] = []
    com_rows: list[dict] = []
    seen = 0
    detail_failed = 0
    unavailable = 0
    try:
        posts = fetch_all(s)
        if not posts:
            raise RuntimeError(f"REST returned no listings — {LAST_FETCH_NOTE}")
        if args.limit_test:
            posts = posts[: args.limit_test]
        print(f"Suwar: {len(posts)} posts fetched ({LAST_FETCH_NOTE})")

        for post in posts:
            detail = fetch_detail(s, post.get("link") or "")
            if detail is None:
                detail_failed += 1
                continue                     # unreadable page → no row, never a guessed price
            row, cat = map_listing(post, detail)
            if not row:
                continue
            if not row["active"]:
                unavailable += 1
            (com_rows if cat == "commercial" else res_rows).append(row)
            seen += 1
            time.sleep(0.25)

        print(f"  {unavailable} marked غير متاح (inactive at source), {detail_failed} pages unreadable")

        if args.limit_test:
            print(f"DRY RUN — would upsert {len(res_rows)} residential + {len(com_rows)} commercial")
            for r in (res_rows + com_rows)[:8]:
                print("  ", {k: r[k] for k in ("ad_number", "property_type", "transaction_type",
                                               "city_ar", "city_id", "district_ar", "area_m2",
                                               "bedrooms", "price_total", "active")})
                print("     photos:", len(r["photo_urls"]), "|", (r["photo_urls"] or ["(none)"])[0][:74])
            return 0

        if res_rows:
            db.upsert_suwar_residential_batch(res_rows)
        if com_rows:
            db.upsert_suwar_commercial_batch(com_rows)

        superseded = db.retire_superseded_siblings(
            res_table="suwar_residential_listings",
            com_table="suwar_commercial_listings",
            res_ads={r["ad_number"] for r in res_rows},
            com_ads={r["ad_number"] for r in com_rows},
            source="Suwar")

        pruned = 0
        for tbl, rows in (("suwar_residential_listings", res_rows),
                          ("suwar_commercial_listings", com_rows)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source="Suwar",
                                verify_gone=_verify_gone)
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped — kept existing active")
            else:
                pruned += n

        print(f"✓ Suwar: {len(res_rows)} residential + {len(com_rows)} commercial upserted, "
              f"{pruned} stale pruned, {superseded} superseded sibling(s) retired")
        healthy = db.end_run(run_id, ok=True, rows_seen=seen,
                             rows_upserted=len(res_rows) + len(com_rows),
                             notes=(f"pruned={pruned} superseded={superseded} "
                                    f"unavailable={unavailable} detail_failed={detail_failed}"),
                             check_tables=["suwar_residential_listings",
                                           "suwar_commercial_listings"])
        return 0 if healthy else 1
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
