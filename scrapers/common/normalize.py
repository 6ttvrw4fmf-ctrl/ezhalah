"""Shared helpers that turn per-platform raw fields into the canonical `listings` row.

Each scraper extracts what it can from its site, then passes raw values through these
helpers so price/area/type/city always come out in the same units and same English
canonical names the app's search engine knows.
"""
from __future__ import annotations

import re
from typing import Optional


# Arabic property-type words → canonical English types (must match the app's TYPES list
# in src/data/taxonomy.ts so the engine can filter by them).
TYPE_MAP_AR = {
    "شقة":     "Apartment",
    "شقه":     "Apartment",
    "فيلا":    "Villa",
    "فلة":     "Villa",
    "بيت":     "House",
    "منزل":    "House",
    "دور":     "Floor",
    "غرفة":    "Room",
    "غرفه":    "Room",
    "استراحة": "Rest House",
    "استراحه": "Rest House",
    "شاليه":   "Chalet",
    "مخيم":    "Camp",
    "عمارة":   "Building",
    "عماره":   "Building",
    "أرض":     "Residential Land",
    "ارض":     "Residential Land",
    "مكتب":    "Office",
    "محل":     "Shop",
    "معرض":    "Showroom",
    "مستودع":  "Warehouse",
    "ورشة":    "Workshop",
    "ورشه":    "Workshop",
    "مصنع":    "Factory",
    "مزرعة":   "Farm",
    "مزرعه":   "Farm",
    "فندق":    "Hotel",
}

# Aqar URL slug → canonical English property type (matches Ezhalah's taxonomy).
SLUG_TO_TYPE = {
    "apartment":  "Apartment",
    "villa":      "Villa",
    "floor":      "Floor",
    "house":      "House",
    "room":       "Room",
    "building":   "Building",
    "rest_house": "Rest House",
    "chalet":     "Chalet",
    "camp":       "Camp",
    "land":       "Residential Land",
    "shop":       "Shop",
    "office":     "Office",
}

# Saudi city names (Arabic) → canonical English city names from CITIES in agent SYSTEM.
CITY_MAP_AR = {
    "الرياض":          "Riyadh",
    "جدة":             "Jeddah",
    "مكة":             "Mecca",
    "مكة المكرمة":     "Mecca",
    "المدينة":         "Medina",
    "المدينة المنورة": "Medina",
    "الدمام":          "Dammam",
    "الخبر":           "Khobar",
    "الظهران":         "Dhahran",
    "الطائف":          "Taif",
    "تبوك":            "Tabuk",
    "بريدة":           "Buraidah",
    "حائل":            "Hail",
    "أبها":            "Abha",
    "ابها":            "Abha",
    "خميس مشيط":       "Khamis Mushait",
    "نجران":           "Najran",
    "جازان":           "Jazan",
    "ينبع":            "Yanbu",
    "الخرج":           "Al Kharj",
    "الأحساء":         "Al Ahsa",
    "الاحساء":         "Al Ahsa",
    "القطيف":          "Qatif",
    "الجبيل":          "Jubail",
    "عرعر":            "Arar",
    "سكاكا":           "Sakaka",
    "الباحة":          "Al Baha",
    "حفر الباطن":      "Hafar Al Batin",
}


def map_type(raw_ar: str) -> Optional[str]:
    """Look up the canonical English type from an Arabic property-type word."""
    if not raw_ar:
        return None
    raw = raw_ar.strip()
    if raw in TYPE_MAP_AR:
        return TYPE_MAP_AR[raw]
    # Tolerate phrases like "شقة للإيجار" by checking each word.
    for word, eng in TYPE_MAP_AR.items():
        if word in raw:
            return eng
    return None


def map_city(raw_ar: str) -> Optional[str]:
    """Look up the canonical English city name from an Arabic city name."""
    if not raw_ar:
        return None
    raw = raw_ar.strip()
    if raw in CITY_MAP_AR:
        return CITY_MAP_AR[raw]
    for ar, eng in CITY_MAP_AR.items():
        if ar in raw:
            return eng
    return None


def category_for_type(t: str) -> str:
    """Residential vs Commercial — same split the app's filter uses."""
    residential = {
        "Apartment", "Villa", "Floor", "House", "Room", "Building",
        "Rest House", "Chalet", "Camp", "Residential Land",
    }
    return "Residential" if t in residential else "Commercial"


_DIGITS_AR = "٠١٢٣٤٥٦٧٨٩"  # Arabic-Indic digits Aqar sometimes mixes in.
_TRANS = str.maketrans(_DIGITS_AR, "0123456789")


def to_int(raw) -> Optional[int]:
    """Parse '69,000', '69000', '٦٩٠٠٠', 'SAR 69,000', etc. → 69000. Returns None if no digits."""
    if raw is None:
        return None
    s = str(raw).translate(_TRANS)
    digits = re.sub(r"[^\d]", "", s)
    return int(digits) if digits else None


def annualize_rent(price: Optional[int], period: Optional[str]) -> Optional[int]:
    """Make sure rent is stored ANNUAL. Daily/weekly/monthly/quarterly → ×N. Annual or
    unknown → leave as-is (assume the scraper already got an annual figure).
    """
    if price is None:
        return None
    if not period:
        return price
    p = period.lower()
    if "month" in p or "شهري" in p:
        return price * 12
    if "quarter" in p or "ربع" in p:
        return price * 4
    if "week" in p or "أسبوع" in p:
        return price * 52
    if "day" in p or "يوم" in p:
        return price * 365
    return price
