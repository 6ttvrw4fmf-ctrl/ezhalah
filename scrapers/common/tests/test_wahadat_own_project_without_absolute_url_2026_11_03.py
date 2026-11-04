"""2026-11-03: wahadat project pages stopped carrying `absolute_url` (/project/api/projects/<uuid>/),
the anchor _main_project used to find the page's OWN project object. Every project page then read
«project_object_not_found» (120/120), three crawls stored nothing, and the off-market oracle could
never read a unit again. The page's own object still opens `{"id":"<uuid>"` before its slug and
encloses it; it is found that way, and only an object whose own slug is the page's is accepted."""
import importlib
import json

W = importlib.import_module("scrapers.wahadat.run")

U_OWN, U_OWNER, U_TYPE, U_REL = ("a88e2ee8-52e6-4a7e-862a-06c398d9ac5d", "9a2af3f7-e8e0-4063-adb0-81f5532ffca2",
                                 "7ca3bf90-af3a-411c-a962-cb141d531bcc", "11111111-2222-3333-4444-555555555555")


def _page(*, with_absolute_url: bool = False) -> str:
    related = {"id": U_REL, "slug": "جار", "name_ar": "جار", "city": "جدة",
               "types": [{"id": U_TYPE, "name": "فيلا"}], "images": [{"image": "https://x/rel.jpg"}]}
    own = {"id": U_OWN,
           "owner": {"id": U_OWNER, "name_ar": "وحدات", "city": "الرياض", "neighborhood": "حي الملقا"},
           "units": [], "types": [{"id": U_TYPE, "name": "شقة"}],
           "is_active": True, "name_ar": "اتول الوادي", "slug": "اتول-الوادي", "city": "الرياض",
           "neighborhood": "حي الوادي", "images": [{"image": "https://x/own.jpg"}]}
    if with_absolute_url:
        own = {"id": U_OWN, "absolute_url": f"/project/api/projects/{U_OWN}/", **own}   # the old shape
    return json.dumps({"related": [related], "project": own}, ensure_ascii=False, separators=(",", ":"))


def test_the_own_project_is_found_without_absolute_url():
    p = W._main_project(_page(), "اتول-الوادي")
    assert p is not None and p["id"] == U_OWN
    assert p["neighborhood"] == "حي الوادي"           # the project's own, never its owner's «حي الملقا»
    assert [t["name"] for t in p["types"]] == ["شقة"]  # never the related project's «فيلا»


def test_the_absolute_url_path_still_works():
    p = W._main_project(_page(with_absolute_url=True), "اتول-الوادي")
    assert p is not None and p["id"] == U_OWN


def test_a_related_project_is_never_taken_for_the_page():
    assert W._main_project(_page(), "جار")["id"] == U_REL       # its own slug → its own object
    assert W._main_project(_page(), "غير-موجود") is None        # no slug on the page → nothing guessed


def test_an_object_that_does_not_enclose_the_slug_is_refused():
    # a nested object before the slug (the owner) must not be accepted even if it carried the slug later
    raw = json.dumps({"a": {"id": U_OWNER, "name": "x"}, "b": {"slug": "s"}}, separators=(",", ":"))
    assert W._main_project(raw, "s") is None
