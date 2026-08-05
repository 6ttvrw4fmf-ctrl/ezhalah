"""Pinned shapes from the 2026-08-03 price/size display-fidelity audit (owner rule: the stored
price is EXACTLY what the source page displays — never a computed sibling field, never a
per-metre rate silently promoted to a total, never two figures concatenated).

Every case below is a real production row that was stored wrong (or a real faithful shape that
must NOT be "fixed"). Platform, id and the live-observed display are in each case's comment.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.aqarcity.run import map_listing as aqarcity_map  # noqa: E402
from scrapers.aqargate.run import _price_int, _rent_annualize  # noqa: E402
from scrapers.eaqartabuk.run import _price as eaqar_price  # noqa: E402
from scrapers.sadin.run import _extract_price  # noqa: E402


# Trimmed from the REAL aqarcity page /property/28170 (live 2026-08-03): JSON-LD offers.price
# carries the per-metre rate (19.5) and the JSON-LD description TRUNCATES the annual figure
# («الإيجار السنوي : 50…»), while the page displays the true annual in its price badge
# (btnPriceHead «50,115») and the full description. The head's truncated copy appears FIRST in
# document order — the exact shape that defeated a first-match parse on 14/18 live rows.
AQARCITY_TRUNCATED_LD_PAGE = """
<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product",
"name":"ارض للإيجار في النماص حي المنتزة الشمالي",
"description":"أرض سكنية للإيجار على المدى الطويل الإيجار السنوي : 50… رخصة فال",
"offers":{"@type":"Offer","priceCurrency":"SAR","price":19.5,
"availability":"https://schema.org/InStock","url":"https://www.aqarcity.net/property/28170",
"priceSpecification":{"@type":"UnitPriceSpecification","price":19.5,"priceCurrency":"SAR","unitText":"YEAR"}}}</script>
<script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[
{"@type":"ListItem","position":1,"name":"الرئيسية"},
{"@type":"ListItem","position":2,"name":"عسير"},
{"@type":"ListItem","position":3,"name":"النماص"},
{"@type":"ListItem","position":4,"name":"ارض"}]}</script>
</head><body>
<span class="w-auto btnPriceHead" >50,115  <span class="riyal-icon"></span></span>
<p>مساحة الارض : 2570 م</p><p>الإيجار السنوي : 50,115 ريال</p>
<div class="pi-item"><div class="pi-item__label"><i class="fas fa-dot-circle"></i>التصنيف </div>
<div class="pi-item__value">ارض سكنية</div></div>
<div class="pi-item"><div class="pi-item__label"><i class="fas fa-dot-circle"></i>مساحة العقار </div>
<div class="pi-item__value">2570</div></div>
<div class="pi-item"><div class="pi-item__label"><i class="fas fa-dot-circle"></i>اجمالي الايجار السنوي للأرض </div>
<div class="pi-item__value">50115</div></div>
</body></html>"""


def test_aqargate_price_rounds_like_the_page_badge():
    # Live 2026-08-03: meta 2388.79 → badge «2,389»; 388.52 → «389»; 14.5 → «15»; 703.5 → «704»;
    # 1783.1 → «1,783». int(float()) floored 4 of these 1 SAR under the display.
    assert _price_int("2388.79") == 2389   # id 583463
    assert _price_int("388.52") == 389     # id 583432
    assert _price_int("14.5") == 15        # id 583496 — half-up like the site, NOT banker's round()
    assert _price_int("703.5") == 704      # id 1120876
    assert _price_int("1783.1") == 1783    # id 583382 — floor and round agree
    assert _price_int("570") == 570        # integers untouched
    assert _price_int(None) is None and _price_int("") is None and _price_int(0) is None


def test_aqargate_rent_prefers_the_displayed_price_over_the_derived_annual_field():
    # Live ids 583516/583517: page displays 150,000 (propertyPrice); landTotalAnnualRent carries
    # the backend's own 150,000×600m² = 90,000,000 derivation. The scraper must feed propertyPrice
    # into _rent_annualize; with the annual field present, no ×12 is applied.
    rent_annual, period = _rent_annualize(150000, has_annual_field=True, title_text="ارض للايجار")
    assert rent_annual == 150000 and period == "annual"
    # The 2026-07-28 monthly-title case must keep working: no annual field + شهري title → ×12.
    rent_annual, period = _rent_annualize(16000, has_annual_field=False, title_text="شقة للإيجار الشهري")
    assert rent_annual == 192000 and period == "monthly"


def test_eaqartabuk_two_figures_in_one_price_field_are_never_concatenated():
    # Live id 598669: a multi-unit building lists two unit rents (2,500 + 1,800); the page shows
    # no single price. The old parse glued them into 18,002,500.
    for raw in ("1800 2500", "1,800 / 2,500", "2500 و 1800", "1800\n2500"):
        assert eaqar_price(raw, is_rent=True) == (None, None, None), raw
    # Single figures keep the existing magnitude heuristic behavior.
    # 2026-08-05: a stated «شهري» still annualises; a SILENT ad is now unknown, never guessed.
    assert eaqar_price("2500", is_rent=True, raw_text="ايجار شهري") == (None, 30000, "monthly")
    assert eaqar_price("2500", is_rent=True) == (None, None, None)
    assert eaqar_price("150000", is_rent=True, raw_text="ايجار سنوي") == (None, 150000, "annual")
    # 2026-08-05: the ×1000 magnitude guess is GONE — ET10864's page and wp-json both say 380 and we
    # stored 380,000. A price the source prints as 580 IS 580.
    assert eaqar_price("580", is_rent=False) == (580, None, None)
    # A single decimal figure is ONE figure, not two (the dot must not split it).
    assert eaqar_price("150000.0", is_rent=False) == (150000, None, None)


def test_aqarcity_land_rent_uses_the_displayed_annual_not_the_ld_per_meter():
    # The badge/description show 50,115; JSON-LD offers.price is the 19.5 per-metre rate and the
    # head's truncated description copy («50…») must NOT poison the candidate scan.
    row, category = aqarcity_map(AQARCITY_TRUNCATED_LD_PAGE, "https://www.aqarcity.net/property/28170")
    assert row is not None and category == "residential"
    assert row["transaction_type"] == "Rent"
    assert row["price_annual"] == 50115, row["price_annual"]
    assert row["price_per_meter"] == 20  # the rounded per-metre rate, kept in its own column
    assert row["price_total"] is None


def test_sadin_lam_lam_meter_form_yields_the_displayed_total():
    # Live id 598978: «المطلوب للمتر 5555 ريال الإجمالي 5,000,000 ريال» — the للمتر (no-alif) form
    # slipped the per-metre guard and 5555 was stored as the total. The explicit الإجمالي wins.
    assert _extract_price("المطلوب للمتر 5555 ريال الإجمالي 5,000,000 ريال") == 5000000
    # Existing guards must not regress:
    assert _extract_price("السعر: 4,250 ريال للمتر") is None          # per-metre only → no total
    assert _extract_price("المتر: 4000 ريال") is None                  # label-before form (2026-07-28)
    assert _extract_price("السعر الإجمالي: 2,647,750 ريال") == 2647750


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"PASS {name}")
    print("✓ all price-display-fidelity shapes pinned")
