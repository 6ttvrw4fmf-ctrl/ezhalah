"""dwelleo, 2026-11-05. (1) A listing's card opens the page the site's own 308 names: the old
/ar/properties/<slug> redirects to /ar/properties/for-{rent|sale}/{type}/{city}/{district}/<slug>
while the ad lives and answers 404 once it is gone; the sitemap missed the 2 newest of 18 live ads.
(2) Follow the source (owner 2026-11-05): after the collapse guard refuses a complete walk, a row is
hidden only when its API record AND its stored page both say gone, with live controls around it."""
import pytest

from scrapers.dwelleo import run


@pytest.fixture(autouse=True)
def _offline_catalog(monkeypatch):
    monkeypatch.setattr(run, "to_catalog", lambda *a, **k: (2, 4))
    monkeypatch.setattr(run, "find_district_in_text", lambda *a, **k: "حي النرجس")

SLUG = "2-bedroom-apartment-for-rent-in-al-narjis-riyadh-12"
NEW = f"https://www.dwelleo.sa/ar/properties/for-rent/apartment/riyadh/al-narjis/{SLUG}"
REC = {
    "id": 22898, "slug": SLUG, "status": "publish", "availability": "available", "title": "شقة للإيجار سنوي",
    "listing_type": {"key": "for-rent", "label": "إيجار"}, "property_type": {"name": "شقة"},
    "city": {"name": "الرياض"}, "area": {"name": "حي النرجس"}, "price": 105000, "area_sqm": 120,
}


def test_canonical_is_the_sites_own_redirect():
    assert run.canonical_from_redirect(308, NEW.replace("https://www.dwelleo.sa", "")) == NEW
    assert run.canonical_from_redirect(308, NEW + "?x=1") == NEW
    assert run.canonical_from_redirect(404, None) is None            # gone: no card
    assert run.canonical_from_redirect(308, "/ar") is None           # a redirect home is not the ad
    assert run.canonical_from_redirect(200, NEW) is None


def test_listing_url_is_the_canonical_page():
    row, _cat, why = run.map_listing(REC, public_urls={SLUG: NEW})
    assert why == "" and row["listing_url"] == NEW
    assert run.map_listing({**REC, "slug": "gone"}, public_urls={SLUG: NEW})[2] == "no_public_page"


def test_only_a_plain_404_is_a_gone_page():
    assert run.page_gone(404)
    assert not any(run.page_gone(s) for s in (308, 200, 403, 429, 500, None))


class _Q:
    def __init__(self, log, table):
        self.log, self.table, self.op = log, table, None
    def __getattr__(self, name):
        def call(*a, **k):
            if name in ("update", "insert"):
                self.op = (name, a[0])
            if name == "in_":
                self.op = self.op + (tuple(a[1]),)
            return self
        return call


class _Client:
    def __init__(self, log):
        self.log = log
    def table(self, t):
        return _Q(self.log, t)


def _run(monkeypatch, active, api, page, controls_live=True):
    log = []
    class R:  # noqa: N801
        def __init__(self, data): self.data = data
    def execute(q, *, what=""):
        if what.endswith("follow_source_select"):
            return R(active)
        log.append((q.table, q.op))
        return R([])
    monkeypatch.setattr(run.db, "sb", lambda: _Client(log))
    monkeypatch.setattr(run.db, "_execute", execute)
    monkeypatch.setattr(run, "_PAUSE", 0)
    ctl = [{"ad_number": "DWL1"}, {"ad_number": "DWL2"}]
    def verify(self, ad):
        if ad in ("DWL1", "DWL2"):
            return ("live", "ctl") if controls_live else ("unknown", "wall")
        return api[ad]
    monkeypatch.setattr(run.LivenessProbe, "verify_gone", verify)
    monkeypatch.setattr(run, "_page_status", lambda s, url: page[url])
    out = run.follow_source_hide(None, "dwelleo_residential_listings", {"DWL1", "DWL2"}, ctl)
    hides = [ads for t, op in log if op and op[0] == "update" for ads in [op[2]]]
    return out, hides, log


ACTIVE = [{"id": i, "ad_number": f"DWL{i}", "listing_url": f"u{i}"} for i in (1, 2, 10, 11, 12, 13)]
API = {"DWL10": ("gone", "422"), "DWL11": ("gone", "422"), "DWL12": ("live", "200"), "DWL13": ("unknown", "503")}
PAGE = {"u10": 404, "u11": 308, "u12": 200, "u13": 404}


def test_follow_source_hides_only_rows_gone_both_ways(monkeypatch):
    (hidden, kept, why), hides, log = _run(monkeypatch, ACTIVE, API, PAGE)
    assert (hidden, kept, why) == (1, 3, "done")
    assert hides == [("DWL10",)]          # 11 redirects (live page), 12 live, 13 unknown: kept
    ev = [op[1] for t, op in log if t == "ops_stale_inactivation_probe"][0]
    assert {e["ad_number"]: e["verdict"] for e in ev} == {"DWL10": "GONE", "DWL11": "UNKNOWN",
                                                          "DWL12": "UNKNOWN", "DWL13": "UNKNOWN"}
    assert all(run.OWNER_FOLLOW_SOURCE in e["note"] for e in ev)


def test_follow_source_hides_nothing_when_controls_are_not_live(monkeypatch):
    (hidden, kept, why), hides, _log = _run(monkeypatch, ACTIVE, API, PAGE, controls_live=False)
    assert hidden == 0 and hides == [] and "stopped" in why
