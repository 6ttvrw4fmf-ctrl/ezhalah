"""The independent re-read must surface what the PAGE says (structured data and the human-visible
lines that carry a price, size, rooms or an amenity) without any parser of ours, and must refuse a
malformed id list rather than guess."""
import pytest

from scrapers.common.source_reread import page_evidence, parse_ids

PAGE = """<html><head><title>شقة للإيجار في حي النرجس</title>
<meta property="og:title" content="شقة 3 غرف">
<script type="application/ld+json">{"@type":"Offer","price":"55000","priceCurrency":"SAR"}</script>
<script>var tracking = "ريال should not count";</script>
<style>.x{color:red}</style></head>
<body><h1>شقة للإيجار</h1><div>السعر: 55,000 ريال سنوي</div><div>المساحة 180 م²</div>
<div>3 غرف · 2 حمام · مفروش</div><div>تواصل معنا</div></body></html>"""


def test_structured_data_and_meta_are_read_without_our_parser():
    ev = page_evidence(PAGE)
    assert ev["title"] == "شقة للإيجار في حي النرجس"
    assert ev["meta"]["og:title"] == "شقة 3 غرف"
    assert ev["jsonld"][0]["price"] == "55000"


def test_evidence_lines_keep_price_size_rooms_and_drop_script_text():
    lines = page_evidence(PAGE)["evidence_lines"]
    assert any("55,000 ريال سنوي" in x for x in lines)
    assert any("180 م²" in x for x in lines)
    assert any("مفروش" in x for x in lines)
    assert not any("tracking" in x for x in lines)      # script bodies never count as page text
    assert not any("تواصل معنا" in x for x in lines)   # lines with no evidence word are left out


def test_broken_jsonld_is_kept_raw_not_dropped():
    ev = page_evidence('<script type="application/ld+json">{not json</script>')
    assert ev["jsonld"] == [{"_unparsed": "{not json"}]


def test_ids_are_exact_and_malformed_ones_refused():
    assert parse_ids("aqar_residential_listings:12") == [("aqar_residential_listings", 12)]
    for bad in ("aqar_residential_listings", "x:y", ":5"):
        with pytest.raises(ValueError):
            parse_ids(bad)
