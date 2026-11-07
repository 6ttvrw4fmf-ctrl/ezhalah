"""aqarcity's own-page oracle is callable by the daily direct check (♻️ 2026-11-07).

AC30220 (aqarcity_residential_listings 2497625) lost its REGA licence on 2026-11-06 and its page went to the
expired banner; the only reader of that page was the crawl's prune, which reads at three crawl misses, so the
ad was on screen at the 11-07 09:05 dead-visible score (aqarcity over the line, missing_count 1).
Drives the REAL factory with _probe_id stubbed, network blocked.
"""
from __future__ import annotations

import pytest

import scrapers.aqarcity.run as A
import scrapers.common.fleet_liveness as F


@pytest.fixture
def probe(monkeypatch):
    answers: dict[str, str] = {}
    monkeypatch.setattr(A, "session", lambda: type("S", (), {"get": lambda *a, **k: None})())
    monkeypatch.setattr(A, "_probe_id", lambda _s, url: answers[url.rsplit("/", 1)[-1]])
    monkeypatch.setenv("AQARCITY_PROBE_DELAY", "0")
    return answers


def test_aqarcity_is_a_fleet_site_and_its_spec_resolves():
    assert F.SITES["aqarcity"] == "scrapers.aqarcity.run:_make_verify_gone()"
    assert callable(F.oracle_for(F.SITES["aqarcity"], {"ad_number": "AC1"}))


def test_expired_banner_is_gone_only_with_a_live_control(probe):
    probe.update({"30220": "expired", "1": "live"})
    assert A._make_verify_gone({"ad_number": "AC1"})("AC30220")[0] == "gone"


def test_no_live_control_withholds_every_kill(probe):
    probe.update({"30220": "expired", "1": "exists", "404": "notfound"})
    vg = A._make_verify_gone({"ad_number": "AC1"})
    assert vg("AC30220")[0] == "unknown"
    assert vg("AC404")[0] == "unknown"
    assert A._make_verify_gone(None)("AC30220")[0] == "unknown"


@pytest.mark.parametrize("shape,verdict", [("live", "live"), ("exists", "unknown"), ("error", "unknown"),
                                           ("notfound", "gone")])
def test_every_shape_maps_like_the_crawls_prune(probe, shape, verdict):
    probe.update({"9": shape, "1": "live"})
    assert A._make_verify_gone({"ad_number": "AC1"})("AC9")[0] == verdict
