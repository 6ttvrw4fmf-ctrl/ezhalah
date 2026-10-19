"""2026-10-13: 14 wahadat units sat at 5-8 strikes on screen because their project left the sitemap, so
no crawl read their own record again and the off-market oracle said «not read this run» every night.
A struck unit's project page that the walk did not read is now read once; its own record decides."""
import importlib

W = importlib.import_module("scrapers.wahadat.run")

URL_GONE = "https://wahadat.sa/project/dam-101"
URL_READ = "https://wahadat.sa/project/listed"


class _Resp:
    status_code = 200
    text = "x"


class _Sess:
    def __init__(self):
        self.got = []

    def get(self, url, **_k):
        self.got.append(url)
        return _Resp()


def test_struck_units_of_an_unlisted_project_are_read_on_their_own_record(monkeypatch):
    units = [{"id": "aaaa-bbbb-cccc", "status": "sold"}, {"id": "dddd-eeee-ffff", "status": "available"},
             {"id": "1111-2222-3333", "status": "reserved"}]
    monkeypatch.setattr(W, "parse_project", lambda _h, u: ({"is_active": True, "url": u}, units))
    s = _Sess()
    struck = [{"ad_number": "WHDaaaabbbbcccc", "listing_url": URL_GONE},
              {"ad_number": "WHDddddeeeeffff", "listing_url": URL_GONE},
              {"ad_number": "WHDzzz", "listing_url": URL_READ}]
    got = W.read_unlisted_projects(s, {URL_READ}, struck)
    assert s.got == [URL_GONE]                                   # a page the walk read is not re-read
    assert got == {"WHDaaaabbbbcccc": "sold", "WHD111122223333": "reserved"}
    assert W.off_market_oracle(got)("WHDddddeeeeffff")[0] == "unknown"   # available is never gone


def test_an_inactive_or_unreadable_project_decides_nothing(monkeypatch):
    monkeypatch.setattr(W, "parse_project", lambda _h, u: ({"is_active": False}, [{"id": "a", "status": "sold"}]))
    assert W.read_unlisted_projects(_Sess(), set(), [{"ad_number": "WHDa", "listing_url": URL_GONE}]) == {}
    monkeypatch.setattr(W, "parse_project", lambda _h, u: (None, [{"id": "a", "status": "sold"}]))
    assert W.read_unlisted_projects(_Sess(), set(), [{"ad_number": "WHDa", "listing_url": URL_GONE}]) == {}


class _Q:
    def __init__(self, rows):
        self.rows = rows

    def __getattr__(self, _n):
        return lambda *a, **k: self

    def execute(self):
        return type("R", (), {"data": self.rows})()


def test_struck_units_unlisted_projects_join_the_walk(monkeypatch):
    """2026-10-16: 57 live units (own record «available») sat at 4-11 strikes because their
    project left the sitemap and only a sold/reserved answer was looked for. Their project pages
    now join the main walk, so an available unit is re-seen exactly like a sitemap unit."""
    rows = {"wahadat_residential_listings": [{"listing_url": URL_GONE}, {"listing_url": URL_READ},
                                             {"listing_url": None}],
            "wahadat_commercial_listings": [{"listing_url": "https://wahadat.sa/project/shop-1"}]}

    class _Sb:
        def table(self, t):
            return _Q(rows[t])

    monkeypatch.setattr(W.db, "sb", lambda: _Sb())
    got = W.struck_unlisted_projects([URL_READ])
    assert got == [URL_GONE, "https://wahadat.sa/project/shop-1"]      # listed pages are not added twice


def test_an_unreadable_struck_list_adds_nothing(monkeypatch):
    def boom():
        raise RuntimeError("db down")
    monkeypatch.setattr(W.db, "sb", boom)
    assert W.struck_unlisted_projects([URL_READ]) == []
