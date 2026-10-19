// Regression guard — an aqar price repair must survive the next liveness sweep.
// Senior audit run #10, 2026-08-11.
//
// THE BUG THIS PINS
// -----------------
// A SQL-side price repair on aqar had a ONE-SWEEP HALF-LIFE. Proof found live, not inferred:
// ids 1015536 / 1017694 / 1019212 carry price_per_meter = 1 (aqar's «سعر المتر 1» rial-per-meter
// gimmick) and price_total exactly equal to area_m2 (680,000 / 3,000,000 / 2,000,000). aqar_parse()
// — carrying the AREA-ARTIFACT GUARD from 20260810202219 — returns NULL for all three, so the parser
// already knew they were not prices and PR#440 had NULLed them on 2026-08-10. The rows held the
// artifact again, last_seen_at = 2026-08-11 01:00:19: the daily aqar liveness sweep (cron jobid 6)
// had re-written it. scrape_runs for that window show price_updated=6/8/9 per shard.
//
// trg_aqar_parse cannot stop that write — its first branch returns early when source_capture is
// unchanged and fullparse_done is true, which is exactly the shape of a liveness UPDATE, so the
// parser never runs. Hence a guard that sits on the WRITE PATH itself (the 2026-08-06 wasalt lesson,
// audit run #6, applied to aqar) and therefore protects against EVERY writer, not just this one.
//
// WHAT MUST NOT REGRESS
//   * the guard must keep firing on UPDATE (that is where a repair gets reverted);
//   * it must never block a NULL write — NULL is how an honest "unknown" is recorded;
//   * it must never block an ordinary price change — the owner-approved 2026-08-04 price refresh
//     has to keep working, so the predicate must stay pinned to the two proven artifact signatures;
//   * it must keep honouring ops_price_eq_area_verified, or a source-real coincidence (id 132677,
//     «المطلوب: 2,000,000» for a 2,000,000 m² plot at 1 ﷼/m²) would be suppressed;
//   * the trigger must keep sorting AFTER aqar_parse_bi, or it would inspect a pre-parse value.
//
// Both directions were proven against the real production row before this landed: writing 2,690
// (the ppm) to id 7026223 left it at 11,000,000, and writing 12,000,000 was accepted normally.
//
// MUTATION-PROVEN SINCE 2026-09-25 (routine #10, R1). Until then this file was on
// scripts/mutation-proof-grandfathered.txt — a guard over the highest-blast-radius thing this repo
// has (a PRICE that can be silently rewritten) that nobody had ever watched go red. Nine conditions
// were asserted and not one of them had been shown to fail on the defect it names, so "the aqar
// price guard is intact" rested on nine regexes nobody had tested. The predicate is now the pure
// function `guardProblems(body, wiring)`, fed the REAL committed SQL for the negative control and a
// broken copy of it for each proof, so both directions are recorded.
//
// Deliberately OFFLINE (reads only the repo's own migration files — no DB, no network).
//   node --experimental-strip-types scripts/verify-aqar-price-artifact-write-guard.ts

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
const all = files.map((f) => ({ f, sql: readFileSync(join(MIGRATIONS_DIR, f), 'utf8') }));

let failed = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass || !detail ? '' : `  → ${detail}`}`);
};
/** A mutation proof: the real regression put back into the real SQL, asserted to go RED. */
const mustCatch = (label: string, problems: string[]) =>
  ok(`(mutation) catches ${label}`, problems.length > 0, 'the audit passed deliberately broken input');

console.log('verify-aqar-price-artifact-write-guard: a price repair must survive the next sweep.\n');

export const TRIGGER = 'aqar_price_artifact_guard_bu';
export const TABLES = ['aqar_residential_listings', 'aqar_commercial_listings'];

/** Prose can never satisfy a check. Stripped at the READER, so a condition left behind as a SQL
 *  comment reads as MISSING — proved by the decoy mutation below. */
const codeOnly = (sql: string) => sql.replace(/--.*$/gm, '');

/** THE WHOLE VERDICT, as a pure function over the guard body and the migration corpus, so every
 *  proof below is a statement about the code that decides it rather than about a copy. */
export function guardProblems(body: string, wiring: string): string[] {
  const bad: string[] = [];
  if (!body || !body.trim()) {
    // Fail CLOSED: no definition found is UNKNOWN, never "nothing to check".
    return ['trg_aqar_reject_price_artifact is not defined in any committed migration — repo and '
      + 'production disagree, or the guard was deleted. UNKNOWN, never green'];
  }
  const code = codeOnly(body);

  // (1) Both proven artifact signatures are rejected.
  if (!/NEW\.price_total\s*=\s*NEW\.area_m2/.test(code))
    bad.push('no longer rejects a price equal to the row area (price == area_m2) — the exact shape of ids 1015536 / 1017694 / 1019212');
  if (!/NEW\.price_total\s*=\s*NEW\.price_per_meter/.test(code))
    bad.push('no longer rejects a price equal to the row per-meter figure (price == price_per_meter) — aqar\'s «سعر المتر 1» gimmick');

  // (2) It restores the OLD value rather than inventing one — no fabricated replacement, ever.
  if (!/NEW\.price_total\s*:=\s*OLD\.price_total/.test(code))
    bad.push('a rejected write no longer keeps the stored value (NEW.price_total := OLD.price_total)');
  if (/NEW\.price_total\s*:=\s*(?!OLD\.price_total)[^;]*[*/+]/.test(code))
    bad.push('the guard now assigns a COMPUTED price on the way in — a derived price is exactly what SOURCE IS TRUTH forbids');

  // (3) A NULL write must always pass — that is how an honest unknown is recorded.
  if (!/NEW\.price_total\s+is\s+null/.test(code))
    bad.push('a NULL price write is no longer let through — an honest unknown would be blocked, which is unknown→NO in the write path');

  // (4) Only UPDATE, and only a real change — an ordinary refresh must not be disturbed.
  if (!/TG_OP\s*<>\s*'UPDATE'/.test(code))
    bad.push('no longer scoped to UPDATE');
  if (!/NEW\.price_total\s+is\s+not\s+distinct\s+from\s+OLD\.price_total/.test(code))
    bad.push('no longer ignores writes that do not change the price — an ordinary refresh would be disturbed');

  // (5) The source-verified allowlist is honoured.
  if (!/ops_price_eq_area_verified/.test(code))
    bad.push('no longer honours ops_price_eq_area_verified — a source-real coincidence (id 132677) would be suppressed');

  // (6) Trigger wiring: both aqar tables, BEFORE UPDATE, and sorting AFTER aqar_parse_bi so the
  //     guard sees the post-parse value. Postgres fires same-timing triggers in name order.
  for (const table of TABLES) {
    const re = new RegExp(`create\\s+trigger\\s+${TRIGGER}\\s+before\\s+update\\s+on\\s+public\\.${table}`, 'i');
    if (!re.test(wiring)) bad.push(`the trigger is not wired BEFORE UPDATE on ${table} — that table's writes are unguarded`);
  }
  if (!(TRIGGER > 'aqar_parse_bi'))
    bad.push(`the trigger name «${TRIGGER}» no longer sorts after 'aqar_parse_bi', so it would inspect a PRE-parse value`);

  return bad;
}

// ── the real, shipped inputs ────────────────────────────────────────────────────────────────────
// Last definition wins, same principle as the other replay verifiers.
export function guardBodyFrom(corpus: Array<{ sql: string }>): string {
  const re = /create\s+or\s+replace\s+function\s+public\.trg_aqar_reject_price_artifact\b[\s\S]*?\$function\$([\s\S]*?)\$function\$/gi;
  let body = '';
  for (const { sql } of corpus) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) body = m[1];
    re.lastIndex = 0;
  }
  return body;
}

const body = guardBodyFrom(all);
const wiring = all.map((x) => x.sql).join('\n');

ok('trg_aqar_reject_price_artifact is defined in a committed migration (repo == prod)', body.length > 0);

const live = guardProblems(body, wiring);
ok('the write-path guard as it stands is intact', live.length === 0, `\n      ${live.join('\n      ')}`);

ok('npm test discovers and runs this check',
  npmTestRuns(ROOT, 'verify-aqar-price-artifact-write-guard'), 'not in the resolved run set');

// ── MUTATION PROOFS — each is a real regression applied to the REAL committed SQL ────────────────
console.log('\nmutation proofs (each must turn the rule RED):');
const drop = (needle: RegExp | string, replacement = '') => body.replace(needle as never, replacement);
const applied = (m: string) => ok(`  …the mutation actually applied`, m !== body, 'pattern drifted — fix the mutant, not the rule');

{
  const m = drop(/NEW\.price_total\s*=\s*NEW\.area_m2/, 'false');
  applied(m);
  mustCatch('the price==area signature removed — the repair reverts on the next sweep', guardProblems(m, wiring));
}
{
  const m = drop(/NEW\.price_total\s*=\s*NEW\.price_per_meter/, 'false');
  applied(m);
  mustCatch('the price==price_per_meter signature removed («سعر المتر 1» writes back)', guardProblems(m, wiring));
}
{
  const m = body.replace(/NEW\.price_total\s*:=\s*OLD\.price_total/, 'NEW.price_total := NEW.area_m2 * NEW.price_per_meter');
  applied(m);
  mustCatch('a rejected write INVENTING a price instead of keeping the stored one', guardProblems(m, wiring));
}
{
  const m = drop(/NEW\.price_total\s+is\s+null/, 'false');
  applied(m);
  mustCatch('the NULL allowance removed — an honest unknown blocked at the write path', guardProblems(m, wiring));
}
{
  const m = drop(/TG_OP\s*<>\s*'UPDATE'/, 'false');
  applied(m);
  mustCatch('the UPDATE scoping removed', guardProblems(m, wiring));
}
{
  const m = drop(/NEW\.price_total\s+is\s+not\s+distinct\s+from\s+OLD\.price_total/, 'false');
  applied(m);
  mustCatch('the no-op-change guard removed — an ordinary price refresh is now disturbed', guardProblems(m, wiring));
}
{
  const m = drop(/ops_price_eq_area_verified/, 'ops_nothing_at_all');
  applied(m);
  mustCatch('the source-verified allowlist removed — a real 1﷼/m² plot is suppressed', guardProblems(m, wiring));
}
mustCatch('the trigger unwired from the COMMERCIAL table (one table guarded, one not)',
  guardProblems(body, wiring.replace(
    new RegExp(`create\\s+trigger\\s+${TRIGGER}\\s+before\\s+update\\s+on\\s+public\\.aqar_commercial_listings`, 'i'),
    'create trigger something_else before update on public.aqar_commercial_listings')));
mustCatch('the guard deleted outright — no committed definition is UNKNOWN, never green',
  guardProblems(guardBodyFrom([{ sql: '-- nothing here defines the guard\n' }]), wiring));
{
  // THE DECOY. This file's own subject matter means the forbidden and required shapes appear in
  // prose; a reader that did not strip `--` comments would be satisfied by the explanation of the
  // bug it forbids.
  const m = body
    .replace(/NEW\.price_total\s*=\s*NEW\.area_m2/, 'false')
    + '\n  -- was: NEW.price_total = NEW.area_m2  (restore if the sweep regresses)\n';
  mustCatch('the area signature deleted but left behind as a SQL COMMENT claiming it is still there',
    guardProblems(m, wiring));
}

// ── NEGATIVE CONTROLS — the predicate is not red for everything ──────────────────────────────────
console.log('\nnegative controls (the shipped SQL must NOT be flagged):');
ok('the committed guard body and wiring are clean', guardProblems(body, wiring).length === 0);
ok('a body carrying every condition is accepted even with unrelated SQL around it',
  guardProblems(`${body}\n  perform pg_notify('x','y');\n`, wiring).length === 0);

console.log(
  failed === 0
    ? '\n✓ write-path guard intact: the artifact classes cannot be written back over a repair'
    : `\n✗ ${failed} check(s) FAILED — an aqar price repair could be reverted by the next sweep`,
);
process.exit(failed === 0 ? 0 : 1);
