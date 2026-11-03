"""A site whose crawl has a body-reading oracle is never double-checked by HTTP status (2026-11-03).

aqaratikom's listing page is an identical login-walled SPA shell for live and removed ads, so the
status reader scored all 19 struck-but-shown rows «live». Its crawl reads the ad's own API record
(scrapers/aqaratikom/run.py::_verify_gone); the spot-check and the dead-visible score must too.
"""
from scrapers.common import lifecycle_spot_check as sc


def test_aqaratikom_is_read_by_its_crawl_oracle(monkeypatch):
    from scrapers.aqaratikom import run as aq
    calls = []

    def fake(ad):
        calls.append(ad)
        return ("gone", "API record 404")
    monkeypatch.setattr(aq, "_verify_gone", fake)
    method, read = sc.pick_reader("aqaratikom", None, None)
    assert method == "site-oracle"
    row = {"ad_number": "AQTKf9ddb0534c5a", "listing_url": "https://nawait.sa/real-estate/x"}
    assert read(row) == sc.DEAD and calls == ["AQTKf9ddb0534c5a"]


def test_every_crawl_oracle_resolves_to_a_callable():
    from scrapers.common import fleet_liveness as FL
    for platform, spec in sc.CRAWL_ORACLES.items():
        assert platform not in FL.SITES, f"{platform} is on the daily check; it needs no entry here"
        assert callable(FL.oracle_for(spec, None)), platform
