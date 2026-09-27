// The live sweep's evidence journal must record EVERY journey, and must never be destroyed by the
// mere act of importing the sweep module.
//
// WHY THIS EXISTS (both halves measured on production 2026-09-24, routine-4-search-qa).
// `e2e/live-sweep/sweep.mjs` writes one JSON line per journey to `$SWEEP_OUT/journeys.jsonl`. That
// file is the §40.7 machine-readable evidence for a run — the thing an auditor reads to find out
// what a sweep actually asserted. A full 11-journey production sweep reported
//
//     LIVE BROWSER JOURNEYS: 11 … PRODUCTION VERIFIED: YES … SEARCH & MATCHING HEALTH: 10/10
//
// over a journal containing ZERO bytes. Neither defect had any visible symptom, because the report
// is built from the in-memory `journeys` array and NOTHING in the repo ever read the file back:
//
//   1. TRUNCATE-ON-IMPORT. `writeFileSync(JOURNAL, '')` ran at module-eval time. Eleven
//      scripts/verify-*.ts import sweep.mjs for their offline proofs, so any one of them running
//      while a sweep was in flight blanked that sweep's evidence. Measured by execution: a 2-line
//      journal became 0 bytes on a bare `import('./sweep.mjs')`.
//   2. THE ANOMALOUS JOURNEYS WERE EXACTLY THE OMITTED ONES. `assertChain` had three
//      `journeys.push(j)` sites and only the last appended to the journal. The two that did not
//      were the early returns for "the search sent no candidates request at all" and "RPC replay
//      unavailable" — the journeys an auditor would most want recorded. They counted in the report
//      and vanished from the evidence.
//
// THIS BARRIER EXECUTES THE REAL RECORDER. A source-text tripwire would have passed for the whole
// time both defects were live (AGENTS.md: "a pointer reads as coverage"), so §A lifts the actual
// `recordJourney` out of sweep.mjs and runs it, and §B imports the real module in a CHILD process
// against a planted journal. §C is the discovery half: it finds journal writers BY SHAPE, so a
// fourth early return added tomorrow is RED until it routes through the single recorder.
import { readFileSync, writeFileSync, mkdtempSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = resolve(import.meta.dirname, '..');
const SWEEP = join(ROOT, 'e2e/live-sweep/sweep.mjs');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// The repo's proof call: apply the barrier's own predicate to a deliberately broken input and fail
// if the mutant survives (scripts/verify-new-barriers-are-mutation-proven.ts).
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught,
    caught ? '' : 'MUTANT SURVIVED — the journal rule is blind to the defect it exists for');

console.log('\nThe live sweep journal records every journey, and an import never destroys one\n');

// ── §A — the REAL recorder, executed ────────────────────────────────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'sweep-journal-a-'));
  const journal = join(dir, 'journeys.jsonl');
  // A previous run's journal, which the first record of THIS run must replace rather than extend.
  writeFileSync(journal, '{"name":"STALE-FROM-A-PREVIOUS-RUN"}\n');

  const lifted = await liftSymbols(
    SWEEP,
    [{ header: 'function recordJourney(' }],
    ['recordJourney', 'journeys'],
    `import { writeFileSync, appendFileSync } from 'node:fs';\n` +
    `const JOURNAL = ${JSON.stringify(journal)};\n` +
    `const journeys = [];\n` +
    `let journalStarted = false;\n`,
  );
  const recordJourney = lifted.recordJourney as (j: unknown) => unknown;
  const journeys = lifted.journeys as unknown[];

  const lines = () => readFileSync(journal, 'utf8').split('\n').filter((l) => l.trim());

  const first = { name: 'first', ok: true };
  const returned = recordJourney(first);
  check('the recorder RETURNS the journey (the early returns rely on it)', returned === first);
  check('the first record replaces a previous run\'s journal, not appends to it',
    lines().length === 1 && !lines()[0].includes('STALE-FROM-A-PREVIOUS-RUN'),
    `journal now: ${JSON.stringify(lines())}`);

  recordJourney({ name: 'second', ok: false });
  recordJourney({ name: 'third', ok: true });
  check('later records APPEND — the journal is not re-truncated per record', lines().length === 3);
  check('the journal round-trips each journey', lines().map((l) => JSON.parse(l).name).join(',') === 'first,second,third');
  check('BOTH sinks are written — the in-memory array and the file agree',
    journeys.length === lines().length,
    `array ${journeys.length} vs journal ${lines().length}`);

  // A recorder that pushed but did not append is the pre-fix early-return path exactly.
  const pushOnly: unknown[] = [];
  const preFixEarlyReturn = (j: unknown) => { pushOnly.push(j); return j; };
  preFixEarlyReturn({ name: 'anomalous-journey' });
  mustCatch('the pre-fix early return: counted in the report, absent from the evidence',
    pushOnly.length === 1 && !lines().some((l) => l.includes('anomalous-journey')));
}

// ── §B — importing the real module must not touch an existing journal ───────────────────────────
// Run in a CHILD process: module eval happens once per process, so this must not share ours.
const importLeavesJournalIntact = (moduleUnderTest: string): { before: number; after: number } => {
  const dir = mkdtempSync(join(tmpdir(), 'sweep-journal-b-'));
  const journal = join(dir, 'journeys.jsonl');
  writeFileSync(journal, '{"name":"A-RUN-THAT-IS-STILL-IN-FLIGHT"}\n');
  const before = statSync(journal).size;
  execFileSync(process.execPath, ['-e', `import(${JSON.stringify(moduleUnderTest)}).then(()=>process.exit(0),e=>{console.error(e);process.exit(3)})`],
    { env: { ...process.env, SWEEP_OUT: dir }, stdio: 'pipe', timeout: 120_000 });
  return { before, after: existsSync(journal) ? statSync(journal).size : 0 };
};

{
  check('sweep.mjs exists where this barrier expects it', existsSync(SWEEP), SWEEP);
  const real = importLeavesJournalIntact(SWEEP);
  check('importing the REAL sweep.mjs leaves an in-flight journal untouched',
    real.after === real.before && real.before > 0,
    `${real.before} bytes before, ${real.after} after — an import must never blank a running sweep's evidence`);

  // MUTATION: a module that truncates at eval — the shipped pre-fix top level — must be caught.
  const mdir = mkdtempSync(join(tmpdir(), 'sweep-journal-mut-'));
  const mutant = join(mdir, 'pre-fix-sweep.mjs');
  writeFileSync(mutant, [
    `import { mkdirSync, writeFileSync } from 'node:fs';`,
    `const OUT_DIR = process.env.SWEEP_OUT || '/tmp/live-sweep';`,
    `mkdirSync(OUT_DIR, { recursive: true });`,
    `writeFileSync(\`\${OUT_DIR}/journeys.jsonl\`, '');   // <- the defect, as it shipped`,
  ].join('\n'));
  const mut = importLeavesJournalIntact(mutant);
  mustCatch('a module that truncates the journal at import time (the shipped pre-fix top level)',
    mut.after === 0 && mut.before > 0);
}

// ── §C — DISCOVERY: every journal writer routes through the one recorder ────────────────────────
// By shape, not by allowlist: a new early return that pushes directly, or a second appendFileSync,
// is RED until it goes through recordJourney.
const journalWriterProblems = (src: string): string[] => {
  const bad: string[] = [];
  const lines = src.split('\n');
  // Strip the block comment that documents the defect, or its own prose trips the scan.
  const code = lines.map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l));

  const recStart = code.findIndex((l) => /^function recordJourney\s*\(/.test(l));
  if (recStart < 0) return ['no `function recordJourney(` — the single writer is gone'];
  let recEnd = -1;
  for (let i = recStart + 1; i < code.length; i++) if (code[i] === '}') { recEnd = i; break; }
  if (recEnd < 0) return ['recordJourney has no column-0 terminator'];
  const inside = (i: number) => i > recStart && i < recEnd;

  code.forEach((l, i) => {
    if (/journeys\.push\s*\(/.test(l) && !inside(i)) bad.push(`line ${i + 1}: journeys.push outside recordJourney — a journey counted but not journalled`);
    if (/appendFileSync\s*\(\s*JOURNAL/.test(l) && !inside(i)) bad.push(`line ${i + 1}: appendFileSync(JOURNAL) outside recordJourney — a second writer`);
    if (/writeFileSync\s*\(\s*JOURNAL/.test(l) && !inside(i)) bad.push(`line ${i + 1}: writeFileSync(JOURNAL) outside recordJourney — truncation can run on import again`);
  });
  return bad;
};

{
  const src = readFileSync(SWEEP, 'utf8');
  const problems = journalWriterProblems(src);
  check('every journal write in sweep.mjs routes through the single recorder', problems.length === 0,
    problems.join('\n      '));

  // MUTATION: the pre-fix composition — an eval-time truncate plus a push-only early return.
  mustCatch('an eval-time writeFileSync(JOURNAL) reappearing at module scope',
    journalWriterProblems(`import x from 'y';\nwriteFileSync(JOURNAL, '');\nfunction recordJourney(j) {\n  journeys.push(j);\n}\n`).length > 0);
  mustCatch('a new early return that pushes the journey without journalling it',
    journalWriterProblems(`function recordJourney(j) {\n  journeys.push(j);\n}\nasync function assertChain() {\n  if (!req) { journeys.push(j); return j; }\n}\n`).length > 0);
  mustCatch('a second appendFileSync(JOURNAL) added outside the recorder',
    journalWriterProblems(`function recordJourney(j) {\n  journeys.push(j);\n}\nfunction other() {\n  appendFileSync(JOURNAL, 'x');\n}\n`).length > 0);
  check('(control) the shipped single-writer shape is NOT flagged by the same predicate',
    journalWriterProblems(`function recordJourney(j) {\n  journeys.push(j);\n  if (!journalStarted) { writeFileSync(JOURNAL, ''); journalStarted = true; }\n  appendFileSync(JOURNAL, JSON.stringify(j) + '\\n');\n  return j;\n}\n`).length === 0);
}

console.log(failed
  ? `\n✗ ${failed} check(s) failed\n`
  : '\n✓ the sweep journal records every journey, and an import never destroys one\n');
process.exit(failed ? 1 : 0);
