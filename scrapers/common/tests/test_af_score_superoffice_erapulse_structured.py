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
