// PERMANENT BARRIER — the QA table-scope registry may never lag the client (2026-09-04).
//
// THE BUG CLASS THIS EXISTS FOR. public.ops_qa_scope records the exact source_table lists the
// production client sends to location_search_candidates_ar. It is HARVESTED (from real production —
// today from the deployed bundle), never copied from src/, and nothing linked "the client's table
// lists changed" to "re-harvest the registry". So on 2026-09-03 PR #1548 shipped five audited
// platforms into RES_TABLES/COM_TABLES and into production, the registry stayed at its 2026-08-20
// 31-table harvest, and mon_detect_search_scope_unreachable_inventory() raised ten P1s saying 4,500
// production_ready listings were "stored, indexed and invisible". They were reachable the whole time.
//
// WHY A FALSE ALARM IS WORTH A BARRIER. That detector's TRUE alarm is a platform live in
// search_listings_ar but absent from the client — the real 2026-09-03 Trending defect, where
// الهفوف/أرض سكنية/بيع advertised 2,478 while search delivered 109. A stale registry makes the true
// and false alarms textually identical, and mon_raise() dedups, so a stuck-open key SUPPRESSES the
// real one. The answer is not to soften the detector (severity is deliberately unchanged) — it is to
// stop the registry going stale, which is checkable offline and therefore checked here.
//
// WHAT IS ASSERTED. The RES_TABLES/COM_TABLES the client actually ships equal, as sets, the lists
// recorded in scripts/qa-scope-registry-baseline.txt — the snapshot the registry was last harvested
// against. Editing the client's table lists therefore FAILS this check until the author also ships an
// ops_qa_scope re-harvest migration and updates the baseline in the same change. Prod-vs-file
// agreement for that migration is the migration-drift/content-parity guards' job (AGENTS.md), so the
// chain client == baseline == migration == production has no hand-maintained gap.
//
// This is a FLOOR in the same sense as scripts/test-baseline.txt: retiring a platform from the
// registry takes a deliberate, reviewed edit of the baseline, never a silent side effect.
//
// MUTATION-PROVEN (each makes this barrier fail; verified by running it):
//   M1 add a table to RES_TABLES without touching the baseline   -> "in the client but not in the registry"
//   M2 delete a table from COM_TABLES without touching the baseline -> "in the registry but not in the client"
//   M3 empty the baseline file                                   -> parse check fails (an empty
//      baseline must never read as "everything matches")
//
//   node --experimental-strip-types scripts/verify-qa-scope-registry-current.ts   (in `npm test`)

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
};

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ── The lists the client actually ships ─────────────────────────────────────────────────────────
const remoteSrc = read('src/data/remote.ts');
const clientList = (name: string): string[] => {
  const m = remoteSrc.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
  if (!m) return [];
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};
const client = { res: clientList('RES_TABLES'), com: clientList('COM_TABLES') };

check('RES_TABLES parsed from src/data/remote.ts', client.res.length >= 30, `got ${client.res.length}`);
check('COM_TABLES parsed from src/data/remote.ts', client.com.length >= 30, `got ${client.com.length}`);

// ── The snapshot the registry was last harvested against ────────────────────────────────────────
const baseline = { res: [] as string[], com: [] as string[] };
for (const line of read('scripts/qa-scope-registry-baseline.txt').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const [kind, table] = t.split(/\s+/);
  if (kind === 'res' || kind === 'com') baseline[kind].push(table);
  else check(`baseline line is well-formed: ${t}`, false, "expected 'res <table>' or 'com <table>'");
}

// An empty or unreadable baseline must never read as agreement.
check('baseline records the residential scope', baseline.res.length >= 30, `got ${baseline.res.length}`);
check('baseline records the commercial scope', baseline.com.length >= 30, `got ${baseline.com.length}`);

// ── Set equality, both directions, per scope ────────────────────────────────────────────────────
for (const kind of ['res', 'com'] as const) {
  const inClient = new Set(client[kind]);
  const inBaseline = new Set(baseline[kind]);
  const missing = [...inClient].filter((t) => !inBaseline.has(t)); // client gained a table
  const extra = [...inBaseline].filter((t) => !inClient.has(t)); // client dropped a table

  check(
    `${kind}: every client table is in the registry snapshot`,
    missing.length === 0,
    missing.length
      ? `${missing.join(', ')} — in the client but not in the registry. Re-harvest ops_qa_scope from ` +
        'the DEPLOYED bundle, ship it as a migration, and update scripts/qa-scope-registry-baseline.txt ' +
        'in the same change; otherwise mon_detect_search_scope_unreachable_inventory() will call this ' +
        "platform's live inventory invisible."
      : '',
  );
  check(
    `${kind}: every registry table is still in the client`,
    extra.length === 0,
    extra.length
      ? `${extra.join(', ')} — in the registry but not in the client. If the platform was retired, ` +
        'drop it from ops_qa_scope and from the baseline in one reviewed change; if it was dropped by ' +
        'accident, the client just went blind to that inventory.'
      : '',
  );
}

console.log(failed === 0 ? '\nQA scope registry is current with the client.' : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
