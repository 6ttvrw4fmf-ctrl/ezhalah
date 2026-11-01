# Impact: old definition vs new, measured read-only on production

First measured 2026-10-02 20:15-20:30 UTC; the fleet totals and the per-table 7-day and 24-hour
counts were measured again at 21:08-21:10 UTC with the later-alive rule in the body, and every number
came out the same. Nothing was written. The "new" columns come from running the exact body of
`migration.sql` as a plain SELECT (`_measure_new_body.sql`); the "old" columns come from calling the
live function in the same statement.

## Fleet totals (303 listing tables)

| window | old unverified | old deduplicated | new unverified | new deduplicated |
|---|---|---|---|---|
| last 24 h (about 16,450 hides) | 0 | 205 | **66** | 205 |
| last 7 d (about 46,800 hides, 72 tables) | 653 | 216 | **67** | 216 |

What moved:

- **+66 (24 h and 7 d): aqar_residential.** Hidden 01:07-01:10 UTC today with `missing_count = 3` and
  no kill row. Real finding: sweep shard 7 died before flushing its ledger buffer. The old definition
  could not see them.
- **+1 (7 d): eaqartabuk_residential.** Pruned 2026-09-26 04:29 UTC on absence, before the site got
  its oracle. A GONE row was written 10 h later by a re-probe, outside the 15-minute tolerance.
- **-653 (7 d): gathern_residential.** Hidden 2026-09-28 with `missing_count` 1-2. Every row has a
  GONE row and an applied kill row stamped at the hide. The old definition raised a P1 for them.
- Deduplicated is unchanged, row for row.

After the migration is applied the view reads **66** until about 01:10 UTC on 2026-10-03, when those
rows age out of the 24 h window. That P1 is correct.

## The later-alive rule (added in review)

A ledger row verifies a hide only when it is not older than the listing's newest alive reading:
`last_verified_alive_at`, or a LIVE row in `ops_stale_inactivation_probe` (by `listing_id` or
`ad_number`) probed at or before the hide.

Why: dealapp_residential DA410740. Ledger row 56546 GONE probed 02:35:58 UTC, hidden 11:30:46, ledger
row 57870 LIVE at 16:13:30 ("source relisted"), active again. It is the only GONE-then-LIVE pair inside
96 h in the ledger. The rule replayed on the real ledger rows, with imagined hide times:

| hide of DA410740 at | alive reading used | verified without the rule | verified with the rule |
|---|---|---|---|
| 11:30:46 (the real one) | none before it | yes | yes |
| 20:00, no new reading | LIVE row 16:13:30 | yes | **no** |
| 15:00, alive stamp 14:00, no LIVE row yet | the stamp | yes | **no** |
| 2026-10-06 02:30 (end of the 96 h) | LIVE row 16:13:30 | yes | **no** |

What it does to today's numbers, 21:09 UTC, 7 days, whole fleet:

| | rows |
|---|---|
| hides | 47,229 |
| with any alive reading at or before the hide | 13,161 |
| with one inside the 96 h before the hide | 3,833 |
| with probe evidence older than that reading (would flip to unverified) | **0** |
| still hidden with an alive stamp newer than the hide | **0** |

Totals stay 66/205 (24 h) and 67/216 (7 d), per table identical to the table below.

Of 1,601 LIVE rows in the ledger, 979 carry `ad_number` only and 267 `listing_id` only, so both keys
are read. UNKNOWN rows (5,233) are not read: they neither verify a hide nor cancel a GONE row.

## What the alert and the audit now say

The same migration replaces `mon_detect_unverified_inactivation()`: same logic, kinds, dedup keys and
thresholds; only the `contract`, `hint` and P2 `why` strings change. The old hint sent the reader to
`missing_count=0`; all 66 rows the first P1 will report have `missing_count = 3` (min 3, max 3). The
per-row query in `docs/ops/LIFECYCLE_ENGINEER.md` plus the aqar kill ledger returns exactly those 66
(one shard, id % 16 = 7, 01:07:07-01:10:08 UTC). `scripts/check_audit_invariants.py` says the same rule.

## Per table (every table where any column is not zero)

`u` = unverified, `d` = deduplicated. "No allowance" is the new definition WITHOUT the absence-tier
clause, shown so the cost of that choice is visible.

| table | registered strategy | hides 7 d / 24 h | old 24 h u/d | new 24 h u/d | old 7 d u/d | new 7 d u/d | no allowance 7 d u/d |
|---|---|---|---|---|---|---|---|
| gathern_residential | DIRECT_REVISIT | 26,202 / 1,144 | 0/0 | 0/0 | 653/0 | 0/0 | 0/0 |
| aqar_residential | DIRECT_REVISIT | 9,545 / 7,629 | 0/0 | **66**/0 | 0/0 | **66**/0 | 66/0 |
| dealapp_residential | CANDIDATE_PLUS_DIRECT | 5,530 / 4,332 | 0/0 | 0/0 | 0/1 | 0/1 | 0/1 |
| aqarcity_commercial | CANDIDATE_PLUS_DIRECT | 205 / 205 | 0/205 | 0/205 | 0/205 | 0/205 | 0/205 |
| aqarcity_residential | CANDIDATE_PLUS_DIRECT | 28 / 5 | 0/0 | 0/0 | 0/2 | 0/2 | 0/2 |
| dwelleo_residential | DIRECT_REVISIT | 13 / 1 | 0/0 | 0/0 | 0/1 | 0/1 | 0/1 |
| eaqartabuk_residential | DIRECT_REVISIT | 1 / 0 | 0/0 | 0/0 | 0/0 | **1**/0 | 1/0 |
| aqaratikom_residential | CRAWL_PRESENCE_ONLY | 3 / 0 | 0/0 | 0/0 | 0/0 | 0/0 | 2/0 |
| aqaratikom_commercial | CRAWL_PRESENCE_ONLY | 1 / 1 | 0/0 | 0/0 | 0/0 | 0/0 | 1/0 |
| shomou_residential | CRAWL_PRESENCE_ONLY | 3 / 1 | 0/0 | 0/0 | 0/1 | 0/1 | 2/1 |
| shomou_commercial | CRAWL_PRESENCE_ONLY | 1 / 0 | 0/0 | 0/0 | 0/0 | 0/0 | 1/0 |
| opensooq_residential | CRAWL_PRESENCE_ONLY | 2 / 0 | 0/0 | 0/0 | 0/0 | 0/0 | 2/0 |
| maqrat_residential | CRAWL_PRESENCE_ONLY | 1 / 0 | 0/0 | 0/0 | 0/0 | 0/0 | 1/0 |
| ashab_residential | SOURCE_LIST_PRESENCE | 2 / 0 | 0/0 | 0/0 | 0/1 | 0/1 | 1/1 |
| ksaaqar_residential | CRAWL_PRESENCE_ONLY | 3 / 0 | 0/0 | 0/0 | 0/3 | 0/3 | 0/3 |
| arkaan_residential | CRAWL_PRESENCE_ONLY | 1 / 0 | 0/0 | 0/0 | 0/1 | 0/1 | 0/1 |
| abralosol_residential | CRAWL_PRESENCE_ONLY | 1 / 0 | 0/0 | 0/0 | 0/1 | 0/1 | 0/1 |
| **total** | | | **0/205** | **66/205** | **653/216** | **67/216** | **77/216** |

The other 55 tables that hid anything in 7 days read 0 in every column. The largest: wasalt_residential
(3,614), aqar_commercial (434), sanadak_residential (371), dealapp_commercial (255), tuba_residential
(185), wasalt_commercial (86), aqarmonthly_residential (63), muhaysini_residential (46). The remaining
231 tables hid nothing.

## The one judgment call: absence-tier platforms

Without the allowance the 7-day count is 77, not 67. The extra 10 are hides by `prune_unseen` with no
oracle (aqaratikom 3, shomou 3, opensooq 2, ashab 1, maqrat 1), on 3 of the 7 days, and 2 of them fall
in the last 24 h (so today would read 68).

They are real absence-only hides. They are also already raised, per table, by
`mon_detect_unknown_treated_as_dead` (P1 on 09-30, 10-01 and 10-02 for these platforms). 50
platforms are declared in `scrapers/absence-only-prune.txt`, so counting them here would make this
fleet-wide P1 fire on most days for rows another P1 already owns. The allowance is one line
(`case when s.absence_tier then 'and coalesce(x.missing_count,0) < 3' else '' end`); replace it with
`''` to count them.

## Does the detector stay quiet?

| day (UTC) | old P1 fired? | new unverified that day |
|---|---|---|
| 09-26 | no | 1 (eaqartabuk) |
| 09-27 | no | 0 |
| 09-28 | yes, 658 (gathern, all evidenced) | 0 |
| 09-29 | yes, 506 | 0 |
| 09-30 | no | 0 |
| 10-01 | no | 0 |
| 10-02 | no | 66 (aqar shard 7) |

Two days in seven either way, but the old two were false alarms and the new two are hides with no
record.

## Tolerances, and what moves if they change

Ledger timestamp minus `deactivated_at`, 7 days:

| writer | earliest | latest |
|---|---|---|
| aqar liveness kill row | 0.75 s before | 0.05 s before |
| fleet_liveness / prune_unseen(verify_gone) / wasalt mirror | under 3 min before | 0 s |
| sanadak home-egress batch | 15 min before | 3 min before |
| aqar ad-end-date pins (09-28) | 2 h 41 min before | 2 h 06 min before |
| dealapp home-egress batch (09-28/29) | 3 h 08 min before | 1 min 22 s before |
| dealapp CI-crawl batch, 10-02 17:15 | 1 h 56 min before | 1 h 56 min before |
| dealapp CI-crawl batch, 10-02 11:30 (1,932 rows) | **3 d 08 h 57 min before** | 8 h 55 min before |
| sold pins | 0 s | 3 s after |
| retire_superseded_siblings | 0 s | 6 s after |
| gathern liveness kill row | 0.1 s after | **2 min 02 s after** |

- After-the-hide tolerance is 15 minutes: seven times the worst case measured.
- Before-the-hide tolerance is 96 hours. At 48 h the 10-02 11:30 dealapp batch adds 129 rows to today's
  count; at 24 h it adds 725. Everything else measured fits inside 4 hours.

## Cost

| | measured |
|---|---|
| old function, 24 h, whole fleet | 1.34 s |
| new body, 24 h, whole fleet | 2.45 s (20:26 UTC, before the later-alive rule); 1.77 s (21:09 UTC, with it, warmer cache) |
| new statement on gathern_residential (1,144 hides in window) | 117 ms, 18,492 buffers; ledger lookups 0.009-0.037 ms each, by index |
| new statement on aqar_residential (7,629 hides in window, 66 unverified) | 215 ms, 44,497 buffers. A first draft without the inner `offset 0` took 538 ms because the twin lookup ran twice per unverified row at 2.5 ms each; with it the planner hashes the sibling's 5,292 active rows once |
| detector roster this runs inside | about 300 s per run, 900 s timeout |

Single runs, taken while the hourly search sync was running; not averaged.

The new function scans each listing table once instead of twice. The ledger lookups run only for rows
already inside the time window. Neither sibling looked at (aqar_commercial,
gathern_commercial) has an index on `listing_url`; the old function paid that lookup per unverified
row, the new statement hashed the sibling once.

## Not verified

- Neither function was created anywhere. The counting body was run as a SELECT; the `returns table`
  wrapper, `security definer` behaviour and the replaced detector are untested until applied. The
  detector's body is the committed 2026-09-06 text with three strings changed (live md5
  `f30c15131f1adffb940a73cea6ebf210`, counts function `364f925e0c9a85a1b5198bd5c9ef2933`, both read
  21:06 UTC; check them again in the same step as the apply).
- The later-alive rule has never fired on a real hide (0 rows in 7 days). It was exercised only by
  the replay above.
- The branch was not rebased. `origin/main` moved (1bdde38d) and touched other parts of
  `docs/ops/LIFECYCLE_ENGINEER.md`; the hunks do not overlap.
- 7 days is the whole backtest. `aqar_liveness_detail` only starts 2026-09-13 and the wasalt mirror
  2026-09-08, so a 90-day run of the new definition would count every older hide as unverified. Do not
  run it over a window longer than about 19 days and read the result as a finding.

## Tests

| run | result |
|---|---|
| `scripts/run-tests.mjs --all`, branch as pushed (no migration file) | 563 of 564 pass, 338 s. The 1 failure is `verify-unverified-inactivation-reads-evidence.ts`, which rejects the 2026-09-06 definition still newest in the tree (by design until this migration is committed). Log: `_suite_branch_as_pushed.log` |
| same, with `migration.sql` copied into `supabase/migrations/` (not committed) | 564 of 564 pass, 332 s. Log: `_suite_with_migration.log` |
| `python3 -m pytest scrapers/common/tests -q` | 5,994 passed, 3 skipped |
| the barrier before this repair + the old migration + an added UNKNOWN clause | passed (the reviewer's finding, reproduced) |
| the barrier now + the new migration + an added UNKNOWN probe clause, or an added aqar strike clause | fails, one violation each (the verdict rule) |
| the barrier now + the migration as it was before this repair | fails (no `>= v.alive_at`, no `alive_at`) |
