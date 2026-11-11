"""The Gathern detail backfill writes its page fields over the row's CURRENT additional_info (🆕 2026-11-11).

Since 2026-11-11 the backfill also runs right after the crawl (workflow_run), so a sync retry can rewrite a unit's
monthly_price while the pass is fetching pages. Merging into the worklist snapshot read at the start would put the
OLD price back (CodeRabbit #11809). backfill_details() re-reads the row right before each write and merges with
merge_detail_into_current(); a failed re-read skips the row.

    python -m pytest scrapers/common/tests/test_gathern_backfill_merges_into_current_row.py -q
"""
from __future__ import annotations

import inspect
import re

import pytest

run = pytest.importorskip("scrapers.gathern.run")


def test_current_crawl_values_win_over_the_old_snapshot():
    snapshot = {"monthly_price": 3000, "district_ar": "حي الملقا"}
    current = {"monthly_price": 3500, "district_ar": "حي الملقا", "unit_code": "X1"}
    detail = {"house_rules": ["لا حفلات"], "check_in": "03:00 مساءً"}
    out = run.merge_detail_into_current(current, detail)
    assert out["monthly_price"] == 3500 and out["unit_code"] == "X1"
    assert out["house_rules"] == ["لا حفلات"] and out["check_in"] == "03:00 مساءً"
    assert run.merge_detail_into_current(snapshot, detail)["monthly_price"] == 3000  # the helper is pure


def test_a_missing_current_info_starts_empty():
    assert run.merge_detail_into_current(None, {"rating": 9.1}) == {"rating": 9.1}
    assert run.merge_detail_into_current([], {"rating": 9.1}) == {"rating": 9.1}


def test_the_backfill_reads_the_row_again_before_writing():
    src = inspect.getsource(run.backfill_details)
    reread = src.find('.select("additional_info")')
    write = src.find(".update(payload)")
    assert 0 < reread < write, "the backfill must re-read additional_info right before it writes"
    assert "merge_detail_into_current(rows[0].get(\"additional_info\"), d)" in src
    assert not re.search(r'info\s*=\s*r\.get\("additional_info"\)', src), "the worklist snapshot is never the merge base"
