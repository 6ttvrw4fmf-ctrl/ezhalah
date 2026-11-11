"""A figure the office REMOVED must stop being served; a figure we merely failed to read must not.

2026-11-09, card-parity alarm on macsaib (alert 13960). Ad 1629 (ارض سكنية بحي الحمر مدينة بريدة,
506 m²) was stored with 550 SAR/m² from an earlier crawl. The office then removed the rate: the API
answers `"price":"0"` and `"pricePerMeter":"0"`, and the ad's own page prints «السعر للمتر: 0». The
mapper turned that zero into a plain None, the shared upsert drops a None key so that a FAILED read
cannot erase a stored value, and so every crawl since left 550 in place: the card kept showing
278,300 SAR (550 × 506) for an ad that prints no price.

A printed zero is the source speaking, not a failed read, so it is db.AUTHORITATIVE_NULL. Both
directions are executed below through the real mapper AND the real no-clobber guard:

  printed «0»            → NULL is written over the old figure
  key missing / null / ""→ the key is dropped, the stored figure survives
  a real figure          → stored as printed

Run: python scrapers/macsaib/test_stated_zero_clears_a_retracted_price.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db  # noqa: E402
import scrapers.macsaib.run as m  # noqa: E402

m.city_of = lambda *a, **k: (None, None, None)     # the location catalogue is not under test (it reads the DB)

# The real record of ad 1629 as api.taearif.com served it on 2026-11-09 (fields the mapper reads).
P_1629 = {
    "id": "1629", "slug": "ard-skny-bhy-alhmr-mdyn-bryd-1", "title": "ارض سكنية بحي الحمر مدينة بريدة",
    "district": "", "price": "0", "bedrooms": 0, "bathrooms": 0, "area": "506",
    "property_type_en": "", "transactionType_en": "sale", "listing_purpose": "sale",
    "status": "available", "createdAt": "2025-12-22T07:32:26.000000Z",
    "location": {"lat": 24.766317, "lng": 46.735797, "address": "حي الحمر"},
}
D_1629 = {**P_1629, "description": "ارض سكنية بحي الحمر مدينة بريدة", "features": [],
          "pricePerMeter": "0", "size": "506.00", "building_age": 0}


def written(p, d):
    """The columns the shared upsert would really send, after the no-clobber guard."""
    got, why = m.map_listing(p, d, "أرض")
    assert got, f"the real record no longer maps: {why}"
    row = dict(got[0])
    db._unknown_must_not_overwrite_known(row)
    return row


# 1. The office printed zero for both figures: NULL must be WRITTEN (key present, value None).
row = written(P_1629, D_1629)
assert "price_per_meter" in row and row["price_per_meter"] is None, \
    "a printed «السعر للمتر: 0» must clear the stored per-metre rate (ad 1629 kept serving 550)"
assert "price_total" in row and row["price_total"] is None, "a printed price «0» must clear a stored total"
assert row["price_evidence"]["authoritative_absent"] is True
assert row["area_m2"] == 506

# 2. Could not read it: the key must be DROPPED so a stored figure survives a bad fetch.
for unread in (None, "", "  ", "n/a"):
    r = written({**P_1629, "price": unread}, {**D_1629, "pricePerMeter": unread})
    assert "price_per_meter" not in r, f"pricePerMeter={unread!r} is a failed read, not the source's zero"
    assert "price_total" not in r, f"price={unread!r} is a failed read, not the source's zero"
gone_p = {k: v for k, v in P_1629.items() if k != "price"}
gone_d = {k: v for k, v in D_1629.items() if k not in ("price", "pricePerMeter")}
r = written(gone_p, gone_d)
assert "price_per_meter" not in r and "price_total" not in r, "a missing key is not the source's zero"

# 3. A published figure is stored exactly as printed (ad 1650 prints «السعر للمتر: 750»).
r = written({**P_1629, "price": "0"}, {**D_1629, "pricePerMeter": "750"})
assert r["price_per_meter"] == 750 and r["price_total"] is None
r = written({**P_1629, "price": "278,300"}, {**D_1629, "pricePerMeter": "0.00"})
assert r["price_total"] == 278300 and r["price_per_meter"] is None

# 4. Rent takes the same road.
rent_p = {**P_1629, "transactionType_en": "rent", "listing_purpose": "rent"}
r = written(rent_p, {**D_1629, **rent_p})
assert "price_annual" in r and r["price_annual"] is None

assert m._stated_zero("0") and m._stated_zero("0.00") and m._stated_zero(0)
assert not m._stated_zero(None) and not m._stated_zero("") and not m._stated_zero(False) and not m._stated_zero("x")

print("OK macsaib: a printed zero clears a retracted figure; an unread field never does")
