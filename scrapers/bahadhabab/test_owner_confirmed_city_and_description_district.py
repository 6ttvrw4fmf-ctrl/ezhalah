"""bahadhabab publishes city:null and district:null on every one of its 71 listings — verified
live 2026-09-06, no false signal to misread (no default-pin coordinate the way danaalkhair had),
just genuine silence. Two different rules apply to the two fields:

  CITY is an OWNER-CONFIRMED BUSINESS FACT, not derived from the payload. Owner (2026-09-06):
  "this website is a brokerage in الباحة so put them all in that city ... whenever we get a new
  listing from them put it in that city." Hardcoded, unconditional, independent of anything in the
  API response — this is not an inference from ambiguous data, it is a stated fact about the
  advertiser.

  DISTRICT is read from the source's OWN free text where it states one: description_ar carries a
  hand-typed «الحي: <name>» line on 12/71 sampled rows. Where that line repeats the city as a
  trailing "- الباحة" (the same fact as the hardcoded city, not new information), the suffix is
  stripped. Where no such line exists, neighborhood stays NULL — never invented from المحافظة/
  المدينة lines that name a different town within the same province (بلجرشي, المخواة, …).
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))
import scrapers.common.arabic_location as _al  # noqa: E402
_al.to_catalog = lambda city_ar: (None, None)

from scrapers.bahadhabab import run  # noqa: E402
from scrapers.common import normalize  # noqa: E402

# ── 1. CITY IS HARDCODED, REGARDLESS OF THE PAYLOAD ─────────────────────────────────────────────
assert run.OWNER_CITY_AR == "الباحة"
assert normalize.map_city(run.OWNER_CITY_AR) == "Al Baha"


def _post(desc="", **overrides):
    L = {"id": 1, "category": "residential", "purpose": "sell", "type": "villa",
         "availability_status": "available", "city": None, "district": None,
         "selling_price": 100, "area": 50, "cover_image_url": None, "images": [],
         "description_ar": desc}
    L.update(overrides)
    return run.map_listing(L)

# city is Al Baha even when the payload's own city/district objects are None (the real shape)...
row, _ = _post()
assert row["city"] == "Al Baha"
# ...and STAYS Al Baha even if a future API response ever puts something else in city/district —
# the owner's instruction is unconditional, not "when the source says nothing".
row, _ = _post(city={"name_en": "Riyadh", "name_ar": "الرياض"})
assert row["city"] == "Al Baha", "the owner's city directive must not be overridable by the payload"

# ── 2. DISTRICT COMES FROM THE SOURCE'S OWN «الحي:» LINE, NEVER INVENTED ────────────────────────
assert run._district_from_description(None) is None
assert run._district_from_description("لا يوجد حي هنا مذكور بهذا الشكل") is None  # no label -> None

row, _ = _post(desc="أرض سكنية للبيع\n\nالحي: النسيم - الحماد\nالمدينة: الباحه")
assert row["neighborhood"] == "النسيم - الحماد"

# a trailing city repeat is stripped — it is the SAME fact as OWNER_CITY_AR, not new district info
row, _ = _post(desc="أرض للإستثمار\n\nالحي: العقيق - الباحة\nخلف مستشفى العقيق العام")
assert row["neighborhood"] == "العقيق"

# «حي:» without the «ال» prefix is the same label
row, _ = _post(desc="أرض سكنية للبيع\nحي: المثلث\nالمدينة: المخواة\nمحافظة: الباحة")
assert row["neighborhood"] == "المثلث"

# a المدينة:/المحافظة: line naming a DIFFERENT town (بلجرشي, المخواة) is NOT read as a district —
# only a حي: label is, and its absence here must not manufacture one from the wrong field.
row, _ = _post(desc="أرض سكنية للبيع\n\nالمدينة: مخطط الأشتاء\nالمحافظة: بيده - الباحة")
assert row["neighborhood"] is None

print("ok: bahadhabab's city is the owner's stated business fact (unconditional), and district is "
      "read only from the source's own حي: line, with the redundant city suffix stripped")
