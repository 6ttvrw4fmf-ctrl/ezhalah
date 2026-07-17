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
    # ── Mapping standardization (2026-07-16, owner-approved) ── the أرض specializations sit BEFORE
    # the bare "أرض" key so map_type()'s substring pass (insertion-ordered) prefers the specific
    # term in phrases ("أرض زراعية للبيع" → Farm, not Residential Land). Exact inputs were already
    # safe (map_type_exact runs first); this ordering makes the PHRASE path agree. Values are the
    # owner-approved fleet-wide truths: أرض تجارية keeps eastabha's Commercial Land (promoted from
    # its override), أرض زراعية takes mustqr's Farm (matches the owner's مزرعة precedent).
    "أرض تجارية": "Commercial Land",
    "أرض زراعية": "Farm",
    "ارض زراعية": "Farm",
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
    # ── Unification additions (2026-07-16, fix/normalize-unification) ── Arabic aliases promoted
    # VERBATIM from LIVE scrapers' private maps so shared coverage/fixes propagate fleet-wide. Values
    # are existing canonical types only (no new English types). Appended at the END so map_type()'s
    # substring pass keeps every pre-existing key's priority — a promoted key can only map inputs that
    # previously returned None, never change an input that already mapped. Mirrored in
    # src/data/taxonomy.source.json python.typeMapAr (the taxonomy build gate checks lockstep).
    "شقق سكنية": "Apartment",    # eastabha
    "شقق":      "Apartment",     # eastabha
    "قصر":      "Villa",         # eastabha (owner decision 2026-07: Palace folds into Villa)
    "إستراحة":  "Rest House",    # eastabha (hamza spelling variant of استراحة)
    "محطة بنزين": "Gas Station", # eastabha
    "كافيه":    "Shop",          # eastabha
    "كافيه - لاونج": "Shop",     # eastabha
    "حوش":      "House",         # mustqr (Hail vocab: walled house/yard property)
    # ── Mapping standardization (2026-07-16, owner-approved fix/mapping-standardization) ──
    # دوبلكس/استوديو are now first-class clean types fleet-wide (searchable in both table kinds
    # post-#98; type_label_ar/known_type_ar carry both — verified live 2026-07-16). Values are
    # eastabha's (the platform that never folded them); the wasalt/aldarim Villa/Apartment folds
    # in TYPE_MAP_EN below were removed in the same pass. No substring interaction with any
    # pre-existing key (verified), so appended last per the unification convention.
    "دوبلكس":   "Duplex",
    "دوبليكس":  "Duplex",
    "استوديو":  "Studio",
    "ستوديو":   "Studio",
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
    # ── Unification additions (2026-07-16, fix/normalize-unification) ── promoted VERBATIM from
    # scrapers/eastabha/run.py's private CITY_MAP_AR (all four verified unreachable by the shared map
    # before promotion, so they can only map inputs that previously returned None). Region entries
    # added to REGION_CITIES below in lockstep. Appended LAST so existing keys keep substring priority.
    "النماص": "Al Namas", "تنومة": "Tanomah", "ظهران الجنوب": "Dhahran Al Janub", "البرك": "Al Birk",
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
             "Balsamar", "Tathlith",
             # lockstep with the 2026-07-16 CITY_MAP_AR unification additions (all four Asir; region
             # values verbatim from eastabha's private CITY_TO_REGION, agreeing with the 99-city map
             # in scrapers/wasalt/recover_other.py):
             "Al Namas", "Tanomah", "Dhahran Al Janub", "Al Birk",
             # 2026-07-16 mapping standardization: precise towns unfolded from Wasalt's
             # Khamis Mushait / Al Baha city folds (CITY_MAP_EN above + eastabha's overrides):
             "Sarat Abidah"],
    "Tabuk": ["Tabuk", "Duba", "Al Wajh", "Tayma"],
    "Hail": ["Hail", "Baqaa", "Al Ghazalah", "Ash Shanan"],
    "Northern Borders": ["Arar", "Rafha", "Turaif"],
    "Jazan": ["Jazan", "Sabya", "Abu Arish", "Samtah", "Baysh", "Ahad Al Masarihah"],
    "Najran": ["Najran", "Sharurah"],
    "Al Bahah": ["Al Baha",
                 # 2026-07-16 mapping standardization (same pass as Sarat Abidah above):
                 "Baljurashi", "Al Aqiq"],
    "Al Jawf": ["Sakaka", "Qurayyat", "Dawmat Al Jandal"],
}
CITY_TO_REGION = {city: region for region, cities in REGION_CITIES.items() for city in cities}


def region_for_city(city: Optional[str]) -> Optional[str]:
    """Authoritative region from a canonical English city name. Returns None for unknown/'Other'
    cities — an honest NULL beats a wrong guess (and beats a leaked page-title blob)."""
    if not city:
        return None
    return CITY_TO_REGION.get(city)


def map_type_exact(raw_ar: Optional[str], overrides: Optional[dict[str, str]] = None) -> Optional[str]:
    """EXACT-match type lookup (NO substring pass): per-platform `overrides` first, then the shared
    canonical TYPE_MAP_AR.

    `overrides` is the documented per-platform escape hatch of the 2026-07-16 normalize-unification
    (locked owner rule: never guess on a mapping conflict). It holds ONLY the keys where a platform's
    owner-shipped mapping disagrees with — or must shadow — the shared map (e.g. mustqr maps the
    bare 'محطة' to "Gas Station", a judgment only safe in its Hail-brokerage context). The dict is defined IN the
    scraper, in one place, and is consulted by EXACT match only — never substring-expanded — so a
    platform quirk can never leak into other inputs, while every non-override lookup flows through
    (and automatically benefits from fixes to) the shared map."""
    if not raw_ar:
        return None
    raw = raw_ar.strip()
    if overrides and raw in overrides:
        return overrides[raw]
    return TYPE_MAP_AR.get(raw)


def map_type(raw_ar: str, overrides: Optional[dict[str, str]] = None) -> Optional[str]:
    """Look up the canonical English type from an Arabic property-type word.
    `overrides`: optional per-platform exact-match dict consulted FIRST (contract: see
    map_type_exact — conflicts only, exact-only, defined in the scraper)."""
    hit = map_type_exact(raw_ar, overrides)
    if hit:
        return hit
    if not raw_ar:
        return None
    raw = raw_ar.strip()
    # Tolerate phrases like "شقة للإيجار" by checking each word. (Shared keys only — overrides are
    # exact-match by contract, so a platform quirk never substring-matches other inputs.)
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


def map_city(raw_ar: str, overrides: Optional[dict[str, str]] = None) -> Optional[str]:
    """Look up the canonical English city name from an Arabic city name or URL slug.
    `overrides`: optional per-platform exact-match dict (matched on the raw stripped string, before
    any normalization) consulted FIRST — same contract as map_type_exact: conflicts only, defined in
    the scraper, never normalization/substring-expanded."""
    if not raw_ar:
        return None
    if overrides:
        hit = overrides.get(raw_ar.strip())
        if hit:
            return hit
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


# ═══ English-vocabulary sources (Wasalt, Aldarim) — unified 2026-07-16 (fix/normalize-unification) ═══
# Shared canonical home for the English-keyed private maps that used to live inside
# scrapers/wasalt/run.py and scrapers/aldarim/run.py — every key/value moved here VERBATIM
# (no-regression proof: scrapers/common/tests/test_normalize_unification_golden.py replays the old
# private-dict lookups and asserts byte-identical results). Matching is EXACT and case-sensitive
# (map_type_en / map_city_en have NO substring or normalization pass, unlike the Arabic
# map_type / map_city): "Apartment"-style Title-Case keys are Wasalt's propertySubType vocabulary,
# "apartment"-style lowercase keys are Aldarim's lowercased API vocabulary. The two vocabularies
# share zero literal keys with conflicting values (verified at unification time). If a future
# platform needs a DIFFERENT value for an existing key, give that scraper a per-platform overrides
# dict (contract: map_type_exact docstring) — do NOT change the shared value here.

TYPE_MAP_EN = {
    # ── Wasalt propertySubType → canonical taxonomy type (moved verbatim from scrapers/wasalt/run.py).
    # Wasalt uses DIFFERENT names than Aqar ("Office Space" not "Office", "Repair shop" not
    # "Workshop", "Station" not "Gas Station", "Booth" not "Kiosk") — without these the filter for
    # "Office" wouldn't match Wasalt's "Office Space" rows and the kept-field contract would break.
    # 2026-07-16 mapping standardization (owner-approved): 'Duplex'→'Duplex' and
    # 'Studio'/'Small apartment (studio)'→'Studio' (both clean types searchable in res+com
    # post-#98). The historical Villa/Apartment folds pre-dated Duplex/Studio existing as clean
    # types and blocked the type filter from finding these rows under their real type.
    'Apartment': 'Apartment', 'Villa': 'Villa', 'Townhouse': 'Villa', 'Duplex': 'Duplex',
    'Floor': 'Floor', 'Building': 'Building', 'Residential Building': 'Building',
    'Land': 'Residential Land', 'Residential Land': 'Residential Land', 'Plot': 'Residential Land',
    'Rest House': 'Rest House', 'Resthouse': 'Rest House', 'Chalet': 'Chalet', 'Farm': 'Farm',
    'Room': 'Room', 'Small apartment (studio)': 'Studio', 'Studio': 'Studio',
    'Office': 'Office', 'Office Space': 'Office', 'Shop': 'Shop', 'Commercial Shop': 'Shop',
    'Warehouse': 'Warehouse', 'Showroom': 'Showroom', 'Commercial Land': 'Commercial Land',
    'Commercial Building': 'Commercial Building', 'Tower': 'Commercial Building', 'Hotel': 'Hotel',
    'Workshop': 'Workshop', 'Repair shop': 'Workshop', 'Gas Station': 'Gas Station',
    'Station': 'Gas Station', 'Kiosk': 'Kiosk', 'Booth': 'Kiosk', 'Parking': 'Parking',
    'Car parking': 'Parking',
    # ── Aldarim API `type` (lowercased) → canonical taxonomy type (moved verbatim from
    # scrapers/aldarim/run.py). Land's residential/commercial split stays decided by the listing's
    # category AT THE CALL SITE in the scraper (not here).
    'land': 'Residential Land', 'villa': 'Villa', 'townhouse': 'Villa',
    'duplex': 'Duplex',  # 2026-07-16 mapping standardization: was folded to Villa (see Wasalt note above)
    'mansion': 'Villa', 'apartment': 'Apartment', 'tower_apartment': 'Apartment',
    'building_apartment': 'Apartment', 'villa_apartment': 'Apartment', 'floor': 'Floor',
    'villa_floor': 'Floor', 'building': 'Building', 'farm': 'Farm', 'istraha': 'Rest House',
    'compound': 'Compound', 'office': 'Office', 'store': 'Shop', 'storage': 'Warehouse',
    'showroom': 'Showroom', 'resort': 'Hotel', 'hotel': 'Hotel',
}

CITY_MAP_EN = {
    # ── Wasalt city spelling → canonical DB city label (moved verbatim from scrapers/wasalt/run.py).
    # Wasalt transliterates inconsistently ("Aldammam", "Makkah Al Mukarramah", "Alttayif"), so this
    # map is REQUIRED or a city search would never match the Wasalt rows. Covers the observed
    # high-volume spellings incl. the 2026-06-21 "Other"-recovery variants; unmapped → None (honest).
    'Riyadh': 'Riyadh', 'Jeddah': 'Jeddah', 'Khobar': 'Khobar', 'Al Khobar': 'Khobar',
    'Makkah Al Mukarramah': 'Mecca', 'Makkah': 'Mecca', 'Mecca': 'Mecca', 'Aldammam': 'Dammam',
    'Al Dammam': 'Dammam', 'Dammam': 'Dammam', 'Madinah': 'Medina',
    'Al Madinah Al Munawwarah': 'Medina', 'Medina': 'Medina', 'Alttayif': 'Taif',
    'Al Taif': 'Taif', 'Taif': 'Taif', 'Al Ahsa': 'Hofuf', 'Al Hofuf': 'Hofuf', 'Hofuf': 'Hofuf',
    'Alzahran': 'Dhahran', 'Dhahran': 'Dhahran', 'Khamis Mushayt': 'Khamis Mushait',
    'Khamis Mushait': 'Khamis Mushait', 'Eanizah': 'Unaizah', 'Unaizah': 'Unaizah',
    'Bariduh': 'Buraidah', 'Buraidah': 'Buraidah', 'Almuzahimih': 'Al Muzahimiyah',
    'Thawl': 'Thuwal', 'Jubail Industrial City': 'Jubail', 'Jubail': 'Jubail',
    'Al Jubail': 'Jubail', 'Alqunafdhuh': 'Al Qunfudhah', 'Al Qatif': 'Qatif', 'Qatif': 'Qatif',
    'Jazan': 'Jazan', 'Abha': 'Abha', 'Abqaiq': 'Abqaiq', 'Diriyah': 'Diriyah',
    'Al Kharj': 'Al Kharj', 'Al Baha': 'Al Baha', 'Al-Namas': 'Al Namas', 'Najran': 'Najran',
    'Tabuk': 'Tabuk', 'Hail': 'Hail', 'Arar': 'Arar', 'Sakaka': 'Sakaka', 'Yanbu': 'Yanbu',
    'Hayil': 'Hail', 'Hafar Al-Batin': 'Hafar Al Batin', 'Al Hayathem': 'Al Hayathim',
    'Al Jumum - Bahra': 'Al Jumum', 'Aljumum': 'Al Jumum', 'Ahad Rafidah': 'Ahad Rafidah',
    'Ahad Rifaydah - Al-Wadyin Station': 'Ahad Rafidah', 'Ahad Almasarihah': 'Ahad Al Masarihah',
    'Samith': 'Samtah', 'Samtah - Alqafl': 'Samtah', 'Tbwk': 'Tabuk',
    "Abu Arish - 'Abu Earish": 'Abu Arish', "Sibya'": 'Sabya', 'Ar Rass': 'Ar Rass',
    'Al Jubaylah': 'Jubail', 'Alliyth': 'Al Lith', 'Bisha': 'Bisha', "Al-Majma'Ah": 'Al Majmaah',
    'Malahum': 'Mahayel', 'Muhayil': 'Mahayel', 'Almudhanib': 'Al Mithnab',
    'King Abdullah Economic City': 'KAEC', "Biqaea'": 'Baqaa', 'Albadayie': 'Al Badai',
    "Al-Quway'Iyah": 'Al Quwayiyah', 'Al Quwayiyah - Al Ruwaydah': 'Al Quwayiyah',
    'Earear': 'Arar', 'Eafif': 'Afif', 'Al Aflaj': 'As Sulayyil', 'Wadi Ad-Dawasir': 'As Sulayyil',
    'Rabigh': 'Rabigh', 'Riyadh Al Khabra': 'Riyadh Al Khabra', 'Al Khafji': 'Khafji',
    'Dawadmi': 'Dawadmi', 'Alghat': 'Al Ghat', 'Qurayyat': 'Qurayyat', 'Sharurah': 'Sharurah',
    'Sakakah': 'Sakaka', 'Baysh': 'Baysh', 'Thadiq': 'Thadiq', 'Shaqra': 'Shaqra',
    # 2026-07-16 mapping standardization (owner-approved): keep the PRECISE town instead of folding
    # into the nearest big city — Baljurashi and Al Aqiq are their own catalog cities (both verified
    # in loc_catalog_city, and live Wasalt rows already resolve to them via the native city_ar
    # path). Al-Makhwah/Darih folds stay (not in the approved list).
    'Baljurashi': 'Baljurashi', 'Al-Makhwah': 'Al Baha', 'Al-Aqiq': 'Al Aqiq', 'Darih': 'Al Baha',
    'Nariya': 'An Nairyah', 'Aleuyun': 'Al Uyun', 'Alnabhaniyah': 'An Nabhaniyah',
    'Almajardah': 'Al Majardah', 'Al Ghazalah - Al Ghazalah': 'Al Ghazalah',
    'Al Ghazalah - Alruwduh': 'Al Ghazalah', 'Ash Shinan': 'Ash Shanan',
    'Rawdat Sudair': 'Al Majmaah', 'Ashayrah Sudair': 'Al Majmaah', 'Thuqbah': 'Khobar',
    'Al Qaisumah': 'Hafar Al Batin', 'Mahd Al Thahab': 'Mahd adh Dhahab',
    'Sarat Ubaida': 'Sarat Abidah',  # 2026-07-16 standardization: was folded to Khamis Mushait (see Baljurashi note)
    "Harimla'": 'Thadiq', 'Ramah': 'Rumah', 'Darma': 'Diriyah',
    # ── Aldarim city name_en → canonical label (moved verbatim from scrapers/aldarim/run.py; the
    # five keys Aldarim shared with Wasalt carried identical values, kept once above).
    'Al Madinah': 'Medina', "Ad Dir'iyah": 'Diriyah', 'Ad Diriyah': 'Diriyah',
    "Al 'ammariyah": 'Al Ammariyah',
}


def map_type_en(raw: Optional[str], overrides: Optional[dict[str, str]] = None) -> Optional[str]:
    """EXACT case-sensitive lookup for English-vocabulary sources: per-platform `overrides` first
    (contract: map_type_exact docstring), then the shared TYPE_MAP_EN. No substring pass — English
    words substring-match far too loosely ("Land" is inside "Commercial Land")."""
    if not raw:
        return None
    raw = raw.strip()
    if overrides and raw in overrides:
        return overrides[raw]
    return TYPE_MAP_EN.get(raw)


def map_city_en(raw: Optional[str], overrides: Optional[dict[str, str]] = None) -> Optional[str]:
    """EXACT case-sensitive canonical-city lookup for English-vocabulary sources (same contract as
    map_type_en). Unmapped → None: an honest None beats a guessed label (2026-07-10 forward-fix)."""
    if not raw:
        return None
    raw = raw.strip()
    if overrides and raw in overrides:
        return overrides[raw]
    return CITY_MAP_EN.get(raw)


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
    """Parse '69,000', '69000', '٦٩٠٠٠', 'SAR 69,000', '150588.72' → 69000 / 150588. None if no digits.

    PRICE-FIDELITY FIX (2026-07-13): the old body stripped every non-digit character, which removed the
    DECIMAL POINT along with thousands separators — so a fractional source price like DealApp's
    offers.price "150588.72" (= 162 ﷼/m² × 929.56 m²) became 15,058,872 (×100). A 1-decimal price
    became ×10. This now interprets a real decimal fraction and truncates to whole riyals (sources
    display the floored integer, e.g. DealApp shows 150,588), while still dropping thousands
    separators (',' and Arabic '٬'), currency words and symbols exactly as before.
    """
    if raw is None:
        return None
    s = str(raw).translate(_TRANS)
    # Arabic decimal separator (٫ U+066B) → '.', Arabic thousands (٬ U+066C) → drop.
    s = s.replace("٬", "").replace("٫", ".")
    # Keep only digits, ',' and '.'; drop currency words/symbols/spaces/letters.
    s = re.sub(r"[^\d.,]", "", s)
    s = s.replace(",", "")            # commas are ALWAYS thousands separators → drop
    if not re.search(r"\d", s):
        return None
    # A single decimal point with 1-2 fractional digits = a real (halala) fraction → truncate to
    # whole riyals. Anything else with dots (European '1.234.567' grouping, 3+ "decimals") → dots
    # are grouping/noise → strip them (preserves the historical integer behaviour for those inputs).
    m = re.match(r"^(\d+)\.(\d{1,2})$", s)
    if m:
        return int(m.group(1))
    s = s.replace(".", "")
    return int(s) if s else None


def to_int_numeric(v) -> Optional[int]:
    """EXACT `int(float(v))` semantics for JSON-native numeric fields, shared home for the identical
    private `_int()` helpers that lived in scrapers/aldarim/run.py and scrapers/mustqr/run.py
    (unified 2026-07-16; body preserved byte-for-byte so behaviour is provably identical).

    Treats None/""/0/"0" as no-value (these APIs use 0 as "not set"). Truncates real decimals
    toward zero (int(float("123.456")) == 123). NOT for display-text prices — "69,000" / "SAR 69,000"
    raise inside float() and come back None here; use to_int() for human-formatted price strings.
    Kept SEPARATE from to_int() on purpose: to_int() treats 3+ decimals as European digit grouping
    ("1.234" → 1234), which is correct for display text but would inflate a raw float API value —
    the exact bug class the 2026-07-13 price-fidelity fix removed. Never swap one for the other
    without a golden old-vs-new comparison over that scraper's real input shapes.
    """
    try:
        return int(float(v)) if v not in (None, "", 0, "0") else None
    except (TypeError, ValueError):
        return None

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


# ── Property age: the SHARED Saudi Arabic age vocabulary ──────────────────────────────────────────
# WHY THIS EXISTS (2026-07-17): every scraper parsed «عمر العقار» with an int-only regex of the shape
# `عمر\s*العقار[\s:]*?(\d+)`. That regex can only ever match a LATIN DIGIT, so the three non-numeric
# shapes the Saudi portals actually publish — «جديد», «سنتين», «أكثر من 10 سنوات» — were unparseable
# BY CONSTRUCTION and silently became NULL. Measured on live production: 21,035 ACTIVE aqar listings
# whose own structured block says «جديد» were stored with property_age = NULL, and aqarcity kept only
# «جديد» while dropping its other 12 values. Age coverage looked like a data-availability problem; it
# was a parser problem. (Same bug class as the already-fixed wasalt "New"->0 loss.)
#
# The vocabulary is CLOSED and SHARED — the same terms appear across aqar, aqarcity, raghdan, souq24,
# aqaratikom and dealapp, because it is standard Saudi real-estate phrasing rather than any one site's
# invention. Measured closure on live data: raghdan 283/283, aqaratikom 77/77, souq24 32/32 = 100%.
# So it lives HERE, once, and a new platform that publishes the same terms gets age for free.
#
# FIDELITY RULES (owner, 2026-07-17) — these are not style choices:
#  * «جديد» -> 0. A lexical identity, not an estimate: "new" IS new construction, which is what 0 means.
#  * «سنتين» -> 2. Lexical identity: "two years" IS 2.
#  * OPEN-ENDED BUCKETS map to the bucket FLOOR, never a midpoint: «أكثر من 10 سنوات» -> 10. The source
#    asserts "at least 10" and nothing more, so 10 is the only number it actually supports; inventing
#    12 (as the live wasalt CASE ladder does) fabricates precision the source never published and
#    breaks the standing price-fidelity rule, which governs age identically.
#  * ANYTHING NOT IN THIS TABLE RETURNS None. Never guess. An honest unknown beats a wrong age.
_AGE_VOCAB_AR = {
    "جديد": 0,
    "اقل من سنة": 0, "أقل من سنة": 0, "اقل من سنه": 0, "أقل من سنه": 0,
    "سنة": 1, "سنه": 1,
    "سنتين": 2, "سنتان": 2,
    "ثلاث سنوات": 3, "اربع سنوات": 4, "أربع سنوات": 4, "خمس سنوات": 5, "ست سنوات": 6,
    "سبع سنوات": 7, "ثمان سنوات": 8, "ثماني سنوات": 8, "تسع سنوات": 9, "عشر سنوات": 10,
    # Open-ended -> FLOOR (see fidelity rules above). Both the numeric and the spelled-out forms.
    "اكثر من عشر سنوات": 10, "أكثر من عشر سنوات": 10,
    "اكثر من 10 سنوات": 10, "أكثر من 10 سنوات": 10,
}

# Plausible human age of a building, in years. Anything outside is not an age: a build YEAR (aldarim
# stores 2026), a floor/room count, or a scraper default. Out-of-range -> None, never a "corrected" guess.
_AGE_MIN, _AGE_MAX = 0, 100


def parse_property_age(raw) -> Optional[int]:
    """Turn one raw «عمر العقار» value into an exact age in years, or None if it cannot be known.

    Accepts BOTH shapes the portals publish, because a single site mixes them:
      * a closed Arabic term  — «جديد» / «سنتين» / «أكثر من 10 سنوات»
      * a leading number      — "5", "5 سنوات", "١٠ سنوات" (Arabic-Indic digits included)

    Returns None — never a guess — for anything else, including free text, HTML, build years and
    out-of-range values. Callers MUST treat None as "unknown" and store NULL.
    """
    if raw is None:
        return None
    s = str(raw).translate(_TRANS)          # ٥ -> 5, so both digit systems take the same path
    s = re.sub(r"\s+", " ", s).strip()
    if not s:
        return None

    # Exact vocabulary hit first: it is unambiguous and outranks any digit inside the phrase — without
    # this, "أكثر من 10 سنوات" would fall through to the numeric branch and read as a precise 10 for the
    # wrong reason (and "اقل من سنة" has no digit at all).
    hit = _AGE_VOCAB_AR.get(s) if s in _AGE_VOCAB_AR else _AGE_VOCAB_AR.get(_norm_ar(s))
    if hit is None:
        # Try the vocabulary against a leading phrase, since the source block often runs the next label
        # onto the same line ("أكثر من 10 سنوات عدد الشقق 4").
        for term, years in _AGE_VOCAB_AR.items():
            if s.startswith(term) or _norm_ar(s).startswith(_norm_ar(term)):
                hit = years
                break
    if hit is not None:
        return hit

    m = re.match(r"^(\d{1,4})\b", s)        # a LEADING number only: "5 سنوات" -> 5. Never scan ahead —
    if not m:                               # a number later in the line belongs to the NEXT label.
        return None
    n = int(m.group(1))
    return n if _AGE_MIN <= n <= _AGE_MAX else None
