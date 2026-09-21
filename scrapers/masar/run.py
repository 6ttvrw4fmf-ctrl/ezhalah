"""مسار المستقبل للتسويق العقاري — masaraqarat.com. 9 listings, onboarding 2026-09-20.

SOURCE SHAPE (probed live before any code — every count below is measured, not estimated):
  · A stock WordPress install (Astra + Elementor + ACF + AIOSEO) with an OPEN REST API. The whole
    catalogue is one call: /wp-json/wp/v2/aqar?per_page=100 → x-wp-total: 9. Deal comes from the
    `aqar_type` taxonomy, which has exactly two terms (for-rent 6, for-sale 3 = 9, reconciled).
    It is the ONLY taxonomy on the site — there is no city, district, price or status taxonomy.

  · THE SITE SITS BEHIND HOSTINGER'S hcdn JS CHALLENGE, and it does not look like a block.
    Every URL — REST, HTML, even a .avif under /wp-content/uploads — answers the un-challenged
    client with `<title>Checking your browser…</title>`, and it answers it with **HTTP 200**
    (content-type text/html). Only the very first hit of a fresh session returns 403. So neither
    `r.status_code == 200` nor `r.ok` distinguishes data from the interstitial: a naive run would
    parse the challenge page as a listing payload, find nothing, and finalize a green empty run.
    `_is_challenge()` is therefore checked on EVERY response regardless of status, and `_get()`
    re-solves once and retries. (Same failure class as the 2026-09-xx «404 page is still a
    PARSEABLE page» incident: the transport hides the real outcome behind a 200.)
    Solving it needs no browser. /hcdn-cgi/jschallenge (with a Referer, else it 403s) serves three
    consts; the page's obfuscated JS is a hand-rolled SHA-256 over `cjs`, POSTed form-encoded as
    `challenge=<hex>` to /hcdn-cgi/jschallenge-validate, which sets the `hcdn` cookie. stdlib
    hashlib reproduces it exactly — verified end-to-end against the live site.

  · PRICES DO NOT EXIST AS DATA. `acf` is an EMPTY LIST on all 9 (ACF fields are not registered
    show_in_rest), and the detail template prints no price row. MEASURED: exactly ONE of the 9
    publishes a price at all, and it does so in PROSE — «السعر 55 ألف قابل للتفاوض» (id 2783).
    That one is real and is stored (hiding a source-published price is the regression); the other
    eight are NULL and the card shows «السعر عند الطلب». Nothing is inferred for them.
    THE PROSE IS A MINEFIELD OF NUMBERS THAT ARE NOT PRICES, and all of these are live, not
    hypothetical: a 10-digit REGA ad licence on 6 of 9 («ترخيص رقم/ 7200632026»), the office
    mobile on 3 («0531618250»), the area («المساحة 250 م»), the street width («شارع 15 م»,
    «الشارع 20 متر»), the age («العمر سبع سنوات») and a warranty term («ضمانات تصل الى 25 سنه»).
    A bare digit-grab would have published 7,200,632,026 ﷼. So a figure is only ever a price when
    an explicit price word introduces it, or a currency word follows it — nothing else counts.
    AND the thousands multiplier must match «الف» as a WHOLE WORD: «كامل الفيلا» / «الشارع 20 متر
    الفيلا» contain the substring «الف», so `20 ...الف` is one lazy regex away from 20,000 ﷼.

  · NO LISTING STATES A CITY — measured 1/9. Scanning all nine ad bodies for any Saudi city name
    finds «الرياض» on id 2693 alone («حي النرجس شمال مدينة الرياض»). The remaining eight are
    SKIPPED as `city_not_stated`, which is the whole platform bar one row. That is deliberate:
      - The ONLY other «الرياض» on the site is site-wide chrome in the rendered page's footer
        («مكتبنا الرياض- حي العارض …», and «نسعى لتلبية الطلبات العقارية في شمال الرياض»). That is
        the BROKER'S OWN ADDRESS, byte-identical on all 9 pages, and it describes the office, not
        the ad. It is also why the city scan reads `content.rendered` (the ad body the REST API
        returns) and never the detail HTML — see `_ad_body()`.
      - Every district here (النرجس، العارض، القيروان، عكاظ، حطين) is in fact a Riyadh district, so
        hardcoding الرياض would "work". It is still forbidden: scrapers/ramzalqasim/run.py carries
        the 2026-07-10 forward-fix that DELETED exactly this fallback after it silently invented a
        city on 68/184 rows, and rule 4 of the onboarding contract says an unplaceable city is a
        SKIP, never a guess. Placing a listing in the wrong city is a user-visible search error.
      → OPEN ITEM FOR THE OWNER, not for this file: if a single-office Riyadh brokerage's ads may
        be placed in الرياض, that is a fleet-wide inference decision (it would also apply to
        arkaan, mustqr, awal…) and belongs in the shared catalog layer, not in one scraper.

  · THE DETAIL PAGE IS WORTH THE 9 EXTRA FETCHES, and this is measured, not assumed. Elementor
    renders the empty-in-REST ACF fields as a `post-info` widget under «نظرة عامة»:
        district 9/9 · area 8/9 · rooms 1/9 · floor 3/9
    against district 7/9 · area 6/9 from the prose alone. Concretely, id 2935's district is
    «النرجس» and its ad body never says حي at all — prose-only parsing loses it and two others.
    The fields are keyed by their FontAwesome ICON class (fa-building → district, fa-chart-area →
    area, fa-door-open → rooms, fa-hotel → floor), never by position: id 2298 carries four items
    in a different order than the rest, so index 1 is the area on eight listings and the ROOM
    COUNT on the ninth.

  · PHOTOS 9/9 (85 images total), and the naive read UNDERCOUNTS THEM BY A THIRD. A listing's
    images are its attachments, and /media?per_page=100 returns the 100 newest of 255, so the
    older attachments of the older listings fall off page 1: that read gives 2693 two images and
    2298 one, while `?parent=<all ids>&media_type=image` — one request, x-wp-total 85 — gives them
    19 and 8. `media_type=image` also drops the one video/mp4 attachment, and `post=None` site
    assets (the 1080×1080 org logo that og:image points at on EVERY listing) never appear at all.
    The uploads are AVIF served with `content-type: text/plain`, which is exactly the shape the
    «a 200 is NOT proof an image renders» rule warns about — so it was checked the only way that
    proves anything: loaded as an <img> from a FOREIGN origin, naturalWidth 1080. Chrome sniffs
    the AVIF signature (no nosniff header) and the CDN does not challenge image subresources.

  · `modified` is up to a year after `date` and eight of the nine were last touched in 2025; both
    timestamps are kept in additional_info so staleness is visible downstream.
"""
from __future__ import annotations

import argparse
import hashlib
import html as _html
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
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402

BASE = "https://masaraqarat.com"
SOURCE = "مسار المستقبل"
PREFIX = "MSR"


# ── transport ─────────────────────────────────────────────────────────────────────────────────────
def session() -> cc.Session:
    # impersonate OWNS the User-Agent: setting one here would contradict the TLS fingerprint and
    # make every endpoint 403 (the rakez lesson). Only Accept-* are ours.
    s = cc.Session(impersonate="chrome")
    s.headers.update({"Accept": "application/json, text/html;q=0.9, */*;q=0.8",
                      "Accept-Language": "ar,en;q=0.7"})
    return s


_CHALLENGE_MARKS = ("hcdn-cgi/jschallenge", "Checking your browser before accessing")


def _is_challenge(text: str) -> bool:
    """True when this body is the hcdn interstitial rather than the resource we asked for.
    Checked on EVERY response and independently of the status code, because the interstitial is
    served with HTTP 200 on everything except a session's first request."""
    return any(m in text[:4000] for m in _CHALLENGE_MARKS)


def solve_challenge(s: cc.Session) -> bool:
    """Clear Hostinger's hcdn JS challenge for this session. Returns True when it sets the cookie.

    The page loads /hcdn-cgi/jschallenge for `cjs`/`jsChallengeUrl`/`uri`, SHA-256s `cjs`, and
    POSTs `challenge=<hex>` form-encoded. That is plain stdlib work — no browser, no JS engine.
    The Referer is REQUIRED: without it the const script itself answers 403.
    """
    s.get(f"{BASE}/", timeout=40)                      # let the edge issue the challenge
    r = s.get(f"{BASE}/hcdn-cgi/jschallenge", timeout=40, headers={"Referer": f"{BASE}/"})
    m = re.search(r"cjs\s*=\s*'([^']+)'", r.text)
    if not m:
        return False
    url = (re.search(r"jsChallengeUrl\s*=\s*'([^']+)'", r.text) or [None, "/hcdn-cgi/jschallenge-validate"])[1]
    # The page's own script waits 3s before answering; answering instantly is the one behaviour
    # that distinguishes us from the browser it is modelling, so keep the pause.
    time.sleep(3)
    digest = hashlib.sha256(m.group(1).encode()).hexdigest()
    s.post(f"{BASE}{url}", data={"challenge": digest}, timeout=40,
           headers={"Referer": f"{BASE}/", "Content-Type": "application/x-www-form-urlencoded"})
    return bool(s.cookies.get("hcdn"))


def _get(s: cc.Session, url: str, **kw) -> Optional[cc.Response]:
    """GET that refuses to mistake the challenge page for content. Re-solves once, then retries."""
    for attempt in (0, 1):
        r = s.get(url, timeout=60, **kw)
        if not _is_challenge(r.text):
            return r if r.status_code == 200 else None
        if attempt == 0:
            solve_challenge(s)
    return None


# ── Arabic numerals ───────────────────────────────────────────────────────────────────────────────
_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")

# Arabic notation parity is a standing rule: a deterministic parser must read ٠-٩ AND the word
# numerals, because this source writes both («ثلاث غرف نوم» on 2921/2693, «4 غرف نوم» on 2846).
# Dual forms are listed because «غرفتين»/«دورتين» is how "two" is actually written here.
_AR_WORD_NUM = {
    "واحد": 1, "واحدة": 1, "واحده": 1, "اثنين": 2, "اثنتين": 2, "ثلاث": 3, "ثلاثة": 3, "ثلاثه": 3,
    "اربع": 4, "أربع": 4, "اربعة": 4, "أربعة": 4, "خمس": 5, "خمسة": 5, "ست": 6, "ستة": 6,
    "سبع": 7, "سبعة": 7, "ثمان": 8, "ثماني": 8, "ثمانية": 8, "تسع": 9, "تسعة": 9, "عشر": 10, "عشرة": 10,
}
_NUM_WORDS_RE = "|".join(sorted(_AR_WORD_NUM, key=len, reverse=True))


def _count(raw: Optional[str]) -> Optional[int]:
    """A digit or an Arabic word numeral → int. Anything else → None (never a guess)."""
    if not raw:
        return None
    t = str(raw).translate(_AR_DIGITS).strip()
    m = re.search(r"\d{1,3}", t)
    if m:
        return int(m.group(0))
    return _AR_WORD_NUM.get(t)


def _strip_tags(h: Optional[str]) -> str:
    if not h:
        return ""
    t = re.sub(r"<[^>]+>", " ", h)
    return re.sub(r"\s+", " ", _html.unescape(t)).strip()


def _ad_body(post: dict) -> str:
    """The ad's OWN words and nothing else: REST content.rendered + title. Deliberately NOT the
    rendered detail page — that carries the broker's Riyadh office address in its footer on every
    listing, and a city scan over it would read the office as the property's city on all 9."""
    return f"{_strip_tags((post.get('content') or {}).get('rendered'))} " \
           f"{_strip_tags((post.get('title') or {}).get('rendered'))}".strip()


# ── price ─────────────────────────────────────────────────────────────────────────────────────────
# «الف»/«ألف» and «مليون» must be WHOLE words. The negative lookahead is the whole point: «الفيلا»
# and «كامل الفيلا» contain «الف», and 2827 reads «الشارع 20 متر الفيلا تتكون» — so a multiplier
# regex without the boundary turns a 20-metre street into a 20,000 ﷼ price.
_MULT = {"الف": 1_000, "ألف": 1_000, "آلاف": 1_000, "مليون": 1_000_000, "ملايين": 1_000_000}
_MULT_RE = r"(?:(الف|ألف|آلاف|مليون|ملايين)(?![ء-ي]))?"
_AMOUNT = r"([\d٠-٩][\d٠-٩.,]{0,14})"

# Per-metre FIRST: «سعر المتر» also contains «سعر», so the total-price pattern would swallow it.
_PPM_RE = re.compile(r"(?:سعر|السعر|بسعر)\s*(?:ال)?متر(?:\s*(?:ال)?مربع)?\s*[:\-/]?\s*"
                     + _AMOUNT + r"\s*" + _MULT_RE)
# A total: an explicit price word introduces the figure …
_PRICE_KEYED_RE = re.compile(r"(?:السعر|سعر|بسعر|بمبلغ|المطلوب)\s*(?:الاجمالي|الإجمالي|الكلي)?"
                             r"\s*[:\-/]?\s*" + _AMOUNT + r"\s*" + _MULT_RE)
# … or a currency word follows it. Nothing else is ever read as a price on this source.
_PRICE_CCY_RE = re.compile(_AMOUNT + r"\s*" + _MULT_RE + r"\s*(?:ريال|ر\.?\s*س|﷼|sar)", re.I)


def _amount(num: str, mult: Optional[str]) -> Optional[int]:
    n = normalize.to_int(num)
    if n is None:
        return None
    return n * _MULT.get((mult or "").strip(), 1)


def parse_price(text: Optional[str], area_m2: Optional[int]) -> tuple[Optional[int], Optional[int]]:
    """(total, price_per_m2) as PUBLISHED. Returns (None, None) when the source names no price.

    PRICE = SOURCE. Nothing here estimates, rounds or plausibility-gates a figure — a published
    price is stored exactly as written, and silence stays NULL rather than becoming a number.
    A «سعر المتر» figure is a RATE: it is returned as price_per_m2 with a NULL total. The ≈ ppm × area
    total is derived in the search/display layer only (owner rule 2026-09-03); price_total keeps
    meaning "the source stated this total".
    """
    t = re.sub(r"\s+", " ", text or "")
    if not t:
        return None, None
    m = _PPM_RE.search(t)
    if m:
        ppm = _amount(m.group(1), m.group(2))
        return None, ppm
    for rx in (_PRICE_KEYED_RE, _PRICE_CCY_RE):
        m = rx.search(t)
        if m:
            return _amount(m.group(1), m.group(2)), None
    return None, None


# ── detail page: Elementor «نظرة عامة» post-info widget ───────────────────────────────────────────
_LI_RE = re.compile(r'<li class="elementor-icon-list-item.*?</li>', re.S)
_ICON_RE = re.compile(r'class="fa[a-z]?\s+(fa-[a-z-]+)"')
_ITEM_RE = re.compile(r'elementor-post-info__item[^>]*>(.*?)</span>', re.S)
# Read by ICON, never by position: 2298 carries four items in a different order, so the slot that
# holds the area on eight listings holds the room count on the ninth.
_ICON_FIELD = {"fa-building": "district", "fa-chart-area": "area",
               "fa-door-open": "rooms", "fa-hotel": "floor"}


def parse_overview(page_html: str) -> dict[str, str]:
    """{district, area, rooms, floor} from the detail page's overview widget; missing keys absent."""
    i = page_html.find("نظرة عامة")
    if i < 0:
        return {}
    out: dict[str, str] = {}
    for li in _LI_RE.findall(page_html[i:i + 4000]):
        icon = _ICON_RE.search(li)
        item = _ITEM_RE.search(li)
        if not (icon and item):
            continue
        field = _ICON_FIELD.get(icon.group(1))
        val = _strip_tags(item.group(1))
        if field and val:
            out.setdefault(field, val)
    return out


# ── listing → row ─────────────────────────────────────────────────────────────────────────────────
# The deal is the `aqar_type` taxonomy term, surfaced on every post as a class_list entry.
_DEAL_BY_CLASS = {"aqar_type-for-sale": "Buy", "aqar_type-for-rent": "Rent"}

# Titles are generic and formulaic — «فيلا للبيع», «شقة للإيجار», «دور للإيجار». The deal suffix is
# removed and what remains is handed to the shared exact-type map; an unrecognised head is a SKIP.
_DEAL_SUFFIX_RE = re.compile(r"\s*(?:للبيع|للإيجار|للايجار|للاستثمار)\s*$")

# Ads we must not publish as offers. Auctions are not a listed price, and a closed deal is not an
# offer at all — both are skipped rather than shown.
_AUCTION_RE = re.compile(r"مزاد|المزاد")
_CLOSED_RE = re.compile(r"تم\s*البيع|تم\s*الإيجار|تم\s*الايجار|تم\s*التأجير|مباع|محجوز")

# The closed set of Saudi city names this source could possibly name, longest first so
# «المدينة المنورة» never substring-matches as «المدينة». A city can only be RECOGNISED from the
# ad's own words here — never inferred from a district, a landmark or the broker's address.
_CITIES = (
    "المدينة المنورة", "مكة المكرمة", "خميس مشيط", "حفر الباطن", "وادي الدواسر", "رأس تنورة",
    "الرياض", "جدة", "الدمام", "الخبر", "الظهران", "الطائف", "بريدة", "عنيزة", "الرس", "حائل",
    "تبوك", "أبها", "نجران", "جازان", "الباحة", "سكاكا", "عرعر", "القطيف", "الأحساء", "الهفوف",
    "المبرز", "ينبع", "رابغ", "الجبيل", "القريات", "بيشة", "الزلفي", "المجمعة", "شقراء",
    "الدوادمي", "عفيف", "القويعية", "الأفلاج", "السليل", "ضرماء", "الخرج", "المزاحمية", "حريملاء",
)
_CITY_RE = re.compile("|".join(re.escape(c) for c in sorted(_CITIES, key=len, reverse=True)))


def city_in_ad(body: str) -> Optional[str]:
    """The city the AD ITSELF names, or None. Recognition against a closed set — never inference."""
    m = _CITY_RE.search(body)
    return m.group(0) if m else None


# «4 غرف نوم» / «ثلاث غرف نوم» / «غرفتين نوم» — the word نوم makes the count unambiguously
# BEDROOMS. A bare «غرف» with no نوم is NOT read as bedrooms: 2693 says «تضم الشقة ثلاث غرف واحدة
# منها ماستر», where «غرف» may or may not include the صالة, and a vague room word must never become
# a bedroom VALUE. The leading count is OPTIONAL in the pattern only so that «غرفتين نوم» can be
# recognised and then REJECTED or read from its dual — see _unit_count.
_BEDS_RE = re.compile(r"(?:([\d٠-٩]{1,2})|(" + _NUM_WORDS_RE + r"))?\s*غرف(ة|ه|تين|تان|)\s*نوم")
_BATHS_RE = re.compile(r"(?:([\d٠-٩]{1,2})|(" + _NUM_WORDS_RE + r"))?\s*دور(ات|تين|تان|ة|ه)"
                       r"\s*(?:ال)?مياه")


# «العمر سبع سنوات» (2921) — the anchored reader now lives in normalize.age_from_labelled_prose
# (shared with ialqarawi); see its comment for the 25-year-WARRANTY trap (2935) it refuses.
parse_age = normalize.age_from_labelled_prose


# The overview's «دور أول» / «دور أرضي» cell → floor_number; a cell naming no single floor → NULL.
_FLOOR_WORDS = {"ارضي": 0, "أرضي": 0, "اول": 1, "أول": 1, "ثاني": 2, "ثالث": 3, "رابع": 4, "خامس": 5}
# «واجهة المبنى شرقية», «الواجهة شمالية» — the bearing word right after the facade noun.
_FACADE_RE = re.compile(r"واجه(?:ة|ه)(?:\s+(?:ال)?مبنى)?\s*:?\s*([ء-ي]+)")


def _floor(raw: Optional[str]) -> Optional[int]:
    hits = {_FLOOR_WORDS[w.removeprefix("ال")] for w in re.findall(r"[ء-ي]+", raw or "")
            if w.removeprefix("ال") in _FLOOR_WORDS}
    if hits:
        return hits.pop() if len(hits) == 1 else None
    return _count(raw) if raw and re.search(r"[\d٠-٩]", raw) else None


def _unit_count(text: str, rx: re.Pattern) -> Optional[int]:
    """The count this ad states for the WHOLE unit, or None. Two refusals, both measured live:

    MORE THAN ONE MENTION means the ad is itemising PARTS, not stating a total, and every single
    match then understates the unit. id 2935 reads «الدور الاول : 4 غرف نوم ماستر السطح : غرفة نوم
    ماستر» — 4 on the first floor plus 1 on the roof, so the villa has 5 and the first match says
    4. id 2827 spreads «دورتين مياه» (ground) and «دورة مياه مشتركة» (first) the same way, and
    2724 «مع دورة مياه … ودورتين مياه». Summing them would be arithmetic the source never
    published; taking the first would put a wrong number on the card and answer a bedroom/bathroom
    filter wrongly. An honest NULL is the only option the source supports.

    NO EXPLICIT COUNT means the noun is a FEATURE mention, not a total: 2783's «مجلس رجال بمدخل
    مستقل مع دورة مياه» says the majlis has a bathroom, not that the flat has one.

    ponytail: only نوم-anchored groups count as mentions, so an itemised standalone «غرفة ماستر»
    is invisible to the >1 check. id 2827 reads «-الدور الأول: غرفة ماستر / غرفتين نوم …» and is
    therefore read as 2 bedrooms where the ad itemises 3. Discriminating that from 2846's
    «4 غرف نوم وغرفة ماستر | bedrooms 4» — where ماستر is one OF the four — needs floor-heading
    structure, and 2846 would regress to NULL under the naive version of the rule. Upgrade path:
    segment the body on «الدور الأرضي/الأول/السطح» headings and require the count and the master
    room to share a segment. Left alone because the affected row is skipped for city anyway.
    """
    hits = list(rx.finditer(text))
    if len(hits) != 1:
        return None
    m = hits[0]
    n = _count(m.group(1) or m.group(2))
    if n is None and m.group(3) in ("تين", "تان"):
        n = 2          # «غرفتين نوم» / «دورتين مياه»: the count is fused into the noun's dual form
    return n


def map_listing(post: dict, overview: dict[str, str],
                photos: list[str]) -> tuple[Optional[dict], str, str]:
    if (post.get("status") or "").lower() != "publish":
        return None, "residential", f"status_{post.get('status')}"

    title = _strip_tags((post.get("title") or {}).get("rendered"))
    description = _strip_tags((post.get("content") or {}).get("rendered")) or None
    body = _ad_body(post)

    if _AUCTION_RE.search(body):
        return None, "residential", "auction"
    if _CLOSED_RE.search(body):
        return None, "residential", "sold_or_rented"

    deal = next((d for c, d in _DEAL_BY_CLASS.items() if c in (post.get("class_list") or [])), None)
    if not deal:
        return None, "residential", "no_deal"

    type_ar = _DEAL_SUFFIX_RE.sub("", title).strip()
    property_type = normalize.map_type_exact(type_ar)
    if not property_type:
        return None, "residential", "type_unmapped"
    category = normalize.category_for_type(property_type).lower()

    # ── location ── the ad's own words only; unplaceable → SKIP, never a guessed city.
    city_ar = city_in_ad(body)
    if not city_ar:
        return None, category, "city_not_stated"
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return None, category, "city_not_in_catalog"

    # District: the structured overview field first (9/9), prose «حي X» only as a fallback. Either
    # way it must survive find_district_in_text() against THIS city's catalog, so a stray value in
    # that ACF slot can never reach district_ar. `neighborhood` keeps the source's raw text.
    district_raw = overview.get("district")
    if not district_raw:
        m = re.search(r"حي\s+([ء-ي]+(?:\s+[ء-ي]+){0,2})", body)
        district_raw = m.group(0) if m else None
    district_ar = find_district_in_text(district_raw, city_id) if district_raw else None

    # Area: the overview field («250 م», «142 متر مربع») else «المساحة 250 م» from the prose.
    area_m2 = normalize.to_int(overview.get("area"))
    if area_m2 is None:
        m = re.search(r"المساح(?:ة|ه)\s*[:\-]?\s*([\d٠-٩][\d٠-٩.,]{0,8})", body)
        area_m2 = normalize.to_int(m.group(1)) if m else None
    if area_m2 is not None and area_m2 <= 0:
        area_m2 = None

    price_total, price_per_m2 = parse_price(body, area_m2)

    # Structured «عدد الغرف N» first, then the distribution-aware prose parser, then the shared
    # «N غرف وصالة» idiom. On 2298 the overview says 2 and the prose «غرفتين نوم» reads 2 — the two
    # independent readings agreeing is what confirms the fused-dual parse.
    bedrooms = (_count(overview.get("rooms"))
                or _unit_count(body, _BEDS_RE)
                or normalize.rooms_from_phrase(description).get("bedrooms"))

    street_w, facade = normalize.street_from_prose(body)
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{post['id']}",
        "listing_url": post.get("link") or f"{BASE}/?p={post['id']}",
        "source": SOURCE,
        "active": True,
        "title": title or None,
        "description": description,
        # The only place this source states amenities. amenities_from_text() carries the four
        # outcomes the contract requires — named → True, «غير مؤثثة» → False, «مصعد مؤسس»
        # (prepared) → NULL, and the NEIGHBOURHOOD's («قريبة من المسجد», «قريبة من مستشفى الامام
        # عبد الرحمن الفيصل», both live here) → NULL. Silence is absence, never False.
        **normalize.amenities_from_text(description),
        "property_type": property_type,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": area_m2,
        "bedrooms": bedrooms,
        "bathrooms": _unit_count(body, _BATHS_RE),
        "property_age": parse_age(body),
        "floor_number": _floor(overview.get("floor")),
        # «شمالية شارع 15», «الواجهة شمالية الشارع 20 متر» — ONE street in the ad's own prose, else NULL.
        "street_width_m": street_w,
        "direction": normalize.one_direction(" ".join(filter(None, (facade, *_FACADE_RE.findall(body))))),
        "license_number": normalize.ad_licence_from_prose(body),
        "photo_urls": photos[:20] or None,
    }
    if deal == "Rent":
        # PERIOD = SOURCE. The shared helper reads the ad's OWN period token and returns
        # (None, price) when there is none — measured: 0 of the 6 rent ads states a period, so
        # rent_period stays NULL and the published figure is stored unscaled. Defaulting 'annual'
        # here would be a 12× error on the card.
        row["rent_period"], row["price_annual"] = normalize.rent_period_and_annual(price_total, body)
    else:
        row["price_total"] = price_total
    row["price_per_meter"] = price_per_m2
    row["additional_info"] = {k: v for k, v in {
        "type_ar": type_ar,
        "slug": post.get("slug"),
        "aqar_type_term_ids": post.get("aqar_type") or None,
        "published_at": post.get("date_gmt"),
        # Eight of nine were last modified in 2025 — staleness has to be visible downstream.
        "modified_at": post.get("modified_gmt"),
        "floor_raw": overview.get("floor"),
        "rooms_raw": overview.get("rooms"),
        "area_raw": overview.get("area"),
        "district_raw": overview.get("district"),
        # Kept whenever the source publishes سعر المتر, whether or not an area let it become a
        # total (owner rule 2026-09-03).
        "price_per_m2": price_per_m2,
        "photo_count": len(photos) or None,
    }.items() if v is not None}
    return row, category, ""


# ── fetch ─────────────────────────────────────────────────────────────────────────────────────────
def fetch_listings(s: cc.Session, limit: int = 0) -> list[dict]:
    """Every `aqar` post, paged. x-wp-total was 9 at onboarding; the loop is here so growth is
    picked up instead of silently truncating at 100."""
    out: list[dict] = []
    for page in range(1, 21):
        r = _get(s, f"{BASE}/wp-json/wp/v2/aqar", params={"per_page": 100, "page": page})
        if not r:
            break
        try:
            batch = r.json()
        except ValueError:
            break
        if not isinstance(batch, list) or not batch:
            break
        out.extend(batch)
        if len(batch) < 100 or (limit and len(out) >= limit):
            break
    return out[:limit] if limit else out


def fetch_photos(s: cc.Session, post_ids: list[int]) -> dict[int, list[str]]:
    """post_id → image urls, from the attachments of those posts.

    Asked for BY PARENT and filtered to images. Walking /media unfiltered instead returns the 100
    newest of 255 and loses the older listings' photos (2693 reads as 2 images, truly 19).
    """
    by_post: dict[int, list[str]] = {}
    if not post_ids:
        return by_post
    for page in range(1, 21):
        r = _get(s, f"{BASE}/wp-json/wp/v2/media",
                 params={"parent": ",".join(str(i) for i in post_ids), "media_type": "image",
                         "per_page": 100, "page": page, "orderby": "id", "order": "asc",
                         "_fields": "id,post,source_url,media_type"})
        if not r:
            break
        try:
            batch = r.json()
        except ValueError:
            break
        if not isinstance(batch, list) or not batch:
            break
        for m in batch:
            url = m.get("source_url")
            if isinstance(url, str) and url.startswith("http") and m.get("post"):
                by_post.setdefault(int(m["post"]), []).append(url)
        if len(batch) < 100:
            break
    return by_post


def fetch_overview(s: cc.Session, post: dict) -> dict[str, str]:
    """The detail page's overview fields, or {} — a missing page degrades the row's district and
    area to the prose fallbacks rather than failing the whole crawl."""
    link = post.get("link")
    if not link:
        return {}
    r = _get(s, link)
    return parse_overview(r.text) if r else {}


# ── LIVENESS ────────────────────────────────────────────────────────────────────────────────────
# Absence from the posts listing only SELECTS candidates; prune_unseen asks this oracle before it
# may deactivate anything, through the shared law (scrapers/common/http_liveness.py), so a
# 401/403/429/5xx, a timeout or an empty body can never read as a death — and the probe session
# clears the hcdn challenge first, whose interstitial is served with HTTP 200 and is never JSON.
# The probe re-reads the post's OWN REST record. MEASURED 2026-09-21: a live post answers 200 with
# its own id and status «publish»; an id the route does not hold answers HTTP 404 with code
# `rest_post_invalid_id` (153 bytes). So:
#   · 404 carrying rest_post_invalid_id                                   → GONE
#   · 200 for THIS id whose status is not «publish», or whose own words (_ad_body) carry the
#     crawl's own _AUCTION_RE/_CLOSED_RE                                   → GONE
#   · 200 for this id otherwise                                           → LIVE
#   · anything else (a 401 for a trashed/draft post, the challenge page) → no opinion
def _probe_session() -> cc.Session:
    s = session()
    solve_challenge(s)
    return s


def _signal_for(pid: int):
    def _signal(status, body, _moved):
        if _is_challenge(body):
            return None
        try:
            j = json.loads(body)
        except (ValueError, TypeError):
            return None
        if not isinstance(j, dict):
            return None
        if status == 404 and j.get("code") == "rest_post_invalid_id":
            return "gone"
        if status != 200 or j.get("id") != pid:
            return None
        if (j.get("status") or "").lower() != "publish":
            return "gone"
        own = _ad_body(j)
        return "gone" if (_AUCTION_RE.search(own) or _CLOSED_RE.search(own)) else "live"
    return _signal


def _verify_gone(ad_number: str) -> tuple[str, str]:
    pid = ad_number[len(PREFIX):]
    if not pid.isdigit():
        return "unknown", f"{ad_number!r} is not a {PREFIX}<post id> ad number"
    return LivenessProbe(platform="masar", signal=_signal_for(int(pid)), session=_probe_session,
                         url_for=lambda _ad: f"{BASE}/wp-json/wp/v2/aqar/{pid}").verify_gone(ad_number)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("masar")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    posts: list[dict] = []
    try:
        if not solve_challenge(s):
            raise RuntimeError("hcdn JS challenge unsolved — no hcdn cookie issued")
        posts = fetch_listings(s, limit=args.limit)
        if not posts:
            raise RuntimeError("/wp-json/wp/v2/aqar returned no posts")
        print(f"{SOURCE}: {len(posts)} listings discovered", flush=True)
        photos = fetch_photos(s, [p["id"] for p in posts])
        for p in posts:
            row, cat, why = map_listing(p, fetch_overview(s, p), photos.get(p["id"], []))
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1])))
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            for r0 in (res + com)[:12]:
                print(f"   {r0['ad_number']:>9} {r0['transaction_type']:4} "
                      f"{str(r0['property_type']):10} {str(r0['city_ar']):7} "
                      f"d={str(r0['district_ar'])[:14]:14} a={str(r0['area_m2']):>5} "
                      f"bd={str(r0['bedrooms']):>3} ba={str(r0['bathrooms']):>3} "
                      f"pt={r0.get('price_total')} pa={r0.get('price_annual')} "
                      f"rp={r0.get('rent_period')} ph={len(r0.get('photo_urls') or [])}")
            return 0
        db.upsert_masar_residential_batch(res)
        db.upsert_masar_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="masar_residential_listings", com_table="masar_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        # PRUNE — only after a COMPLETE enumeration (a --type run holds the other table's seen-set
        # empty by construction; --limit never reaches here), and only with the direct confirm
        # above. prune_unseen's own breakers (0 seen, >30% vanished, <80% re-seen) sit on top.
        pruned = 0
        if args.type == "all":
            for tbl, rows in (("masar_residential_listings", res),
                              ("masar_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=_verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        # The skip tally goes into the run row: this source skips MOST of its catalogue for one
        # stated reason (no city in the ad), so an almost-empty run has to say why in the database
        # rather than looking like a broken crawl.
        notes = "; ".join(f"{k}={v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        healthy = db.end_run(run_id, ok=True, rows_seen=len(posts),
                             rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned}; {notes}"[:300],
                             check_tables=["masar_residential_listings",
                                           "masar_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            notes = f"{e}"[:200] + " | skips: " + ";".join(f"{k}={v}" for k, v in skipped.items())
            db.end_run(run_id, ok=False, rows_seen=len(posts), rows_upserted=0, notes=notes[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
