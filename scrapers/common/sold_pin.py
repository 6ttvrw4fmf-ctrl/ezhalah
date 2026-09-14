"""The SOLD-PIN law, in ONE place: a source-confirmed removal must leave EVIDENCE.

WHY THIS EXISTS
---------------
Eleven scrapers read a real, named, DIRECT removal signal on the listing's own page — satel's
`property_status` reading "Rented out", alta/amaall/eastabha's «تم البيع»/«تم التأجير», hajer and
jurash's status badge, awal's `is-sold` class, ramzalqasim's `availability`, aqaratikom's
`is_sold`, dealapp's `offers.availability`, abeea's property status — and correctly deactivate on
it. That is `EvidenceKind.DIRECT` in the sense `docs/ops/LISTING_LIVENESS.md` §2 means it: we
fetched THIS listing's own page and the source itself said it is gone.

Each of them then wrote that evidence NOWHERE. Measured 2026-09-14 over the whole
`ops_stale_inactivation_probe` ledger: of the eleven platforms carrying a sold pin, exactly ONE
(abeea) recorded a row. So ten platforms' best-evidenced deactivations were, in SQL, indistinguish-
able from a crawl that timed out.

That is not a bookkeeping complaint. It has two costs, and the second is the serious one:

1. **The kill is unfalsifiable from the record.** The lesson of 2026-08-26 (aqarcity mapping
   "real id but unparseable page" to 'gone'): deciding whether 254 same-day deactivations were
   correct needed a by-hand re-probe of the live source, because nothing stored said WHICH
   condition had fired. `db.prune_unseen()` learned that lesson and writes a row for every verdict,
   UNKNOWN included. The sold pin never did.

2. **It makes the routine's highest-value detector cry wolf.** `mon_detect_unknown_treated_as_dead`
   (kind `unknown_treated_as_dead`, P1) asks exactly the right question — *was this row set
   `active = false` with no GONE verdict recorded against its ad_number at the time?* — and an
   unevidenced sold pin answers "no evidence" for a kill that had the best evidence in the system.
   Measured this run: alert_event 2682 flagged three satel rows (STC0018, STC0019, STA0231) as
   evidence-free. A DIRECT probe of each listing's own URL from this session returned HTTP 200 with
   the source's own «Rented out» status on all three. Every one of those kills was EARNED; the P1
   was caused entirely by the missing ledger row.
   `docs/ops/LISTING_LIFECYCLE_ENGINEER.md` §8.3 names this detector the highest-value one in §4
   and "the one that can least afford to cry wolf" — a detector readers learn to dismiss is a
   detector that is dark on the day it is right.

WHY IT IS ONE FUNCTION AND NOT ELEVEN
-------------------------------------
The eleven `_pin_sold_inactive()` helpers were byte-identical copies of one body. The evidence duty
was added to exactly one of them and no mechanism carried it to the other ten — the same shape
`scrapers/common/http_liveness.py` was created to end: *the law is universal, only the signal is
per-platform; N private copies of a law is N chances to omit it, and an omission looks exactly like
a correct copy until something is destroyed.*

So the pin payload and the evidence write live here, once, and a platform supplies only the thing
that really is its own: WHICH source field said gone (`oracle=`), and optionally the raw text it
read (`notes=`). `scripts/verify-sold-pin-evidence-law.ts` fails on any scraper that re-implements
the pin locally instead of calling this — so a twelfth copy-paste cannot silently rejoin the class.

WHAT THE PIN IS FOR (unchanged, and why the payload is what it is)
-----------------------------------------------------------------
`auto_recover_false_inactive()` (pg_cron jobid 30, 05:20 UTC) re-activates any row that is
`active = false` AND `coalesce(missing_count, 0) = 0` AND recently seen — and the shared batch
upsert unconditionally writes `missing_count = 0` for every row it touches. A scraper that knows a
listing is sold but leaves `missing_count = 0` therefore hands the sweep its exact recover trigger:
on 2026-07-16, 907 dealapp_residential + 5 dealapp_commercial + 3 aqaratikom_commercial rows sat in
that state and resurrected every morning. Pinning `missing_count = 3` (the prune's own grace) makes
the row un-recoverable by that sweep while remaining a plain soft-inactivation that a relisting
undoes: the next upsert carries `active = true` and its own `missing_count = 0` reset applies.

A CONTRADICTORY SOURCE IS NOT AUTHORITATIVE GONE EVIDENCE (owner rule, 2026-08-24)
---------------------------------------------------------------------------------
`live_ad_numbers` is abeea's measured guard, generalised. Abeea publishes some properties twice
under one «Property ID»; 4 of 245 posts were such duplicates and 3 of those pairs DISAGREED, one
post reading "For Sale" while its twin read "Rented". Ezhalah keys on the id, so both collapse onto
one row: the live post upserted it available, then the pin killed it unconditionally. ABRE300,
ABRE277 and ABRE104 were inactive while abeea was still advertising them.

Passing `live_ad_numbers` HOLDS any id also seen LIVE in the same crawl. It cannot mask a real sale:
when the remaining live twin also flips to sold, no live sighting exists that crawl and the pin
applies normally. A caller that passes nothing keeps the previous behaviour exactly.

WHAT THIS FUNCTION MAY NEVER BECOME
-----------------------------------
It deactivates on a verdict the CALLER has already established from the listing's own page. It must
never infer one: absence from a crawl is `EvidenceKind.ABSENCE` and `decide()` returns
`action = "none"` for it, always (`LISTING_LIVENESS.md` §1-§3). And it must never write
`last_verified_alive_at` — only `scrapers/common/liveness_contract.py` may (§3); a hand-written
stamp puts a confident, recent-looking timestamp on inventory nobody read.
"""
from __future__ import annotations

from typing import Any, Iterable, Mapping, Optional, Sequence

from scrapers.common import db

# The canonical pin payload. `active=False` alone is not enough — see the 2026-07-16 resurrection
# above; `missing_count=3` is what puts the row out of auto_recover_false_inactive()'s reach.
PIN_PAYLOAD: dict[str, Any] = {"active": False, "missing_count": 3}

# The ledger every deactivation path in this repo writes its per-row verdict to.
EVIDENCE_TABLE = "ops_stale_inactivation_probe"

_BATCH = 200


def plan_pin(
    ad_numbers: Sequence[str],
    oracle: str,
    notes: Optional[Mapping[str, str]] = None,
    live_ad_numbers: Optional[Iterable[str]] = None,
    table: str = "",
) -> tuple[list[str], list[str], list[dict[str, Any]]]:
    """Decide, with NO I/O, what this pin should do: `(pinnable, conflicted, evidence_rows)`.

    Pure and total, so the law can be EXECUTED by a barrier rather than read as text
    (`scripts/verify-sold-pin-evidence-law.ts` runs it through `scripts/lib/pythonMutant.ts`,
    which calls positionally — hence the positional signature here).
    Every id that gets pinned gets exactly one evidence row — that one-to-one relation IS the
    invariant this module exists to hold, and it is asserted here where it can be checked without a
    database.
    """
    if not oracle or not str(oracle).strip():
        # An evidence row that cannot say WHICH source field was read is the 2026-08-26 defect with
        # extra steps: present in the ledger, useless for adjudicating the kill.
        raise ValueError(
            "pin_source_confirmed_gone requires a non-empty oracle naming the source field that "
            "said gone, e.g. 'satel.sold_pin.property_status'"
        )
    live = set(live_ad_numbers or ())
    seen: set[str] = set()
    pinnable: list[str] = []
    for a in ad_numbers:
        if a in live or a in seen:
            continue
        seen.add(a)
        pinnable.append(a)
    conflicted = sorted({a for a in ad_numbers if a in live})
    evidence = [
        {
            "source_table": table,
            "ad_number": a,
            "verdict": "GONE",
            "oracle": oracle,
            "note": (notes or {}).get(a) or "",
        }
        for a in pinnable
    ]
    return pinnable, conflicted, evidence


def pin_source_confirmed_gone(
    table: str,
    ad_numbers: Sequence[str],
    *,
    oracle: str,
    notes: Optional[Mapping[str, str]] = None,
    live_ad_numbers: Optional[Iterable[str]] = None,
) -> list[str]:
    """Pin rows the SOURCE ITSELF said are gone, and record why. Returns the ids actually pinned.

    `oracle` is required and names the field that was read, e.g.
    `"satel.sold_pin.property_status"` — it is what makes the kill falsifiable later by re-reading
    the same field.

    The evidence write is best-effort and can never fail the pin: monitoring must not be able to
    keep a source-confirmed dead listing on screen. It is attempted AFTER the pin for the same
    reason — a listing the source says is gone stops being served even if the ledger is down.
    """
    pinnable, conflicted, evidence = plan_pin(
        ad_numbers, oracle, notes, live_ad_numbers, table,
    )
    if conflicted:
        print(
            f"{table}: {len(conflicted)} ad_number(s) marked gone on one post but seen LIVE on "
            f"another THIS crawl — HELD active, not pinned (a contradictory source is not "
            f"authoritative gone evidence): {', '.join(conflicted[:10])}",
            flush=True,
        )
    if not pinnable:
        return []

    for i in range(0, len(pinnable), _BATCH):
        db._execute(
            db.sb().table(table).update(dict(PIN_PAYLOAD)).in_("ad_number", pinnable[i:i + _BATCH]),
            what=table + ".sold_pin",
        )

    try:
        for i in range(0, len(evidence), _BATCH):
            db._execute(
                db.sb().table(EVIDENCE_TABLE).insert(evidence[i:i + _BATCH]),
                what=EVIDENCE_TABLE + ".insert",
            )
    except Exception as e:  # noqa: BLE001 — the ledger must never be able to block the pin
        print(f"{table}: could not record sold-pin evidence ({type(e).__name__}: {e})", flush=True)

    return pinnable
