"""قمرا للتطوير العقاري (Qmra) — qmra.sa. 19 property posts, onboarding 2026-09-25.

Qmra is a DEVELOPER selling its own inventory directly — not a marketplace. Each `property` post is
one numbered building/compound ("قمرا 01" … "قمرا 19"), never an individual unit.

SOURCE SHAPE (measured live 2026-09-25; every number below was captured, not assumed).
A WordPress site (Kadence theme) whose `property` custom post type has its OWN public REST API —
no auth, no cookie, no proxy, plain `impersonate="chrome"`:

    GET /wp-json/wp/v2/property?per_page=100&page=N&_embed=1
        → [ …post objects…]         X-WP-Total / X-WP-TotalPages response headers

  19 posts, 1 page (per_page=100 already covers the whole catalogue; pagination is still walked in
  case the roster grows past 100). `X-WP-Total: 19` is the platform's own declared count and is what
  gates pruning — the same self-declaring-completeness contract abaad's `total_size` and tuba's
  `listPropertiesCount` use.

  A NONEXISTENT / DELETED post 404s cleanly with `{"code":"rest_post_invalid_id"}` — verified on a
  fabricated id (999999), an out-of-range id (1), 6 interior gap ids (640/700/750/800/850/890) and 2
  fabricated front-end slugs: 8/8 hard 404, 0 soft-404s, 0 redirects.

READINESS IS A FIRST-CLASS TAXONOMY FIELD — `property-status` — NEVER A TITLE WORD (the one hard
requirement of this build). Every post carries EXACTLY one term of this taxonomy (measured on all
19; a `_status_deal()` guard still refuses to guess if that ever stops being true). The site's own
footer nav proves the field's meaning by linking straight to it: «مشاريع متاحة» (available projects)
→ `/property-status/متاح-للبيع/`, «مشاريع قريبة من الإنجاز» (near-completion) →
`/property-status/تحت-الإنشاء/`, «مشاريع تم بيعها» (sold) → `/property-status/مباع/`.

  MEASURED CATALOGUE (all 19 posts, term id → name → count, 2026-09-25):
    id 10   مُتاح للبيع     6   ← READY (for sale)   — Buy
    id 21   مُتاح للتأجير   0   ← READY (for rent)    — Rent (none live yet, kept for symmetry)
    id 11   تحت الإنشاء     3   ← off-plan / under construction — EXCLUDED
    id 24   بدأ البيع       0   ← "sale has begun" — a presale/off-plan launch stage, NOT "ready for
                                   move-in"; excluded on the same reasoning as تحت الإنشاء
    id 12   مُباع           8   ← sold (primary spelling) — EXCLUDED
    id 23   تم البيع        1   ← sold (alternate wording) — EXCLUDED
    id 22   تم التأجير      1   ← rented — EXCLUDED
    6 + 0 + 3 + 0 + 8 + 1 + 1 = 19. Ready = 6, all «مُتاح للبيع» (Buy); 0 «مُتاح للتأجير» today.

  VERIFIED LIVE ON 11 INDIVIDUAL UNITS (not just the term-count listing) — the rendered detail page
  prints the SAME status as a "pill" (`<ul class="… kb-dynamic-list-style-pill …"><li>`), sourced
  from this very taxonomy by the theme's own dynamic-list block:
    READY (6/6):     قمرا 17, 19, 16, 14, 12, 11 — every one prints «مُتاح للبيع» on its own page.
    NOT ready (5/5): قمرا 03 (تحت الإنشاء), 15 (تحت الإنشاء), 10 (تم البيع), 13 (مُباع),
                     05 (تم التأجير) — every one prints that exact status, not «متاح», on its page.
  `_READY_STATUS_TO_DEAL` below is therefore the SOLE gate for inclusion, keyed on the taxonomy term
  NAME (mark-stripped — «مُتاح» carries an invisible dammah, U+064F, the same tashkeel trap abaad and
  tuba hit on their studio type word). A status this dict does not name — off-plan, presale, sold,
  rented, or a future value never seen above — skips the row, counted, never guessed into either
  bucket. Buy/Rent is READ from which ready term matched (متاح **للبيع** vs متاح **للتأجير**), not a
  separate deal field — the site has none.

NO PRICE EXISTS ANYWHERE ON THIS SOURCE. Checked exhaustively on all 19 rendered pages (REST `acf`/
`content.rendered` are empty on every post; the page itself carries no «ريال»/price span/JSON-LD
price of any kind) — a property post here is a "reserve your interest" page (name/email/phone/
housing-type form), not a priced listing. PRICE = SOURCE: price_total/price_annual/price_per_meter
stay NULL on every row, and `price_evidence.found` is False (no field was ever read, as opposed to
the source stating an explicit null — see normalize.price_evidence's `authoritative_absent`, which
is deliberately NOT set here). Likewise no area/bedroom/bathroom/REGA-license field exists anywhere
— the source states only: title, status, type, and a free-text "<district>، <city>" line.

LOCATION lives ONLY on the rendered detail page, in a map-pin icon-list item —
`<span class="kt-svg-icon-list-text">الورود، الرياض</span>` — never in the REST payload (which has
no city/district field of any kind). Confirmed on all 6 ready units: الورود (17), الربيع (19),
التعاون (16), حطين (14), المرسلات (12), الرحمانية (11) — all «، الرياض». The LAST comma-separated
segment is the city (fed to `to_catalog()`); everything before it is the source's own district text
(kept raw in `neighborhood`, resolved against the catalog by `find_district_in_text` into
`district_ar` — never invented if the catalog does not attest it).

PHOTO MISATTRIBUTION — MEASURED, and the reason photo_urls is built from confirmed ownership rather
than "whatever image tag appears on the page". A WP media item's OWN `post` field (its true
post_parent) is the only trustworthy attribution; what actually RENDERS on a property's page is not
reliable evidence of whose photo it is, because this source's content blocks embed images BY RAW
MEDIA ID rather than exclusively through their own post's attached media:
  · قمرا 12 (id 836)'s own page inlines media 832–835 — but `/wp-json/wp/v2/media/832` says
    `"post":831`, i.e. those are قمرا 11's own WhatsApp photos, not قمرا 12's.
  · قمرا 14 (id 843)'s own page inlines media 838–842, AND its own `featured_media` is 839 — both
    belong (`"post":837`) to قمرا 13, a SOLD, NOT-ready unit. Storing them on 843 would have shown a
    ready listing photos of a property that isn't even for sale.
  · قمرا 16 (id 845) is the honest control: its page inlines 1757–1761, which ARE its own
    (`"post":845` on all five).
So `fetch_media_map()` asks WordPress for `media?parent[]=<id>` per candidate — the platform's own
attachment relationship, never a page scrape — and `photo_urls` keeps only image ids that are BOTH
(a) truly parented to this exact property id and (b) actually referenced on this property's own page
(via `featured_media` or an inline `wp-image-<id>` class) — a page-mentioned id that is not this
property's own attachment is dropped, not attributed. Net effect on the 6 ready units: 17/19/16/11
keep real photos; 12 and 14 legitimately end up with NO photo (their own attached media is either
absent or, for 843, the one candidate id belongs to someone else) — the honest answer, not a
borrowed one.

PDPL. This source publishes no advertiser/agent identity at all — no `author` field, no phone/email/
WhatsApp anywhere in the REST payload or the rendered page (the only phone/email fields on the page
belong to the SITE VISITOR'S OWN inquiry form, which we never submit and never read a value from).
`redact_pii()`/`strip_pii_fields()` still run over every free-text value and the whole capture as
defence in depth, and `_CAPTURE_KEYS` is an explicit ALLOWLIST rather than a blocklist, so a PII field
added upstream tomorrow cannot reach a stored row by default.

REMOVAL ORACLE (measured 2026-09-25 — a 200 does not mean "still a ready listing" here either)
------------------------------------------------------------------------------------------------
A unit that sells out is NOT deleted — its `property-status` term simply changes, and the post keeps
answering 200 forever (measured: قمرا 10/id 853 is now «تم البيع», قمرا 13/id 837 is now «مُباع»,
قمرا 05/id 820 is now «تم التأجير» — all three still 200 with a complete, valid REST body). So the
oracle re-reads the SAME first-class field a fresh GET on the post's own REST endpoint:

    404 + {"code":"rest_post_invalid_id"}   → gone   (hard delete; 8/8 fabricated/gap ids measured)
    404, any other shape                    → UNKNOWN (a WAF/routing 404 is not this platform's own
                                                        statement — never trusted alone)
    200 + property-status names a READY term → live
    200 + property-status names anything else → gone  (the source's own current statement — exactly
                                                        how 853/837/820 read today)
    200 + no property-status at all          → UNKNOWN (no opinion)
    unreachable / blocked / 5xx / empty body → UNKNOWN (the shared law in http_liveness overrides
                                                        any 'gone' reading here regardless)
Removals are additionally gated by an in-run positive control that fails CLOSED, and rows are built
from the LIST endpoint, so mark_direct_alive() is deliberately NOT called.

COVERAGE (full --dry-run against the live API, 2026-09-25)
------------------------------------------------------------
19 posts fetched, X-WP-Total=19, complete=True → 6 ready (all residential; 0 commercial) — Floor
(دور) 4, Apartment (شقق) 2. 13 skipped and counted: not_ready_مباع 8, not_ready_تحت_الإنشاء 3,
not_ready_تم_التأجير 1, not_ready_تم_البيع 1. Zero type-unmapped, zero status-ambiguous, zero no-id.
  city 6/6 (all الرياض) · district_ar 6/6 · neighborhood 6/6 (raw kept) · photos 4/6 (12, 14 have
  none — see the misattribution trap) · price_total/annual/per_meter 0/6 (none published anywhere)
  license_number/license_expiry 0/6 (no REGA field exists on this source at all)

OPEN QUESTIONS FOR ONBOARDING (none of these are guessed in code)
-------------------------------------------------------------------
  · «تاون هاوس» (Townhouse) and «مكاتب» (Offices) currently have ZERO ready units, so this build has
    never had to map them. `_TYPE_OVERRIDES` folds them anyway (Townhouse→Villa, matching the
    fleet's OWN existing TYPE_MAP_EN fold for the English word; مكاتب→Office, the plural of the
    shared map's own «مكتب» key) so a future ready townhouse/office is not skipped by surprise — if
    the owner would rather see these as their own distinct types, that is a normalize-level decision.
  · «بدأ البيع» (0 today) is read here as a presale/off-plan launch stage, not "ready" — no live
    example exists yet to confirm that reading; flagged rather than guessed silently.
  · No REGA ad-license, area, bedroom/bathroom or price field exists anywhere on this source. If the
    owner has a different, non-public data feed from this developer, that would be a new source shape
    entirely, not a fix to this scraper.
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

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http import TRANSIENT_STATUSES  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

BASE = "https://qmra.sa"
API = f"{BASE}/wp-json/wp/v2/property"
MEDIA_API = f"{BASE}/wp-json/wp/v2/media"
SOURCE = "قمرا للتطوير العقاري"
PREFIX = "QMR"
SLUG = "qmra"
RES_TABLE = "qmra_residential_listings"
COM_TABLE = "qmra_commercial_listings"
PAGE_SIZE = 100

# TASHKEEL IS INVISIBLE. The source's own "ready" term is written «مُتاح …» with a dammah (U+064F)
# that a hand-typed comparison string may or may not carry in the same position — the exact defect
# abaad and tuba hit on their studio type word. Marks are stripped before every taxonomy-name lookup.
_MARKS = dict.fromkeys(list(range(0x064B, 0x0653)) + [0x0640, 0x0670])


def _strip_marks(s: Optional[str]) -> Optional[str]:
    return s.translate(_MARKS) if s else s


# THE READINESS FIELD — the sole basis for including/excluding a unit (owner requirement). Keyed on
# the `property-status` taxonomy term NAME, mark-stripped. Maps straight to the deal, because this
# source states Buy vs Rent only through WHICH "ready" term applies (متاح للبيع / متاح للتأجير) —
# there is no separate sale/rent field. Every other status this source has ever shown — تحت الإنشاء
# (off-plan/under construction), بدأ البيع (presale launch), مُباع / تم البيع (sold), تم التأجير
# (rented) — is deliberately ABSENT: a status not in this dict skips the row, counted by its own
# name, never guessed into either bucket. See the docstring's MEASURED CATALOGUE for the real counts
# (6 ready / 13 not, of 19) and the 11-unit live verification.
_READY_STATUS_TO_DEAL: dict[str, str] = {
    "متاح للبيع": "Buy",
    "متاح للتأجير": "Rent",
}

# Per-platform exact-match overrides (map_type_exact's documented escape hatch) — NOT a guess: both
# fold an already-owner-approved fleet equivalence onto a spelling this source happens to use.
# «تاون هاوس» → Villa mirrors normalize.TYPE_MAP_EN's existing 'Townhouse': 'Villa' fold for the
# English word; «مكاتب» → Office is the plain plural of TYPE_MAP_AR's own singular «مكتب» key.
# Neither has a ready unit today (see OPEN QUESTIONS) — this only prevents a foreseeable future skip.
_TYPE_OVERRIDES = {
    "تاون هاوس": "Villa",
    "مكاتب": "Office",
}

# The map-pin icon-list item that carries the ONLY location text this source publishes:
#   <span class="kb-svg-icon-wrap kb-svg-icon-fe_mapPin …">…</span><span class="kt-svg-icon-list-text">
#   الورود، الرياض</span>
# Anchored on the feather "map-pin" icon class so a template re-order of the surrounding icon-list
# items cannot shift this onto the wrong item.
_LOCATION_RE = re.compile(
    r'kb-svg-icon-fe_mapPin[^"]*"[^>]*>.*?<span class="kt-svg-icon-list-text">([^<]+)</span>', re.S)
# Every WP media id actually referenced inline on the page — see the PHOTO MISATTRIBUTION trap for
# why this is only HALF of the ownership test (the other half is media?parent[]= below).
_WPIMAGE_RE = re.compile(r"wp-image-(\d+)")

# Keys copied into source_capture. An ALLOWLIST: this source has no PII field today, but the point of
# an allowlist (vs a blocklist) is that a field added upstream tomorrow cannot arrive by default.
_CAPTURE_KEYS = ("id", "slug", "link", "date", "modified", "featured_media")


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")     # impersonate OWNS the User-Agent
    s.headers.update({"Accept": "application/json, text/html", "Accept-Language": "ar,en;q=0.7"})
    return s


def _clean(v) -> Optional[str]:
    s = str(v).strip() if v is not None else ""
    return s or None


def _tally(skipped: dict[str, int]) -> str:
    return ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))


def _terms_of(rec: dict, taxonomy: str) -> list[dict]:
    """Full term dicts of ONE taxonomy from this post's `_embedded["wp:term"]` (requires `_embed=1`
    on the fetch). WordPress groups embedded terms by taxonomy, one list per group."""
    out = []
    for group in (rec.get("_embedded") or {}).get("wp:term") or []:
        for t in group or []:
            if isinstance(t, dict) and t.get("taxonomy") == taxonomy:
                out.append(t)
    return out


def _status_deal(rec: dict) -> tuple[Optional[str], str]:
    """(deal, skip_reason) — THE readiness gate. See `_READY_STATUS_TO_DEAL` for the measured
    vocabulary. Never reads a title or description; only this taxonomy."""
    names = {n for t in _terms_of(rec, "property-status") if (n := _strip_marks(_clean(t.get("name"))))}
    if not names:
        return None, "status_missing"
    ready = names & set(_READY_STATUS_TO_DEAL)
    if not ready:
        return None, f"not_ready_{'_'.join(sorted(n.replace(' ', '_') for n in names))}"
    if len(ready) > 1:
        # Never observed (every one of the 19 measured posts carries exactly one property-status
        # term) — refuse to guess which one governs rather than picking arbitrarily.
        return None, "status_ambiguous"
    return _READY_STATUS_TO_DEAL[next(iter(ready))], ""


def _resolved_type(rec: dict) -> tuple[Optional[str], str]:
    """(property_type, skip_reason). Exactly one property-type term is required — a post with zero
    or several (measured on non-ready posts, e.g. id 846: تاون هاوس+دور+فيلا at once) is skipped
    rather than picking one; no ready unit has ever carried more than one (measured)."""
    names = [n for t in _terms_of(rec, "property-type")
             if (n := _strip_marks(_clean(t.get("name"))))]
    if len(names) != 1:
        return None, f"type_count_{len(names)}"
    property_type = normalize.map_type_exact(names[0], _TYPE_OVERRIDES)
    if not property_type:
        return None, f"type_unmapped_{names[0]}"
    return property_type, ""


# ── FETCH: the catalogue ────────────────────────────────────────────────────────────────────────────
def fetch_catalogue(s: cc.Session, limit: int = 0) -> tuple[list[dict], bool]:
    """Every property post, terms embedded, plus whether the catalogue was served COMPLETE.

    `X-WP-Total` is WordPress's own declared count — the self-declaring-completeness contract
    abaad's `total_size` / tuba's `listPropertiesCount` use. Only when the distinct rows collected
    equal it may anything be pruned.
    """
    rows: dict[str, dict] = {}
    declared: Optional[int] = None
    total_pages = 1
    page = 1
    while page <= total_pages:
        r = None
        for attempt in range(3):
            r = s.get(f"{API}?per_page={PAGE_SIZE}&page={page}&_embed=1", timeout=45)
            if r.status_code not in TRANSIENT_STATUSES:
                break
        if r is None:
            raise RuntimeError(f"{API} page {page} returned no response")
        if r.status_code == 400 and page > 1:
            break                        # WP answers 400 past the last page
        if r.status_code != 200:
            raise RuntimeError(f"{API} page {page} returned {r.status_code}")
        try:
            batch = r.json()
        except ValueError as exc:
            raise RuntimeError(f"{API} page {page} is no longer JSON: {exc}") from exc
        if not isinstance(batch, list):
            raise RuntimeError(f"{API} page {page} is {type(batch).__name__}, not a list")
        if declared is None:
            declared = normalize.to_int_numeric(r.headers.get("X-WP-Total"))
            try:
                total_pages = max(1, int(r.headers.get("X-WP-TotalPages") or 1))
            except (TypeError, ValueError):
                total_pages = 1
        for e in batch:
            if isinstance(e, dict) and (key := _clean(e.get("id"))):
                rows[key] = e
        if limit and len(rows) >= limit:
            return list(rows.values())[:limit], False
        if len(batch) < PAGE_SIZE:
            break
        page += 1
    items = list(rows.values())
    complete = bool(declared) and len(items) == declared
    print(f"{SOURCE}: {len(items)} posts over {page} page(s); X-WP-Total={declared} "
          f"complete={complete}", flush=True)
    return items, complete


# ── FETCH: per-listing detail (location text + rendered media ids) ─────────────────────────────────
def fetch_detail(s: cc.Session, url: str) -> Optional[dict]:
    """The two facts the list endpoint does not carry: the location line, and which media ids this
    page actually references (candidates only — see fetch_media_map for the ownership check that
    decides which of them are real). None means the page could not be read — the caller skips the
    listing rather than storing a row with a guessed location."""
    if not url:
        return None
    r = None
    for attempt in range(3):
        try:
            r = s.get(url, timeout=45)
            if r.status_code not in TRANSIENT_STATUSES:
                break
        except Exception:
            r = None
        if r is None and attempt < 2:
            time.sleep(2 * (attempt + 1))
    if r is None or r.status_code != 200 or not r.text:
        return None
    m = _LOCATION_RE.search(r.text)
    location_text = ihtml.unescape(m.group(1)).strip() if m else None
    image_ids = {int(x) for x in _WPIMAGE_RE.findall(r.text)}
    return {"location_text": location_text, "image_ids": image_ids}


def fetch_media_map(s: cc.Session, property_ids: list[str]) -> dict[str, dict[int, str]]:
    """property_id -> {media_id: source_url}, IMAGES ONLY, restricted to media whose OWN `post`
    field (true post_parent) is one of these ids — WordPress's own attachment relationship, not a
    page scrape. This is the ownership half of the PHOTO MISATTRIBUTION guard; see the docstring."""
    out: dict[str, dict[int, str]] = {pid: {} for pid in property_ids}
    if not property_ids:
        return out
    qs = "&".join(f"parent[]={pid}" for pid in property_ids)
    r = s.get(f"{MEDIA_API}?{qs}&per_page=100&_fields=id,post,media_type,source_url", timeout=45)
    if r.status_code != 200:
        return out
    try:
        items = r.json()
    except ValueError:
        return out
    for m in items if isinstance(items, list) else []:
        if not isinstance(m, dict) or m.get("media_type") != "image":
            continue
        pid = _clean(m.get("post"))
        url = _clean(m.get("source_url"))
        mid = m.get("id")
        if pid in out and url and isinstance(mid, int):
            out[pid][mid] = url
    return out


def resolve_photo_urls(candidate_ids: set[int], owned: dict[int, str]) -> Optional[list[str]]:
    """The PHOTO MISATTRIBUTION guard, isolated so it is directly testable. `candidate_ids` is every
    media id a property's OWN page referenced (inline `wp-image-<id>` classes plus its
    `featured_media`); `owned` is `fetch_media_map(...)[this property's id]` — the ids WordPress
    itself attributes (`post` field) to this exact post. Only the intersection survives: a page can
    reference another post's media (measured on قمرا 12 and قمرا 14 — see the module docstring), and
    that is never this property's own photo no matter how plainly it renders on its page."""
    return [owned[i] for i in sorted(candidate_ids) if i in owned] or None


# ── MAP ──────────────────────────────────────────────────────────────────────────────────────────
def map_listing(rec: dict[str, Any], deal: str, property_type: str, detail: dict,
                photo_urls: Optional[list[str]]) -> tuple[dict, str]:
    """(row, category) for ONE already-classified ready post. `deal`/`property_type` come from
    `_status_deal`/`_resolved_type` (already proven non-None by the caller); `detail` from
    `fetch_detail`; `photo_urls` from the ownership-checked media map."""
    pid = _clean(rec.get("id"))
    category = normalize.category_for_type(property_type).lower()
    title = redact_pii(_clean((rec.get("title") or {}).get("rendered")))

    loc = detail.get("location_text")
    parts = [p for p in re.split(r"[،,]", loc or "") if p.strip()]
    parts = [p.strip() for p in parts]
    city_ar = parts[-1] if parts else None
    district_raw = parts[0] if len(parts) > 1 else None
    city_id, region_id = to_catalog(city_ar) if city_ar else (None, None)
    district_ar = (find_district_in_text(district_raw or loc, city_id) if city_id else None)

    status_ar = next((n for t in _terms_of(rec, "property-status") if (n := _clean(t.get("name")))),
                      None)
    type_ar = next((n for t in _terms_of(rec, "property-type") if (n := _clean(t.get("name")))), None)

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}",
        "listing_url": rec.get("link") or f"{BASE}/?p={pid}",
        "source": SOURCE,
        "active": True,
        "title": title,
        "property_type": property_type,
        # `deal` is already provably "متاح للبيع"->Buy or "متاح للتأجير"->Rent — anything else was
        # skipped earlier with a counted reason. Written as a two-literal expression so the value
        # can never be anything else even in principle (test_deal_mapping_total.py's static check).
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar) if city_ar else None,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,          # raw source text, always kept even if unresolved
        "date_added": _clean(rec.get("date")),
        "photo_urls": photo_urls or None,
    }
    # NO PRICE FIELD EXISTS ON THIS SOURCE (checked on all 19 pages — see docstring). `found=False`
    # states that no price field was ever read, as opposed to the source stating an explicit null
    # (which is what `authoritative_absent` is for, and is deliberately NOT set here).
    row["price_evidence"] = normalize.price_evidence(
        field=None, raw=None, stored=None,
        kind="total" if deal == "Buy" else "annual", unit="total", origin="api",
        authoritative_absent=False)
    row["images_evidence"] = {"observed": True, "container_present": bool(detail.get("image_ids")),
                              "key_present": bool(photo_urls), "count": len(photo_urls or [])}

    info = {
        "source_id": pid, "status_ar": status_ar, "type_ar": type_ar,
        "location_raw": loc, "modified": _clean(rec.get("modified")),
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v is not None})
    row["source_capture"] = strip_pii_fields({
        "schema": "qmra.wp-v2-property.v1",
        **{k: rec[k] for k in _CAPTURE_KEYS if k in rec},
        "title": title, "status_ar": status_ar, "type_ar": type_ar, "location_raw": loc,
    })
    return row, category


# ── LIVENESS (measured 2026-09-25; see the docstring — a 200 is NOT "still ready" here) ────────────
def _signal(status, body, _moved) -> Optional[str]:
    """'live' | 'gone' | None — this platform's AFFIRMATIVE signal only; the shared law does the
    rest. Re-reads the SAME first-class field the mapper used to include the row in the first place,
    from a fresh GET of the post's own REST endpoint (body is that endpoint's raw JSON)."""
    if status == 404:
        try:
            code = (json.loads(body) or {}).get("code") if body else None
        except (ValueError, AttributeError):
            code = None
        return "gone" if code == "rest_post_invalid_id" else None
    if status != 200:
        return None
    try:
        rec = json.loads(body)
    except ValueError:
        return None
    if not isinstance(rec, dict):
        return None
    names = {n for t in _terms_of(rec, "property-status") if (n := _strip_marks(_clean(t.get("name"))))}
    if not names:
        return None                      # 200 but no property-status at all — no opinion
    return "live" if names & set(_READY_STATUS_TO_DEAL) else "gone"


def _make_verify_gone(control: Optional[dict]):
    def probe(ad_number: str, canary=None):
        pid = ad_number[len(PREFIX):] if ad_number.startswith(PREFIX) else ""
        if not pid:
            return "unknown", f"{ad_number!r} is not a {PREFIX}<id> ad number"
        return LivenessProbe(platform=SLUG, signal=_signal, session=session,
                             url_for=lambda _ad: f"{API}/{pid}?_embed=1",
                             canary=canary).verify_gone(ad_number)

    def canary() -> tuple[bool, str]:
        if not control:
            return False, "no row from this run to use as a positive control"
        verdict, why = probe(control["ad_number"])
        return verdict == "live", f"positive control {control['ad_number']}: {why}"

    return lambda ad_number: probe(ad_number, canary=canary)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    # begin_run BEFORE the fetch: a source that goes dark must still leave a scrape_runs row.
    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        items, complete = fetch_catalogue(s, limit=args.limit)
        if not items:
            raise RuntimeError(f"{API} returned no property posts")

        # Phase 1 — classify from the list response alone (no I/O): which posts are even ready.
        candidates: list[tuple[str, dict, str, str]] = []
        for rec in items:
            pid = _clean(rec.get("id"))
            if not pid:
                skipped["no_id"] = skipped.get("no_id", 0) + 1
                continue
            deal, reason = _status_deal(rec)
            if not deal:
                skipped[reason] = skipped.get(reason, 0) + 1
                continue
            property_type, reason = _resolved_type(rec)
            if not property_type:
                skipped[reason] = skipped.get(reason, 0) + 1
                continue
            candidates.append((pid, rec, deal, property_type))

        # Phase 2 — one batched media-ownership lookup for every candidate, then a detail fetch each.
        media_map = fetch_media_map(s, [pid for pid, _, _, _ in candidates])
        for pid, rec, deal, property_type in candidates:
            detail = fetch_detail(s, rec.get("link") or "")
            if detail is None:
                skipped["detail_unreadable"] = skipped.get("detail_unreadable", 0) + 1
                continue
            candidate_ids = set(detail["image_ids"])
            fm = rec.get("featured_media")
            if isinstance(fm, int) and fm:
                candidate_ids.add(fm)
            photo_urls = resolve_photo_urls(candidate_ids, media_map.get(pid, {}))
            row, cat = map_listing(rec, deal, property_type, detail, photo_urls)
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)

        notes = _tally(skipped)
        if skipped:
            print("  skipped (not guessed): " + notes)
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            for r0 in (res + com)[:20]:
                print(f"   {r0['ad_number']:>7} {r0['transaction_type']:4} "
                      f"{str(r0['property_type']):10} {str(r0['city_ar']):8} "
                      f"d={str(r0['district_ar'])[:14]:14} ph={len(r0.get('photo_urls') or [])}")
            return 0

        db.upsert_qmra_residential_batch(res)
        db.upsert_qmra_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table=RES_TABLE, com_table=COM_TABLE,
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all" and complete:
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in ((RES_TABLE, res), (COM_TABLE, com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        elif args.type == "all":
            print("  prune skipped: X-WP-Total did not match the rows served (incomplete catalogue)")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(items),
                             rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} complete={complete} {notes}"[:300],
                             check_tables=["qmra_residential_listings",
                                           "qmra_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                       notes=(f"{e}"[:250] + " | skips: " + (_tally(skipped) or "none"))[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
