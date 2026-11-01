"""CompoundIn: a unit card is read inside its own <article>, and removals ask the compound page.

COVERAGE AUDIT 2026-09-28, measured over the 130 sitemap compounds:
  · _UNIT_RE REQUIRED a `cin-unit-card__subtitle` and spanned cards with `.*?`. 68 of 270 live cards
    have no subtitle, so 14 compounds matched 0 units and were dropped whole (canary-vista 5,
    mena-house-compound 2, hada-villas 1, sulimania-villas 1 …) — and where only some cards lacked
    one, a card's type/specs were stitched onto the NEXT card's price and id. Olaris Residence is
    that shape verbatim: an id-less, priceless «1 Master Bedroom» card (75 sqm) sits before unit 800
    (2 bedrooms, 97 sqm, 140,000), and the old regex published CIN800 as 1 bedroom / 75 sqm.
  · compoundin had no prune: CIN703/CIN704 (ayanna-olaya-compound) left the sitemap and their page
    says «This compound is no longer listed», yet both were still active, last seen 2026-09-22.

The card markup below is copied from the live olaris-residence and canary-vista pages; only the
carousel/image markup map_units never reads is omitted. main() runs for real against a fake
transport and a recording db.
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

# Hermetic import: stub supabase + dotenv so db.py imports with no credentials/network.
_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.common import http_liveness  # noqa: E402
from scrapers.compoundin import run as R  # noqa: E402

URL = "https://compoundin.com/rent/show/6a0000000000a/olaris-residence"
GONE_URL = "https://compoundin.com/rent/show/696fa59bef65d/ayanna-olaya-compound"

_IDLESS_CARD = """<article class="cin-compound-card cin-unit-card"><div class="cin-compound-card__body">
<h3 class="cin-compound-card__title cin-unit-card__title">Apartment</h3>
<p class="cin-unit-card__subtitle">1 Master Bedroom</p>
<p class="cin-compound-card__specs"><i class="fa fa-bed"></i> 1 Bedrooms<br /><i class="fa fa-bath"></i> 1 Bathrooms<br /><i class="fa fa-arrows-alt"></i> 75 sqm</p>
<p class="cin-unit-card__amenities">Air Conditioning · Balcony · Furnished · Kitchen · Living Room</p>
</div></article>"""
_UNIT_800 = """<article class="cin-compound-card cin-unit-card"><div class="cin-compound-card__body">
<h3 class="cin-compound-card__title cin-unit-card__title">Apartment</h3>
<p class="cin-unit-card__subtitle">2 Bedrooms</p>
<p class="cin-compound-card__specs"><i class="fa fa-bed"></i> 2 Bedrooms<br /><i class="fa fa-bath"></i> 3 Bathrooms<br /><i class="fa fa-arrows-alt"></i> 97 sqm</p>
<p class="cin-unit-card__amenities">Furnished · High-Speed Internet / Wi-Fi · Kitchen · Parking</p>
<div class="cin-compound-card__price"><div class="cin-compound-card__price-main cin-compound-card__price-main--amount">
<span class="cin-compound-card__amount-value">140,000</span></div></div>
<div class="cin-unit-card__actions"><button type="button" class="btn btn-success btn-block cin-unit-card__inquire-btn"
 data-cin-open-contact-modal data-cin-contact-unit="800">Inquire Now</button></div>
</div></article>"""
# canary-vista: NO subtitle at all, and «Request Price».
_UNIT_265 = """<article class="cin-compound-card cin-unit-card"><div class="cin-compound-card__body">
<h3 class="cin-compound-card__title cin-unit-card__title">Studio</h3>
<p class="cin-compound-card__specs"><i class="fa fa-bed"></i> 1 Bedrooms<br /><i class="fa fa-bath"></i> 1 Bathrooms<br /><i class="fa fa-arrows-alt"></i> 45 sqm</p>
<p class="cin-unit-card__amenities">Balcony · Furnished · Kitchen · Road View</p>
<div class="cin-compound-card__price"><div class="cin-compound-card__price-main">
<span class="cin-compound-card__amount-value">Request Price</span></div></div>
<div class="cin-unit-card__actions"><button type="button" class="btn btn-success btn-block cin-unit-card__inquire-btn"
 data-cin-open-contact-modal data-cin-contact-unit="265">Inquire Now</button></div>
</div></article>"""
LIVE_PAGE = ('<a>Residential compound for rent in Riyadh</a><h1 class="cin-property-overview__name">'
             'Olaris Residence</h1>' + _IDLESS_CARD + _UNIT_800 + _UNIT_265)
DELISTED_PAGE = ("<h1>This compound is no longer listed</h1>"
                 '<article class="cin-compound-card"><h3 class="cin-compound-card__title">Other</h3></article>')


class _Resp:
    def __init__(self, status, text, url):
        self.status_code, self.text, self.url = status, text, url


def _session(pages):
    class _S:
        def get(self, url, **_k):
            if url.endswith("sitemap.xml"):
                return _Resp(200, "".join(f"<loc>{u}</loc>" for u in pages), url)
            status, text = pages[url]
            return _Resp(status, text, url)
    return lambda: _S()


def test_each_unit_is_read_from_its_own_card_and_a_complete_crawl_prunes_with_the_page_oracle(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda city_ar, region_hint=None: (3, 1))
    monkeypatch.setattr(R, "find_district_in_text", lambda text, city_id: None)
    monkeypatch.setattr(http_liveness.time, "sleep", lambda *_: None)
    calls: dict[str, list] = {"upsert": [], "prune": []}
    monkeypatch.setattr(R.db, "begin_run", lambda *_a, **_k: 1)
    monkeypatch.setattr(R.db, "end_run", lambda *_a, **_k: True)
    monkeypatch.setattr(R.db, "upsert_compoundin_residential_batch", lambda rows: calls["upsert"].append(rows))
    monkeypatch.setattr(R.db, "prune_unseen",
                        lambda tbl, seen, source=None, verify_gone=None, **_k:
                        calls["prune"].append((tbl, set(seen), verify_gone)) or 0)
    monkeypatch.setattr(sys, "argv", ["run.py", "--type", "all"])

    # 1) Every card's fields come from THAT card; the id-less card has no identity and is skipped.
    monkeypatch.setattr(R, "session", _session({URL: (200, LIVE_PAGE)}))
    assert R.main() == 0
    rows = {r["ad_number"]: r for r in calls["upsert"][0]}
    assert set(rows) == {"CIN800", "CIN265"}, f"units read: {sorted(rows)}"
    assert (rows["CIN800"]["bedrooms"], rows["CIN800"]["area_m2"], rows["CIN800"]["price_annual"]) == (2, 97, 140000)
    assert (rows["CIN265"]["property_type"], rows["CIN265"]["area_m2"], rows["CIN265"]["price_annual"]) == ("Studio", 45, None)
    assert rows["CIN265"]["additional_info"]["amenities_en"] == "Balcony · Furnished · Kitchen · Road View"

    # 2) A complete crawl prunes, and the oracle it hands over reads the row's own compound page.
    assert len(calls["prune"]) == 1
    tbl, seen, verify_gone = calls["prune"][0]
    assert tbl == "compoundin_residential_listings" and seen == {"CIN800", "CIN265"}
    stored = {"CIN703": GONE_URL, "CIN800": URL, "CIN265": URL, "CIN999": URL}
    monkeypatch.setattr(R, "stored_listing_url", lambda _tables: stored.get)
    monkeypatch.setattr(R, "session", _session({URL: (200, LIVE_PAGE), GONE_URL: (200, DELISTED_PAGE)}))
    assert verify_gone("CIN703")[0] == "gone"       # «This compound is no longer listed» on a 200
    assert verify_gone("CIN800")[0] == "live"       # its own card is on the page
    assert verify_gone("CIN999")[0] == "unknown"    # a listed page without it: not measured → hold

    # 3) An incomplete crawl (one compound page answered 500) never prunes.
    calls["prune"].clear()
    monkeypatch.setattr(R, "session", _session({URL: (200, LIVE_PAGE), GONE_URL: (500, "")}))
    assert R.main() == 0 and calls["prune"] == []
