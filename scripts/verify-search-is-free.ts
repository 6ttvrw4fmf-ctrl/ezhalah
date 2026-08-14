// SEARCH IS FREE, ALWAYS — owner rule 2026-08-15, retiring the PRD §9 one-free-search gate.
//
// A guest can run unlimited searches on every path (Filter home, AI agent chat, guided interview,
// prompt chips, history restore). Sign-in is VOLUNTARY and only adds persistence (saved history /
// language); it must never sit between a user and search results. The gate that used to do this
// (`gated` in the store + router.push('/auth') branches in the search paths) was removed on
// 2026-08-15 — this barrier fails the build if any of it comes back.
//
// What is pinned:
//   1. The store declares NO `gated` state field (the flag that powered every wall).
//   2. The three SEARCH-PATH files (index/Filter home, agent/chat, interview) contain ZERO
//      navigation to '/auth' — not conditionally, not at all. Voluntary sign-in entry points live
//      in Sidebar/settings/auth screens, which are intentionally NOT covered by this check.
//   3. The pending-message replay in agent.tsx survives as pure recovery (a sign-in must never
//      lose a typed message) but must not condition on any gate flag.
//
//   node --experimental-strip-types scripts/verify-search-is-free.ts     (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

const src = (p: string) => readFileSync(join(import.meta.dirname, '..', 'src', p), 'utf8');
// Strip comments so a comment MENTIONING the retired gate (or '/auth') can never trip the check —
// only live code counts.
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"])\/\/[^\n'"]*$/gm, '$1');

console.log('\nSearch is FREE — no auth wall may exist in any search path\n');

// ── 1. the store has no gate flag ────────────────────────────────────────────────────────────────
{
  const store = codeOnly(src('store.tsx'));
  check('store.tsx declares no `gated` state field', !/\bgated\s*[:=]/.test(store));
  check('store.tsx keeps pendingMessage (sign-in must never lose a typed message)',
    /pendingMessage/.test(store));
}

// ── 2. the search paths never navigate to /auth ──────────────────────────────────────────────────
const SEARCH_PATHS = ['app/index.tsx', 'app/agent.tsx', 'app/interview.tsx'];
for (const p of SEARCH_PATHS) {
  const b = codeOnly(src(p));
  check(`${p}: zero navigation to '/auth' (search never routes to sign-in)`,
    !/['"`]\/auth['"`]/.test(b),
    "a router.push/replace/Link to '/auth' is back in a search path — that is the retired forced " +
    'sign-in gate. Voluntary sign-in belongs in Sidebar/settings only.');
  check(`${p}: no \`gated\` consumption`, !/\bgated\b/.test(b));
}

// ── 3. the recovery effect survives, ungated ─────────────────────────────────────────────────────
{
  const agent = codeOnly(src('app/agent.tsx'));
  check('agent.tsx: pending-message replay effect still exists (pure recovery)',
    /consumedPendingRef/.test(agent) && /setPendingMessage\(null\)/.test(agent));
}

console.log(failures === 0
  ? '\n✓ search is free on every path — no gate flag, no /auth navigation in search code\n'
  : `\n✗ ${failures} check(s) FAILED — a forced sign-in has re-entered the search paths\n`);
process.exit(failures === 0 ? 0 : 1);
