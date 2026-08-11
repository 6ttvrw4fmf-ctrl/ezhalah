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
// Deliberately OFFLINE (reads only the repo's own migration files — no DB, no network).
//   node --experimental-strip-types scripts/verify-aqar-price-artifact-write-guard.ts

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'supabase', 'migrations');
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
const all = files.map((f) => ({ f, sql: readFileSync(join(MIGRATIONS_DIR, f), 'utf8') }));

let failed = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass || !detail ? '' : `  → ${detail}`}`);
};

console.log('verify-aqar-price-artifact-write-guard: a price repair must survive the next sweep.\n');

// Last definition wins, same principle as the other replay verifiers.
let body = '';
const re =
  /create\s+or\s+replace\s+function\s+public\.trg_aqar_reject_price_artifact\b[\s\S]*?\$function\$([\s\S]*?)\$function\$/gi;
for (const { sql } of all) {
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) body = m[1];
  re.lastIndex = 0;
}

ok('trg_aqar_reject_price_artifact is defined in a committed migration (repo == prod)', body.length > 0);
if (!body) process.exit(1);

const code = body.replace(/--.*$/gm, ''); // prose can never satisfy a check

// (1) Both proven artifact signatures are rejected.
ok('rejects a price equal to the row area (price == area_m2)',
  /NEW\.price_total\s*=\s*NEW\.area_m2/.test(code));
ok('rejects a price equal to the row per-meter figure (price == price_per_meter)',
  /NEW\.price_total\s*=\s*NEW\.price_per_meter/.test(code));

// (2) It restores the OLD value rather than inventing one — no fabricated replacement, ever.
ok('a rejected write keeps the stored value (NEW.price_total := OLD.price_total)',
  /NEW\.price_total\s*:=\s*OLD\.price_total/.test(code));
ok('never assigns a computed/derived price (no arithmetic on the way in)',
  !/NEW\.price_total\s*:=\s*(?!OLD\.price_total)[^;]*[*/+]/.test(code));

// (3) A NULL write must always pass — that is how an honest unknown is recorded.
ok('allows a NULL price write (honest unknown is never blocked)',
  /NEW\.price_total\s+is\s+null/.test(code));

// (4) Only UPDATE, and only a real change — an ordinary refresh must not be disturbed.
ok('scoped to UPDATE', /TG_OP\s*<>\s*'UPDATE'/.test(code));
ok('ignores writes that do not change the price',
  /NEW\.price_total\s+is\s+not\s+distinct\s+from\s+OLD\.price_total/.test(code));

// (5) The source-verified allowlist is honoured.
ok('honours ops_price_eq_area_verified (a source-real coincidence stays)',
  /ops_price_eq_area_verified/.test(code));

// (6) Trigger wiring: both aqar tables, BEFORE UPDATE, and sorting AFTER aqar_parse_bi so the guard
//     sees the post-parse value. Postgres fires same-timing triggers in name order.
const wiring = all.map((x) => x.sql).join('\n');
const TRIGGER = 'aqar_price_artifact_guard_bu';
for (const table of ['aqar_residential_listings', 'aqar_commercial_listings']) {
  const re2 = new RegExp(
    `create\\s+trigger\\s+${TRIGGER}\\s+before\\s+update\\s+on\\s+public\\.${table}`, 'i');
  ok(`trigger wired BEFORE UPDATE on ${table}`, re2.test(wiring));
}
ok(`trigger name sorts after 'aqar_parse_bi' (guard sees the post-parse value)`,
  TRIGGER > 'aqar_parse_bi', `${TRIGGER} vs aqar_parse_bi`);

console.log(
  failed === 0
    ? '\n✓ write-path guard intact: the artifact classes cannot be written back over a repair'
    : `\n✗ ${failed} check(s) FAILED — an aqar price repair could be reverted by the next sweep`,
);
process.exit(failed === 0 ? 0 : 1);
