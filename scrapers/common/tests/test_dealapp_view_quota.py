"""dealapp's anonymous view quota (measured 2026-09-28 from a home IP; see scrapers/dealapp/liveness.py).

~10 ad renders per minute per IP, then dealapp renders its registration page in place of the ad and
CloudFront keeps that page under the ad's URL for days. Every failed fetch of the 2026-09-28 crawl
was that page, so ~75% of the active catalogue went unseen, 6,841 dead rows could never be told
apart from walled live ones, and the prune's coverage guard tripped every night.

Pinned here: the crawl spends a rolling-minute budget of ORIGIN renders (edge hits are free), reads
past a cached wall through another spelling of the ad's URL, and counts the no-listing page as a
removal only when this runner rendered a live ad just before AND just after it.

Run: python -m pytest scrapers/common/tests/test_dealapp_view_quota.py -v
"""
import scrapers.dealapp.run as run
from scrapers.dealapp.liveness import OriginBudget, is_registration_wall

_PRICED = ('<script id="ng-state" type="application/json">{"schemaMarkupScripts":'
           '{"real-estate-listing-schema-7":"{\\"@type\\":\\"RealEstateListing\\",\\"offers\\":'
           '{\\"price\\":\\"1000\\"}}"}}</script>')
_WALL = "<html><head><title>صفحة التسجيل</title></head><body>…</body></html>"
_NOT_FOUND = '<title>ديل</title><script id="ng-state" type="application/json">{"schemaMarkupScripts":{}}</script>'


class _Resp:
    def __init__(self, text, url, cache="Miss from cloudfront", status=200):
        self.text, self.url, self.status_code = text, url, status
        self.headers = {"x-cache": cache}


class _Session:
    def __init__(self, answers):
        self.answers, self.asked = answers, []

    def get(self, url, **kw):
        self.asked.append(url)
        return self.answers[len(self.asked) - 1](url)


def _fetch(monkeypatch, answers):
    s = _Session(answers)
    monkeypatch.setattr(run, "_session", lambda: s)
    monkeypatch.setattr(run, "_ORIGIN", OriginBudget(per_min=1000))
    monkeypatch.setattr(run.time, "sleep", lambda _s: None)
    run._origin_renders.clear()
    return run.fetch_one("7"), s.asked


def test_budget_caps_origin_renders_and_edge_hits_are_free():
    now = [0.0]
    b = OriginBudget(per_min=2, window=60, clock=lambda: now[0],
                     sleep=lambda d: now.__setitem__(0, now[0] + d))
    b.acquire(); edge = b.acquire(); b.refund(edge)     # the edge answered: slot comes back
    b.acquire()
    assert now[0] == 0.0                                # 2 origin renders fit the minute
    b.acquire()
    assert now[0] >= 60.0                               # the 3rd waits for the window


def test_a_cached_wall_is_read_past_through_a_fresh_render(monkeypatch):
    out, asked = _fetch(monkeypatch, [
        lambda u: _Resp(_WALL, u, cache="Hit from cloudfront"),
        lambda u: _Resp(_PRICED, u),
    ])
    assert out == (_PRICED, "7")
    assert asked == [f"{run.BASE}/ar/ad-details/7", f"{run.BASE}/ar/ad-details/7/"]


def test_a_fresh_no_listing_render_is_final_and_logged(monkeypatch):
    out, asked = _fetch(monkeypatch, [lambda u: _Resp(_NOT_FOUND, u)])
    assert out is None and len(asked) == 1
    assert run._origin_renders == [("7", "none")]


def test_the_wall_is_never_read_as_the_ad():
    assert is_registration_wall(_WALL) and not is_registration_wall(_NOT_FOUND)


def test_no_listing_counts_as_removal_only_between_two_live_renders(monkeypatch):
    monkeypatch.setattr(run, "_origin_renders", [
        ("1", "ad"), ("X", "none"), ("Y", "none"), ("2", "ad"),   # bracketed → both confirmed
        ("W", "none"), ("3", "wall"),                            # quota hit after → not believable
        ("4", "ad"), ("Z", "none"),                              # nothing after → not believable
    ])
    assert set(run.confirmed_absent()) == {"X", "Y"}
