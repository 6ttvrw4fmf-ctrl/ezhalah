"""Nuzul engine (goldendeal / yameen / maqam): an item the office took OFF its website is gone,
even while its status still reads «available».

MEASURED 2026-09-28. GDL52019, GDL52111 and GDL53568 were active with missing_count 2: the list
API (the crawl's enumerator) no longer carries them, but the detail API still serves them with
availability_status «available» — and published_on_website 0 (set 2026-09-26). Every one of the
435 items the three tenants' list APIs return is published_on_website 1, so that flag IS the
storefront's own gate. The oracle read only the status, answered «live» at the third miss, and
prune_unseen self-healed the rows (missing_count → 0) instead of retiring them — forever.

The records below are VERBATIM from goldendeal.nzl-backend.com/api/public/properties/<id> on
2026-09-28, trimmed to the keys the gate reads.
"""
from __future__ import annotations

import json
import sys
import types

_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.goldendeal import run as R  # noqa: E402
from scrapers.maqam import run as MQ  # noqa: E402

UNPUBLISHED_52019 = {"id": 52019, "type": "floor", "purpose": "rent", "category": "residential",
                     "availability_status": "available", "published_on_website": 0,
                     "published_on_app": 0, "updated_at": "2026-09-26T15:54:34.000000Z"}
PUBLISHED_50495 = {"id": 50495, "type": "land", "purpose": "sell", "category": "residential",
                   "availability_status": "available", "published_on_website": 1,
                   "published_on_app": 0, "updated_at": "2026-06-30T08:37:41.000000Z"}


def _session(record):
    class _S:
        def get(self, url, **_kw):
            body = json.dumps({"data": record})
            return types.SimpleNamespace(status_code=200, text=body, url=url, json=lambda: json.loads(body))
    return _S()


def _verdict(tenant, ad_number, record):
    verify = R.verify_gone_for(tenant, canary=lambda: (True, "ok"), session_factory=lambda: _session(record))
    return verify(ad_number)[0]


def test_the_oracle_retires_an_unpublished_item():
    assert _verdict(R.TENANT, "GDL52019", UNPUBLISHED_52019) == "gone"
    assert _verdict(R.TENANT, "GDL50495", PUBLISHED_50495) == "live"


def test_maqam_shares_the_same_gate():
    """maqam (and yameen) import verify_gone_for / map_listing from the goldendeal engine."""
    assert _verdict(MQ.TENANT, "MQM52019", UNPUBLISHED_52019) == "gone"


def test_the_crawl_refuses_it_by_the_same_predicate():
    assert R.map_listing(UNPUBLISHED_52019, R.TENANT)[2] == "unpublished"
    assert MQ.map_listing(UNPUBLISHED_52019)[2] == "unpublished"
