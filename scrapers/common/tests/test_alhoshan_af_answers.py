"""alhoshan: facade, parking and kitchen from the record's own fields (🔬 AF engineer, 2026-10-14).

specs.direction and specs.parkingSpaces are structured but were filed only in the additional_info panel: on
10-14, 23 of 30 active ads stated a facade, 8 a parking count, and both columns were NULL on every one
(alhoshan 0 of 3 findable; 7122720: direction «north», parkingSpaces 2). specs.features is empty fleet-wide,
so kitchen comes from the record's own description, yes or nothing.
"""
import scrapers.alhoshan.run as R

REC = {"description": "شقة ارضية بالمذنب حي المنتزة غرفتين صالة مطبخ مفتوح على الصالة مقلط مجلس رجال كراج"}
SPECS = {"direction": "north", "parkingSpaces": 2, "features": []}


def test_structured_facade_and_parking_and_kitchen_from_the_words():
    assert R.af_answers(REC, SPECS) == {"direction": "شمال", "parking": True, "kitchen": True}


def test_silence_stays_unknown():
    assert R.af_answers({"description": None}, {"direction": None, "parkingSpaces": None}) == {}
    # an explicit «لا يوجد مطبخ» is a stated no (owner 2026-10-24); parking 0 is still not an answer
    assert R.af_answers({"description": "لا يوجد مطبخ"}, {"parkingSpaces": 0}) == {"kitchen": False}


def test_a_compound_or_unknown_facade_is_not_a_facade():
    assert "direction" not in R.af_answers({}, {"direction": "north_east"})


def test_map_listing_carries_the_answers(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda *a, **k: (None, None))
    p = {"publicId": 1042, "purpose": "sale", "price": 500000, "title": "شقة",
         "specs": {**SPECS, "propertyType": "apartment", "city": "الرياض", "area": 150}, **REC}
    row, _ = R.map_listing(p)
    assert row["direction"] == "شمال" and row["parking"] is True and row["kitchen"] is True
