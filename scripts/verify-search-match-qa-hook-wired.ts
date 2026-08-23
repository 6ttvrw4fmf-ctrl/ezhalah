// The Search & Matching QA SessionStart hook must stay wired, executable, remote-only, and
// must keep reading docs/ops/SEARCH_MATCH_QA_ENGINEER.md at runtime — never a hardcoded copy.
//
// THE FAILURE CLASS THIS EXISTS FOR (2026-08-22):
//   The Search, Matching & Testing Engineer routine is fired by an account-level scheduled task
//   whose stored prompt is a copy of docs/ops/SEARCH_MATCH_QA_ENGINEER.md. When the file evolves
//   (§42 FULL-FILTER TRENDING PARITY was added on 2026-08-22, following the owner rule) the
//   stored prompt used to require a manual re-paste to catch up. The SessionStart hook at
//   .claude/hooks/session-start-qa-inject.py eliminates that class: it reads the LIVE file at
//   session start and injects it as additionalContext, so the file and the runtime cannot drift.
//   If this hook silently unwires (missing registration, chmod dropped, path renamed, or the
//   script starts embedding the file's text instead of reading it), the drift class returns.
//
// This guard is deliberately OFFLINE (tracked repo files only), like the other verifiers in
// `npm test`. The LIVE half is that the hook itself is guarded on the `CLAUDE_CODE_REMOTE`
// environment variable and gracefully no-ops when the canonical file is unreadable — so a
// failed inject can never break a session start.
//
// Run: node --experimental-strip-types scripts/verify-search-match-qa-hook-wired.ts
import { readFileSync, statSync } from 'node:fs';

const HOOK_PATH = '.claude/hooks/session-start-qa-inject.py';
const SETTINGS_PATH = '.claude/settings.json';
const SPEC_PATH = 'docs/ops/SEARCH_MATCH_QA_ENGINEER.md';

const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

// 1. The hook file exists and is executable.
try {
  const st = statSync(HOOK_PATH);
  check((st.mode & 0o111) !== 0,
    `${HOOK_PATH} exists and is executable`,
    `${HOOK_PATH} exists but is NOT executable — Claude Code will refuse to run it as a command hook`);
} catch {
  problems.push(`${HOOK_PATH} is missing — the routine drift-guard cannot function without it`);
}

// 2. Settings registers exactly this hook under SessionStart.
try {
  const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
  const hooks = settings?.hooks?.SessionStart ?? [];
  const flat = (Array.isArray(hooks) ? hooks : []).flatMap((g: any) => g?.hooks ?? []);
  const cmds = flat.map((h: any) => (typeof h?.command === 'string' ? h.command : ''));
  check(cmds.some((c: string) => c.includes('session-start-qa-inject.py')),
    'SessionStart in .claude/settings.json invokes session-start-qa-inject.py',
    `SessionStart hook registration missing session-start-qa-inject.py — found commands: ${JSON.stringify(cmds)}`);
} catch (e) {
  problems.push(`could not parse ${SETTINGS_PATH}: ${String(e)}`);
}

// 3. The hook reads the canonical spec file at runtime — never a hardcoded copy.
//    An embedded copy is EXACTLY the drift class this hook exists to prevent.
let src = '';
try {
  src = readFileSync(HOOK_PATH, 'utf8');
} catch (e) {
  problems.push(`could not read ${HOOK_PATH}: ${String(e)}`);
}
if (src) {
  check(src.includes('SEARCH_MATCH_QA_ENGINEER.md'),
    'the hook references docs/ops/SEARCH_MATCH_QA_ENGINEER.md by path',
    `${HOOK_PATH} no longer references SEARCH_MATCH_QA_ENGINEER.md — the inject is either broken or built from an embedded copy`);
  check(/open\s*\(\s*path/.test(src) || /readFileSync/.test(src),
    'the hook reads the spec file at runtime (open()/readFileSync), not from an embedded literal',
    `${HOOK_PATH} does not appear to read the spec at runtime — an embedded copy silently reintroduces routine-vs-file drift`);
  // 4. Guarded on CLAUDE_CODE_REMOTE so local IDE sessions stay unchanged.
  check(src.includes('CLAUDE_CODE_REMOTE'),
    'the hook is guarded on CLAUDE_CODE_REMOTE (remote-only inject)',
    `${HOOK_PATH} is not guarded on CLAUDE_CODE_REMOTE — local IDE sessions would receive an unwanted inject`);
  // 5. Silent no-op on missing/unreadable file — a failed inject must never break session start.
  check(/(OSError|UnicodeDecodeError|except\s*:|except\s+Exception)/.test(src),
    'the hook silently no-ops on a missing/unreadable spec (a failed inject cannot break session start)',
    `${HOOK_PATH} does not appear to swallow file-read errors — a missing docs/ops/… file could break every session start`);
  // 6. Emits the SessionStart additionalContext envelope.
  check(src.includes('hookSpecificOutput') && src.includes('additionalContext'),
    'the hook emits the SessionStart additionalContext envelope',
    `${HOOK_PATH} does not emit hookSpecificOutput.additionalContext — Claude Code will not inject its output as session context`);
}

// 7. The spec file itself must exist for the inject to have anything to serve.
try {
  const body = readFileSync(SPEC_PATH, 'utf8');
  check(body.includes('## 42. FULL-FILTER TRENDING PARITY'),
    `${SPEC_PATH} contains §42 (Full-Filter Trending Parity, owner rule 2026-08-22)`,
    `${SPEC_PATH} is missing §42 — the owner-required section is gone; the routine's Trending contract disappeared`);
  check(body.includes('TRENDING FULL-STATE VERIFIED:'),
    `${SPEC_PATH} report block includes the Trending Parity fields (§28 / §40.9)`,
    `${SPEC_PATH} report block dropped the Trending Parity fields — recurring reports would silently omit them`);
} catch (e) {
  problems.push(`could not read ${SPEC_PATH}: ${String(e)}`);
}

// 8. Package.json must run this guard.
const pkg = readFileSync('package.json', 'utf8');
check(pkg.includes('verify-search-match-qa-hook-wired'),
  'npm test runs this guard',
  'package.json no longer runs verify-search-match-qa-hook-wired.ts — the guard is inert');

console.log('search-match-qa-hook-wired: canonical spec injects at every session start\n');
for (const o of ok) console.log(`  ✓ ${o}`);
for (const p of problems) console.error(`  ✗ ${p}`);

if (problems.length) {
  console.error(`\n❌ ${problems.length} check(s) failed — the routine-drift barrier is degraded.`);
  process.exit(1);
}
console.log('\n✅ search-match-qa-hook-wired: passed.');
