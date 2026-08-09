"""SOURCE IS TRUTH — the fleet-wide, build-failing guard for the owner's permanent rule.

    "SOURCE → SCRAPER → BACKEND → SEARCH → FILTER. The value must stay faithful to what the source
     actually publishes… If the source says YES save YES, if it says NO save NO, if it does not say
     save UNKNOWN/NULL. Never turn unknown into NO. Never guess. Never take a price from the
     description. Never calculate a price because another number exists. Never multiply/divide by
     12, 365, 1000, area, or price-per-m² to manufacture a total. Never default rent to annual when
     the source doesn't prove annual. Never overwrite a known source-backed value with a weaker or
     uncertain value… A failed/partial scrape must fail safely."
    — owner, 2026-08-09, permanent, ALL platforms

Every test below is ADVERSARIAL: it reintroduces a real bug we have shipped at least once and
asserts the fleet rejects it. If one of these fails, someone has re-broken a rule that has already
cost us production data — do not "fix" the test.

The bug classes, each with the live incident that earned it a test:
  • monthly ↔ annual     — souq24 stored «5,000 شهري» as annual (12× understatement); aqar's
                           `rent_period = "annual"` default did the same to enum-2 monthly listings.
  • total ↔ per-m²       — «سعر المتر 5,000» stored as the whole asking price.
  • description numbers  — «الدخل السنوي 67,500» became the price of a 3,700,000 listing (47 rows).
  • manufactured totals  — dealapp ×365 turned 350/day into 21,900,000; eaqartabuk ×1000.
  • unknown → NO         — 469 amenity columns carried DEFAULT false; aqar claimed parking on 93.6%
                           of stub rows purely because the word was absent.
  • negated amenities    — «مفروش» matched inside «غير مفروش», inverting the source's meaning.
  • failed/partial fetch — aqar serves an app SHELL to clients it does not recognise, and withholds
                           fields from anonymous fetches; an upsert of that row used to blank a
                           listing that a previous crawl had read correctly.

Run: python -m pytest scrapers/common/tests/test_source_is_truth_fleet_invariants.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

SCRAPERS = ROOT / "scrapers"
# Every file that can WRITE a listing value: entrypoints and enrichers alike. Globbing only run.py
# is how aqar's rent-period default survived the 2026-08-05 fleet sweep for four more days.
WRITERS = sorted(list(SCRAPERS.glob("*/run.py")) + list(SCRAPERS.glob("*/enrich*.py"))
                 + list(SCRAPERS.glob("*/run_*.py")))

from scrapers.common.db import (  # noqa: E402
    _CONTROL_COLS,
    _unknown_must_not_overwrite_known as guard,
)


def _code(p: Path) -> str:
    """Source with docstrings and comments removed — prose describing a removed bug is not the bug."""
    src = p.read_text(encoding="utf-8")
    src = re.sub(r'"""[\s\S]*?"""', " ", src)
    src = re.sub(r"'''[\s\S]*?'''", " ", src)
    return re.sub(r"(?m)^\s*#.*$", " ", src)


def test_there_are_writers_to_check():
    """A glob that silently matches nothing would make every test below vacuously pass."""
    assert len(WRITERS) > 25, f"expected the whole fleet, found {len(WRITERS)} writer files"


# ── 1. A failed or partial scrape must not destroy verified data ─────────────────────────────────

def test_an_unreadable_field_does_not_overwrite_a_stored_value():
    """The core fail-safe. `None` means "this fetch could not read it", never "the listing lacks it"."""
    row = {"ad_number": "X1", "price_annual": None, "furnished": None, "bedrooms": None,
           "property_age": None, "area_m2": None, "rent_period": None}
    guard(row)
    for field in ("price_annual", "furnished", "bedrooms", "property_age", "area_m2", "rent_period"):
        assert field not in row, f"{field}=None would have erased a previously verified value"


def test_a_totally_failed_page_writes_no_listing_values_at_all():
    """The app-shell case: nothing parsed. The row must carry liveness only, never blanks."""
    row = {"ad_number": "X1", "last_seen_at": "2026-08-09T00:00:00Z", "active": True,
           "missing_count": 0, "price_annual": None, "price_total": None, "rent_period": None,
           "furnished": None, "elevator": None, "kitchen": None, "parking": None,
           "bathrooms": None, "bedrooms": None, "property_age": None, "floor_number": None}
    guard(row)
    assert set(row) == {"ad_number", "last_seen_at", "active", "missing_count"}


def test_real_values_always_survive_the_guard():
    """The guard must never eat data — including falsey-but-real values."""
    row = {"price_annual": 16000, "furnished": False, "elevator": True, "bedrooms": 0,
           "rent_period": "monthly", "area_m2": 120}
    before = dict(row)
    guard(row)
    assert row == before, "a stated value must always be written, including False and 0"


def test_control_columns_stay_writable_to_null():
    """Liveness and bookkeeping are not source values — prune/reactivate/kill must keep working."""
    row = {"active": None, "missing_count": None, "deactivated_at": None, "source_capture": None}
    guard(row)
    assert set(row) == {"active", "missing_count", "deactivated_at", "source_capture"}
    assert "price_annual" not in _CONTROL_COLS, "a price is source DATA, never control state"


@pytest.mark.parametrize("fn", [
    "upsert_aqar_residential", "upsert_aqar_commercial",
    "upsert_wasalt_residential", "_wasalt_batch",
])
def test_every_write_path_calls_the_guard(fn):
    """A guard nobody calls is not a guard. `_wasalt_batch` is the shared path for the whole fleet:
    aldarim, dealapp, souq24, erapulse, nowaisiry, wasalt and every other batch writer funnel
    through it, so covering it covers the platforms individually named nowhere else."""
    src = (SCRAPERS / "common" / "db.py").read_text(encoding="utf-8")
    body = src.split(f"def {fn}(", 1)[1].split("\ndef ", 1)[0]
    assert "_unknown_must_not_overwrite_known(" in body, f"{fn} can blank verified data"


def test_the_shared_batch_path_really_is_shared():
    """If platforms stopped funnelling through _wasalt_batch, one guard would no longer cover them."""
    src = (SCRAPERS / "common" / "db.py").read_text(encoding="utf-8")
    assert src.count("_wasalt_batch(") > 15, (
        "the per-platform batch wrappers must keep funnelling through the shared guarded path"
    )


# ── 2. Never manufacture a price ─────────────────────────────────────────────────────────────────

def test_no_writer_multiplies_a_price_by_a_calendar_constant():
    """×365/×52 invent a magnitude the source never printed and have NO inverse.

    ×12 is the schema's documented annualisation contract (price_annual holds the annual figure and
    the app divides by 12 to display monthly), so it round-trips to exactly what the source showed.
    """
    bad = [f"{p.parent.name}/{p.name}: {m.group(0)}"
           for p in WRITERS for m in re.finditer(r"\bprice\w*\s*\*\s*(365|52)\b", _code(p))]
    assert not bad, f"{bad} fabricate an annual price from a daily/weekly rate"


def test_no_writer_scales_a_price_by_magnitude():
    """eaqartabuk had `total = v * 1000 if v < 10000 else v` — it rewrote a real 8,000 into 8,000,000
    on the theory that small numbers "must" be thousands. That is guessing, dressed as normalisation."""
    bad = [f"{p.parent.name}/{p.name}"
           for p in WRITERS if re.search(r"\*\s*1000\s+if\s+\w+\s*<", _code(p))]
    assert not bad, f"{bad} scale a price by magnitude instead of reading what the source printed"


def test_no_writer_derives_a_total_from_area_and_per_metre_rate():
    """price_per_meter × area is arithmetic, not a published price. «سعر المتر 5,000» is a RATE."""
    pat = re.compile(r"(price_per_meter|ppm|per_meter)\s*\*\s*(area|size|m2)"
                     r"|(area|size|m2)\w*\s*\*\s*(price_per_meter|ppm|per_meter)", re.I)
    bad = [f"{p.parent.name}/{p.name}" for p in WRITERS if pat.search(_code(p))]
    assert not bad, f"{bad} manufacture a total price from a per-m² rate"


# ── 3. Never default the rent period ─────────────────────────────────────────────────────────────

# A hardcoded period is honest ONLY when the platform sells one kind of contract and the file says
# so. Every name here is a DECLARED, DATED exception carrying that debt in the open.
#
# STATUS 2026-08-09: still unverified against their sources. souq24 was on this list and was PROVEN
# wrong; aqar came OFF it after its structured `rent_period` enum was verified live (2 = monthly,
# 3 = annual). Treat the remainder as suspect, not settled.
PERIOD_DEFAULT_ALLOWLIST = {
    "alhoshan", "alkhaas", "alnokhba", "awal", "deal", "erapulse", "hajer",
    "fursaghyr", "jazwtn", "jurash", "mizlaj", "nowaisiry", "sadin",
    "ramzalqasim", "toor",
}
SINGLE_PERIOD_PLATFORMS = {"gathern", "aqarmonthly"}   # short-stay marketplaces, one period by design

# Matched on ONE line only: `\s+` spanning newlines turns an assignment followed by an unrelated
# `if` on the next statement into a false positive.
_HARDCODED_PERIOD_RE = re.compile(
    r'"rent_period"[^\S\n]*:[^\S\n]*"(annual|monthly)"[^\S\n]*if\b'
    r'|rent_period[^\S\n]*(?::[^\S\n]*Optional\[str\])?[^\S\n]*=[^\S\n]*"(annual|monthly)"[^\S\n]+if\b'
)

# Platforms whose period comes from a ternary on a SOURCE SIGNAL rather than from a constant. Each
# entry names the signal, so the test can prove the read still happens; a platform cannot quietly
# swap its source read for a default and stay on this list.
PERIOD_FROM_SOURCE_SIGNAL = {
    "aqarcity": "is_monthly_rental(",   # reads the page body and disambiguates numerically
}


def test_no_writer_defaults_the_rent_period():
    offenders = {p.parent.name for p in WRITERS if _HARDCODED_PERIOD_RE.search(_code(p))} \
        - PERIOD_DEFAULT_ALLOWLIST - SINGLE_PERIOD_PLATFORMS - set(PERIOD_FROM_SOURCE_SIGNAL)
    assert not offenders, (
        f"{sorted(offenders)} default the rent period instead of reading it. aqar's «annual if Rent» "
        "default filed enum-2 MONTHLY listings as yearly — 6,500/yr instead of 78,000/yr. Read the "
        "period, or store None."
    )


def test_aqar_is_no_longer_allowed_to_default_its_period():
    """aqar's default is fixed and verified; it must never be re-added or re-allowlisted."""
    assert "aqar" not in PERIOD_DEFAULT_ALLOWLIST
    src = _code(SCRAPERS / "aqar" / "enrich_residential.py")
    assert not _HARDCODED_PERIOD_RE.search(src), "aqar must not default the rent period again"
    assert "_RENT_PERIOD_ENUM" in src, "aqar must read the period from its own structured enum"


def test_aqar_maps_both_published_periods():
    """2 = monthly and 3 = annual were both proven against live pages. Dropping either one silently
    reintroduces the 12× understatement for that half of the inventory."""
    from scrapers.aqar.enrich_residential import _RENT_PERIOD_ENUM
    assert _RENT_PERIOD_ENUM[2] == "monthly" and _RENT_PERIOD_ENUM[3] == "annual"


# ── 4. Unknown must never become NO ──────────────────────────────────────────────────────────────

def test_amenity_columns_carry_no_false_default():
    """469 columns across 67 tables once carried DEFAULT false — an unread amenity asserted
    "this flat has NO lift". The default was dropped 2026-08-05; the mirror must not reinstate it."""
    mig = ROOT / "supabase" / "migrations"
    files = list(mig.glob("*amenity_columns_unknown_stays_unknown*"))
    assert files, "the migration dropping DEFAULT false from amenity columns must stay in the tree"


def test_negatable_tokens_are_never_matched_bare():
    """«مفروش» is a substring of «غير مفروش». Matching it bare inverts the source's meaning — that
    shipped, and stored explicitly-UNfurnished flats as furnished=true."""
    naive = re.compile(r"(مفروش|مؤثث)")
    assert naive.search("غير مفروش"), "sanity: the naive pattern does match the negation"

    def shipped(txt: str):
        neg = re.search(r"غير\s*(مفروش|مؤثث)", txt) is not None
        pos = re.search(r"(مفروش|مؤثث)", re.sub(r"غير\s*(مفروش|مؤثث)\S*", " ", txt)) is not None
        if neg and pos:
            return None
        return False if neg else (True if pos else None)

    assert shipped("شقة غير مفروشة") is False,  "an explicit NO must be stored as NO"
    assert shipped("شقة مفروشة") is True,       "an explicit YES must be stored as YES"
    assert shipped("شقة للإيجار") is None,      "silence must be UNKNOWN, never NO"
    assert shipped("مفروشة وغير مفروشة") is None, "a contradiction is unknown, not a coin flip"


@pytest.mark.parametrize("platform,signal", sorted(PERIOD_FROM_SOURCE_SIGNAL.items()))
def test_a_source_signal_platform_still_reads_its_signal(platform, signal):
    """These are exempt from the default check ONLY because they read the source. If the read is
    removed, the ternary becomes a constant default and the exemption must not survive it."""
    src = _code(SCRAPERS / platform / "run.py")
    assert signal in src, f"{platform} no longer reads {signal} — its exemption is now a default"


def test_absence_is_not_a_period_muktamel_and_satel():
    """Both used a ternary that could not tell "the source says no" from "the source did not say".

    muktamel: a payload omitting `isRentPerYear` was labelled MONTHLY — and a monthly label makes
    every downstream reader divide by 12. satel: a missing `priceGroup` was labelled ANNUAL.
    """
    mk = _code(SCRAPERS / "muktamel" / "run.py")
    assert "_per_year is None" in mk, "muktamel must treat an absent isRentPerYear as unknown"
    st = _code(SCRAPERS / "satel" / "run.py")
    assert re.search(r"if price_group else None", st), (
        "satel must treat an absent priceGroup as unknown, not as annual"
    )


# ── 5. A per-metre RATE may never be stored as a total (owner's confusion #1) ─────────────────────

def test_no_writer_assigns_the_same_expression_to_total_and_per_metre():
    """`price_total` means "the whole asking price". A per-m2 rate in that column made a 1,740 m2
    plot searchable at 2,817 SAR (aqargate AG55663) and a 458 m2 plot at 1,050 SAR (hajer HJ3107).

    Three platforms shipped it independently under a "copy-the-display" convention, because the
    platform's own badge renders the rate under a bare «السعر» label. The badge is not the contract:
    the REGA table says «سعر الوحدة» and the sellers write «N ريال للمتر».
    """
    bad = []
    for p in WRITERS:
        src = _code(p)
        # the literal shape that shipped: both keys taking the same bare variable
        m_total = re.search(r'"price_total"\s*:\s*([A-Za-z_][\w.]*)\s*(?:if[^,\n]*)?,', src)
        m_ppm = re.search(r'"price_per_meter"\s*:\s*([A-Za-z_][\w.]*)\s*(?:if[^,\n]*)?,', src)
        if (m_total and m_ppm and m_total.group(1) == m_ppm.group(1)
                and m_total.group(1) != "None"):      # both UNKNOWN is fine; both the same NUMBER is not
            bad.append(f"{p.parent.name}/{p.name}: both columns get `{m_total.group(1)}`")
    assert not bad, (
        f"{bad} store one number as BOTH the total and the per-m2 rate. One of the two is a lie. "
        "If the source publishes only a rate, the total is UNKNOWN — never rate x area."
    )


@pytest.mark.parametrize("platform,marker", [
    ("hajer", "rate_only"),
    ("eastabha", "price_is_rate"),
])
def test_rate_only_platforms_null_the_total(platform, marker):
    """Each platform must carry an explicit rate-only signal into the row, not just record the rate
    alongside a total that is really the same number."""
    src = _code(SCRAPERS / platform / "run.py")
    assert marker in src, f"{platform} lost its rate-only marker"
    assert re.search(rf'"price_total"\s*:\s*None if[^,]*{marker}', src) or \
           re.search(rf'"price_total"\s*:\s*None if\s*\([^)]*{marker}', src), (
        f"{platform} must set price_total to None when the displayed figure is a per-m2 rate")


def test_aqargate_does_not_adopt_the_platforms_own_rate_times_area():
    """aqargate publishes `landTotalPrice`, but it equals propertyPrice x propertyArea exactly on 30
    of 31 live rows — it is aqargate's arithmetic, not an independently published price. Adopting it
    would be the banned rate x area multiplication with an extra step."""
    src = _code(SCRAPERS / "aqargate" / "run.py")
    # The guard itself legitimately mentions landTotalPrice as a CONDITION; what is forbidden is
    # landTotalPrice being the assigned VALUE.
    assert not re.search(r'"price_total"\s*:\s*_price_int\(\s*ar\.get\("landTotalPrice"', src), (
        "aqargate must not store landTotalPrice as the asking price — it is a derived product")
    assert re.search(r'"price_total"\s*:\s*None if\s*\(is_rent or ar\.get\("landTotalPrice"\)', src), (
        "aqargate must leave price_total UNKNOWN on rate-priced land ads")


# ── 6. The RNPL instalment is a different field from the rent (owner's confusion #4) ─────────────

def test_no_writer_derives_an_instalment_from_the_price():
    """alhoshan computed `round(price / 12)` and published it as a source instalment, and set the
    RNPL flag from a brand tagline so it read true for every priced rental. A marketing fact about
    the company is not a per-listing data fact."""
    bad = [f"{p.parent.name}/{p.name}"
           for p in WRITERS
           if re.search(r"rent_now_pay_later_monthly\"?\s*[:=]\s*[^,\n]*/\s*12", _code(p))
           or re.search(r"monthly_inst\s*=\s*round\([^)]*/\s*12", _code(p))]
    assert not bad, f"{bad} DERIVE the RNPL instalment from the price instead of reading it"


def test_the_instalment_is_never_assigned_to_a_price_column():
    """The 6704222 class: aqar's 12-instalment financing TOTAL stored as price_annual (30,000 where
    aqar publishes 2,500/yr)."""
    bad = []
    for p in WRITERS:
        src = _code(p)
        for m in re.finditer(r'"price_(?:annual|total)"\s*:\s*([^,\n]{0,80})', src):
            expr = m.group(1)
            if re.search(r"rnpl|instal|monthly_inst|price_12_payments", expr, re.I):
                bad.append(f"{p.parent.name}/{p.name}: price column fed by `{expr.strip()}`")
    assert not bad, f"{bad} let a financing figure become the asking price"


def test_aqar_reads_the_instalment_from_its_own_published_field():
    src = _code(SCRAPERS / "aqar" / "enrich_residential.py")
    assert "rnpl_monthly_price" in src, "aqar must read the instalment aqar publishes"
    assert not re.search(r"500\s*<=\s*v\s*<=\s*100_000", src), (
        "the plausibility band discarded 1,314 real published instalments (72, 76, 90 SAR) — "
        "a source-published number is never ours to reject for looking small")


def test_a_brand_name_can_never_set_the_rnpl_flag():
    """«تمكين» is an ordinary Arabic noun and a common company name; as a bare substring it flagged
    26 active aqar BUY listings that carry no RNPL offer at all."""
    src = _code(SCRAPERS / "aqar" / "enrich_residential.py")
    assert 'r"تمكين"' not in src, "a broker's company name is not an RNPL offer"


# ── 7. The guard protects verified data — it must not silently protect FABRICATIONS ──────────────

def test_the_guard_is_documented_as_needing_a_one_off_retraction():
    """A trap found twice on 2026-08-09, worth writing down rather than rediscovering.

    `_unknown_must_not_overwrite_known` is deliberately asymmetric: a re-crawl that now (correctly)
    emits None cannot clear a stored value. That is exactly what we want when the value was real and
    the fetch was weak — and exactly WRONG when the stored value was a fabrication we just removed
    from the scraper. alhoshan's derived instalments and eastabha EA21188's rate-as-total both
    survived their own fix for this reason and needed an explicit one-off retraction.

    So the guard's docstring must keep saying so: shipping a fabrication fix WITHOUT a retraction
    leaves production wrong while every test passes.
    """
    src = (SCRAPERS / "common" / "db.py").read_text(encoding="utf-8")
    body = src.split("def _unknown_must_not_overwrite_known(", 1)[1].split("\ndef ", 1)[0]
    assert "retract" in body.lower(), (
        "the guard must document that removing a fabrication ALSO needs a one-off data retraction — "
        "the guard will otherwise keep the fabricated value alive through every future crawl"
    )
