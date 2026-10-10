// AN ADVANCED FILTER ROUND CHECKS THE USER'S OWN PICKS (owner 2026-10-10).
//
// Owner, verbatim: «make it 5 seconds the advanced filter · don't show the websites · … include what
// the user selected … and removes this like highlight blur», then «the ai agent should be like checking
// what the user selected» and «it can take up to 7 seconds max … apply to all advanced filter».
//
// So every Advanced Filter round shows AfCheckLoader («إزهله يفحص المواقع حسب اختيارك…», each pick
// spinning then ✓) instead of the platform-logo loader, holds 5–7 s in all, and leaves the earlier
// results undimmed. A NEW search is unchanged: logos, 10.6 s floor, earlier turns dimmed.
//
// The timing is EXECUTED (lib/afCheckTiming); the wiring in agent.tsx is pinned as code shape. Every rule
// is proven to fail on its own defect (mustCatch).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { windowBetween } from './lib/sourceWindow.ts';
import { afCheckTiming, afPickLabels, AF_CHECK_MIN_MS, AF_CHECK_MAX_MS } from '../src/lib/afCheckTiming.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
};
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
console.log('\nAn Advanced Filter round checks the user\'s picks: no logos, 5–7 s, no fade\n');

// ── 1. the beat is 5–7 s for any number of picks, and every pick is ticked before it ends (executed) ──
const EXIT = 450; // agent.tsx LOADER_EXIT_MS, pinned below
type Timing = typeof afCheckTiming;
const timingProblems = (fn: Timing): string[] => {
  const out: string[] = [];
  for (let n = 1; n <= 15; n++) {
    const { startMs, stepMs, holdMs } = fn(n, EXIT);
    const total = holdMs + EXIT;
    if (total < AF_CHECK_MIN_MS || total > AF_CHECK_MAX_MS) out.push(`${n} picks → ${total} ms on screen`);
    const lastTick = startMs + (n - 1) * stepMs + Math.round(stepMs * 0.8);
    if (stepMs <= 0 || lastTick > holdMs) out.push(`${n} picks → last ✓ at ${lastTick} ms, after the ${holdMs} ms hold`);
  }
  return out;
};
check('5 s ≤ checklist + exit fade ≤ 7 s, and the last pick is ticked inside it, for 1–15 picks', timingProblems(afCheckTiming).length === 0, timingProblems(afCheckTiming).join('; '));
check('the bounds are the owner\'s numbers', AF_CHECK_MIN_MS === 5000 && AF_CHECK_MAX_MS === 7000);
const timingSrc = read('src/lib/afCheckTiming.ts');
const variant = async (from: string, to: string): Promise<Timing> => {
  const src = timingSrc.replace(from, to);
  if (src === timingSrc) throw new Error(`mutation anchor missing: ${from}`);
  // A data: module has no base URL, so its one relative import is pointed at the real file.
  const js = stripTypeScriptTypes(src).replace("'./afSummary.ts'", `'${pathToFileURL(join(ROOT, 'src/lib/afSummary.ts')).href}'`);
  return (await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)).afCheckTiming;
};
mustCatch('a beat with no 7 s ceiling (many picks run long)',
  timingProblems(await variant('Math.min(AF_CHECK_MAX_MS - exitMs, ', '(')).length > 0);
mustCatch('a beat that forgets the exit fade (7 s + 450 ms)',
  timingProblems(await variant('AF_CHECK_MAX_MS - exitMs, Math.max', 'AF_CHECK_MAX_MS, Math.max')).length > 0);
const AR: Record<string, string> = { 'Bathrooms': 'دورات المياه', 'Features': 'الميزات', 'Payment': 'الدفع' };
const rows = afPickLabels([{ id: 'rnpl', keys: ['y'], labels: ['يقبل التقسيط'] }, { id: 'bathrooms', keys: ['1'], labels: ['+١'] }, { id: 'amenities', keys: ['k', 'p'], labels: ['المطبخ', 'مسبح'] }, { id: 'bathrooms', keys: ['1'], labels: ['+١'] }], (k) => AR[k] ?? k);
check('the checklist is every committed pick, in order, once, each named («دورات المياه: +١», not «+١»)',
  JSON.stringify(rows) === JSON.stringify(['الدفع: يقبل التقسيط', 'دورات المياه: +١', 'الميزات: المطبخ', 'الميزات: مسبح']), rows.join(' | '));

// ── 2. the wiring in agent.tsx ────────────────────────────────────────────────────────────────────
const agent = read('src/app/agent.tsx');
const loader = read('src/components/AfCheckLoader.tsx');
const refine = windowBetween(agent, 'const runRefine = async (', 'await playListings(run, statusId,', 'src/app/agent.tsx');
const play = windowBetween(agent, 'const playListings = async (', 'setMsgs((m) => m.map((x) => (x.id === statusId && x.role === \'status\' ? { ...x, exiting: true } : x)));', 'src/app/agent.tsx');
const render = windowBetween(agent, "if (m.role === 'status') {", "if (m.role === 'agent') {", 'src/app/agent.tsx');
const wiring = (a: string, p: string, r: string, l: string, full: string): string[] => {
  const out: string[] = [];
  if (!/const afPicks = opts\?\.guided \? afPickLabels\(opts\.guided\.facets, t\) : \[\];/.test(a)) out.push('a round does not list its committed picks');
  if (!/afHoldRef\.current\[statusId\] = afCheckTiming\(afPicks\.length, LOADER_EXIT_MS\)\.holdMs;/.test(a)) out.push('a round does not set its 5–7 s hold');
  if (!/\.\.\.\(afPicks\.length \? \{ afPicks \} : \{\}\)/.test(a)) out.push('the round\'s loader does not carry its picks');
  if (!/\} else \{\s*const remaining = \(afHoldRef\.current\[statusId\] \?\? 0\) - \(Date\.now\(\) - since\);\s*if \(remaining > 0\) await waitRun\(run, remaining\);/.test(p)) out.push('results do not wait for the checklist to finish');
  if (!/afPicks: x\.role === 'status' \? x\.afPicks : undefined/.test(p)) out.push('the picks are dropped when the loader is updated mid-round');
  if (!/if \(m\.afPicks\?\.length\) return <AfCheckLoader /.test(r) || r.indexOf('<AfCheckLoader') > r.indexOf('<SearchLoader')) out.push('a round does not render the checklist loader (logos instead)');
  if (/PlatformLogo|PlatformRosterPager|SearchLoader/.test(l.replace(/^\/\/.*$/gm, ''))) out.push('the checklist loader shows websites');
  if (!/const newSearchLoading = msgs\.some\(\(m\) => m\.role === 'status' && m\.phase === 'searching' && !m\.afPicks\);/.test(full)) out.push('a round dims the earlier results again');
  if (!/latestResult\?\.typing && !latestResult\.afCompleted && !doneTyping/.test(full)) out.push('a round\'s new results dim the earlier ones while they type in');
  if (!/const LOADER_EXIT_MS = 450;/.test(full)) out.push(`LOADER_EXIT_MS is no longer ${EXIT} ms (re-check the 7 s ceiling)`);
  return out;
};
const now = wiring(refine, play, render, loader, agent);
check('a round shows its picks (no websites), waits for them, and leaves earlier results clear', now.length === 0, now.join('; '));
const swap = (src: string, from: string, to: string) => { const o = src.replace(from, to); if (o === src) throw new Error(`mutation anchor missing: ${from}`); return o; };
mustCatch('the fade coming back for a round', wiring(refine, play, render, loader, swap(agent, " && !m.afPicks);", ');')).length > 0);
mustCatch('the website logos coming back into the checklist', wiring(refine, play, render, swap(loader, "import { afCheckTiming } from '@/lib/afCheckTiming';", "import { afCheckTiming } from '@/lib/afCheckTiming';\nimport { PlatformLogo } from './platform-logo';"), agent).length > 0);
mustCatch('a round that no longer waits for its checklist', wiring(refine, swap(play, 'if (remaining > 0) await waitRun(run, remaining);\n    }\n    delete afHoldRef', '}\n    delete afHoldRef'), render, loader, agent).length > 0);
mustCatch('a round that renders the logo loader', wiring(refine, play, swap(render, 'if (m.afPicks?.length) return <AfCheckLoader', 'if (false) return <AfCheckLoader'), loader, agent).length > 0);

// ── 3. a NEW search is unchanged: logos + its 10.6 s floor ───────────────────────────────────────
check('a new search still holds the every-platform floor and shows the logo loader',
  /if \(!afCompleted\) \{\s*const remaining = SEARCH_MIN_MS - \(Date\.now\(\) - since\);/.test(play) && /return <SearchLoader key=\{m\.id\}/.test(render));
check('the heading has its Arabic', /'Ezhalah is checking the sites for your picks…': 'إزهله يفحص المواقع حسب اختيارك…'/.test(read('src/i18n.tsx')));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ every Advanced Filter round checks the user\'s picks, 5–7 s, no websites, no fade');
