"""manafe: the building's ticked «المواصفات» / «المميزات» lists reach parking and AC (🔬 2026-11-05).

Re-read live 2026-11-05 (manafe 13707993): «<li …><i style="color:green" class="fas fa-check"></i> مواقف سيارات </li>».
0 of 73 active units carried parking while 23 buildings list it; af-score asked elevator + parking and missed.
"""
import scrapers.manafe.run as R


def _b(specs=(), features=()):
    return {"specs": list(specs), "features": list(features)}


def test_parking_and_ac_from_the_building_lists():
    a = R._building_amenities(_b(["مصعد", "تكييف مركزي"], ["بالقرب من المبني مسجد", "مواقف سيارات"]))
    assert a == {"elevator": True, "parking": True, "air_conditioner": True}


def test_basement_parking_and_split_units():
    a = R._building_amenities(_b(["مكيفات اسبليت عدد 2"], ["مواقف بدروم"]))
    assert a["parking"] is True and a["air_conditioner"] is True


def test_ac_wiring_only_is_not_ac():
    assert "air_conditioner" not in R._building_amenities(_b(["تسليك التكييف جاهز"]))


def test_silence_is_null_never_no():
    a = R._building_amenities(_b(["أسقف جبس"], ["بالقرب من المبني مطاعم"]))
    assert a == {} and False not in a.values()


def test_nearby_places_are_not_the_buildings():
    # «بالقرب من المبني …» lists what is NEAR the building
    assert R._building_amenities(_b([], ["بالقرب من المبني سوبر ماركت", "بالقرب من المبني مسجد"])) == {}


def test_parse_building_reads_both_lists_from_the_live_markup():
    page = ('<h4 class="mt-3 mb-3">المواصفات </h4><ul class="list"><li style="font-size: 17px;" class="col-sm-6 col-md-3">'
            '<i style="color:green" class="fas fa-check"></i> مصعد </li></ul>'
            '<h4 class="mt-3 mb-3">المميزات </h4><ul class="list"><li style="font-size: 17px;" class="col-sm-6 col-md-3">'
            '<i style="color:green" class="fas fa-check"></i> مواقف سيارات </li></ul>')
    b = R.parse_building(1, page)
    assert R._building_amenities(b) == {"elevator": True, "parking": True}
