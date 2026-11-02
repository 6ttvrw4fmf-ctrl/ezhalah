"""new_listings_score: a wahadat unit is scored against its own record in the project page's payload (🆕 2026-11-02).

Every wahadat unit links to its PROJECT page. The visible text prints only spans and the instalment calculator
(«القسط السنوي» 46,800 ريال), so 8 of 10 sampled units scored a price MISMATCH on 2026-11-02 (score run 41394865647:
22783632 stored 842,622) although no unit price is printed. The page's unitsData payload states each unit's price.
Mutation: making wahadat_unit_lines return [] turns test_unit_price_from_the_payload_matches red.
"""
import json

from scrapers.common import new_listings_score as S

UNITS = [{"id": "aaaa1111-bbbb-2222", "name": "1-14-AS", "status": "available", "price": 842622, "area": 126},
         {"id": "cccc3333-dddd-4444", "name": "1-15-AS", "status": "available", "price": 905000, "area": 136}]
FLIGHT = json.dumps('1:{"unitsData":' + json.dumps(UNITS, ensure_ascii=False) + '}', ensure_ascii=False)
BODY = ('<html><body><h1>تل الربوة</h1><div>111 - 136 م²</div><div>القسط السنوي</div><div>46,800 ريال</div>'
        '<div>القسط الشهري</div><div>3,900 ريال</div>'
        f'<script>self.__next_f.push([1,{FLIGHT}])</script></body></html>')
URL = "https://wahadat.sa/project/x"


def _price(stored, ad):
    page = S.page_evidence(BODY)
    page = {**page, "evidence_lines": S.wahadat_unit_lines(BODY, URL, ad) + list(page.get("evidence_lines") or [])}
    return S.compare_listing({"price_total": stored}, page)["price"]


def test_payload_lines_name_this_unit_only():
    assert S.wahadat_unit_lines(BODY, URL, "WHDaaaa1111bbbb") == ["السعر 842622 ريال", "المساحة 126 م²"]
    assert S.wahadat_unit_lines(BODY, URL, "WHDzzzz") == []
    assert S.wahadat_unit_lines(BODY, "https://other.sa/x", "WHDaaaa1111bbbb") == []


def test_unit_price_from_the_payload_matches():
    assert _price(842622, "WHDaaaa1111bbbb") == S.MATCH


def test_a_wrong_stored_price_still_mismatches():
    assert _price(700000, "WHDaaaa1111bbbb") == S.MISMATCH
