"""2026-10-13: manzo's walk read 29 listed records and mapped 0 (status «available» x28), so the seen
set handed to db.strike_read_gone was empty, it returned «nothing seen», and MNZ1403 — its own page
404 — stayed on screen with no control to strike it. A record the source's own list served and whose
own record we read is SEEN (kept from the unseen read, usable as a control), mapped or not."""
import importlib

R = importlib.import_module("scrapers.manzo.run")


class _DB:
    def __init__(self):
        self.struck_with = []

    def begin_run(self, _slug):
        return 1

    def end_run(self, _rid, **kw):
        return True

    def strike_read_gone(self, tbl, seen, source, *a, **k):
        self.struck_with.append((tbl, set(seen)))
        return 0

    def __getattr__(self, name):
        return lambda *a, **k: 0


def test_listed_but_unmapped_records_are_seen(monkeypatch):
    db = _DB()
    monkeypatch.setattr(R, "db", db)
    monkeypatch.setattr(R, "retry_smarter_session", lambda *a, **k: (None, ["stub"]))
    monkeypatch.setattr(R, "walk", lambda _s: ([{"slug": "VPWG5qo8"}, {"slug": "abc"}], 2))
    recs = {"VPWG5qo8": {"display_status": "available", "property_id": 1774, "slug": "VPWG5qo8"},
            "abc": {"display_status": "available", "property_id": 1800, "slug": "abc"}}
    monkeypatch.setattr(R, "get_json", lambda _s, url: recs[url.rstrip("/").split("/")[-1]])
    monkeypatch.setattr("sys.argv", ["run"])
    assert R.main() == 0
    assert db.struck_with, "strike_read_gone was never offered the listed ads"
    for _tbl, seen in db.struck_with:
        assert seen == {"MNZ1774", "MNZ1800"}


def test_listed_ad_number_matches_the_mapper():
    d = {"display_status": "active", "property_id": 1403, "slug": "rNWNNZWL"}
    assert R.listed_ad_number(d, {"slug": "x"}) == "MNZ1403"
    assert R.listed_ad_number({"slug": "s1"}, {"slug": "x"}) == "MNZs1"
