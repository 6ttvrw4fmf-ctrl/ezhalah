# Run 2026-09-04 — the barriers were wrong, not the product

**Routine:** 🎯 Senior Advanced Filter + Trending Data Integrity Engineer (#5)
**Contract read:** `docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md` @ blob `2517175`
**PR:** #1680 · **Head at start:** `0e2350a`

---

## What the run found

The AF backend-truth live workflow had been RED on every run since the last green schedule on
2026-09-02 (2026-09-03's schedule was CANCELLED at its timeout). Today's scheduled run
[33855677911](https://github.com/6ttvrw4fmf-ctrl/ezhalah/actions/runs/33855677911) failed three of
its five jobs. The attendance job (added 2026-09-03) correctly refused to report the run clean.

**All three failures were the harness. Advanced Filter was correct in every case.** Each was proven
against the same deployed bundle, by hand, before anything was changed — per §0.1, a
contract-vs-production disagreement is investigated, not reinterpreted.

| # | Job | Reported | Actually |
|---|---|---|---|
| 1 | full-surface differential | `Villa+Farm/Buy @region:1` — 4 checks red, baseline included | chip 11,720 = search 11,720 = 11,720 paged ids = 11,720 oracle rows; 0 missing/extra/dupes; union 11,670 + 50 |
| 2 | card evidence (§12A) | "no AF predicate was committed — §12A could not be exercised" | 4 questions confirm fine on that exact scope; 40 question×card comparisons pass |
| 3 | live truth (9 journeys) | "Back restores the previous question — got=null" | Back restores Q1, its 2,415 count and all 12 options in 2.5 s, held for 60 s |

## Root causes

**1 — a verdict that straddled an index rebuild.** `sync_search_listings_ar` (pg_cron jobid 28) runs
at `:14` past every hour and the location MV refresh (jobid 17) at `:20`. The differential reads for
~28 minutes, and its chip is captured **once per cohort** then judged against reads taken minutes
later. Villa+Farm/Buy is the largest multi-type pair in the sweep, and its stage ran at 09:14–09:21 —
inside both cron windows. The comparison was between two different databases.

Note the reporting asymmetry this exposed: the baseline check incremented **no metric at all**, which
is why the summary read `COUNT MISMATCHES: 3` beside four failures.

**2 & 3 — reading an agent-rendered state once, after a fixed sleep.** The AF card mounts when a
round opens; its options render when the agent's turn resolves — a paid LLM round-trip measured near
40 s. One journey read `af-option-*` once at 2,500 ms; the other clicked «رجوع» at 1,200 ms without
proving the round had advanced. R8.2.1 (Back steps back) and R8.2.2 (Back on question **one**
cancels the round, leaving no card) are different correct behaviours of the same button, and only the
step the card is on tells them apart — so a lost race made production's correct R8.2.2 look like a
broken R8.2.1.

## Fixes

- `settleOnOneIndex()` brackets a re-read with an index fingerprint (row count + newest write). A
  disagreement is reported only when it survives a re-read **proven** to span no rebuild; one that
  cannot be settled is `UNDECIDED` — counted, named, printed, floored at 1% of the surface. Unreadable
  stamp fails **closed**. This is R2.5.4/R13.11 turned on the harness, not a tolerance: the counts are
  a deterministic function of the index, so a real defect reproduces on every stable read.
- Both journeys now poll for the state they act on, and a rule that could not be reached is reported
  `NOT EXERCISED` — never folded into the passes.
- **The class, not the examples:** `verify-af-live-journey-polling.ts` (offline, `npm test`) pins the
  invariant in source, where it is deterministic. This shape had already cost four false accusations
  (2026-08-24, 2026-09-03, 2026-09-04 ×2), each previously fixed by widening a number.

15 mutation proofs in total (5 offline judge + 3 live against production + 7 source).

## Standing lessons for the next run

1. **Any live sweep longer than an hour reads across a rebuild.** `search_listings_ar` is rewritten at
   `:14` and its MV refreshed at `:20`. A witness captured once and reused across a cohort is stale by
   construction. Bracket, or capture adjacent.
2. **A race cannot be mutation-proven by running it** — the broken version passes on a fast afternoon.
   Pin it in source.
3. **Widening a timeout fixes the example.** The fourth repetition of a timing failure is the signal
   that the class was never addressed.
4. `max(last_updated)` on `search_listings_ar` lags the sync (it is a source-crawl stamp); the row
   count is the sensitive half of the fingerprint. A rebuild that moved neither would be missed — and
   that misses in the **safe** direction, reporting a failure rather than certifying one away.
