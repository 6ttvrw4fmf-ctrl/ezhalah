"""Azdad: a listing the source marks «مباع» must stay inactive past the 05:20 recover sweep.

MEASURED 2026-09-28: AD202509210004 (أراضي سكنية للبيع) has carried `status: «مباع»` on azdad's own
Supabase API since 2025-12-26 (its `updated_at`), and production still showed it active=true with
missing_count 0. The scraper wrote active=false every run (~04:40 UTC) through the shared batch
upsert — which also writes missing_count=0 — and auto_recover_false_inactive() (pg_cron jobid 30,
05:20 UTC) re-activates exactly `active = false AND coalesce(missing_count, 0) = 0` rows deactivated
in the last 24 h. So it came back every morning.

The fleet's sold pin (scrapers/common/sold_pin.py) is the cure: after the upsert, the row is pinned
to missing_count=3 + active=false and a GONE evidence row names the source field. main() runs for
real here, with the real shared pin, over a recording fake of the PostgREST client; the two listings
are the live API's own records, trimmed to the keys map_listing reads.
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

# Hermetic import: stub supabase + dotenv so db.py imports with no credentials/network.
_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.azdad import run as R  # noqa: E402

SOLD = {"id": "sold-land", "ad_number": "AD202509210004", "status": "مباع", "category": "أراضي سكنية",
        "type": "للبيع", "location": "ابها", "price": 500000, "area": 600}
LIVE = {"id": "live-flat", "ad_number": "AD202509050001", "status": "متاح", "category": "شقة",
        "type": "للإيجار", "location": "ابها - المحالة", "yearly_rent": 30000, "rooms": 3}


class _Q:
    def __init__(self, log, table):
        self.log, self.table, self.payload = log, table, None

    def update(self, payload):
        self.payload = payload
        return self

    def insert(self, rows):
        self.log.append(("insert", self.table, rows))
        return self

    def in_(self, _col, ads):
        if self.payload is not None:
            self.log.append(("update", self.table, dict(self.payload), list(ads)))
        return self

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def execute(self):
        return types.SimpleNamespace(data=[])


def test_a_source_sold_listing_is_pinned_so_the_recover_sweep_cannot_reactivate_it(monkeypatch):
    log: list = []
    upserted: list = []
    monkeypatch.setattr(R.db, "sb", lambda: types.SimpleNamespace(table=lambda t: _Q(log, t)))
    monkeypatch.setattr(R.db, "begin_run", lambda *_a, **_k: 1)
    monkeypatch.setattr(R.db, "end_run", lambda *_a, **_k: True)
    monkeypatch.setattr(R.db, "upsert_azdad_residential_batch", lambda rows: upserted.extend(rows))
    monkeypatch.setattr(R.db, "upsert_azdad_commercial_batch", lambda rows: upserted.extend(rows))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **_k: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda *_a, **_k: 0)
    monkeypatch.setattr(R, "to_catalog", lambda city_ar, region_hint=None: (60, 6))
    monkeypatch.setattr(R, "find_district_in_text", lambda text, city_id: None)
    monkeypatch.setattr(R, "fetch_all", lambda _s: [SOLD, LIVE])
    monkeypatch.setattr(sys, "argv", ["run.py"])

    assert R.main() == 0
    # The upsert alone carries active=false — and missing_count 0, the recover sweep's trigger.
    assert {r["ad_number"]: r["active"] for r in upserted} == {"AD202509210004": False, "AD202509050001": True}

    pins = [e for e in log if e[0] == "update" and e[2].get("missing_count") == 3]
    assert pins == [("update", "azdad_residential_listings", {"active": False, "missing_count": 3},
                     ["AD202509210004"])], f"sold row not pinned past the 05:20 recover: {log}"
    evidence = [row for e in log if e[0] == "insert" for row in e[2]]
    assert [(r["ad_number"], r["verdict"], r["oracle"]) for r in evidence] == [
        ("AD202509210004", "GONE", "azdad.sold_pin.status")]
