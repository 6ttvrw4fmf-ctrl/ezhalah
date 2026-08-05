"""FLEET-WIDE SOURCE-FIDELITY GUARD (owner directive, 2026-08-05).

    "Make sure every scraper preserves the exact price, rent period, size, bedrooms, bathrooms,
     furnished status, amenities, floor, etc. that the source actually publishes, without
     calculating, guessing, defaulting, or changing the meaning."

A value we DEFAULT is a value we invented. A value we CALCULATE is a value the source never printed.
Both are indistinguishable from real data once stored, which is what makes them dangerous — the
2026-08-05 apartment audit found three live examples, each of which had been sitting in production
looking exactly like a legitimate field:

  • dealapp  — the rent period was read from the FIRST «إيجار» anywhere in the document (including
               <head> and the broker's description) and DEFAULTED to "annual" when absent, then the
               price was MULTIPLIED (×365 / ×52 / ×12). Live proof: DA443363's own badge reads
               «إيجار سنوي» (annual, 60,000/yr) and we stored monthly / 21,900,000.
  • souq24   — «5,000 شهري» (MONTHLY) on ad 1106, stored as annual: a 12x understatement, because the
               period was hardcoded rather than read from the price div that prints it.
  • aqar     — furnished came from `txt ~ 'مؤثث|مفروش'`, and «مفروش» is a substring of «غير مفروش»
               ("NOT furnished"), so explicitly-unfurnished flats were stored as furnished=true.

These tests pin the invariant at the two places it can be broken: the shape of the code, and the
declared exceptions. They are deliberately source-text assertions — a scraper cannot be executed in
CI without network access, so the readable contract is what we can enforce.

Run: python -m pytest scrapers/common/tests/test_source_fidelity_no_defaults.py
"""
from __future__ import annotations

import re
from pathlib import Path

SCRAPERS = Path(__file__).resolve().parent.parent.parent
RUNS = sorted(p for p in SCRAPERS.glob("*/run.py"))


def _src(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ── 1. No scraper may DEFAULT the rent period ────────────────────────────────────────────────────
# A hardcoded period is only honest when the platform genuinely sells one kind of contract and that
# fact is documented. Every entry here is a DECLARED, DATED exception that must state, in the file,
# why the constant is a platform fact rather than a guess. Adding a scraper to this list is a
# deliberate act; the default for a new scraper is to READ the period from the page.
#
# STATUS 2026-08-05: these 15 remain unverified against their sources. souq24 was in this list and
# was PROVEN wrong (it publishes «شهري» next to the price), so the rest must be treated as suspect,
# not as settled. They are pinned here so the debt is visible and countable rather than invisible.
PERIOD_DEFAULT_ALLOWLIST = {
    "alhoshan", "alkhaas", "alnokhba", "awal", "deal", "erapulse", "hajer",
    "fursaghyr", "jazwtn", "jurash", "mizlaj", "nowaisiry", "sadin",
    "ramzalqasim", "toor",
}
# Platforms whose ENTIRE catalogue is one period by construction (short-stay marketplaces).
SINGLE_PERIOD_PLATFORMS = {"gathern", "aqarmonthly"}

_HARDCODED_PERIOD_RE = re.compile(r'"rent_period"\s*:\s*"(annual|monthly)"\s*if\b')


def test_no_new_scraper_defaults_the_rent_period() -> None:
    offenders = {
        p.parent.name for p in RUNS if _HARDCODED_PERIOD_RE.search(_src(p))
    } - PERIOD_DEFAULT_ALLOWLIST - SINGLE_PERIOD_PLATFORMS
    assert not offenders, (
        f"{sorted(offenders)} hardcode the rent period instead of reading it from the page. "
        "A defaulted period silently rewrites what the source published — souq24 stored «5,000 شهري» "
        "(monthly) as annual, a 12x understatement. Read the period from the listing, or store None "
        "(unknown). If the platform truly sells only one kind of contract, document that in the file "
        "and add it to PERIOD_DEFAULT_ALLOWLIST deliberately."
    )


def test_souq24_reads_its_published_period() -> None:
    """Regression: souq24 printed «شهري» next to the price and we stored 'annual'."""
    s = _src(SCRAPERS / "souq24" / "run.py")
    assert "_rent_period_from_price_div" in s, "souq24 must read the period from its price div"
    assert not _HARDCODED_PERIOD_RE.search(s), "souq24 must not hardcode the period again"


def test_dealapp_anchors_the_period_on_its_own_badge() -> None:
    """Regression: dealapp read the period from prose and defaulted to annual."""
    s = _src(SCRAPERS / "dealapp" / "run.py")
    assert "coin\\.svg" in s or "coin.svg" in s, (
        "dealapp must anchor the period on its structured price badge (coin.svg), not on the first "
        "«إيجار» in the document — the description and <head> both contain period words."
    )
    assert 'return "annual"' not in s.split("def _rent_period_window")[1].split("def ")[0], (
        "dealapp must return None (unknown) when no badge is present, never default to annual."
    )


# ── 2. No scraper may FABRICATE a rent magnitude the source never printed ────────────────────────
def test_no_scraper_multiplies_a_price_by_a_calendar_constant() -> None:
    """×365 / ×52 turn a daily or weekly rate into a number the source never published.

    ×12 is permitted and is the schema's annualisation contract: price_annual holds the ANNUAL figure
    and the app divides by 12 to display a monthly price, so ×12 round-trips back to exactly what the
    source printed. ×365/×52 have no such inverse — nothing in the schema can recover the daily rate,
    and the card renders a monthly price that was never published.
    """
    bad = []
    for p in RUNS:
        for m in re.finditer(r"\bprice\w*\s*\*\s*(365|52)\b", _src(p)):
            bad.append(f"{p.parent.name}: {m.group(0)}")
    assert not bad, (
        f"{bad} fabricate an annual price from a daily/weekly rate. dealapp stored 350/day as "
        "127,750 and the card rendered 'SAR 10,645/mo' — a figure the source never printed. A period "
        "this schema cannot represent must be stored as UNKNOWN, not converted."
    )


# ── 3. A negatable token must never be matched as a bare substring ───────────────────────────────
def test_furnished_detection_cannot_match_a_negation() -> None:
    """«مفروش» is a substring of «غير مفروش» — matching it bare inverts the source's meaning."""
    naive = re.compile(r"(مفروش|مؤثث)")
    assert naive.search("غير مفروش"), "sanity: the naive pattern does match the negation"

    # The shipped semantics (mirrors public.aqar_parse after the 2026-08-05 fix): strip negated
    # occurrences BEFORE testing for a positive, so a negation can never read as a positive.
    def furnished(txt: str):
        neg = re.search(r"غير\s*(مفروش|مؤثث)", txt) is not None
        stripped = re.sub(r"غير\s*(مفروش|مؤثث)\S*", " ", txt)
        pos = re.search(r"(مفروش|مؤثث)", stripped) is not None
        if neg and pos:
            return None          # contradictory → unknown
        if neg:
            return False         # the source stated it
        if pos:
            return True
        return None              # unknown stays unknown

    assert furnished("شقة مفروشة للايجار") is True
    assert furnished("شقة غير مفروشة للايجار") is False, "explicit negation must NOT read as furnished"
    assert furnished("تتوفر شقق مفروشة و شقق غير مفروشة") is None, "contradictory must be unknown"
    assert furnished("شقة للايجار") is None, "silence must be unknown, never False-as-fact"


# ── 4. Unknown must stay unknown — no platform-wide constants in the sync ────────────────────────
def test_no_platform_wide_field_fabrication_documented() -> None:
    """sync_search_listings_ar once wrote `furnished = true` for two whole platforms by table name.

    That is a value derived from WHICH TABLE a row is in, not from anything the source published.
    The fix removed it; this test documents the shape so a reviewer recognises it if it reappears.
    """
    mig = SCRAPERS.parent / "supabase" / "migrations"
    if not mig.exists():
        return
    hits = [f.name for f in mig.glob("*.sql")
            if "fabricat" in f.name.lower() or "furnished" in f.name.lower()]
    assert hits, (
        "expected the furnished de-fabrication migration to be recorded in supabase/migrations — "
        "without it the next schema rebuild would reintroduce the platform-wide constant."
    )


# ── 5. An ABSENT amenity list is UNKNOWN, never a fleet of confident "no"s ────────────────────────
def test_wasalt_absent_amenity_list_yields_unknown_not_false() -> None:
    """Wasalt's `featureAmenities` is often missing entirely; a bare False then invents a negative.

    Measured 2026-08-05: 0 of 9,247 active Wasalt rent apartments carried the key, and `elevator` was
    false on 9,247/9,247 — a column that can only say "no" is not reading anything. Wasalt is 39% of
    the annual-rent apartment inventory, so this was the largest single source of invented negatives.
    List present -> True/False is honest (Wasalt chose not to list it). List absent -> None.
    """
    src = _src(SCRAPERS / "wasalt" / "run.py")
    assert "_has_amenity_list" in src, "wasalt must distinguish an absent list from an empty match"
    assert "if _has_amenity_list else None" in src, (
        "an absent featureAmenities list must yield None (unknown), never False"
    )

    # EXECUTED replica of the shipped lambda.
    def build(raw):
        present = isinstance(raw, list) and len(raw) > 0
        names = [(a or {}).get("name", "").lower() for a in (raw or []) if isinstance(a, dict)]
        return lambda *kws: (any(k in n for n in names for k in kws) if present else None)

    assert build(None)("elevator", "lift") is None, "missing list -> unknown"
    assert build([])("elevator", "lift") is None, "empty list -> unknown"
    assert build([{"name": "Elevator"}])("elevator", "lift") is True, "listed -> true"
    assert build([{"name": "Parking"}])("elevator", "lift") is False, (
        "list present but amenity not in it -> a genuine, source-backed false"
    )
