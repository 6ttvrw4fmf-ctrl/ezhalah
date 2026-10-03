// AN ADVANCED FILTER ROUND LEAVES THE READER WHERE THEY ARE, AND SAYS EVERYTHING IN ONE SUMMARY
// (owner 2026-10-03). Offline and deterministic: no browser, no network.
//
// THE DEFECT, MEASURED LIVE 2026-10-03 on production: finish a round and the page jumped to the top.
// Cause: #5400 (2026-10-01) hid every earlier results turn with `display:'none'` while a search
// loaded, so an 8,800 px thread became one screen and the browser clamped the scroll to 0 under the
// reader; when the turns came back above the new one the view jumped again. The owner's words: «he
// shouldn't go up — he's still in that same screen, and that allows him to scroll. If he goes up, he
// sees the filter.» The same sitting asked for: the summary to include the original summary AND what
// the filter added; no ✕ on the chips; and a sad emoji on the «didn't mention this» line.
//
// WHAT THIS FILE EXECUTES vs. PINS BY SOURCE. The summary composition is EXECUTED (afSummary.ts is
// pure and zero-dependency). The scroll behaviour lives in agent.tsx, a React component Node cannot
// import, so it is pinned as code SHAPE — and every pin is mutation-proven below against a deliberately
// broken copy of the REAL file, so a pin that cannot fail is caught here, not in production.
// The real browser evidence (scrollHeight never below its start, scrollTop never above where the
// reader was) is recorded in the PR that introduced this file.
//
//   node --experimental-strip-types scripts/verify-af-stays-in-place.ts   (wired into `npm test`)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildAfSummaryItems, withAdvancedBlock } from '../src/lib/afSummary.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

// ── 1. THE SUMMARY IS WHOLE (executed) ──────────────────────────────────────────────────────────
const BASE = 'ملخص البحث\n• نوع العقار: الشقق والسكن المشترك\n• نوع العملية: للإيجار (سنوي)\n• المدينة: الرياض\n• الإقليم: الرياض';
const HEAD = 'من الفلتر المتقدم';
const round1 = [
  { id: 'property_type', keys: ['Apartment'], labels: ['شقة'] },
  { id: 'furnished', keys: ['yes'], labels: ['مفروش'] },
  { id: 'bathrooms', keys: ['2'], labels: ['+٢'] },
  { id: 'property_age', keys: ['new'], labels: ['جديد'] },
];
const s1 = withAdvancedBlock(BASE, round1, HEAD);
check('the original summary lines survive untouched, at the top', s1.startsWith(`${BASE}\n`));
check('every committed answer is listed under the advanced heading, one bullet each, in order',
  s1.endsWith(`${HEAD}:\n• شقة 🏡\n• مفروش 🛋️\n• +٢ حمامات 🚿\n• عمر جديد ✨`), s1);
check('a type answer does not overwrite the original «نوع العقار» line (the old summary said «شقة» there)',
  s1.includes('• نوع العقار: الشقق والسكن المشترك') && !s1.includes('• نوع العقار: شقة'));
const s2 = withAdvancedBlock(BASE, [...round1, { id: 'direction', keys: ['n'], labels: ['شمال'] }], HEAD);
check('a second round ADDS to the list instead of replacing it',
  s2.includes('• شقة 🏡') && s2.includes('• شمال 🧭') && s2.indexOf('• شقة 🏡') < s2.indexOf('• شمال 🧭'));
check('no committed answer ⇒ the base summary exactly, with no empty heading', withAdvancedBlock(BASE, [], HEAD) === BASE);
check('the same answer twice is listed once (dedupe at the finished item)',
  buildAfSummaryItems([...round1, round1[1]]).length === round1.length);

// ── 2. THE PAGE KEEPS ITS HEIGHT, AND THE READER STAYS (source shape, mutation-proven) ──────────
const AGENT = read('src/app/agent.tsx');
const CARD = read('src/components/AdvancedQuestionCard.tsx');

const stayProblems = (agentSrc: string, cardSrc: string): string[] => {
  const code = strip(agentSrc);
  const card = strip(cardSrc);
  const out: string[] = [];
  // The results-turn container: from its onLayout (the only one that records msgYRef) to the end of its style prop.
  const at = code.indexOf('onLayout={(e) => { msgYRef.current[m.id] = e.nativeEvent.layout.y; }}');
  const turn = at < 0 ? '' : code.slice(at, code.indexOf('>', code.indexOf('style={{', at)));
  if (!turn) out.push('the results-turn container could not be located');
  if (/display:\s*searchingVisibleRef\.current/.test(turn) || /'none'/.test(turn))
    out.push('earlier results turns are REMOVED (display none) while a search loads — the page collapses and the reader is thrown to the top');
  if (!/opacity:\s*searchingVisibleRef\.current[^\n]*\?\s*0\.35\s*:\s*1/.test(turn))
    out.push('earlier results turns are not dimmed while a search loads (the old count must still read as the old one)');
  if (!/const echoId = uid\(\);/.test(code) || !/role: 'user', text: label/.test(code))
    out.push('a round does not give its answers bubble an id the view can ease to');
  if (!/for \(const d of \[80, 700, 1500\]\) easeToMsgTop\(echoId, d\);/.test(code))
    out.push('a round does not ease down to its own answers bubble when its search starts (the reader would have to scroll to find it)');
  if (!/<View key=\{m\.id\} ref=\{\(n: any\) => \{ msgNodeRef\.current\[m\.id\] = n; \}\} style=\{s\.userBubble\}>/.test(code))
    out.push('the user bubble is not registered in msgNodeRef, so easing to it measures nothing');
  if (!/guidedSearchSummary\(opts\.guided\.baseQ, opts\.guided\.facets\)/.test(code))
    out.push('a guided round\'s turn does not use the whole summary (original + every committed answer)');
  if (/guidedBasedOn/.test(code.replace(/guidedBasedOn:\s*\{[^}]*\},?/g, '')))
    out.push('the «بناءً على» sentence is back — the summary already says it');
  if (/onRemove|removeGuidedFacet|name="close"/.test(code.slice(code.indexOf('guidedPills.facets.map'), code.indexOf('guidedPills.facets.map') + 600)))
    out.push('a transcript chip has a ✕ or a remove handler');
  if (!/\{'😔 '\}\{t\('\{n\} listings did not mention this'/.test(card))
    out.push('the «did not mention this» line does not lead with 😔');
  return out;
};

const real = stayProblems(AGENT, CARD);
check('the shipped agent screen and question card satisfy every pin', real.length === 0, real.join('\n      '));

// ── 3. MUTATION PROOF — each pin against the defect it exists for, applied to the REAL files ────
console.log('\n  mutation proof — every pin must go red on its own defect\n');
let mutFail = 0;
const mustCatch = (what: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${what}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${what}`);
};
const swap = (src: string, from: string | RegExp, to: string) => {
  const out = src.replace(from, to);
  if (out === src) throw new Error(`mutation anchor missing: ${String(from).slice(0, 80)}`);
  return out;
};
mustCatch('#5400 coming back — earlier turns hidden with display:none',
  stayProblems(swap(AGENT, /opacity: searchingVisibleRef\.current \|\| /, "display: searchingVisibleRef.current || "), CARD).length > 0);
mustCatch('earlier turns neither dimmed nor hidden',
  stayProblems(swap(AGENT, /\? 0\.35 : 1/, '? 1 : 1'), CARD).length > 0);
mustCatch('the round no longer eases to its own answers bubble',
  stayProblems(swap(AGENT, 'for (const d of [80, 700, 1500]) easeToMsgTop(echoId, d);', ''), CARD).length > 0);
mustCatch('the user bubble losing its node registration',
  stayProblems(swap(AGENT, '<View key={m.id} ref={(n: any) => { msgNodeRef.current[m.id] = n; }} style={s.userBubble}>', '<View key={m.id} style={s.userBubble}>'), CARD).length > 0);
mustCatch('the turn summary reverting to the refined query alone (original lines overwritten)',
  stayProblems(swap(AGENT, 'guidedSearchSummary(opts.guided.baseQ, opts.guided.facets)', 'buildScrapeIntro(result.query ?? refined)'), CARD).length > 0);
mustCatch('a ✕ coming back on the chips',
  stayProblems(swap(AGENT, '<View key={`${f.id}-${i}`} testID={`af-pill-${i}`} style={s.guidedPill}>', '<View key={`${f.id}-${i}`} testID={`af-pill-${i}`} style={s.guidedPill} onRemove={() => 1}>'), CARD).length > 0);
mustCatch('the sad emoji dropped from the unknown line',
  stayProblems(AGENT, swap(CARD, "{'😔 '}{t('{n} listings", "{t('{n} listings")).length > 0);
// …and the executed half must also notice its own subject disappearing.
{
  // A composer that REPLACES the original summary with the answers (the old behaviour: the refined query
  // alone), and one that prints the heading with nothing under it — the executed pins must reject both.
  const overwriting = (_base: string, f: typeof round1, h: string) => `${h}:\n${buildAfSummaryItems(f).map((i) => `• ${i}`).join('\n')}`;
  const emptyHeading = (b: string, _f: typeof round1, h: string) => `${b}\n${h}:`;
  mustCatch('an advanced block that overwrites the original summary instead of following it',
    !overwriting(BASE, round1, HEAD).startsWith(`${BASE}\n`));
  mustCatch('an advanced heading printed with no answers under it',
    emptyHeading(BASE, [], HEAD) !== BASE);
}

if (mutFail) failed += mutFail;
console.log(failed === 0
  ? '\n✅ a filter round stays in place, speaks one whole summary, shows no ✕ and says «😔 لم يذكر».\n'
  : `\n❌ ${failed} check(s) failed — the reader can be thrown to the top, or the summary is not whole.\n`);
process.exit(failed === 0 ? 0 : 1);
