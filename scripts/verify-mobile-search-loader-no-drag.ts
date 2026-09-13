// SEARCH-LOADING STRIP: NO FORCED SCROLL, NO BOX, THE NAME ALWAYS SHOWS
// (owner 2026-09-12, testing on phone: "it shows me all the platforms, and it takes me down
// automatically... it shouldn't drag me down". Same day, a few hours later, on the pill treatment
// itself: "the animated logos are not nice... I don't know why you made them in boxes... remove
// those boxes... make the background transparent so it blends in with our background, because now
// it shows that it is a box and it's a photo... put the name also, because we need to include the
// name of each website" — this REVERSES the same-day logo-only mobile compact tile; the name now
// always renders, every viewport).
//
// Two independent invariants, each pinned here by EXECUTING the real predicate:
//   1. Filter search's onBubbleDone() no longer force-scrolls the page the instant the searching
//      loader mounts (agent.tsx). pinModeRef is already 'none' at that point, so nothing else
//      re-triggers a scroll either (onGrow() only acts on 'top'/'bottom'). UNCHANGED by the box fix.
//   2. PlatformPill never carries a fill or a border — resting or highlighted — and the name Text
//      always renders (no compact/logo-only branch survives). The highlight is shadow+color only.
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

console.log('\n── 2. platform pills carry NO box, and the name ALWAYS renders ──');
const loader = readFileSync(join(root, 'src/components/SearchLoader.tsx'), 'utf8');
const loaderCode = decomment(loader);

check('no leftover compact prop/branch anywhere (the reversed feature is fully gone, not just unused)',
  !/compact/i.test(loaderCode));

const pillStyleMatch = loaderCode.match(/pill: \{([^}]*)\}/);
const pillStyleBody = pillStyleMatch?.[1] ?? '';
check("the pill's base style declares NO backgroundColor and NO borderWidth/borderColor",
  pillStyleBody.length > 0 && !/backgroundColor/.test(pillStyleBody) && !/border(Width|Color)/.test(pillStyleBody),
  `pill: {${pillStyleBody}}`);

const pillLogoStyleMatch = loaderCode.match(/pillLogo: \{([^}]*)\}/);
check("the logo's own style declares NO backgroundColor either (no backdrop square behind it)",
  !/backgroundColor/.test(pillLogoStyleMatch?.[1] ?? ''));

const rowGlowMatch = loaderCode.match(/const rowGlow = useAnimatedStyle\(\(\) => \{([\s\S]*?)\n  \}\);/);
const rowGlowBody = rowGlowMatch?.[1] ?? '';
check('the highlight animated-style (rowGlow) never sets backgroundColor or borderColor — shadow/transform only',
  rowGlowBody.length > 0 && !/backgroundColor:/.test(rowGlowBody) && !/borderColor:/.test(rowGlowBody),
  rowGlowBody);
check('the highlight still animates a shadow (boxShadow web / shadow* native) — the glow itself survives',
  /boxShadow:/.test(rowGlowBody) && /shadowColor:/.test(rowGlowBody));

check('the name Text renders unconditionally (no `compact ? null :` branch, no ternary hiding it)',
  /<Animated\.Text[\s\S]{0,200}\{name\}[\s\S]{0,20}<\/Animated\.Text>/.test(loaderCode)
  && !/compact \? null/.test(loaderCode));
check('the name itself is what animates on highlight (nameGlow interpolates its color)',
  /const nameGlow = useAnimatedStyle\(\(\) => \(\{\s*color: interpolateColor\(h\.value/.test(loaderCode));

mustCatch('a fill creeping back into the base pill style (the exact "box" regression)',
  (() => {
    const mutated = loader.replace(
      'pill: { alignItems: \'center\', gap: 7, height: 34, paddingHorizontal: 2 },',
      'pill: { alignItems: \'center\', gap: 7, height: 34, paddingHorizontal: 2, backgroundColor: colors.tint },',
    );
    if (mutated === loader) return false;
    const body = decomment(mutated).match(/pill: \{([^}]*)\}/)?.[1] ?? '';
    return /backgroundColor/.test(body);
  })());
mustCatch('the name being hidden behind a conditional again (the exact "logo-only" regression)',
  (() => {
    const mutated = loader.replace(
      '<Animated.Text',
      '{false ? null : <Animated.Text',
    ).replace('</Animated.Text>', '</Animated.Text>}');
    if (mutated === loader) return false;
    return /\{false \? null : <Animated\.Text/.test(mutated);
  })());

console.log(failed ? `\n${failed} FAILED` : '\nAll mobile-search-loader-no-drag checks passed');
process.exit(failed ? 1 : 0);
