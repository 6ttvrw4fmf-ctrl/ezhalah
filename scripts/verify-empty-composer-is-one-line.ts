// AN EMPTY COMPOSER IS ONE LINE TALL (owner 2026-10-11, iPhone screenshot).
//
// What the owner saw: the placeholder «اكتب العقار اللي تبحث …» sat at the TOP of the box while the «بحث» chip, the mic and
// the Stop button sat lower — not the single tidy row the composer is meant to be. Cause: onContentSizeChange fed the
// measured height of the box straight into the box's own height, even when nothing was typed. On iOS Safari the
// PLACEHOLDER wraps onto a second line and is measured, so an EMPTY box grew to two lines, and the controls (the row is
// alignItems: 'flex-end') dropped to the bottom. Chrome never wraps it, so desktop and the Chromium emulator looked fine.
//
// Rule: the box is as tall as the text typed, and exactly COMPOSER_MIN_H (one line) when empty — whatever the platform
// reports for the placeholder. The expression is EXECUTED below, and every wiring point is pinned and mutation-proven.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { windowBetween } from './lib/sourceWindow.ts';

const ROOT = join(import.meta.dirname, '..');
const agent = readFileSync(join(ROOT, 'src/app/agent.tsx'), 'utf8');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`  ${ok ? '✓' : '❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
console.log('\nAn empty composer is one line tall, whatever the placeholder measures\n');

const region = windowBetween(agent, 'const [inputH, setInputH] = useState(COMPOSER_MIN_H);', '// Clicking/tapping into the composer counts as interaction', 'src/app/agent.tsx');

// 1. the height rule, EXECUTED on the real expression
const expr = (src: string) => src.match(/const composerH = ([^;]+);/)?.[1] ?? '';
const run = (src: string, typed: string, inputH: number) => new Function('typed', 'inputH', 'COMPOSER_MIN_H', 'COMPOSER_MAX_H', `return ${expr(src)};`)(typed, inputH, 22, 112);
const rule = (src: string) => run(src, '', 44) === 22 && run(src, '', 300) === 22 && run(src, 'شقة', 44) === 44 && run(src, 'شقة', 10) === 22 && run(src, 'شقة', 500) === 112;
check('an empty box is 22 px (one line) even if the placeholder measures 44 or 300; a typed box follows its text, between 22 and 112', rule(region));
mustCatch('the old rule (height always follows what was measured, even when empty)',
  !rule(region.replace(/const composerH = [^;]+;/, 'const composerH = Math.min(COMPOSER_MAX_H, Math.max(COMPOSER_MIN_H, inputH));')));

// 2. the box and the text input both use it (no raw inputH left in a height)
const wired = (src: string) => /style=\{\[s\.inputGrow, INPUT_EASE, \{ height: composerH \}\]\}/.test(src) && /paddingRight: 0, paddingLeft: 0, height: composerH \} as any\]\}/.test(src) && !/height: Math\.min\(COMPOSER_MAX_H, Math\.max\(COMPOSER_MIN_H, inputH\)\)/.test(src);
check('the wrapper and the text input both take their height from composerH', wired(region));
mustCatch('the text input going back to the raw measured height', !wired(region.replace('height: composerH } as any]}', 'height: Math.min(COMPOSER_MAX_H, Math.max(COMPOSER_MIN_H, inputH)) } as any]}')));
mustCatch('the wrapper going back to the raw measured height', !wired(region.replace('{ height: composerH }]}', '{ height: Math.min(COMPOSER_MAX_H, Math.max(COMPOSER_MIN_H, inputH)) }]}')));

// 3. a measurement of an empty box is never stored
const guard = (src: string) => /onContentSizeChange=\{\(e: any\) => setInputH\(typed \? Math\.min\(COMPOSER_MAX_H, Math\.max\(COMPOSER_MIN_H, e\.nativeEvent\.contentSize\.height\)\) : COMPOSER_MIN_H\)\}/.test(src);
check('onContentSizeChange stores nothing for an empty box', guard(region));
mustCatch('onContentSizeChange storing the placeholder height again', !guard(region.replace('setInputH(typed ? Math.min(COMPOSER_MAX_H, Math.max(COMPOSER_MIN_H, e.nativeEvent.contentSize.height)) : COMPOSER_MIN_H)', 'setInputH(Math.min(COMPOSER_MAX_H, Math.max(COMPOSER_MIN_H, e.nativeEvent.contentSize.height)))')));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ an empty composer is one line tall');
