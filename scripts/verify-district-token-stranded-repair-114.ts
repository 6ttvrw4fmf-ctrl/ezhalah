// ops_incident #114: a doubled «حي » prefix survives norm_district_tok(), stranding listings from
// their own real حي (e.g. «حي حي الشرفة» normalizes to «حي الشرفه» instead of «شرفه», so it shares
// no token with every other «حي الشرفة» listing that never got double-prefixed).
//
// OWNER APPROVAL, GRANTED 2026-09-06, EXECUTED 2026-09-11 on direct owner instruction in-session
// ("If #114 truly already contains my approval and the intended mapping is documented, execute it.
// Do not ask me to approve the same thing again."). Verbatim approved scope — nothing wider:
//   norm_district_tok() regexp  '^حي\s+'  ->  '^(حي\s+)+'
//   REINDEX INDEX idx_slar_district_tok
//   select refresh_loc_display_district_canon();
//
// This guard is hermetic — no database, no network — and pins the migration's committed SQL text:
// the widened regex must be present and the old single-strip regex gone, the mandatory REINDEX and
// canon refresh must both be committed in the SAME migration (a body-only fix would leave the
// expression index silently stale — district search would return short results with NO error,
// exactly the invisible-failure shape LISTING_LIVENESS-style docs warn about), and the migration
// must record the live oracle verification this session ran before applying (so a future reader
// does not have to re-derive it from the ops_incident text alone).
//
//   node --experimental-strip-types scripts/verify-district-token-stranded-repair-114.ts

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '❌'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
};

console.log('\nnorm_district_tok strips a REPEATED «حي » prefix, and the expression index is rebuilt\n');

const MIG = '20260911221510_district_token_stranded_repair_owner_approved_incident_114.sql';
const migrations = readdirSync(join(root, 'supabase/migrations'));
check('the owner-approved #114 migration is committed', migrations.includes(MIG), `${MIG} not found`);

const sql = migrations.includes(MIG) ? readFileSync(join(root, 'supabase/migrations', MIG), 'utf8') : '';

check('norm_district_tok is redefined with the widened (one-or-more) prefix regex',
  sql.includes("regexp_replace(regexp_replace(public.normalize_ar(coalesce(t,'')), '^(حي\\s+)+', ''), '^ال', '')"),
  'the approved widened regexp string was not found verbatim');

check('the old single-strip regex is gone from the new function body',
  !/regexp_replace\(regexp_replace\(public\.normalize_ar\(coalesce\(t,''\)\), '\^حي\\s\+', ''\)/.test(sql),
  'the pre-fix single-prefix regex still appears — the widening did not actually replace it');

check('the mandatory REINDEX ships in the SAME migration (an expression index over an IMMUTABLE '
    + 'function does not self-invalidate — skipping this makes district search silently short, no error)',
  /REINDEX INDEX idx_slar_district_tok/i.test(sql));

check('refresh_loc_display_district_canon() is called in the SAME migration',
  /select public\.refresh_loc_display_district_canon\(\);/.test(sql));

check('the migration records the live oracle verification run before applying (نجران/شرفه, '
    + 'المدينة المنورة/خضراء, and the fleet-wide "exactly 2 groups change" proof)',
  sql.includes('شرفه') && sql.includes('خضراء') && /fleet-wide/i.test(sql),
  'the pre-apply verification evidence is not recorded in the migration for a future reader');

// ── MUTATION PROOF — this check must fail on the pre-fix (single-strip) shape ──────────────────────
const mustCatch = (label: string, checkPassesOnBrokenInput: boolean) => {
  check(`MUTATION ${label} — the check catches it`, checkPassesOnBrokenInput === false,
    'the check passed on the deliberately reverted (pre-fix) shape, so it cannot catch a regression');
};
const PRE_FIX_BODY = `
create or replace function public.norm_district_tok(t text)
returns text
language sql
immutable
as $function$
  select regexp_replace(regexp_replace(public.normalize_ar(coalesce(t,'')), '^حي\\s+', ''), '^ال', '');
$function$;
`;
mustCatch('reverting to the single-strip (pre-fix) regexp',
  PRE_FIX_BODY.includes("regexp_replace(regexp_replace(public.normalize_ar(coalesce(t,'')), '^(حي\\s+)+', ''), '^ال', '')"));
mustCatch('a body-only fix with no REINDEX would still pass the REINDEX check',
  /REINDEX INDEX idx_slar_district_tok/i.test(PRE_FIX_BODY));

console.log(failed
  ? `\n✗ verify-district-token-stranded-repair-114: ${failed} check(s) failed.\n`
  : '\n✅ verify-district-token-stranded-repair-114: the approved #114 scope shipped exactly, nothing '
    + 'wider.\n');
process.exit(failed ? 1 : 0);
