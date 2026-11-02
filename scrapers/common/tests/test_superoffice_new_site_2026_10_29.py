"""SuperOffice after the 2026-10-28 rebuild (Next.js): offices are read from the branch pages' server-
rendered list + each office's own /branch/<b>/unit/<code> page; the 28 old-site rows retire only when
their old URL redirects to a category page AND an office this crawl saw reads live.

Fixtures in scrapers/superoffice/fixtures/ are real pages captured 2026-10-29, trimmed (svg/img removed,
the list page cut to the one RSC line that carries the office list)."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

import scrapers.superoffice.run as R

FIX = Path(R.__file__).resolve().parent / "fixtures"
_DISTRICTS = {"الدريهمية": "حي الدريهمية", "العارض": "حي العارض", "السويدي": "حي السويدي",
              "الروضة": "حي الروضة", "طريق الملك عبدالعزيز الأول": "حي الملك عبدالعزيز"}


def _fx(name: str) -> str:
    return (FIX / name).read_text(encoding="utf-8")


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (3, 1) if c else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: _DISTRICTS.get(t))


def _unit(list_fx: str, code: str) -> dict:
    return next(u for u in R.parse_listing_page(_fx(list_fx))["units"] if u["code"] == code)


def _map(list_fx: str, code: str, unit_fx: str, **unit_over):
    u = {**_unit(list_fx, code), **unit_over}
    return R.map_unit(u, R.parse_unit_page(_fx(unit_fx)))


# ── enumeration ──────────────────────────────────────────────────────────────────────────────────
def test_sitemap_yields_each_branch_private_office_page_once():
    xml = """<urlset><url><loc>https://superoffice.sa/services/booth</loc></url>
    <url><loc>https://superoffice.sa/branch/al-aarid/private-office</loc></url>
    <url><loc>https://superoffice.sa/en/branch/al-aarid/private-office</loc></url>
    <url><loc>https://superoffice.sa/branch/as-suwaidi/coworking-space</loc></url>
    <url><loc>https://superoffice.sa/branch/as-suwaidi/private-office</loc></url>
    <url><loc>https://superoffice.sa/branch/al-aarid/private-office</loc></url></urlset>"""
    assert R.branches_from_sitemap(xml) == ["al-aarid", "as-suwaidi"]


def test_the_branch_page_payload_carries_the_server_rendered_office_window():
    lst = R.parse_listing_page(_fx("list_as-suwaidi.html"))
    assert (lst["totalCount"], lst["hasMore"]) == (51, True)
    assert [u["code"] for u in lst["units"]] == ["H19", "T4", "BB90", "T13", "BB73", "BB74", "CC6", "CC43"]
    assert {u["status"] for u in lst["units"]} == {"AVAILABLE"}
    assert {u["branchSlug"] for u in lst["units"]} == {"as-suwaidi"}


def test_a_page_without_the_list_is_unreadable_not_empty():
    with pytest.raises(ValueError):
        R.parse_listing_page("<html><script>self.__next_f.push([1,\"0:{}\"])</script></html>")


def test_collect_units_never_calls_the_robots_disallowed_api(monkeypatch):
    seen = []

    def fake_get(s, url):
        seen.append(url)
        return _fx("list_al-aarid.html") if "al-aarid" in url else _fx("list_as-suwaidi.html")
    monkeypatch.setattr(R, "get", fake_get)
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    units, totals, bad = R.collect_units(object(), ["al-aarid", "as-suwaidi"])
    assert bad == 0 and totals == {"al-aarid": 18, "as-suwaidi": 51}
    assert "SPO-al-aarid-13A2" in units and "SPO-as-suwaidi-H19" in units and len(units) == 16
    assert not any("/api/" in u for u in seen), "robots.txt: Disallow: /api"


def test_ad_number_round_trips_and_old_slugs_are_not_new_ids():
    assert R.ad_number_for("as-suwaidi", "H19") == "SPO-as-suwaidi-H19"
    assert R.split_ad_number("SPO-as-suwaidi-H19") == ("as-suwaidi", "H19")
    assert R.split_ad_number("SPO-al-aarid-13A2") == ("al-aarid", "13A2")
    for old in ("SPOprivate-office-A13-suwaidi", "SPOz-03", "SPOمكتب-خاص-2E-العارض", "SPOMeeting-Room-13C"):
        assert R.split_ad_number(old) is None, old


# ── mapping (checked against what the site shows) ────────────────────────────────────────────────
def test_h19_maps_with_the_card_price_monthly_and_the_address_district():
    # card: «مكتب H-19 · 1,118 ريال شهريًا»; page: «السويدي، الدريهمية، الرياض 12791», InStock
    (row, cat), why = _map("list_as-suwaidi.html", "H19", "unit_H19.html")
    assert why == "" and cat == "commercial" and row["property_type"] == "Office"
    assert row["ad_number"] == "SPO-as-suwaidi-H19"
    assert row["listing_url"] == "https://superoffice.sa/branch/as-suwaidi/unit/H19"
    assert row["title"] == "مكتب H-19"
    assert (row["transaction_type"], row["rent_period"], row["price_annual"]) == ("Rent", "monthly", 1118 * 12)
    # the branch label «السويدي» opens the line; the district is الدريهمية (as the old site stored it)
    assert row["district_ar"] == "حي الدريهمية"
    assert row["furnished"] is True and row["area_m2"] is None
    assert row["additional_info"]["source_area_sqm_raw"] == 1.72
    assert row["additional_info"]["branch"] == "السويدي"
    assert row[R.db._DIRECT_ALIVE_KEY] == R.DIRECT_ALIVE_ORACLE


def test_13a2_takes_its_own_photo_and_the_branch_district_when_it_is_the_only_one():
    # card «1,099.15» → 1,099 (halalas truncated); page «مبنى 6143، طريق الملك عبدالعزيز الأول، العارض، الرياض»
    (row, _), why = _map("list_al-aarid.html", "13A2", "unit_13A2.html")
    assert why == "" and row["price_annual"] == 1099 * 12 and row["rent_period"] == "monthly"
    assert row["district_ar"] == "حي العارض", "the road is never read; العارض is the only district part"
    assert row["photo_urls"] == ["https://superoffice.sa/media/media/13a2-2-1793206545390-486a4b49.webp"]


def test_a_booked_office_page_is_never_a_listing():
    # A13's own page says OutOfStock even if a stale list still showed it
    u = {**_unit("list_as-suwaidi.html", "H19"), "code": "A13"}
    assert R.map_unit(u, R.parse_unit_page(_fx("unit_A13.html")))[1] == "page_OutOfStock"


def test_a_non_available_list_status_and_another_offices_page_are_never_listings():
    assert _map("list_as-suwaidi.html", "H19", "unit_H19.html", status="RESERVED")[1] == "status_RESERVED"
    assert _map("list_as-suwaidi.html", "T4", "unit_H19.html")[1] == "page_is_not_this_office"


def test_only_a_single_period_price_is_the_rent():
    u = _unit("list_as-suwaidi.html", "H19")
    bundles = [t for t in u["termPrices"] if t["durationCount"] != 1]
    assert _map("list_as-suwaidi.html", "H19", "unit_H19.html", termPrices=bundles)[1] == "no_single_period_price"
    yearly = [{"price": 30000, "durationCount": 1, "unitType": "YEAR", "labelAr": "سنوي"}]
    (row, _), _ = _map("list_as-suwaidi.html", "H19", "unit_H19.html", termPrices=yearly)
    assert (row["rent_period"], row["price_annual"]) == ("annual", 30000)


def test_the_company_switchboard_is_never_stored():
    (row, _), _ = _map("list_as-suwaidi.html", "H19", "unit_H19.html")
    blob = json.dumps({k: v for k, v in row.items() if not k.startswith("_")}, ensure_ascii=False)
    assert "920032320" not in blob and "info@superoffice.sa" not in blob


# ── the dead-ad oracle ───────────────────────────────────────────────────────────────────────────
class _Resp:
    def __init__(self, status, text="", location=None):
        self.status_code, self.text = status, text
        self.headers = {"location": location} if location else {}


class _S:
    def __init__(self, pages):
        self.pages, self.calls = pages, []

    def get(self, url, timeout=None, allow_redirects=True, **kw):
        assert allow_redirects is False, "the oracle must see the redirect itself"
        self.calls.append(url)
        v = self.pages.get(url)
        if v is None or isinstance(v, Exception):
            raise v or ConnectionError(url)
        return v


H19 = R.unit_url("as-suwaidi", "H19")
OLD = f"{R.BASE}/ar/office-details/private-office-A13-suwaidi"
SEEN = {"SPO-as-suwaidi-H19"}


def _live_h19():
    return _Resp(200, _fx("unit_H19.html"))


@pytest.mark.parametrize("loc", ["/branch/as-suwaidi/private-office", "https://superoffice.sa/services/meeting-room-booking"])
def test_old_url_redirecting_to_a_category_reads_gone_with_a_live_control(loc):
    s = _S({OLD: _Resp(308, location=loc), H19: _live_h19()})
    v, why = R.make_verify_gone(s, SEEN)("SPOprivate-office-A13-suwaidi")
    assert v == "gone" and "category" in why and "control" in why


def test_old_url_404_reads_gone_and_other_old_answers_read_unknown():
    s = _S({f"{R.BASE}/ar/office-details/a": _Resp(404),
            f"{R.BASE}/ar/office-details/b": _Resp(308, location="/branch/as-suwaidi/unit/A13"),
            f"{R.BASE}/ar/office-details/c": _Resp(200, "<html></html>"),
            f"{R.BASE}/ar/office-details/d": _Resp(302, location="/branch/as-suwaidi/private-office"),
            f"{R.BASE}/ar/office-details/e": _Resp(308, location="https://elsewhere.example/branch/x/y"),
            f"{R.BASE}/ar/office-details/f": _Resp(403),
            f"{R.BASE}/ar/office-details/g": _Resp(503),
            f"{R.BASE}/ar/office-details/h": TimeoutError("slow"),
            H19: _live_h19()})
    vg = R.make_verify_gone(s, SEEN)
    assert vg("SPOa")[0] == "gone"
    for ad in ("SPOb", "SPOc", "SPOd", "SPOe", "SPOf", "SPOg", "SPOh"):
        assert vg(ad)[0] == "unknown", ad


def test_new_office_booked_or_404_reads_gone_free_reads_live():
    a13 = R.unit_url("as-suwaidi", "A13")
    s = _S({a13: _Resp(200, _fx("unit_A13.html")), R.unit_url("as-suwaidi", "X1"): _Resp(404), H19: _live_h19()})
    vg = R.make_verify_gone(s, SEEN)
    assert vg("SPO-as-suwaidi-A13") == ("gone", "offer availability OutOfStock (booked); control SPO-as-suwaidi-H19 reads live")
    assert vg("SPO-as-suwaidi-X1")[0] == "gone"
    assert vg("SPO-as-suwaidi-H19")[0] == "live"


def test_blocks_errors_and_a_page_for_another_office_read_unknown_never_gone():
    t4 = R.unit_url("as-suwaidi", "T4")
    pages = {R.unit_url("as-suwaidi", c): r for c, r in
             (("B1", _Resp(403)), ("B2", _Resp(429)), ("B3", _Resp(500)), ("B4", _Resp(200, "<html>shell</html>")),
              ("B5", ConnectionError("reset")))}
    s = _S({**pages, t4: _Resp(200, _fx("unit_H19.html")), H19: _live_h19()})
    vg = R.make_verify_gone(s, SEEN)
    for ad in ("SPO-as-suwaidi-B1", "SPO-as-suwaidi-B2", "SPO-as-suwaidi-B3", "SPO-as-suwaidi-B4",
               "SPO-as-suwaidi-B5", "SPO-as-suwaidi-T4"):
        assert vg(ad)[0] == "unknown", ad


def test_control_not_live_turns_gone_into_unknown():
    for control in (_Resp(200, _fx("unit_A13.html")), _Resp(403), _Resp(503), ConnectionError("down")):
        s = _S({OLD: _Resp(308, location="/branch/as-suwaidi/private-office"), H19: control})
        assert R.make_verify_gone(s, SEEN)("SPOprivate-office-A13-suwaidi")[0] == "unknown"
    s = _S({OLD: _Resp(308, location="/branch/as-suwaidi/private-office")})
    assert R.make_verify_gone(s, set())("SPOprivate-office-A13-suwaidi")[0] == "unknown", "no control at all"
    s = _S({OLD: _Resp(308, location="/branch/as-suwaidi/private-office")})
    assert R.make_verify_gone(s, {"SPOz-03"})("SPOprivate-office-A13-suwaidi")[0] == "unknown", \
        "an old-site ad is never a control"


def test_control_is_read_once_per_run():
    s = _S({f"{R.BASE}/ar/office-details/a": _Resp(404), f"{R.BASE}/ar/office-details/b": _Resp(404), H19: _live_h19()})
    vg = R.make_verify_gone(s, SEEN)
    assert vg("SPOa")[0] == vg("SPOb")[0] == "gone"
    assert s.calls.count(H19) == 1


# ── the prune path: the whole id set changed, the guard must not freeze the old rows ─────────────
def test_prune_hands_its_oracle_to_prune_unseen_and_on_a_refusal_to_strike_read_gone(monkeypatch):
    calls = {}

    def fake_prune(tbl, seen, **kw):
        calls["prune_vg"] = kw.get("verify_gone")
        return -1

    def fake_strike(tbl, seen, source, verify_gone=None, **kw):
        calls.update(seen=set(seen), source=source, vg=verify_gone, kw=kw)
        return 8
    monkeypatch.setattr(R.db, "prune_unseen", fake_prune)
    monkeypatch.setattr(R.db, "strike_read_gone", fake_strike)
    vg = object()
    assert R.prune_table("superoffice_commercial_listings", SEEN, vg) == 8
    assert calls["prune_vg"] is vg and calls["vg"] is vg and calls["source"] == R.SOURCE
    assert "grace" not in calls["kw"] and "max_prune_frac" not in calls["kw"], "floors and grace untouched"


def test_old_rows_converge_under_the_collapse_cap(monkeypatch):
    """28 old rows unseen, 24 new seen: db.strike_read_gone strikes the old rows whose own page reads gone,
    capped at 30% per run, then prune_unseen (min_coverage 0, seen = all but the struck) — never refused."""
    from scrapers.common import db
    old = [f"SPOold{i}" for i in range(28)]
    new = [f"SPO-as-suwaidi-N{i}" for i in range(24)]
    active = {a: 0 for a in old + new}
    struck_runs = []

    class _Q:
        def __init__(self): self.f = {}
        def select(self, *a): return self
        def eq(self, *a): return self
    monkeypatch.setattr(db, "sb", lambda: type("C", (), {"table": lambda self, t: _Q()})())
    monkeypatch.setattr(db, "_execute", lambda q, what="": type("R", (), {"data": [
        {"ad_number": a, "last_seen_at": "2026-10-27"} for a in active]})())

    def fake_prune(tbl, seen, **kw):
        assert kw["min_coverage"] == 0.0
        gone = [a for a in active if a not in seen]
        assert len(gone) <= kw["max_prune_frac"] * len(active), "the collapse guard cannot refuse this"
        struck_runs.append(len(gone))
        return 0
    monkeypatch.setattr(db, "prune_unseen", fake_prune)
    db._READ_GONE_DONE.discard("t")
    db._READ_GONE_STRUCK.pop("t", None)
    n = db.strike_read_gone("t", set(new), R.SOURCE,
                            verify_gone=lambda ad: ("gone", "x") if ad.startswith("SPOold") else ("live", "y"))
    assert n == 0 and struck_runs == [int(0.30 * 52)]
