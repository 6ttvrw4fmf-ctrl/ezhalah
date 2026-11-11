"""The Gathern detail backfill writes its page fields by COMPARE-AND-SWAP over the row's current additional_info
(🆕 2026-11-11, CodeRabbit #11809).

Since 2026-11-11 the backfill also runs right after the crawl (workflow_run), so a sync retry can rewrite a unit's
monthly_price (or fill its bathrooms) while the pass is fetching pages. cas_write_detail() re-reads the row, merges
into what it holds NOW and writes only if additional_info is still exactly that (and bathrooms still empty when it
fills them); otherwise it re-reads and tries again. These tests run it against a fake client that changes the row
between the read and the write — both write orders.

    python -m pytest scrapers/common/tests/test_gathern_backfill_merges_into_current_row.py -q
"""
from __future__ import annotations

import copy
import json

import pytest

run = pytest.importorskip("scrapers.gathern.run")


class _Res:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, db, op, payload=None):
        self.db, self.op, self.payload, self.filters = db, op, payload, []

    def select(self, *_a):
        return self

    def eq(self, col, val):
        self.filters.append(("eq", col, val)); return self

    def is_(self, col, val):
        self.filters.append(("is", col, val)); return self

    def limit(self, _n):
        return self

    def _match(self, row):
        for kind, col, val in self.filters:
            have = row.get(col)
            if kind == "is" and have is not None:
                return False
            if kind == "eq":
                if col == "additional_info":
                    if have != json.loads(val):
                        return False
                elif str(have) != str(val):
                    return False
        return True

    def execute(self):
        row = self.db.row
        if self.op == "select":
            out = _Res([copy.deepcopy(row)])
            self.db.after_read()
            return out
        if self._match(row):
            row.update(copy.deepcopy(self.payload)); self.db.writes += 1
            return _Res([row])
        return _Res([])


class _DB:
    def __init__(self, row, concurrent=None):
        self.row, self.concurrent, self.reads, self.writes = row, concurrent, 0, 0

    def after_read(self):
        self.reads += 1
        if self.concurrent and self.reads == 1:
            self.concurrent(self.row)          # a sync writes between our read and our write

    def table(self, _t):
        db = self
        class T:
            def select(self, *_a): return _Q(db, "select")
            def update(self, payload): return _Q(db, "update", payload)
        return T()


DETAIL = {"house_rules": ["لا حفلات"], "check_in": "03:00 مساءً",
          "extra_sections": [{"header": "دورات المياة", "content": "2 دورات المياة"}]}


def test_a_sync_price_written_mid_pass_is_kept():
    def sync(row): row["additional_info"] = {**row["additional_info"], "monthly_price": 3500}
    db = _DB({"ad_number": "G1", "additional_info": {"monthly_price": 3000}, "bathrooms": None}, sync)
    assert run.cas_write_detail(db, "G1", DETAIL, None) is True
    assert db.row["additional_info"]["monthly_price"] == 3500, "the stale 3000 came back"
    assert db.row["additional_info"]["house_rules"] == ["لا حفلات"] and db.reads == 2


def test_a_bathroom_count_the_sync_filled_is_not_overwritten():
    def sync(row): row["bathrooms"] = 4
    db = _DB({"ad_number": "G2", "additional_info": {"monthly_price": 3000}, "bathrooms": None}, sync)
    assert run.cas_write_detail(db, "G2", DETAIL, None) is True
    assert db.row["bathrooms"] == 4


def test_an_unchanged_row_is_written_once():
    db = _DB({"ad_number": "G3", "additional_info": None, "bathrooms": None})
    assert run.cas_write_detail(db, "G3", DETAIL, "وصف") is True
    assert db.row["bathrooms"] == 2, "the page's own count fills an empty bathroom column"
    assert db.writes == 1 and db.row["description"] == "وصف" and db.row["additional_info"]["check_in"]


def test_a_row_that_keeps_changing_gives_up_without_writing_stale_values():
    db = _DB({"ad_number": "G4", "additional_info": {"monthly_price": 1}, "bathrooms": None})
    def always(row): row["additional_info"] = {"monthly_price": row["additional_info"]["monthly_price"] + 1}
    db.after_read = lambda: always(db.row)
    assert run.cas_write_detail(db, "G4", DETAIL, None) is False
    assert "house_rules" not in db.row["additional_info"]


def test_a_failed_re_read_writes_nothing():
    class Boom:
        def table(self, _t):
            class T:
                def select(self, *_a): raise RuntimeError("timeout")
            return T()
    assert run.cas_write_detail(Boom(), "G5", DETAIL, None) is None


def test_the_merge_keeps_current_keys():
    out = run.merge_detail_into_current({"monthly_price": 3500, "unit_code": "X1"}, {"rating": 9.1})
    assert out == {"monthly_price": 3500, "unit_code": "X1", "rating": 9.1}
    assert run.merge_detail_into_current(None, {"rating": 9.1}) == {"rating": 9.1}
