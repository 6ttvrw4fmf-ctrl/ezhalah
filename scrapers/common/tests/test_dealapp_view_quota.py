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
    def __init__(self, text, url, cache="Miss from cloudfront", status=200, age=None):
        self.text, self.url, self.status_code = text, url, status
        self.headers = {"x-cache": cache, **({"age": str(age)} if age is not None else {})}


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


def test_a_shard_interleaves_its_off_sitemap_tail_so_every_dead_ad_gets_live_neighbours(monkeypatch):
    """Removed ads drop out of the sitemap, so they live in the off-sitemap tail. Fetched last as one
    block, nothing rendered after them and confirmed_absent() could never bracket them (measured
    2026-10-02: shards over their cap confirmed 0–60 of ~400 dead a night)."""
    known = [str(i) for i in range(0, 1200, 12)]           # shard 0 of 12, in the sitemap
    tail = [str(i) for i in range(12000, 13200, 12)]       # shard 0 of 12, off-sitemap
    new = ["24000", "24012"]                                # in the sitemap, not held
    monkeypatch.setattr(run, "_sitemap_entries", lambda s: (known + new, []))
    monkeypatch.setattr(run, "_active_ids_for_reconfirm", lambda shards=1, shard=0: set(known + tail))
    monkeypatch.setenv("DEALAPP_MAX_LISTINGS", "150")       # < the shard's own 200: no room for new
    run.random.seed(5)

    ids = run.enumerate_ids(s=None, cap_pages=0, shards=12, shard=0)

    assert sorted(ids) == sorted(known + tail)              # the whole own slice, nothing dropped
    last_known = max(i for i, x in enumerate(ids) if x in set(known))
    assert sum(1 for x in ids[:last_known] if x in set(tail)) > 50   # the tail is not one end block


def test_the_crawl_stamps_verified_alive_only_for_this_ads_own_schema_on_offer(monkeypatch):
    """The crawl opens every ad's own page; that read is the direct check. A page carrying another
    ad's schema, or this ad marked sold, certifies nothing."""
    import sys
    from unittest.mock import MagicMock
    pages = {"6": 'x real-estate-listing-schema-6 x',        # own schema, but a days-old edge copy
             "7": 'x real-estate-listing-schema-7 x',        # own schema, on offer
             "8": 'x real-estate-listing-schema-99 x',       # another ad's schema
             "9": 'x real-estate-listing-schema-9 x'}        # own schema, sold
    got: list[dict] = []
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(run, "session", lambda: MagicMock())
    monkeypatch.setattr(run, "enumerate_ids", lambda s, cap: list(pages))
    monkeypatch.setattr(run, "fetch_one", lambda adid: (pages[adid], adid))
    monkeypatch.setattr(run, "_fresh_reads", {"7", "8", "9"})
    monkeypatch.setattr(run, "map_listing",
                        lambda html, adid: ({"ad_number": f"DA{adid}"}, "residential", adid == "9"))
    monkeypatch.setattr(run, "_pin_sold_inactive", lambda *a, **k: None)
    monkeypatch.setattr(run.db, "begin_run", lambda platform: 1)
    monkeypatch.setattr(run.db, "prune_unseen", lambda tbl, seen, source, **_kw: 0)
    monkeypatch.setattr(run.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(run.db, "upsert_dealapp_residential_batch", lambda rows: got.extend(rows))
    monkeypatch.setattr(run.db, "upsert_dealapp_commercial_batch", lambda rows: None)
    monkeypatch.setattr(run.db, "end_run", lambda run_id, **kw: True)

    run.main()

    stamped = {r["ad_number"] for r in got if r.get(run.db._DIRECT_ALIVE_KEY)}
    assert {r["ad_number"] for r in got} == {"DA6", "DA7", "DA8", "DA9"}
    assert stamped == {"DA7"}


def test_only_a_current_read_counts_a_days_old_edge_copy_does_not(monkeypatch):
    run._fresh_reads.clear()
    assert _fetch(monkeypatch, [lambda u: _Resp(_PRICED, u)])[0]                       # origin render
    assert "7" in run._fresh_reads
    run._fresh_reads.clear()
    assert _fetch(monkeypatch, [lambda u: _Resp(_PRICED, u, cache="Hit from cloudfront", age=3600)])[0]
    assert "7" in run._fresh_reads                                                     # hour-old copy
    run._fresh_reads.clear()
    assert _fetch(monkeypatch, [lambda u: _Resp(_PRICED, u, cache="Hit from cloudfront", age=200000)])[0]
    assert "7" not in run._fresh_reads                                                 # 2-day-old copy
