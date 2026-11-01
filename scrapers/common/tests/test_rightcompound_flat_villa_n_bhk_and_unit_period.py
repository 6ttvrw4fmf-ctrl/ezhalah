"""rightcompound: the unit-name type words the 2026-09-28 coverage audit found skipped, and the
unit's own period word.

Measured on a full crawl (254 compounds, 2026-09-28): 15 available units were skipped type_unmapped
although their name carries the noun — «Flat 1», «Family two bedroom flat Type A unfurnished»,
«villa3» / «Villa1» / «Villa13», «Garden Vila», «Appartment 2 Bedroom», «2 Bedroom Aprtment»,
«EXECUTIVE 3.5( BHK)». Suites and names with no type word stay skipped (owner, 2026-09-24).

Mapping «Flat» exposed the period trap: «Flat 1 ( Monthly)» prints 3,700. The platform says every
price is annual, but the unit's own words say monthly, and the owner's rule (2026-09-26) is that
the listing's own words — or a price ≤ 10,000 — beat a generic label. So 3,700 is monthly (×12).

The two blocks are VERBATIM from /compounds/khobar/valencia-hotel-suites (villa id 1529) and
/compounds/khobar/south-park-compound (villa id 1668), 2026-09-28.
"""
from __future__ import annotations

import sys
import types

import pytest

_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.rightcompound import run as R  # noqa: E402

U1529 = '<li class="rc-cd-unit">\n                                        <div class="rc-cd-unit__info">\n                                            <div class="rc-cd-unit__name">Flat 1 ( Monthly)</div>\n                                            <div class="rc-cd-unit__meta">\n                                                <span><i class="fas fa-bed"></i> 1 Bedroom</span>\n                                                    <span><i class="fas fa-bath"></i> 2 Bathrooms</span>\n                                                <span><i class="fas fa-ruler-combined"></i> 40 sqm</span>\n                                            </div>\n                                        </div>\n                                        <div class="rc-cd-unit__price">\n                                            Rent - (SR)3,700\n                                        </div>\n                                        <div class="rc-cd-unit__action">\n                                                <button class="rc-cd-contact-btn contact-btn"\n                                                        data-villa-id="1529"\n                                                        data-is-available="True">\n                                                    <i class="fas fa-envelope"></i> Contact\n                                                </button>\n                                        </div>\n                                    </li>'
U1668 = '<li class="rc-cd-unit">\n                                        <div class="rc-cd-unit__info">\n                                            <div class="rc-cd-unit__name">villa3</div>\n                                            <div class="rc-cd-unit__meta">\n                                                <span><i class="fas fa-bed"></i> 3 Bedrooms</span>\n                                                    <span><i class="fas fa-bath"></i> 4 Bathrooms</span>\n                                                <span><i class="fas fa-ruler-combined"></i> 250 sqm</span>\n                                            </div>\n                                        </div>\n                                        <div class="rc-cd-unit__price">\n                                            Rent - (SR)115,000\n                                        </div>\n                                        <div class="rc-cd-unit__action">\n                                                <button class="rc-cd-contact-btn contact-btn"\n                                                        data-villa-id="1668"\n                                                        data-is-available="True">\n                                                    <i class="fas fa-envelope"></i> Contact\n                                                </button>\n                                        </div>\n                                    </li>'


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda city_ar, hint=None: (7, 5) if city_ar == "الخبر" else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda text, city_id: None)


@pytest.mark.parametrize("name,want", [
    ("Flat 1", "شقة"), ("Family two bedroom flat Type A unfurnished", "شقة"),
    ("villa3", "فيلا"), ("Villa1", "فيلا"), ("Villa13", "فيلا"), ("Garden Vila", "فيلا"),
    ("Appartment 2 Bedroom", "شقة"), ("2 Bedroom Aprtment", "شقة"), ("EXECUTIVE 3.5( BHK)", "شقة"),
    # owner 2026-09-24: suites and names without a type word stay unmapped
    ("Two Bedroom Suite", None), ("DELUXE SUITE", None), ("Two Bedroom Fully Furnished Unit Type A", None),
    ("121", None), ("Annex", None),
])
def test_type_word_in_the_unit_name(name, want):
    assert R.unit_type_ar(name) == want


def _row(block: str, compound: str) -> dict:
    rows, why, skips = R.map_units(f"https://rightcompound.com/compounds/khobar/{compound}",
                                   f'<ul class="rc-cd-units">{block}</ul>')
    assert (why, skips) == ("", {}) and len(rows) == 1, (why, skips)
    return rows[0]


def test_the_units_own_monthly_word_beats_the_platforms_annual_label():
    r = _row(U1529, "valencia-hotel-suites")
    assert (r["ad_number"], r["property_type"]) == ("RCP1529", "Apartment")
    assert (r["rent_period"], r["price_annual"]) == ("monthly", 3700 * 12)


def test_a_plain_unit_keeps_the_platforms_annual_statement():
    r = _row(U1668, "south-park-compound")
    assert (r["ad_number"], r["property_type"]) == ("RCP1668", "Villa")
    assert (r["rent_period"], r["price_annual"]) == ("annual", 115000)


def test_the_owners_period_order():
    """RCP1192 «(Monthly Rate)» at 12,000 is monthly on its own word, above the ≤ 10,000 line;
    RCP606 «Two bedroom fully furnished apartment» at 7,000 has no word, but no unit rents for
    7,000 a year (owner 2026-09-26: ≤ 10,000 is monthly)."""
    assert R.unit_period("Apartment - One Bedroom (Monthly Rate)", 12000) == "monthly"
    assert R.unit_period("Two bedroom fully furnished apartment", 7000) == "monthly"
    assert R.unit_period("Two bedroom fully furnished apartment", 10001) == "annual"
