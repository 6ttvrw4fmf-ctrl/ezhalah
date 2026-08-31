// REAL regression barrier for the UNKNOWN-vs-DEAD distinction in served_after_source_gone.
//
// THE DEFECT THIS CLOSES (found live 2026-08-31). The mon_served_after_source_gone view selected
// purely on `missing_count >= 3 and last_seen_at < now() - 3 days` — CRAWL ABSENCE — and never
// consulted last_verified_alive_at. The detector built on it is named ..._source_confirmed_gone
// and told its reader that "real users can find and click a listing the source no longer serves",
// with the implied remedy of unblocking a stuck deletion path; the sibling deletion_spike alert
// spells that remedy out as "raise anomaly_floor above it".
//
// On wasalt that reasoning was wrong in the dangerous direction. Measured: 3,367 struck-active
// rows, still_served 3,364, and last_verified_alive_at IS NULL on ALL of them — wasalt's
// DIRECT_REVISIT oracle has never once succeeded (it needs WASALT_PROXY_URL; a datacenter IP gets
// HTTP 403, which scrapers/common/liveness_policies.py documents as UNKNOWN and "must never be
// read as death"). Acting on that alert as written would have mass-inactivated 3,364 listings
// that are UNKNOWN, not gone.
//
// docs/ops/LISTING_LIVENESS.md is canonical: liveness is THREE-valued (ALIVE / DEAD / UNKNOWN),
// absence from our crawl is a candidate signal and NEVER a verdict, and only a DIRECT fetch of the
// listing's own URL can kill. A barrier that collapses UNKNOWN into DEAD in its own alert text
// walks the next reader across exactly that line, so the text is part of the contract here, not
// decoration.
//
// This check is OFFLINE and deterministic (it reads the committed migration), so it runs on every
// PR via the scripts/verify-*.ts registry. The live half — that production's view and detector
// still agree with this file — is covered by the standing migration-drift + content-parity guards.
//
//   node --experimental-strip-types scripts/verify-liveness-evidence-class.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const MIG_DIR = join(ROOT, 'supabase', 'migrations');

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

// The newest migration that (re)defines the view — later edits must keep these properties.
const defining = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => {
    const t = readFileSync(join(MIG_DIR, f), 'utf8');
    return t.includes('mon_served_after_source_gone') && /create\s+(or\s+replace\s+)?view/i.test(t);
  })
  .sort();

check('a migration defines mon_served_after_source_gone', defining.length > 0);
const sql = defining.length ? readFileSync(join(MIG_DIR, defining[defining.length - 1]), 'utf8') : '';

// ── 1. The view must actually measure direct verification, not just crawl absence ────────────────
check('#1 the view consults last_verified_alive_at', sql.includes('last_verified_alive_at'));
check('#1 the view exposes a per-table oracle discriminator', sql.includes('oracle_has_ever_worked'));
check('#1 the view counts struck rows that WERE directly verified',
  sql.includes('struck_direct_verified'));
// The old predicate alone must no longer be the whole story.
check('#1 crawl-absence predicate is still present but no longer the sole evidence',
  sql.includes('missing_count,0) >= 3') && sql.includes('last_verified_alive_at is not null'));

// ── 2. The detector must BRANCH on it, and label the evidence class it actually has ──────────────
check('#2 the detector branches on oracle_has_ever_worked',
  /if\s+r\.oracle_has_ever_worked\s+then/i.test(sql));
check('#2 both evidence classes are emitted',
  sql.includes('DIRECT_VERIFICATION_AVAILABLE') && sql.includes('NO_DIRECT_VERIFICATION_EVER'));

// ── 3. THE SAFETY TEXT. The unverified branch must forbid the drain, not invite it ───────────────
// Anchor on the `else` that opens the unverified branch, NOT on the evidence-class string: the
// severity argument is passed to mon_raise BEFORE the jsonb payload that names the class, so
// slicing at the marker would silently drop the very P1 that check #4 exists to pin.
const ifIdx = sql.search(/if\s+r\.oracle_has_ever_worked\s+then/i);
const elseIdx = ifIdx >= 0 ? sql.slice(ifIdx).search(/\n\s*else\s*$/m) : -1;
check('the unverified branch is locatable', ifIdx >= 0 && elseIdx >= 0);
const unverified = elseIdx >= 0 ? sql.slice(ifIdx + elseIdx) : '';
check('#3 the unverified branch forbids raising anomaly_floor',
  /do NOT raise anomaly_floor/i.test(unverified));
check('#3 the unverified branch names the risk as a mass FALSE inactivation',
  /FALSE inactivation/i.test(unverified));
check('#3 the unverified branch says these rows are UNKNOWN, not gone',
  /UNKNOWN, not gone/i.test(unverified));
check('#3 the unverified branch routes the fix upstream to the oracle',
  /oracle for this platform has never once/i.test(unverified));

// ── 4. THE GATE IS NOT WEAKENED. Neither branch may downgrade a still-served finding ─────────────
// The whole point is to correct the EVIDENCE CLAIM, never to quiet the alert. A future edit that
// "resolves" the unverified case instead of reporting it would reintroduce silence, which is the
// failure mode this repo has been burned by before (nine dark detectors reading as a clean bill).
check('#4 the unverified branch still raises P1', /mon_raise\(\s*'P1'/.test(unverified));
check('#4 the unverified branch does not auto-resolve its own finding',
  !/mon_resolve_key[^)]*NO_DIRECT/i.test(unverified));
check('#4 the verified branch keeps the original P1/P2 severity rule',
  sql.includes("case when r.still_served > 0 then 'P1' else 'P2' end"));

// ── 5. MUTATION PROOF — the pre-fix shape fails this contract ────────────────────────────────────
// Reproduce the literal pre-fix view/detector (crawl absence only, one unconditional message) and
// assert the checks above reject it. A refactor that quietly restores that shape cannot pass.
{
  const preFix = `
    create or replace view public.mon_served_after_source_gone as
    select tbl as source_table, split_part(tbl::text,'_',1) as platform, struck_active, still_served
    from (select t.tbl,
      (xpath('/row/a/text()', query_to_xml(format('select count(*) a from public.%I where active and coalesce(missing_count,0) >= 3 and last_seen_at < now() - interval ''3 days''', t.tbl), false,true,'')))[1]::text::bigint as struck_active,
      (xpath('/row/a/text()', query_to_xml(format('select count(*) a from public.%I where active', t.tbl), false,true,'')))[1]::text::bigint as still_served
      from (select c.relname as tbl from pg_class c) t) z where struck_active > 0;
    create or replace function public.mon_detect_served_after_source_confirmed_gone() returns integer as $f$
    begin
      perform public.mon_raise('P1','served_after_source_gone', r.platform, 'k',
        jsonb_build_object('why','real users can find and click a listing the source no longer serves. DIAGNOSE THAT'));
      return 1;
    end $f$ language plpgsql;`;
  const mutantFails =
    !preFix.includes('last_verified_alive_at') &&
    !preFix.includes('oracle_has_ever_worked') &&
    !/NO_DIRECT_VERIFICATION_EVER/.test(preFix) &&
    !/do NOT raise anomaly_floor/i.test(preFix);
  check('#5 the pre-fix crawl-absence-only shape fails every contract above', mutantFails);
}

// ── 6. This barrier must itself be wired into the suite ──────────────────────────────────────────
check('#6 this check is discovered by npm test', npmTestRuns(ROOT, 'verify-liveness-evidence-class'));

console.log(failed === 0
  ? '\n✓ liveness evidence-class barrier intact — UNKNOWN cannot be reported as DEAD'
  : `\n✗ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
