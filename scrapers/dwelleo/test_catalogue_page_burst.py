"""One catalogue page that keeps answering HTTP 500 must not kill the whole dwelleo walk.

2026-09-28..10-02: four nights red in a row, each on a different page (119, 120, 87, 88, 102),
because fetch_catalogue raised on the first page still failing after its retries and threw away a
~4 h walk. Guard: such a page is set aside and retried after the walk; if it still fails the walk is
INCOMPLETE (so the prune stays off), and a source that is really down still raises.
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

import scrapers.dwelleo.run as m  # noqa: E402

m.time.sleep = lambda *_a, **_k: None
PAGES = 40


class _Resp:
    def __init__(self, status, payload=None):
        self.status_code, self._p = status, payload

    def json(self):
        return self._p


class _Session:
    """Page p in `bad` answers 500 `bad[p]` times, then serves; -1 = never serves."""
    def __init__(self, bad):
        self.bad = dict(bad)

    def get(self, _url, params=None, timeout=None):
        p = params["page"]
        left = self.bad.get(p, 0)
        if left:
            self.bad[p] = left - 1 if left > 0 else -1
            return _Resp(500)
        rows = [{"id": p * 100 + i} for i in range(3)]
        return _Resp(200, {"data": {"pagination": {"total": PAGES * 3, "total_pages": PAGES},
                                    "properties": rows}})


# 1. healthy walk: everything, complete
items, total, complete = m.fetch_catalogue(_Session({}))
assert len(items) == PAGES * 3 and total == PAGES * 3 and complete

# 2. a 500 burst on page 17 longer than the in-place retries, but over by the end-of-walk retry:
#    every listing collected and the walk is still complete (this is the nightly failure)
items, _t, complete = m.fetch_catalogue(_Session({17: m._CATALOGUE_ATTEMPTS + 1}))
assert len(items) == PAGES * 3, f"burst page must be recovered, got {len(items)}"
assert complete, "a recovered page leaves the walk complete"

# 3. page 17 never answers: the other 39 pages still land, and the walk is INCOMPLETE (no prune)
items, _t, complete = m.fetch_catalogue(_Session({17: -1}))
assert len(items) == (PAGES - 1) * 3, f"the walk must continue past a dead page, got {len(items)}"
assert not complete, "an unread page must turn the prune off"

# 4. a source that is really down still raises: page 1, a run of pages, or too many pages
for bad, what in (({1: -1}, "page 1"), ({p: -1 for p in range(5, 10)}, "5 in a row"),
                  ({p: -1 for p in range(2, 40, 3)}, ">5% of pages")):
    try:
        m.fetch_catalogue(_Session(bad))
    except RuntimeError:
        pass
    else:
        raise AssertionError(f"{what} failing must still fail the run")

print("ok: a dwelleo catalogue page burst no longer kills the walk; a dead source still fails")
