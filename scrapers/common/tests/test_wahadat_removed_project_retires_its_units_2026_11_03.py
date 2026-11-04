"""A project wahadat REMOVED answers 200 with its own «المشروع غير موجود» page; its units go too (2026-11-03).

Measured live: قسورة-02 and دام-101 (units at 12 strikes, served since 10-21) answer that page — the same one
a made-up slug gets — while a listed project answers its own name. The off-market oracle only knew
sold/reserved, so these units said «unknown» every night. Nothing changes for a page that is unread,
that parses as a project, or in a run that read no real project.
"""
import importlib
import sys

W = importlib.import_module("scrapers.wahadat.run")

GONE = "https://wahadat.sa/project/%D9%82%D8%B3%D9%88%D8%B1%D8%A9-02"
LIVE = "https://wahadat.sa/project/listed"
NOT_FOUND = "<html><head><title>المشروع غير موجود | وحدات</title></head><body>404 الصفحة غير موجودة</body></html>"
LIVE_HTML = "<html><head><title>ريزي 33 النرجس | وحدات</title></head></html>"


def test_not_found_page_is_recognised_and_a_listed_one_is_not():
    assert W.project_not_found(NOT_FOUND)
    assert not W.project_not_found(LIVE_HTML)
    assert not W.project_not_found("")


class _Resp:
    def __init__(self, status, text):
        self.status_code, self.text = status, text


class _Q:
    def __init__(self, rows):
        self.rows = rows

    def __getattr__(self, _n):
        return lambda *a, **k: self

    def execute(self):
        return type("R", (), {"data": self.rows})()


def _run(monkeypatch, pages, live_parses=True):
    struck = [{"ad_number": "WHD073ea6b98faf", "listing_url": GONE},
              {"ad_number": "WHDother", "listing_url": "https://wahadat.sa/project/unread"}]
    seen_oracles = {}

    class _Sess:
        def get(self, url, **_k):
            return _Resp(*pages[url])

    monkeypatch.setattr(W.cc, "Session", lambda: _Sess())
    monkeypatch.setattr(W, "sitemap_projects", lambda _s: [LIVE])
    monkeypatch.setattr(W, "struck_unlisted_projects", lambda _u: [GONE])
    unit = {"id": "11112222-3333", "status": "available"}

    def parse(html, u):
        if html == LIVE_HTML and live_parses:
            return {"is_active": True}, [unit]
        return None, []
    monkeypatch.setattr(W, "parse_project", parse)
    monkeypatch.setattr(W, "resolve_type", lambda _p: ("Apartment", ""))
    monkeypatch.setattr(W, "map_unit", lambda p, u, t: ({"ad_number": "WHD111122223333"}, "residential"))
    monkeypatch.setattr(W, "read_unlisted_projects", lambda *_a: {})

    class _Sb:
        def table(self, t):
            return _Q(struck if t == "wahadat_residential_listings" else [])
    for name, fn in {"sb": lambda: _Sb(), "begin_run": lambda *_a: 1, "end_run": lambda *a, **k: True,
                     "upsert_wahadat_residential_batch": lambda *_a: None,
                     "upsert_wahadat_commercial_batch": lambda *_a: None,
                     "retire_superseded_siblings": lambda **_k: 0}.items():
        monkeypatch.setattr(W.db, name, fn)

    def prune(tbl, seen, source=None, verify_gone=None):
        seen_oracles[tbl] = verify_gone
        return 0
    monkeypatch.setattr(W.db, "prune_unseen", prune)
    monkeypatch.setattr(sys, "argv", ["run"])
    W.main()
    return seen_oracles.get("wahadat_residential_listings")


def test_units_of_a_removed_project_are_gone(monkeypatch):
    o = _run(monkeypatch, {LIVE: (200, LIVE_HTML), GONE: (200, NOT_FOUND)})
    v, why = o("WHD073ea6b98faf")
    assert v == "gone" and "غير موجود" in why
    assert o("WHDother")[0] == "unknown"                 # its page was not read: absence never hides


def test_a_blocked_or_unparsed_page_decides_nothing(monkeypatch):
    o = _run(monkeypatch, {LIVE: (200, LIVE_HTML), GONE: (403, NOT_FOUND)})
    assert o("WHD073ea6b98faf")[0] == "unknown"
    o = _run(monkeypatch, {LIVE: (200, LIVE_HTML), GONE: (200, "<title>شيء آخر</title>")})
    assert o("WHD073ea6b98faf")[0] == "unknown"
