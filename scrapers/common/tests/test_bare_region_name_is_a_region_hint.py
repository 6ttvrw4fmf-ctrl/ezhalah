"""A source's bare region name («القصيم», «الشرقية») must disambiguate a twin city.

The catalog names regions «منطقة القصيم» / «المنطقة الشرقية». _hint_to_id() tried only the exact
normalised label and its «منطقة»-stripped form, so a bare «القصيم» resolved to no hint at all, and
sadiqeltajer's «القصيم - الطرفية - …» (الطرفية: Qassim 941 vs Riyadh 3874) stayed city-less and out of
search (2026-10-08, 9 listings). These run to_catalog() itself on a stub catalog."""
from scrapers.common import arabic_location as al


def _catalog(monkeypatch):
    monkeypatch.setattr(al, "_load", lambda: None)
    monkeypatch.setattr(al, "_CITY", {
        al.norm_ar("الطرفية"): [(941, 4), (3874, 1)],
        al.norm_ar("قصيباء"): [(267, 1), (764, 3), (950, 4), (2685, 8)],
        al.norm_ar("الجبيل"): [(500, 5), (501, 1)],
    })
    monkeypatch.setattr(al, "_REGION_NORM", {
        al.norm_ar("منطقة الرياض"): 1, al.norm_ar("منطقة القصيم"): 4,
        al.norm_ar("المنطقة الشرقية"): 5,
    })


def test_bare_region_names_resolve_twin_cities(monkeypatch):
    _catalog(monkeypatch)
    assert al.to_catalog("الطرفية", "القصيم") == (941, 4)
    assert al.to_catalog("قصيباء", "القصيم") == (950, 4)
    assert al.to_catalog("الجبيل", "الشرقية") == (500, 5)


def test_an_administrative_centre_is_its_seat_town(monkeypatch):
    _catalog(monkeypatch)
    assert al.to_catalog("مركز قصيباء", "القصيم") == (950, 4)
    assert al.to_catalog("مركز السيح والحجازية", "القصيم") == (None, 4)   # two towns: never guessed


def test_the_prefixed_label_and_no_hint_behave_as_before(monkeypatch):
    _catalog(monkeypatch)
    assert al.to_catalog("الطرفية", "منطقة القصيم") == (941, 4)
    assert al.to_catalog("الطرفية", None) == (None, None)          # a twin with no region stays unknown
    assert al.to_catalog("الطرفية", "تبوك") == (None, None)          # an unknown region is no hint
