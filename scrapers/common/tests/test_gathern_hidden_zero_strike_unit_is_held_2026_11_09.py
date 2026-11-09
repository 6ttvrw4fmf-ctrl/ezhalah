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

import pytest

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


@pytest.mark.parametrize("status,body", [
    (404, "not found"), (410, "gone"), (403, "blocked"),
    (429, "rate limited"), (503, "unavailable"), (None, ""), (200, ""),
])
def test_hidden_zero_strike_unit_keeps_its_state_without_affirmative_evidence(
    monkeypatch, status, body,
):
    stored = [{"ad_number": "GTH1", "missing_count": 0, "active": False}]
    rows = _rows("GTH1")
    original = rows[0].copy()
    stamped = _wire(monkeypatch, stored, {"1": (status, body)})

    assert R.held_strikes(rows) == {"GTH1": (0, False)}
    assert stamped == []
    assert rows == [original]


def test_mixed_feed_checks_only_hidden_or_struck_rows_and_stamps_only_live_ones(monkeypatch):
    stored = [
        {"ad_number": "GTH1", "missing_count": 0, "active": False},
        {"ad_number": "GTH2", "missing_count": 1, "active": True},
        {"ad_number": "GTH3", "missing_count": 3, "active": False},
        {"ad_number": "GTH4", "missing_count": 0, "active": True},
        # Hidden in storage but absent from this feed: must not be probed.
        {"ad_number": "GTH99", "missing_count": 0, "active": False},
    ]
    rows = _rows("GTH1", "GTH2", "GTH3", "GTH4", "GTH5")
    monkeypatch.setattr(R.db, "sb", lambda: types.SimpleNamespace(table=lambda _n: _Filtering(stored)))
    pages = {rows[0]["listing_url"]: (200, "unit", False),
             rows[1]["listing_url"]: (503, "unavailable", False),
             rows[2]["listing_url"]: (404, "gone", False)}
    fetched = []

    def fetch(url):
        fetched.append(url)
        return pages[url]

    monkeypatch.setattr(R._probe, "fetch", fetch)
    # Use the real marker so the assertion verifies the row that the upsert will receive.
    assert R.held_strikes(rows) == {"GTH2": (1, True), "GTH3": (3, False)}
    assert fetched == list(pages)
    assert rows[0][R.db._DIRECT_ALIVE_KEY] == "gathern.held_strikes.own_page_live"
    assert all(R.db._DIRECT_ALIVE_KEY not in row for row in rows[1:])


@pytest.mark.parametrize("opens", [False, True])
def test_hidden_zero_strike_home_redirect_requires_own_arabic_page(monkeypatch, opens):
    from scrapers.gathern import liveness

    rows = _rows("GTH1")
    stored = [{"ad_number": "GTH1", "missing_count": 0, "active": False}]
    monkeypatch.setattr(R.db, "sb", lambda: types.SimpleNamespace(table=lambda _n: _Filtering(stored)))
    monkeypatch.setattr(R._probe, "fetch", lambda url: (200, "home page", True))
    session = object()
    monkeypatch.setattr(R, "_oracle_session", lambda: session)
    checked = []

    def opens_at_ar_view(actual_session, url):
        assert actual_session is session
        checked.append(url)
        return opens

    monkeypatch.setattr(liveness, "_opens_at_ar_view", opens_at_ar_view)
    assert R.held_strikes(rows) == ({} if opens else {"GTH1": (0, False)})
    assert checked == [rows[0]["listing_url"]]
    if opens:
        assert rows[0][R.db._DIRECT_ALIVE_KEY] == "gathern.held_strikes.ar_view_opens"
    else:
        assert R.db._DIRECT_ALIVE_KEY not in rows[0]


@pytest.mark.parametrize("count,expected_sizes", [(0, []), (200, [200]), (201, [200, 1])])
def test_hidden_zero_strike_filter_applies_to_each_query_batch(monkeypatch, count, expected_sizes):
    rows = _rows(*(f"GTH{i}" for i in range(count)))
    stored = [{"ad_number": row["ad_number"], "missing_count": 0, "active": False}
              for row in rows]
    batches = []

    class BatchedFiltering(_Filtering):
        def in_(self, col, vals):
            batches.append(list(vals))
            return super().in_(col, vals)

    monkeypatch.setattr(R.db, "sb", lambda: types.SimpleNamespace(table=lambda _n: BatchedFiltering(stored)))
    fetched = []

    def fetch(url):
        fetched.append(url)
        return 404, "gone", False

    monkeypatch.setattr(R._probe, "fetch", fetch)
    assert R.held_strikes(rows) == {row["ad_number"]: (0, False) for row in rows}
    assert [len(batch) for batch in batches] == expected_sizes
    assert [ad for batch in batches for ad in batch] == [row["ad_number"] for row in rows]
    assert fetched == [row["listing_url"] for row in rows]
    assert all(R.db._DIRECT_ALIVE_KEY not in row for row in rows)
