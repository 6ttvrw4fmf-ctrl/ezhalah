"""The reread.json artifact cannot be downloaded from a cloud agent session (blob host refused by the
egress proxy, 2026-10-02), so the comparison the Scraping Engineer needs must also be in the job log."""
from scrapers.common.source_reread import log_lines


def test_log_lines_carry_stored_values_and_page_evidence():
    item = {"table": "tuba_residential_listings", "id": 7, "url": "https://tuba.com.sa/property/x",
            "status": 200, "verdict": "ALIVE",
            "stored": {"price_total": 950000, "area_m2": 416, "rent_period_ar": None, "city_ar": "الطائف"},
            "page": {"title": "فيلا للبيع", "evidence_lines": ["السعر 950,000 ريال", "المساحة 416 م²"]}}
    text = "\n".join(log_lines(item))
    assert "tuba_residential_listings:7" in text and "verdict=ALIVE" in text
    assert "price_total=950000" in text and "area_m2=416" in text and "city_ar=الطائف" in text
    assert "rent_period_ar" not in text                    # an empty field is not printed as None
    assert "950,000 ريال" in text and "416 م²" in text and "فيلا للبيع" in text


def test_a_listing_with_no_fetch_still_prints_its_header():
    lines = log_lines({"table": "t", "id": 1, "url": None, "stored": {}})
    assert lines[0].startswith("== t:1") and "url: None" in lines[1]


def test_log_lines_count_the_pages_own_images_without_our_parser():
    from scrapers.common.source_reread import page_image_count
    # nested the way dealapp's JSON-LD nests it, plus a bare string image
    page = {"jsonld": [{"@type": "Product", "image": ["a.jpg", "b.jpg", "c.jpg"],
                        "itemOffered": {"image": "d.jpg"}}]}
    assert page_image_count(page) == 4
    assert page_image_count({"jsonld": [{"@type": "Product", "name": "x"}]}) == 0   # listed, none
    assert page_image_count({"jsonld": []}) is None                               # nothing to count from
    item = {"table": "t", "id": 1, "url": "u", "stored": {"has_photo": False}, "page": page}
    text = "\n".join(log_lines(item))
    assert "page images (JSON-LD): 4" in text and "we serve a photo: False" in text


def test_image_paths_say_where_the_page_lists_them():
    from scrapers.common.source_reread import page_image_paths
    page = {"jsonld": [{"@type": "Product", "itemOffered": {"image": ["a.jpg"]}, "image": ["b.jpg", "c.jpg"]}]}
    assert page_image_paths(page) == ["itemOffered.image x1", "image x2"]
    assert page_image_paths({"jsonld": [{"name": "x"}]}) == []
    text = "\n".join(log_lines({"table": "t", "id": 1, "url": "u", "stored": {}, "page": page}))
    assert "image at: ['itemOffered.image x1', 'image x2']" in text


def test_structured_props_reach_the_log_without_the_seller():
    """Trap 1: the page's own additionalProperty / amenityFeature names must be readable from the job
    log (the artifact is unreachable from a cloud session), and the seller block never is (PDPL)."""
    from scrapers.common.source_reread import log_lines, page_structured_props
    page = {"jsonld": [{"itemOffered": {"additionalProperty": [{"name": "facing", "value": "North"},
                                                               {"name": "utilities", "value": "Electricity"}],
                                        "amenityFeature": [{"name": "Kitchen", "value": True}]},
                        "offers": {"seller": {"additionalProperty": [{"name": "phone", "value": "0500000000"}]}}}]}
    props = page_structured_props(page)
    assert "facing=North" in props and "Kitchen=True" in props
    assert not any("phone" in p or "0500" in p for p in props)
    assert any("page structured props: facing=North" in x for x in log_lines({"page": page, "stored": {}}))
