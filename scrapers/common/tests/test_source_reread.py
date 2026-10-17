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


def test_wasalt_prices_are_printed_whatever_the_fact_filter_keeps():
    """Backlog 371/392 (2026-10-12): settling a wasalt land priced in the hundreds of billions needs the
    page's own salePrice / conversionPrice / per-metre in the job log (PRICE = SOURCE)."""
    from scrapers.common.source_reread import wasalt_fact_paths
    d = {"props": {"pageProps": {"propertyDetailsV3": {"propertyInfo": {
        "title": "Land 2250 SQM", "salePrice": 40500000000, "conversionPrice": 40500000000,
        "pricePerMeter": 18000000, "isPriceNegotiable": True}}}}}
    lines = wasalt_fact_paths(d)
    assert "propertyDetailsV3.propertyInfo.salePrice = 40500000000" in lines
    assert "propertyDetailsV3.propertyInfo.pricePerMeter = 18000000" in lines
    assert not any("isPriceNegotiable" in l for l in lines)   # a flag is not a price


def test_slow_host_is_read_the_way_its_scraper_reads_it(monkeypatch):
    # muktamel (backlog #456): the shared probe's 25 s timed out on 5/5 pages; the reader uses the
    # scraper's own route (chrome124 + Arabic, 45 s, retries). Every other host still goes through _probe.
    import curl_cffi.requests as cc
    from scrapers.common import source_reread as SR
    seen = {}

    class FakeResp:
        status_code, text = 200, "<html>ok</html>"

    class FakeSession:
        def __init__(self, impersonate=None):
            seen["impersonate"] = impersonate
            self.headers = {}

        def get(self, url, timeout=None, allow_redirects=True):
            seen["timeout"] = timeout
            return FakeResp()

    monkeypatch.setattr(cc, "Session", FakeSession)
    monkeypatch.setattr(SR, "_probe", lambda url: (599, "probe"))
    assert SR.read_page("https://www.muktamel.com/real-estates/34463") == (200, "<html>ok</html>")
    assert seen == {"impersonate": "chrome124", "timeout": 45}
    assert SR.read_page("https://sa.aqar.fm/ad/1") == (599, "probe")


def test_a_price_label_keeps_its_bare_value():
    # abaad 17954821 (2026-10-16): «إجمالي السعر» / «290720» with the riyal sign as an <img>.
    body = ('<div class="detail-item"><span class="k">سعر المتر</span><div class="v"><span>460</span>'
            '<img alt="sar"></div></div><div class="detail-item"><span class="k">إجمالي السعر</span>'
            '<div class="v price-value"><span>290720</span><img alt="sar"></div></div>')
    assert any("إجمالي السعر 290720" in x for x in page_evidence(body)["evidence_lines"])
