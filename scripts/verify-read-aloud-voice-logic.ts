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
  type ArabicVoiceCandidate,
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

check('WebKit/macOS (only a generic ar-001 alongside English) picks the Arabic voice, not the English one',
  pickBestArabicVoice(WEBKIT_MACOS)?.identifier === 'com.apple.voice.compact.ar-001.Maged');
check('WebKit/iOS picks the EXACT ar-SA Enhanced voice over the generic ar-001',
  pickBestArabicVoice(WEBKIT_IOS)?.identifier === 'com.apple.voice.enhanced.ar-SA.Tarik');
check('Blink/Windows picks the remote Arabic voice rather than the local ENGLISH one — an Arabic voice at all beats none',
  pickBestArabicVoice(BLINK_WINDOWS)?.identifier === 'Google العربية');
check('Gecko with NO Arabic voice returns null — read-aloud must refuse to speak, never hand Arabic text to an English voice',
  pickBestArabicVoice(GECKO_NO_ARABIC) === null);
check('an empty voice list (engine has not populated it yet) returns null rather than throwing',
  pickBestArabicVoice([]) === null);

// ── 3. The owner's priority order, where the axes genuinely disagree ────────────────────────────
const arSARemote = v('ar-sa-remote', 'ar-SA', { localService: false });
const arEGLocalEnhanced = v('ar-eg-local', 'ar-EG', { localService: true, quality: QUALITY_ENHANCED });
check('exact ar-SA wins even when REMOTE and a local Enhanced generic Arabic voice exists (exact-locale is unconditional: 4 > 2+1)',
  pickBestArabicVoice([arEGLocalEnhanced, arSARemote])?.identifier === 'ar-sa-remote');
check('the same answer regardless of input order — the sort decides, not the list order',
  pickBestArabicVoice([arSARemote, arEGLocalEnhanced])?.identifier === 'ar-sa-remote');
check('tied on locale-exactness, LOCAL beats remote',
  pickBestArabicVoice([v('r', 'ar-SA', { localService: false }), v('l', 'ar-SA', { localService: true })])?.identifier === 'l');
check('tied on locale and locality, ENHANCED beats default',
  pickBestArabicVoice([
    v('plain', 'ar-SA', { localService: true }),
    v('enh', 'ar-SA', { localService: true, quality: QUALITY_ENHANCED }),
  ])?.identifier === 'enh');

// `localService` is web-only; on native it is UNDEFINED and every voice is on-device by
// construction. `=== true` instead of `!== false` would silently dock every native voice two points
// and change which voice every phone picks — a behaviour change invisible to a source grep.
check('an undefined localService (native) scores the same as an explicit local voice',
  scoreArabicVoice(v('native', 'ar-SA')) === scoreArabicVoice(v('web', 'ar-SA', { localService: true })));
check('an explicitly REMOTE voice scores two lower than a local one',
  scoreArabicVoice(v('remote', 'ar-SA', { localService: false })) === scoreArabicVoice(v('local', 'ar-SA', { localService: true })) - 2);

// Locale matching must be case- and separator-insensitive: engines report 'ar_SA', 'AR-sa', 'ar-SA'.
for (const lang of ['ar-SA', 'ar_SA', 'AR-SA', 'ar_sa']) {
  check(`«${lang}» is recognised as the exact locale (engines differ on case and separator)`,
    scoreArabicVoice(v('x', lang)) === scoreArabicVoice(v('y', 'ar-SA')));
}

// ── 4. The WebKit pause() watchdog — each condition isolated ────────────────────────────────────
// iOS Safari's pause() can silently no-op: it returns normally, `paused` never becomes true, audio
// keeps playing. The fallback is cancel+restart. All three conditions are load-bearing.
const base = { state: 'paused' as const, playToken: 7, tokenAtPause: 7, enginePaused: false };
check('WebKit ignored pause() (engine not paused, same unit, still meant to be paused) ⇒ force the fallback',
  shouldForcePauseFallback(base) === true);
check('the engine DID hold ⇒ do NOT force — forcing anyway restarts the unit from its start on every pause, on every engine',
  shouldForcePauseFallback({ ...base, enginePaused: true }) === false);
check('the user hit Resume inside the verify window ⇒ do NOT force — cancelling would stop audio they just asked to continue',
  shouldForcePauseFallback({ ...base, state: 'playing' }) === false);
check('playback ended inside the verify window ⇒ do NOT force',
  shouldForcePauseFallback({ ...base, state: 'idle' }) === false);
check('a NEWER unit started ⇒ do NOT force — the stale timer must not reach across units and kill the wrong utterance',
  shouldForcePauseFallback({ ...base, playToken: 8 }) === false);

// ── 5. Production really uses these — an extracted module nothing imports is decoration ─────────
const readAloud = readFileSync(join(ROOT, 'src/lib/readAloud.ts'), 'utf8');
const code = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const readAloudCode = code(readAloud);
check('readAloud.ts imports the shared voice logic',
  /import \{[^}]*pickBestArabicVoice[^}]*\} from '@\/lib\/readAloudVoice'/.test(readAloudCode)
  && /shouldForcePauseFallback/.test(readAloudCode));
check('readAloud.ts no longer carries its own inline scoring (the drift this barrier exists to end)',
  !/VoiceQuality\.Enhanced/.test(readAloudCode) && !/s \+= 4;/.test(readAloudCode));
check('the pause watchdog calls the shared predicate rather than re-inlining its three conditions',
  /shouldForcePauseFallback\(\{/.test(readAloudCode)
  && !/state === 'paused' && playToken === tokenAtPause && !window\.speechSynthesis\.paused/.test(readAloudCode));
// The whole point of the split: keep it executable. An import here would end that.
const voiceLogicCode = code(readFileSync(join(ROOT, 'src/lib/readAloudVoice.ts'), 'utf8'));
check('readAloudVoice.ts stays import-free, so this barrier can keep EXECUTING it',
  !/^\s*import\s/m.test(voiceLogicCode));
// And the replica must be gone, or the drift risk simply moved house.
const contract = readFileSync(join(ROOT, 'scripts/verify-read-aloud-contract.ts'), 'utf8');
check('verify-read-aloud-contract.ts no longer scores voices through a hand-written replica',
  !/pickBestArabicReplica/.test(contract));

if (failed) { console.error(`\nverify-read-aloud-voice-logic: ${failed} check(s) failed`); process.exit(1); }
console.log('\nverify-read-aloud-voice-logic: voice selection and the WebKit pause watchdog, executed — not replicated.');
