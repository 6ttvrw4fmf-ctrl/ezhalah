"""A HIDDEN Gathern unit with 0 strikes may not be revived by a feed sighting without a live page read.

2026-11-09, alert repeat_bug:false_resurrection:gathern_residential_listings (13734, 9 times in 7 days).
`held_strikes()` asked only for rows with `missing_count > 0`. 620 hidden gathern rows carry
missing_count = 0 (hidden by the 09-28 owner-ordered 404 sweep), so the next crawl that saw one in the
feed revived it active with no page read and no stamp: GTH151726 / GTH224930 / GTH240969 were active at
03:59 UTC on a 09-28 GONE verdict and first proven alive at 04:38. The query must hold hidden rows too,
and the filter must be the one PostgREST receives — this test records it instead of trusting a mock.
"""
import sys
import types

sys.path.insert(0, ".")
for _n in ("supabase", "dotenv"):
    sys.modules.setdefault(_n, types.ModuleType(_n))
sys.modules["supabase"].Client = object
sys.modules["supabase"].create_client = lambda *a, **k: None
sys.modules["dotenv"].load_dotenv = lambda *a, **k: None

import scrapers.gathern.run as R  # noqa: E402


class _Filtering:
    """A query that APPLIES the filters held_strikes sends, like PostgREST would."""

    def __init__(self, rows):
        self._rows = rows
        self._preds = []

    def select(self, *_a, **_k):
        return self

    def in_(self, col, vals):
        self._preds.append(lambda r: r[col] in vals)
        return self

    def gt(self, col, v):
        self._preds.append(lambda r: r[col] > v)
        return self

    def or_(self, expr):
        terms = []
        for t in expr.split(","):
            col, op, val = t.split(".", 2)
            if op == "gt":
                terms.append(lambda r, c=col, v=int(val): (r[c] or 0) > v)
            elif op == "is" and val == "false":
                terms.append(lambda r, c=col: r[c] is False)
            else:
                raise AssertionError(f"unexpected or_ term {t}")
        self._preds.append(lambda r: any(f(r) for f in terms))
        return self

    def execute(self):
        return types.SimpleNamespace(data=[r for r in self._rows if all(p(r) for p in self._preds)])


def _rows(*ads):
    return [{"ad_number": a, "listing_url": f"https://gathern.co/view/1/unit/{a[3:]}"} for a in ads]


def _wire(monkeypatch, stored, pages):
    monkeypatch.setattr(R.db, "sb", lambda: types.SimpleNamespace(table=lambda _n: _Filtering(stored)))
    monkeypatch.setattr(R._probe, "fetch", lambda url: (*pages[url.rsplit("/", 1)[1]], False))
    stamped = []
    monkeypatch.setattr(R.db, "mark_direct_alive", lambda row, **k: stamped.append(row["ad_number"]) or row)
    return stamped


def test_a_hidden_unit_with_zero_strikes_and_a_dead_page_stays_hidden(monkeypatch):
    stored = [{"ad_number": "GTH151726", "missing_count": 0, "active": False},   # the 13734 shape
              {"ad_number": "GTH9", "missing_count": 0, "active": True}]         # ordinary live row
    stamped = _wire(monkeypatch, stored, {"151726": (404, "<html>not found</html>"), "9": (200, "x")})
    held = R.held_strikes(_rows("GTH151726", "GTH9"))
    assert held == {"GTH151726": (0, False)}, held   # old code: {} → revived by the upsert
    assert stamped == []


def test_a_hidden_unit_whose_page_reads_live_is_released_with_a_stamp(monkeypatch):
    stored = [{"ad_number": "GTH224930", "missing_count": 0, "active": False}]
    monkeypatch.setattr(R, "_oracle_signal", lambda status, body, home: "live" if status == 200 else None)
    stamped = _wire(monkeypatch, stored, {"224930": (200, "<html>unit page</html>")})
    held = R.held_strikes(_rows("GTH224930"))
    assert held == {}
    assert stamped == ["GTH224930"]   # revived AND proven alive in the same upsert: no false resurrection


def test_an_active_unstruck_row_is_not_read_at_all(monkeypatch):
    stored = [{"ad_number": "GTH5", "missing_count": 0, "active": True}]
    def _no_fetch(url):
        raise AssertionError("an active, unstruck row must not cost a page read")
    monkeypatch.setattr(R.db, "sb", lambda: types.SimpleNamespace(table=lambda _n: _Filtering(stored)))
    monkeypatch.setattr(R._probe, "fetch", _no_fetch)
    assert R.held_strikes(_rows("GTH5")) == {}


def test_held_reads_start_at_least_one_second_apart(monkeypatch):
    """Hidden rows join this loop (hundreds a crawl): page reads stay ≤ 1 request/second even when
    SCRAPE_MIN_INTERVAL is lower (CodeRabbit, PR #11478)."""
    stored = [{"ad_number": f"GTH{i}", "missing_count": 0, "active": False} for i in (1, 2, 3)]
    _wire(monkeypatch, stored, {str(i): (404, "x") for i in (1, 2, 3)})
    clock = [100.0]
    slept = []
    monkeypatch.setattr(R, "MIN_INTERVAL", 0.6)
    monkeypatch.setattr(R.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(R.time, "sleep", lambda s: (slept.append(round(s, 3)), clock.__setitem__(0, clock[0] + s)))
    R.held_strikes(_rows("GTH1", "GTH2", "GTH3"))
    assert slept == [1.0, 1.0], slept
