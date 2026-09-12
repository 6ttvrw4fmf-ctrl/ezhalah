// MOBILE: THE SEARCH-LOADING STRIP MUST NOT DRAG THE PAGE, AND MUST FIT WITHOUT SCROLLING
// (owner 2026-09-12, testing on phone: "when I click on the following things I want in the filter...
// it shows me all the platforms, and it takes me down automatically... it shouldn't drag me down"
// / "I want them to all show on one screen... I noticed the user has to scroll to see them").
//
// Two independent fixes, each pinned here by EXECUTING the real predicate:
//   1. Filter search's onBubbleDone() no longer force-scrolls the page the instant the searching
//      loader mounts (agent.tsx). pinModeRef is already 'none' at that point, so nothing else
//      re-triggers a scroll either (onGrow() only acts on 'top'/'bottom').
//   2. Below LOADER_PILL_LABEL_BREAKPOINT, platform pills drop their name and shrink to a compact
//      logo-only tile (SearchLoader.tsx), so ~45 platforms can fit a phone screen without scrolling.
//      The accessible name survives the drop (accessibilityLabel), and the breakpoint is SSR-safe
//      (routed through useAtLeast(), same contract verify-ssr-hydration-parity.ts already proves).
//
//   node --experimental-strip-types scripts/verify-mobile-search-loader-no-drag.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
const decomment = (src: string) => src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');

console.log('\n── 1. onBubbleDone (Filter search) no longer force-scrolls when the loader mounts ──');
const agent = readFileSync(join(root, 'src/app/agent.tsx'), 'utf8');
const code = decomment(agent);

const onBubbleDoneStart = code.indexOf('const onBubbleDone = () => {');
const onBubbleDoneAsyncStart = code.indexOf('void (async () => {', onBubbleDoneStart);
check('onBubbleDone() and its async IIFE both exist, in order', onBubbleDoneStart >= 0 && onBubbleDoneAsyncStart > onBubbleDoneStart);
const beforeAsync = onBubbleDoneStart >= 0 && onBubbleDoneAsyncStart > onBubbleDoneStart
  ? code.slice(onBubbleDoneStart, onBubbleDoneAsyncStart) : '';
check('the setMsgs(...) that mounts the searching-status message is in that span',
  /setMsgs\(\(m\) => \[\.\.\.m, \{ id: statusId, role: 'status', phase: 'searching'/.test(beforeAsync));
check('no toBottom() call sits between that setMsgs(...) and the async fetch (the abrupt mount-time jump is gone)',
  !/toBottom\(\)/.test(beforeAsync));

mustCatch('re-inserting toBottom() right after the searching-status setMsgs (the exact regression)',
  (() => {
    const mutated = agent.replace(
      "setMsgs((m) => [...m, { id: statusId, role: 'status', phase: 'searching', query: pending.q }]);\n    //",
      "setMsgs((m) => [...m, { id: statusId, role: 'status', phase: 'searching', query: pending.q }]);\n    toBottom();\n    //",
    );
    if (mutated === agent) return false; // the replace must actually have matched something
    const c2 = decomment(mutated);
    const s2 = c2.indexOf('const onBubbleDone = () => {');
    const a2 = c2.indexOf('void (async () => {', s2);
    const span2 = s2 >= 0 && a2 > s2 ? c2.slice(s2, a2) : '';
    return /toBottom\(\)/.test(span2);
  })());

console.log('\n── 2. platform pills drop to a compact, logo-only, SSR-safe tile on narrow viewports ──');
const loader = readFileSync(join(root, 'src/components/SearchLoader.tsx'), 'utf8');
const responsive = readFileSync(join(root, 'src/lib/responsive.ts'), 'utf8');

check('LOADER_PILL_LABEL_BREAKPOINT is declared in lib/responsive.ts (the one shared home for breakpoints)',
  /export const LOADER_PILL_LABEL_BREAKPOINT = \d+;/.test(responsive));
check('SearchLoader reads it through useAtLeast() — SSR-safe, never a raw useWindowDimensions() compare',
  /const showPillLabels = useAtLeast\(LOADER_PILL_LABEL_BREAKPOINT\);/.test(loader));
check('PlatformPill accepts a compact prop and threads it from showPillLabels',
  /compact: boolean;/.test(loader) && /compact=\{!showPillLabels\}/.test(loader));
check('compact renders NO name Text node (logo-only) — the actual JSX branch, not just a style tweak',
  /\{compact \? null : \(/.test(loader));
check('the accessible name survives the drop (accessibilityLabel carries it when compact)',
  /accessibilityLabel=\{compact \? name : undefined\}/.test(loader));

mustCatch('compact rendering the Text anyway (label never actually drops)',
  (() => {
    const mutated = loader.replace('{compact ? null : (', '{false ? null : (');
    if (mutated === loader) return false;
    return !/\{compact \? null : \(/.test(mutated);
  })());
mustCatch('the breakpoint check reading a bare useWindowDimensions() width instead of useAtLeast()',
  (() => {
    const mutated = loader.replace(
      'const showPillLabels = useAtLeast(LOADER_PILL_LABEL_BREAKPOINT);',
      'const showPillLabels = useWindowDimensions().width >= LOADER_PILL_LABEL_BREAKPOINT;',
    );
    if (mutated === loader) return false;
    return !/const showPillLabels = useAtLeast\(LOADER_PILL_LABEL_BREAKPOINT\);/.test(mutated);
  })());

console.log(failed ? `\n${failed} FAILED` : '\nAll mobile-search-loader-no-drag checks passed');
process.exit(failed ? 1 : 0);
