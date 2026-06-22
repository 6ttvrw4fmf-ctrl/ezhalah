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
    # ── Commercial types (written to aqar_commercial_listings) ──
    "shop":                "Shop",
    "office":              "Office",
    "warehouse":           "Warehouse",
    "workshop":            "Workshop",
    "factory":             "Factory",
    "hotel":               "Hotel",
    "gas_station":         "Gas Station",
    "health_center":       "Health Center",
    "farm":                "Farm",
    "commercial_building": "Commercial Building",
    "kiosk":               "Kiosk",
    "cinema":              "Cinema",
    "parking":             "Parking",
    "bank":                "Bank",
    "school":              "School",
    "telecom_tower":       "Telecom Tower",
}

# Saudi city names (Arabic) → canonical English city names. Mirrors discover.CITY_AR (Aqar's
# own 94-city catalog) so EVERY city we scrape gets a correct English label instead of falling
# through to a default. Keys are stored space-separated; map_city() normalizes the hyphenated
# URL slug (e.g. "حفر-الباطن") to spaces before lookup, so both forms match.
CITY_MAP_AR = {
    # Riyadh region
    "الرياض": "Riyadh", "الخرج": "Al Kharj", "المجمعة": "Al Majmaah", "الدوادمي": "Dawadmi",
    "الزلفي": "Al Zulfi", "عفيف": "Afif", "القويعية": "Al Quwayiyah", "شقراء": "Shaqra",
    "الدرعية": "Diriyah", "المزاحمية": "Al Muzahimiyah", "ثادق": "Thadiq",
    "حوطة بني تميم": "Hawtat Bani Tamim", "الغاط": "Al Ghat", "رماح": "Rumah", "الدلم": "Al Dalam",
    "الحريق": "Al Hariq", "السليل": "As Sulayyil", "الهياثم": "Al Hayathim",
    # Makkah region
    "جدة": "Jeddah", "مكة": "Mecca", "مكة المكرمة": "Mecca", "الطائف": "Taif", "رابغ": "Rabigh",
    "القنفذة": "Al Qunfudhah", "مدينة الملك عبدالله الاقتصادية": "KAEC", "ثول": "Thuwal",
    "الجموم": "Al Jumum", "الكامل": "Al Kamil", "الليث": "Al Lith", "تربة": "Turabah",
    "رنية": "Raniyah", "الخرمة": "Al Khurma",
    # Madinah region
    "المدينة": "Medina", "المدينة المنورة": "Medina", "ينبع": "Yanbu", "العلا": "Al Ula",
    "بدر": "Badr", "الحناكية": "Al Hanakiyah", "أملج": "Umluj", "خيبر": "Khaybar",
    "مهد الذهب": "Mahd adh Dhahab",
    # Qassim region
    "بريدة": "Buraidah", "عنيزة": "Unaizah", "الرس": "Ar Rass", "البكيرية": "Al Bukayriyah",
    "المذنب": "Al Mithnab", "البدائع": "Al Badai", "رياض الخبراء": "Riyadh Al Khabra",
    "النبهانية": "An Nabhaniyah", "الشماسية": "Ash Shamasiyah",
    # Eastern region
    "الدمام": "Dammam", "الخبر": "Khobar", "الظهران": "Dhahran", "الهفوف": "Hofuf",
    "الأحساء": "Hofuf", "الاحساء": "Hofuf", "الجبيل": "Jubail", "القطيف": "Qatif",
    "حفر الباطن": "Hafar Al Batin", "رأس تنورة": "Ras Tanura", "راس تنورة": "Ras Tanura",
    "بقيق": "Abqaiq", "النعيرية": "An Nairyah", "الخفجي": "Khafji", "سيهات": "Sayhat",
    "صفوى": "Safwa", "تاروت": "Tarout", "عنك": "Anak", "العيون": "Al Uyun",
    # Asir region
    "أبها": "Abha", "ابها": "Abha", "خميس مشيط": "Khamis Mushait", "بيشة": "Bisha",
    "محايل": "Mahayel", "أحد رفيده": "Ahad Rafidah", "المجاردة": "Al Majardah",
    "بللسمر": "Balsamar", "تثليث": "Tathlith",
    # Tabuk region
    "تبوك": "Tabuk", "ضبا": "Duba", "الوجه": "Al Wajh", "تيماء": "Tayma",
    # Hail region
    "حائل": "Hail", "بقعاء": "Baqaa", "الغزالة": "Al Ghazalah", "الشنان": "Ash Shanan",
    # Northern Borders region
    "عرعر": "Arar", "رفحاء": "Rafha", "طريف": "Turaif",
    # Jazan region
    "جازان": "Jazan", "صبيا": "Sabya", "أبو عريش": "Abu Arish", "صامطة": "Samtah",
    "بيش": "Baysh", "أحد المسارحة": "Ahad Al Masarihah",
    # Najran region
    "نجران": "Najran", "شرورة": "Sharurah",
    # Al Bahah region
    "الباحة": "Al Baha",
    # Al Jouf region
    "سكاكا": "Sakaka", "القريات": "Qurayyat", "دومة الجندل": "Dawmat Al Jandal",
}

# English city → DB-canonical region. Built from CITY_MAP_AR's regional grouping so it stays in
# lockstep with the city catalog. region_for_city() is the AUTHORITATIVE way to set a listing's
# region: we derive it from the (reliable, URL-slug-based) city, NOT by scraping the page's
# "المنطقة" label — that label-scrape was fragile and leaked the page <title>/breadcrumb blob into
# the region field for ~2.6k Aqar listings (June 2026 region audit). City is trustworthy; region
# follows from it. Region labels here MUST match the DB exactly ("Eastern Province","Al Bahah","Al Jawf").
REGION_CITIES = {
    "Riyadh": ["Riyadh", "Al Kharj", "Al Majmaah", "Dawadmi", "Al Zulfi", "Afif", "Al Quwayiyah",
               "Shaqra", "Diriyah", "Al Muzahimiyah", "Thadiq", "Hawtat Bani Tamim", "Al Ghat",
               "Rumah", "Al Dalam", "Al Hariq", "As Sulayyil", "Al Hayathim"],
    "Makkah": ["Jeddah", "Mecca", "Taif", "Rabigh", "Al Qunfudhah", "KAEC", "Thuwal", "Al Jumum",
               "Al Kamil", "Al Lith", "Turabah", "Raniyah", "Al Khurma"],
    "Madinah": ["Medina", "Yanbu", "Al Ula", "Badr", "Al Hanakiyah", "Umluj", "Khaybar",
                "Mahd adh Dhahab"],
    "Qassim": ["Buraidah", "Unaizah", "Ar Rass", "Al Bukayriyah", "Al Mithnab", "Al Badai",
               "Riyadh Al Khabra", "An Nabhaniyah", "Ash Shamasiyah"],
    "Eastern Province": ["Dammam", "Khobar", "Dhahran", "Hofuf", "Jubail", "Qatif", "Hafar Al Batin",
                         "Ras Tanura", "Abqaiq", "An Nairyah", "Khafji", "Sayhat", "Safwa", "Tarout",
                         "Anak", "Al Uyun"],
    "Asir": ["Abha", "Khamis Mushait", "Bisha", "Mahayel", "Ahad Rafidah", "Al Majardah",
             "Balsamar", "Tathlith"],
    "Tabuk": ["Tabuk", "Duba", "Al Wajh", "Tayma"],
    "Hail": ["Hail", "Baqaa", "Al Ghazalah", "Ash Shanan"],
    "Northern Borders": ["Arar", "Rafha", "Turaif"],
    "Jazan": ["Jazan", "Sabya", "Abu Arish", "Samtah", "Baysh", "Ahad Al Masarihah"],
    "Najran": ["Najran", "Sharurah"],
    "Al Bahah": ["Al Baha"],
    "Al Jawf": ["Sakaka", "Qurayyat", "Dawmat Al Jandal"],
}
CITY_TO_REGION = {city: region for region, cities in REGION_CITIES.items() for city in cities}


def region_for_city(city: Optional[str]) -> Optional[str]:
    """Authoritative region from a canonical English city name. Returns None for unknown/'Other'
    cities — an honest NULL beats a wrong guess (and beats a leaked page-title blob)."""
    if not city:
        return None
    return CITY_TO_REGION.get(city)


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


def _norm_ar(s: str) -> str:
    """Normalize an Arabic city string for matching: hyphens → spaces, and unify the alif
    variants (أ إ آ → ا) + tatweel. Aqar URL slugs drop the hamza ("ابو-عريش") while our keys
    carry it ("أبو عريش"); without this they wouldn't match and the town fell into "Other"."""
    return (s.strip().replace("-", " ")
            .replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ـ", "")
            .replace("ة", "ه")  # تربه (slug) ↔ تربة (key) — word-final ta marbuta varies on Aqar
            .strip())


def map_city(raw_ar: str) -> Optional[str]:
    """Look up the canonical English city name from an Arabic city name or URL slug."""
    if not raw_ar:
        return None
    raw = _norm_ar(raw_ar)
    # Exact match first (normalized both sides).
    for ar, eng in CITY_MAP_AR.items():
        if _norm_ar(ar) == raw:
            return eng
    # Else longest substring match so "أحد المسارحة" isn't shadowed by a shorter token.
    best = None
    for ar, eng in CITY_MAP_AR.items():
        na = _norm_ar(ar)
        if na in raw and (best is None or len(na) > len(best[0])):
            best = (na, eng)
    return best[1] if best else None
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
