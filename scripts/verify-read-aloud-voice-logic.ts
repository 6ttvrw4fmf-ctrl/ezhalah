// READ-ALOUD'S ENGINE-SENSITIVE DECISIONS, EXECUTED — NOT REPLICATED.
//
// `scripts/verify-read-aloud-contract.ts` proved the voice scoring against a hand-written
// `pickBestArabicReplica()`, introduced as "a faithful replica of readAloud.ts's pickBestArabic()
// scoring". A replica is faithful exactly until someone edits production and not the copy — and
// then the barrier keeps proving the OLD formula, green, forever. `readAloud.ts` imports expo-speech
// and react-native, so a Node barrier genuinely could not import it; that is WHY the replica
// existed, and why the fix was to move the pure logic into an import-free module rather than to
// write a better copy. Same split, same reason, as `lib/supportDraft.ts` vs `lib/support.ts`.
//
// This file executes `src/lib/readAloudVoice.ts` — the code production actually runs — over:
//   1. the voice-list shapes REAL ENGINES return (WebKit, Blink, Gecko, iOS, Android, Windows),
//   2. the owner's stated priority order, in the cases where the axes disagree,
//   3. the WebKit pause() watchdog's three conditions, each isolated.
//
// SCOPE, STATED HONESTLY (PART 10). This is ENGINE and LOGIC evidence. It says nothing about
// whether a real iPhone produces Arabic audio, whether iOS reports `paused === false` after a
// pause(), or whether any voice is installed on a given device. Those are DEVICE REQUIRED.
//
// Run: node --experimental-strip-types scripts/verify-read-aloud-voice-logic.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AR_LANG, QUALITY_ENHANCED, pickBestArabicVoice, scoreArabicVoice, shouldForcePauseFallback,
  readAloudRefusalVerdict, readAloudRefusalMessageKey,
  type ArabicVoiceCandidate, type ReadAloudRefusal,
} from '../src/lib/readAloudVoice.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (m: string, cond: boolean) => {
  if (cond) console.log(`  ok  ${m}`);
  else { console.error(`  FAIL  ${m}`); failed++; }
};

const v = (identifier: string, language: string, extra: Partial<ArabicVoiceCandidate> = {}): ArabicVoiceCandidate =>
  ({ identifier, language, ...extra });

// ── 1. The enum this module deliberately does not import ────────────────────────────────────────
// readAloudVoice.ts compares quality by VALUE so it stays import-free and executable here. If
// expo-speech ever renames the member, that comparison silently stops matching and every Enhanced
// voice quietly loses a point — a scoring change nobody wrote. Pin the two together.
// expo-speech cannot be IMPORTED here — it resolves a native module ('ExponentSpeech') that does
// not exist under Node, which is the same wall that forced the replica in the first place. So the
// enum's declared value is read from its own type source: a targeted read for a real reason, not a
// substitute for executing our logic (everything below executes it).
const SPEECH_TYPES = readFileSync(join(ROOT, 'node_modules/expo-speech/src/Speech.types.ts'), 'utf8');
const declaredEnhanced = SPEECH_TYPES.match(/Enhanced\s*=\s*'([^']+)'/)?.[1];
check(`QUALITY_ENHANCED tracks expo-speech's declared VoiceQuality.Enhanced ('${declaredEnhanced}')`,
  !!declaredEnhanced && QUALITY_ENHANCED === declaredEnhanced);
check("AR_LANG is still ar-SA", AR_LANG === 'ar-SA');

// ── 2. Real per-engine voice lists ──────────────────────────────────────────────────────────────
// The shapes below are what each engine's getVoices() actually looks like: WebKit/iOS ship named
// Arabic voices with localService true; Blink on Linux/Windows commonly exposes remote ones;
// Gecko frequently exposes NO Arabic voice at all, which is the case that must fail gracefully
// rather than hand Arabic text to an English voice (the original "English robot" report).
const WEBKIT_MACOS = [
  v('com.apple.voice.compact.en-US.Samantha', 'en-US', { localService: true }),
  v('com.apple.voice.compact.ar-001.Maged', 'ar-001', { localService: true }),
];
const WEBKIT_IOS = [
  v('com.apple.ttsbundle.siri_female_en-US', 'en-US', { localService: true }),
  v('com.apple.voice.compact.ar-001.Maged', 'ar-001', { localService: true }),
  v('com.apple.voice.enhanced.ar-SA.Tarik', 'ar-SA', { localService: true, quality: QUALITY_ENHANCED }),
];
const BLINK_WINDOWS = [
  v('Microsoft David - English (United States)', 'en-US', { localService: true }),
  v('Google العربية', 'ar', { localService: false }),
];
const GECKO_NO_ARABIC = [
  v('urn:moz-tts:speechd:English (en-US)', 'en-US', { localService: true }),
  v('urn:moz-tts:speechd:Deutsch', 'de-DE', { localService: true }),
];

// ── 2b/3b. THE VOICE VERDICT AS A PURE PREDICATE (routine #10, 2026-09-26) ──────────────────────
// Why this shape, and why it is not ceremony. Everything in sections 2 and 3 used to be written as
// `check('…', pickBestArabicVoice(LIST)?.identifier === '…')` — a direct call on the production
// symbol. That EXECUTES the right code, which is why this barrier was already stronger than a
// source-text tripwire; but it leaves the barrier's own judgement un-provable, because there is no
// seam to hand a broken implementation to. `ops_incident #728` is exactly that gap: the mutations
// behind this file were run BY HAND in the session that landed it and nothing re-executes them, so
// the barrier was protected by a sentence in a merged PR body.
//
// So the verdict is lifted into a function of the production symbols. The real checks below apply it
// to the REAL `pickBestArabicVoice`/`scoreArabicVoice`; §7's proofs apply the SAME function to
// deliberately broken ones. There is no second copy of the judgement anywhere — a proof that
// exercises a replica of the predicate proves nothing about the barrier (PART 3, R1 step 2).
type PickFn = (voices: readonly ArabicVoiceCandidate[]) => ArabicVoiceCandidate | null;
type ScoreFn = (v: ArabicVoiceCandidate) => number;

const voiceProblems = (pick: PickFn, score: ScoreFn): string[] => {
  const p: string[] = [];
  const id = (list: readonly ArabicVoiceCandidate[]) => pick(list)?.identifier ?? null;
  const want = (label: string, got: string | null, expected: string | null) => {
    if (got !== expected) p.push(`${label}: got ${got === null ? 'null' : `«${got}»`}, want ${expected === null ? 'null' : `«${expected}»`}`);
  };
  // Per-engine: the "English robot" class — Arabic text must never reach a non-Arabic voice.
  want('WebKit/macOS picks the Arabic voice, not the English one', id(WEBKIT_MACOS), 'com.apple.voice.compact.ar-001.Maged');
  want('WebKit/iOS picks the EXACT ar-SA Enhanced voice over the generic ar-001', id(WEBKIT_IOS), 'com.apple.voice.enhanced.ar-SA.Tarik');
  want('Blink/Windows picks the remote Arabic voice rather than the local ENGLISH one', id(BLINK_WINDOWS), 'Google العربية');
  want('Gecko with NO Arabic voice refuses rather than speaking Arabic through an English voice', id(GECKO_NO_ARABIC), null);
  want('an empty voice list (engine has not populated it yet) refuses', id([]), null);

  // The owner's priority order, in the cases where the axes genuinely disagree.
  const arSARemote = v('ar-sa-remote', 'ar-SA', { localService: false });
  const arEGLocalEnhanced = v('ar-eg-local', 'ar-EG', { localService: true, quality: QUALITY_ENHANCED });
  want('exact ar-SA wins even when REMOTE and a local Enhanced generic Arabic voice exists', id([arEGLocalEnhanced, arSARemote]), 'ar-sa-remote');
  want('…the same answer regardless of input order — the sort decides, not the list order', id([arSARemote, arEGLocalEnhanced]), 'ar-sa-remote');
  want('tied on locale-exactness, LOCAL beats remote',
    id([v('r', 'ar-SA', { localService: false }), v('l', 'ar-SA', { localService: true })]), 'l');
  want('tied on locale and locality, ENHANCED beats default',
    id([v('plain', 'ar-SA', { localService: true }), v('enh', 'ar-SA', { localService: true, quality: QUALITY_ENHANCED })]), 'enh');

  // `localService` is web-only; on native it is UNDEFINED and every voice is on-device by
  // construction. `=== true` instead of `!== false` would silently dock every native voice two
  // points and change which voice every phone picks — invisible to a source grep.
  if (score(v('native', 'ar-SA')) !== score(v('web', 'ar-SA', { localService: true })))
    p.push('an undefined localService (native) does not score the same as an explicit local voice');
  if (score(v('remote', 'ar-SA', { localService: false })) !== score(v('local', 'ar-SA', { localService: true })) - 2)
    p.push('an explicitly REMOTE voice does not score two lower than a local one');

  // Locale matching must be case- and separator-insensitive: engines report 'ar_SA', 'AR-sa', 'ar-SA'.
  for (const lang of ['ar-SA', 'ar_SA', 'AR-SA', 'ar_sa']) {
    if (score(v('x', lang)) !== score(v('y', 'ar-SA')))
      p.push(`«${lang}» is not recognised as the exact locale (engines differ on case and separator)`);
  }
  return p;
};

const realVoiceProblems = voiceProblems(pickBestArabicVoice, scoreArabicVoice);
check(`voice selection: every per-engine pick and every priority tie is correct${realVoiceProblems.length ? ` — ${realVoiceProblems.join(' | ')}` : ''}`,
  realVoiceProblems.length === 0);

// ── 4. The WebKit pause() watchdog — each condition isolated ────────────────────────────────────
// iOS Safari's pause() can silently no-op: it returns normally, `paused` never becomes true, audio
// keeps playing. The fallback is cancel+restart. All three conditions are load-bearing.
type PauseFn = (o: { state: 'idle' | 'playing' | 'paused'; playToken: number; tokenAtPause: number; enginePaused: boolean }) => boolean;
const base = { state: 'paused' as const, playToken: 7, tokenAtPause: 7, enginePaused: false };

const pauseProblems = (force: PauseFn): string[] => {
  const p: string[] = [];
  const want = (label: string, got: boolean, expected: boolean) => {
    if (got !== expected) p.push(`${label} (got ${got}, want ${expected})`);
  };
  want('WebKit ignored pause() (engine not paused, same unit, still meant to be paused) ⇒ force the fallback',
    force(base), true);
  want('the engine DID hold ⇒ do NOT force — forcing anyway restarts the unit from its start on every pause, on every engine',
    force({ ...base, enginePaused: true }), false);
  want('the user hit Resume inside the verify window ⇒ do NOT force — cancelling would stop audio they just asked to continue',
    force({ ...base, state: 'playing' }), false);
  want('playback ended inside the verify window ⇒ do NOT force', force({ ...base, state: 'idle' }), false);
  want('a NEWER unit started ⇒ do NOT force — the stale timer must not reach across units and kill the wrong utterance',
    force({ ...base, playToken: 8 }), false);
  return p;
};

const realPauseProblems = pauseProblems(shouldForcePauseFallback);
check(`the WebKit pause watchdog: all three conditions load-bearing${realPauseProblems.length ? ` — ${realPauseProblems.join(' | ')}` : ''}`,
  realPauseProblems.length === 0);

// ── 5. Production really uses these — an extracted module nothing imports is decoration ─────────
const readAloud = readFileSync(join(ROOT, 'src/lib/readAloud.ts'), 'utf8');
const code = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const readAloudCode = code(readAloud);

// The WIRING questions are the one part of this barrier that genuinely cannot be executed: they are
// statements about a module a Node process cannot import (expo-speech resolves a native module) and
// about a React component. They stay source reads — but the verdict is still a pure function of the
// source, so §7 can hand it a MUTATED COPY OF THE REAL SHIPPED FILE and watch it go red. That is the
// difference between a source read and a source-text tripwire (AGENTS.md, R3): a tripwire has no
// seam and has never been watched to fail.
const wiringProblems = (raCode: string, rowCode: string, deviceKey: string): string[] => {
  const p: string[] = [];
  if (!(/import \{[^}]*pickBestArabicVoice[^}]*\} from '@\/lib\/readAloudVoice'/.test(raCode) && /shouldForcePauseFallback/.test(raCode)))
    p.push('readAloud.ts does not import the shared voice logic');
  if (/VoiceQuality\.Enhanced/.test(raCode) || /s \+= 4;/.test(raCode))
    p.push('readAloud.ts carries its own inline scoring again (the drift this barrier exists to end)');
  if (!/shouldForcePauseFallback\(\{/.test(raCode)
    || /state === 'paused' && playToken === tokenAtPause && !window\.speechSynthesis\.paused/.test(raCode))
    p.push('the pause watchdog re-inlines its three conditions instead of calling the shared predicate');
  if (!(/readAloudRefusalVerdict\(\{/.test(raCode)
    && /voiceConfirmed: !!bestArabicVoice/.test(raCode)
    && /checkExhausted: voiceCheckExhausted/.test(raCode)))
    p.push('readAloud.ts does not compose its real module state through the shared verdict');
  if (!/readAloudRefusal\(\)/.test(rowCode)) p.push('FeedbackRow does not ask readAloud WHY the tap was refused');
  if (!/readAloudRefusalMessageKey\(/.test(rowCode)) p.push('FeedbackRow does not render the sentence the shared mapping chose');
  // Plain substring on the unescaped source — the component must not name the device verdict itself,
  // because naming it is how it gets rendered for a state it is not true in. This is the literal
  // shape of the defect: `isReadAloudDefinitelyUnavailable()` was exported, documented and had ZERO
  // callers while the UI guessed.
  if (rowCode.includes(deviceKey)) p.push('FeedbackRow hardcodes the device verdict again');
  return p;
};


// The whole point of the split: keep it executable. An import here would end that.
const voiceLogicCode = code(readFileSync(join(ROOT, 'src/lib/readAloudVoice.ts'), 'utf8'));
check('readAloudVoice.ts stays import-free, so this barrier can keep EXECUTING it',
  !/^\s*import\s/m.test(voiceLogicCode));
// And the replica must be gone, or the drift risk simply moved house.
const contract = readFileSync(join(ROOT, 'scripts/verify-read-aloud-contract.ts'), 'utf8');
check('verify-read-aloud-contract.ts no longer scores voices through a hand-written replica',
  !/pickBestArabicReplica/.test(contract));

// ── 6. A REFUSED TAP MUST NOT INVENT A VERDICT ABOUT THE DEVICE ─────────────────────────────────
// routine #6, 2026-09-25. readAloud.ts keeps THREE voice states and speakReadAloud() returns a
// BOOLEAN, so the component that renders the refusal used to see only "it did not speak" and always
// said «الاستماع غير متاح على هذا الجهاز» — a permanent claim about the user's hardware, shown while
// resolveVoice()'s 45s RETRY_WINDOW_MS was still running. That is the repo's owner-locked
// unknown -> NO rule broken in the read-aloud surface, the shape AGENTS.md records as "A FAILED
// FETCH IS NOT AN EMPTY ANSWER".
//
// MEASURED on production, Chromium, 4/4 fresh contexts, real Playwright clicks, page foregrounded:
// the 🔊 control does not exist until an agent search has returned cards, at t = 29,283 / 30,290 /
// 30,311 / 30,695 ms since load — every one ~15s INSIDE the 45s window. A second tap at
// t = 52,977 / 53,345 ms, past the window, produced the BYTE-IDENTICAL message, so the two states
// were indistinguishable to the user. Not a startup edge: the ordinary path.
//
// The ENTIRE user-visible decision is executed here — (voiceConfirmed, checkExhausted) -> verdict ->
// the sentence on screen — rather than the verdict being executed and the branch grepped. The three
// states are exhaustive by construction, so the table below is the whole function.
type VerdictFn = (o: { voiceConfirmed: boolean; checkExhausted: boolean }) => ReadAloudRefusal;
type KeyFn = (r: ReadAloudRefusal) => string | null | undefined;
const DEVICE_SENTENCE = "Listening isn't available on this device";
const ALL_REFUSALS: ReadAloudRefusal[] = ['none', 'no-voice-on-device', 'still-resolving'];

// Read by plain scan, not by regex: i18n.tsx writes an apostrophe inside a single-quoted key as
// `isn\'t`, and hand-escaping that into a pattern is exactly how a check ends up asserting something
// it did not mean. Unescaping the source first makes the key a literal substring on both sides.
const hasArabic = (s: string) => /[؀-ۿ]/.test(s);

const refusalProblems = (verdict: VerdictFn, key: KeyFn, i18nSrc: string): string[] => {
  const p: string[] = [];
  const at = (a: boolean, b: boolean) => verdict({ voiceConfirmed: a, checkExhausted: b });
  if (at(true, false) !== 'none' || at(true, true) !== 'none') p.push('a confirmed voice is reported as a refusal');
  // THE DEFECT, as a positive assertion. This is the case that used to render the device verdict.
  if (at(false, false) !== 'still-resolving')
    p.push('no voice yet AND the search still running is not «still-resolving» — a verdict about the device is being invented while the app is still looking');
  if (at(false, true) !== 'no-voice-on-device')
    p.push('no voice AND the search exhausted is not «no-voice-on-device» — the one state that claim is true in');
  // The two refusals must not collapse into one sentence, which is precisely what the defect was.
  if (at(false, false) === at(false, true)) p.push('the two refusals are the SAME state');
  const stillKey = key('still-resolving');
  const noneKey = key('no-voice-on-device');
  if (!stillKey || !noneKey || stillKey === noneKey)
    p.push('the two refusals do not map to DIFFERENT sentences — one message for both is the defect this section exists for');
  if (noneKey !== DEVICE_SENTENCE || stillKey === DEVICE_SENTENCE)
    p.push('the device-verdict sentence is not reachable ONLY from the exhausted state');
  if (key('none') !== null) p.push('a refusal with a confirmed voice invents a cause instead of saying nothing');
  // Exhaustiveness: every verdict the type admits must have a defined mapping (null is a decision,
  // but `undefined` would be an unhandled state rendering as a blank line).
  for (const r of ALL_REFUSALS) {
    if (key(r) === undefined) p.push(`«${r}» has no explicit message decision (undefined, not null)`);
  }
  // Both sentences must actually EXIST as i18n keys with Arabic values — a key the app cannot
  // translate renders the English source string to an Arabic-only user, which would turn this fix
  // into a different user-visible bug.
  for (const k of [noneKey, stillKey]) {
    if (!k) continue;
    const i = i18nSrc.indexOf(`'${k}':`);
    // The value is the rest of that line; an Arabic character in it is what proves it was translated
    // rather than left to fall through to the English source string for an Arabic-only user.
    const value = i < 0 ? '' : (i18nSrc.slice(i).split('\n')[0] ?? '');
    if (i < 0 || !hasArabic(value)) p.push(`«${k}» has no Arabic translation in i18n.tsx`);
  }
  return p;
};

const i18n = readFileSync(join(ROOT, 'src/i18n.tsx'), 'utf8').replace(/\\'/g, "'");
const realRefusalProblems = refusalProblems(readAloudRefusalVerdict, readAloudRefusalMessageKey, i18n);
check(`a refused tap never invents a verdict about the device, and each refusal has its own translated sentence${realRefusalProblems.length ? ` — ${realRefusalProblems.join(' | ')}` : ''}`,
  realRefusalProblems.length === 0);

// ── 5b. WIRING, against the real shipped sources ────────────────────────────────────────────────
const rowCode = code(readFileSync(join(ROOT, 'src/components/FeedbackRow.tsx'), 'utf8')).replace(/\\'/g, "'");
const realWiringProblems = wiringProblems(readAloudCode, rowCode, DEVICE_SENTENCE);
check(`production routes through the shared voice logic, the shared pause predicate and the shared refusal verdict${realWiringProblems.length ? ` — ${realWiringProblems.join(' | ')}` : ''}`,
  realWiringProblems.length === 0);

// ── 7. MUTATION PROOFS — every predicate above, watched to go RED (routine #10, ops_incident #728) ─
// `ops_incident #728`: this file, `verify-read-aloud-contract.ts` and
// `verify-journey-mobile-sidebar-oracle.ts` landed in PR #4317 whose body says «MUTATION-PROVEN
// 14/14, each watched red and restored». The mutations were real and were run by hand; nothing
// re-executed them, so all three sat on `scripts/mutation-proof-grandfathered.txt` and were
// protected by a sentence in a merged PR body rather than by anything a future PR runs. That is the
// PART 1.11 shape at one remove — a CLAIM of proof reading as durable coverage.
//
// Each mutant below is a plausible edit someone could really make: a refactor that looks harmless, a
// simplification, or the exact defect the section was written for. The healthy controls matter as
// much: a predicate that is red for everything is as useless as one green for everything (R1 step 4).
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  ok  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  (mutation) BLIND to ${label}`);
};

// — the healthy controls: the predicates are not vacuously red —
mustCatch('…while the REAL production symbols are NOT flagged (voiceProblems is not vacuously red)',
  voiceProblems(pickBestArabicVoice, scoreArabicVoice).length === 0);
mustCatch('…while the REAL pause predicate is NOT flagged (pauseProblems is not vacuously red)',
  pauseProblems(shouldForcePauseFallback).length === 0);
mustCatch('…while the REAL refusal decision is NOT flagged (refusalProblems is not vacuously red)',
  refusalProblems(readAloudRefusalVerdict, readAloudRefusalMessageKey, i18n).length === 0);
mustCatch('…while the REAL shipped sources are NOT flagged (wiringProblems is not vacuously red)',
  wiringProblems(readAloudCode, rowCode, DEVICE_SENTENCE).length === 0);

// — voice selection —
// THE ORIGINAL BUG REPORT, restored: a picker that hands the first voice back regardless of language
// speaks Arabic text through an English voice ("sounds English" / "English robot").
mustCatch('a picker that ignores language and returns the first voice (the original «sounds English» defect)',
  voiceProblems((voices) => voices[0] ?? null, scoreArabicVoice).length > 0);
mustCatch('a picker that never refuses — returning an English voice on an engine with no Arabic one at all',
  voiceProblems((voices) => voices[0] ?? null, scoreArabicVoice).some((m) => m.includes('Gecko')));
// `localService === true` instead of `!== false` — the exact simplification readAloudVoice.ts's own
// comment warns about. It docks every NATIVE voice two points and changes which voice every phone picks.
const scoreNativeDocked: ScoreFn = (x) => {
  let s = 0;
  if ((x.language ?? '').toLowerCase().replace('_', '-') === AR_LANG.toLowerCase()) s += 4;
  if (x.localService === true) s += 2;
  if (x.quality === QUALITY_ENHANCED) s += 1;
  return s;
};
mustCatch('`localService === true` instead of `!== false`, which silently docks every native voice two points',
  voiceProblems(pickBestArabicVoice, scoreNativeDocked).length > 0);
// The owner's priority order collapsing: exact-locale worth 1 instead of 4 lets a local Enhanced
// GENERIC Arabic voice beat an exact ar-SA one — a different voice on every device, no error anywhere.
const scoreLocaleDemoted: ScoreFn = (x) => {
  let s = 0;
  if ((x.language ?? '').toLowerCase().replace('_', '-') === AR_LANG.toLowerCase()) s += 1;
  if (x.localService !== false) s += 2;
  if (x.quality === QUALITY_ENHANCED) s += 1;
  return s;
};
mustCatch('exact-locale demoted below on-device+Enhanced COMBINED, so a generic ar-EG voice outranks ar-SA',
  voiceProblems((list) => [...list].filter((x) => (x.language ?? '').toLowerCase().startsWith('ar')).sort((a, b) => scoreLocaleDemoted(b) - scoreLocaleDemoted(a))[0] ?? null, scoreLocaleDemoted).length > 0);
// Case/separator sensitivity: engines really report 'ar_SA' and 'AR-SA'.
const scoreCaseSensitive: ScoreFn = (x) => {
  let s = 0;
  if (x.language === AR_LANG) s += 4;
  if (x.localService !== false) s += 2;
  if (x.quality === QUALITY_ENHANCED) s += 1;
  return s;
};
mustCatch('a locale comparison that is case- and separator-SENSITIVE, so «ar_SA» from a real engine stops matching',
  voiceProblems(pickBestArabicVoice, scoreCaseSensitive).length > 0);

// — the WebKit pause watchdog: each condition dropped in turn —
mustCatch('the `!enginePaused` condition dropped — every pause on every engine restarts the unit from its start',
  pauseProblems((o) => o.state === 'paused' && o.playToken === o.tokenAtPause).length > 0);
mustCatch('the token comparison dropped — a stale timer reaches across units and cancels the wrong utterance',
  pauseProblems((o) => o.state === 'paused' && !o.enginePaused).length > 0);
mustCatch('the state check dropped — a Resume inside the verify window is cancelled, stopping audio the user just asked to continue',
  pauseProblems((o) => o.playToken === o.tokenAtPause && !o.enginePaused).length > 0);
mustCatch('a watchdog that never fires at all — the iOS Safari pause() no-op goes unhandled',
  pauseProblems(() => false).length > 0);

// — the refusal verdict: THE DEFECT ops_incident #693's sibling, and its neighbours —
// This is the mutant that matters most: it IS the shipped defect. A verdict that answers
// «no-voice-on-device» whenever no voice is confirmed tells a user their hardware cannot do this
// while the 45s retry window is still running.
mustCatch('THE DEFECT: a verdict that claims «no voice on this device» while the search is still running (unknown → NO)',
  refusalProblems((o) => (o.voiceConfirmed ? 'none' : 'no-voice-on-device'), readAloudRefusalMessageKey, i18n).length > 0);
mustCatch('the inverse collapse — everything unconfirmed reported as «still-resolving», so a device with NO Arabic voice is never told',
  refusalProblems((o) => (o.voiceConfirmed ? 'none' : 'still-resolving'), readAloudRefusalMessageKey, i18n).length > 0);
mustCatch('two distinct verdicts mapped to ONE sentence, which is the same lie one layer down',
  refusalProblems(readAloudRefusalVerdict, (r) => (r === 'none' ? null : DEVICE_SENTENCE), i18n).length > 0);
mustCatch('the device sentence reachable from the STILL-LOOKING state',
  refusalProblems(readAloudRefusalVerdict,
    (r) => (r === 'none' ? null : r === 'still-resolving' ? DEVICE_SENTENCE : 'something else'), i18n).length > 0);
mustCatch('a state with NO mapping at all — `undefined` renders as a blank line, not as a decision',
  refusalProblems(readAloudRefusalVerdict, (r) => (r === 'still-resolving' ? undefined : readAloudRefusalMessageKey(r)), i18n).length > 0);
mustCatch('a refusal that invents a cause when a voice IS confirmed',
  refusalProblems(readAloudRefusalVerdict, (r) => (r === 'none' ? 'Something went wrong' : readAloudRefusalMessageKey(r)), i18n).length > 0);
// The i18n half, proven against a MUTATED COPY OF THE REAL i18n.tsx — not an invented string.
mustCatch('the still-looking sentence added in English but never translated, so an Arabic-only user reads the English source string',
  refusalProblems(readAloudRefusalVerdict, readAloudRefusalMessageKey,
    i18n.replace(/'Still preparing the voice — tap again in a moment':[^\n]*\n/, '')).length > 0);
mustCatch('…and a key present but left with a NON-Arabic value (the fall-through a bare key-exists check misses)',
  refusalProblems(readAloudRefusalVerdict, readAloudRefusalMessageKey,
    i18n.replace(/('Still preparing the voice — tap again in a moment':)[^\n]*/, "$1 'Still preparing the voice',")).length > 0);

// — the wiring half, proven against MUTATED COPIES OF THE REAL SHIPPED FILES —
// Feeding these predicates hand-written snippets would prove nothing about the tree (R1: "a proof
// that supplies its own input proves nothing"), so every mutant below is the real file, edited.
mustCatch('readAloud.ts dropping the shared-module import and going back to its own scoring',
  wiringProblems(readAloudCode.replace(/pickBestArabicVoice/g, 'pickBestArabic'), rowCode, DEVICE_SENTENCE).length > 0);
mustCatch('the inline `s += 4` scoring formula reappearing in readAloud.ts beside the shared one (silent drift)',
  wiringProblems(`${readAloudCode}\nfunction legacyScore(x){ let s = 0; s += 4; return s; }`, rowCode, DEVICE_SENTENCE).length > 0);
mustCatch('the pause watchdog re-inlining its three conditions instead of calling the shared predicate',
  wiringProblems(readAloudCode.replace(/shouldForcePauseFallback\(\{/, 'noLongerShared({'), rowCode, DEVICE_SENTENCE).length > 0);
mustCatch('readAloud.ts stopping feeding its REAL module state to the verdict (an argument quietly renamed)',
  wiringProblems(readAloudCode.replace(/checkExhausted: voiceCheckExhausted/, 'checkExhausted: false'), rowCode, DEVICE_SENTENCE).length > 0);
mustCatch('FeedbackRow going back to guessing instead of asking readAloud WHY the tap was refused',
  wiringProblems(readAloudCode, rowCode.replace(/readAloudRefusal\(\)/g, 'somethingElse()'), DEVICE_SENTENCE).length > 0);
mustCatch('FeedbackRow rendering its own sentence instead of the shared mapping',
  wiringProblems(readAloudCode, rowCode.replace(/readAloudRefusalMessageKey\(/g, 'pickMessage('), DEVICE_SENTENCE).length > 0);
mustCatch('THE ORIGINAL SHAPE: FeedbackRow hardcoding the device verdict again',
  wiringProblems(readAloudCode, `${rowCode}\nconst fallback = t("${DEVICE_SENTENCE}");`, DEVICE_SENTENCE).length > 0);

if (mutFail) { console.error(`\nverify-read-aloud-voice-logic: ${mutFail} mutation(s) went UNCAUGHT — a predicate above cannot fail`); process.exit(1); }
if (failed) { console.error(`\nverify-read-aloud-voice-logic: ${failed} check(s) failed`); process.exit(1); }
console.log('\nverify-read-aloud-voice-logic: voice selection, the WebKit pause watchdog, and the refusal verdict, executed — not replicated — and every predicate watched to go red.');
