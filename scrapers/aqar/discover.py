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

CITY_AR = {
    "riyadh":  "الرياض",
    "jeddah":  "جدة",
    "khobar":  "الخبر",
    "dammam":  "الدمام",
    "mecca":   "مكة",
    "medina":  "المدينة",
    "hofuf":   "الهفوف",
    "taif":    "الطائف",
    "abha":    "أبها",
    "tabuk":   "تبوك",
    "buraidah":"بريدة",
    "hail":    "حائل",
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
        for m in re.finditer(r'href="([^"]+)"', html):
            href = m.group(1)
            if not LISTING_RE.search(href):
                continue
            full = urljoin(BASE, href).split("?")[0].split("#")[0]
            if full in seen:
                continue
            seen.add(full)
            yielded += 1
            yield full
            if max_listings and yielded >= max_listings:
                return
