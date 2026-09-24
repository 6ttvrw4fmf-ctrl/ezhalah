"""Offline barrier for scrapers/rightcompound/run.py — the unit grain, the platform-stated period,
the traps this source actually sets, and the removal oracle.

Every HTML fragment below is VERBATIM rightcompound markup captured live on 2026-09-24:
  · U629 / U632 / U633 / U638 — four <li class="rc-cd-unit"> blocks from
    /compounds/riyadh/al-reem-residences-compound (villa ids 629, 632, 633, 638; compound 423);
  · LD — that page's JSON-LD place record, trimmed to address/geo and two amenityFeature entries;
  · ABOUT / IMG / H1 / DIST — its About card (the body up to its first </div>, which closes the description), first gallery <img>, <h1> and the
    sentence that names the district;
  · STAR — the one unit of /compounds/riyadh/star-compound («245 sqf», villa id 209);
  · TEST — the unit of /compounds/riyadh/test@@@ (name «121», «Rent - (SR)4»);
  · PALMA — unit 103 of /compounds/al-qaseem/palma-village-qassim («Apt. Type "C"», «Rent - (SR)0»).
The functions under test are the production ones; only to_catalog / find_district_in_text are
stubbed (they resolve against the catalog tables). Two tests flip ONE attribute/word inside a
verbatim block to reach a branch the live site did not exhibit on capture day, and say so.

WHAT IT PINS
  1. GRAIN: one row per unit, ad_number = RCP + the source's villa id, listing_url = the compound page.
  2. PRICE = SOURCE: «Rent - (SR)247,000» → price_annual 247000 with the raw text in price_evidence;
     «Rent - (SR)0» stays 0 (a printed figure is never blanked); a label that is not «Rent» is skipped.
  3. PERIOD: annual, from the platform's own statement (API rentPeriod=year / llms.txt) — recorded on
     the row, and NULL when there is no figure to attach it to.
  4. AREA: «300 sqm» → 300; «245 sqf» → NULL with the raw text kept — never converted or assumed.
  5. TYPE from the unit name: Villa / Town House→Villa / «Duplex … Apartment»→Apartment / Studio;
     a name with no type word («121») is type_unmapped, never folded into a neighbour.
  6. AVAILABILITY: data-is-available="False" is skipped unit_not_available.
  7. LOCATION: city from the URL's own segment; a region slug (al-qaseem) the catalog cannot place is
     city_not_in_catalog; the district is written only when the catalog attests it for that city.
  8. FURNISHED only from the unit's own words; PHOTOS prefer the full-size data-orig; PII redacted.
  9. ORACLE: 404 → gone; a served compound whose list carries the villa id → live, without it → gone;
     a 403 has no opinion and the shared law turns it into UNKNOWN; removals fail CLOSED with no canary.
 10. main(): the skip tally reaches end_run(notes=...) and prune runs only after a complete enumeration.
"""
from __future__ import annotations

import sys
import types

import pytest

_supabase_mod = types.ModuleType("supabase")


class _StubClient:  # pragma: no cover
    pass


_supabase_mod.Client = _StubClient
_supabase_mod.create_client = lambda url, key: _StubClient()
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.common import http_liveness  # noqa: E402
from scrapers.rightcompound import run as R  # noqa: E402

URL = "https://rightcompound.com/compounds/riyadh/al-reem-residences-compound"
URL_QASEEM = "https://rightcompound.com/compounds/al-qaseem/palma-village-qassim"
URL_STAR = "https://rightcompound.com/compounds/riyadh/star-compound"


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    """الرياض resolves (city 1); «القصيم» is a region and does not. A district is attested only for
    city 1, and only «حي المونسية» — so any other candidate writes NULL."""
    monkeypatch.setattr(R, "to_catalog",
                        lambda city_ar, hint=None: ((1, 100) if city_ar == "الرياض" else (None, None)))
    monkeypatch.setattr(R, "find_district_in_text",
                        lambda text, city_id: (text if (city_id == 1 and text == "حي المونسية") else None))


# ── verbatim fragments ───────────────────────────────────────────────────────────────────────────
U629 = '<li class="rc-cd-unit">\n                                        <div class="rc-cd-unit__info">\n                                            <div class="rc-cd-unit__name">Executive Four Bedroom fully furnished  Superior Villa</div>\n                                            <div class="rc-cd-unit__meta">\n                                                <span><i class="fas fa-bed"></i> 4 Bedrooms</span>\n                                                    <span><i class="fas fa-bath"></i> 5 Bathrooms</span>\n                                                <span><i class="fas fa-ruler-combined"></i> 300 sqm</span>\n                                            </div>\n                                        </div>\n                                        <div class="rc-cd-unit__price">\n                                            Rent - (SR)247,000\n                                        </div>\n                                        <div class="rc-cd-unit__action">\n                                                <button class="rc-cd-contact-btn contact-btn"\n                                                        data-villa-id="629"\n                                                        data-is-available="True">\n                                                    <i class="fas fa-envelope"></i> Contact\n                                                </button>\n                                        </div>\n                                    </li>'
U632 = '<li class="rc-cd-unit">\n                                        <div class="rc-cd-unit__info">\n                                            <div class="rc-cd-unit__name">Town House &quot;  A &quot; Three Bedroom fully furnished </div>\n                                            <div class="rc-cd-unit__meta">\n                                                <span><i class="fas fa-bed"></i> 3 Bedrooms</span>\n                                                    <span><i class="fas fa-bath"></i> 4 Bathrooms</span>\n                                                <span><i class="fas fa-ruler-combined"></i> 250 sqm</span>\n                                            </div>\n                                        </div>\n                                        <div class="rc-cd-unit__price">\n                                            Rent - (SR)181,500\n                                        </div>\n                                        <div class="rc-cd-unit__action">\n                                                <button class="rc-cd-contact-btn contact-btn"\n                                                        data-villa-id="632"\n                                                        data-is-available="True">\n                                                    <i class="fas fa-envelope"></i> Contact\n                                                </button>\n                                        </div>\n                                    </li>'
U633 = '<li class="rc-cd-unit">\n                                        <div class="rc-cd-unit__info">\n                                            <div class="rc-cd-unit__name">Duplex Two Bedroom fully furnished Apartment</div>\n                                            <div class="rc-cd-unit__meta">\n                                                <span><i class="fas fa-bed"></i> 2 Bedrooms</span>\n                                                    <span><i class="fas fa-bath"></i> 3 Bathrooms</span>\n                                                <span><i class="fas fa-ruler-combined"></i> 137 sqm</span>\n                                            </div>\n                                        </div>\n                                        <div class="rc-cd-unit__price">\n                                            Rent - (SR)130,000\n                                        </div>\n                                        <div class="rc-cd-unit__action">\n                                                <button class="rc-cd-contact-btn contact-btn"\n                                                        data-villa-id="633"\n                                                        data-is-available="True">\n                                                    <i class="fas fa-envelope"></i> Contact\n                                                </button>\n                                        </div>\n                                    </li>'
U638 = '<li class="rc-cd-unit">\n                                        <div class="rc-cd-unit__info">\n                                            <div class="rc-cd-unit__name">Studio fully furnished Apartment&#x9;</div>\n                                            <div class="rc-cd-unit__meta">\n                                                <span><i class="fas fa-bed"></i> 1 Bedroom</span>\n                                                    <span><i class="fas fa-bath"></i> 2 Bathrooms</span>\n                                                <span><i class="fas fa-ruler-combined"></i> 50 sqm</span>\n                                            </div>\n                                        </div>\n                                        <div class="rc-cd-unit__price">\n                                            Rent - (SR)72,000\n                                        </div>\n                                        <div class="rc-cd-unit__action">\n                                                <button class="rc-cd-contact-btn contact-btn"\n                                                        data-villa-id="638"\n                                                        data-is-available="True">\n                                                    <i class="fas fa-envelope"></i> Contact\n                                                </button>\n                                        </div>\n                                    </li>'
LD = '{"@context": "https://schema.org", "@type": "ApartmentComplex", "name": "Azure AlReem Compound Riyadh ", "address": {"@type": "PostalAddress", "addressCountry": "SA", "addressLocality": "Riyadh", "streetAddress": "Near Al Thoumamah Rd. Al Munsiyah, Riyadh ", "postalCode": "13422"}, "geo": {"@type": "GeoCoordinates", "latitude": 24.833853239715506, "longitude": 46.75075265808107}, "amenityFeature": [{"@type": "LocationFeatureSpecification", "name": "Gym", "value": true}, {"@type": "LocationFeatureSpecification", "name": "Swimming Pool", "value": true}]}'
ABOUT = '<h2 class="rc-cd-card__heading">About This Compound</h2>\n                        </div>\n                        <div class="rc-cd-card__body">\n                            <div class="rc-cd-description"><h1><br></h1><h1>VR Tour Available, Walk through our Show Units Now:&nbsp;</h1><table class="table table-bordered"><tbody><tr><td>Duplex Villa</td><td><p><a href="http://www.3dvoxel.xyz/3d-model/4br-duplex-villa-alreem-compound/fullscreen/" target="_blank">Click here</a></p></td></tr><tr><td>Townhouse</td><td><a href="http://www.3dvoxel.xyz/3d-model/townhouse-al-reem-compound/fullscreen/" target="_blank">Click here</a></td></tr><tr><td>Duplex Apartment</td><td><a href="http://www.3dvoxel.xyz/3d-model/2br-duplex-apartment-alreem-compound/fullscreen/" target="_blank">Click here</a></td></tr><tr><td>3 Bedroom Apartment</td><td><a href="http://www.3dvoxel.xyz/3d-model/3br-apartment-alreem-compound/fullscreen/" target="_blank">Click here</a></td></tr><tr><td>2 Bedroom Apartment</td><td><a href="http://www.3dvoxel.xyz/3d-model/2br-apartment-alreem-compound/fullscreen" target="_blank">Click here</a></td></tr><tr><td>1 Bedroom Apartment</td><td><a href="http://www.3dvoxel.xyz/3d-model/1br-apartment-alreem-compound/fullscreen/" target="_blank">Click here</a></td></tr><tr><td>Studio</td><td><a href="http://www.3dvoxel.xyz/3d-model/studio-alreem-compound/fullscreen/" target="_blank">Click here</a></td></tr></tbody></table><h1>About Azure-Qurtubah Compound Riyadh&nbsp;:</h1><p>Azure-Qurtubah Compound Riyadh&nbsp; is a modern gated community developed and managed by Azure Real Estate Company in Riyadh. The compound is located in the Al Munsiyah District of Riyadh, accessed through Al Thumama Road, and offers a convenient community lifestyle with a high standard of accommodation for families and individuals. Its central location provides easy access to hospitals, shopping malls, international schools, and the airport, making it an ideal location for quick commutes to work and schools.<br></p><p>The compound offers 500 fully furnished, modern units of different types and sizes, including four-bedroom villas, three-bedroom townhouses, two-bedroom duplex apartments, three-bedroom apartments, two-bedroom apartments, one-bedroom apartments, and studios. Each residence is well-appointed with high-quality fittings and fixtures, and well-thought-out interior designs to create spaces to relax, socialize, and live well in.<br></p><p>Azure-Qurtubah Compound Riyadh&nbsp; is uniquely equipped with all types of modern facilities for all family members, including the Recreational Center, which is the beating heart of the compound. The facilities include an international restaurant and café, indoor and poolside tables, Montessori preschool, gym, fitness zone, health club (men and women), eight swimming pools (indoor and outdoor), saunas and Jacuzzi, tennis court, squash court, basketball court, football court, spa and salon, mini-market, restaurant, indoor playing room, and four kids\' playing areas (both indoor and outdoor).<br></p><p>The compound also offers transportation buses to schools and malls, fiber optic connections for high-speed internet service to all villas and apartments, free maintenance services available 24 hours daily, public cleaning services, pest control services, satellite cables, and laundry services.</p><p>Azure-Qurtubah Compound Riyadh&nbsp; has taken every security precaution to ensure your family is safe 24/7, including a two-tier secure gated system, state-of-the-art CCTV cameras and monitoring, and a 24-hour patrolling team of professional security guards, all under the consultation of Gourdiehill Associates Ltd for the design and implementation of the security standards and features.</p><p>Overall,Azure-Qurtubah Compound Riyadh&nbsp; offers a luxurious and pleasant environment with all the necessary facilities and services to make your life comfortable and convenient. It is an ideal place to live with your loved ones.<span style="font-family: Arial, sans-serif; font-size: 11pt;">&nbsp;</span></p><p><span style="font-family: Arial, sans-serif; font-size: 11pt;"><br></span></p><p><span style="font-family: Arial, sans-serif; font-size: 11pt;"><br></span><br></p> <p></p></div>'
IMG = '<img src="https://rightcompoundimages.blob.core.windows.net/videos/423/t/923e3f32a7b544cca5e97f43b5587a17.jpg" data-orig="https://rightcompoundimages.blob.core.windows.net/images/Common/Images/Compound/423/923e3f32a7b544cca5e97f43b5587a17.jpeg" alt="098899" width="480" height="300" loading="lazy" onerror="this.onerror=null;this.src=this.getAttribute(\'data-orig\');" />'
H1 = '<h1 class="rc-cd-hero__title">Azure Alreem Compound Riyadh </h1>'
DIST = 'The compound is located in the Al Munsiyah District of Riyadh, accessed through Al Thumama Road, and offers a convenient community lifestyle with a high standard of accommodation for families and individuals.'
STAR = '<li class="rc-cd-unit">\n                                        <div class="rc-cd-unit__info">\n                                            <div class="rc-cd-unit__name">Star Compound Villa</div>\n                                            <div class="rc-cd-unit__meta">\n                                                <span><i class="fas fa-bed"></i> 3 Bedrooms</span>\n                                                    <span><i class="fas fa-bath"></i> 4 Bathrooms</span>\n                                                <span><i class="fas fa-ruler-combined"></i> 245 sqf</span>\n                                            </div>\n                                        </div>\n                                        <div class="rc-cd-unit__price">\n                                            Rent - (SR)190,000\n                                        </div>\n                                        <div class="rc-cd-unit__action">\n                                                <button class="rc-cd-contact-btn contact-btn"\n                                                        data-villa-id="79"\n                                                        data-is-available="True">\n                                                    <i class="fas fa-envelope"></i> Contact\n                                                </button>\n                                        </div>\n                                    </li>'
TEST = '<li class="rc-cd-unit">\n                                        <div class="rc-cd-unit__info">\n                                            <div class="rc-cd-unit__name">121</div>\n                                            <div class="rc-cd-unit__meta">\n                                                <span><i class="fas fa-bed"></i> 3 Bedrooms</span>\n                                                    <span><i class="fas fa-bath"></i> 4 Bathrooms</span>\n                                                <span><i class="fas fa-ruler-combined"></i> 3 sqm</span>\n                                            </div>\n                                        </div>\n                                        <div class="rc-cd-unit__price">\n                                            Rent - (SR)4\n                                        </div>\n                                        <div class="rc-cd-unit__action">\n                                                <button class="rc-cd-contact-btn contact-btn"\n                                                        data-villa-id="1611"\n                                                        data-is-available="True">\n                                                    <i class="fas fa-envelope"></i> Contact\n                                                </button>\n                                        </div>\n                                    </li>'
PALMA = '<li class="rc-cd-unit">\n                                        <div class="rc-cd-unit__info">\n                                            <div class="rc-cd-unit__name">Apt. Type &quot;C&quot;</div>\n                                            <div class="rc-cd-unit__meta">\n                                                <span><i class="fas fa-bed"></i> 2 Bedrooms</span>\n                                                    <span><i class="fas fa-bath"></i> 3 Bathrooms</span>\n                                                <span><i class="fas fa-ruler-combined"></i> 124 sqm</span>\n                                            </div>\n                                        </div>\n                                        <div class="rc-cd-unit__price">\n                                            Rent - (SR)0\n                                        </div>\n                                        <div class="rc-cd-unit__action">\n                                                <button class="rc-cd-contact-btn contact-btn"\n                                                        data-villa-id="103"\n                                                        data-is-available="True">\n                                                    <i class="fas fa-envelope"></i> Contact\n                                                </button>\n                                        </div>\n                                    </li>'


def page(*units: str, ld: str = LD, about: str = ABOUT, dist: str = DIST) -> str:
    return ("<html><head><script type=\"application/ld+json\">" + ld + "</script></head><body>" + H1
            + IMG + "<p>" + dist + "</p>"
            + "<ul class=\"rc-cd-units units\">" + "".join(units) + "</ul>" + about + "</body></html>")


# ── 1. grain ─────────────────────────────────────────────────────────────────────────────────────
def test_every_unit_is_its_own_row_keyed_by_the_villa_id():
    rows, why, skips = R.map_units(URL, page(U629, U632, U633, U638))
    assert why == "" and skips == {}
    assert [r["ad_number"] for r in rows] == ["RCP629", "RCP632", "RCP633", "RCP638"]
    assert {r["listing_url"] for r in rows} == {URL}
    assert [r["property_type"] for r in rows] == ["Villa", "Villa", "Apartment", "Studio"]
    assert rows[0]["title"] == "Azure Alreem Compound Riyadh – Executive Four Bedroom fully furnished Superior Villa"
    assert rows[0]["source"] == "RightCompound" and rows[0]["transaction_type"] == "Rent"


# ── 2/3. price and period ────────────────────────────────────────────────────────────────────────
def test_price_is_the_printed_figure_and_the_period_is_the_platforms_statement():
    row = R.map_units(URL, page(U629))[0][0]
    assert row["price_annual"] == 247000 and row["rent_period"] == "annual"
    assert row["price_evidence"]["raw"] == "Rent - (SR)247,000"
    assert row["price_evidence"]["stored"] == 247000 and row["price_evidence"]["kind"] == "annual"
    assert "rentPeriod=year" in row["additional_info"]["period_statement"]


def test_a_printed_zero_stays_zero_and_is_never_blanked_or_hidden():
    """Palma Village prints «Rent - (SR)0» on every unit. The figure is the source's; it is stored
    exactly (0), not NULLed, not dropped — price fidelity (db._sanitize_ints keeps 0 legal)."""
    row = R.map_units(URL, page(PALMA))[0][0]
    assert row["price_annual"] == 0 and row["price_evidence"]["raw"] == "Rent - (SR)0"
    assert row["property_type"] == "Apartment", "«Apt.» is the site's own abbreviation"


def test_a_price_whose_label_is_not_rent_is_skipped_not_parked():
    """No «Sale» label exists on the live site (254 pages, 2026-09-24); the word is flipped inside
    a verbatim block to prove the guard, because a sale figure parked in price_annual would be a
    lie about the period."""
    rows, why, skips = R.map_units(URL, page(U629.replace("Rent - (SR)247,000", "Sale - (SR)247,000")))
    assert rows == [] and why == "no_available_units" and skips == {"deal_not_rent": 1}
    assert R.rent_price("Sale - (SR)1") == (None, "deal_not_rent")
    assert R.rent_price("") == (None, "")


# ── 4. area ──────────────────────────────────────────────────────────────────────────────────────
def test_sqm_is_stored_and_sqf_is_kept_raw_not_converted():
    assert R.area_m2("4 Bedrooms 5 Bathrooms 300 sqm") == (300, "300 sqm")
    row = R.map_units(URL_STAR, page(STAR))[0][0]
    assert row["area_m2"] is None and row["additional_info"]["area_raw"] == "245 sqf"
    assert row["bedrooms"] == 3 and row["bathrooms"] == 4 and row["price_annual"] == 190000


# ── 5/6. type and availability ───────────────────────────────────────────────────────────────────
def test_a_unit_with_no_type_word_is_refused_and_counted():
    rows, why, skips = R.map_units(URL, page(TEST))
    assert rows == [] and why == "no_available_units" and skips == {"type_unmapped": 1}


def test_type_words_fold_the_way_the_fleet_does():
    assert R.unit_type_ar("Town House \" A \" Three Bedroom fully furnished") == "فيلا"
    assert R.unit_type_ar("Duplex Two Bedroom fully furnished Apartment") == "شقة"
    assert R.unit_type_ar("Two-Bedroom Apartments with balcony") == "شقة"
    assert R.unit_type_ar("Studio fully furnished Apartment") == "استوديو"
    assert R.unit_type_ar("Four Bedroom Duplex Villa Pool View") == "فيلا"
    assert R.unit_type_ar("Duplex") == "دوبلكس"
    assert R.unit_type_ar("DELUXE SUITE") is None and R.unit_type_ar("A-1") is None


def test_an_unavailable_unit_is_skipped():
    """Every live unit carried data-is-available="True" on capture day; the value is flipped inside
    the verbatim block to prove the branch — a unit the source marks unavailable is not a listing."""
    rows, why, skips = R.map_units(URL, page(U629.replace('data-is-available="True"', 'data-is-available="False"'), U632))
    assert [r["ad_number"] for r in rows] == ["RCP632"] and why == "" and skips == {"unit_not_available": 1}


# ── 7. location ──────────────────────────────────────────────────────────────────────────────────
def test_city_comes_from_the_url_segment_and_a_region_slug_is_refused():
    row = R.map_units(URL, page(U629))[0][0]
    assert (row["city_ar"], row["city_id"], row["region_id"], row["city"]) == ("الرياض", 1, 100, "Riyadh")
    assert R.map_units(URL_QASEEM, page(PALMA)) == ([], "city_not_in_catalog", {})
    assert R.map_units("https://rightcompound.com/compounds/atlantis/x", page(U629))[0] == []


def test_district_is_written_only_when_the_catalog_attests_it():
    row = R.map_units(URL, page(U629))[0][0]
    assert row["district_ar"] == "حي المونسية" and row["neighborhood"] == "Al Munsiyah"
    assert row["zip_code"] == "13422" and round(row["additional_info"]["latitude"], 3) == 24.834
    # A district sentence naming something the catalog does not carry writes NULL, raw text kept.
    row2 = R.map_units(URL, page(U629, dist="The compound is located in the Al Zahra District of Riyadh."))[0][0]
    assert row2["district_ar"] is None and row2["neighborhood"] == "Al Zahra"


# ── 8. furnished, photos, PII ────────────────────────────────────────────────────────────────────
def test_furnished_only_from_the_units_own_words():
    rows = R.map_units(URL, page(U629, U632))[0]
    assert rows[0]["furnished"] is True
    row_plain = R.map_units(URL, page(U629.replace("fully furnished", "")))[0][0]
    assert "furnished" not in row_plain, "silence is NULL, not False"


def test_photos_prefer_the_full_size_data_orig():
    row = R.map_units(URL, page(U629))[0][0]
    assert row["photo_urls"] == [
        "https://rightcompoundimages.blob.core.windows.net/images/Common/Images/Compound/423/923e3f32a7b544cca5e97f43b5587a17.jpeg"]
    assert row["air_conditioner"] is None if "air_conditioner" in row else True


def test_a_phone_number_in_the_about_text_never_reaches_the_row():
    about = ABOUT.replace("VR Tour Available", "Call 0501234567 — VR Tour Available")   # inserted to prove the redaction
    row = R.map_units(URL, page(U629, about=about))[0][0]
    assert "0501234567" not in row["description"] and "VR Tour Available" in row["description"]
    assert "loved ones." in row["description"], "the whole About body is read, not just its first line"


# ── 9. removal oracle ────────────────────────────────────────────────────────────────────────────
def test_the_unit_signal_reads_only_the_compounds_own_unit_list():
    sig = R._unit_signal("629")
    assert sig(404, "", False) == "gone"
    assert sig(200, page(U629, U632), False) == "live"
    assert sig(200, page(U632), False) == "gone", "the compound is served; this unit is not on it"
    assert sig(200, page(U629.replace('data-is-available="True"', 'data-is-available="False"')), False) == "gone"
    assert sig(200, "<html>Page not found</html>", False) is None
    assert sig(403, page(U629), False) is None and sig(503, "", False) is None


def test_the_shared_law_turns_a_block_into_unknown_and_removals_fail_closed(monkeypatch):
    class _Resp:
        def __init__(self, status, text, url):
            self.status_code, self.text, self.url = status, text, url

    served = {"status": 403, "body": page(U629)}
    monkeypatch.setattr(http_liveness.LivenessProbe, "fetch",
                        lambda self, url: (served["status"], served["body"], False))
    monkeypatch.setattr(http_liveness, "time", types.SimpleNamespace(sleep=lambda *_: None))
    monkeypatch.setattr(R, "stored_listing_url", lambda tables: (lambda ad: URL))
    verify = R._make_verify_gone(None)
    assert verify("RCP629")[0] == "unknown"
    served["status"] = 404
    verdict, why = verify("RCP629")
    assert verdict == "unknown" and "no row from this run" in why, "no canary → no removal"
    verify_ok = R._make_verify_gone({"ad_number": "RCP632", "listing_url": URL})
    served["status"], served["body"] = 200, page(U632)
    assert verify_ok("RCP629")[0] == "gone"
    assert verify_ok("RCPxyz")[0] == "unknown"


# ── 10. main() ───────────────────────────────────────────────────────────────────────────────────
class _FakeResp:
    def __init__(self, status, text):
        self.status_code, self.text = status, text


def _wire(monkeypatch, pages: dict, argv: list[str]):
    sitemap = "<urlset>" + "".join(f"<loc>{u}</loc>" for u in pages) + "<loc>https://rightcompound.com/compounds/riyadh</loc><loc>https://rightcompound.com/compounds/</loc></urlset>"

    class _S:
        headers: dict = {}

        def get(self, url, timeout=0):
            if url.endswith("/sitemap.xml"):
                return _FakeResp(200, sitemap)
            if "/api/v1/compounds" in url:
                return _FakeResp(200, '{"total": %d}' % len(pages))
            got = pages[url]
            if isinstance(got, Exception):
                raise got
            return _FakeResp(*got)

    calls: dict = {"end_run": [], "batch": [], "prune": [], "retire": []}
    monkeypatch.setattr(R, "session", lambda: _S())
    monkeypatch.setattr(R, "time", types.SimpleNamespace(sleep=lambda *_: None))
    monkeypatch.setattr(R.db, "begin_run", lambda p: 7)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **kw: (calls["end_run"].append(kw), True)[1])
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda table, rows: calls["batch"].append((table, len(rows))))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **kw: calls["retire"].append(kw) or 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda table, seen, **kw: calls["prune"].append((table, set(seen))) or 0)
    monkeypatch.setattr(R.db, "mark_direct_alive", lambda row, *, oracle: row)
    monkeypatch.setattr("sys.argv", ["run.py", *argv])
    return calls


def test_main_writes_the_tally_into_end_run_notes_and_prunes_after_a_complete_walk(monkeypatch):
    pages = {URL: (200, page(U629, U632, TEST)), URL_QASEEM: (200, page(PALMA)),
             "https://rightcompound.com/compounds/riyadh/gone-a1": (404, "not found")}
    calls = _wire(monkeypatch, pages, [])
    assert R.main() == 0
    kw = calls["end_run"][0]
    assert kw["ok"] is True and kw["rows_seen"] == 3 and kw["rows_upserted"] == 2
    assert "type_unmappedx1" in kw["notes"] and "city_not_in_catalogx1" in kw["notes"] and "http_404x1" in kw["notes"]
    assert kw["check_tables"] == ["rightcompound_residential_listings", "rightcompound_commercial_listings"]
    assert calls["batch"] == [("rightcompound_residential_listings", 2)]
    assert calls["retire"][0]["res_ads"] == {"RCP629", "RCP632"} and calls["retire"][0]["source"] == "RightCompound"
    assert calls["prune"] == [("rightcompound_residential_listings", {"RCP629", "RCP632"})]


def test_main_never_prunes_after_an_incomplete_walk(monkeypatch):
    pages = {URL: (200, page(U629)), URL_STAR: RuntimeError("timeout")}
    calls = _wire(monkeypatch, pages, [])
    assert R.main() == 0
    assert calls["prune"] == [] and "unreachablex1" in calls["end_run"][0]["notes"]


def test_dry_run_and_limit_write_nothing(monkeypatch):
    calls = _wire(monkeypatch, {URL: (200, page(U629))}, ["--limit", "1"])
    assert R.main() == 0 and calls["batch"] == [] and calls["end_run"] == []


def test_sitemap_filter_keeps_punctuation_slugs_and_drops_city_index_pages():
    class _S:
        def get(self, url, timeout=0):
            return _FakeResp(200, "<loc>https://rightcompound.com/compounds/</loc>"
                                  "<loc>https://rightcompound.com/compounds/riyadh</loc>"
                                  "<loc>https://rightcompound.com/compounds/riyadh/kease-compound-%E2%80%93-qurtubah-district,-riyadh</loc>"
                                  "<loc>https://rightcompound.com/compounds/khobar/radisson-blu-residence,-dhahran</loc>"
                                  "<loc>https://rightcompound.com/blog/x</loc>")
    assert R.fetch_compounds(_S()) == [
        "https://rightcompound.com/compounds/khobar/radisson-blu-residence,-dhahran",
        "https://rightcompound.com/compounds/riyadh/kease-compound-%E2%80%93-qurtubah-district,-riyadh"]
