"""Each aqar fill RUN adds at most its budget of NEW rows across ALL its shards, then the next run resumes.

WHY (2026-10-02). Reading every aqar page (test_aqar_fill_walks_to_the_sources_own_page_count.py)
opens a ~100k-row gap. Written at once that is the 2026-09-21 disk incident (~3 GB in minutes, before
the disk's at-most-once-per-6 h autoscale could react). So a workflow run — ~108 parallel shards — may
add at most `--new-budget` new rows IN TOTAL, drawn from one shared pool (aqar_fill_claim, staged in
sql/proposed/aqar_paced_fill.sql), and the next run must carry on where it stopped. The resume point is
what we already hold, so the ads a run wrote are never re-sent as "new", and held ads are only re-read
once their capture is 6 days old (otherwise a 12-hourly fill rewrites the table twice a day).

The test drives the real run_residential.scrape_slice() for three shards of one run, run after run,
over a fake source and an in-memory DB whose claim() has aqar_fill_claim's semantics.

    python -m pytest scrapers/common/tests/test_aqar_fill_new_rows_bounded_per_run_and_resumes.py -q
"""
from __future__ import annotations

import sys
import types
from datetime import datetime, timedelta, timezone
from urllib.parse import unquote

for _name, _attrs in (("supabase", {"Client": object, "create_client": lambda *a, **k: None}),
                      ("dotenv", {"load_dotenv": lambda *a, **k: None})):
    if _name not in sys.modules:
        sys.modules[_name] = types.ModuleType(_name)
        for _k, _v in _attrs.items():
            setattr(sys.modules[_name], _k, _v)

import scrapers.aqar.discover as D  # noqa: E402
import scrapers.aqar.paced_fill as F  # noqa: E402
import scrapers.aqar.run_residential as R  # noqa: E402

TABLE = "aqar_residential_listings"
SOURCE = {"riyadh": 130, "jeddah": 70, "dammam": 40}   # ads per shard's slice: 240 in all
BUDGET = 50


def _ads(city: str) -> list[str]:
    base = {"riyadh": 6100000, "jeddah": 6200000, "dammam": 6300000}[city]
    return [str(base + i) for i in range(SOURCE[city])]


def test_each_run_adds_at_most_its_budget_across_shards_and_the_next_run_resumes(monkeypatch):
    now = datetime.now(timezone.utc)
    ago = lambda days: (now - timedelta(days=days)).isoformat()  # noqa: E731
    riy = _ads("riyadh")
    # Already held: 20 fresh (must NOT be re-read), 10 stale (must be), 5 inactive (always re-read).
    store = {a: {"raw_captured_at": ago(1), "active": True} for a in riy[:20]}
    store.update({a: {"raw_captured_at": ago(10), "active": True} for a in riy[20:30]})
    store.update({a: {"raw_captured_at": ago(1), "active": False} for a in riy[30:35]})
    held_at_start = set(store)

    class _Page:
        status_code = 200

        def __init__(self, city: str, page: int):
            ads = _ads(city)[(page - 1) * 20: page * 20]
            ar = D.CITY_AR[city]
            self.text = (f'{{"numberOfItems":{SOURCE[city]}}}'
                         + "".join(f'<a href="/شقق-للإيجار/{ar}/حي-{a}">x</a>' for a in ads))

    def fake_get(url, *a, **k):
        parts = unquote(url).rstrip("/").split("/")
        page = int(parts[-1]) if parts[-1].isdigit() else 1
        ar = parts[-2] if parts[-1].isdigit() else parts[-1]
        return _Page(next(c for c, v in D.CITY_AR.items() if v == ar and c in SOURCE), page)

    ledger: dict[str, list[int]] = {}

    def fake_claim(key, budget, want):              # aqar_fill_claim(): first claim fixes the budget
        b = ledger.setdefault(key, [budget, 0])
        grant = max(0, min(want, b[0] - b[1]))
        b[1] += grant
        return grant

    written: list[str] = []

    def fake_upsert(row):
        written.append(row["ad_number"])
        store[row["ad_number"]] = {"raw_captured_at": datetime.now(timezone.utc).isoformat(), "active": True}

    monkeypatch.setattr(D, "get", fake_get)
    monkeypatch.setattr(F, "claim", fake_claim)
    monkeypatch.setattr(F, "held", lambda table, ads: {a: store[a] for a in ads if a in store})
    monkeypatch.setattr(R, "enrich_residential", lambda url, **k: {"ad_number": F.ad_number(url)})
    monkeypatch.setattr(R.db, "upsert_aqar_residential", fake_upsert)

    gap = sum(SOURCE.values()) - len(held_at_start)        # 205 new ads at the source
    runs, new_so_far = 0, set()
    while True:
        runs += 1
        written.clear()
        before = set(store)
        for city in SOURCE:                                 # three shards of ONE workflow run
            fill = F.PacedFill(TABLE, new_budget=BUDGET, refresh_after_days=6, key=f"aqar-deep-fill:{runs}")
            seen, _, _ = R.scrape_slice("apartment", "rent", city, max_pages=0, max_listings=0, fill=fill)
            assert seen == SOURCE[city]                     # rows_seen = everything on the pages
        new = [a for a in written if a not in before]
        assert len(new) <= BUDGET, (runs, len(new))         # the bound holds across shards
        assert not (set(new) & new_so_far), "a run re-sent ads an earlier run already wrote"
        new_so_far |= set(new)
        refreshed = set(written) - set(new)
        if runs == 1:
            assert refreshed == set(riy[20:35]), sorted(refreshed)   # stale + inactive only
        else:
            assert not refreshed, sorted(refreshed)         # everything held is now fresh
        if not new:
            break
        assert runs < 20
    assert runs == -(-gap // BUDGET) + 1                    # 5 filling runs, then a no-op one
    assert new_so_far == {a for c in SOURCE for a in _ads(c)} - held_at_start

    # FAIL CLOSED: a run that cannot reach the budget ledger adds nothing new.
    def no_ledger(*a):
        raise RuntimeError("PGRST202: aqar_fill_claim not found")   # migration not applied yet

    store.pop(riy[-1])
    monkeypatch.setattr(F, "claim", no_ledger)
    written.clear()
    R.scrape_slice("apartment", "rent", "riyadh", max_pages=0, max_listings=0,
                   fill=F.PacedFill(TABLE, new_budget=BUDGET, refresh_after_days=6, key="no-ledger"))
    assert riy[-1] not in written
