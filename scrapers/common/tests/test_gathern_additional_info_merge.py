"""Regression guard for the additional_info-wipe bug (2026-07-25, sibling of the description wipe).

The Gathern LIST crawl rebuilds additional_info from scratch and upserts full rows
(on_conflict=ad_number), which replaces the whole JSONB column. The Tier-2 `--backfill-details` pass
writes its detail-page fields (suitability, house_rules, check_in/out, guest_capacity, booking/views,
rate_text, extra_sections) into that SAME column — so without a merge, every re-crawl wipes them
(same failure mode as the description column). _carry_forward_ai() carries those keys forward from the
stored row while keeping the crawl's own values authoritative.

    python -m pytest scrapers/common/tests/test_gathern_additional_info_merge.py -q
"""
from __future__ import annotations

import sys
import types

# Hermetic import: stub supabase + dotenv so importing scrapers.common.db never needs credentials.
# The function under test is pure and never calls sb().
_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.common.db import _carry_forward_ai, _GATHERN_DETAIL_AI_KEYS  # noqa: E402


def test_detail_keys_preserved_and_crawl_values_stay_fresh():
    # A fresh crawl row: crawl-owned keys only, no detail fields (the list feed has none).
    rows = [{
        "ad_number": "GTH1",
        "additional_info": {"monthly_price": 5000, "amenities": ["تلفزيون"], "discount_label": "خصم 18%"},
    }]
    # The stored row: backfilled detail fields + a STALE crawl value that must NOT win.
    stored = {"GTH1": {
        "monthly_price": 4000,                       # stale — crawl's 5000 must survive
        "suitability": "عوائل و عزاب",
        "house_rules": ["ممنوع الحفلات"],
        "check_in": "03:00 مساءً",
        "guest_capacity": 4,
        "extra_sections": [{"header": "h", "content": "c"}],
    }}
    _carry_forward_ai(rows, stored, _GATHERN_DETAIL_AI_KEYS)
    ai = rows[0]["additional_info"]

    # backfill-owned keys survive the crawl
    assert ai["suitability"] == "عوائل و عزاب"
    assert ai["house_rules"] == ["ممنوع الحفلات"]
    assert ai["check_in"] == "03:00 مساءً"
    assert ai["guest_capacity"] == 4
    assert ai["extra_sections"] == [{"header": "h", "content": "c"}]
    # crawl-owned keys stay authoritative (fresh 5000, not the stale stored 4000)
    assert ai["monthly_price"] == 5000
    assert ai["amenities"] == ["تلفزيون"]
    assert ai["discount_label"] == "خصم 18%"


def test_noop_when_row_is_new_or_stored_blank():
    rows = [{"ad_number": "GTH2", "additional_info": {"monthly_price": 100}}]
    _carry_forward_ai(rows, {}, _GATHERN_DETAIL_AI_KEYS)            # unseen ad_number → untouched
    assert rows[0]["additional_info"] == {"monthly_price": 100}
    _carry_forward_ai(rows, {"GTH2": {}}, _GATHERN_DETAIL_AI_KEYS)  # stored has no detail keys → untouched
    assert rows[0]["additional_info"] == {"monthly_price": 100}


if __name__ == "__main__":
    test_detail_keys_preserved_and_crawl_values_stay_fresh()
    test_noop_when_row_is_new_or_stored_blank()
    print("ok")
