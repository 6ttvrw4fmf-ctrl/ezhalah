"""SOURCE-TRUTH probe: is a gathern nightly price of 99,000 SAR published, or our ×100 artifact?

WHY THIS EXISTS
---------------
Six active gathern rows carry a price-per-m²/yr above the `field_integrity_extreme_magnitude`
threshold — e.g. unit 138728 (Khobar, 50 m² apartment) stores nightly_price 99,000 →
monthly_price 2,821,500 → price_annual 33,858,000. Five of them were adjudicated on 2026-08-17 as
source-published and written into `ops_price_source_verified` (do-not-reprice, permanently exempt
from the barrier). A sixth (731858) crossed the threshold on 2026-08-23 and re-raised the P1.

That adjudication rests on one argument: `price_annual / 12 / nightly ≈ 30 nights`, i.e. the stored
chain is internally consistent, therefore not a parser artifact. **That argument is
scale-invariant.** `scrapers/gathern/run.py::_num` carried a bug (GH #503, fixed 2026-08-12) in
which msapi renders a price with the ARABIC decimal separator ٫ (U+066B) — "990٫00" meaning 990.00
SAR — and the old regex stripped ٫ instead of treating it as a decimal point, yielding 99000: a
value exactly 100× too large. When nightly AND monthly are BOTH inflated ×100 by the same parser,
`monthly / nightly` is still 30. So internal consistency cannot tell the two apart, and 204 rows
matching this exact shape (monthly_price up to 2,821,500 — the same figure unit 138728 still
carries) were already repaired in production as artifacts on 2026-08-12.

Only the source settles it, and only the RAW string does: 99000 as a bare JSON number is a
published price; "990٫00" is our ×100 artifact and five rows are wrongly exempted from the barrier
that exists to catch exactly this.

WHAT IT PROVES
--------------
  1. THE RAW STRING the scraper parses, printed with repr() so U+066B/U+066C are visible, for each
     target unit — taken from the SAME endpoint, SAME monthly 30-night window, SAME session
     impersonation the production scraper uses, so it sees exactly what the scraper sees.
  2. OLD vs NEW parse of that same raw string, side by side, against the stored value. If the old
     parser reproduces the stored figure and the new one does not, the stored figure is the
     artifact — no inference required.
  3. A SEPARATOR CENSUS over every item fetched: how many of today's raw price strings contain ٫ or
     ٬ at all. If none do, the ×100 class is no longer being served and the stored values must have
     another origin; if some do, the class is live.

CONTROLS: ordinary units from the same pages are printed with their raw strings and both parses,
so "the field looks like X" is read against working examples rather than in isolation. A target
that no longer appears in monthly-mode search is reported NOT FOUND — absence is not evidence.

READ-ONLY: no database connection, no writes, no import of scrapers.common.db. The workflow that
runs it passes no Supabase secrets, so it cannot write even by accident.

PDPL: gathern list cards carry no host name or phone (bookings go through gathern), and this script
allowlists the keys it prints regardless.

Usage (CI):  python scripts/diagnose_gathern_nightly_scale.py
"""
from __future__ import annotations

import datetime
import re
import sys
import time
from typing import Any, Optional

from curl_cffi import requests as cc

BASE_WEB = "https://gathern.co"
SEARCH = "https://msapi.gathern.co/search/api/v1/search-units"
FILTER_CONFIG = "https://api.gathern.co/v1/web/default/filter-config?lang=ar"
STAY_NIGHTS = 30
RETRIES = 5
MIN_INTERVAL = 0.6
MAX_PAGES = 200

# The price keys we read off an item. Allowlisted: nothing else from the payload is ever printed.
PRICE_KEYS = ("day_price_format", "price", "final_price", "avg_price",
              "price_before_discount", "oldPrice", "discount_label", "nights", "long_stay")

# unit_id → (city_ar hint, stored nightly, stored monthly, stored price_annual, area_m2, note)
TARGETS: dict[int, dict[str, Any]] = {
    166451: {"city": "ابها", "nightly": 61119, "monthly": 1833582, "annual": 22002984,
             "area": 40, "note": "exempted 2026-08-17"},
    234671: {"city": "الخبر", "nightly": 90000, "monthly": 2160000, "annual": 25920000,
             "area": 40, "note": "NOT exempted — raised the P1 on 2026-08-23"},
    138728: {"city": "الخبر", "nightly": 99000, "monthly": 2821500, "annual": 33858000,
             "area": 50, "note": "exempted 2026-08-17; 2,821,500 is the exact figure GH #503 names"},
    185212: {"city": "الخبر", "nightly": 99000, "monthly": 2821500, "annual": 33858000,
             "area": 50, "note": "exempted 2026-08-17"},
    185225: {"city": "الخبر", "nightly": 78000, "monthly": 2222992, "annual": 26675904,
             "area": 50, "note": "exempted 2026-08-17"},
    175402: {"city": "المدينة المنورة", "nightly": 99999, "monthly": 2399976, "annual": 28799712,
             "area": 50, "note": "exempted 2026-08-17"},
}

_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
_last = 0.0


def _throttle() -> None:
    global _last
    wait = _last + MIN_INTERVAL - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()


def _num_old(v: Any) -> Optional[int]:
    """The PRE-#503 parser, verbatim: strips ٫/٬ as if they were noise. Reproduced here so the two
    readings of one raw string can be printed side by side."""
    if v in (None, "", 0, "0"):
        return None
    try:
        s = re.sub(r"[^\d.]", "", str(v).translate(_AR_DIGITS))
        n = round(float(s)) if s else None
        return n if n else None
    except (TypeError, ValueError):
        return None


def _num_new(v: Any) -> Optional[int]:
    """The CURRENT parser (scrapers/gathern/run.py::_num): ٫ is a decimal point, ٬ a thousands sep."""
    if v in (None, "", 0, "0"):
        return None
    try:
        s = str(v).translate(_AR_DIGITS).replace("٫", ".").replace("٬", "")
        s = re.sub(r"[^\d.]", "", s)
        n = round(float(s)) if s else None
        return n if n else None
    except (TypeError, ValueError):
        return None


def session() -> cc.Session:
    """The production fetch path — same impersonation and headers as the scraper's session()."""
    s = cc.Session(impersonate="chrome124")
    s.headers.update({
        "Accept": "application/json",
        "Accept-Language": "ar,en-US;q=0.7,en;q=0.6",
        "source": "web",
        "Origin": BASE_WEB,
        "Referer": f"{BASE_WEB}/",
    })
    return s


def monthly_window() -> tuple[str, str]:
    today = datetime.date.today()
    ci = today + datetime.timedelta(days=1)
    return ci.isoformat(), (ci + datetime.timedelta(days=STAY_NIGHTS)).isoformat()


def fetch_cities(s: cc.Session) -> list[dict]:
    for attempt in range(RETRIES):
        _throttle()
        try:
            r = s.get(FILTER_CONFIG, timeout=40)
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
        if r.status_code != 200:
            time.sleep(2 * (attempt + 1)); continue
        try:
            return (r.json().get("global_data") or {}).get("cities") or []
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
    return []


def fetch_page(s: cc.Session, city_id: int, page: int, ci: str, co: str) -> list[dict]:
    params = {"lang": "ar", "city": city_id, "page": page, "calendar_type": "monthly",
              "check_in": ci, "check_out": co, "has_available": "true"}
    for attempt in range(RETRIES):
        _throttle()
        try:
            r = s.get(SEARCH, params=params, timeout=40)
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(3 * (attempt + 1)); continue
        if r.status_code != 200:
            return []
        try:
            return r.json().get("items") or []
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
    return []


def raw_fields(it: dict) -> dict[str, Any]:
    return {k: it.get(k) for k in PRICE_KEYS if k in it}


def show(label: str, it: dict) -> None:
    print(f"    {label}")
    for k, v in raw_fields(it).items():
        print(f"      {k:<24} raw={v!r:<24} type={type(v).__name__:<5} "
              f"old={_num_old(v)!r:<12} new={_num_new(v)!r}")


def main() -> int:
    ci, co = monthly_window()
    print("=" * 100)
    print("GATHERN NIGHTLY-SCALE SOURCE PROBE")
    print(f"monthly window asked for: check_in={ci} check_out={co} (nights={STAY_NIGHTS})")
    print("=" * 100)

    s = session()
    cities = fetch_cities(s)
    if not cities:
        print("\nFAILED: could not fetch the city catalog. This is a READ FAILURE, not evidence "
              "about any price. Nothing may be concluded from this run.")
        return 2
    print(f"city catalog: {len(cities)} entries\n")

    wanted_names = {t["city"] for t in TARGETS.values()}

    def city_matches(c: dict) -> bool:
        labels = {str(c.get("name_ar") or ""), str(c.get("name") or "")}
        return any(w in labels or any(w in lab for lab in labels if lab) for w in wanted_names)

    targets_by_city: dict[int, str] = {}
    for c in cities:
        if city_matches(c):
            cid = c.get("id")
            if cid is not None:
                targets_by_city[int(cid)] = str(c.get("name_ar") or c.get("name") or cid)
    if not targets_by_city:
        print("FAILED: none of the target cities were found in the catalog. READ FAILURE, not "
              "evidence.")
        return 2
    print(f"probing cities: {targets_by_city}\n")

    found: dict[int, dict] = {}
    controls: list[tuple[str, dict]] = []
    sep_hits: list[tuple[str, str, Any]] = []
    items_seen = 0
    price_strings_seen = 0

    for cid, cname in sorted(targets_by_city.items()):
        page = 1
        empty = 0
        while page <= MAX_PAGES and empty < 2:
            items = fetch_page(s, cid, page, ci, co)
            if not items:
                empty += 1
                page += 1
                continue
            empty = 0
            for it in items:
                items_seen += 1
                uid = it.get("id") or it.get("unit_id")
                for k, v in raw_fields(it).items():
                    if isinstance(v, str):
                        price_strings_seen += 1
                        if "٫" in v or "٬" in v:
                            sep_hits.append((f"{cname}/unit {uid}", k, v))
                try:
                    uid_i = int(uid)
                except (TypeError, ValueError):
                    uid_i = None
                if uid_i in TARGETS:
                    found[uid_i] = it
                elif len(controls) < 6 and it.get("day_price_format") is not None:
                    controls.append((f"{cname}/unit {uid}", it))
            page += 1
        print(f"  {cname} (city id {cid}): walked to page {page - 1}, items so far {items_seen}")

    print("\n" + "=" * 100)
    print("1. TARGETS — the raw strings behind the flagged prices")
    print("=" * 100)
    verdicts: list[str] = []
    for uid, meta in TARGETS.items():
        print(f"\n  unit {uid} ({meta['city']}, {meta['area']} m²) — {meta['note']}")
        print(f"    STORED: nightly={meta['nightly']} monthly={meta['monthly']} "
              f"price_annual={meta['annual']}")
        it = found.get(uid)
        if it is None:
            print("    NOT FOUND in monthly-mode search today (booked, delisted, or off monthly "
                  "calendar). Absence is NOT evidence either way — nothing concluded for this unit.")
            verdicts.append(f"{uid}: NOT FOUND (no conclusion)")
            continue
        show("RAW PAYLOAD:", it)
        dp = it.get("day_price_format")
        old, new = _num_old(dp), _num_new(dp)
        if old == meta["nightly"] and new != meta["nightly"]:
            v = (f"{uid}: ARTIFACT — the old parser reproduces the stored {meta['nightly']} from "
                 f"{dp!r}; the fixed parser reads {new}. Stored value is ours, not gathern's.")
        elif new == meta["nightly"]:
            v = (f"{uid}: SOURCE-REAL — the FIXED parser reads {new} from {dp!r}, matching the "
                 f"stored value. gathern publishes this figure.")
        else:
            v = (f"{uid}: CHANGED — source now reads {new} from {dp!r} vs stored "
                 f"{meta['nightly']}; neither parser reproduces the stored value.")
        print(f"    → {v}")
        verdicts.append(v)

    print("\n" + "=" * 100)
    print("2. CONTROLS — ordinary units from the same pages")
    print("=" * 100)
    for label, it in controls:
        print()
        show(label, it)

    print("\n" + "=" * 100)
    print("3. SEPARATOR CENSUS — is the ×100 class still being served?")
    print("=" * 100)
    print(f"  items fetched: {items_seen}   price strings inspected: {price_strings_seen}")
    print(f"  strings containing ٫ (U+066B) or ٬ (U+066C): {len(sep_hits)}")
    for label, k, v in sep_hits[:10]:
        print(f"    {label:<40} {k:<24} {v!r}")
    if not sep_hits and price_strings_seen:
        print("  → none. Today's payloads carry no Arabic separator, so the #503 ×100 class is not "
              "reproducing on this window. That does NOT retro-prove a stored value: a row written "
              "before 2026-08-12 keeps its old figure unless re-priced.")

    print("\n" + "=" * 100)
    print("VERDICTS")
    print("=" * 100)
    for v in verdicts:
        print(f"  {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
