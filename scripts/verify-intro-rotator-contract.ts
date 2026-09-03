// Smart-search intro + rotating composer examples contract (owner brief 2026-08-23).
// Permanent frontend barrier: pins the greeting copy, the rotator's visibility contract, the clean
// hand-offs (typing / mic / results), the accessibility + reduced-motion behavior, and — most
// importantly — the PARSER-TRUTH pin: every shipped example must appear verbatim in the proof
// artifact docs/ops/INTRO_EXAMPLES_PROOF.md, so adding an unproven example turns CI red (§5/§12).
// Key behavioral clauses are mutation-proven below: each mutation flips its check to FAIL.
//
//   node --experimental-strip-types scripts/verify-intro-rotator-contract.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { join as __join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

// "Is this guard actually wired in?" — asked of the test registry, which is what `npm test`
// resolves its run set from (scripts/lib/testRegistry.ts). String-matching package.json used to
// answer it; since the 201-command chain became one runner invocation, that match would read
// "not wired" for every barrier in the suite.
const REPO_ROOT = __join(import.meta.dirname, '..');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `\n        ${detail}` : ''}`);
};

const agent = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
const examplesSrc = readFileSync(new URL('../src/data/introExamples.ts', import.meta.url), 'utf8');
const proof = readFileSync(new URL('../docs/ops/INTRO_EXAMPLES_PROOF.md', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('../src/i18n.tsx', import.meta.url), 'utf8');
const filterScreen = readFileSync(new URL('../src/app/index.tsx', import.meta.url), 'utf8');
const ex = await import(new URL('../src/data/introExamples.ts', import.meta.url).href);

console.log('\nIntro greeting + rotating examples contract (owner brief 2026-08-23)\n');

// ── 1. Greeting: owner's FINAL copy, byte-exact, rendered as the typed greeting ─────────────────
const GREETING =
  'ارحب، أنا إزهله. قلّي وش العقار اللي تدور عليه، وأنا أبحث لك بين المنصات العقارية وأطابق الخيارات مع طلبك لين نلقى اللي يناسبك… إزهلها وفالك الطيب.';
const greetingExact = (src: string) => src.includes(`'${GREETING}'`);
check('1a. greeting is the owner FINAL copy, byte-exact, in greetingText()', greetingExact(agent));
check(
  '1b. greeting renders through the existing typed-greeting path with testID intro-greeting',
  /testID=\{m\.greeting \? 'intro-greeting' : undefined\}/.test(agent) &&
    /m\.greeting \? greetingText\(locale\) : m\.text/.test(agent),
);

// ── 2. Rotation ONLY on the empty AI landing screen ─────────────────────────────────────────────
// The predicate is the single gate: greeting-only chat AND untouched AND empty AND idle AND no turn.
const predicateOk = (src: string) =>
  /const introLanding = msgs\.every\(\(m\) => m\.role === 'agent' && !!m\.greeting\);/.test(src) &&
  /introLanding && !introInteracted && !typed && voiceState === 'idle' && !busy/.test(src);
check('2. visibility predicate = greeting-only chat ∧ untouched ∧ empty ∧ mic idle ∧ not busy', predicateOk(agent));
check(
  '2b. the rotator renders ONLY behind that predicate, inside the input wrapper',
  /\{showIntroExamples \? <IntroExampleRotator reducedMotion=\{reducedMotion\} \/> : null\}/.test(agent),
);
// Results / conversations / history are excluded structurally: any user/results/status message
// breaks msgs.every(role==='agent' && greeting). Pin that ChatMsg still has those roles.
check(
  "5. results/conversations can never show examples (non-greeting roles break the predicate's every())",
  /role: 'user'/.test(agent) && /role: 'results'/.test(agent) && predicateOk(agent),
);

// ── 3. Typing / clicking stops rotation immediately, and is what hides it — never a timer ───────
const typingStops = (src: string) =>
  /onChangeText=\{\(v: string\) => \{ setIntroInteracted\(true\); setTyped\(v\);/.test(src) &&
  /onFocus=\{\(\) => \{ setComposerFocused\(true\); setIntroInteracted\(true\); \}\}/.test(src);
check('3. first click/tap into the composer AND first typed character latch introInteracted', typingStops(agent));

// ── 4. User text is never overwritten: the rotator is render-only ───────────────────────────────
const rotatorBody = agent.match(/function IntroExampleRotator\([\s\S]*?\n\}/)?.[0] ?? '';
const rotatorPure = (body: string) =>
  body.length > 0 && !/setTyped|setMsgs|setIntroInteracted|\bsend\(/.test(body);
check('4. IntroExampleRotator never touches typed/msgs/send — render-only overlay', rotatorPure(rotatorBody));

// ── 6. Mic tap stops rotation, cleanly handing off to the voice morph (untouched) ───────────────
const micStops = (src: string) =>
  /const startVoice = async \(\) => \{[\s\S]{0,250}setIntroInteracted\(true\);/.test(src);
check('6a. startVoice latches introInteracted before the voice morph takes over', micStops(agent));
check(
  "6b. recording also hides examples independently (voiceState === 'idle' in the predicate) and the voice morph is untouched",
  /voiceState === 'idle' && !busy/.test(agent) && /testID="voice-recording-row"/.test(agent) &&
    /testID="voice-cancel"/.test(agent) && /testID="voice-stop"/.test(agent) && /testID="voice-send"/.test(agent),
);

// ── 7. Filter mode never shows them ─────────────────────────────────────────────────────────────
check('7. Filter screen (src/app/index.tsx) has zero references to the rotator/examples', !/introExamples|IntroExampleRotator|intro-example/i.test(filterScreen));

// ── 8. Mic/Send geometry untouched; overlay structurally cannot move them or overflow ───────────
const iInput = agent.indexOf('ref={inputRef}');
const iRotator = agent.indexOf('<IntroExampleRotator');
const iMic = agent.indexOf('testID="voice-mic"');
check(
  '8a. composer order preserved: input → rotator overlay (inside inputGrow) → mic → send; mic untouched',
  iInput !== -1 && iRotator > iInput && iMic > iRotator && /testID="voice-mic"/.test(agent),
);
check(
  '8b. overlay is absolute inside the CLIPPED input wrapper (inputGrow overflow hidden) with one-line ellipsis — overflow = 0 by construction',
  /introRotator: \{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0/.test(agent) &&
    /inputGrow: \{ flex: 1, overflow: 'hidden'/.test(agent) &&
    /<Text numberOfLines=\{1\} ellipsizeMode="tail"/.test(rotatorBody),
);

// ── 9. Arabic-only visible copy ─────────────────────────────────────────────────────────────────
const list: readonly string[] = ex.INTRO_EXAMPLES;
check('9a. every shipped example is Arabic-only (no Latin letters)', list.length > 0 && list.every((s: string) => !/[A-Za-z]/.test(s) && /[؀-ۿ]/.test(s)));
check('9b. the greeting is Arabic-only', !/[A-Za-z]/.test(GREETING));
check(
  '9c. the placeholder swap keeps the Arabic static placeholder for the interacted state, and the a11y label has an Arabic dictionary entry',
  /placeholder=\{showIntroExamples \? '' : t\("Type the property you're looking for in Saudi Arabia\.\.\."\)\}/.test(agent) &&
    /'Describe the property you are looking for': 'اكتب وصف العقار اللي تبحث عنه'/.test(i18n),
);

// ── 10. Reduced motion respected ────────────────────────────────────────────────────────────────
const reducedOk = (body: string) =>
  /if \(reducedMotion \|\| pool\.length <= 1 \|\| phase !== 'shown'\) return;/.test(body) &&
  /IS_WEB && !reducedMotion && phase !== 'in'/.test(body);
check('10. reduced motion → one static example, no repeating animation, no transition', reducedOk(rotatorBody));

// ── 11. Screen reader not spammed ───────────────────────────────────────────────────────────────
const ariaOk = (body: string) =>
  /aria-hidden/.test(body) && /accessibilityElementsHidden/.test(body) &&
  /importantForAccessibility="no-hide-descendants"/.test(body) && /pointerEvents="none"/.test(body);
check('11a. rotator is aria-hidden + importantForAccessibility none + pointerEvents none', ariaOk(rotatorBody));
check(
  '11b. the composer input carries the stable Arabic accessibility label',
  /accessibilityLabel=\{t\('Describe the property you are looking for'\)\}/.test(agent),
);

// ── 12. PARSER TRUTH PIN: every shipped example must be proven in the proof artifact ────────────
// The PROVEN table section only — an example listed under FAILED/DROPPED must not satisfy this.
const provenSection = proof.split('## FAILED')[0];
const unproven = list.filter((s: string) => !provenSection.includes(s));
check(
  '12a. every INTRO_EXAMPLES entry appears VERBATIM in the PROVEN table of docs/ops/INTRO_EXAMPLES_PROOF.md',
  unproven.length === 0,
  `unproven examples: ${unproven.join(' | ')}`,
);
check('12b. the pool is genuinely diverse in size (≥ 20 examples) with no duplicates', list.length >= 20 && new Set(list).size === list.length);
// Rotation diversity (owner addendum): never three consecutive examples of the same type dimension.
const TYPE_WORDS = ['شقة', 'فيلا', 'مكتب', 'مستودع', 'أرض', 'محل', 'مصنع', 'استراحة', 'شاليه', 'عقار'];
const typeKey = (s: string) => TYPE_WORDS.find((w) => s.includes(w)) ?? s;
let sameRun = false;
for (let i = 2; i < list.length; i++) {
  if (typeKey(list[i]) === typeKey(list[i - 1]) && typeKey(list[i - 1]) === typeKey(list[i - 2])) sameRun = true;
}
check('12c. no three consecutive examples share the same property-type dimension', !sameRun);
// Dropped-for-cause capabilities must never silently reappear in the shipped pool.
const BANNED = [/عمره?ا?\s/, /مفروش/, /حمام/, /دوبلكس/, /مسبح/, /عرضه/, /بين\s+\S+\s+و/, /من\s+\S+\s+إلى/, /سكن عمال/];
check('12d. no shipped example re-promises a capability the truth test rejected (age/furnished/baths/duplex/pool/street-width/ranges)', list.every((s: string) => !BANNED.some((re) => re.test(s))));

// ── 13. Width adaptation + hold time are pure and sane (owner brief §3/§9) ──────────────────────
const wide = ex.introExamplesForWidth(2000);
const narrow = ex.introExamplesForWidth(240);
const zero = ex.introExamplesForWidth(0);
check(
  '13a. width filter: full pool on wide screens (order preserved), only fitting examples on narrow, empty pre-layout',
  wide.length === list.length && wide.every((s: string, i: number) => s === list[i]) &&
    narrow.length >= 3 && narrow.every((s: string) => s.length <= Math.floor(240 / ex.INTRO_EXAMPLE_CHAR_PX) || narrow.length === 5) &&
    zero.length === 0,
);
check(
  '13b. hold time is readable and clamped to the owner window (~2.6–4s)',
  ex.introExampleHoldMs('') >= 2600 && ex.introExampleHoldMs('x'.repeat(300)) <= 4000,
);

// ── Mutation proofs: each key clause, when mutated, must flip its check to FAIL ────────────────
const mutations: Array<[string, boolean]> = [
  ['M1 predicate without !introInteracted → check 2 fails',
    !predicateOk(agent.replace('introLanding && !introInteracted && !typed', 'introLanding && !typed'))],
  ['M2 onChangeText without the latch → check 3 fails',
    !typingStops(agent.replace('onChangeText={(v: string) => { setIntroInteracted(true); setTyped(v);', 'onChangeText={(v: string) => { setTyped(v);'))],
  ['M3 startVoice without the latch → check 6a fails',
    !micStops(agent.replace('setIntroInteracted(true); // mic tap stops the rotating examples cleanly (owner brief §6/§7)', ''))],
  ['M4 rotator that writes user text → check 4 fails',
    !rotatorPure(rotatorBody.replace('const [w, setW] = useState(0);', "const [w, setW] = useState(0); setTyped('');"))],
  ['M5 rotator without aria-hidden → check 11a fails',
    !ariaOk(rotatorBody.replace('aria-hidden', 'data-x'))],
  ['M6 an unproven example added to the pool → check 12a fails',
    ![...list, 'أبي قصر على البحر بمسبح'].every((s) => provenSection.includes(s))],
  ['M7 greeting copy altered by one character → check 1a fails',
    !greetingExact(agent.replace('وفالك الطيب', 'وفالك طيب'))],
  ['M8 reduced-motion gate removed → check 10 fails',
    !reducedOk(rotatorBody.replace("if (reducedMotion || pool.length <= 1 || phase !== 'shown') return;", "if (pool.length <= 1 || phase !== 'shown') return;"))],
];
for (const [label, ok] of mutations) check(`MUT ${label}`, ok);

// ── Wiring: this barrier itself must be in npm test, or it is decoration ────────────────────────
check('W. verify-intro-rotator-contract.ts is wired into `npm test`', npmTestRuns(REPO_ROOT, 'verify-intro-rotator-contract'));

console.log('');
if (failed) {
  console.error(`intro-rotator contract: ${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('intro-rotator contract: all checks passed');
