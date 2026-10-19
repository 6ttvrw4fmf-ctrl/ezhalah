"""Discovery: walk Aqar.sa search pages and yield individual listing URLs.

Aqar's category pages are simple paginated HTML — no JS needed. We just look for
anchor tags whose href ends in a numeric ID (the listing id is the trailing number,
e.g. ".../...-6715936").
"""
from __future__ import annotations

import re
from typing import Iterator, Optional
from urllib.parse import urljoin

from scrapers.common.http import get
from scrapers.common.emptiness import SliceOutcome


BASE = "https://sa.aqar.fm"


# Each Aqar URL pattern below maps to a (category prefix in Arabic) + (city in Arabic).
# Add more pairs here when we expand beyond Riyadh apartments-for-rent.
CATEGORIES = {
    # The 10 residential types (rent + buy where applicable).
    ("apartment",  "rent"): "شقق-للإيجار",
    ("apartment",  "buy"):  "شقق-للبيع",
    ("villa",      "rent"): "فلل-للإيجار",
    ("villa",      "buy"):  "فلل-للبيع",
    ("floor",      "rent"): "دور-للإيجار",
    ("floor",      "buy"):  "دور-للبيع",
    ("house",      "rent"): "بيت-للإيجار",
    ("house",      "buy"):  "بيت-للبيع",
    ("room",       "rent"): "غرف-للإيجار",
    ("building",   "rent"): "عمائر-للإيجار",
    ("building",   "buy"):  "عمائر-للبيع",
    ("rest_house", "rent"): "استراحة-للإيجار",
    ("rest_house", "buy"):  "استراحة-للبيع",
    ("chalet",     "rent"): "شاليه-للإيجار",
    # No ("chalet", "buy"): aqar serves no «شاليه-للبيع» page. It failed with a non-200 in every city
    # of every sweep, so no 0-row town could ever prove its emptiness and the sweep stayed red
    # (2026-09-28; test_aqar_sweep_requests_only_pages_aqar_serves.py).
    ("camp",       "rent"): "مخيم-للإيجار",
    ("land",       "buy"):  "أراضي-للبيع",
    # ── Commercial categories (verified against Aqar's own menu). Written to the
    #    aqar_commercial_listings table by run_commercial.py. Slugs are Aqar's exact spelling. ──
    ("shop",                "rent"): "محلات-للإيجار",
    ("shop",                "buy"):  "محلات-للبيع",
    ("office",              "rent"): "مكتب-تجاري-للإيجار",
    ("office",              "buy"):  "مكاتب-للبيع",
    ("warehouse",           "rent"): "مستودع-للإيجار",
    ("warehouse",           "buy"):  "مستودعات-للبيع",
    ("workshop",            "rent"): "ورش-للإيجار",
    ("workshop",            "buy"):  "ورش-للبيع",
    ("factory",             "rent"): "مصانع-للإيجار",
    ("factory",             "buy"):  "مصانع-للبيع",
    ("hotel",               "rent"): "فنادق-للإيجار",
    ("hotel",               "buy"):  "فنادق-للبيع",
    ("gas_station",         "rent"): "محطات-للإيجار",
    ("gas_station",         "buy"):  "محطات-للبيع",
    ("health_center",       "rent"): "مستشفيات-ومراكز-صحية-للإيجار",
    ("health_center",       "buy"):  "مستشفيات-ومراكز-صحية-للبيع",
    ("farm",                "rent"): "مزارع-للإيجار",
    # «مزرعة-للبيع», SINGULAR — aqar answers the plural «مزارع-للبيع» with a 404 in every city (measured
    # 2026-10-02, all 95 + national), so farm-for-sale had never been read: 0 rows ever held, while
    # aqar publishes 844 (3/3 sampled live, priced, status 0). Rent is still the plural.
    ("farm",                "buy"):  "مزرعة-للبيع",
    ("commercial_building", "rent"): "مجمعات-للإيجار",
    ("commercial_building", "buy"):  "مجمعات-للبيع",
    # ── Niche commercial categories (Aqar's own menu slugs) ──
    ("kiosk",          "rent"): "أكشاك-للإيجار",
    ("kiosk",          "buy"):  "أكشاك-للبيع",
    ("cinema",         "rent"): "دور-سينما-للإيجار",
    ("cinema",         "buy"):  "دور-سينما-للبيع",
    ("parking",        "rent"): "مواقف-سيارات-للإيجار",
    ("parking",        "buy"):  "مواقف-سيارات-للبيع",
    ("bank",           "rent"): "صراف-وبنوك-للإيجار",
    ("bank",           "buy"):  "صراف-وبنوك-للبيع",
    ("school",         "rent"): "مدارس-للإيجار",
    ("school",         "buy"):  "مدارس-للبيع",
    ("telecom_tower",  "rent"): "أبراج-اتصالات-للإيجار",
    ("telecom_tower",  "buy"):  "أبراج-اتصالات-للبيع",
}

# The 10 RESIDENTIAL types per Ezhalah's taxonomy. Used by run.py's --all-residential mode.
RESIDENTIAL_TYPES = (
    "apartment", "villa", "floor", "house", "room",
    "building", "rest_house", "chalet", "camp", "land",
)

# The COMMERCIAL types we scrape (rent+buy each). Used by run_commercial.py.
COMMERCIAL_TYPES = (
    "shop", "office", "warehouse", "workshop", "factory",
    "hotel", "gas_station", "health_center", "farm", "commercial_building",
    "kiosk", "cinema", "parking", "bank", "school", "telecom_tower",
)

# Aqar's city URL slug must match its OWN city label exactly, or the page falls back to a national
# mix (we saw "mecca" → 4 listings because /مكة isn't a recognized filter; /مكة-المكرمة is). The holy
# cities + a few others need their FULL official names. Verified against sa.aqar.fm. (user-reported:
# Mecca/Medina/Taif barely scraped.)
# This catalog is Aqar's OWN authoritative city list, scraped directly from the location
# filter on its apartment-rent AND land-for-sale category pages (the union — land pages
# surface rural towns that have no apartments). Slugs are Aqar's exact Arabic spelling with
# spaces → hyphens; using anything else makes Aqar fall back to a national mix. ~93 towns
# across all 13 regions. (How to extend: scrape any category page's filter and add new names.)
CITY_AR = {
    # ── Riyadh region ──
    "riyadh":            "الرياض",
    "al_kharj":          "الخرج",
    "al_majmaah":        "المجمعة",
    "dawadmi":           "الدوادمي",
    "al_zulfi":          "الزلفي",
    "afif":              "عفيف",
    "al_quwayiyah":      "القويعية",
    "shaqra":            "شقراء",
    "diriyah":           "الدرعية",
    "al_muzahimiyah":    "المزاحمية",
    "thadiq":            "ثادق",
    "hawtat_bani_tamim": "حوطة-بني-تميم",
    "al_ghat":           "الغاط",
    "rumah":             "رماح",
    "al_dalam":          "الدلم",
    "al_hariq":          "الحريق",
    "al_sulayyil":       "السليل",
    "al_hayathim":       "الهياثم",
    # ── Makkah region ──
    "jeddah":            "جدة",
    "mecca":             "مكة-المكرمة",
    "taif":              "الطائف",
    "rabigh":            "رابغ",
    "al_qunfudhah":      "القنفذة",
    "kaec":              "مدينة-الملك-عبدالله-الاقتصادية",
    "thuwal":            "ثول",
    "al_jumum":          "الجموم",
    "al_kamil":          "الكامل",
    "al_lith":           "الليث",
    "turabah":           "تربه",
    "raniyah":           "رنية",
    "al_khurma":         "الخرمة",
    # ── Madinah region ──
    "medina":            "المدينة-المنورة",
    "yanbu":             "ينبع",
    "al_ula":            "العلا",
    "badr":              "بدر",
    "al_hanakiyah":      "الحناكية",
    "umluj":             "املج",
    "khaybar":           "خيبر",
    "mahd_adh_dhahab":   "مهد-الذهب",
    # ── Qassim region ──
    "buraidah":          "بريدة",
    "unaizah":           "عنيزة",
    "al_rass":           "الرس",
    "al_bukayriyah":     "البكيرية",
    "al_mithnab":        "المذنب",
    "al_badai":          "البدائع",
    "riyadh_al_khabra":  "رياض-الخبراء",
    "al_nabhaniyah":     "النبهانية",
    "al_shamasiyah":     "الشماسية",
    # ── Eastern region ──
    "dammam":            "الدمام",
    "khobar":            "الخبر",
    "dhahran":           "الظهران",
    "hofuf":             "الهفوف",
    "jubail":            "الجبيل",
    "qatif":             "القطيف",
    "hafar_al_batin":    "حفر-الباطن",
    "ras_tanura":        "راس-تنورة",
    "abqaiq":            "بقيق",
    "al_nairyah":        "النعيرية",
    "khafji":            "الخفجي",
    "sayhat":            "سيهات",
    "safwa":             "صفوى",
    "tarout":            "تاروت",
    "anak":              "عنك",
    "al_uyun":           "العيون",
    # ── Asir region ──
    "abha":              "ابها",
    "khamis_mushait":    "خميس-مشيط",
    "bisha":             "بيشة",
    "mahayel":           "محايل",
    "ahad_rafidah":      "احد-رفيده",
    "al_majardah":       "المجاردة",
    "balsamar":          "بللسمر",
    "tathlith":          "تثليث",
    # ── Tabuk region ──
    "tabuk":             "تبوك",
    "duba":              "ضبا",
    "al_wajh":           "الوجه",
    "tayma":             "تيماء",
    # ── Hail region ──
    "hail":              "حائل",
    "baqaa":             "بقعاء",
    "al_ghazalah":       "الغزالة",
    "al_shanan":         "الشنان",
    # ── Northern Borders region ──
    "arar":              "عرعر",
    "rafha":             "رفحاء",
    "turaif":            "طريف",
    # ── Jazan region ──
    "jazan":             "جازان",
    "sabya":             "صبيا",
    "abu_arish":         "ابو-عريش",
    "samtah":            "صامطة",
    "baysh":             "بيش",
    "ahad_al_masarihah": "احد-المسارحة",
    # ── Najran region ──
    "najran":            "نجران",
    "sharurah":          "شرورة",
    # ── Al Bahah region ──
    "al_baha":           "الباحة",
    # ── Al Jouf region ──
    "sakaka":            "سكاكا",
    "qurayyat":          "القريات",
    "dawmat_al_jandal":  "دومة-الجندل",
}


# A listing URL is anything that ends with a hyphen + 6+ digit numeric ID.
LISTING_RE = re.compile(r"-(\d{6,})/?$")

#: aqar's own result count for a slice, from the ItemList JSON-LD it serves on EVERY page of the
#: slice (measured 2026-10-02 on pages 1, 500, 1100, 1122 of Riyadh apartments-for-rent).
_ITEMS_RE = re.compile(r'"numberOfItems":(\d+)')
#: Listings per results page. Measured 2026-10-02: numberOfItems 22,413 -> page 1,121 carries the
#: last 13 ads and page 1,122 renders aqar's own «لا توجد نتائج», i.e. last page = ceil(n / 20).
PAGE_SIZE = 20
#: Only used when the page stops publishing numberOfItems AND the caller asked for every page
#: (max_pages <= 0). The walk still ends at the first page with nothing new; this is the backstop.
#: The largest slice measured 2026-10-02 was ~1,250 pages.
SAFETY_MAX_PAGES = 2500


def source_items(html: str) -> Optional[int]:
    """aqar's own count of ads in this slice, or None when the page does not publish it."""
    m = _ITEMS_RE.search(html or "")
    return int(m.group(1)) if m else None


#: Below this many listing links a page is simply a small town's short result set — aqar's
#: nationwide fallback always returns a FULL page (20 on every page measured 2026-08-22), so a
#: short page can never be the fallback and must never trip the guard.
_CITY_SCOPE_MIN_SAMPLE = 8


def _city_scope_norm(s: str) -> str:
    """Match a city slug against a listing URL the way aqar spells them.

    Same normalization as normalize._norm_ar (alif variants, ta marbuta, hyphens), because aqar's
    own URLs mix the forms — its slug is «ابها» while a listing path may read «أبها». Whitespace is
    dropped so a multi-word town matches inside a long slug.
    """
    for a, b in (("أ", "ا"), ("إ", "ا"), ("آ", "ا"), ("ة", "ه"), ("ى", "ي"), ("ـ", ""), ("-", " ")):
        s = s.replace(a, b)
    return s.replace(" ", "")


def _city_filter_ignored(page_links: list[str], city_ar: str) -> bool:
    """True when the source served a page that is NOT scoped to the city we asked for."""
    if len(page_links) < _CITY_SCOPE_MIN_SAMPLE:
        return False
    city = _city_scope_norm(city_ar)
    if not city:
        return False
    return not any(city in _city_scope_norm(link) for link in page_links)


def discover(
    type_key: str,
    deal_key: str,
    city_key: str,
    *,
    max_pages: int = 1,
    start_page: int = 1,
    max_listings: Optional[int] = None,
    outcome: Optional[SliceOutcome] = None,
) -> Iterator[str]:
    """Yield full listing URLs (https://sa.aqar.fm/...-NNNNNNN) for the given slice.

    Polite by default — pulls only 1 page (~30 listings) unless you raise max_pages.
    Pass start_page > 1 to walk a PAGE RANGE [start_page .. max_pages] only (batched deep
    scraping, e.g. start_page=26, max_pages=50 → pages 26–50), so deeper batches don't
    re-walk pages already covered by an earlier batch.

    max_pages <= 0 means EVERY page: the walk ends at the source's own last page,
    ceil(numberOfItems / PAGE_SIZE), read off the first page fetched. A positive max_pages is still a
    cap, and the walk never goes past the source's own last page either way (2026-10-02: the deep
    fill's fixed 150-page cap left Riyadh apartments-for-rent at 4,888 of 22,413 ads).

    Pass `outcome` (a SliceOutcome) to learn WHY a slice produced nothing. Yielding zero URLs is
    ambiguous on its own — a blocked fetch and a genuinely empty city look identical from out here —
    and that ambiguity is what kept the aqar sweep permanently red (see scrapers/common/emptiness.py).
    """
    cat_slug = CATEGORIES[(type_key, deal_key)]
    city_ar = CITY_AR[city_key]
    seen: set[str] = set()
    yielded = 0

    cap = max_pages if max_pages > 0 else SAFETY_MAX_PAGES
    last_page = cap
    page = start_page - 1
    while page < last_page:
        page += 1
        path = f"/{cat_slug}/{city_ar}" + (f"/{page}" if page > 1 else "")
        url = BASE + path
        r = get(url)
        if r is None:
            # http.get() only returns a response on HTTP 200, so None means a non-200 or a 429 that
            # survived every retry. That is BLOCKED, not empty — and the difference is the whole
            # point of recording it.
            if outcome is not None:
                outcome.note_fetch_failure()
            break
        html = r.text
        n_items = source_items(html)
        if n_items is not None:
            # The source's own page count bounds the walk. Re-read on every page, so an ad
            # published mid-walk that pushes the slice onto one more page is still read.
            last_page = min(cap, max(start_page, -(-n_items // PAGE_SIZE)))
            if outcome is not None and outcome.source_items is None:
                outcome.source_items = n_items
        # Cheap-and-effective: collect every href that looks like a listing URL.
        # We don't need a full HTML parser for this — a regex is enough.
        page_links: list[str] = []
        n_links = 0
        for m in re.finditer(r'href="([^"]+)"', html):
            href = m.group(1)
            if not LISTING_RE.search(href):
                continue
            n_links += 1
            full = urljoin(BASE, href).split("?")[0].split("#")[0]
            if full in seen or full in page_links:
                continue
            page_links.append(full)

        # CITY-SCOPE GUARD (2026-08-22). aqar answers an UNRECOGNISED city slug with a nationwide
        # feed instead of a 404 — 20 fresh listings on every page, for ever. `new_on_page == 0`
        # therefore never fires, and the slice walks all --pages (150) for all 49 categories: that
        # is exactly how five deep-fill shards burned 149.8 minutes each and were killed at the
        # timeout on 2026-08-22, while returning nothing for the town they were supposed to fill.
        # Yielding those listings would also be wrong twice over: they belong to other cities, whose
        # own slices already cover them, so every town would re-enrich the same nationwide set.
        #
        # The test is deliberately conservative — trip only when the page has a real sample AND not
        # ONE listing is in the requested city. A page with few links is a small town, not a
        # fallback (a fallback always returns a full page).
        if _city_filter_ignored(page_links, city_ar):
            if outcome is not None:
                outcome.note_city_filter_ignored()
            break

        new_on_page = 0
        for full in page_links:
            seen.add(full)
            new_on_page += 1
            yielded += 1
            yield full
            if max_listings and yielded >= max_listings:
                # Record this page before the early exit, or a slice that hit its cap would look
                # like a slice that was never fetched.
                if outcome is not None:
                    outcome.note_page(html, new_on_page)
                return
        if outcome is not None:
            outcome.note_page(html, new_on_page)
        # Exhausted: once a page yields no NEW listings, the city has no more depth in this
        # slice. Stop instead of hammering empty pages all the way to max_pages — this is what
        # lets us safely set --pages very high (e.g. 150) and let each city stop where it ends.
        # EXCEPT when the source published its own count: aqar's ordering is unstable between page
        # requests (2026-10-02: one full walk of Jeddah land-for-sale, 157 pages, returned 3,121 links
        # but 2,546 distinct ads; a second walk a minute later shared only 2,210 of them), so a page
        # made only of ads already seen is a reshuffle, not the end. Then only an EMPTY page, or the
        # source's own last page, ends the walk.
        if new_on_page == 0 and (n_items is None or n_links == 0):
            break
