"""The aqar residential sweep must only request category pages aqar actually serves.

WHY THIS EXISTS (2026-09-28, Scraping Engineer). `Aqar residential sweep` had been red on EVERY run
for 17+ days (40 of 40 runs, 2026-09-11 → 2026-09-28). About half of the red city jobs were 0-row
towns (badr, rumah, al_ghat, duba …) that emptiness.py is supposed to let through: every slice
rendered aqar's own «لا توجد نتائج» except ONE — `CHALET BUY` — which logged

    (0 listings) NOT proven empty (fetch_failed=True, pages_fetched=0, empty_state=False)

in EVERY city of EVERY run, including riyadh, jeddah, tabuk, al_ula and thuwal on run
36362559938, while the 16 other slices of the same job fetched fine on the same pinned session.
http.get() printed no block/transient warning for it, i.e. it took the silent permanent-4xx path:
aqar has no «شاليه-للبيع» category page (aqar_residential_listings has never held one Chalet/Buy
row; its 63 chalets are all «شاليه-للإيجار»). A page that does not exist can never prove it is
empty, so run_may_allow_empty() was False for every 0-row town, for ever, and RC-B demoted it.

The remedy is to stop requesting the page, not to loosen emptiness: a genuinely blocked slice must
still keep the run red (test_source_published_emptiness.py proves that direction).

    python -m pytest scrapers/common/tests/test_aqar_sweep_requests_only_pages_aqar_serves.py -v
"""
from __future__ import annotations

import sys
import types
from urllib.parse import unquote

# ── Stub supabase + dotenv so the import chain stays hermetic (same as test_aqar_ppm_parse) ─────
_supabase_mod = types.ModuleType("supabase")


class _StubClient:
    pass


_supabase_mod.Client = _StubClient
_supabase_mod.create_client = lambda url, key: _StubClient()
sys.modules.setdefault("supabase", _supabase_mod)

_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

import scrapers.aqar.discover as D  # noqa: E402
from scrapers.common.emptiness import SliceOutcome, run_may_allow_empty  # noqa: E402

# Category slugs aqar answers with a non-200 (measured from CI, see module docstring).
NOT_SERVED_BY_AQAR = {"شاليه-للبيع"}

# aqar's real empty-state page shape (same fixture as test_source_published_emptiness.py).
_I18N = r'{\"not_found\":\"لا توجد نتائج\"}'
PAGE_EMPTY_STATE = ('<html><body>' + _I18N +
                    '<img src="https://assets.aqar.fm/icons/v2/search.svg"/> لا توجد نتائج '
                    '<p>جرّب إزالة بعض الفلاتر أو تصفّح كل الفئات</p></body></html>')


class _Resp:
    status_code = 200
    text = PAGE_EMPTY_STATE


def _fake_get(url, *a, **k):
    slug = unquote(url[len(D.BASE):]).strip("/").split("/")[0]
    return None if slug in NOT_SERVED_BY_AQAR else _Resp()


def _residential_sweep_slices():
    """The exact (type, deal) set run_residential.py's --all-residential loop requests."""
    return [(t, d) for t in D.RESIDENTIAL_TYPES for d in ("rent", "buy") if (t, d) in D.CATEGORIES]


def test_sweep_never_requests_a_category_aqar_does_not_serve():
    requested = {D.CATEGORIES[s] for s in _residential_sweep_slices()}
    assert not (requested & NOT_SERVED_BY_AQAR), requested & NOT_SERVED_BY_AQAR


def test_empty_town_is_provably_empty_across_the_whole_sweep(monkeypatch):
    """badr-shaped town: every served page renders aqar's own empty state -> run may be healthy."""
    monkeypatch.setattr(D, "get", _fake_get)
    outcomes = []
    for t, d in _residential_sweep_slices():
        o = SliceOutcome()
        assert list(D.discover(t, d, "badr", max_pages=3, outcome=o)) == []
        outcomes.append(o)
    assert run_may_allow_empty(outcomes) is True


def test_a_real_block_on_a_served_page_still_keeps_the_run_red(monkeypatch):
    """The fix must not loosen RC-B: one blocked served slice still fails the run."""
    monkeypatch.setattr(D, "get", lambda url, *a, **k: None if "فلل-للإيجار" in unquote(url) else _Resp())
    outcomes = []
    for t, d in _residential_sweep_slices():
        o = SliceOutcome()
        list(D.discover(t, d, "badr", max_pages=3, outcome=o))
        outcomes.append(o)
    assert run_may_allow_empty(outcomes) is False
