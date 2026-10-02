"""Audit 2026-10-02, group «fail-open-filters»: alta, aalbarrak, almuteb.

THE HOLE (same in all three): the sold/rented filter reads the source's `property_status`
taxonomy, and a FAILED taxonomy request was swallowed — the id→name map came back empty, every
status resolved to nothing, and "could not read the status" was written as "available".

MEASURED LIVE 2026-10-02 (before a line was changed):
  alta       property_status = تم البيع 9 · تم التأجير 1 · غير متاح 2 · متاح 6 (4 terms). 17 posts →
             16 mapped rows: 9 inactive + 7 active. With the status map dropped: 16 active, 0
             inactive — all 9 sold posts flip to active.
  aalbarrak  للبيع 5 · للإيجار 5 · تم البيع 0 · تم الايجار 0 (4 terms). 10/10 titles carry a deal word,
             so with an empty status map 9 rows are still upserted from the title alone.
  almuteb    للبيع 10 · للإيجار 0 (2 terms; the site has no sold term). 0/10 titles carry a deal
             word, so an empty map already yields no rows — the guard makes that loud, not silent.

Every fixture is SYNTHETIC (no ad text, names or numbers from a real listing); every assertion
runs the shipping functions. Each test fails on origin/main's run.py.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.aalbarrak import run as BRK  # noqa: E402
from scrapers.almuteb import run as MTB  # noqa: E402
from scrapers.alta import run as ALT  # noqa: E402


class _Resp:
    def __init__(self, status: int, payload, total=None):
        self.status_code, self._payload = status, payload
        self.headers = {"x-wp-total": str(total)} if total is not None else {}

    def json(self):
        if self._payload is None:
            raise ValueError("not JSON")
        return self._payload


class _Site:
    """A WP REST stand-in: `routes` maps the last path segment → (status, payload)."""

    def __init__(self, routes: dict):
        self.routes = routes

    def get(self, url, params=None, timeout=None):
        key = url.split("?")[0].rstrip("/").rsplit("/", 1)[-1]
        status, payload = self.routes.get(key, (200, []))
        return _Resp(status, payload, total=len(payload) if isinstance(payload, list) else None)


def _terms(names: dict) -> list:
    return [{"id": i, "name": n} for i, n in names.items()]


# ───────────────────────────────────────── alta ─────────────────────────────────────────
ALT_TAX = {
    "property_category": (200, _terms({1: "فلل"})),
    "property_action_category": (200, _terms({2: "بيع"})),
    "property_status": (200, _terms({10: "متاح", 11: "تم البيع"})),
}


def _alt_post(pid: int, statuses: list) -> dict:
    return {"id": pid, "slug": f"synthetic-{pid}", "link": f"https://alta.com.sa/estate_property/synthetic-{pid}/",
            "title": {"rendered": "فيلا تجريبية"}, "content": {"rendered": "<p>نص تجريبي</p>"},
            "property_category": [1], "property_action_category": [2], "property_status": statuses}


ALT_POSTS = [_alt_post(1, [10]), _alt_post(2, [11]), _alt_post(3, [])]


def _alt_main(monkeypatch, routes: dict) -> dict:
    calls: dict = {"upserts": [], "pins": []}
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(ALT, "session", lambda: _Site(routes))
    monkeypatch.setattr(ALT.db, "begin_run", lambda platform: 7)
    monkeypatch.setattr(ALT.db, "end_run", lambda run_id, **kw: calls.update(end=kw) or True)
    for fn in ("upsert_alta_residential_batch", "upsert_alta_commercial_batch"):
        monkeypatch.setattr(ALT.db, fn, lambda rows: calls["upserts"].append(
            {r["additional_info"]["wp_id"]: r["active"] for r in rows}))
    monkeypatch.setattr(ALT.sold_pin, "pin_source_confirmed_gone",
                        lambda table, ads, **kw: calls["pins"].append(list(ads)))
    calls["rc"] = ALT.main()
    return calls


@pytest.mark.parametrize("broken", [(500, []), (200, None), (200, {"code": "rest_no_route"}), (200, [])],
                         ids=["http-500", "not-json", "not-a-list", "empty-list"])
def test_alta_unreadable_status_taxonomy_writes_nothing(monkeypatch, broken):
    """The sold post must never be upserted active because its status could not be read."""
    calls = _alt_main(monkeypatch, {**ALT_TAX, "property_status": broken, "estate_property": (200, ALT_POSTS)})
    assert calls["upserts"] == [] and calls["pins"] == []
    assert calls["rc"] == 1 and calls["end"]["ok"] is False
    assert "property_status" in calls["end"]["notes"]


def test_alta_status_id_the_map_cannot_name_stops_the_run():
    tax = {"property_category": {1: "فلل"}, "property_action_category": {2: "بيع"},
           "property_status": {10: "متاح"}}
    with pytest.raises(RuntimeError, match="property_status"):
        ALT.map_listing(_alt_post(2, [11]), tax)          # 11 = the sold term, missing from the map


def test_alta_readable_status_keeps_todays_verdicts_and_counts_the_silent_ad(monkeypatch):
    calls = _alt_main(monkeypatch, {**ALT_TAX, "estate_property": (200, ALT_POSTS)})
    assert calls["rc"] == 0
    # available → active, sold → inactive, NO status term → active (the source states nothing)
    assert calls["upserts"] == [{1: True, 2: False, 3: True}]
    assert calls["end"]["notes"] == "no_status_termx1"


def test_alta_a_status_nobody_measured_stays_active_and_is_counted(monkeypatch):
    routes = {**ALT_TAX, "property_status": (200, _terms({10: "متاح", 11: "تم البيع", 12: "حالة تجريبية"})),
              "estate_property": (200, [_alt_post(4, [12])])}
    calls = _alt_main(monkeypatch, routes)
    assert calls["upserts"] == [{4: True}]
    assert calls["end"]["notes"] == "status_not_measured:حالة تجريبيةx1"


# ─────────────────────────────── aalbarrak + almuteb (Houzez twins) ───────────────────────────────
HZ_TAX = {"property_type": {5: "فيلا"}, "property_status": {20: "للبيع", 75: "تم البيع"},
          "property_city": {18: "الرياض"}, "property_area": {}, "property_feature": {}}


def _hz_post(pid: int, base: str, statuses: list) -> dict:
    # The title states the deal, exactly like 10/10 aalbarrak titles: that is what let a sold post
    # through once its status term stopped resolving.
    return {"id": pid, "link": f"{base}/property/synthetic-{pid}/", "status": "publish",
            "title": {"rendered": "فيلا للبيع في حي تجريبي, مدينة الرياض"}, "content": {"rendered": "<p>نص تجريبي</p>"},
            "property_type": [5], "property_status": statuses, "property_city": [18],
            "property_meta": {"fave_property_price": ["1000000"], "fave_property_land": ["300"]}}


@pytest.fixture
def _no_catalog_network(monkeypatch):
    for R in (BRK, MTB):
        monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (3, 1))
        monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: None)


def _hz_main(monkeypatch, R, routes: dict) -> dict:
    calls: dict = {"batches": [], "prunes": 0}
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "session", lambda: _Site(routes))
    monkeypatch.setattr(R.db, "begin_run", lambda platform: 7)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda tbl, rows: calls["batches"].extend(r["ad_number"] for r in rows))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda tbl, seen, source, **kw: calls.update(prunes=calls["prunes"] + 1) or 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **kw: calls.update(end=kw) or True)
    calls["rc"] = R.main()
    return calls


def _hz_routes(R, status_answer) -> dict:
    routes = {t: (200, _terms(names)) for t, names in HZ_TAX.items()}
    routes["property_status"] = status_answer
    routes["properties"] = (200, [_hz_post(1, R.BASE, [75])])     # ONE post, flagged «تم البيع»
    return routes


@pytest.mark.parametrize("R", [BRK, MTB], ids=["aalbarrak", "almuteb"])
@pytest.mark.parametrize("broken", [(503, []), (200, None), (200, {"code": "x"}), (200, [])],
                         ids=["http-503", "not-json", "not-a-list", "empty-list"])
def test_houzez_unreadable_status_taxonomy_raises(R, broken):
    with pytest.raises(RuntimeError, match="property_status"):
        R.fetch_taxonomies(_Site(_hz_routes(R, broken)))


@pytest.mark.parametrize("R", [BRK, MTB], ids=["aalbarrak", "almuteb"])
def test_houzez_unreadable_status_taxonomy_writes_and_prunes_nothing(monkeypatch, _no_catalog_network, R):
    """On origin/main aalbarrak upserts the sold post active here (deal read off the title)."""
    calls = _hz_main(monkeypatch, R, _hz_routes(R, (503, [])))
    assert calls["batches"] == [] and calls["prunes"] == 0
    assert calls["rc"] == 1 and calls["end"]["ok"] is False
    assert "property_status" in calls["end"]["notes"]


@pytest.mark.parametrize("R", [BRK, MTB], ids=["aalbarrak", "almuteb"])
def test_houzez_status_id_the_map_cannot_name_stops_the_run(_no_catalog_network, R):
    partial = {**HZ_TAX, "property_status": {20: "للبيع"}}       # the sold term 75 is not in the map
    with pytest.raises(RuntimeError, match="property_status"):
        R.map_listing(_hz_post(1, R.BASE, [75]), partial, [])


@pytest.mark.parametrize("R", [BRK, MTB], ids=["aalbarrak", "almuteb"])
def test_houzez_readable_status_keeps_todays_verdicts(monkeypatch, _no_catalog_network, R):
    routes = _hz_routes(R, (200, _terms({20: "للبيع", 75: "تم البيع", 90: "حالة تجريبية"})))
    routes["properties"] = (200, [_hz_post(1, R.BASE, [75]), _hz_post(2, R.BASE, [20]), _hz_post(3, R.BASE, [90])])
    calls = _hz_main(monkeypatch, R, routes)
    assert calls["rc"] == 0
    assert f"{R.PREFIX}1" not in calls["batches"] and f"{R.PREFIX}2" in calls["batches"]   # sold out, for-sale in
    assert "sold_or_rentedx1" in calls["end"]["notes"]
    # a status name nobody measured: treated exactly as before, but visible in the run notes
    assert "status_not_measured:حالة تجريبيةx1" in calls["end"]["notes"]
