"""fleet-liveness.yml `site` input: one dispatch may name several sites (2026-10-17)."""
import pytest

from scrapers.common import fleet_liveness as FL


def test_empty_plans_every_site():
    assert FL.plan_sites("") == sorted(FL.SITES)


def test_a_comma_list_plans_exactly_those_sites_once_in_order():
    a, b = sorted(FL.SITES)[:2]
    assert FL.plan_sites(f" {b}, {a},{b} ") == [b, a]


def test_one_site_still_works():
    a = sorted(FL.SITES)[0]
    assert FL.plan_sites(a) == [a]


def test_an_unknown_site_is_refused_not_guessed():
    with pytest.raises(SystemExit):
        FL.plan_sites(f"{sorted(FL.SITES)[0]},nosuchsite")
