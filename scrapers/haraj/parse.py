"""Haraj post -> listing fields, from the post's OWN JSON-LD RealEstateListing (backlog 311).

Measured 2026-10-10 (shadow runs): every post page embeds a schema.org RealEstateListing with name,
description, datePosted, address.addressLocality and offers.seller (a PERSON's name: never stored,
PDPL). Licensed ads carry the REGA block inside the description («غرض الإعلان: بيع», «سعر الوحدة»,
«نوع العقار», «مساحة العقار», «المدينة:», «الحي:») and often the ad's own pin as
«موقع العقار على الخريطة: https://maps.google.com/?q=LAT,LNG». Structured fields are read ONLY from
that block: a free-text post gives no price/area here (source is truth; silent -> NULL).
Pure functions — no network, no DB.
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional

from scrapers.common.pii import redact_pii
from scrapers.common.source_pin import sa_pin

_LINE = r"[ \t]*:[ \t]*([^\n]+)"


def _field(desc: str, label: str) -> Optional[str]:
    m = re.search(label + _LINE, desc)
    v = m.group(1).strip() if m else ""
    return v if v and v not in ("-", "لا يوجد", "لايوجد") else None


def _num(v: Optional[str]) -> Optional[float]:
    if not v:
        return None
    v = v.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")).replace(",", "")
    m = re.fullmatch(r"\s*([0-9]+(?:\.[0-9]+)?)\s*", v)
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


def parse_post(ld: dict[str, Any]) -> dict[str, Any]:
    """The source's own fields. Never a seller name, never a phone (PDPL)."""
    desc = ld.get("description") or ""
    deal_raw = _field(desc, r"غرض الإعلان")
    deal = {"بيع": "Buy", "إيجار": "Rent", "ايجار": "Rent"}.get((deal_raw or "").strip())
    pin = re.search(r"maps\.google\.com/\?q=(-?[0-9.]+),(-?[0-9.]+)", desc)
    lat, lng = sa_pin(*pin.groups()) if pin else (None, None)
    return {
        "source_url": ld.get("url"),
        "title": redact_pii(ld.get("name")),
        "description": redact_pii(desc),
        "date_posted": ld.get("datePosted"),
        "city_ar": _field(desc, r"المدينة") or ((ld.get("address") or {}).get("addressLocality")),
        "district_ar": _field(desc, r"الحي"),
        "deal": deal,
        "price": _num(_field(desc, r"سعر الوحدة")),
        "property_type_ar": _field(desc, r"نوع العقار"),
        "area_m2": _num(_field(desc, r"مساحة العقار")),
        "rega_block": bool(deal_raw),
        "latitude": lat,
        "longitude": lng,
    }
