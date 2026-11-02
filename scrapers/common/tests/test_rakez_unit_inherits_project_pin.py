"""rakez: a unit's map pin is its PROJECT's pin, read from the site's map feed (owner 2026-10-30: 3,660 ads, 0 pins).

The project page draws no map; /ar/projects-map/ calls /ar/wp-json/hs-map/v1/projects, one JSON naming every
mapped project's lat/lng by its English post id — the id every unit carries in `unit_project`. Three outcomes:
  · project on the map   → the unit carries latitude/longitude + pin_scope=project (shared by design, not a default)
  · feed read, project not on it → pin_absent=true (the source maps no pin for it; a stale pair may leave)
  · feed NOT read (None) → neither key, so keep_stored_pin keeps yesterday's pair (a failed fetch ≠ «no pin»)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common.tests.test_rakez_unit_and_project_join import (  # noqa: E402,F401
    TREE, _project, _seed, _unit,   # _seed: the sibling's autouse catalog stub applies here too
)
from scrapers.rakez import run as R  # noqa: E402

FEED = {"generated_at": "2026-10-29T18:40:06+00:00", "lang": "en", "count": 3, "projects": [
    {"id": 66800, "permalink": "https://rakez.sa/en/project/66800/", "lat": 24.7061461, "lng": 46.6742925,
     "city_path": {"root_city_name": "Riyadh", "district_name": "Al Yasmin"}, "status": {"name": "Available"}},
    {"id": 27454, "lat": 24.7214462, "lng": 46.6742395},
    {"id": 99999, "lat": 30.0443, "lng": 31.2357},          # Cairo: outside KSA, rejected by sa_pin
    {"id": "x", "lat": 24.7, "lng": 46.7},                    # malformed id, skipped
]}


def _row(pins, project=66800):
    p = _project()
    u = _unit()
    u["acf"]["unit_project"] = project
    row, _ = R.map_unit(u, p, p, TREE, pins)
    assert row is not None
    return row["additional_info"]


def test_feed_is_keyed_by_english_project_id_and_outside_ksa_is_no_pin():
    pins = R.pins_from_feed(FEED)
    assert pins[66800] == {"latitude": 24.7061461, "longitude": 46.6742925}
    assert pins[27454] == {"latitude": 24.7214462, "longitude": 46.6742395}
    assert pins[99999] == {}                       # read, rejected — never a Cairo pin on a Riyadh unit
    assert "x" not in pins
    assert R.pins_from_feed({"projects": "nope"}) == {} and R.pins_from_feed(None) == {}


def test_unit_inherits_its_projects_pin_marked_project_scope():
    ai = _row(R.pins_from_feed(FEED))
    assert (ai["latitude"], ai["longitude"]) == (24.7061461, 46.6742925)
    assert ai["pin_scope"] == "project"
    assert "pin_absent" not in ai


def test_project_not_on_the_map_says_pin_absent_and_unread_feed_says_nothing():
    off_map = _row(R.pins_from_feed(FEED), project=14585)
    assert off_map.get("pin_absent") is True and "latitude" not in off_map
    rejected = _row(R.pins_from_feed(FEED), project=99999)
    assert rejected.get("pin_absent") is True and "latitude" not in rejected
    unread = _row(None)
    assert "pin_absent" not in unread and "latitude" not in unread and "pin_scope" not in unread


def test_the_feed_url_is_the_map_pages_own_call():
    assert R.MAP_FEED == "https://rakez.sa/ar/wp-json/hs-map/v1/projects?lang=en"
