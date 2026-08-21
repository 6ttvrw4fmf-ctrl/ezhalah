// Read Aloud contract (owner P0, 2026-08-18; Arabic-only + voice tuning, 2026-08-19): native/OS
// text-to-speech ONLY — never ElevenLabs, Google Cloud TTS, Azure TTS, or any paid API, at any
// volume; every utterance is Arabic (ar-SA), no per-message language branch. This is the permanent,
// machine-enforced version of that promise: if a future edit ever wires a paid provider into the
// read-aloud path, reintroduces a language branch, or breaks single-speaker / no-autoplay / voice
// preference, this script goes red in `npm test` before it ships.
//
//   node --experimental-strip-types scripts/verify-read-aloud-contract.ts   (wired into `npm test`)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readAloud = readFileSync(join(root, 'src/lib/readAloud.ts'), 'utf8');
const readAloudScript = readFileSync(join(root, 'src/lib/readAloudScript.ts'), 'utf8');
const listingDisplay = readFileSync(join(root, 'src/lib/listingDisplay.ts'), 'utf8');
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

// ── LANGUAGE: Arabic ONLY (owner 2026-08-19) — every utterance speaks as ar-SA, no English branch,
//    no per-message language detection to keep in sync with anything else. ──────────────────────────
check("every speak() call is hardcoded to ar-SA — no English/other-language branch", /const AR_LANG = 'ar-SA';/.test(readAloud) && /language: AR_LANG/.test(readAloud) && !/en-US/.test(readAloud));
check('msgRTL (bubble RTL layout) has ONE definition (src/lib/textDirection.ts) — read-aloud no longer needs or imports it', /export const msgRTL = /.test(readFileSync(join(root, 'src/lib/textDirection.ts'), 'utf8')) && /import \{ msgRTL \} from '@\/lib\/textDirection'/.test(agent) && !/textDirection/.test(readAloud));

// ── VOICE QUALITY (owner feedback 2026-08-19 — "sounds robotic"): prefer an Enhanced-quality Arabic
//    voice when the device has one, resolved ahead of time (never awaited inside speakReadAloud —
//    that would break iOS Safari's synchronous-user-gesture requirement), plus a calmer rate. ───────
check('an Enhanced-quality Arabic voice is preferred when available, resolved via a pre-warmed cache (never awaited at speak time)', /VoiceQuality\.Enhanced/.test(readAloud) && /void Speech\.getAvailableVoicesAsync\(\)/.test(readAloud) && !/await Speech\.getAvailableVoicesAsync\(\)[\s\S]{0,200}?export function speakReadAloud/.test(readAloud));
check('speakReadAloud() itself has no await before Speech.speak() (stays synchronous for the iOS Safari gesture requirement)', !/export function speakReadAloud[\s\S]*?await[\s\S]*?Speech\.speak/.test(readAloud));
// CHATGPT-LIKE PACING (owner 2026-08-19): rate is a MEASURED value (real playback timing against the
// documented ~4.5 syllable/second natural-Arabic-speech benchmark), not a guess — pinned distinctly
// from "some slow-sounding default" so a future edit can't silently drift it back toward 0.92 without
// this check moving too. Only the number itself may legitimately change (re-measure and update both).
check('speech rate is the measured, documented value (1.3 — natural-pace-tuned, not an arbitrary slowdown)', /const SPEECH_RATE = 1\.3;/.test(readAloud) && /rate: SPEECH_RATE/.test(readAloud));

// ── STRUCTURE (owner 2026-08-19): إزهله -> pause -> summary -> pause -> visible property cards, in
//    the SAME order shown on screen, capped, never reading raw/internal fields. ─────────────────────
check("script opens with the intro word 'إزهله' followed by a pause before anything else", /const INTRO_WORD = 'إزهله';/.test(readAloudScript) && /segments: ReadAloudSegment\[\] = \[\{ text: INTRO_WORD, pauseAfterMs: PAUSE_MS \}\];/.test(readAloudScript));
check('the summary is spoken next (second segment), also followed by a pause', /if \(summary\) segments\.push\(\{ text: summary, pauseAfterMs: PAUSE_MS \}\);/.test(readAloudScript));
check('cards are appended AFTER intro+summary, via Array.forEach over the listings array (preserves on-screen order — never re-sorted)', /capped\.forEach\(\(listing, i\) => \{\s*segments\.push\(\{ text: cardSpeech\(listing\)/.test(readAloudScript));
check('no pause is added after the LAST card (nothing trails a natural end)', /pauseAfterMs: i < capped\.length - 1 \? PAUSE_MS : 0/.test(readAloudScript));
// CARD CAP (owner decision 2026-08-20): 10, matching the visual FIRST_PAGE exactly — the earlier 5
// was Claude's shorter-playback suggestion, not a technical limit; pin the CURRENT owner-set number
// so a future edit can't silently drift it without this check moving too.
check('the card cap is the owner-set value (10 — matches the visual first page), applied via .slice() (bounded, not "all of them")', /export const READ_ALOUD_CARD_CAP = 10;/.test(readAloudScript) && /visibleListings\.slice\(0, READ_ALOUD_CARD_CAP\)/.test(readAloudScript));
check('the caller passes the VISIBLE (reveal-count-sliced) listings, never the full fetched set — no hidden listing can be spoken', /buildResultsReadAloudSegments\(introText, m\.result\.listings\.slice\(0, shown\)\)/.test(agent));
// No raw/internal fields anywhere in the card-speech builder: id, source_url, source/platform name,
// free-text description/title, or a raw JSON dump. Only the Arabic DISPLAY helpers (listingDisplay.ts)
// and the plain numeric stat fields (beds/bathrooms/area) are touched.
const NO_INTERNAL_FIELDS = /listing\.id\b|listing\.source_url|listing\.source\b|listing\.description|listing\.title|JSON\.stringify/;
check('cardSpeech() never touches an id/URL/source/description/title field or serializes raw JSON', !NO_INTERNAL_FIELDS.test(readAloudScript));
check('card facts come from the SAME Arabic display helpers ResultCard.tsx itself uses (one derivation, spoken can never disagree with shown)', /listingTypeAr\(listing\)/.test(readAloudScript) && /listingLocationAr\(listing\)/.test(readAloudScript) && /listingPriceAr\(listing\)/.test(readAloudScript) && /export function listingTypeAr/.test(listingDisplay) && /export function listingPriceAr/.test(listingDisplay));

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
