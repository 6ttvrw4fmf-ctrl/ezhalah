// THE ADVANCED-FILTER OVERLAY IS GONE, AND MUST STAY GONE.
//
// This file used to police the «digging through the market» card: its copy, its scrim, its reduced-
// motion composition, and — through three reversals — whether it ended on a «لقينا N عقار أقرب
// لطلبك» completion beat (removed 2026-08-31, restored 2026-09-06, removed again 2026-09-20).
//
// On 2026-09-20 the owner ended the argument by deleting the card itself: "when the user clicks on
// what he wants, then there is this pop-up that pops up with a magnifying glass … this needs to be
// gone". Two earlier passes had removed only the card's COMPLETION state, which was the wrong half —
// what he had been calling "the pop-up" was the card in its SEARCHING state, magnifier and all.
//
// WHY THIS FILE SURVIVES THE COMPONENT IT POLICED. A barrier deleted alongside its subject takes the
// memory with it, and this particular subject has come back twice. So the checks invert: instead of
// describing how the overlay must look, they assert that no overlay exists — in the component tree,
// in the flow's phases, in the render, or in the imports. Re-introducing one now fails here first,
// and whoever does it has to read this header and the three reversals behind it.
//
// NOTHING WAS LOST BY REMOVING IT. The scrim was translucent ON PURPOSE so "the searching turn
// behind the card — the platform roster included — reads through". That searching turn belongs to
// the thread (runRefine renders it), never to this overlay, so deleting the card stops covering it:
// the user still watches «نراجع N منصة عقارية» do the work, just without a sheet on top.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// windowBetween, not slice(indexOf, indexOf): a raw window silently widens to the rest of the file
// when a marker moves, so every assertion under it would pass against unrelated source.
import { windowBetween } from './lib/sourceWindow.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};
const agent = readFileSync(join(root, 'src/app/agent.tsx'), 'utf8');

console.log('\nThe Advanced-Filter overlay is gone and stays gone (owner 2026-09-20)\n');

// ── A. the component, the phase, the render, the import ─────────────────────────────────────────
check('src/components/MiningTransition.tsx does not exist',
  !existsSync(join(root, 'src/components/MiningTransition.tsx')));
check('no source file imports or renders it',
  !readdirSync(join(root, 'src'), { recursive: true, encoding: 'utf8' })
    .filter((f) => typeof f === 'string' && /\.tsx?$/.test(f))
    .some((f) => readFileSync(join(root, 'src', f), 'utf8').includes('MiningTransition')));
check("the ageFlow union carries no 'mining' phase",
  !/phase: 'mining'/.test(agent) && !/phase === 'mining'/.test(agent));

// ── B. a finished round hands straight over ─────────────────────────────────────────────────────
// The round closes its question card and lets the thread's own searching turn show. If this ever
// becomes "open something first", the overlay is back under another name.
const fin = windowBetween(agent, 'const finishGuided = ', 'const startAgeFlow = ', 'src/app/agent.tsx');
check('finishGuided closes the card and opens nothing in its place',
  /setAgeFlow\(null\);/.test(fin) && !/setAgeFlow\(\{ phase:/.test(fin),
  'a round must hand over to the thread, never to another sheet');

// ── C. the retired copy left nothing dangling ───────────────────────────────────────────────────
// The card's sentences lived in i18n. An orphaned key is how a deleted surface quietly comes back.
const i18n = readFileSync(join(root, 'src/i18n.tsx'), 'utf8');
for (const key of [
  'Finding the closest match for you',
  'Going through {count} properties to pull out the best fit',
  'We found {count} properties closest to your request',
]) {
  check(`the retired key «${key.slice(0, 34)}…» is gone from i18n`, !i18n.includes(key));
}

// ── D. mutation proofs — each rule fed the regression it exists to catch ────────────────────────
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught,
    'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');

mustCatch('a re-added mining phase in the flow union',
  /phase: 'mining'/.test(`${agent}\n    | { phase: 'mining'; from: number | null }`));
mustCatch('finishGuided opening a sheet again instead of handing over',
  /setAgeFlow\(\{ phase:/.test(`${fin}\nsetAgeFlow({ phase: 'mining', from: 1 });`));
mustCatch('a re-added import of the deleted component',
  "import MiningTransition from '@/components/MiningTransition';".includes('MiningTransition'));

console.log(failed
  ? `\n✗ ${failed} check(s) FAILED — an Advanced-Filter overlay has come back\n`
  : '\n✓ no overlay: component, phase, render, import and copy are all gone; a round hands straight over\n');
process.exit(failed ? 1 : 0);
