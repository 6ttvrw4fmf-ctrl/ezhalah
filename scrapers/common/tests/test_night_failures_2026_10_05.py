"""The four crawls that failed on the night of 2026-10-05 (Scraping Engineer), each executed against
a stub transport that reproduces what the source did that night.

  · sakani      — catalogue served (273 units), then EVERY detail call drew «HTTP 403 challenge after
                  4 tries» (~65 s each) until the 45-minute job cap cancelled it with 0 rows written
                  (Actions job 111614516016). Now: re-negotiate the session after DETAIL_WALL_AFTER
                  consecutive unread details, and stop in minutes when fresh sessions are walled too.
  · aqarnajran  — «wp-json returned no posts»: page 1 answered non-200 and the walk broke SILENTLY into
                  an empty list, so the ledger never said what the source answered.
  · hasaad      — «projects sitemap → HTTP 404»: the fixed sitemap address is the only discovery path.
                  Now the WordPress sitemap indexes are read for whichever child names the projects.
  · justsa / hasaad / aqarnajran — one pinned profile, no retry: the walk session is now probed over
                  3 profiles DIRECT then the residential proxy (retry_smarter_session).

Run: python -m pytest scrapers/common/tests/test_night_failures_2026_10_05.py -v
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scrapers.aqarnajran.run as AQN  # noqa: E402
import scrapers.hasaad.run as HSD  # noqa: E402
import scrapers.justsa.run as JST  # noqa: E402
import scrapers.sakani.run as SKN  # noqa: E402


class _Resp:
    def __init__(self, status: int, text: str = "", headers: dict | None = None, js=None) -> None:
        self.status_code, self.text, self.headers, self._js = status, text, headers or {}, js

    def json(self):
        return self._js


# ─────────────────────────────────────────── sakani ─────────────────────────────────────────────
def _sakani_stubs(monkeypatch, n_units: int, detail):
    calls = {"end_run": [], "batch": [], "sessions": 0}
    monkeypatch.setattr(SKN, "db", types.SimpleNamespace(
        begin_run=lambda platform: 9,
        mark_direct_alive=lambda row, **kw: row,
        _wasalt_batch=lambda table, rows: calls["batch"].append(table),
        retire_superseded_siblings=lambda **kw: 0,
        prune_unseen=lambda *a, **kw: 0,
        end_run=lambda run_id, **kw: calls["end_run"].append(kw) or True))
    monkeypatch.setattr(SKN.time, "sleep", lambda *_: None)

    def new_session():
        calls["sessions"] += 1
        return f"session-{calls['sessions']}"
    monkeypatch.setattr(SKN, "session", new_session)
    monkeypatch.setattr(SKN, "_oracle_sess", None)
    units = [({"resource_id": 1000 + i}, {"resource_id": 1000 + i}) for i in range(n_units)]
    monkeypatch.setattr(SKN, "enumerate_rent", lambda s: list(units))
    monkeypatch.setattr(SKN, "fetch_detail", detail)
    monkeypatch.setattr(SKN, "map_listing", lambda idx, rich, d, dr: (None, "", "stub"))
    monkeypatch.setattr(SKN, "_controls_live", lambda ads: False)
    monkeypatch.setattr(sys, "argv", ["run.py"])
    return calls


def test_sakani_a_walled_detail_route_stops_in_minutes_not_at_the_job_cap(monkeypatch):
    asked: list[str] = []

    def walled(s, uid):
        asked.append(uid)
        return "miss", None
    calls = _sakani_stubs(monkeypatch, 273, walled)
    assert SKN.main() == 1
    # the old walk asked for all 273 details (≈ 5 h at 65 s each); the breaker stops after a handful
    assert len(asked) <= (SKN.MAX_RENEGOTIATIONS + 1) * (SKN.DETAIL_WALL_AFTER + 1), len(asked)
    assert calls["sessions"] == 1 + SKN.MAX_RENEGOTIATIONS, "every renegotiation is a FRESH session"
    kw = calls["end_run"][0]
    assert kw["ok"] is False and "detail route walled" in kw["notes"], kw
    assert calls["batch"] == [], "a walled run writes nothing and prunes nothing"


def test_sakani_a_fresh_session_that_is_served_continues_the_walk(monkeypatch):
    def recovers(s, uid):
        return ("ok", {"id": uid}) if s != "session-1" else ("miss", None)
    calls = _sakani_stubs(monkeypatch, 10, recovers)
    assert SKN.main() == 0
    assert calls["sessions"] == 2
    assert SKN._oracle_sess == "session-2", "the oracle must ride the session that is served"
    assert calls["end_run"][0]["ok"] is True


def test_sakani_scattered_misses_never_trip_the_breaker(monkeypatch):
    seq = iter([("miss", None), ("ok", {}), ("miss", None), ("miss", None), ("ok", {})] * 10)
    calls = _sakani_stubs(monkeypatch, 50, lambda s, uid: next(seq))
    assert SKN.main() == 0 and calls["sessions"] == 1


# ───────────────────────────────────────── aqarnajran ───────────────────────────────────────────
def test_aqarnajran_a_refused_first_page_says_what_the_source_answered():
    class S:
        def get(self, *a, **k):
            return _Resp(403)
    with pytest.raises(RuntimeError, match="HTTP 403"):
        AQN.fetch_posts(S())


# ─────────────────────────────────────────── hasaad ─────────────────────────────────────────────
def test_hasaad_a_moved_projects_sitemap_is_found_through_the_index():
    base = HSD.BASE
    pages = {
        HSD.SITEMAP: _Resp(404),
        f"{base}/sitemap_index.xml": _Resp(200, f"<sitemapindex><sitemap><loc>{base}/page-sitemap.xml</loc>"
                                                f"</sitemap><sitemap><loc>{base}/project-sitemap.xml</loc>"
                                                f"</sitemap></sitemapindex>"),
        f"{base}/project-sitemap.xml": _Resp(200, f"<urlset><url><loc>{base}/projects/</loc></url>"
                                                  f"<url><loc>{base}/projects/a/</loc></url>"
                                                  f"<url><loc>{base}/en/projects/a/</loc></url></urlset>"),
    }

    class S:
        def get(self, url, **k):
            return pages.get(url, _Resp(404))
    assert HSD.fetch_project_urls(S()) == [f"{base}/projects/a/"]


def test_hasaad_no_sitemap_anywhere_still_fails_loud_and_names_every_attempt():
    class S:
        def get(self, url, **k):
            return _Resp(404)
    with pytest.raises(RuntimeError) as e:
        HSD.fetch_project_urls(S())
    assert "projects-sitemap.xml:HTTP 404" in str(e.value) and "sitemap_index.xml:HTTP 404" in str(e.value)


# ─────────────────────────── justsa / hasaad / aqarnajran: the walk session ────────────────────
@pytest.mark.parametrize("mod", [JST, HSD, AQN])
def test_the_walk_session_is_probed_over_profiles_and_the_proxy(monkeypatch, mod):
    asked: list[tuple] = []
    served = object()

    def fake(probe_url, *, headers=None, **kw):
        asked.append((probe_url, headers))
        return served, ["direct/chrome124:Timeout", "direct/safari17_0:200"]
    monkeypatch.setattr(mod, "retry_smarter_session", fake)
    assert mod.walk_session() is served
    assert asked and asked[0][0].startswith(mod.BASE)
    assert "accept-language" in {k.lower() for k in (asked[0][1] or {})}, "the site's headers ride along"
