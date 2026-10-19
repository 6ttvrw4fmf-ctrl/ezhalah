"""Audit 2026-10-02, group «leftovers»: eastabha, fursaghyr, nowaisiry, alhoshan.

THE HOLE (one shape, four sites): the crawler could not read what the source says about an ad's
availability, and wrote the ad ACTIVE anyway.

MEASURED LIVE 2026-10-02 (before a line was changed):
  eastabha   249 posts, property_status 33 terms, 42 posts carry تأجرت / تم البيع, 0 term ids the
             maps cannot name. With the property_status map emptied: 42 → active. With the
             property_action_category map emptied: 7 auctions (own status «مزاد منتهي») → active.
  fursaghyr  10 feed posts, each one's own WordPress record reads `publish`. FG24965 (licence ended
             that day) had left the feed and reads `expired`. An 'unknown' read was upserted active.
  nowaisiry  17 posts, 17 status=publish, X-WP-Total 17, 0 sold / reserved words in any title or
             text. A post with NO status was read as publish.
  alhoshan   34 of 34 items isPublished=True, moderationStatus='approved', listingExpiresAt=None.
             The crawler read none of them; an unreadable page 2 was a silent `break`.

Every fixture is SYNTHETIC (no ad text, names or numbers from a real listing). Each test marked
«fails on origin/main» was run against origin/main's run.py and failed there.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.alhoshan import run as AH  # noqa: E402
from scrapers.eastabha import run as EA  # noqa: E402
from scrapers.fursaghyr import run as FG  # noqa: E402
from scrapers.nowaisiry import run as NW  # noqa: E402


class _Resp:
    def __init__(self, status: int, payload):
        self.status_code, self._payload = status, payload
        self.headers, self.text = {"x-wp-totalpages": "1"}, ""

    def json(self):
        if self._payload is None:
            raise ValueError("not JSON")
        return self._payload


def _db(monkeypatch, R, site: str) -> dict:
    """Stub every database call of one crawler; returns what main() tried to write."""
    calls: dict = {"upserts": {}, "prunes": 0}
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R.db, "begin_run", lambda platform: 7)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **kw: calls.update(end=kw) or True)
    for cat in ("residential", "commercial"):
        monkeypatch.setattr(R.db, f"upsert_{site}_{cat}_batch", lambda rows: calls["upserts"].update(
            {r["ad_number"]: r["active"] for r in rows}))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(R.db, "prune_unseen",
                        lambda tbl, seen, **kw: calls.update(prunes=calls["prunes"] + 1) or 0)
    return calls


def _assert_wrote_nothing(calls: dict, rc: int, word: str) -> None:
    assert calls["upserts"] == {} and calls["prunes"] == 0
    assert rc == 1 and calls["end"]["ok"] is False and word in calls["end"]["notes"]


# ───────────────────────────────────────── eastabha ─────────────────────────────────────────
def _terms(names: dict) -> list:
    return [{"id": i, "name": n} for i, n in names.items()]


EA_TAX = {
    "property_status": (200, _terms({10: "عرض جديد", 11: "تم البيع"})),
    "property_action_category": (200, _terms({20: "بيع", 21: "مزاد"})),
    "property_category": (200, _terms({30: "شقق"})),
}


def _ea_post(pid: int, statuses: list, action: int = 20) -> dict:
    return {"id": pid, "link": f"https://eastabha.sa/properties/synthetic-{pid}/",
            "title": {"rendered": "شقة تجريبية"}, "content": {"rendered": "<p>نص تجريبي</p>"},
            "property_category": [30], "property_action_category": [action], "property_status": statuses}


EA_POSTS = [_ea_post(1, [10]), _ea_post(2, [10, 11]), _ea_post(3, [10], action=21)]


def _ea_main(monkeypatch, routes: dict) -> dict:
    def get(url, **kw):
        if "/wp-json/" not in url or "/media/" in url:
            return None                               # detail page / featured image: not under test
        key = url.split("?")[0].rstrip("/").rsplit("/", 1)[-1]
        return _Resp(*routes.get(key, (200, [])))

    calls = _db(monkeypatch, EA, "eastabha")
    monkeypatch.setattr(EA.http, "get", get)
    monkeypatch.setattr(EA, "_pin_sold_inactive", lambda *a, **kw: None)
    monkeypatch.setattr(EA, "_retire_not_saudi", lambda table, ads: [])
    calls["rc"] = EA.main()
    return calls


@pytest.mark.parametrize("tax", ["property_status", "property_action_category"])
@pytest.mark.parametrize("broken", [(500, []), (200, [])], ids=["http-500", "empty-list"])
def test_eastabha_unreadable_availability_taxonomy_writes_nothing(monkeypatch, tax, broken):
    """fails on origin/main: the sold post (status) / the auction (action) was upserted active."""
    calls = _ea_main(monkeypatch, {**EA_TAX, tax: broken, "estate_property": (200, EA_POSTS)})
    _assert_wrote_nothing(calls, calls["rc"], tax)


@pytest.mark.parametrize("tax,post", [("property_status", _ea_post(4, [10, 99])),
                                      ("property_action_category", _ea_post(5, [10], action=99))])
def test_eastabha_term_id_the_map_cannot_name_stops_the_run(tax, post):
    """fails on origin/main: the unnamed id was dropped and the row came back active."""
    taxd = {k: {t["id"]: t["name"] for t in v[1]} for k, v in EA_TAX.items()}
    with pytest.raises(RuntimeError, match=tax):
        EA.map_listing(post, taxd, {}, None)


def test_eastabha_readable_taxonomies_keep_todays_verdicts(monkeypatch):
    calls = _ea_main(monkeypatch, {**EA_TAX, "estate_property": (200, EA_POSTS)})
    assert calls["rc"] == 0
    assert calls["upserts"] == {"EA1": True, "EA2": False}      # available · sold · auction skipped


# ───────────────────────────────────────── fursaghyr ─────────────────────────────────────────
FG_RECORDS = {101: (200, {"id": 101, "status": "publish"}),
              102: (200, {"id": 102, "status": "expired"}),
              103: (500, {}),                                    # the status read failed
              104: (200, {"id": 104, "status": "synthetic-status"})}   # a status nobody measured


class _FgSite:
    def get(self, url, params=None, timeout=None):
        if url == FG.LIST:
            return _Resp(200, {"items": [{"id": i} for i in FG_RECORDS]})
        return _Resp(*FG_RECORDS[int(url.rsplit("/", 1)[-1])])


def test_fursaghyr_only_a_post_that_reads_publish_is_written(monkeypatch):
    """fails on origin/main: FG103 and FG104 were upserted active on the feed sighting alone."""
    calls = _db(monkeypatch, FG, "fursaghyr")
    monkeypatch.setattr(FG, "session", lambda: _FgSite())
    monkeypatch.setattr(FG, "_throttle", lambda: None)
    monkeypatch.setattr(FG, "map_listing",
                        lambda it, s=None: ({"ad_number": f"FG{it['id']}", "active": True}, "residential"))
    assert FG.main() == 0
    assert calls["upserts"] == {"FG101": True}
    assert calls["end"]["notes"] == "pruned=0 expired_in_feed=1 status_unread_skipped=2"


# ───────────────────────────────────────── nowaisiry ─────────────────────────────────────────
def _nw_post(pid: int, **over) -> dict:
    return {"id": pid, "status": "publish", "link": f"https://alnowaisiry.com/lands/synthetic-{pid}/",
            "title": {"rendered": "للبيع ارض تجريبية"},
            "content": {"rendered": "<p>المساحة : 400 متر</p>"}, **over}


@pytest.mark.parametrize("status", [None, ""], ids=["absent", "empty"])
def test_nowaisiry_post_without_a_status_writes_nothing(monkeypatch, status):
    """fails on origin/main: a missing status defaulted to publish and the row was upserted active."""
    calls = _db(monkeypatch, NW, "nowaisiry")
    monkeypatch.setattr(NW, "session", lambda: object())
    monkeypatch.setattr(NW, "fetch_lands", lambda s: [_nw_post(1), _nw_post(2, status=status)])
    _assert_wrote_nothing(calls, NW.main(), "status")


def test_nowaisiry_readable_status_keeps_todays_verdicts():
    assert NW.map_listing(_nw_post(1))[0]["active"] is True
    assert NW.map_listing(_nw_post(2, status="draft"))[0] is None


# ───────────────────────────────────────── alhoshan ─────────────────────────────────────────
def _ah_item(pub: int, **over) -> dict:
    return {"publicId": pub, "id": f"synthetic-guid-{pub}", "purpose": "sale", "price": 500000,
            "title": "فيلا تجريبية", "isPublished": True, "moderationStatus": "approved",
            "listingExpiresAt": None,
            "specs": {"propertyType": "villa", "city": "الرياض", "district": "حي تجريبي", "area": 300},
            **over}


def _ah_main(monkeypatch, pages: dict) -> dict:
    calls = _db(monkeypatch, AH, "alhoshan")
    monkeypatch.setattr(AH, "session", lambda: object())
    monkeypatch.setattr(AH, "fetch_page", lambda s, page: pages.get(page, ([], {})))
    monkeypatch.setattr(AH, "fetch_media", lambda s, guid: None)
    monkeypatch.setattr(AH, "to_catalog", lambda city, region_hint=None: (1, 1))
    calls["rc"] = AH.main()
    return calls


def _one_page(*items) -> dict:
    return {1: (list(items), {"total": len(items), "totalPages": 1, "hasNext": False})}


def test_alhoshan_record_that_says_unpublished_is_not_written(monkeypatch):
    """fails on origin/main: isPublished was never read, AH9002 was upserted active."""
    calls = _ah_main(monkeypatch, _one_page(_ah_item(9001), _ah_item(9002, isPublished=False)))
    assert calls["rc"] == 0 and calls["upserts"] == {"AH9001": True}
    assert calls["end"]["notes"] == "pruned=0 unpublished_skipped=1 status_unmeasured=0"


@pytest.mark.parametrize("flag", [None, "true"], ids=["null", "not-a-boolean"])
def test_alhoshan_unreadable_publish_flag_writes_nothing(monkeypatch, flag):
    """fails on origin/main: the item was upserted active whatever the flag held."""
    calls = _ah_main(monkeypatch, _one_page(_ah_item(9001), _ah_item(9002, isPublished=flag)))
    _assert_wrote_nothing(calls, calls["rc"], "isPublished")


@pytest.mark.parametrize("over", [{"moderationStatus": "synthetic-status"},
                                  {"listingExpiresAt": "synthetic-date"}], ids=["moderation", "expiry"])
def test_alhoshan_value_nobody_measured_stays_written_and_is_counted(monkeypatch, over):
    """fails on origin/main: the unmeasured value left no trace in the run notes."""
    calls = _ah_main(monkeypatch, _one_page(_ah_item(9001), _ah_item(9002, **over)))
    assert calls["upserts"] == {"AH9001": True, "AH9002": True}
    assert calls["end"]["notes"] == "pruned=0 unpublished_skipped=0 status_unmeasured=1"


def test_alhoshan_unreadable_second_page_is_not_a_complete_catalogue(monkeypatch):
    """fails on origin/main: page 1 was upserted and the prune ran on half a catalogue."""
    pages = {1: ([_ah_item(9001)], {"total": 2, "totalPages": 2, "hasNext": True})}   # page 2: no answer
    calls = _ah_main(monkeypatch, pages)
    _assert_wrote_nothing(calls, calls["rc"], "page 2")
