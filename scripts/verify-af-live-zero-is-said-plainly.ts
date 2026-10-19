// A LIVE ZERO IS SAID PLAINLY (owner 2026-10-08, backlog 281). Different features INTERSECT, so ticking several can
// leave nothing; the card then says «لا توجد نتائج بهذه الاختيارات» under the options. Only a resolved 0 for THIS
// selection prints it: a count in flight or failed is null and prints nothing (never a guessed zero, R14.3.2).
import { readFileSync } from 'node:fs';
const card = readFileSync(new URL('../src/components/AdvancedQuestionCard.tsx', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('../src/i18n.tsx', import.meta.url), 'utf8');
function wiring(c: string, t: string): string[] {
  const bad: string[] = [];
  const m = /\{sel\.length > 0 && count === 0 \? \([\s\S]*?\) : null\}/.exec(c)?.[0] ?? '';
  if (!m) bad.push('the zero note is no longer gated on a resolved 0 (count === 0) with a selection');
  if (!/testID="af-zero-note"/.test(m)) bad.push('the zero note lost its testID (the customer journey reads it)');
  if (!/t\('No results with these choices'\)/.test(m)) bad.push('the zero note no longer prints its sentence');
  if (!/'No results with these choices': 'لا توجد نتائج بهذه الاختيارات'/.test(t)) bad.push('the Arabic sentence is missing from i18n');
  if (/count == 0|!count\b/.test(m)) bad.push('the gate treats null (no count yet) as zero');
  if (!/setCount\(null\);[\s\S]{0,120}?liveCount\(sel\)/.test(c)) bad.push('the count is no longer cleared to null before each fetch (an old 0 could linger)');
  return bad;
}
let failed = 0;
const check = (l: string, bad: string[]) => { if (bad.length) failed++; console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${l}${bad.length ? '\n        ' + bad.join('\n        ') : ''}`); };
const mustCatch = (l: string, bad: string[]) => { if (!bad.length) failed++; console.log(`${bad.length ? 'PASS' : 'FAIL'}  (mutation) catches ${l}`); };
check('wiring', wiring(card, i18n));
mustCatch('a null count read as zero', wiring(card.replace('sel.length > 0 && count === 0 ?', 'sel.length > 0 && !count ?'), i18n));
mustCatch('the note removed', wiring(card.replace("t('No results with these choices')", "''"), i18n));
mustCatch('the Arabic sentence dropped', wiring(card, i18n.replace("'No results with these choices': 'لا توجد نتائج بهذه الاختيارات',", '')));
mustCatch('the count not cleared before a fetch', wiring(card.replace(/setCount\(null\);/, ''), i18n));
console.log(failed ? `\n${failed} FAILED` : '\nAll live-zero assertions passed');
process.exit(failed ? 1 : 0);
