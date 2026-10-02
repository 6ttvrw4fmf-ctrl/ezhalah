"""aqar's null-price regression check runs on the run's OWN rows and never counts a price the source
itself withheld (2026-10-02). The windowed database version judged Duba's 2-row run on 101 Al Baha
rows whose source publishes no price, and 159 aqar_residential runs went red with correct data in
14 days. See scrapers/aqar/price_tally.py and migration «aqar_checks_its_own_prices»."""
from __future__ import annotations

import sys
import types

_sup = types.ModuleType("supabase")
_sup.Client = object
_sup.create_client = lambda *a, **k: object()
sys.modules.setdefault("supabase", _sup)
_dot = types.ModuleType("dotenv")
_dot.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dot)

from scrapers.common import db  # noqa: E402
from scrapers.aqar.price_tally import PriceTally  # noqa: E402

N = db.AUTHORITATIVE_NULL


def _tally(rows):
    t = PriceTally()
    for r in rows:
        t.add(PriceTally.classify(r))
    return t


def rent(v):
    return {"transaction_type": "Rent", "price_annual": v}


def buy(v):
    return {"transaction_type": "Buy", "price_total": v}


def test_source_published_no_price_never_counts():
    # the 2026-10-02 Al Baha shape: 13 of 44 rents priceless, every one AUTHORITATIVE_NULL
    t = _tally([rent(18000)] * 31 + [rent(N)] * 13)
    assert t.problems() == []
    assert t.source_none["Rent"] == 13 and t.unread["Rent"] == 0


def test_a_failed_read_at_scale_is_caught():
    t = _tally([rent(18000)] * 20 + [rent(None)] * 10)       # 10/30 unread > 25%
    assert t.problems() == ["rent_price_unread 10/30"]


def test_buy_and_rent_are_judged_separately_and_need_enough_rows():
    assert _tally([buy(None)] * 19).problems() == []          # 19 rows: too few to judge a ratio
    assert _tally([buy(None)] * 20).problems() == ["buy_price_unread 20/20"]
    assert _tally([buy(1)] * 30 + [rent(None)] * 5).problems() == []


def test_the_rent_field_is_read_for_rent_and_the_total_for_buy():
    assert PriceTally.classify({"transaction_type": "Rent", "price_total": 5, "price_annual": None}) == ("Rent", "unread")
    assert PriceTally.classify({"transaction_type": "Buy", "price_annual": None, "price_total": 5}) == ("Buy", "priced")
    assert PriceTally.classify({"transaction_type": None}) is None


class _Q:
    def __init__(self, sink, name):
        self.sink, self.name = sink, name

    def select(self, *a):
        return self

    def update(self, payload):
        self.sink["update"] = payload
        return self

    def eq(self, *a):
        return self


class _C:
    def __init__(self, sink):
        self.sink = sink

    def table(self, name):
        return _Q(self.sink, name)

    def rpc(self, name, params):
        self.sink.setdefault("rpc", []).append(params)
        return ("rpc", params)


def _end_run(monkeypatch, **kw):
    sink: dict = {}
    monkeypatch.setattr(db, "sb", lambda: _C(sink))

    def execute(q, **k):
        class R:
            data = [{"platform": "aqar_residential", "started_at": "2026-10-02T08:13:25Z"}] \
                if isinstance(q, _Q) else False
        return R()
    monkeypatch.setattr(db, "_execute", execute)
    db.end_run(7, ok=True, rows_seen=2, rows_upserted=2, check_tables=["aqar_residential_listings"], **kw)
    return sink["rpc"][0]


def test_only_a_caller_that_checked_its_own_prices_asks_the_database_to_skip(monkeypatch):
    assert _end_run(monkeypatch, price_null_checked_by_caller=True)["p_skip_price_null"] is True
    # every other scraper's call is byte-for-byte what it was: no new key at all
    assert "p_skip_price_null" not in _end_run(monkeypatch)


import importlib  # noqa: E402

import pytest  # noqa: E402


@pytest.mark.parametrize("mod,upsert", [("scrapers.aqar.run_residential", "upsert_aqar_residential"),
                                        ("scrapers.aqar.run_commercial", "upsert_aqar_commercial")])
def test_scrape_slice_feeds_every_written_row_to_the_tally(monkeypatch, mod, upsert):
    R = importlib.import_module(mod)
    urls = [f"https://sa.aqar.fm/x-{i}" for i in range(4)]
    prices = {urls[0]: 18000, urls[1]: N, urls[2]: None, urls[3]: 5}

    def discover(*a, outcome=None, **k):
        return iter(urls)
    monkeypatch.setattr(R.D, "discover", discover)
    monkeypatch.setattr(R, "enrich_residential",
                        lambda url, **k: {"ad_number": url[-1], "transaction_type": "Rent", "price_annual": prices[url]})
    failed = {urls[3]}

    def up(row):
        if row["ad_number"] == "3":
            raise RuntimeError("write failed")
    monkeypatch.setattr(R.db, upsert, up)
    t = PriceTally()
    R.scrape_slice("apartment", "rent", "riyadh", max_pages=1, max_listings=0, tally=t)
    assert failed and t.n["Rent"] == 3                      # the failed write is not counted
    assert t.unread["Rent"] == 1 and t.source_none["Rent"] == 1
