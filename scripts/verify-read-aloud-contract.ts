// Read Aloud contract (owner P0, 2026-08-18): native/OS text-to-speech ONLY — never ElevenLabs,
// Google Cloud TTS, Azure TTS, or any paid API, at any volume. This is the permanent, machine-
// enforced version of that promise: if a future edit ever wires a paid provider into the read-aloud
// path, or breaks single-speaker / no-autoplay / language-detection reuse, this script goes red in
// `npm test` before it ships.
//
//   node --experimental-strip-types scripts/verify-read-aloud-contract.ts   (wired into `npm test`)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readAloud = readFileSync(join(root, 'src/lib/readAloud.ts'), 'utf8');
const feedbackRow = readFileSync(join(root, 'src/components/FeedbackRow.tsx'), 'utf8');
const agent = readFileSync(join(root, 'src/app/agent.tsx'), 'utf8');
const i18n = readFileSync(join(root, 'src/i18n.tsx'), 'utf8');
const pkg = readFileSync(join(root, 'package.json'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// ── STAYS FREE: no paid TTS provider anywhere near the read-aloud path. ──────────────────────────
const PAID_TTS_SIGNS = /elevenlabs|texttospeech\.googleapis\.com|cognitiveservices.*speech|azure.*(?:cognitive|speech)|speechSynthesizer\.speakText|api\.elevenlabs/i;
check('readAloud.ts names no paid TTS provider/endpoint', !PAID_TTS_SIGNS.test(readAloud));
check('FeedbackRow.tsx names no paid TTS provider/endpoint', !PAID_TTS_SIGNS.test(feedbackRow));
check('agent.tsx names no paid TTS provider/endpoint', !PAID_TTS_SIGNS.test(agent));
// The ONLY speech dependency is expo-speech (wraps window.speechSynthesis on web, native OS TTS on
// iOS/Android) — free at any volume, never a network call Ezhalah is billed for.
check("package.json depends on expo-speech (the free native/OS TTS wrapper) and nothing else speech-related", /"expo-speech":/.test(pkg) && !/"@google-cloud\/text-to-speech"|"elevenlabs"|"microsoft-cognitiveservices-speech-sdk"/.test(pkg));
check('readAloud.ts imports expo-speech, not a fetch-based TTS client', /import \* as Speech from 'expo-speech'/.test(readAloud) && !/fetch\(/.test(readAloud));

// ── SINGLE SPEAKER: starting one utterance always stops whatever is currently playing first — no
//    queue, so "only one response speaks" and "starting another stops the previous" hold by
//    construction rather than needing separate bookkeeping that could drift out of sync. ──────────
check('speakReadAloud() stops any in-progress utterance before starting a new one', /export function speakReadAloud[\s\S]{0,80}?\{\s*stopReadAloud\(\);/.test(readAloud));
check('a shared "who is speaking" id is exposed for callers to derive their own state from', /let currentId: string \| null = null/.test(readAloud) && /export function subscribeReadAloud/.test(readAloud));

// ── NEVER AUTOPLAYS: the only call site is a Pressable onPress — iOS Safari silently drops
//    speak() calls made outside a user-gesture handler anyway, but this is pinned independently so
//    a future refactor can't accidentally wire it into a useEffect. ────────────────────────────────
check('FeedbackRow calls speakReadAloud only from its onReadAloud handler, itself only wired to onPress', /const onReadAloud = \(\) => \{[\s\S]{0,200}?speakReadAloud\(/.test(feedbackRow) && /onPress=\{onReadAloud\}/.test(feedbackRow));
check('no speak call sits inside a bare useEffect (would autoplay without a tap)', !/useEffect\(\(\) => \{[\s\S]{0,200}?speakReadAloud\(/.test(feedbackRow) && !/useEffect\(\(\) => \{[\s\S]{0,400}?speakReadAloud\(/.test(agent));

// ── LANGUAGE: ar-SA for Arabic, en-US for English, from the SAME detector the reply bubble's own
//    RTL layout uses — never a second copy that could disagree about what language a message is. ──
check("readAloudLang() returns exactly 'ar-SA'/'en-US' driven by the shared msgRTL detector", /export function readAloudLang[\s\S]{0,120}?return msgRTL\(text\) \? 'ar-SA' : 'en-US';/.test(readAloud));
check('msgRTL has ONE definition (src/lib/textDirection.ts), imported everywhere it is used', /export const msgRTL = /.test(readFileSync(join(root, 'src/lib/textDirection.ts'), 'utf8')) && /import \{ msgRTL \} from '\.\/textDirection'/.test(readAloud) && /import \{ msgRTL \} from '@\/lib\/textDirection'/.test(agent));

// ── CLEANUP: never leaves a dangling utterance playing after the row unmounts (page navigation), or
//    across a new search on the same screen. ───────────────────────────────────────────────────────
check('FeedbackRow stops its own speech on unmount (ref-based, mount/unmount only — no redundant stop on every idle transition)', /useEffect\(\(\) => \(\) => \{ if \(speakingRef\.current\) stopReadAloud\(\); \}, \[\]\);/.test(feedbackRow));
check('starting a new search/turn stops any read-aloud left over from the previous response', /stopReadAloud\(\); \/\/ a new turn starting is "another response"/.test(agent));

// ── UI: no fabricated fallback voice/provider on error — the OS/browser's own behavior is the whole
//    story, per owner instruction ("do not switch to a paid service"). ─────────────────────────────
check('onError never falls back to a different (paid) speech path — just clears the speaking state', /onError: \(\) => \{ if \(currentId === id\) setCurrent\(null\); \}/.test(readAloud));

// ── i18n: the two new labels exist, Arabic, no Latin leak (same pattern every other AR-dict check
//    in this repo uses). ────────────────────────────────────────────────────────────────────────
for (const key of ['Read aloud', 'Stop reading']) {
  const m = i18n.match(new RegExp(`'${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}': '([^']+)'`));
  check(`AR dict has «${key}» with an Arabic, Latin-free value`, !!m && /[؀-ۿ]/.test(m![1]) && !/[A-Za-z]/.test(m![1]));
}

console.log(failed === 0 ? '\n✓ read-aloud contract holds — native/OS TTS only, $0 at any volume' : `\n✗ ${failed} assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
