# Detectors that raise once and then freeze their alert — ready to apply (🔧 repair, 2026-11-04 PM)

`01_detectors_reaffirm_inline_guard.sql` makes these four detectors call `mon_raise()` on every sweep while
their condition still holds: `served_total_below_city_floor` (P1, still showing 430 rows from 2026-10-18 when the
live set is 147), `af_view_drops_stored_answer`, `served_pin_outside_ksa` and `wasalt_street_width_misread`. It
also widens `mon_detect_alert_reaffirmation` LIMB B so it catches the inline
`elsif not exists (select … alert_event … resolved_at is null) then` spelling.

It is NOT applied yet. `apply_migration` asked for an interactive confirmation (the file contains LIMB A's existing
scratch-row `delete from public.alert_event`, which the tool flags as destructive), and the unattended run could
not answer. To apply without the prompt, run the four detector functions as one migration and the
`mon_detect_alert_reaffirmation` body as a second, or confirm the prompt. Pre-checked: `check-migration-before-apply.ts`
passes, and the LIMB B regex, run against live `pg_proc`, lists exactly the four.

After applying: mirror the minted version(s) byte-exact (`ops_migration_sql`), replace `20261104212932` in
`scripts/verify-detectors-reaffirm-open-alerts.ts` with the real first version, and add the mirror file to this branch.
Until then that barrier is RED on this branch, which is correct: the four detectors are still guarded.
