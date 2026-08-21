"""A 0-row scrape is only healthy when the SOURCE proved the emptiness.

WHY THIS EXISTS (2026-08-21). `Aqar residential sweep` was red on 100% of its runs for 10+ days.
One of its 95 city jobs — `badr` — returns zero listings because badr genuinely has no aqar.fm
inventory, and end_run()'s RC-B guard demotes any 0-row run. A workflow that is red on every run
cannot report a NEW failure, and no detector covered it.

The remedy must NOT weaken RC-B, which is what catches a blocked crawl / consent shell / exhausted
proxy. So it DISTINGUISHES instead, per the 2026-08-13 owner rule (absence != omission):

    0 rows + source rendered its own empty state on HTTP 200  -> healthy (allow_empty)
    0 rows + blocked / non-200 / no empty state on the page   -> unhealthy (RC-B demotes)

Both directions are proven below. The negative direction is the one that matters: if these tests
can be made to pass while a BLOCKED slice is reported healthy, the guard is worthless.

    python -m pytest scrapers/common/tests/test_source_published_emptiness.py -v
"""

from scrapers.common.emptiness import (
    SliceOutcome,
    emptiness_is_source_published,
    run_may_allow_empty,
    source_rendered_empty_state,
)

# ── Real shapes, measured against sa.aqar.fm on 2026-08-21 ───────────────────────────────────────
# Every aqar page ships its i18n dictionary, and that dictionary CONTAINS the empty-state string as
# a value. Measured: riyadh (25 listings) had 1 occurrence, all of it the dictionary entry; badr
# (0 listings) had 2, one of which was the rendered empty state. A naive substring check is
# therefore true on a page full of results — the exact false-green this guard exists to prevent.
I18N_DICT_FRAGMENT = r'{\"reset_filters\":\"إعادة ضبط البحث\",\"not_found\":\"لا توجد نتائج\",\"go_home\":\"الصفحة الرئيسية\"}'
PAGE_WITH_RESULTS = '<html><body>' + I18N_DICT_FRAGMENT + '<a href="/شقق-للإيجار/الرياض-123456">ad</a></body></html>'
PAGE_EMPTY_STATE = ('<html><body>' + I18N_DICT_FRAGMENT +
                    '<img src="https://assets.aqar.fm/icons/v2/search.svg"/> لا توجد نتائج '
                    '<p>جرّب إزالة بعض الفلاتر أو تصفّح كل الفئات</p></body></html>')
PAGE_BLOCKED_SHELL = '<html><body>' + I18N_DICT_FRAGMENT + '<div id="app"></div></body></html>'


# ── A. the marker itself ─────────────────────────────────────────────────────────────────────────

def test_i18n_dictionary_alone_is_not_an_empty_state():
    """THE TRAP: the string is in the dictionary on every page, results or not."""
    assert source_rendered_empty_state(PAGE_WITH_RESULTS) is False


def test_rendered_empty_state_is_detected():
    assert source_rendered_empty_state(PAGE_EMPTY_STATE) is True


def test_soft_shell_without_the_empty_state_is_not_empty():
    """A page that rendered nothing at all is NOT proof the source is empty."""
    assert source_rendered_empty_state(PAGE_BLOCKED_SHELL) is False


def test_blank_body_is_not_empty_state():
    assert source_rendered_empty_state('') is False


# ── B. the per-slice decision — POSITIVE direction ───────────────────────────────────────────────

def test_genuinely_empty_slice_is_source_published():
    o = SliceOutcome()
    o.note_page(PAGE_EMPTY_STATE, new_listings=0)
    assert emptiness_is_source_published(o) is True


# ── C. the per-slice decision — NEGATIVE directions (the ones that protect us) ───────────────────

def test_blocked_fetch_is_never_source_published():
    """429-exhausted / non-200 -> http.get returns None. We do not know what the source holds."""
    o = SliceOutcome()
    o.note_fetch_failure()
    assert emptiness_is_source_published(o) is False


def test_fetch_failure_after_a_good_page_still_blocks_the_claim():
    o = SliceOutcome()
    o.note_page(PAGE_EMPTY_STATE, new_listings=0)
    o.note_fetch_failure()
    assert emptiness_is_source_published(o) is False


def test_page_rendered_but_no_empty_state_is_not_source_published():
    """The silent-death shape: a 200 that rendered no ads AND no empty state."""
    o = SliceOutcome()
    o.note_page(PAGE_BLOCKED_SHELL, new_listings=0)
    assert emptiness_is_source_published(o) is False


def test_never_fetched_is_not_source_published():
    assert emptiness_is_source_published(SliceOutcome()) is False


def test_slice_with_listings_is_not_empty():
    o = SliceOutcome()
    o.note_page(PAGE_WITH_RESULTS, new_listings=25)
    assert emptiness_is_source_published(o) is False


# ── D. the run-level decision ────────────────────────────────────────────────────────────────────

def _empty_slice() -> SliceOutcome:
    o = SliceOutcome()
    o.note_page(PAGE_EMPTY_STATE, new_listings=0)
    return o


def test_all_slices_proven_empty_allows_empty():
    """badr: every slice fetched fine and every one said «لا توجد نتائج»."""
    assert run_may_allow_empty([_empty_slice() for _ in range(12)]) is True


def test_one_blocked_slice_keeps_the_whole_run_red():
    """A PARTIAL block is exactly the silent-death case RC-B exists for."""
    blocked = SliceOutcome()
    blocked.note_fetch_failure()
    assert run_may_allow_empty([_empty_slice(), _empty_slice(), blocked]) is False


def test_one_unproven_slice_keeps_the_whole_run_red():
    unproven = SliceOutcome()
    unproven.note_page(PAGE_BLOCKED_SHELL, new_listings=0)
    assert run_may_allow_empty([_empty_slice(), unproven]) is False


def test_no_slices_at_all_is_not_allowed():
    """A run that discovered nothing to even try must not claim healthy emptiness."""
    assert run_may_allow_empty([]) is False


def test_run_that_found_rows_does_not_use_allow_empty():
    found = SliceOutcome()
    found.note_page(PAGE_WITH_RESULTS, new_listings=25)
    assert run_may_allow_empty([found, _empty_slice()]) is False


# ── E. MUTATION PROOF — the pre-fix behaviour must be visibly wrong here ─────────────────────────

def test_mutation_naive_substring_check_would_pass_a_page_full_of_results():
    """The obvious implementation is the broken one, and this pins the difference.

    If someone 'simplifies' source_rendered_empty_state() to a substring test, a page with 25 ads
    starts reporting an empty state, and every 0-row run — including a blocked one whose shell
    happens to ship the dictionary — gets waved through as healthy.
    """
    naive = 'لا توجد نتائج' in PAGE_WITH_RESULTS
    assert naive is True, 'the dictionary really is present on a results page'
    assert source_rendered_empty_state(PAGE_WITH_RESULTS) is False, 'the real check must reject it'


def test_mutation_dropping_the_fetch_failure_guard_would_green_a_blocked_run():
    """Pins WHY fetch_failed is consulted: without it, a block reads as source-published emptiness."""
    blocked = SliceOutcome()
    blocked.note_page(PAGE_EMPTY_STATE, new_listings=0)
    blocked.note_fetch_failure()
    without_guard = (blocked.pages_fetched > 0 and blocked.listings_found == 0
                     and blocked.source_empty_state)
    assert without_guard is True, 'the pre-fix logic would call this genuinely empty'
    assert emptiness_is_source_published(blocked) is False, 'the real check must keep it red'
