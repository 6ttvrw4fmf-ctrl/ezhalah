// THE ADVANCED FILTER ROUND'S BEAT SHOWS EVERY PICK INSIDE ITS 5 SECONDS (owner 2026-10-11: «نبحث عن الفلل
// والبيوت» → «فيلا» → «عمر حتى ٥ سنوات» → «مصعد», one at a time). Found in the preview the same day: with
// the first pacing, 5 picks needed ~6.4 s, so the last one («مصعد») never appeared before the results.
// This executes the real pacing function against the real 5 s floor for 1..10 picks.
//   node --experimental-strip-types scripts/verify-af-round-beat-shows-every-pick.ts   (in `npm test`)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
import { stripComments } from './lib/stripComments.ts';
import { buildAfBeatSteps, type AfFacet } from '../src/lib/afSummary.ts';

const ROOT = join(import.meta.dirname, '..');
const FILE = join(ROOT, 'src/components/AfRoundLoader.tsx');
const AGENT = readFileSync(join(ROOT, 'src/app/agent.tsx'), 'utf8');
const BEAT_MS = Number((AGENT.match(/const AF_LOADER_MS = (\d+);/) ?? [])[1]);

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

type Timing = (n: number) => { wait: number; swap: number };
// The last pick lands at (n-1) × (wait + swap); it must land with at least 600 ms left to be read.
const lastLandsAt = (timing: Timing, n: number) => { const { wait, swap } = timing(n); return (n - 1) * (wait + swap); };
const problems = (step: Timing): string[] => {
  const out: string[] = [];
  for (let n = 1; n <= 10; n++) {
    const at = lastLandsAt(step, n);
    if (at > BEAT_MS - 600) out.push(`${n} picks: the last lands at ${at} ms of a ${BEAT_MS} ms beat`);
  }
  return out;
};

check('the beat is 5 s', BEAT_MS === 5000, `AF_LOADER_MS=${BEAT_MS}`);
const real = (await liftSymbols(FILE, [{ header: 'export function afPickTiming(' }], ['afPickTiming'])).afPickTiming as Timing;
check('every fade is visible (≥ 120 ms) and each pick holds (≥ 250 ms)', [2, 5, 10].every((n) => real(n).swap >= 120 && real(n).wait >= 250));
const p = problems(real);
check('every pick (1–10) lands with time to read it before the results', p.length === 0, p.join('\n      '));

const mustCatch = (what: string, caught: boolean) => {
  if (!caught) failed++;
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${what}`);
};
mustCatch('the first pacing (a fixed 380 ms fade on top — «مصعد» never showed)', problems((n) => ({ wait: n <= 1 ? 0 : Math.max(600, Math.min(1200, Math.floor(4500 / n))), swap: 380 })).length > 0);
mustCatch('a fixed 1 s per pick', problems(() => ({ wait: 1000, swap: 380 })).length > 0);

// THE LINE LOOKS AND MOVES LIKE THE SEARCH LINE ON TOP OF THE LOGO LOADER (owner 2026-10-11, pointing at «نفحص أكثر
// من 349,793 عقار…»: «keep it like this color and animation»). The picked option used to be the one dark-ink bold word
// against a muted lead (the "darker colour" he disliked), and the line did not pulse. Same type as SearchLoader's
// headline, every word one colour, and the same continuous pulse.
const AF_SRC = stripComments(readFileSync(FILE, 'utf8'));
const SL_SRC = stripComments(readFileSync(join(ROOT, 'src/components/SearchLoader.tsx'), 'utf8'));
const styleOf = (src: string, key: string) => (src.match(new RegExp(`${key}: \\{([^}]*)\\}`)) ?? [])[1] ?? '';
const prop = (css: string, name: string) => (css.match(new RegExp(`${name}: ([^,]+)`)) ?? [])[1]?.trim();
const likeTheTopLine = (af: string, sl: string): boolean => {
  const a = styleOf(af, 'line'), t = styleOf(sl, 'title');
  return ['fontSize', 'fontWeight', 'color'].every((n) => !!prop(t, n) && prop(a, n) === prop(t, n))
    && !/colors\.(ink|muted)/.test(af)                                  // no darker pick, no muted lead
    && /toValue: 0\.55, duration: 650/.test(af) && /toValue: 1, duration: 650/.test(af) && /opacity: pulse/.test(af);
};
check('the Advanced Filter line has the search line\'s type, one colour for every word, and its pulse', likeTheTopLine(AF_SRC, SL_SRC));
mustCatch('the dark-ink bold pick coming back', !likeTheTopLine(AF_SRC.replace('  line: {', '  pick: { color: colors.ink, fontWeight: \'600\' },\n  line: {'), SL_SRC));
mustCatch('a muted lead against the pick again', !likeTheTopLine(AF_SRC.replace('  line: {', '  lead: { color: colors.muted },\n  line: {'), SL_SRC));
mustCatch('the pulse being removed', !likeTheTopLine(AF_SRC.replace('opacity: pulse', 'opacity: 1'), SL_SRC));
mustCatch('a different weight from the search line', !likeTheTopLine(AF_SRC.replace("fontWeight: '600', color: colors.body", "fontWeight: '800', color: colors.body"), SL_SRC));

// THE BEAT SAYS «نفحص N عقار…» — CHECKING, WITH THE REAL SIZE OF THE SET EACH ANSWER IS CHECKED AGAINST (owner
// 2026-10-11: «the animation should be checking like this», pointing at «نفحص أكثر من 349,793 عقار…», then «do that»
// for «نفحص 830 عقار…» → «نفحص 177 عقار…»). The sizes are the interview's own: the set each question was ASKED against.
// Executed against the real step builder, then the loader and its wiring pinned by source shape.
const F = (id: string, keys: string[], labels: string[], total?: number): AfFacet => ({ id, keys, labels, total });
const age = F('property_age', ['new'], ['جديد'], 1425);
const lift = F('amenities', ['elevator', 'ac'], ['مصعد', 'تكييف'], 830);
type Steps = typeof buildAfBeatSteps;
// What a beat builder must do — judged on ANY copy of it, so a mutant of the real source is held to the same list.
const beatProblems = (fn: Steps): string[] => {
  const out: string[] = [];
  if (JSON.stringify(fn([age, lift])) !== JSON.stringify([{ label: '✨ عمر جديد', pool: 1425 }, { label: '🛗 مصعد، و❄️ تكييف', pool: 830 }]))
    out.push('not one beat per answered question with the set size it was checked against');
  if (fn([lift]).length !== 1) out.push('a multi-select answer (elevator + A/C) is more than one beat');
  if (!fn([F('property_age', ['new'], ['جديد']), F('property_age', ['old'], ['قديم'], 0)]).every((x) => x.pool === null))
    out.push('a size that was never known is not null (the beat would invent a count)');
  if (fn([age, age]).length !== 1) out.push('the same answer twice is more than one beat');
  return out;
};
// A mutant is the REAL afSummary.ts with one line broken, loaded from a temp copy (its one import, the pure
// ./afChips.ts chip table, is copied beside it — 2026-11-01).
const SUMMARY_SRC = readFileSync(join(ROOT, 'src/lib/afSummary.ts'), 'utf8');
const CHIPS_SRC = readFileSync(join(ROOT, 'src/lib/afChips.ts'), 'utf8');
const loadMutant = async (from: string, to: string): Promise<Steps> => {
  if (!SUMMARY_SRC.includes(from)) throw new Error(`mutation anchor missing: ${from.slice(0, 70)}`);
  const dir = mkdtempSync(join(tmpdir(), 'af-beat-'));
  writeFileSync(join(dir, 'afChips.ts'), CHIPS_SRC);
  const f = join(dir, 'afSummary.ts');
  writeFileSync(f, SUMMARY_SRC.replace(from, to));
  return ((await import(`${pathToFileURL(f).href}?m=${Math.random()}`)) as { buildAfBeatSteps: Steps }).buildAfBeatSteps;
};
const REAL_POOL = "typeof f.total === 'number' && f.total > 0 ? f.total : null";
const realProblems = beatProblems(buildAfBeatSteps);
check('one beat per answered question, each with the set size it was checked against; a multi-select is ONE beat; an unknown size is null',
  realProblems.length === 0, realProblems.join('\n      '));
mustCatch('a beat per pick (a multi-select answer showing the same number twice)',
  beatProblems(await loadMutant(`steps.push({ label: joinAr(fresh), pool: ${REAL_POOL} });`, `fresh.forEach((it) => steps.push({ label: it, pool: ${REAL_POOL} }));`)).length > 0);
mustCatch('a beat that drops the size (every pool null)', beatProblems(await loadMutant(`pool: ${REAL_POOL}`, 'pool: null')).length > 0);
mustCatch('a beat that invents a size when none was known (0 treated as a count)', beatProblems(await loadMutant("typeof f.total === 'number' && f.total > 0 ?", "typeof f.total === 'number' ?")).length > 0);
mustCatch('the same answer shown twice (no dedupe)', beatProblems(await loadMutant('.filter((it) => !seen.has(it));', ';')).length > 0);
// owner 2026-11-01: the beat names the pick («نفحص مصعد…»), one after another — never the set size.
const LOADER_NUMBER = /const text = `\$\{t\('Checking'\)\} \$\{pick\}…`;/;
const AGENT_STRIPPED = stripComments(AGENT);
const wiredToSteps = (loader: string, agent: string) => LOADER_NUMBER.test(loader)
  && /<AfRoundLoader key=\{m\.id\} items=\{m\.afRound\.items\} pools=\{m\.afRound\.pools\}/.test(agent)
  && /buildAfBeatSteps\(ageFlowFacetsRef\.current\)/.test(agent) && !/Searching for/.test(loader);
check('the loader says «نفحص <pick>…», one pick after another, and the round hands it the steps', wiredToSteps(AF_SRC, AGENT_STRIPPED));
mustCatch('the loader going back to «نبحث عن»', !wiredToSteps(AF_SRC.replace("`${t('Checking')} ${pick}…`", "`${t('Searching for')} ${pick}…`"), AGENT_STRIPPED));
mustCatch('the loader showing the set size instead of the pick', !wiredToSteps(AF_SRC.replace("const text = `${t('Checking')} ${pick}…`;", "const text = t('Checking {count} properties…', { count: pool });"), AGENT_STRIPPED));
mustCatch('the round no longer handing the loader the sizes', !wiredToSteps(AF_SRC, AGENT_STRIPPED.replace('pools={m.afRound.pools}', '')));
mustCatch('the round building its beats from the picks alone (no sizes)', !wiredToSteps(AF_SRC, AGENT_STRIPPED.replace('buildAfBeatSteps(ageFlowFacetsRef.current)', 'buildAfSummaryItems(ageFlowFacetsRef.current)')));

console.log(failed === 0 ? '\n✅ every Advanced Filter pick gets its turn inside the 5 s beat.\n' : `\n❌ ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
