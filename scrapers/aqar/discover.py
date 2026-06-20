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
    ("chalet",     "buy"):  "شاليه-للبيع",
    ("camp",       "rent"): "مخيم-للإيجار",
    ("land",       "buy"):  "أراضي-للبيع",
    # Commercial — kept for later, not part of the residential sweep.
    ("shop",       "rent"): "محلات-للإيجار",
    ("office",     "rent"): "مكتب-تجاري-للإيجار",
}

# The 10 RESIDENTIAL types per Ezhalah's taxonomy. Used by run.py's --all-residential mode.
RESIDENTIAL_TYPES = (
    "apartment", "villa", "floor", "house", "room",
    "building", "rest_house", "chalet", "camp", "land",
)

# Aqar's city URL slug must match its OWN city label exactly, or the page falls back to a national
# mix (we saw "mecca" → 4 listings because /مكة isn't a recognized filter; /مكة-المكرمة is). The holy
# cities + a few others need their FULL official names. Verified against sa.aqar.fm. (user-reported:
# Mecca/Medina/Taif barely scraped.)
CITY_AR = {
    # ── Riyadh region ──
    "riyadh":          "الرياض",
    "al_kharj":        "الخرج",
    "al_majmaah":      "المجمعة",
    "dawadmi":         "الدوادمي",
    "al_zulfi":        "الزلفي",
    "wadi_al_dawasir": "وادي-الدواسر",
    "afif":            "عفيف",
    "al_quwayiyah":    "القويعية",
    "shaqra":          "شقراء",
    # ── Makkah region ──
    "jeddah":          "جدة",
    "mecca":           "مكة-المكرمة",
    "taif":            "الطائف",
    "rabigh":          "رابغ",
    "al_qunfudhah":    "القنفذة",
    # ── Madinah region ──
    "medina":          "المدينة-المنورة",
    "yanbu":           "ينبع",
    "al_ula":          "العلا",
    "badr":            "بدر",
    # ── Qassim region ──
    "buraidah":        "بريدة",
    "unaizah":         "عنيزة",       # verified ✓
    "al_rass":         "الرس",
    "al_bukayriyah":   "البكيرية",
    "al_mithnab":      "المذنب",
    # ── Eastern region ──
    "dammam":          "الدمام",
    "khobar":          "الخبر",
    "dhahran":         "الظهران",
    "hofuf":           "الهفوف",
    "ahsa":            "الأحساء",
    "al_mubarraz":     "المبرز",
    "jubail":          "الجبيل",
    "qatif":           "القطيف",
    "hafar_al_batin":  "حفر-الباطن",  # verified ✓
    "ras_tanura":      "رأس-تنورة",
    "abqaiq":          "بقيق",
    # ── Asir region ──
    "abha":            "أبها",
    "khamis_mushait":  "خميس-مشيط",   # verified ✓
    "bisha":           "بيشة",
    "al_namas":        "النماص",
    "mahayel":         "محايل-عسير",
    # ── Tabuk region ──
    "tabuk":           "تبوك",
    "duba":            "ضباء",
    "al_wajh":         "الوجه",
    "tayma":           "تيماء",
    # ── Hail region ──
    "hail":            "حائل",
    # ── Northern Borders region ──
    "arar":            "عرعر",
    "rafha":           "رفحاء",
    "turaif":          "طريف",
    # ── Jazan region ──
    "jazan":           "جازان",
    "sabya":           "صبيا",
    "abu_arish":       "أبو-عريش",
    "samtah":          "صامطة",
    # ── Najran region ──
    "najran":          "نجران",
    "sharurah":        "شرورة",
    # ── Al Bahah region ──
    "al_baha":         "الباحة",
    "baljurashi":      "بلجرشي",
    # ── Al Jouf region ──
    "sakaka":          "سكاكا",
    "qurayyat":        "القريات",
    "dawmat_al_jandal":"دومة-الجندل",
}


# A listing URL is anything that ends with a hyphen + 6+ digit numeric ID.
LISTING_RE = re.compile(r"-(\d{6,})/?$")


def discover(
    type_key: str,
    deal_key: str,
    city_key: str,
    *,
    max_pages: int = 1,
    max_listings: Optional[int] = None,
) -> Iterator[str]:
    """Yield full listing URLs (https://sa.aqar.fm/...-NNNNNNN) for the given slice.

    Polite by default — pulls only 1 page (~30 listings) unless you raise max_pages.
    """
    cat_slug = CATEGORIES[(type_key, deal_key)]
    city_ar = CITY_AR[city_key]
    seen: set[str] = set()
    yielded = 0

    for page in range(1, max_pages + 1):
        path = f"/{cat_slug}/{city_ar}" + (f"/{page}" if page > 1 else "")
        url = BASE + path
        r = get(url)
        if r is None:
            break
        html = r.text
        # Cheap-and-effective: collect every href that looks like a listing URL.
        # We don't need a full HTML parser for this — a regex is enough.
        new_on_page = 0
        for m in re.finditer(r'href="([^"]+)"', html):
            href = m.group(1)
            if not LISTING_RE.search(href):
                continue
            full = urljoin(BASE, href).split("?")[0].split("#")[0]
            if full in seen:
                continue
            seen.add(full)
            new_on_page += 1
            yielded += 1
            yield full
            if max_listings and yielded >= max_listings:
                return
        # Exhausted: once a page yields no NEW listings, the city has no more depth in this
        # slice. Stop instead of hammering empty pages all the way to max_pages — this is what
        # lets us safely set --pages very high (e.g. 150) and let each city stop where it ends.
        if new_on_page == 0:
            break
