"""Three oracles that kept dead listings live, each because it did not read the SOURCE's own «gone».

Coverage audit, 2026-09-28, measured from a home IP:
  · aqarcity — the redesigned site answers a real HTTP 404 on the listing's own URL (Arabic
    «الصفحة غير موجودة», no «Page Not Found»); `_probe_id` called it 'exists' → UNKNOWN, so
    AC30614/30884/30885/30886 sat active past grace, and the upward id-walk never reached max_miss.
    Its sitemap index (/sitemaps/sitemap-index.xml) 404s; robots.txt names /sitemap.xml, a urlset.
  · rakez — an unpublished unit answers REST 401 `rest_forbidden` (and its public /?p=<id> a 404);
    the oracle held it UNKNOWN forever (RKZ72729 at 10 strikes, RKZ71559 at 20). And a unit still
    «available» inside a project the crawl excludes (soon / sold / off-plan) was certified LIVE.
  · fursaghyr — 8 active rows are WordPress status «expired» while their pages answer 200; the
    platform had no oracle at all.

Each test drives the real scraper function against a fake transport — no network, no database.

    python -m pytest scrapers/common/tests/test_oracles_read_the_sources_own_gone_2026_09_28.py -q
"""
from __future__ import annotations

import sys
import types

# ── Hermetic import: stub supabase + dotenv so db.py imports with no credentials/network ─────────
_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

import scrapers.aqarcity.run as A  # noqa: E402
import scrapers.fursaghyr.run as F  # noqa: E402
import scrapers.rakez.run as R  # noqa: E402

NOT_FOUND_AR = "<html><title>الصفحة غير موجودة | عقار ستي</title>" + "x" * 500 + "</html>"


class _Resp:
    def __init__(self, status, text="", url="", js=None):
        self.status_code, self.text, self.url, self._js = status, text, url, js
        self.content = text.encode()

    def json(self):
        if self._js is None:
            raise ValueError("not json")
        return self._js


# ── aqarcity ─────────────────────────────────────────────────────────────────────────────────────
def test_aqarcity_reads_its_own_404_as_notfound_and_its_urlset_sitemap(monkeypatch):
    live_ld = '<script type="application/ld+json">{}</script>'

    class S:
        asked: list[str] = []

        def get(self, url, **_k):
            self.asked.append(url)
            if url.endswith("/sitemap.xml"):
                return _Resp(200, "<urlset><url><loc>https://www.aqarcity.net</loc></url>"
                                  "<url><loc>https://www.aqarcity.net/property/30975</loc></url></urlset>", url)
            if url.endswith("/property/1"):
                return _Resp(200, live_ld, url)            # control: a live listing
            if url.endswith("/property/2"):
                return _Resp(403, "<html>blocked</html>", url)  # a block is never not-found
            return _Resp(404, NOT_FOUND_AR, url)           # URL unchanged, Arabic body

    s = S()
    assert A._probe_id(s, f"{A.BASE}/property/30614") == "notfound", (
        "a real HTTP 404 on the listing's own URL is the source's own not-found; reading it as "
        "'exists' holds every removal UNKNOWN (AC30614/30884/30885/30886, 2026-09-28)")
    assert A._probe_id(s, f"{A.BASE}/property/1") == "live"
    assert A._probe_id(s, f"{A.BASE}/property/2") != "notfound", "403 is about our access (§1)"

    # The id-walk past the sitemap max must STOP after max_miss 404s, not walk max_gap ids.
    monkeypatch.setenv("AQARCITY_PROBE_MAX_MISS", "5")
    monkeypatch.setenv("AQARCITY_PROBE_MAX_GAP", "60")
    monkeypatch.setenv("AQARCITY_PROBE_DELAY", "0")
    s.asked.clear()
    assert A.sequential_id_urls(s, 40000) == []
    probed = {u for u in s.asked if "/property/" in u}
    assert len(probed) == 5, f"the walk probed {len(probed)} ids past the frontier, expected max_miss=5"

    # The sitemap is /sitemap.xml, a urlset: harvest its /property/ locs, never GET each one.
    s.asked.clear()
    assert A.sitemap_urls(s) == ["https://www.aqarcity.net/property/30975"]
    assert s.asked == [f"{A.BASE}/sitemap.xml"], (
        f"sitemap_urls asked for {s.asked}; the old index 404s, and a urlset's <loc>s are listing "
        "pages, not child sitemaps")


# ── rakez ────────────────────────────────────────────────────────────────────────────────────────
def _proj(pid, status, offer=None):
    terms = [{"taxonomy": "property-status", "name": status}]
    if offer:
        terms.append({"taxonomy": "offer-group", "name": offer})
    return {"id": pid, "_embedded": {"wp:term": [terms]}}


def test_rakez_unpublished_or_excluded_unit_is_gone_and_nothing_else_is(monkeypatch):
    forbidden = {"code": "rest_forbidden", "data": {"status": 401}}
    rest = {
        "1": _Resp(401, js=forbidden),                                            # unpublished
        "2": _Resp(401, js=forbidden),                                            # page disagrees
        "3": _Resp(200, js={"id": 3, "acf": {"unit_status": "available", "unit_project": 500}}),
        "4": _Resp(200, js={"id": 4, "acf": {"unit_status": "available", "unit_project": 600}}),
        "5": _Resp(401, js={"code": "jwt_auth_bad"}),                             # a bare 401
        "6": _Resp(401, js=forbidden),                                            # empty 404 page
        "7": _Resp(200, js={"id": 7, "acf": {"unit_status": "available", "unit_project": 700}}),
        "8": _Resp(200, js={"id": 8, "acf": {"unit_status": "available", "unit_project": 800}}),
        "9": _Resp(200, js={"id": 9, "acf": {"unit_status": "available", "unit_project": 900}}),
        "10": _Resp(200, js={"id": 10, "acf": {"unit_status": "available", "unit_project": None}}),
    }
    page = {"1": _Resp(404, "<title>Page Not Found - Rakez</title>" + "x" * 500),
            "2": _Resp(200, "<title>Home - Rakez</title>" + "x" * 500),
            "6": _Resp(404, ""),
            "/ar/project/800/": _Resp(404, "<title>Page Not Found - Rakez</title>" + "x" * 500),
            "/ar/project/900/": _Resp(200, "<title>مشروع</title>" + "x" * 500),
            "/ar/project/None/": _Resp(404, "<title>Page Not Found - Rakez</title>" + "x" * 500)}

    def fake_get(url, **_k):
        if "/wp-json/wp/v2/unit/" in url:
            return rest[url.rsplit("/", 1)[1]]
        return page[url.split("=", 1)[1] if "?p=" in url else url[len(R.SITE):]]

    monkeypatch.setattr(R.cc, "get", fake_get)
    en = {500: _proj(500, "قريبا"), 600: _proj(600, "متاح"), 700: _proj(700, "متاح", "البيع على الخارطة")}
    verdict = {ad: R._verify_gone(f"RKZ{ad}", en, {})[0] for ad in rest}
    assert verdict == {"1": "gone", "2": "unknown", "3": "gone", "4": "live", "5": "unknown",
                       "6": "unknown", "7": "gone", "8": "gone", "9": "unknown", "10": "unknown"}, verdict


def test_rakez_failed_page_marks_the_walk_incomplete_and_the_run_does_not_prune(monkeypatch):
    full = [{"id": i} for i in range(R.PER_PAGE)]

    class S:
        def get(self, url, **_k):
            return _Resp(200, js=full) if url.endswith("page=1") else _Resp(503, "busy")

    R.INCOMPLETE.clear()
    assert len(R._paged(S(), "unit", "unit")) == R.PER_PAGE
    assert R.INCOMPLETE, "a 503 on page 2 truncated the walk silently"

    # …and the run that read it hands prune_unseen nothing, and reports itself degraded.
    unit = {"id": 9, "acf": {"unit_status": "available", "unit_project": 600}}
    pruned, ended = [], {}
    monkeypatch.setattr(R, "fetch_city_terms", lambda s: {1: {"name": "x", "parent": 0}})
    monkeypatch.setattr(R, "fetch_projects", lambda s, lang="": {600: _proj(600, "متاح")})
    monkeypatch.setattr(R, "fetch_units", lambda s: R.INCOMPLETE.append("unit page 2 HTTP 503") or [unit])
    monkeypatch.setattr(R, "arabic_project_id", lambda s, en_id: en_id)
    monkeypatch.setattr(R.time, "sleep", lambda *a, **k: None)
    for name, fn in (("begin_run", lambda *a, **k: 1), ("end_run", lambda rid, **kw: ended.update(kw) or False),
                     ("upsert_rakez_residential_batch", lambda rows: None),
                     ("upsert_rakez_commercial_batch", lambda rows: None),
                     ("retire_superseded_siblings", lambda **kw: 0),
                     ("prune_unseen", lambda *a, **kw: pruned.append(a) or 0)):
        monkeypatch.setattr(R.db, name, fn, raising=False)
    monkeypatch.setattr(sys, "argv", ["run.py"])
    R.main()
    assert pruned == [], "an incomplete enumeration reached prune_unseen"
    assert ended.get("degraded") is True, "the incomplete run was not reported degraded"


# ── fursaghyr ────────────────────────────────────────────────────────────────────────────────────
def test_fursaghyr_expired_status_is_gone_and_the_crawl_does_not_keep_it(monkeypatch):
    rest = {"24982": _Resp(200, js={"id": 24982, "status": "expired"}),
            "27171": _Resp(200, js={"id": 27171, "status": "publish"}),
            "1": _Resp(404, js={"code": "rest_post_invalid_id"}),
            "2": _Resp(401, js={"code": "rest_forbidden"}),
            "3": _Resp(200, js={"id": 99, "status": "expired"})}               # id mismatch

    class S:
        def get(self, url, **_k):
            if url.startswith(F.POSTS + "/"):
                return rest[url.rsplit("/", 1)[1]]
            return _Resp(200, js=[])                                          # media top-up

    monkeypatch.setattr(F, "_throttle", lambda: None)
    verdict = {ad: F._verify_gone(f"FG{ad}", S())[0] for ad in rest}
    assert verdict == {"24982": "gone", "27171": "live", "1": "gone", "2": "unknown", "3": "unknown"}, verdict

    # The crawl: a feed item the source calls expired is not upserted, and prune gets the oracle.
    item = lambda pid: {"id": pid, "rea": {"property_type": "فيلا", "purpose": "بيع"}, "title": "t",
                        "permalink": f"https://fursaghyr.com/property/{pid}/"}
    upserted, prune_kw = [], {}
    monkeypatch.setattr(F, "session", lambda: S())
    monkeypatch.setattr(F, "fetch_all", lambda s: [item(24982), item(27171)])
    for name, fn in (("begin_run", lambda *a, **k: 1), ("end_run", lambda rid, **kw: True),
                     ("upsert_fursaghyr_residential_batch", lambda rows: upserted.extend(rows)),
                     ("upsert_fursaghyr_commercial_batch", lambda rows: upserted.extend(rows)),
                     ("retire_superseded_siblings", lambda **kw: 0),
                     ("prune_unseen", lambda *a, **kw: prune_kw.update(kw) or 0)):
        monkeypatch.setattr(F.db, name, fn, raising=False)
    monkeypatch.setattr(F.db, "AUTHORITATIVE_NULL", object(), raising=False)
    monkeypatch.setattr(sys, "argv", ["run.py"])
    assert F.main() == 0
    assert [r["ad_number"] for r in upserted] == ["FG27171"], "an expired post was kept/refreshed"
    assert callable(prune_kw.get("verify_gone")), "prune_unseen was not handed the status oracle"
    assert prune_kw["verify_gone"]("FG24982")[0] == "gone"
