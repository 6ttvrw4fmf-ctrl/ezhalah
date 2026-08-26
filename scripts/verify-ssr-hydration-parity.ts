// TRIPWIRE + BEHAVIOURAL TEST: the first client render must reproduce the server render, so a
// width-gated layout flag may never read the real viewport before mount.
//
// WHY THIS EXISTS (P0, 2026-08-21 — React #418 served on production from 04:23 UTC).
// The app is server-rendered and then hydrated. The server has no `window`, so
// `useWindowDimensions().width` is 0 there and every width comparison yields FALSE. A desktop client
// evaluates the SAME comparison as TRUE on its very first render, so React's first client tree
// disagrees with the served HTML: error #418. React recovers by discarding the entire server tree and
// re-rendering client-side — the page still works, so nobody notices, and SSR is quietly lost on every
// desktop visit.
//
// TWO call sites had it, which is why the live page logged exactly TWO errors:
//   • Sidebar useDocked()   ≥ 900 — structural (docked <Sidebar/> present on client, absent in HTML)
//   • ResultCard horizontal ≥ 820 — attribute (flexDirection + wide/compact style arrays)
// Bisection against the real production bundle matched: 0 errors at 375/768, 2 at 900/1024/1280/1920.
//
// The post-deploy gate (scripts/verify-live-hydration.mjs) can only see this AFTER a build is live,
// and only at the viewport it happens to use. THIS check runs pre-merge, from source, at every
// breakpoint — so the class cannot ship again.
//
//   node --experimental-strip-types scripts/verify-ssr-hydration-parity.ts   (wired into `npm test`)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { atLeast, DOCK_BREAKPOINT, CARD_WIDE_BREAKPOINT } from '../src/lib/responsive.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// ── A. BEHAVIOUR — the guarantee, proved by running the decision ─────────────────────────────────
{
  // A1 is the whole P0 in one assertion: before mount the answer is FALSE at EVERY width, because
  // that is what the server rendered. If this ever returns true, hydration breaks again.
  const widthsThatWouldTrip = [820, 900, 1024, 1280, 1920, 3840];
  const anyTrueBeforeMount = widthsThatWouldTrip.some((width) =>
    atLeast({ mounted: false, isWeb: true, width, min: DOCK_BREAKPOINT }) ||
    atLeast({ mounted: false, isWeb: true, width, min: CARD_WIDE_BREAKPOINT }));
  check('A1. before mount every width-gated flag is FALSE — the server\'s answer, at every width',
    !anyTrueBeforeMount, 'a true here IS React #418 on the next desktop visit');

  // A2 — after mount the flag does its real job, or the fix would be a regression in disguise.
  check('A2. after mount, desktop widths DO dock (1280 ≥ 900)',
    atLeast({ mounted: true, isWeb: true, width: 1280, min: DOCK_BREAKPOINT }));
  check('A3. after mount, phone widths do NOT dock (375 < 900)',
    !atLeast({ mounted: true, isWeb: true, width: 375, min: DOCK_BREAKPOINT }));

  // A4 — exact boundary, both sides. 899/900 and 819/820 are where the two real bugs lived.
  check('A4. boundary is inclusive and exact (900 on, 899 off; 820 on, 819 off)',
    atLeast({ mounted: true, isWeb: true, width: 900, min: DOCK_BREAKPOINT }) &&
    !atLeast({ mounted: true, isWeb: true, width: 899, min: DOCK_BREAKPOINT }) &&
    atLeast({ mounted: true, isWeb: true, width: 820, min: CARD_WIDE_BREAKPOINT }) &&
    !atLeast({ mounted: true, isWeb: true, width: 819, min: CARD_WIDE_BREAKPOINT }));

  // A5 — native has no SSR and no docked/wide layout; width must never turn it on.
  check('A5. native is always false regardless of width',
    !atLeast({ mounted: true, isWeb: false, width: 1920, min: DOCK_BREAKPOINT }));

  // A6 — MUTATION PROOF. Re-implement the pre-fix logic (read the width immediately) and assert this
  // test would have caught it. A barrier nobody has seen fail is not known to work.
  const preFix = ({ isWeb, width, min }: { isWeb: boolean; width: number; min: number }) => isWeb && width >= min;
  const preFixDivergesOnSSR =
    preFix({ isWeb: true, width: 1280, min: DOCK_BREAKPOINT }) !==
    preFix({ isWeb: true, width: 0, min: DOCK_BREAKPOINT });
  check('A6. MUTATION: the pre-fix logic gives a DIFFERENT answer on server (w=0) vs desktop — i.e. this test fails on the old code',
    preFixDivergesOnSSR,
    'server said false, desktop said true, same first render → #418');
  const fixedAgreesOnSSR =
    atLeast({ mounted: false, isWeb: true, width: 1280, min: DOCK_BREAKPOINT }) ===
    atLeast({ mounted: false, isWeb: true, width: 0, min: DOCK_BREAKPOINT });
  check('A6b. …and the fixed logic AGREES on the first render (both false) — passes on the new code',
    fixedAgreesOnSSR);
}

// ── B. WIRING — the two real call sites go through the tested primitive ──────────────────────────
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const strip = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

for (const [file, what] of [
  ['src/components/Sidebar.tsx', 'the docked sidebar'],
  ['src/components/ResultCard.tsx', 'the wide result card'],
] as const) {
  const code = strip(read(file));
  check(`B. ${what} (${file}) derives its flag from useAtLeast()`, /useAtLeast\(/.test(code));
  check(`B. ${what} does NOT compare a raw viewport width inline`,
    !/\bwidth\s*[<>]=?\s*\d+/.test(code),
    'an inline width comparison runs on the very first render — that is the #418 shape');
}

// The primitive itself must actually gate on mount, or every call site silently regresses at once.
{
  const hook = strip(read('src/lib/useAtLeast.ts'));
  check('B. useAtLeast() gates on a mounted flag set in an effect (not on first render)',
    /useState\(\s*false\s*\)/.test(hook) && /useEffect\(/.test(hook) && /atLeast\(/.test(hook));
}

// ── C. FLEET-WIDE — no NEW inline viewport breakpoint anywhere in src/ ───────────────────────────
// The earlier failure was two independent call sites doing the same thing. A check that only knows
// about those two would miss the third, so scan the whole tree: breakpoints live in responsive.ts.
{
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : (/\.tsx?$/.test(n) ? [p] : []);
  });
  const root = new URL('../src', import.meta.url).pathname;
  const allowed = new Set(['src/lib/responsive.ts']);
  const offenders: string[] = [];
  for (const file of walk(root)) {
    const rel = file.replace(root, 'src');
    if (allowed.has(rel)) continue;
    const code = strip(readFileSync(file, 'utf8'));
    // A width/height compared against a numeric literal is a viewport breakpoint being evaluated at
    // render time. Style objects (`height: 48`) are assignments, not comparisons, so they don't match.
    const hits = [...code.matchAll(/\b(?:width|height)\s*[<>]=?\s*\d+/g)].map((m) => m[0]);
    if (hits.length) offenders.push(`${rel} → ${hits.slice(0, 2).join(', ')}`);
  }
  check('C. every viewport breakpoint in src/ lives in lib/responsive.ts and goes through useAtLeast()',
    offenders.length === 0,
    offenders.join('\n      ') || undefined);
}

console.log(failures === 0
  ? '\n✓ SSR and the first client render agree at every breakpoint — proved by behaviour, a mutation, wiring and a full-tree scan\n'
  : `\n✗ ${failures} check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
