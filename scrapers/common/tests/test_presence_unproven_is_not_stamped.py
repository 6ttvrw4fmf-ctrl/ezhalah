"""A row its list served but whose OWN page was not read this run is written, never stamped (2026-10-03).

SOURCE_LIST_PRESENCE stamps every row a crawl upserts active. abralosol, arkaan, aqaratikom and satel
write a row from the list even when the ad's own page or record failed this run; arkaan and squares
keep a status nobody measured; maqrat and nafithh keep an ad whose licence ended (PR #5103 owns that
gate). Each marks such a row with db.mark_presence_unproven(): written as before, not certified.
"""
import sys
import types

sys.path.insert(0, ".")
for _n in ("supabase", "dotenv"):
    sys.modules.setdefault(_n, types.ModuleType(_n))
sys.modules["supabase"].Client = object
sys.modules["supabase"].create_client = lambda *a, **k: None
sys.modules["dotenv"].load_dotenv = lambda *a, **k: None

from scrapers.common import db  # noqa: E402

KEY = db._PRESENCE_UNPROVEN_KEY


def test_a_marked_row_is_written_without_the_stamp_and_the_key_never_reaches_the_database(monkeypatch):
    sent = []
    monkeypatch.setattr(db, "sb", lambda: types.SimpleNamespace(table=lambda _n: types.SimpleNamespace(
        upsert=lambda grp, **k: sent.extend(grp) or "q")))
    monkeypatch.setattr(db, "_execute", lambda q, **k: None)
    for fn in ("_sanitize_price", "_unknown_must_not_overwrite_known", "_redact_user_visible_text",
               "_sanitize_ints", "_ensure_capture", "_reject_placeholder_location",
               "_reject_unusable_listing_url"):
        monkeypatch.setattr(db, fn, lambda *a, **k: None)
    db.upsert_abralosol_residential_batch([{"ad_number": "A1"}, db.mark_presence_unproven({"ad_number": "A2"})])
    by = {r["ad_number"]: r for r in sent}
    assert by["A1"]["last_verified_alive_at"] == by["A1"]["last_seen_at"]
    assert "last_verified_alive_at" not in by["A2"] and by["A2"]["active"] is True
    assert all(KEY not in r for r in sent)


def test_abralosol_marks_a_row_whose_own_page_was_not_read(monkeypatch):
    from scrapers.abralosol import run as AB
    monkeypatch.setattr(AB, "_session", lambda: None)
    monkeypatch.setattr(AB.time, "sleep", lambda s: None)
    monkeypatch.setattr(AB, "_get", lambda s, url, tries=3: "p" if url.endswith("=0") else None)
    monkeypatch.setattr(AB, "_index_rows", lambda html: [{"nid": "1"}, {"nid": "3"}] if html else [])
    monkeypatch.setattr(AB, "_parse_index", lambda rec: {"nid": rec["nid"], "title_lines": [], "price": {"amount": None}})
    monkeypatch.setattr(AB, "_detail", lambda s, nid: {"1": {"title": "x"}, "3": {}}[nid])
    monkeypatch.setattr(AB, "map_listing", lambda ix, d: (
        {"ad_number": "AB" + ix["nid"], "price_total": 1, "price_annual": None,
         "price_per_meter": None, "additional_info": {"price_basis": "x"}}, "residential"))
    res = AB.crawl()[0]
    assert {r["ad_number"]: r.get(KEY, False) for r in res} == {"AB1": False, "AB3": True}


def test_arkaan_marks_an_unread_page_and_an_unmeasured_status(monkeypatch):
    from scrapers.arkaan import run as AR
    items = [{"id": "0", "status": "active"}, {"id": "1", "status": "active"}, {"id": "2", "status": "sold"}]
    monkeypatch.setattr(AR, "_session", lambda: None)
    monkeypatch.setattr(AR, "crawl_index", lambda s, limit=0: items)
    monkeypatch.setattr(AR, "fetch_detail", lambda s, pid: {"http_status": [200, 503, 200][int(pid)]})
    monkeypatch.setattr(AR, "map_listing", lambda item, d: ({"ad_number": "AK" + item["id"]}, "residential"))
    res = AR.crawl()[0]
    assert {r["ad_number"]: r.get(KEY, False) for r in res} == {"AK0": False, "AK1": True, "AK2": True}


def test_aqaratikom_marks_a_row_whose_own_record_was_missing(monkeypatch):
    from scrapers.aqaratikom import run as AQ
    monkeypatch.setattr(AQ, "map_listing", lambda ad, d: ({"ad_number": "AQ"}, "residential", False))
    assert KEY in AQ.row_for({"id": 1}, "missing", None)[0]
    assert KEY not in AQ.row_for({"id": 1}, "ok", {"x": 1})[0]


def test_satel_marks_a_row_whose_own_record_did_not_answer():
    from scrapers.satel import run as ST
    ok, missed = {"photo_urls": ["f"]}, {"photo_urls": ["f"]}
    ST._attach_detail(ok, {"propertyNumber": "C1"})
    ST._attach_detail(missed, None)
    assert KEY not in ok and missed.get(KEY) is True and missed["photo_urls"] == ["f"]


def _kv(site, end):
    if site == "maqrat":
        return {"نوع العقار": "شقة", "سعر الوحدة": "500000", "مساحة العقار": "120", "تاريخ انتهاء رخصة الإعلان": end}
    return {"غرض الإعلان": "بيع", "نوع العقار": "شقة", "سعر الوحدة": "500000", "مساحة العقار": "120",
            "تاريخ انتهاء رخصة الإعلان": end}


def test_maqrat_and_nafithh_mark_an_ad_whose_own_licence_ended():
    from scrapers.maqrat import run as MQ
    from scrapers.nafithh import run as NF
    for end, marked in (("2020-01-01", True), ("2099-01-01", False), (None, False)):
        d = {"title": "شقة للبيع", "description": "", "photos": [], "services": [], "lat": None, "lng": None}
        mq = MQ.map_listing("7", {"deal": "للبيع"}, dict(d, kv=_kv("maqrat", end)))[0][0]
        nf = NF.map_listing("7", dict(d, kv=_kv("nafithh", end)))[0][0]
        assert (KEY in mq) is marked and (KEY in nf) is marked, end
        assert mq["active"] is not False and nf["active"] is not False     # still written, as before


# These keep a status value nobody measured and count it out loud inside main(). The same branch
# must also withhold the stamp. Structural: the mark sits inside the counting branch.
# (squares, muajarh and opensooq are driven end to end in test_audit_status-fields-a_2026_10_02.py.)
_COUNTED_BRANCHES = {
    "fahadalshahri": "            if p.get(\"is_in_stock\") is not True:",
    "shmoualshmal": "            if unmeasured_terms(p, tax):",
}


def test_a_counted_unmeasured_status_is_also_left_unstamped():
    for site, anchor in _COUNTED_BRANCHES.items():
        src = open(f"scrapers/{site}/run.py", encoding="utf-8").read()
        assert src.count(anchor) == 1, site
        indent = len(anchor) - len(anchor.lstrip())
        body = []
        for line in src[src.index(anchor):].split("\n")[1:]:
            if line.strip() and len(line) - len(line.lstrip()) <= indent:
                break
            body.append(line)
        assert any("db.mark_presence_unproven(" in line for line in body), site
