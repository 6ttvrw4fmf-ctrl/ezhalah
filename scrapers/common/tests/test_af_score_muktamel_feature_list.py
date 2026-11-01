"""af_score: muktamel's own feature list is its structured statement; description prose never scores a miss.

CI re-read 39231636290 (2026-10-19, 14201342): the page renders the ticked taxonomy items as
`<ul class="features-list"><li>…</li></ul>`. The 10-19 misses (re-read 39228500483) asked kitchen / parking /
private entrance from description prose («مطبخ مفتوح», «مطبخ راكب», «موقف سيارة») on ads whose list ticks none
of them: our NULL is the source's structured answer (ADVANCED_FILTER_SOURCE_TRUTH §2).
"""
from scrapers.common import af_score as A

_LIST = ('<ul class="features-list list list-icons list-secondary px-3" data-v-66ad8990>'
         + "".join(f"<li data-v-66ad8990>{x}</li>" for x in ("صرف صحي", "مياه حكومية", "كهرباء", "غرفة سائق", "مسبح",
                                                              "ديكور حديث")) + "</ul>")
AD_14201342 = _LIST + "<p>مدخلين للفيلا صالة ومجلس وغرفة طعام ومطبخ مفتوح … مسبح وموقف سيارة وغرفة سائق</p>"
TICKED = ('<ul class="features-list">' + "".join(f"<li>{x}</li>" for x in ("مطبخ مجهز", "مواقف خاصة", "مدخل مستقل",
                                                                           "مصعد", "تكييف", "مفروشة", "مدخل سيارة"))
          + "</ul>")


def _page(body):
    return {"jsonld": [{"additionalProperty": A.muktamel_props(body)}]}


def test_ticked_items_are_yes_and_everything_else_is_silent():
    page = _page(AD_14201342)
    assert A.structured_says(page, "driver_room") is True
    for f in ("kitchen", "parking", "private_entrance", "elevator", "furnished"):
        assert A.structured_says(page, f) is None, f


def test_every_mapped_label_reads_as_its_field():
    page = _page(TICKED)
    for f in ("kitchen", "parking", "private_entrance", "elevator", "air_conditioner", "furnished"):
        assert A.structured_says(page, f) is True, f


def test_prose_kitchen_on_an_unticked_ad_is_silent_not_a_miss():
    results = {"kitchen": A.WE_MISS, "parking": A.WE_MISS, "driver_room": A.WE_MISS}
    out = A.structured_only("muktamel", results, {"kitchen": None, "parking": None, "driver_room": None},
                            _page(AD_14201342))
    assert out["kitchen"] == A.PAGE_SILENT and out["parking"] == A.PAGE_SILENT
    # a ticked item we failed to store is still a real capture miss
    assert out["driver_room"] == A.WE_MISS
    assert not A.says_yes(["مطبخ مفتوح"], "kitchen", "muktamel", _page(AD_14201342))


def test_mutation_without_the_entry_the_prose_would_have_asked():
    assert A.page_says_yes(["مدخلين للفيلا صالة ومجلس وغرفة طعام ومطبخ مفتوح"], "kitchen")
