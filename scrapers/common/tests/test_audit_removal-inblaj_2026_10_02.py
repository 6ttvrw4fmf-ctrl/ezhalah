"""Crawler audit 2026-10-02, group removal-inblaj: gudai, safera, alhumaidan (the shared
scrapers/common/inblaj_platform.py), aqarnajran, fahadalshahri.

THE HOLE. None of the five ever called db.prune_unseen, so an ad its office deleted — or, on the
inblaj tenants, re-titled «تم البيع» — stayed active here for good.

WHAT WAS MEASURED (live, 2026-10-02). No site has a row our crawl stopped seeing, so there is no
dead cohort; each signal is the one the law allows without one — a hard 404 on the ad's OWN url
while that site's live ads answer 200 with their own listing:
    gudai          12/12 pages 200 + «تفاصيل العقار»; 4/4 never-existed / wrong-id urls 404
    safera          9/9  pages 200 + «نظرة عامة»;      4/4 → 404
    alhumaidan      3/3  pages 200 + «تفاصيل العقار», all titled «تم الإيجار»/«تم البيع»; 4/4 → 404
    aqarnajran     14/14 posts 200 + the «البند / التفاصيل» table; 3/3 → 404
    fahadalshahri  26/26 products 200 + <body class="… single-product …"> + the product's own
                   <div id="product-N" class="… instock …"> (outofstock: 0/26); 3/3 → 404
Furniture found and NOT used: «غير متوفر» (all 26 fahadalshahri pages), is_purchasable=false (a live
product with no price), «مؤجر» (a building sold with its tenants).
A page that says something nobody measured — an out-of-stock product block, a title carrying
«محجوز» / «مباع» / «تم التأجير» (0 of 24 inblaj pages) — reads UNKNOWN: never gone, and never
'live', because a live verdict stamps the row verified-alive.

THE RULE THESE TESTS PIN. A missing ad is only a candidate; it is hidden only when its own page
says so and a known-live ad of the same run still reads live; nothing is pruned on a walk that
could not be read whole. A status the source has never shown us is kept and counted, not guessed.

Every fixture is synthetic and minimal — no real ad, name, phone or licence.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

import scrapers.common.http_liveness as HL  # noqa: E402
import scrapers.common.inblaj_platform as IP  # noqa: E402
from scrapers.aqarnajran import run as ANJ  # noqa: E402
from scrapers.fahadalshahri import run as FAS  # noqa: E402

TENANTS = {"gudai": "تفاصيل العقار", "alhumaidan": "تفاصيل العقار", "safera": "نظرة عامة"}


def _inblaj_page(title: str = "شقة للإيجار", block: str = "تفاصيل العقار") -> str:
    return (f"<html><head><title>{title} – مكتب تجريبي</title></head><body>"
            f"<h2>{title}</h2><h3>{block}</h3><p>نوع العرض: للإيجار</p></body></html>")


ANJ_PAGE = "<html><body><table><tr><th>البند</th><th>التفاصيل</th></tr></table></body></html>"
FAS_PAGE = ('<html><body class="rtl single single-product postid-1">'
            '<div id="product-1" class="single-product-page product type-product instock">'
            '<p>غير متوفر</p></div></body></html>')
NOT_FOUND = '<html><body class="error404">الصفحة غير موجودة</body></html>'


# ── the signals ──────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("slug,block", TENANTS.items())
def test_inblaj_a_404_or_a_transacted_title_is_gone_and_an_offered_page_is_live(slug, block):
    sig = lambda *a: IP._signal(*a, marker=IP._LIVE_MARKER[slug])  # noqa: E731
    assert IP._LIVE_MARKER[slug] == block
    assert sig(404, NOT_FOUND, False) == "gone" and sig(410, NOT_FOUND, False) == "gone"
    assert sig(200, _inblaj_page(block=block), False) == "live"
    assert sig(200, _inblaj_page("للبيع أرض في حي تجريبي", block), False) == "live"   # <title> path
    for sold in ("شقة للإيجار تم الإيجار", "شقة تم الايجار", "عمارة للبيع تم البيع"):
        assert sig(200, _inblaj_page(sold, block), False) == "gone", sold


@pytest.mark.parametrize("slug,block", TENANTS.items())
def test_inblaj_anything_unclear_is_unknown_never_gone(slug, block):
    sig = lambda *a: IP._signal(*a, marker=IP._LIVE_MARKER[slug])  # noqa: E731
    other = "نظرة عامة" if block == "تفاصيل العقار" else "تفاصيل العقار"
    assert sig(200, "<html><title>x – y</title>shell</html>", False) is None
    assert sig(200, _inblaj_page(block=other), False) is None     # another tenant's theme ≠ this one's
    assert sig(200, _inblaj_page(block=block), True) is None      # landed on a different page
    for status in (301, 403, 429, 500, 503, None):
        assert sig(status, _inblaj_page("شقة تم البيع", block), False) is None, status
    # «مؤجر» is measured furniture (a building sold with its tenants): still an offered ad
    assert sig(200, _inblaj_page("عمارة مؤجرة للبيع", block), False) == "live"
    # words nobody measured on these tenants are not a verdict either way: not gone, and not a
    # certificate of life that would stamp the ad verified-alive
    for title in ("شقة محجوز", "أرض مباع", "شقة تم التأجير"):
        assert sig(200, _inblaj_page(title, block), False) is None, title


def test_inblaj_a_tenant_nobody_measured_has_no_marker():
    assert set(IP._LIVE_MARKER) == set(TENANTS)


def test_aqarnajran_a_404_is_gone_and_a_post_that_renders_its_table_is_live():
    assert ANJ._signal(404, NOT_FOUND, False) == "gone" and ANJ._signal(410, "x", False) == "gone"
    assert ANJ._signal(200, ANJ_PAGE, False) == "live"
    assert ANJ._signal(200, "<html>نوع العقار فلل للبيع</html>", False) is None   # menu chrome ≠ table
    assert ANJ._signal(200, ANJ_PAGE, True) is None
    for status in (403, 429, 503, None):
        assert ANJ._signal(status, ANJ_PAGE, False) is None, status


def test_fahadalshahri_a_404_is_gone_a_product_page_is_live_and_a_403_is_the_fingerprint():
    assert FAS._signal(404, NOT_FOUND, False) == "gone"
    assert FAS._signal(200, FAS_PAGE, False) == "live"      # «غير متوفر» is on every live page
    # the product's OWN block decides: out of stock (unmeasured here) or no block at all is
    # UNKNOWN — never gone, and never a certificate of life that would stamp it verified-alive
    assert FAS._signal(200, FAS_PAGE.replace("type-product instock", "type-product outofstock"), False) is None
    assert FAS._signal(200, FAS_PAGE.replace(' id="product-1"', ""), False) is None
    assert FAS._signal(200, FAS_PAGE.replace("<p>", '<div class="product instock"><p>')
                       .replace("type-product instock", "type-product outofstock"), False) is None  # a related card
    assert FAS._signal(200, '<html><body class="rtl">single-product</body></html>', False) is None
    assert FAS._signal(200, FAS_PAGE, True) is None
    for status in (403, 429, 503, None):
        assert FAS._signal(status, NOT_FOUND, False) is None, status


# ── the canary: no control, no removal ───────────────────────────────────────────────────────────
ORACLES = {
    "gudai": lambda control: IP._make_verify_gone("gudai", control, object()),
    "safera": lambda control: IP._make_verify_gone("safera", control, object()),
    "alhumaidan": lambda control: IP._make_verify_gone("alhumaidan", control, object()),
    "aqarnajran": lambda control: ANJ._make_verify_gone(control),
    "fahadalshahri": lambda control: FAS._make_verify_gone(control),
}
LIVE_PAGE = {"gudai": _inblaj_page(), "alhumaidan": _inblaj_page(),
             "safera": _inblaj_page(block="نظرة عامة"), "aqarnajran": ANJ_PAGE, "fahadalshahri": FAS_PAGE}


@pytest.mark.parametrize("site", ORACLES)
def test_a_removal_needs_a_known_live_control_from_the_same_run(site, monkeypatch):
    for mod in (IP, ANJ, FAS):
        monkeypatch.setattr(mod, "session", lambda *a: object())
        monkeypatch.setattr(mod, "stored_listing_url", lambda tables: (lambda ad: f"https://x.test/{ad}"))
    monkeypatch.setattr(HL.time, "sleep", lambda s: None)
    pages = {"https://x.test/GONE": (404, NOT_FOUND), "https://x.test/CTRL": (200, LIVE_PAGE[site])}
    monkeypatch.setattr(HL.LivenessProbe, "fetch", lambda self, url: (*pages[url], False))
    make = ORACLES[site]
    assert make({"ad_number": "CTRL"})("GONE")[0] == "gone"
    assert make({"ad_number": "CTRL"})("CTRL")[0] == "live"
    assert make(None)("GONE")[0] == "unknown", "no control → no removal is believed"
    # a control that itself reads gone means the SOURCE is not answering truthfully
    assert make({"ad_number": "GONE"})("GONE")[0] == "unknown"


# ── the wiring: main() driven end to end, network and database replaced ──────────────────────────
class FakeDb:
    """Stands in for scrapers.common.db: records every call, writes nothing."""

    def __init__(self):
        self.calls: list[tuple[str, tuple, dict]] = []

    def __getattr__(self, name):
        def call(*a, **k):
            self.calls.append((name, a, k))
            return {"begin_run": 1, "end_run": True}.get(name, 0)
        return call

    def prunes(self) -> dict[str, tuple[set, dict]]:
        return {a[0]: (set(a[1]), k) for n, a, k in self.calls if n == "prune_unseen"}

    def end(self) -> dict:
        return [k for n, _, k in self.calls if n == "end_run"][-1]


class Resp:
    def __init__(self, status=200, text="", data=None, headers=None):
        self.status_code, self.text, self._data, self.headers = status, text, data, headers or {}

    def json(self):
        return self._data


class Sess:
    def __init__(self, answer):
        self.answer = answer

    def get(self, url, **kw):
        return self.answer(url, kw.get("params") or {})


@pytest.fixture
def fake(monkeypatch):
    f = FakeDb()
    for mod in (IP, ANJ, FAS):
        monkeypatch.setattr(mod, "db", f)
    return f


def _row(ad: str, title: str = "شقة للبيع") -> dict:
    return {"ad_number": ad, "title": title, "transaction_type": "Buy", "property_type": "Apartment",
            "city_ar": "الرياض", "area_m2": 100}


def _run_inblaj(monkeypatch, pages: dict[str, int], argv=("run",), titles: dict[str, str] | None = None):
    base = "https://t.test"
    sitemap = "<urlset>" + "".join(f"<url><loc>{base}/property/{k}/</loc></url>" for k in pages) + "</urlset>"

    def answer(url, params):
        if url.endswith(".xml"):
            return Resp(200, sitemap)
        return Resp(pages[url.rstrip("/").rsplit("/", 1)[-1]], "page")

    def fake_map(url, html, *, source, prefix):
        key = url.rstrip("/").rsplit("/", 1)[-1]
        return _row(prefix + key, (titles or {}).get(key, "شقة للبيع")), ("commercial" if key.startswith("c") else "residential"), ""

    monkeypatch.setattr(IP, "session", lambda *a: Sess(answer))
    monkeypatch.setattr(IP, "map_listing", fake_map)
    monkeypatch.setattr(sys, "argv", list(argv))
    return IP.run_platform(slug="gudai", base=base, source="Gudai", prefix="GUD")


def test_inblaj_hands_the_oracle_to_prune_per_table_after_a_whole_walk(fake, monkeypatch):
    # r2's page 404s during the walk: that is the source answering, not an unreadable page.
    assert _run_inblaj(monkeypatch, {"r1": 200, "r2": 404, "c1": 200}) == 0
    prunes = fake.prunes()
    assert prunes["gudai_residential_listings"][0] == {"GUDr1"}
    assert prunes["gudai_commercial_listings"][0] == {"GUDc1"}
    for seen, kw in prunes.values():
        assert kw["source"] == "Gudai" and callable(kw["verify_gone"])
        assert not set(kw) - {"source", "verify_gone"}, "no guard, grace or cap is overridden"


@pytest.mark.parametrize("status", [403, 429, 500, 503])
def test_inblaj_does_not_prune_when_a_page_of_the_walk_could_not_be_read(fake, monkeypatch, status):
    assert _run_inblaj(monkeypatch, {"r1": 200, "r2": status, "c1": 200}) == 0
    assert fake.prunes() == {}


def test_inblaj_does_not_prune_on_a_single_vertical_run(fake, monkeypatch):
    assert _run_inblaj(monkeypatch, {"r1": 200, "c1": 200}, argv=("run", "--type", "residential")) == 0
    assert fake.prunes() == {}


def test_inblaj_keeps_and_counts_a_status_word_nobody_measured(fake, monkeypatch):
    assert _run_inblaj(monkeypatch, {"r1": 200, "r2": 200}, titles={"r2": "شقة محجوز"}) == 0
    assert fake.prunes()["gudai_residential_listings"][0] == {"GUDr1", "GUDr2"}, "kept, not filtered"
    assert "unmeasured_status_word_in_titlex1" in fake.end()["notes"]


def _run_rest(mod, monkeypatch, items: list[dict], total, argv=("run",)):
    monkeypatch.setattr(mod, "session", lambda: Sess(lambda url, params: Resp(
        200, data=items, headers={} if total is None else {"x-wp-total": str(total)})))
    monkeypatch.setattr(mod, "map_listing", lambda p: (
        _row(f"X{p['id']}"), "commercial" if p.get("com") else "residential", ""))
    monkeypatch.setattr(sys, "argv", list(argv))
    return mod.main()


@pytest.mark.parametrize("mod,slug", [(ANJ, "aqarnajran"), (FAS, "fahadalshahri")])
def test_rest_crawlers_hand_the_oracle_to_prune_per_table_after_a_whole_walk(fake, monkeypatch, mod, slug):
    assert _run_rest(mod, monkeypatch, [{"id": 1}, {"id": 2, "com": True}], total=2) == 0
    prunes = fake.prunes()
    assert prunes[f"{slug}_residential_listings"][0] == {"X1"}
    assert prunes[f"{slug}_commercial_listings"][0] == {"X2"}
    for seen, kw in prunes.values():
        assert kw["source"] == mod.SOURCE and callable(kw["verify_gone"])
        assert not set(kw) - {"source", "verify_gone"}, "no guard, grace or cap is overridden"
    assert fake.end()["notes"].startswith("pruned=0")


@pytest.mark.parametrize("mod", [ANJ, FAS])
@pytest.mark.parametrize("total", [3, None])
def test_rest_crawlers_do_not_prune_when_the_source_says_there_is_more_than_was_read(fake, monkeypatch, mod, total):
    # x-wp-total is the source's own count; a missing header is "cannot tell", never "complete".
    assert _run_rest(mod, monkeypatch, [{"id": 1}, {"id": 2, "com": True}], total=total) == 0
    assert fake.prunes() == {} and mod.INCOMPLETE


@pytest.mark.parametrize("mod", [ANJ, FAS])
def test_rest_crawlers_do_not_prune_on_a_single_vertical_run(fake, monkeypatch, mod):
    assert _run_rest(mod, monkeypatch, [{"id": 1}], total=1, argv=("run", "--type", "residential")) == 0
    assert fake.prunes() == {}


def test_fahadalshahri_keeps_and_counts_a_stock_state_nobody_measured(fake, monkeypatch):
    items = [{"id": 1, "is_in_stock": True, "is_purchasable": False},    # no price printed: still live
             {"id": 2, "is_in_stock": False}]
    assert _run_rest(FAS, monkeypatch, items, total=2) == 0
    assert fake.prunes()["fahadalshahri_residential_listings"][0] == {"X1", "X2"}, "kept, not filtered"
    assert "kept_active_is_in_stock=Falsex1" in fake.end()["notes"]
