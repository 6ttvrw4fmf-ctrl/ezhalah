"""A catalogue walk that fails must close a FAILED run row, never crash with no row at all.

2026-10-03: page 1 of the macsaib API timed out (curl 28, 40 s). walk() ran before begin_run(), so
the job died with no scrape_runs row and the ledger kept showing the previous night's success: a
failed fetch read as health. This executes main() against a stub db and a walk that raises, and
asserts a run was opened and closed ok=False with the error in its notes.
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
CALLS: list = []
_db = types.ModuleType("scrapers.common.db")
_db.begin_run = lambda slug: CALLS.append(("begin", slug)) or 4242
_db.end_run = lambda run_id, **k: CALLS.append(("end", run_id, k)) or True
sys.modules["scrapers.common.db"] = _db

import scrapers.macsaib.run as m  # noqa: E402

m.db = _db


def _boom(*a, **k):
    raise TimeoutError("curl: (28) Connection timed out after 40002 milliseconds")


m.walk = _boom
sys.argv = ["run"]
try:
    m.main()
    raise AssertionError("main() swallowed a failed walk")
except TimeoutError:
    pass

assert ("begin", m.SLUG) in CALLS, f"no run opened before the walk: {CALLS}"
ends = [c for c in CALLS if c[0] == "end"]
assert len(ends) == 1 and ends[0][1] == 4242, f"run not closed exactly once: {CALLS}"
assert ends[0][2].get("ok") is False, f"failed walk not recorded as failed: {ends[0]}"
assert "timed out" in (ends[0][2].get("notes") or ""), f"error missing from notes: {ends[0]}"
print("ok: a failed macsaib walk closes its run ok=False")
