# Source posting date — prepared SQL, NOT applied

**Nothing in this folder has been run against production.** It was written on 2026-11-09 on branch
`data/source-posting-date-fill` by a run that was allowed to read production and not to write to it.
The files sit here, and not in `supabase/migrations/`, because a file there claims a migration was
applied. Whoever applies them moves each one into `supabase/migrations/` under the version
`apply_migration` mints (AGENTS.md «Migration drift guard»).

The rule this serves: every time-window welcome fact counts an ad by the date its SITE says it was
posted — `date_added`, read by `public.source_posted_at()` (`docs/ARCHITECTURE.md` §20, owner
2026-10-26). The per-platform table of who publishes a date and which field we read is in §20.

## What is here

| file | what it does |
|---|---|
| `01_backfill_date_added_from_captured_site_date.sql` | Copies the site's posting date that the scraper already captured in the row into `date_added`, only where `date_added` is NULL. 79,456 rows on 11 tables (62,085 of them active). At most 20,000 rows per run: run it 4 times, until it prints «0 rows left». |
| `02_detector_source_posting_date_fill_regressed.sql` | Table `ops_source_posting_date_policy` (who publishes a date, the field, the measured baseline), detector `mon_detect_source_posting_date_fill_regressed()`, its roster entry, its lane routing, and a proof that runs at apply. |

## Order

1. Merge the scraper change (same branch). From then on new rows get `date_added` on every crawl.
2. Apply `01`, one run at a time, each when the database is quiet (`pg_stat_activity`: active
   `authenticator` queries > 8, or any query over 5 s → wait).
3. Let sakan and aqarcity crawl once. Their old rows hold no captured date, so only a re-crawl fills
   them (sakan 2,377 active rows, aqarcity 676 active rows had none on 2026-11-09).
4. Apply `02`. Applied earlier it would truthfully name every platform whose new rows are still
   undated — true alarms, but about work already done.
5. After sakan's first crawl, re-measure its fill rate and correct its row in
   `ops_source_posting_date_policy`: its baseline of 100 is EXPECTED (2 of 2 pages read), not measured.

## What was checked, and how

Read-only, on production, 2026-11-09:

- Every before-count in the header of `01`.
- The backfill's value expression, run as a SELECT over a 3 % sample of dealapp and every row of the
  other tables: the instant never moved, the written day always equalled the Saudi day of the
  captured stamp, and it equals what `scrapers/common/posting_date.py` writes for the same input.
- The backfill's statement text renders correctly through `format()`.
- The detector's per-table counting statement, run as a SELECT on tuba (66 of 66 new rows dated →
  quiet) and aqarcity (0 of 152 → would be named).
- Both needle-insert anchors exist in the live `mon_run_all_detectors()` and
  `ops_engineer_for_alert()`.

**Not checked:** neither `do $$` block and neither function has ever been executed, anywhere. The
proof block in `02` is what tests them, at apply.

## Known limits

- The four `'no'` rows (gathern, aqarmonthly, rakez, sakani) come from a survey of the scrapers; no
  ad page was re-read for them. Fill `proof_url` when one is.
- wasalt is `'unknown'`: the scraper only sees `regaAdvLicDate`, a licence date. It needs a live
  probe from CI egress.
- A platform with no row in the policy table is not watched.
- The card's «أضيف» date chip reads `date_added`, so it will start showing on the filled platforms.
