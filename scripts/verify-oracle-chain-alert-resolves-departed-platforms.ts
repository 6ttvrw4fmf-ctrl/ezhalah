// mon_detect_oracle_chain_never_observed must resolve the alert of a platform that LEFT its judged set
// (2026-11-04, migration 20261104095034).
//
// The detector raises per platform registered DIRECT_REVISIT / CANDIDATE_PLUS_DIRECT with active rows, and
// used to resolve a key only inside that loop. almuteb was retired (owner decision 2, 2026-11-04: its
// registry row removed, its 11 rows hidden) and oracle_chain_never_observed:almuteb (alert 5239) stayed
// open after the detector re-ran — an alert describing a claim the platform no longer makes, forever.
//
// Hermetic: reads the LATEST committed migration that (re)defines the function — that is what production
// runs — and asserts it carries the after-loop resolve of keys absent from the judged set, keyed on the same
// predicate the raise loop uses. Mutation-proven below on the real file content.
//
//   node --experimental-strip-types scripts/verify-oracle-chain-alert-resolves-departed-platforms.ts

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(import.meta.dirname, '..', 'supabase', 'migrations');
const FN = /create\s+or\s+replace\s+function\s+public\.mon_detect_oracle_chain_never_observed\s*\(/i;

const latest = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  .filter((f) => FN.test(readFileSync(join(MIGRATIONS, f), 'utf8'))).pop();

function problems(sql: string): string[] {
  const body = sql.slice(sql.search(FN));
  const out: string[] = [];
  const loopStart = body.search(/\n\s*loop\b/);
  const afterRaiseLoop = body.slice(body.search(/end loop;/i) + 1);
  if (loopStart < 0) out.push('no raise loop found');
  // The departure sweep: open keys of this kind whose platform is NOT in the judged set → resolved.
  if (!/from\s+public\.alert_event\s+a[\s\S]*?a\.kind\s*=\s*'oracle_chain_never_observed'[\s\S]*?a\.resolved_at\s+is\s+null/i.test(afterRaiseLoop))
    out.push('no sweep over OPEN oracle_chain_never_observed alerts after the raise loop');
  if (!/not\s+exists\s*\([\s\S]*?ops_platform_liveness_coverage[\s\S]*?'DIRECT_REVISIT',\s*'CANDIDATE_PLUS_DIRECT'[\s\S]*?c\.active\s*>\s*0/i.test(afterRaiseLoop))
    out.push('the sweep does not exclude exactly the judged set (strategy + active > 0)');
  if (!/__feed__/.test(afterRaiseLoop))
    out.push('the sweep could resolve the __feed__ (unjudgeable) alert');
  if (!/mon_resolve_key\('oracle_chain_never_observed',\s*r\.dedup_key\)/.test(afterRaiseLoop))
    out.push('the sweep does not resolve the departed key');
  return out;
}

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

check('a committed migration defines mon_detect_oracle_chain_never_observed', Boolean(latest));
const sql = latest ? readFileSync(join(MIGRATIONS, latest), 'utf8') : '';
const p = problems(sql);
check(`the latest definition (${latest}) resolves departed platforms`, p.length === 0, p.join('; '));

// Mutation proofs on the real file.
const cut = sql.replace(/-- A platform that left the judged set[\s\S]*?end loop;\n/, '');
check('(mutation) dropping the departure sweep is caught', problems(cut).length > 0);
const noActive = sql.replace(/and c\.active > 0\n(\s*and 'oracle_chain)/, '$1');
check('(mutation) a sweep that ignores active rows is caught', problems(noActive).length > 0);
const feed = sql.replace(/\s*and a\.dedup_key <> 'oracle_chain_never_observed:__feed__'/, '');
check('(mutation) a sweep that would resolve __feed__ is caught', problems(feed).length > 0);

if (failed) { console.log(`\n❌ ${failed} failure(s)`); process.exit(1); }
console.log('\n✅ oracle_chain_never_observed resolves platforms that left its judged set');
