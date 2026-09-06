"""Azdad (ازداد العقارية) — a small, live Abha brokerage on its own Next.js + Supabase stack.
Verified live 2026-09-06 (25/25 real rows, dates spanning a full year, not the aqarnajran-style
one-day placeholder batch this session learned to check for).

Pins the decisions that would silently corrupt data if a future edit got them wrong:
  - «category» is a small closed vocabulary, exact-match only (not normalize.map_type()'s fuzzy
    pass — remal's own file already flagged that pass as unsafe for a vocabulary this size).
  - bare «أرض» (Land, no سكني/تجاري qualifier) is resolved from the listing's OWN description when
    it states one, refused (skipped) when it doesn't — never guessed.
  - «status» is an ALLOWLIST (only متاح is active), so an unrecognised future status defaults to
    inactive, never to shown.
  - CITY has no dedicated column — extracted from the free-text «location» field by matching
    against the exact names the source (and the site's own title) uses, never defaulted; a location
    naming neither Abha nor a known Abha district correctly resolves to no city.
  - DISTRICT comes from the already-clean «district» column only — never invented from «location»
    the way bahadhabab's had to be, because this source structures it separately.
  - PRICE is stored EXACTLY as published, including an implausible-looking real outlier (price: 1).
  - extras are opt-in features: absence is UNKNOWN, never a manufactured "no".
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))
import scrapers.common.arabic_location as _al  # noqa: E402
_al.to_catalog = lambda city_ar, region_hint=None: (None, None)

from scrapers.azdad import run  # noqa: E402


def _post(**overrides):
    L = {"id": "abc-123", "ad_number": "AD202509090001", "title": "t", "description": "",
         "location": "ابها - البديع", "district": None, "category": "شقة", "type": "للإيجار",
         "status": "متاح", "area": 150, "rooms": 3, "bathrooms": 2, "floor": None,
         "price": None, "monthly_rent": 2000, "yearly_rent": 24000,
         "images": [], "video_url": None, "extras": None, "ad_license": None,
         "owner_phone": "0500000000", "owner_name": "secret", "advertiser_id": "adv-1"}
    L.update(overrides)
    return run.map_listing(L)

# ── 1. TYPE — exact match, and bare «أرض» resolved from description or refused ─────────────────
row, cat = _post(category="شقة"); assert row["property_type"] == "Apartment" and cat == "residential"
row, cat = _post(category="عمائر سكنية"); assert row["property_type"] == "Building" and cat == "residential"
row, cat = _post(category="أراضي سكنية"); assert row["property_type"] == "Residential Land" and cat == "residential"
row, cat = _post(category="أراضي تجارية"); assert row["property_type"] == "Commercial Land" and cat == "commercial"

# bare «أرض» — resolved from description when it states سكني/تجاري (the measured live case)
row, cat = _post(category="أرض", description="ارض سكنية مخطط المنح 1825 شمال ابها", type="للبيع")
assert row["property_type"] == "Residential Land" and cat == "residential"
row, cat = _post(category="أرض", description="ارض تجارية موقع مميز", type="للبيع")
assert row["property_type"] == "Commercial Land" and cat == "commercial"
# bare «أرض» with NEITHER word (the other measured live case) is refused, never guessed
row, _ = _post(category="أرض", description="ارض للبيع مساحتها ٤١٦م", type="للبيع")
assert row is None
# a category this platform has never published is refused the same way
row, _ = _post(category="كشك تجاري")
assert row is None

# ── 2. DEAL — exact match only ──────────────────────────────────────────────────────────────────
row, _ = _post(type="للإيجار"); assert row["transaction_type"] == "Rent"
row, _ = _post(type="للبيع", price=100); assert row["transaction_type"] == "Buy"
row, _ = _post(type="غير ذلك"); assert row is None

# ── 3. STATUS — allowlist, not a denylist ───────────────────────────────────────────────────────
row, _ = _post(status="متاح"); assert row["active"] is True
row, _ = _post(status="مباع"); assert row["active"] is False
row, _ = _post(status="مؤجر"); assert row["active"] is False  # unrecognised -> inactive, never shown
row, _ = _post(status=None); assert row["active"] is False

# ── 4. CITY — extracted from free text, never defaulted ─────────────────────────────────────────
row, _ = _post(location="ابها - البديع خلف كلية التقنية")
assert row["city_ar"] == "أبها"
assert row["city"] == "Abha"
row, _ = _post(location="المحاله")  # no «ابها» at all — still a known Abha-area district name
assert row["city_ar"] == "أبها"
row, _ = _post(location="الرياض حي العليا")  # a genuinely different city — must NOT become Abha
assert row["city_ar"] is None, "a location naming a real different city must never default to Abha"
row, _ = _post(location=None)
assert row["city_ar"] is None

# ── 5. DISTRICT — only the clean column, never invented from location ──────────────────────────
row, _ = _post(district="حي البديع", location="ابها ملاحقه للفندا بارك او عسيىر مول")
assert row["neighborhood"] == "حي البديع"
row, _ = _post(district=None, location="ابها ملاحقه للفندا بارك او عسيىر مول")
assert row["neighborhood"] is None, "district must never be guessed from the location free text"

# ── 6. PRICE = SOURCE, verbatim — including the measured implausible outlier ────────────────────
row, _ = _post(type="للبيع", category="أراضي سكنية", price=1,
                description="السوم وصل ٥٢٠ والبيع قريب")
assert row["price_total"] == 1, "a source-published price is never plausibility-gated or hidden"

# ── 7. RENT — the source's own annual figure wins verbatim; monthly is annualised only when no ──
# ── annual figure was published at all (never recomputed when both exist) ──────────────────────
row, _ = _post(monthly_rent=2166, yearly_rent=26000)  # NOT exactly monthly*12 — the source's own figure
assert row["price_annual"] == 26000 and row["rent_period"] == "annual"
row, _ = _post(monthly_rent=2000, yearly_rent=None)
assert row["price_annual"] == 24000 and row["rent_period"] == "monthly"
row, _ = _post(monthly_rent=None, yearly_rent=None, type="للإيجار")
assert row["price_annual"] is None and row["rent_period"] is None

# ── 8. EXTRAS — tri-state: absence is UNKNOWN, never a manufactured "no" ────────────────────────
row, _ = _post(extras=["مصعد راكب", "كهرباء", "قريبة من المدارس"])
assert row["elevator"] is True and row["electricity"] is True
assert "car_entrance" not in row, "an extra never listed must be absent (unknown), not False"
assert any(i["value"] == "قريبة من المدارس" for i in row["additional_info"]), \
    "an extra with no matching column belongs in additional_info, not forced onto an unrelated flag"
row, _ = _post(extras=None)
assert "elevator" not in row

# ── 9. IMAGES bind to THIS row's own array only ─────────────────────────────────────────────────
row, _ = _post(images=["https://x/a.jpg", "https://x/b.jpg"])
assert row["photo_urls"] == ["https://x/a.jpg", "https://x/b.jpg"]

# ── 10. PII never reaches source_capture ────────────────────────────────────────────────────────
row, _ = _post()
assert "owner_phone" not in row["source_capture"]
assert "owner_name" not in row["source_capture"]
assert "advertiser_id" not in row["source_capture"]
assert row["source_capture"]["ad_number"] == "AD202509090001"

print("ok: azdad's type/deal/status are exact-match with a documented refusal path, city is "
      "extracted (never defaulted) from free text, district is the clean column only, price is "
      "verbatim including the measured outlier, extras are tri-state, and PII never reaches "
      "source_capture")
