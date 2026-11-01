"""af_score: superoffice's service list and erapulse's embedded feature list are their structured statements (🔬 10-20).

ops_af_score 2026-10-20: superoffice 0 of 4 findable, parking «we miss» 5 of 5, every one asked from the description's
marketing line «نحن نقدم: … مواقف السيارات» on offices whose own `service_ul` names no parking; erapulse 0 of 4,
asked kitchen / elevator from the free «تفاصيل العقار» prose on ads whose embedded object says «"features":[]» and
«"elevator":false» (page read 2026-10-20, 648075). A structured null outranks prose (ADVANCED_FILTER_SOURCE_TRUTH §2).
"""
from scrapers.common import af_score as A

SO_K09 = ('<ul class="service_ul"><li>غرفة اجتماعات للاجتماعات عبر الإنترنت (إذا كانت متوفرة)</li><li>أثاث</li>'
          '<li>إنترنت عالي السرعه</li><li>خدمات النظافه</li></ul>'
          '<p>نحن نقدم: اتصال إنترنت عالي السرعة، خدمات الاستقبال، مناطق الانتظار، مواقف السيارات، والدعم الفني.</p>')
ERA_648075 = ('"subtype":"RESIDENTIAL","features":[],"elevator":false,'
              '"description":"تفاصيل العقار الطابق الأرضي: مجلسين مقلط صالة واسعة 3 غرف مطبخ مستودع"')


def _page(fn, body):
    return {"jsonld": [{"additionalProperty": fn(body)}]}


def test_superoffice_marketing_parking_is_silent_and_furniture_is_furnished():
    page = _page(A.superoffice_props, SO_K09)
    assert A.structured_says(page, "parking") is None
    assert A.structured_says(page, "furnished") is True
    out = A.structured_only("superoffice", {"parking": A.WE_MISS}, {"parking": None}, page)
    assert out["parking"] == A.PAGE_SILENT
    assert not A.says_yes(["نحن نقدم: مواقف السيارات"], "parking", "superoffice", page)


def test_superoffice_listed_parking_is_still_a_miss_when_we_store_nothing():
    page = _page(A.superoffice_props, '<ul class="service_ul"><li>مواقف سيارات</li></ul>')
    assert A.structured_only("superoffice", {"parking": A.WE_MISS}, {"parking": None}, page)["parking"] == A.WE_MISS


def test_erapulse_empty_features_make_prose_silent():
    page = _page(A.erapulse_props, ERA_648075)
    for f in ("kitchen", "elevator"):
        assert A.structured_says(page, f) is None, f
        assert A.structured_only("erapulse", {f: A.WE_MISS}, {f: None}, page)[f] == A.PAGE_SILENT


def test_erapulse_listed_feature_and_true_lift_are_yes():
    page = _page(A.erapulse_props, '"features":["مصعد",{"nameAr":"موقف سيارة"}],"elevator":true')
    assert A.structured_says(page, "elevator") is True and A.structured_says(page, "parking") is True


def test_erapulse_two_objects_cannot_be_attributed():
    assert A.erapulse_props('"features":["مصعد"] … "features":[]') == []
    assert A.erapulse_props('"elevator":true … "elevator":false') == []


def test_mutation_without_the_entries_the_prose_would_have_asked():
    assert A.page_says_yes(["نحن نقدم: مواقف السيارات"], "parking")
    assert A.page_says_yes(["3 غرف مطبخ مستودع"], "kitchen")
    assert A.SITE_PROPS["superoffice"] is A.superoffice_props and A.SITE_PROPS["erapulse"] is A.erapulse_props


MQ_CHIPS = ('<span class="ap-ro-field-label">خدمات العقار</span> <div class="pd-chip-row"><span class="pd-chip">كهرباء</span>'
            '<span class="pd-chip">مياه</span></div>')


def test_maqrat_prose_elevator_is_silent_against_its_chips():
    """🔬 10-23: maqrat 13605174 / 19039930 were asked elevator from «حارس ومصعدين» on ads whose chips name none."""
    page = _page(A.maqrat_props, MQ_CHIPS + "<p>عمارة هادئة حارس ومصعدين</p>")
    assert A.structured_says(page, "elevator") is None
    assert A.structured_only("maqrat", {"elevator": A.WE_MISS}, {"elevator": None}, page)["elevator"] == A.PAGE_SILENT
    assert not A.says_yes(["حارس ومصعدين"], "elevator", "maqrat", page)
    lift = _page(A.maqrat_props, MQ_CHIPS.replace("مياه", "مصعد"))
    assert A.structured_says(lift, "elevator") is True
    assert A.says_yes(["مطبخ راكب"], "kitchen", "maqrat", page)     # no structured home: prose still states it


def test_a_deed_boundary_is_not_an_amenity():
    """🔬 10-23: fursaghyr 3237533 was asked elevator from «وتمام الحد المصعد», its licence boundary text."""
    line = "الوحدة العقارية رقم 1 وتمام الحد بهو الدرج والدرج وتمام الحد المصعد وتمام الحد المنور"
    assert not A.page_says_yes([line], "elevator")
    assert A.page_says_yes(["العمارة فيها مصعد"], "elevator")


def test_a_labelled_boundary_row_is_not_an_amenity():
    """🔬 10-24: fursaghyr 4367079 was asked elevator from its «وصف الحد الغربي» detail row (run 40076306911)."""
    body = ('<li><strong>عدد الغرف:</strong> <span>5</span></li>'
            '<li><strong>وصف الحد الغربي:</strong> <span>الوحدة رقم 4 / أ والمنور رقم 2 وبيت الدرج والمصعد</span></li>'
            '<li><strong>وصف الحد الجنوبي:</strong> <span>شارع</span></li>')
    page = {"evidence_lines": ["عدد الغرف: 5", "الوحدة رقم 4 / أ والمنور رقم 2 وبيت الدرج والمصعد",
                               "العمارة فيها مصعد", "شارع واسع"], "text_head": ""}
    assert A.page_says_yes(A.page_lines(page), "elevator")
    kept = A.strip_boundary(page, body)["evidence_lines"]
    assert "الوحدة رقم 4 / أ والمنور رقم 2 وبيت الدرج والمصعد" not in kept
    assert "عدد الغرف: 5" in kept and "العمارة فيها مصعد" in kept and "شارع واسع" in kept
    only_boundary = {**page, "evidence_lines": page["evidence_lines"][:2]}
    assert A.page_says_yes(A.page_lines(only_boundary), "elevator")
    assert not A.page_says_yes(A.page_lines(A.strip_boundary(only_boundary, body)), "elevator")
