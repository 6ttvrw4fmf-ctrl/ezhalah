// THE LIVE HALF — production's journey ledger carries no row nothing can refresh (routine #6,
// 2026-09-14).
//
// The offline twin, `scripts/verify-journey-ledger-has-no-orphans.ts`, proves the PREDICATE by
// execution and stays in `npm test`. Only a live read can say whether the real table satisfies it,
// and a check whose verdict is decided by production's state must never sit in the required suite
// (AGENTS.md, "the required suite is HERMETIC") — it would fail unrelated diffs. So this half runs
// in `.github/workflows/journey-sweep.yml`, right where the rows are written.
//
// Both halves import the SAME predicate from scripts/lib/ledgerOrphans.ts, so the offline proof is a
// statement about the code that actually decides this verdict rather than about a copy of it.
//
// A FAILED FETCH IS NOT AN EMPTY ANSWER (AGENTS.md). An unreachable ledger must FAIL, never read as
// "no orphans" — a silent zero here would be the exact defect class this repo keeps getting bitten
// by, in a check written to prevent one.
//
// MUTATION-PROOF-EXEMPT: this half owns no predicate of its own. The rule it applies
// (orphanLedgerKeys) is mutation-proven by execution in the offline twin, which runs in `npm test`
// and also asserts BY EXECUTION that this workflow really invokes this file. What is left here is a
// fetch and a fail-closed read, and a mutation of that could only be proven by making the network
// lie — which is the twin's job to pin structurally, not this file's to simulate. Verified by hand
// on 2026-09-14 against production (162 rows, 0 orphans) and against an unreachable endpoint, where
// it FAILS rather than reporting a clean ledger.
//
// Run: node --experimental-strip-types scripts/verify-journey-ledger-has-no-orphans-live.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import { orphanLedgerKeys } from './lib/ledgerOrphans.ts';

const ROOT = join(import.meta.dirname, '..');
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nJourney ledger: no orphaned coverage keys in production (LIVE)\n');

const { url: URL_BASE, key: KEY } = resolvePublicSupabase(process.env);

// The committed runner's real journey list — the same extraction the offline half asserts is sane.
const runner = readFileSync(join(ROOT, 'e2e/journeys/run.mjs'), 'utf8');
const registered = [...runner.matchAll(/JOURNEYS\['([^']+)'\]\s*=/g)].map((m) => m[1]);
if (registered.length < 10) {
  console.error(`FAIL  the committed runner registered only ${registered.length} journeys — refusing to `
    + 'judge the ledger against a list this small, which would orphan almost every real row');
  process.exit(1);
}

let rows: Array<{ key: string; last_tested_at: string }> | null = null;
let fetchError = '';
try {
  const r = await fetch(
    `${URL_BASE}/rest/v1/ops_qa_coverage_ledger`
      + '?dimension=eq.journey_persistence&select=key,last_tested_at&limit=2000',
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(30_000) },
  );
  if (!r.ok) fetchError = `HTTP ${r.status} ${(await r.text()).slice(0, 200)}`;
  else rows = await r.json();
} catch (e) {
  fetchError = String(e).slice(0, 200);
}

// Fail CLOSED, and say which of the two it was: an unreachable ledger and a clean ledger must never
// produce the same verdict.
check('the ledger was actually READ (a failed fetch is not an empty answer)',
  rows !== null, `could not read ops_qa_coverage_ledger: ${fetchError}`);

if (rows !== null) {
  check('the ledger returned a real row set (an empty table would orphan nothing vacuously)',
    rows.length > 0, `got ${rows.length} rows`);

  const orphans = orphanLedgerKeys(registered, rows.map((r) => r.key));
  const stamp = new Map(rows.map((r) => [r.key, r.last_tested_at]));
  check('no ledger key is unreachable from the committed journey set',
    orphans.length === 0,
    orphans.length
      ? `${orphans.length} orphaned key(s) — nothing can ever refresh these, so they lead the `
        + 'oldest-first rotation forever (PART 3 item 7):\n      '
        + orphans.map((k) => `${k}  (last_tested_at ${stamp.get(k)})`).join('\n      ')
        + '\n      Either land a journey that produces the key, or delete the row once its '
        + 'descendants prove the surface is still covered.'
      : '');
}

console.log(failures ? `\n${failures} FAILED` : `\njourney ledger is clean — ${rows?.length ?? 0} rows, 0 orphans`);
process.exit(failures ? 1 : 0);
