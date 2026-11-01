// «متابعة» NEVER FEELS STUCK (owner 2026-10-03: «I notice sometimes when a user clicks المتابعة, it feels
// a bit stuck»). Offline and deterministic: no browser, no network.
//
// THE DEFECT, MEASURED 2026-10-03: committing an answer runs presentGuided → rankQuestions over the new
// scope — apartment_guided_counts_ar and property_age_option_counts_ar, ~0.7–1.6 s each from the client
// — and for that whole wait the card kept showing the OLD question with an untouched button. A tap
// looked ignored. Three halves fix it, and each is pinned here:
//   1. the tap answers AT ONCE — the button swaps its label for loading dots, later taps are ignored,
//      and the state clears when the commit settles or the next question arrives;
//   2. the next step is fetched BEFORE the tap — after each tick's footer count (and at open, for the
//      skip path) agent.tsx runs the same rankQuestions(question.apply(q, keys), asked ∪ {id}) the
//      commit will run;
//   3. the age counts are REMEMBERED like the guided counts, so that prefetch is actually reused (the
//      age probe was the one count nothing remembered).
//
// agent.tsx / AdvancedQuestionCard.tsx are React components Node cannot import and remote.ts needs a
// Supabase client, so these are pinned as code SHAPE; every pin is mutation-proven below against a
// deliberately broken copy of the REAL file.
//
//   node --experimental-strip-types scripts/verify-af-continue-never-feels-stuck.ts   (in `npm test`)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { windowBetween } from './lib/sourceWindow.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

const CARD = read('src/components/AdvancedQuestionCard.tsx');
const AGENT = read('src/app/agent.tsx');
const REMOTE = read('src/data/remote.ts');

const problems = (card: string, agent: string, remote: string): string[] => {
  const out: string[] = [];
  const safe = (f: () => string) => { try { return f(); } catch (e) { out.push(String((e as Error).message)); return ''; } };

  // ── 1. the tap answers at once ──
  if (!/const \[advancing, setAdvancing\] = useState\(false\);/.test(card)) out.push('the card has no «advancing» state');
  if (!/useEffect\(\(\) => \{ setAdvancing\(false\); \}, \[titleKey, options\]\);/.test(card))
    out.push('«advancing» is not cleared when the next question arrives — the button could stay on dots');
  const adv = safe(() => windowBetween(card, 'const advance = (', 'const reduced', 'AdvancedQuestionCard.tsx'));
  if (adv && !/if \(advancing\) return;/.test(adv)) out.push('a second tap while advancing is not ignored');
  if (adv && !/Promise\.resolve\(commit\(\)\)[\s\S]*\.finally\(\(\) => setAdvancing\(false\)\)/.test(adv))
    out.push('«advancing» is not cleared when the commit settles — a commit that stays put would freeze the button');
  if (!/testID="af-confirm" onPress=\{\(\) => advance\(\(\) => onConfirm\(sel\)\)\}/.test(card)) out.push('«متابعة» does not go through advance()');
  if (!/testID="af-skip" onPress=\{\(\) => advance\(onSkip\)\}/.test(card)) out.push('«تخطي» does not go through advance()');
  if (!/advance\(\(\) => onConfirm\(\[key\]\)\);/.test(card)) out.push('the double-tap commit does not go through advance()');
  if (!/\{advancing \? \(\s*<View style=\{s\.actionLabel\} testID="af-confirm-working"><LoadingDots/.test(card))
    out.push('the button does not show the loading dots while advancing');
  if (!/const onAgeConfirm = \(keys: string\[\]\) => commitGuidedStep\(keys\);/.test(agent) || !/const onAgeSkip = \(\) => commitGuidedStep\(\[\]\);/.test(agent))
    out.push('the agent no longer hands the commit promise to the card, so the dots cannot know when it settled');

  // ── 2. the next step is fetched before the tap ──
  const pre = safe(() => windowBetween(agent, 'const prefetchNextStep = (', '};', 'agent.tsx'));
  if (pre) {
    if (!/const next = keys\.length \? question\.apply\(q, keys\) : q;/.test(pre)) out.push('the prefetch does not build the SAME next query the commit builds');
    if (!/new Set\(\[\.\.\.ageFlowAskedRef\.current, question\.id\]\)/.test(pre)) out.push('the prefetch does not add this question to the asked set like the commit does');
    if (!/rankQuestions\(next, asked\)/.test(pre)) out.push('the prefetch does not run the same rankQuestions call');
    if (!/if \(nextStepPrefetchRef\.current === key\) return;/.test(pre)) out.push('the prefetch is not de-duplicated (a burst of identical probes)');
  }
  const live = safe(() => windowBetween(agent, 'liveCount={(keys) => {', 'initialKeys={ageFlow.initialKeys}', 'agent.tsx'));
  if (live && !/p\.then\(\(\) => prefetchNextStep\(question, q, keys\), \(\) => \{\}\);/.test(live))
    out.push('the prefetch does not follow each tick\'s footer count (serial, never in parallel with it)');

  // ── 3. the age counts are remembered ──
  const age = safe(() => windowBetween(remote, 'export async function fetchPropertyAgeOptionCounts(', '\n}\n', 'remote.ts'));
  if (age) {
    if (!/const ageHit = settledAgeCounts\.get\(ageKey\);\s*if \(ageHit && Date\.now\(\) - ageHit\.at < COUNT_MEMORY_TTL_MS\) return ageHit\.c;/.test(age))
      out.push('the age counts are not read from memory before the RPC');
    if (!/settledAgeCounts\.set\(ageKey, \{ at: Date\.now\(\), c \}\);/.test(age)) out.push('a learned age answer is not remembered');
    // Exactly one write, and it sits AFTER the last failure return — so no failure path can write it.
    const writes = age.split('settledAgeCounts.set(').length - 1;
    const lastFailure = age.lastIndexOf('return null;   // the source answered: nothing');
    if (writes !== 1 || lastFailure < 0 || age.indexOf('settledAgeCounts.set(') < lastFailure)
      out.push('the age memory is written somewhere other than after every failure return');
  }
  return out;
};

const real = problems(CARD, AGENT, REMOTE);
check('the shipped card, agent and remote satisfy every pin', real.length === 0, real.join('\n      '));

// ── MUTATION PROOF — each pin against the defect it exists for, applied to the REAL files ──
console.log('\n  mutation proof — every pin must go red on its own defect\n');
let mutFail = 0;
const mustCatch = (what: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${what}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${what}`);
};
const swap = (src: string, from: string, to: string) => {
  const out = src.replace(from, to);
  if (out === src) throw new Error(`mutation anchor missing: ${from.slice(0, 80)}`);
  return out;
};
mustCatch('the button calling onConfirm directly again (no instant feedback)',
  problems(swap(CARD, 'onPress={() => advance(() => onConfirm(sel))}', 'onPress={() => onConfirm(sel)}'), AGENT, REMOTE).length > 0);
mustCatch('the loading dots removed from the button',
  problems(swap(CARD, '{advancing ? (', '{false ? ('), AGENT, REMOTE).length > 0);
mustCatch('the advancing state never cleared after the commit settles',
  problems(swap(CARD, '.finally(() => setAdvancing(false))', ''), AGENT, REMOTE).length > 0);
mustCatch('double taps allowed while advancing',
  problems(swap(CARD, 'if (advancing) return;', ''), AGENT, REMOTE).length > 0);
mustCatch('the agent swallowing the commit promise (void)',
  problems(CARD, swap(AGENT, 'const onAgeConfirm = (keys: string[]) => commitGuidedStep(keys);', 'const onAgeConfirm = (keys: string[]) => { void commitGuidedStep(keys); };'), REMOTE).length > 0);
mustCatch('the prefetch no longer following the tick',
  problems(CARD, swap(AGENT, 'p.then(() => prefetchNextStep(question, q, keys), () => {});', ''), REMOTE).length > 0);
mustCatch('the prefetch ranking a different query than the commit will',
  problems(CARD, swap(AGENT, 'const next = keys.length ? question.apply(q, keys) : q;', 'const next = q;'), REMOTE).length > 0);
mustCatch('the age memory never read',
  problems(CARD, AGENT, swap(REMOTE, 'if (ageHit && Date.now() - ageHit.at < COUNT_MEMORY_TTL_MS) return ageHit.c;', '')).length > 0);
mustCatch('a learned age answer never remembered',
  problems(CARD, AGENT, swap(REMOTE, 'settledAgeCounts.set(ageKey, { at: Date.now(), c });', '')).length > 0);

if (mutFail) failed += mutFail;
console.log(failed === 0
  ? '\n✅ «متابعة» answers at once, the next step is ready before the tap, and the age counts are remembered.\n'
  : `\n❌ ${failed} check(s) failed — «متابعة» can look frozen again.\n`);
process.exit(failed === 0 ? 0 : 1);
