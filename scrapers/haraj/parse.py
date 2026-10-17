"""Haraj post -> listing fields, from the post's OWN JSON-LD RealEstateListing + the REGA licence block.

Measured 2026-10-10 / 2026-10-16 (shadow runs + a 900-post sample): every post page embeds a schema.org
RealEstateListing with name, description, datePosted, image[] (every photo of the post, in order; the
page's gallery is the same set) and offers.seller (a PERSON's name: never stored, PDPL). A LICENSED ad
(owner 2026-10-16: «licensed ads only») carries, inside that description, the block REGA's own ad
licence prints — and the page prints the licence number under the article:

    معلومات العقار حسب الرخصة          <- the licence block (values in Arabic OR in REGA's English enums:
    غرض الإعلان: Sell | بيع                «Sell», «Land», «Southern», «Electricity», «New», «Seven Year»)
    سعر الوحدة: 400000
    نوع العقار: Land | فيلا
    عمر العقار / مساحة العقار / واجهة العقار / عدد الغرف / رقم المخطط / رقم القطعة / عرض الشارع /
    استخدامات العقار / خدمات العقار / الضمانات ومدتها / الالتزامات الآخرى على العقار / وصف موقع العقار
     صاحب الترخيص : <a PERSON or office — never stored>
     تاريخ انتهاء رخصة الإعلان : 2027-08-31
    -----
    وصف موقع العقار حسب الصك           <- the DEED block: «المدينة:», «الحي:», the officer (never stored),
    المدينة: جيزان / الحي: الروابي        «عمولة نقل الملكية», and the ad's own pin
    موقع العقار على الخريطة: https://maps.google.com/?q=LAT,LNG
    ... «رقم العارض 1200001771 رقم الترخيص 7201131815» (article footer, page HTML)

SOURCE IS TRUTH: structured fields come ONLY from the licence block (or, for amenities and bathrooms, the
ad's own words, yes-only); «لا يوجد» / «-» / «none» is silence → NULL, never «no». City and district come
from the DEED lines first (the seller's free text may name another district — 11190690713 says «المحمدية 3»,
its deed says «الروابي»; the deed wins, both are kept). Pure functions — no network, no DB.
"""
from __future__ import annotations

import html as _html
import json
import re
from typing import Any, Optional

from scrapers.common.pii import redact_pii
from scrapers.common.source_pin import sa_pin

LICENCE_HEAD = "معلومات العقار حسب الرخصة"
DEED_HEAD = "وصف موقع العقار حسب الصك"
_LINE = r"[ \t]*:[ \t]*([^\n]+)"
SILENT = frozenset({"-", "--", "لا يوجد", "لايوجد", "none", "None", "null", "غير محدد", "N/A", "n/a", ""})

# Lines that name a PERSON or a person's contact (PDPL): never stored, never parsed into a fact.
_PERSON_LINE_RE = re.compile(
    r"^\s*(?:صاحب الترخيص|الموظف المسؤول عن الإعلان|رقم جوال مسؤول الإعلان|اسم المعلن|رقم المعلن|"
    r"رقم العارض|جوال|الجوال|رقم الجوال|رقم التواصل|للتواصل)\b[^\n]*$", re.M)


def _clean(v: Optional[str]) -> Optional[str]:
    v = re.sub(r"\s+", " ", (v or "")).strip()
    return None if v in SILENT else v


def _field(desc: str, label: str) -> Optional[str]:
    m = re.search(label + _LINE, desc)
    return _clean(m.group(1)) if m else None


def _num(v: Optional[str]) -> Optional[float]:
    if not v:
        return None
    v = v.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")).replace(",", "").replace("٬", "")
    m = re.fullmatch(r"\s*([0-9]+(?:\.[0-9]+)?)\s*(?:م2|م²|م|متر|m2)?\s*", v)
    return float(m.group(1)) if m else None


def ld_listing(html: str) -> Optional[dict]:
    for blob in re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', html or "", re.S):
        if "RealEstateListing" not in blob:
            continue
        try:
            d = json.loads(blob)
        except ValueError:
            continue
        if isinstance(d, dict) and d.get("@type") == "RealEstateListing":
            return d
    return None


def sections(desc: str) -> tuple[dict[str, str], dict[str, str]]:
    """(licence block, deed block) as {label: raw value}, person lines dropped. Empty dicts when absent."""
    lic: dict[str, str] = {}
    deed: dict[str, str] = {}
    i = desc.find(LICENCE_HEAD)
    if i < 0:
        return lic, deed
    j = desc.find(DEED_HEAD, i)
    lic_txt = desc[i + len(LICENCE_HEAD): j if j > 0 else len(desc)]
    deed_txt = desc[j + len(DEED_HEAD):] if j > 0 else ""
    for txt, out in ((lic_txt, lic), (deed_txt, deed)):
        txt = _PERSON_LINE_RE.sub("", txt)
        for line in txt.split("\n"):
            m = re.match(r"\s*([^:\n]{2,60}?)\s*:\s*(.*)$", line)
            if m and m.group(1).strip() not in out:
                out[m.group(1).strip()] = m.group(2).strip()
    # the pin's URL sits on the line AFTER its label
    pin = re.search(r"maps\.google\.com/\?q=(-?[0-9.]+),(-?[0-9.]+)", deed_txt or lic_txt)
    if pin:
        deed["_pin"] = f"{pin.group(1)},{pin.group(2)}"
    return lic, deed


# ── REGA's English enums (the licence platform prints either language) ──────────────────────────
DEAL = {"بيع": "Buy", "sell": "Buy", "sale": "Buy", "إيجار": "Rent", "ايجار": "Rent", "rent": "Rent"}
FACADE_EN = {"northern": "شمال", "north": "شمال", "southern": "جنوب", "south": "جنوب",
             "eastern": "شرق", "east": "شرق", "western": "غرب", "west": "غرب"}
_EN_NUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
           "nine": 9, "ten": 10}
SERVICE_COLUMNS = {
    "electricity": "electricity", "كهرباء": "electricity",
    "waters": "water_supply", "water": "water_supply", "مياه": "water_supply", "ماء": "water_supply",
    "sanitation": "sanitation", "صرف صحي": "sanitation",
    "fibreopt": "optical_fibers", "fiberopt": "optical_fibers", "fibreoptic": "optical_fibers",
    "ألياف ضوئية": "optical_fibers", "الياف ضوئية": "optical_fibers", "ألياف بصرية": "optical_fibers",
}


def deal_of(raw: Optional[str]) -> Optional[str]:
    return DEAL.get((raw or "").strip().lower())


def age_of(raw: Optional[str]) -> Optional[int]:
    """«جديد»/«New» → 0, «ثلاث سنوات», «Seven Year» → 7, «5» → 5; an open bound («أكثر من 10») → None."""
    from scrapers.common.normalize import exact_age
    v = _clean(raw)
    if not v:
        return None
    m = re.fullmatch(r"(?i)\s*(one|two|three|four|five|six|seven|eight|nine|ten)\s+years?\s*", v)
    if m:
        return _EN_NUM[m.group(1).lower()]
    return exact_age(v)


def facade_of(raw: Optional[str]) -> Optional[str]:
    """One compass facade or None. «جنوبية - شرقية» names two streets (a corner) → None, raw kept."""
    from scrapers.common.normalize import one_direction
    v = _clean(raw)
    if not v:
        return None
    words = [w for w in re.split(r"[^\w]+", v) if w]
    en = {FACADE_EN[w.lower()] for w in words if w.lower() in FACADE_EN}
    if en:
        return en.pop() if len(en) == 1 and len(words) == 1 else None
    return one_direction(v)


def services_of(raw: Optional[str]) -> dict[str, bool]:
    """A LISTED service is a yes; an unlisted one stays UNKNOWN (an unticked box is not a stated «no»)."""
    out: dict[str, bool] = {}
    for tok in re.split(r"[,،]", _clean(raw) or ""):
        t = re.sub(r"\s+", " ", tok).strip()
        col = SERVICE_COLUMNS.get(t) or SERVICE_COLUMNS.get(re.sub(r"[^a-z]", "", t.lower()))
        if col:
            out[col] = True
    return out


# «دورتين مياه», «دورتين مياة», «حمامين» — the dual form names TWO bathrooms (owner example 2026-10-16).
_BATHS_DUAL_RE = re.compile(r"(?:دورتين|دورتان|دورتي)\s*(?:ال)?مي[اآ][هة]|(?<![ء-ي])حمامين(?![ء-ي])")


def baths_of(text: Optional[str]) -> Optional[int]:
    """Bathrooms from the ad's own words: «3 دورات مياه» or the dual «دورتين مياه». Two different stated
    counts → None (never a pick)."""
    from scrapers.common.normalize import baths_from_leading_count
    t = re.sub(r"[\u064B-\u0652\u0670\u0640]", "", str(text or ""))   # «دورتَي مياه»: tashkeel off first
    found = set()
    n = baths_from_leading_count(t)
    if n:
        found.add(n)
    elif re.search(r"[\d٠-٩]{1,2}\s*(?:دورات|دورة|حمامات)\s*(?:ال)?مي[اآ][هة]", t):
        return None          # several different leading counts: the helper refused, so do we
    if _BATHS_DUAL_RE.search(t):
        found.add(2)
    return found.pop() if len(found) == 1 else None


def licence_number(page_html: str) -> Optional[str]:
    """The ad licence number exactly as the page prints it («رقم الترخيص 7201131815» in the article
    footer), else the page's own data key re_REGA_Authorization_number. One distinct value or None."""
    h = page_html or ""
    found = set(re.findall(r"رقم الترخيص\s*:?\s*(\d{10})(?!\d)", h))
    if not found:
        found = set(re.findall(r're_REGA_Authorization_number\\?",\\?"(\d{10})\\?"', h))
    return found.pop() if len(found) == 1 else None


def licence_expiry(desc: str) -> Optional[str]:
    """«تاريخ انتهاء رخصة الإعلان : 2027-08-31» → '2027-08-31' (verbatim)."""
    m = re.search(r"تاريخ انتهاء رخصة الإعلان\s*:\s*([0-9٠-٩]{4}-[0-9٠-٩]{1,2}-[0-9٠-٩]{1,2})", desc or "")
    return m.group(1).translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")) if m else None


def licence_location_ar(raw: Optional[str]) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """REGA's own «وصف موقع العقار: منطقة المدينة المنورة, المدينة المنورة, الخالدية» → (region, city,
    district) — ARABIC only (the English «Jazan Region, Jazan, Al Mohammadiyah 3» is never transliterated
    into a guess). Read only when the deed lines are absent (11190684322)."""
    parts = [x.strip() for x in re.split(r"[,،]", raw or "")]
    if len(parts) != 3 or not all(re.search(r"[ء-ي]", x) for x in parts):
        return None, None, None
    return tuple(_clean(x) for x in parts)  # type: ignore[return-value]


def strip_person_lines(desc: str) -> str:
    return _PERSON_LINE_RE.sub("", desc or "")


def parse_post(ld: dict[str, Any], page_html: str = "") -> dict[str, Any]:
    """The source's own fields. Never a seller name, never a phone (PDPL)."""
    desc = _html.unescape(ld.get("description") or "")
    lic, deed = sections(desc)
    get = lambda k: _clean(lic.get(k))  # noqa: E731
    deal_raw = get("غرض الإعلان")
    pin = (deed.get("_pin") or "").split(",") if deed.get("_pin") else None
    if not pin:
        m = re.search(r"maps\.google\.com/\?q=(-?[0-9.]+),(-?[0-9.]+)", desc)
        pin = [m.group(1), m.group(2)] if m else None
    lat, lng = sa_pin(*pin) if pin else (None, None)
    loc3 = licence_location_ar(get("وصف موقع العقار"))
    images = ld.get("image") or []
    if isinstance(images, str):
        images = [images]
    return {
        "source_url": ld.get("url"),
        "title": redact_pii(ld.get("name")),
        "description": redact_pii(strip_person_lines(desc)),
        "description_raw_lines": strip_person_lines(desc),   # for amenity reading; never stored as-is
        "date_posted": ld.get("datePosted"),
        "date_modified": ld.get("dateModified"),
        # DEED lines first (REGA's «وصف موقع العقار حسب الصك»), then the first «المدينة:» anywhere, then the
        # post's own addressLocality. District: the deed's «الحي:» ONLY (owner: never a free-text guess).
        "city_ar": _clean(deed.get("المدينة")) or loc3[1] or _field(desc, r"المدينة") or
                   ((ld.get("address") or {}).get("addressLocality")),
        "district_ar": (_clean(deed.get("الحي")) or (loc3[2] if not _clean(deed.get("المدينة")) else None))
                       if lic else _field(desc, r"الحي"),
        "post_text_district_ar": _field(desc[:desc.find(LICENCE_HEAD)] if LICENCE_HEAD in desc else desc, r"الحي"),
        "licence_location": get("وصف موقع العقار"),
        "deal": deal_of(deal_raw),
        "deal_raw": deal_raw,
        "price": _num(get("سعر الوحدة")),
        "price_raw": get("سعر الوحدة"),
        "property_type_ar": get("نوع العقار"),
        "usage_raw": get("استخدامات العقار"),
        "area_m2": _num(get("مساحة العقار")),
        "area_raw": get("مساحة العقار"),
        "age_raw": get("عمر العقار"),
        "facade_raw": get("واجهة العقار"),
        "rooms_raw": get("عدد الغرف"),
        "plan_no": get("رقم المخطط"),
        "plot_no": get("رقم القطعة"),
        "street_width_raw": get("عرض الشارع"),
        "services_raw": get("خدمات العقار"),
        "guarantees": get("الضمانات ومدتها"),
        "other_obligations": _clean(lic.get("الالتزامات الآخرى على العقار") or lic.get("الالتزامات الأخرى على العقار")),
        "transfer_commission": _clean(deed.get("عمولة نقل الملكية")),
        "licence_fields": {k: v for k, v in lic.items() if not k.startswith("_")},
        "deed_fields": {k: v for k, v in deed.items() if not k.startswith("_")},
        "licence_number": licence_number(page_html),
        "licence_expiry": licence_expiry(desc),
        "rega_block": bool(lic) or bool(deal_raw),
        "images": [u for u in dict.fromkeys(images) if isinstance(u, str) and u.startswith("http")],
        "latitude": lat,
        "longitude": lng,
    }
