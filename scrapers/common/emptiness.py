"""Distinguish "the SOURCE published nothing" from "we could not see it".

WHY THIS EXISTS (2026-08-21). `Aqar residential sweep` was RED on 100% of its runs for 10+ days.
Of its 95 city jobs exactly one failed — `badr` — because badr genuinely has zero aqar.fm inventory
in the swept slices, and end_run()'s RC-B guard demotes any 0-row run to ok=False. The workflow was
therefore red on every single run, which is worse than useless: a check that is always red can no
longer signal a NEW aqar failure. Nothing in the roster covered it either (the open
`scraper_failure_step_change` is wasalt-only), so it just sat there.

The fix is NOT to weaken RC-B. RC-B is the guard that catches a blocked crawl, a served consent
shell, or an exhausted proxy — the alnokhba/souq24 "green for days while returning nothing" failure.
`end_run(allow_empty=True)` is its sanctioned opt-out (gathern's commercial no-op already uses it),
and the correct fix is to let a caller assert emptiness ONLY when it can PROVE the source published
that emptiness itself. So:

    0 rows + the source rendered its OWN empty state on HTTP 200   -> legitimately empty (healthy)
    0 rows + a failed/blocked fetch, or no empty state on the page -> unhealthy (RC-B demotes)

This is the 2026-08-13 owner rule applied literally: absence is NOT evidence of omission, so never
silence a barrier — make it DISTINGUISH the cases, and prove both directions.

THE SUBTLETY THAT MAKES THIS NON-OBVIOUS. aqar.fm ships its i18n dictionary inside every page, and
that dictionary contains the empty-state string as a VALUE (`"not_found":"لا توجد نتائج"`). So a
naive `'لا توجد نتائج' in html` is true on a page FULL of results, and would have declared every
0-row run "source-published empty" — the exact false-green this file exists to prevent. Measured
2026-08-21 against the live site:

    riyadh (25 listings):  1 occurrence, 1 of them the i18n dict entry -> 0 visible
    badr   (0 listings):   2 occurrences, 1 of them the i18n dict entry -> 1 visible

So the signal is an occurrence OUTSIDE the dictionary entry, not the raw substring.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable

# aqar.fm's own empty-state copy, rendered next to its search icon:
#   «لا توجد نتائج / جرّب إزالة بعض الفلاتر أو تصفّح كل الفئات»
EMPTY_STATE_AR = "لا توجد نتائج"

# The same string as a JSON i18n VALUE — present on every page, results or not. Matches both raw
# (`"not_found":"لا توجد نتائج"`) and backslash-escaped (`\"not_found\":\"لا توجد نتائج`) forms,
# because the dictionary is embedded inside a JSON string in the served HTML.
_I18N_DICT_ENTRY = re.compile(r'\\?"\s*:\s*\\?"' + re.escape(EMPTY_STATE_AR))


def source_rendered_empty_state(html: str) -> bool:
    """True only when the page RENDERS the source's own empty state.

    Occurrences that are just the i18n dictionary entry do not count — they are present on every
    page including ones full of results.
    """
    if not html:
        return False
    total = html.count(EMPTY_STATE_AR)
    dict_entries = len(_I18N_DICT_ENTRY.findall(html))
    return (total - dict_entries) > 0


@dataclass
class SliceOutcome:
    """What actually happened while discovering one (type × deal × city) slice."""

    pages_fetched: int = 0
    #: any page whose fetch returned None — http.get() only returns a response on HTTP 200, so this
    #: means a non-200 or a 429 that survived every retry: blocked, not empty.
    fetch_failed: bool = False
    listings_found: int = 0
    #: the last page we actually fetched rendered the source's own empty state.
    source_empty_state: bool = False

    def note_page(self, html: str, new_listings: int) -> None:
        self.pages_fetched += 1
        self.listings_found += new_listings
        # Only meaningful for a page that yielded nothing; a page with results is never "empty".
        self.source_empty_state = new_listings == 0 and source_rendered_empty_state(html)

    def note_fetch_failure(self) -> None:
        self.fetch_failed = True


def emptiness_is_source_published(o: SliceOutcome) -> bool:
    """Did the SOURCE tell us this slice is empty, rather than us failing to see it?"""
    if o.fetch_failed:
        return False          # blocked / non-200 — we do not know what the source holds
    if o.pages_fetched == 0:
        return False          # we never even looked
    if o.listings_found > 0:
        return False          # not an empty slice at all
    return o.source_empty_state


def run_may_allow_empty(outcomes: Iterable[SliceOutcome]) -> bool:
    """Whether a 0-row RUN may legitimately assert allow_empty to end_run().

    Deliberately strict: EVERY slice must have proven its own emptiness. One blocked slice anywhere
    keeps the whole run unhealthy, because a partial block is exactly the silent-death case RC-B is
    there to catch.
    """
    outcomes = list(outcomes)
    if not outcomes:
        return False
    if any(o.listings_found > 0 for o in outcomes):
        return False          # the run found rows; allow_empty is not in play
    return all(emptiness_is_source_published(o) for o in outcomes)
