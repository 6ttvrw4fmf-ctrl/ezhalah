// TRIPWIRE: the Filter ⇄ AI mode pill must cost ZERO browser-history entries, in BOTH directions.
//
// WHY THIS EXISTS (real defect, reproduced on production 2026-08-23).
// The ModeSwitch pill (src/components/ModeSwitch.tsx) is mounted by the two peer search screens:
// the Filter home (src/app/index.tsx) and the AI agent (src/app/agent.tsx). Each passes its own
// `onSwitch` navigation. Those two halves disagreed:
//
//     index.tsx   <ModeSwitch active="filter" onSwitch={() => router.push('/agent')} />   ← pushed
//     agent.tsx   <ModeSwitch active="agent"  onSwitch={() => router.replace('/')} />     ← replaced
//
// push() adds a history entry; the replace() on the way back overwrites the TOP entry ('/agent')
// with '/' instead of popping it. So the pushed slot survives as a duplicate '/', and every
// Filter → AI → Filter round trip left one more of them behind. Measured on
// https://ezhalah-app.vercel.app with 3 round trips:
//
//     history.length          2 → 3 → 4 → 5   (all the extra entries are '/')
//     mounted Filter screens  1 → 2 → 3 → 4   ([data-testid="city-input"] count)
//     DOM nodes             313 → 561 → 808 → 1055
//
// The user-visible damage: the browser Back button went dead. BACK #1/#2/#3 each re-rendered a
// pixel-identical Filter page (path stayed '/'), and only BACK #4 left the site — plus every round
// trip leaked a whole extra Filter screen into the DOM.
//
// THE RULE (what this barrier pins): a MODE TOGGLE is not navigation. Both halves of the pill use
// router.replace, so toggling never grows history and never stacks a duplicate screen. Verified
// after the fix, same script, 3 round trips: history.length stayed 2, mounted Filter screens stayed
// 1, DOM stayed 317.
//
// The Search button is deliberately NOT part of this rule: results ARE a child of the form, so
// «بحث» keeps pushing and Back from results correctly returns to the filter form. Check C pins that
// distinction so a future "make it all replace" over-correction cannot quietly delete it.
//
//   node --experimental-strip-types scripts/verify-mode-switch-costs-no-history.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
/** Drop comment lines so a router.push( mentioned in prose is never mistaken for a call site. */
const strip = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

/** The `onSwitch={...}` expression of the <ModeSwitch> mounted in `file`. */
function onSwitchExpr(file: string): string {
  const code = strip(read(file));
  const tags = [...code.matchAll(/<ModeSwitch\b[\s\S]*?\/>/g)].map((m) => m[0]);
  if (tags.length !== 1) throw new Error(`${file}: expected exactly one <ModeSwitch …/>, found ${tags.length}`);
  const m = /onSwitch=\{([\s\S]*?)\}\s/.exec(tags[0]);
  if (!m) throw new Error(`${file}: <ModeSwitch> has no onSwitch={…}`);
  return m[1].trim();
}

// ── A. Both halves of the toggle REPLACE — neither may push ──────────────────────────────────────
const halves = [
  ['src/app/index.tsx', 'Filter home → AI agent', "router.replace('/agent')"],
  ['src/app/agent.tsx', 'AI agent → Filter home', "router.replace('/')"],
] as const;

const verbs: string[] = [];
for (const [file, direction, expected] of halves) {
  const expr = onSwitchExpr(file);
  const verb = /router\.(push|replace|navigate|back)\s*\(/.exec(expr)?.[1] ?? '(none)';
  verbs.push(verb);
  check(`A. ${direction} (${file}) toggles with ${expected}`,
    verb === 'replace' && expr.includes(expected),
    `onSwitch={${expr}}  →  router.${verb}(…)\n      ` +
    `router.push here adds a history entry the other half's replace() never pops — that is the defect.`);
}

// ── B. …and they AGREE. Asymmetry is the bug, whichever side drifts ──────────────────────────────
check('B. the two halves of the pill use the SAME navigation verb (symmetry is the invariant)',
  verbs.length === 2 && verbs[0] === verbs[1],
  `index.tsx uses router.${verbs[0]}(), agent.tsx uses router.${verbs[1]}() — ` +
  `a mismatched pair is exactly what leaked a junk '/' entry and a duplicate Filter screen per round trip.`);

// ── C. Search still PUSHES — results are a child of the form, not a mode ─────────────────────────
{
  const code = strip(read('src/app/index.tsx'));
  const nav = /router\.(push|replace|navigate)\(\{\s*pathname:\s*'\/agent',\s*params:\s*\{\s*filter:/.exec(code);
  check('C. «بحث» (Search) still creates a history entry, so Back from results returns to the form',
    !!nav && nav[1] !== 'replace',
    nav ? `search navigates with router.${nav[1]}(…)` : 'no `router.*({ pathname: "/agent", params: { filter: … } })` call found');
}

console.log(failures === 0
  ? '\n✓ the Filter ⇄ AI mode pill replaces in both directions — toggling costs no history and stacks no duplicate screens\n'
  : `\n✗ ${failures} check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
