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
import { buildAfSummaryItems, withAdvancedLines, AF_LINE_LABEL, AF_LINE_FALLBACK } from '../src/lib/afSummary.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

// ── 1. THE SUMMARY IS WHOLE (executed) ──────────────────────────────────────────────────────────
// Owner 2026-10-03, second pass: no «من الفلتر المتقدم» heading, no emoji in the summary — each answer
// continues the SAME bullet list as a labelled line. The labels are translated with the REAL Arabic
// dictionary (parsed from src/i18n.tsx), so a missing translation shows up here as an English label.
const I18N = read('src/i18n.tsx');
const AR = (key: string) => {
  const m = I18N.match(new RegExp(`\\n\\s*'${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':\\s*'([^']*)'`));
  return m ? m[1] : key;
};
const BASE = 'ملخص البحث\n• نوع العقار: الشقق والسكن المشترك\n• نوع العملية: للإيجار (شهري)\n• المدينة: الرياض\n• الإقليم: الرياض';
const round1 = [
  { id: 'property_type', keys: ['Apartment'], labels: ['شقة'] },
  { id: 'bathrooms', keys: ['1'], labels: ['+١'] },
  { id: 'amenities', keys: ['kitchen', 'elevator'], labels: ['المطبخ', 'مصعد'] },
];
const OWNER_EXAMPLE = `${BASE}\n• نوع العقار المحدد: شقة\n• دورات المياه: +١\n• المميزات: المطبخ، مصعد`;
type Composer = (base: string, f: typeof round1, tr: (k: string) => string) => string;
const summaryProblems = (compose: Composer): string[] => {
  const out: string[] = [];
  const s1 = compose(BASE, round1, AR);
  if (s1 !== OWNER_EXAMPLE) out.push(`the owner's own example does not come out exactly:\n${s1}`);
  if (!s1.startsWith(`${BASE}\n`)) out.push('the original summary lines are not kept untouched at the top');
  if (/من الفلتر المتقدم/.test(s1)) out.push('the «من الفلتر المتقدم» heading is back');
  if (/\p{Extended_Pictographic}/u.test(s1.slice(BASE.length))) out.push('an emoji is back inside the summary lines');
  if (!s1.includes('• نوع العقار: الشقق والسكن المشترك') || s1.includes('• نوع العقار: شقة')) out.push('a type answer overwrote the original «نوع العقار» line');
  const s2 = compose(BASE, [...round1, { id: 'amenities', keys: ['parking', 'kitchen'], labels: ['مواقف', 'المطبخ'] }, { id: 'direction', keys: ['n', 'w'], labels: ['شمال', 'غرب'] }], AR);
  if (!s2.endsWith('• المميزات: المطبخ، مصعد، مواقف\n• الواجهة: شمال أو غرب'))
    out.push(`a second round does not merge into the same labelled line / direction does not read «أو»:\n${s2}`);
  if (compose(BASE, [], AR) !== BASE) out.push('no committed answer does not give back the base summary exactly');
  for (const [id, key] of Object.entries(AF_LINE_LABEL))
    if (AR(key) === key) out.push(`the ${id} line label «${key}» has no Arabic translation`);
  if (AR(AF_LINE_FALLBACK) === AF_LINE_FALLBACK) out.push('the fallback label has no Arabic translation');
  return out;
};
const sumReal = summaryProblems(withAdvancedLines);
check('the summary continues the same list — «نوع العقار المحدد: شقة», «دورات المياه: +١», «المميزات: المطبخ، مصعد» — no heading, no emoji',
  sumReal.length === 0, sumReal.join('\n      '));
check('the chips BELOW the summary keep their emoji — شقة 🏡 · +١ حمامات 🚿 · المطبخ 🍳، مصعد 🛗',
  round1.map((f) => buildAfSummaryItems([f]).join('، ')).join(' · ') === 'شقة 🏡 · +١ حمامات 🚿 · المطبخ 🍳، مصعد 🛗');
check('the same answer twice is listed once (dedupe at the finished item)',
  buildAfSummaryItems([...round1, round1[1]]).length === buildAfSummaryItems(round1).length);

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
  if (!/<View key=\{m\.id\} ref=\{\(n: any\) => \{ msgNodeRef\.current\[m\.id\] = n; \}\} style=\{[^}]*\}>/.test(code))
    out.push('the user bubble is not registered in msgNodeRef, so easing to it measures nothing');
  if (!/guidedSearchSummary\(opts\.guided\.baseQ, opts\.guided\.facets\)/.test(code))
    out.push('a guided round\'s turn does not use the whole summary (original + every committed answer)');
  if (/guidedBasedOn/.test(code.replace(/guidedBasedOn:\s*\{[^}]*\},?/g, '')))
    out.push('the «بناءً على» sentence is back — the summary already says it');
  if (/onRemove|removeGuidedFacet|name="close"/.test(code.slice(code.indexOf('guidedPills.facets.map'), code.indexOf('guidedPills.facets.map') + 600)))
    out.push('a transcript chip has a ✕ or a remove handler');
  // «add the emojis here» (owner 2026-10-03): a chip reads exactly like its summary line — شقة 🏡, مفروش 🛋️.
  if (!/<Text style=\{s\.guidedPillTx\}>\{buildAfSummaryItems\(\[f\]\)\.join\('، '\)\}<\/Text>/.test(code))
    out.push('a transcript chip shows the bare label, without the emoji its summary line carries');
  if (!/<Text style=\{s\.pillTx\}>\{buildAfSummaryItems\(\[f\]\)\.join\('، '\)\}<\/Text>/.test(card))
    out.push('a question-card chip shows the bare label, without the emoji its summary line carries');
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
  stayProblems(swap(AGENT, '<View key={m.id} ref={(n: any) => { msgNodeRef.current[m.id] = n; }} style={[s.userBubble, rtl ? s.userMessageRtl : s.userMessageLtr]}>', '<View key={m.id} style={[s.userBubble, rtl ? s.userMessageRtl : s.userMessageLtr]}>'), CARD).length > 0);
mustCatch('the turn summary reverting to the refined query alone (original lines overwritten)',
  stayProblems(swap(AGENT, 'guidedSearchSummary(opts.guided.baseQ, opts.guided.facets)', 'buildScrapeIntro(result.query ?? refined)'), CARD).length > 0);
mustCatch('a ✕ coming back on the chips',
  stayProblems(swap(AGENT, '<View key={`${f.id}-${i}`} testID={`af-pill-${i}`} style={s.guidedPill}>', '<View key={`${f.id}-${i}`} testID={`af-pill-${i}`} style={s.guidedPill} onRemove={() => 1}>'), CARD).length > 0);
mustCatch('a transcript chip losing its emoji (bare label again)',
  stayProblems(swap(AGENT, "<Text style={s.guidedPillTx}>{buildAfSummaryItems([f]).join('، ')}</Text>", "<Text style={s.guidedPillTx}>{f.labels.join('، ')}</Text>"), CARD).length > 0);
mustCatch('a question-card chip losing its emoji (bare label again)',
  stayProblems(AGENT, swap(CARD, "<Text style={s.pillTx}>{buildAfSummaryItems([f]).join('، ')}</Text>", "<Text style={s.pillTx}>{f.labels.join('، ')}</Text>")).length > 0);
mustCatch('the sad emoji dropped from the unknown line',
  stayProblems(AGENT, swap(CARD, "{'😔 '}{t('{n} listings", "{t('{n} listings")).length > 0);
// …and the executed half must also notice its own subject disappearing: each broken composer below is
// the real one with one defect, and summaryProblems() must reject it.
{
  const real: Composer = withAdvancedLines;
  mustCatch('the «من الفلتر المتقدم» heading coming back',
    summaryProblems((b, f, tr) => { const r = real(b, f, tr); return r === b ? r : r.replace(`${b}\n`, `${b}\nمن الفلتر المتقدم:\n`); }).length > 0);
  mustCatch('the emoji coming back into the summary lines',
    summaryProblems((b, f, tr) => (f.length ? `${b}\n${buildAfSummaryItems(f).map((i) => `• ${i}`).join('\n')}` : b)).length > 0);
  mustCatch('the answers overwriting the original summary instead of following it',
    summaryProblems((b, f, tr) => real('ملخص البحث', f, tr)).length > 0);
  mustCatch('a second round printing a second «المميزات» line instead of merging',
    summaryProblems((b, f, tr) => (f.length ? `${b}\n${f.map((x) => real('', [x], tr).trim()).join('\n')}` : b)).length > 0);
}

if (mutFail) failed += mutFail;
console.log(failed === 0
  ? '\n✅ a filter round stays in place, speaks one whole summary, shows no ✕ and says «😔 لم يذكر».\n'
  : `\n❌ ${failed} check(s) failed — the reader can be thrown to the top, or the summary is not whole.\n`);
process.exit(failed === 0 ? 0 : 1);
