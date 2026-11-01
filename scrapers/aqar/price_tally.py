"""The price-regression check, done on the rows THIS run wrote, with the source's own answer kept.

mon_check_run_field_ranges' check (a) asks "did this run's slice come back with far more null prices
than the table normally has?" over every row of the table touched since the run began. For aqar that
question is unanswerable: 95 per-city jobs write aqar_residential_listings at the same moment, so a
run is judged on its neighbours' rows (Duba's 2-row run on 2026-10-02 was judged on 103 rows, 101 of
them Al Baha's), and a NULL the source itself published («طلب تسويق», AUTHORITATIVE_NULL) counts
exactly like a price we failed to read. 159 aqar_residential runs went red that way in 14 days; the 13
Al Baha rents behind the 2026-10-02 trip were all AUTHORITATIVE_NULL — correct data, red run.

The scraper knows both facts the database cannot see: which rows are its own, and, per row, whether a
missing price is the source speaking or a read that failed. So the check runs here, exactly:

    a run is degraded when, for Rent or for Buy separately, at least MIN_ROWS of ITS OWN rows were
    written and more than MAX_UNREAD_FRAC of them carry a price we could not read.

A source-published «no price» never counts. A failed read always does. The database check is then
told to skip only its windowed price comparison (p_skip_price_null); its zero-tolerance checks
(missing key fields, placeholder locations, tiny claimed rents) still run on every aqar run.
"""
from __future__ import annotations

import threading
from typing import Any

from scrapers.common import db

MIN_ROWS = 20            # same floor the database check uses before it judges a ratio
MAX_UNREAD_FRAC = 0.25   # same margin the database check allows over its baseline

_PRICE_FIELD = {"Rent": "price_annual", "Buy": "price_total"}


class PriceTally:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.n = {"Rent": 0, "Buy": 0}
        self.unread = {"Rent": 0, "Buy": 0}
        self.source_none = {"Rent": 0, "Buy": 0}

    @staticmethod
    def classify(row: dict[str, Any]) -> tuple[str, str] | None:
        """(deal, 'priced' | 'source_none' | 'unread') for a row about to be written, or None."""
        deal = row.get("transaction_type")
        field = _PRICE_FIELD.get(deal)
        if field is None:
            return None
        v = row.get(field)
        if v is db.AUTHORITATIVE_NULL:
            return deal, "source_none"
        if v is None:
            return deal, "unread"
        return deal, "priced"

    def add(self, kind: tuple[str, str] | None) -> None:
        """Count one row that was actually written (call after a successful upsert)."""
        if kind is None:
            return
        deal, what = kind
        with self._lock:
            self.n[deal] += 1
            if what == "unread":
                self.unread[deal] += 1
            elif what == "source_none":
                self.source_none[deal] += 1

    def problems(self) -> list[str]:
        out = []
        for deal in ("Rent", "Buy"):
            n, u = self.n[deal], self.unread[deal]
            if n >= MIN_ROWS and u / n > MAX_UNREAD_FRAC:
                out.append(f"{deal.lower()}_price_unread {u}/{n}")
        return out

    def notes(self) -> str:
        return " ".join(f"{d.lower()}: {self.n[d]} written, {self.unread[d]} price unread, "
                        f"{self.source_none[d]} source says none;" for d in ("Rent", "Buy") if self.n[d])
