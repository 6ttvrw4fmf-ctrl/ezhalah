"""The hourly robot customer must CATCH a broken Advanced Filter mapping (🔬 night-2 net, 2026-10-05).

A fake anon RPC applies the real contract — amenity params are English slugs (`ac`, never
`air_conditioner`), furnished is p_furnished — and returns the listing only when the request is right.
The robot must report found on the real mapping and a MISS when the mapping is deliberately broken.

Run: python -m pytest scrapers/common/tests/test_af_robot.py -v
"""
from __future__ import annotations

import random
import sys

import pytest

sys.path.insert(0, ".")

from scrapers.common import af_robot as R  # noqa: E402
from scrapers.common import af_score as S  # noqa: E402

SLUG_COL = {"elevator": "elevator", "parking": "parking", "kitchen": "kitchen", "ac": "air_conditioner",
            "maid_room": "maid_room", "driver_room": "driver_room", "private_entrance": "private_entrance"}

ROW = {"platform": "aqar", "source_table": "aqar_residential_listings", "listing_id": 8844647,
       "deal_ar": "إيجار", "city_ar": "جدة", "district_ar": "حي الصفا", "type_ar": "شقة",
       "rent_period_ar": "سنوي", "elevator": True, "parking": True, "kitchen": True, "air_conditioner": True,
       "furnished": True, "maid_room": True, "driver_room": True, "private_entrance": True}


class _Exec:
    def __init__(self, data):
        self.data = data

    def execute(self):
        return self


class FakeAnon:
    """location_search_candidates_ar, reduced to the parts a mapping bug breaks."""
    def __init__(self, rows):
        self.rows = rows

    def rpc(self, name, p):
        assert name == "location_search_candidates_ar"
        out = []
        for r in self.rows:
            if p.get("p_rent_period") not in (None, r["rent_period_ar"]):
                continue
            if any(slug not in SLUG_COL or not r.get(SLUG_COL[slug]) for slug in (p.get("p_amenities") or [])):
                continue                                   # an unknown slug matches nothing — like the RPC
            if p.get("p_furnished") is not None and r.get("furnished") is not p["p_furnished"]:
                continue
            out.append({"source_table": r["source_table"], "listing_id": r["listing_id"]})
        return _Exec(out)


@pytest.mark.parametrize("answer", R.ANSWERS)
def test_real_mapping_finds_every_answer(answer):
    assert R.check(FakeAnon([ROW]), ROW, answer) is True


def test_a_broken_slug_mapping_is_caught(monkeypatch):
    monkeypatch.setitem(S.AMENITY_SLUG, "air_conditioner", "air_conditioner")   # the mutation
    assert R.check(FakeAnon([ROW]), ROW, "air_conditioner") is False


def test_monthly_furnished_is_never_asked():
    assert R.check(FakeAnon([ROW]), dict(ROW, rent_period_ar="شهري"), "furnished") is None


def test_rotation_covers_every_answer_within_a_day():
    seen = {a for h in range(24) for a in R.rotation(h)}
    assert seen == set(R.ANSWERS)


def test_run_reports_a_miss_with_its_key(monkeypatch):
    monkeypatch.setattr(R, "pick", lambda client, answer, rng: ROW)
    monkeypatch.setitem(S.AMENITY_SLUG, "kitchen", "مطبخ")                      # Arabic slug: trap 3
    res = R.run(None, FakeAnon([ROW]), 0, random.Random(0))
    assert any(m["key"] == "aqar_residential_listings:8844647" and m["answer"] == "kitchen" for m in res["missed"])
