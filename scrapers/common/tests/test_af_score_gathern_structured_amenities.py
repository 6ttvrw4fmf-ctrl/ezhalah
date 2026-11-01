"""af_score: gathern's «المرافق» list is its structured statement for elevator and parking (🔬, 2026-10-14).

CI source-reread 38543385427: gathern 11837661's «parking» miss was «بلكونة بها جلسة مطلة على المواقف» (a balcony
overlooking the car park) on a unit whose amenity list (serverData.data.extraDescription) names no «موقف سيارة».
"""
import json

from scrapers.common import af_score as A


def _page(labels):
    data = {"props": {"pageProps": {"serverData": {"data": {"extraDescription": [
        {"title": "المرافق", "content": labels}]}}}}}
    return f'<script id="__NEXT_DATA__" type="application/json">{json.dumps(data, ensure_ascii=False)}</script>'


def test_a_listed_label_is_a_structured_yes():
    props = A.gathern_props(_page(["بلكونة", "موقف سيارة", "مصعد"]))
    page = {"jsonld": [{"additionalProperty": props}]}
    assert A.structured_says(page, "parking") is True and A.structured_says(page, "elevator") is True


def test_prose_never_counts_for_gathern_parking_or_elevator():
    page = {"jsonld": [{"additionalProperty": A.gathern_props(_page(["بلكونة"]))}],
            "lines": ["بلكونة بها جلسة مطلة على المواقف"]}
    out = A.structured_only("gathern", {"parking": A.WE_MISS, "elevator": A.WE_MISS},
                            {"parking": None, "elevator": None}, page)
    assert out == {"parking": A.PAGE_SILENT, "elevator": A.PAGE_SILENT}
    assert not A.says_yes(["بلكونة بها جلسة مطلة على المواقف"], "parking", "gathern", page)


def test_an_unreadable_payload_states_nothing():
    assert A.gathern_props("<html></html>") == []
    assert A.gathern_props('<script id="__NEXT_DATA__">{not json</script>') == []
