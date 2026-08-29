// EVERY ROUTINE SEES SENTRY, AND EXACTLY ONE OWNS EACH ISSUE (owner rule 2026-08-28)
//
// Sentry is only useful if (a) every relevant routine actually checks it on every run, and (b) the
// ownership routing is unambiguous so seven engineers don't collide on one crash. This barrier
// pins both properties to the routine specs so a future edit cannot silently loosen them.
//
// This is a source-shape barrier (no browser, no network). It executes against the six canonical
// routine files, asserts the shared §S mandate paragraph is present verbatim in every one, and
// asserts SENTRY_ROUTING.md carries the ownership table for all seven routines.

import { readFileSync, existsSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
};

console.log('\nSentry routing wired into every routine (owner 2026-08-28)\n');

// ── 1. The canonical routing doc exists and lists all seven routines with distinct scopes ──────
const routingPath = new URL('../docs/ops/SENTRY_ROUTING.md', import.meta.url).pathname;
check('docs/ops/SENTRY_ROUTING.md exists', existsSync(routingPath));
const routing = readFileSync(routingPath, 'utf8');
check('routing doc identifies itself as canonical, owner-dated 2026-08-28', /canonical, owner 2026-08-28/.test(routing));
check('routing doc has the §2 ownership table', /## §2 — Ownership routing/.test(routing));
for (const label of [
  '⚡ \\*\\*Junior Scraping\\*\\*',
  '🎖️ \\*\\*Senior Production\\*\\*',
  '🛡️ \\*\\*Data Integrity',
  '🧪 \\*\\*Search & Matching QA\\*\\*',
  '🎯 \\*\\*AF \\+ Trending Data Integrity\\*\\*',
  '👣 \\*\\*Journey & Persistence\\*\\*',
  '🧵 \\*\\*Systems Seam\\*\\*',
]) {
  check(`ownership table names routine: ${label.replace(/\\/g, '')}`, new RegExp(label).test(routing));
}
check('routing doc has the tie-breakers section (§2.2)', /## §2\.2 — Tie-breakers/.test(routing));
check('routing doc has the unownable / ignore-list section (§2.1)', /## §2\.1 — Unownable/.test(routing));
check('routing doc names routine #2 as the triage owner for ambiguous issues',
  /the \*\*triage owner\*\* for ambiguous/.test(routing) && /Senior Production/.test(routing));
check('routing doc has the anti-duplication protocol (§4)', /## §4 — Anti-duplication protocol/.test(routing));
check('routing doc names the enablement checklist owner-only steps (§5)', /## §5 — Enablement checklist/.test(routing)
  && /EXPO_PUBLIC_SENTRY_DSN/.test(routing));

// ── 2. The shared §S mandate — byte-identical in every routine spec ─────────────────────────────
// This is the enforcement: a routine's spec must carry the shared paragraph verbatim. If a future
// edit paraphrases or weakens it, this check fails.
const MANDATE_FIRST_SENTENCE = 'On every run, read your scoped Sentry issue queue per `docs/ops/SENTRY_ROUTING.md`';
const MANDATE_REPORT_LINES = /Report `SENTRY ISSUES CLAIMED THIS RUN: N` and `SENTRY ISSUES RESOLVED THIS RUN: N` in your FINAL REPORT\./;
const MANDATE_ANTI_DUP = 'let its\nowner take it on their next run';
const MANDATE_TRIAGE = 'escalate to routine #2 (Senior\nProduction) as the standing triage router';

const ROUTINE_FILES = [
  'docs/ops/ENGINEER_ROUTINES.md',             // covers routines #1 and #2 (Junior Scraping, Senior Production)
  'docs/ops/DATA_INTEGRITY_ENGINEER.md',       // routine #3
  'docs/ops/SEARCH_MATCH_QA_ENGINEER.md',      // routine #4
  'docs/ops/AF_TRENDING_DATA_INTEGRITY_ENGINEER.md', // routine #5
  'docs/ops/JOURNEY_PERSISTENCE_ENGINEER.md',  // routine #6
  'docs/ops/SYSTEMS_SEAM_ENGINEER.md',         // routine #7
];

// Collapse markdown line-wrapping (LF + spaces → single space) before substring/regex checks so
// wrapping the paragraph across lines cannot silently pass or fail. Content matters, layout does not.
const flat = (s: string) => s.replace(/\s+/g, ' ');
const flatMandateAntiDup = flat(MANDATE_ANTI_DUP);
const flatMandateTriage = flat(MANDATE_TRIAGE);

for (const rel of ROUTINE_FILES) {
  const p = new URL(`../${rel}`, import.meta.url).pathname;
  check(`spec file exists: ${rel}`, existsSync(p));
  const s = readFileSync(p, 'utf8');
  const fs = flat(s);
  check(`${rel} carries the §S SENTRY mandate header (owner-dated 2026-08-28)`,
    /## §S — SENTRY \(mandatory every run, owner rule 2026-08-28\)/.test(s));
  check(`${rel} carries the mandate's opening sentence (docs/ops/SENTRY_ROUTING.md reference)`,
    fs.includes(flat(MANDATE_FIRST_SENTENCE)));
  check(`${rel} requires reporting SENTRY ISSUES CLAIMED + RESOLVED in FINAL REPORT`,
    /Report `SENTRY ISSUES CLAIMED THIS RUN: N` and `SENTRY ISSUES RESOLVED THIS RUN: N` in your FINAL REPORT\./.test(fs));
  check(`${rel} carries the anti-duplication clause (leave issues owned by another routine alone)`,
    fs.includes(flatMandateAntiDup));
  check(`${rel} names routine #2 as the standing triage router for ambiguous issues`,
    fs.includes(flatMandateTriage));
  check(`${rel} names the "resolve WITHOUT a barrier is a violation" clause`,
    /violation of this contract, not a fix/.test(fs));
}

// ── 3. Observability wrapper still exists and is safe-by-default (defensive cross-check) ────────
const obs = readFileSync(new URL('../src/lib/observability.ts', import.meta.url).pathname, 'utf8');
check('observability wrapper still uses EXPO_PUBLIC_SENTRY_DSN gate (no-DSN → no-op)',
  // Certification 2026-08-29: the dynamic-key readEnv(name) reader was the second root cause of
  // the "SDK loaded but silent" failure — Metro can't inline dynamic env keys. This check now
  // enforces the static identifier read directly, matching how the fix works.
  /process\.env\.EXPO_PUBLIC_SENTRY_DSN\b/.test(obs));
check('routing doc references the same env var as the wrapper', /EXPO_PUBLIC_SENTRY_DSN/.test(routing));

console.log(failed ? `\n✗ ${failed} check(s) FAILED — Sentry routing not fully wired` : '\n✓ Sentry routing wired: all 7 routines carry the mandate, ownership is unambiguous, closing without a barrier is a contract violation');
process.exit(failed ? 1 : 0);
