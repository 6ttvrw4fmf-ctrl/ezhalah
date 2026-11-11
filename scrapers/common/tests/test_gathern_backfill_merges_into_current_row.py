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


@pytest.mark.parametrize("current", [None, [], "invalid JSON shape", 0, False])
def test_non_object_current_info_does_not_leak_into_details(current):
    assert run.merge_detail_into_current(current, {"reviews_count": 0}) == {"reviews_count": 0}


def test_merge_overwrites_detail_fields_without_mutating_either_input():
    from copy import deepcopy

    current = {"monthly_price": 3500, "rating": 8, "house_rules": ["old"]}
    detail = {"rating": 0, "house_rules": [], "check_in": None}
    before_current, before_detail = deepcopy(current), deepcopy(detail)
    result = run.merge_detail_into_current(current, detail)
    assert result == {"monthly_price": 3500, **detail}
    assert result is not current and result is not detail
    assert current == before_current
    assert detail == before_detail


def test_empty_details_preserve_current_fields_in_a_new_mapping():
    current = {"monthly_price": 3500, "amenities": ["مصعد"]}
    result = run.merge_detail_into_current(current, {})
    assert result == current
    assert result is not current


@pytest.fixture
def backfill_io(monkeypatch):
    """Separate query objects keep worklist reads, fresh reads and writes observable."""
    from types import SimpleNamespace
    from unittest.mock import MagicMock

    client = MagicMock()
    monkeypatch.setattr(run.db, "sb", lambda: client)
    fetch = MagicMock()
    monkeypatch.setattr(run, "fetch_detail", fetch)

    def configure(current_response, detail=None, *, read_error=None, write_error=None):
        snapshot = {"monthly_price": 3000, "snapshot_only": True}
        row = {"ad_number": "GTH123", "listing_url": "https://gathern.co/unit/123",
               "additional_info": snapshot, "bathrooms": 2}
        worklist, reread, write = MagicMock(), MagicMock(), MagicMock()
        worklist.select.return_value.eq.return_value.eq.return_value.or_.return_value.order.return_value.order.return_value.range.return_value.execute.return_value = SimpleNamespace(data=[row])
        read_execute = reread.select.return_value.eq.return_value.limit.return_value.execute
        read_execute.return_value = current_response
        read_execute.side_effect = read_error
        write.update.return_value.eq.return_value.execute.side_effect = write_error
        client.table.side_effect = [worklist, reread, write]
        fetch.return_value = detail if detail is not None else {"house_rules": ["لا حفلات"], "description": "وصف الوحدة"}
        return SimpleNamespace(client=client, fetch=fetch, row=row, worklist=worklist,
                               reread=reread, write=write)

    return configure


def test_backfill_merges_fetched_details_with_fresh_row(backfill_io):
    from types import SimpleNamespace

    current = {"monthly_price": 3500, "unit_code": "X1", "house_rules": ["old"]}
    io = backfill_io(SimpleNamespace(data=[{"additional_info": current}]))
    session = object()
    assert run.backfill_details(session) == (1, 1)
    io.fetch.assert_called_once_with(session, io.row["listing_url"])
    io.reread.select.assert_called_once_with("additional_info")
    io.reread.select.return_value.eq.assert_called_once_with("ad_number", "GTH123")
    io.reread.select.return_value.eq.return_value.limit.assert_called_once_with(1)
    io.write.update.assert_called_once_with({
        "additional_info": {"monthly_price": 3500, "unit_code": "X1", "house_rules": ["لا حفلات"]},
        "description": "وصف الوحدة",
    })
    io.write.update.return_value.eq.assert_called_once_with("ad_number", "GTH123")
    assert current["house_rules"] == ["old"]
    assert io.row["additional_info"] == {"monthly_price": 3000, "snapshot_only": True}


@pytest.mark.parametrize("response", [None, [], "null-data", "empty-data"])
def test_unavailable_current_row_never_writes_the_snapshot(backfill_io, response):
    from types import SimpleNamespace

    if response == "null-data":
        response = SimpleNamespace(data=None)
    elif response == "empty-data":
        response = SimpleNamespace(data=[])
    io = backfill_io(response)
    assert run.backfill_details(object()) == (1, 0)
    io.write.update.assert_not_called()
    assert io.client.table.call_count == 2


def test_reread_exception_skips_write(backfill_io):
    io = backfill_io(None, read_error=RuntimeError("read unavailable"))
    assert run.backfill_details(object()) == (1, 0)
    io.write.update.assert_not_called()
    assert io.client.table.call_count == 2


@pytest.mark.parametrize("info", [None, [], "malformed", {}])
@pytest.mark.parametrize("description", [None, "", "وصف جديد"])
def test_backfill_handles_empty_current_info_and_optional_description(backfill_io, info, description):
    from types import SimpleNamespace

    detail = {"description": description, "reviews_count": 0}
    io = backfill_io(SimpleNamespace(data=[{"additional_info": info}]), detail)
    assert run.backfill_details(object()) == (1, 1)
    expected = {"additional_info": {"reviews_count": 0}}
    if description:
        expected["description"] = description
    io.write.update.assert_called_once_with(expected)


def test_empty_detail_does_not_reread_or_write(backfill_io):
    io = backfill_io(None, {})
    assert run.backfill_details(object()) == (1, 0)
    assert io.client.table.call_count == 1
    io.reread.select.assert_not_called()
    io.write.update.assert_not_called()


def test_update_failure_is_not_counted_as_success(backfill_io):
    from types import SimpleNamespace

    io = backfill_io(SimpleNamespace(data=[{"additional_info": {"monthly_price": 3500}}]),
                     write_error=RuntimeError("write unavailable"))
    assert run.backfill_details(object()) == (1, 0)
    io.write.update.assert_called_once()


@pytest.mark.parametrize("failure", ["read-error", "missing-row", "write-error"])
def test_failed_row_does_not_block_the_next_listing(backfill_io, failure):
    from types import SimpleNamespace

    fresh = SimpleNamespace(data=[{"additional_info": {"monthly_price": 3500}}])
    io = backfill_io(fresh)
    second_row = {**io.row, "ad_number": "GTH456", "listing_url": "https://gathern.co/unit/456"}
    io.worklist.select.return_value.eq.return_value.eq.return_value.or_.return_value.order.return_value.order.return_value.range.return_value.execute.return_value = SimpleNamespace(data=[io.row, second_row])
    read_execute = io.reread.select.return_value.eq.return_value.limit.return_value.execute
    if failure == "write-error":
        io.client.table.side_effect = [io.worklist, io.reread, io.write, io.reread, io.write]
        io.write.update.return_value.eq.return_value.execute.side_effect = [RuntimeError("write failed"), None]
    else:
        io.client.table.side_effect = [io.worklist, io.reread, io.reread, io.write]
        failed_read = RuntimeError("read failed") if failure == "read-error" else SimpleNamespace(data=[])
        read_execute.side_effect = [failed_read, fresh]
    # fetch_detail returns a fresh mapping for each unit; the production function pops description.
    io.fetch.side_effect = [{"description": "first", "rating": 8}, {"description": "second", "rating": 9}]
    assert run.backfill_details(object()) == (2, 1)
    assert io.fetch.call_count == 2
    assert read_execute.call_count == 2
    assert io.write.update.call_args.args[0] == {
        "additional_info": {"monthly_price": 3500, "rating": 9}, "description": "second",
    }
    io.write.update.return_value.eq.assert_called_with("ad_number", "GTH456")
