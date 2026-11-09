"""aqarcity 2026-10-22: the sitemap lists /en/property/<id>, and that page is now English
(«<html lang="en">», «Apartment for rent in Ar Rawdah, Riyadh», English spec labels). Every label this parser
reads is Arabic, so 2,102 rows were stored as Buy / type «unknown» (rents included) and 298 lost their city;
1,901 were served as «بيع / غير معروف». The same ad at /property/<id> is the Arabic page (214 rows read right
in the same crawl, source-reread 40073842251). So: every url is the Arabic /property/<id>, one per id, and an
English page is skipped, never written.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, ".")

import scrapers.aqarcity.run as R  # noqa: E402

DL = (Path(__file__).resolve().parents[2] / "aqarcity" / "testdata"
      / "aqarcity_dl_layout_2026_10.excerpt.html").read_text()
LD_AR = {"@context": "https://schema.org", "@type": "RealEstateListing",
         "url": "https://www.aqarcity.net/property/27257", "name": "عمارة للبيع في ابها الضباب",
         "offers": {"@type": "Offer", "priceCurrency": "SAR", "price": 7000000,
                    "availability": "https://schema.org/InStock"},
         "address": {"@type": "PostalAddress", "addressLocality": "ابها", "addressRegion": "منطقة عسير"}}
LD_EN = dict(LD_AR, url="https://www.aqarcity.net/en/property/31436",
             name="Apartment for rent in Ar Rawdah, Riyadh",
             address={"@type": "PostalAddress", "addressLocality": "Riyadh", "addressRegion": "Riyadh"})


def page(ld: dict, lang: str, table: str) -> str:
    return (f'<!DOCTYPE html><html lang="{lang}" dir="{"rtl" if lang == "ar" else "ltr"}"><head>'
            f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script></head>'
            f"<body>{table}</body></html>")


EN_TABLE = "<dl><dt>Property type</dt><dd>Apartment</dd><dt>Area</dt><dd>115.58 m²</dd></dl>"


def test_every_url_is_the_arabic_page():
    assert R.arabic_url("https://www.aqarcity.net/en/property/31436") == "https://www.aqarcity.net/property/31436"
    assert R.arabic_url("https://www.aqarcity.net/property/31436") == "https://www.aqarcity.net/property/31436"


def test_the_sitemap_keeps_one_arabic_url_per_id(monkeypatch):
    xml = ("<urlset><url><loc>https://www.aqarcity.net/en/property/31436</loc></url>"
           "<url><loc>https://www.aqarcity.net/property/31436</loc></url>"
           "<url><loc>https://www.aqarcity.net/en/property/31438</loc></url></urlset>")

    class S:
        def get(self, *_a, **_k):
            return type("R", (), {"text": xml, "content": xml.encode()})()

    assert R.sitemap_urls(S()) == ["https://www.aqarcity.net/property/31438",
                                   "https://www.aqarcity.net/property/31436"]


def test_the_english_page_is_recognised():
    assert R.is_english_page(page(LD_EN, "en", EN_TABLE), R._pi_table(EN_TABLE), LD_EN)
    # Without the lang attribute: the English labels alone, or (no table) the English name, give it away.
    assert R.is_english_page(EN_TABLE, R._pi_table(EN_TABLE), LD_EN)
    assert R.is_english_page("<body></body>", {}, LD_EN)


def test_the_arabic_page_is_not_mistaken_for_english():
    body = page(LD_AR, "ar", DL)
    assert not R.is_english_page(body, R._pi_table(DL), LD_AR)


def test_an_english_page_writes_no_row():
    # Before the fix this mapped to transaction Buy / type «unknown» for a rent ad.
    row, _cat = R.map_listing(page(LD_EN, "en", EN_TABLE), "https://www.aqarcity.net/property/31436")
    assert row is None


def test_the_arabic_page_still_maps():
    row, cat = R.map_listing(page(LD_AR, "ar", DL), "https://www.aqarcity.net/property/27257")
    assert row is not None and row["property_type"] == "Building"


def test_the_side_of_the_price_that_does_not_apply_is_cleared():
    # The English era stored a sale total on 249 rent rows; a plain None never clears it (the upsert drops None).
    from scrapers.common import db
    row, _ = R.map_listing(page(LD_AR, "ar", DL), "https://www.aqarcity.net/property/27257")
    assert row["transaction_type"] == "Buy" and row["price_annual"] is db.AUTHORITATIVE_NULL


def test_a_page_with_no_rate_clears_a_stored_rate():
    # Owner 2026-11-07 (row 3076): 2292952 held price_per_meter = its 200,000 rent from an older read; the
    # parser emitted None, which the upsert drops, so the copy stayed. A page with no rate settles the box.
    from scrapers.common import db
    row, _ = R.map_listing(page(LD_AR, "ar", DL), "https://www.aqarcity.net/property/27257")
    assert row["price_per_meter"] is db.AUTHORITATIVE_NULL



def _land_rent(extra_html: str):
    ld = dict(LD_AR, name="أرض للإيجار في ابها الضباب",
              offers={"@type": "Offer", "priceCurrency": "SAR", "price": 18})
    return R.map_listing(page(ld, "ar", DL + extra_html), "https://www.aqarcity.net/property/27257")[0]


def test_a_rent_page_missing_its_displayed_total_keeps_the_rate_unknown():
    # CodeRabbit (PR #11247): a land-rent page that lost the HTML holding its displayed total cannot prove
    # «no rate», so it must not clear a rate a complete read once proved (None is dropped by the upsert).
    row = _land_rent("")
    assert row["transaction_type"] == "Rent" and row["area_m2"]
    assert row["price_per_meter"] is None


def test_a_rent_page_whose_displayed_total_is_not_a_rate_settles_no_rate():
    from scrapers.common import db
    row = _land_rent('<span class="btnPriceHead">18</span>')
    assert row["price_per_meter"] is db.AUTHORITATIVE_NULL


def test_a_page_missing_its_price_or_its_area_keeps_the_rate_unknown():
    # CodeRabbit (PR #11247): only a read WITH price and area settles «no rate published»; a page missing
    # either cannot clear a rate a complete read once proved (None is dropped by the upsert).
    no_area = DL.replace("570 م²", "")
    row, _ = R.map_listing(page(LD_AR, "ar", no_area), "https://www.aqarcity.net/property/27257")
    assert row is None or row["price_per_meter"] is None
    no_price = dict(LD_AR, offers={"@type": "Offer", "priceCurrency": "SAR"})
    row, _ = R.map_listing(page(no_price, "ar", DL), "https://www.aqarcity.net/property/27257")
    assert row is None or row["price_per_meter"] is None


def test_an_area_only_the_json_ld_states_still_settles_the_rate():
    from scrapers.common import db
    ld = dict(LD_AR, floorSize={"@type": "QuantitativeValue", "value": 570, "unitCode": "MTK"})
    row, _ = R.map_listing(page(ld, "ar", DL.replace("570 م²", "")), "https://www.aqarcity.net/property/27257")
    assert row["area_m2"] == 570 and row["price_per_meter"] is db.AUTHORITATIVE_NULL
