// Sidebar dock hydration safety — permanent barrier (owner-directed, 2026-08-21, issue #847).
//
// WHY THIS EXISTS. Deploy `Deploy frontend (production)` run 32446501442 (2026-08-21 04:18 UTC,
// PR#841) shipped a build whose post-deploy hydration gate (scripts/verify-live-hydration.mjs)
// failed with React error #418 on every desktop viewport (>=900px). Root cause, confirmed by
// reproducing the exact production HTML+bundle locally (5/5 deterministic, desktop-only, 0 errors
// on mobile/tablet): `useDocked()` in src/components/Sidebar.tsx reads `useWindowDimensions()`
// directly. Static export has no real window, so the server always emits the UNDOCKED tree; on
// the client at >=900px `useWindowDimensions()` reports the true width on the very first render,
// so the client immediately renders the DOCKED tree instead — a structural mismatch at the top of
// the component tree (this is exactly what error #418 is: server HTML and client render disagree).
//
// `useDocked()` was fixed the same day to gate its return value behind a `mounted` flag set in a
// `useEffect`, so the client's first render always matches the server (both `false`/undocked); the
// docked column then appears one render later, once mount is real and `width` can be trusted.
//
// This script pins that fix at the source level — it fails on the OLD code (`useDocked` returning
// `Platform.OS === 'web' && width >= DOCK_BREAKPOINT` with no mount gate) and passes on the fixed
// code, so the exact hydration-mismatch class this repo has now shipped THREE times (PR#634/#637,
// this one) cannot silently regress a fourth time. It is a static/source check, not a live-browser
// check — `scripts/verify-live-hydration.mjs` is the live, post-deploy half of this same defense
// and should stay wired regardless; this one runs pre-merge, in ordinary CI, with no browser.
//
//   node --experimental-strip-types scripts/verify-sidebar-hydration-safe.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src/components/Sidebar.tsx'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

// Isolate the useDocked function body so a match elsewhere in the file can't produce a false pass.
const fnMatch = src.match(/export function useDocked\(\)\s*\{([\s\S]*?)\n\}/);
check('useDocked() is present and parseable in Sidebar.tsx', !!fnMatch);
const body = fnMatch ? fnMatch[1] : '';

check('useDocked tracks a mounted flag via useState',
  /useState(<boolean>)?\(false\)/.test(body));
check('useDocked flips the mounted flag inside a useEffect (client-only, post-mount)',
  /useEffect\(\s*\(\)\s*=>\s*\{[^}]*set\w+\(true\)/.test(body));
check('the returned docked value is gated on the mounted flag (server/first-client-render both false)',
  /return\s+Platform\.OS === 'web' && \w+ && width >= DOCK_BREAKPOINT/.test(body));
check('DOCK_BREAKPOINT is still read directly from useWindowDimensions (no separate stale copy)',
  /const \{ width \} = useWindowDimensions\(\)/.test(body));
check('the hydration-mismatch history is documented in place (issue #847), so this does not get "cleaned up" by someone who does not know why it is here',
  /error #418/.test(body) && /issue #847/.test(body));

console.log(failed === 0
  ? '\n✓ sidebar-hydration-safe barrier: useDocked() cannot diverge between server and first client render'
  : `\n✗ ${failed} assertion(s) FAILED — useDocked() may reintroduce the #847 hydration mismatch`);
process.exit(failed === 0 ? 0 : 1);
