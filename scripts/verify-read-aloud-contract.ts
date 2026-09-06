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
import { pickBestArabicVoice } from '../src/lib/readAloudVoice.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readAloud = readFileSync(join(root, 'src/lib/readAloud.ts'), 'utf8');
const readAloudScript = readFileSync(join(root, 'src/lib/readAloudScript.ts'), 'utf8');
const listingDisplay = readFileSync(join(root, 'src/lib/listingDisplay.ts'), 'utf8');
const feedbackRow = readFileSync(join(root, 'src/components/FeedbackRow.tsx'), 'utf8');
const readAloudPlayer = readFileSync(join(root, 'src/components/ReadAloudPlayer.tsx'), 'utf8');
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
check('ReadAloudPlayer.tsx (the floating controller) names no paid TTS provider/endpoint', !PAID_TTS_SIGNS.test(readAloudPlayer) && !/fetch\(/.test(readAloudPlayer));
// The ONLY speech dependency is expo-speech (wraps window.speechSynthesis on web, native OS TTS on
// iOS/Android) — free at any volume, never a network call Ezhalah is billed for.
check("package.json depends on expo-speech (the free native/OS TTS wrapper) and nothing else speech-related", /"expo-speech":/.test(pkg) && !/"@google-cloud\/text-to-speech"|"elevenlabs"|"microsoft-cognitiveservices-speech-sdk"/.test(pkg));
check('readAloud.ts imports expo-speech, not a fetch-based TTS client', /import \* as Speech from 'expo-speech'/.test(readAloud) && !/fetch\(/.test(readAloud));

// ── SINGLE SPEAKER: starting one utterance always stops whatever is currently playing first — no
//    queue, so "only one response speaks" and "starting another stops the previous" hold by
//    construction rather than needing separate bookkeeping that could drift out of sync. ──────────
check('speakReadAloud() stops any in-progress utterance before starting a new one', /export function speakReadAloud[\s\S]{0,80}?\{\s*stopReadAloud\(\);/.test(readAloud));
check('a shared "who is speaking" id is exposed for callers to derive their own state from', /let sessionId: string \| null = null/.test(readAloud) && /export function subscribeReadAloud/.test(readAloud));

// ── NEVER AUTOPLAYS: the only call site is a Pressable onPress — iOS Safari silently drops
//    speak() calls made outside a user-gesture handler anyway, but this is pinned independently so
//    a future refactor can't accidentally wire it into a useEffect. ────────────────────────────────
check('FeedbackRow calls speakReadAloud only from its onReadAloud handler, itself only wired to onPress', /const onReadAloud = \(\) => \{[\s\S]{0,200}?speakReadAloud\(/.test(feedbackRow) && /onPress=\{onReadAloud\}/.test(feedbackRow));
check('no speak call sits inside a bare useEffect (would autoplay without a tap)', !/useEffect\(\(\) => \{[\s\S]{0,200}?speakReadAloud\(/.test(feedbackRow) && !/useEffect\(\(\) => \{[\s\S]{0,400}?speakReadAloud\(/.test(agent));

// ── LANGUAGE: Arabic ONLY (owner 2026-08-19) — every utterance speaks as ar-SA, no English branch,
//    no per-message language detection to keep in sync with anything else. ──────────────────────────
check("every speak() call is hardcoded to ar-SA — no English/other-language branch", /const AR_LANG = 'ar-SA';/.test(readAloud) && /language: AR_LANG/.test(readAloud) && !/en-US/.test(readAloud));
check('msgRTL (bubble RTL layout) has ONE definition (src/lib/textDirection.ts) — read-aloud no longer needs or imports it', /export const msgRTL = /.test(readFileSync(join(root, 'src/lib/textDirection.ts'), 'utf8')) && /import \{ msgRTL \} from '@\/lib\/textDirection'/.test(agent) && !/textDirection/.test(readAloud));

// ── VOICE QUALITY (owner feedback 2026-08-19 — "sounds robotic"; root-cause voice-selection fix,
//    2026-08-22): prefer an exact ar-SA, on-device, Enhanced-quality Arabic voice when available,
//    resolved ahead of time via a bounded poll (never awaited inside speakReadAloud — that would
//    break iOS Safari's synchronous-user-gesture requirement), plus a calmer rate. ──────────────────
const voiceLogic = readFileSync(join(root, 'src/lib/readAloudVoice.ts'), 'utf8');
// Retargeted 2026-09-03: the scoring moved to the import-free lib/readAloudVoice.ts so it could be
// EXECUTED rather than replicated (see the block below). The three axes are still pinned — and the
// behaviour itself is now run, per engine, by scripts/verify-read-aloud-voice-logic.ts.
check('voice scoring prefers exact ar-SA, on-device (localService), AND Enhanced quality — all three axes', /AR_LANG\.toLowerCase\(\)\) s \+= 4/.test(voiceLogic) && /localService[\s\S]{0,20}!== false\) s \+= 2/.test(voiceLogic) && /QUALITY_ENHANCED\) s \+= 1/.test(voiceLogic));
check('voice resolution is a bounded POLL (not a single voiceschanged await) — resilient to voiceschanged never firing on some engines', /const POLL_TIMEOUTS_MS = \[/.test(readAloud) && /Promise\.race\(\[/.test(readAloud) && /void resolveVoice\(\);/.test(readAloud));
// ROOT-CAUSE FIX (owner report, 2026-08-23 — Windows Chrome: the button always said "not available",
// even though the device may genuinely have a usable Arabic voice that just took longer than the
// original ~3s-from-page-load poll to appear). voiceCheckExhausted must NOT be set permanently right
// after the fast poll — it has to keep re-checking in the background for a window comfortably longer
// than a real search-to-first-tap gap before ever calling a device "genuinely unavailable".
check('voice resolution keeps retrying in the background for a generous window (RETRY_WINDOW_MS) before giving up — never gives up permanently right after the initial fast poll', /const RETRY_WINDOW_MS = 45000;/.test(readAloud) && /const deadline = Date\.now\(\) \+ RETRY_WINDOW_MS;/.test(readAloud) && /while \(Date\.now\(\) < deadline\)/.test(readAloud));
check('voiceCheckExhausted is set ONLY after the retry window is exhausted, not right after the initial fast poll', !/for \(const timeout of POLL_TIMEOUTS_MS\) \{\s*const found = pickBestArabic\(await getVoicesOnce\(timeout\)\);\s*if \(found\) \{ bestArabicVoice = found; return; \}\s*\}\s*voiceCheckExhausted = true;/.test(readAloud) && /voiceCheckExhausted = true;/.test(readAloud));
check('speakReadAloud() itself has no await before Speech.speak() (stays synchronous for the iOS Safari gesture requirement)', !/export function speakReadAloud[\s\S]*?await[\s\S]*?Speech\.speak/.test(readAloud));
// ── ROOT-CAUSE FIX (owner report 2026-08-22, "sounds English"): NEVER call Speech.speak() without an
//    explicitly confirmed matching Arabic voice — this is what the old code got wrong (fell through
//    to language-only, which most engines resolve to the SYSTEM DEFAULT voice, not an Arabic one).
check('speakReadAloud() refuses to speak (returns false) when no Arabic voice has been confirmed — never falls through to a language-only (wrong-voice) call', /if \(!bestArabicVoice\) return false;/.test(readAloud));
check('every actual Speech.speak() call passes an explicit .voice (the confirmed Arabic voice identifier), never language-only', /voice: bestArabicVoice!\.identifier,/.test(readAloud));
check('speakReadAloud has a boolean return type so callers can react to "genuinely unavailable" (FeedbackRow shows a graceful Arabic message, never silently speaks wrong-language)', /export function speakReadAloud\(id: string, segments: ReadAloudSegment\[\]\): boolean \{/.test(readAloud));
check('FeedbackRow shows the graceful "not available" message only when speakReadAloud reports it did not start — never as a silent no-op', /const started = speakReadAloud\(feedbackKey, readAloudSegments\);/.test(feedbackRow) && /if \(!started\) \{/.test(feedbackRow) && /setUnavailable\(true\)/.test(feedbackRow));
// CHATGPT-LIKE PACING (owner 2026-08-19): rate is a MEASURED value (real playback timing against the
// documented ~4.5 syllable/second natural-Arabic-speech benchmark), not a guess — pinned distinctly
// from "some slow-sounding default" so a future edit can't silently drift it back toward 0.92 without
// this check moving too. Only the number itself may legitimately change (re-measure and update both).
check('default speech rate is the measured, documented value (1.3 — natural-pace-tuned, not an arbitrary slowdown)', /const DEFAULT_RATE = 1\.3;/.test(readAloud) && /let rate: number = DEFAULT_RATE;/.test(readAloud));

// ── STRUCTURE (owner 2026-08-19): إزهله -> pause -> summary -> pause -> visible property cards, in
//    the SAME order shown on screen, capped, never reading raw/internal fields. ─────────────────────
check("script opens with the intro word 'إزهله' followed by a pause before anything else", /const INTRO_WORD = 'إزهله';/.test(readAloudScript) && /segments: ReadAloudSegment\[\] = \[\{ text: INTRO_WORD, pauseAfterMs: PAUSE_MS \}\];/.test(readAloudScript));
check('the summary is spoken next (second segment), also followed by a pause', /if \(summary\) segments\.push\(\{ text: summary, pauseAfterMs: PAUSE_MS \}\);/.test(readAloudScript));
check('cards are appended AFTER intro+summary, via Array.forEach over the listings array (preserves on-screen order — never re-sorted)', /visibleListings\.forEach\(\(listing, i\) => \{[\s\S]{0,120}?segments\.push\(\{ text: cardSpeech\(listing\)/.test(readAloudScript));
check('no pause trails the LAST card when there is no closing note; a pause DOES separate the last card from a closing note when one is supplied', /pauseAfterMs: isLast && !note \? 0 : PAUSE_MS/.test(readAloudScript));
// NO CAP (owner request, 2026-08-22: "it doesn't do it for all the cards... do it all" — the old
// READ_ALOUD_CARD_CAP=5 stopped short). Every visible card is spoken now; the only bound left is the
// caller's own reveal-count slice (checked next), never a second, stricter one in the script itself.
check('no card cap remains in the script — every visibleListings entry is spoken, not a .slice()-bounded subset', !/READ_ALOUD_CARD_CAP/.test(readAloudScript) && !/visibleListings\.slice\(/.test(readAloudScript));
check('the caller passes the VISIBLE (reveal-count-sliced) listings, never the full fetched set — no hidden listing can be spoken', /buildResultsReadAloudSegments\(introText, m\.result\.listings\.slice\(0, shown\), readAloudClosingNote\)/.test(agent));
// CLOSING NOTE (owner request, 2026-08-23 — "read the note... and say the button also"): the
// «عرضت لك أول N إعلانات...» text + an available-actions sentence, spoken as the FINAL segment —
// appended, never re-derived, from the exact same variables agent.tsx's visible Text/buttons use.
check('buildResultsReadAloudSegments() accepts an optional closingNote and appends it as the final segment, trimmed and only when non-empty', /export function buildResultsReadAloudSegments\(summaryText: string, visibleListings: Listing\[\], closingNote\?: string\)/.test(readAloudScript) && /const note = closingNote\?\.trim\(\);/.test(readAloudScript) && /if \(note\) segments\.push\(\{ text: note, pauseAfterMs: 0 \}\);/.test(readAloudScript));
check('agent.tsx builds the closing note from the SAME moreNoteText the visible <Text> renders, never a re-derived copy', /<Text style=\{\[s\.replyText,[\s\S]{0,120}?\{moreNoteText\}/.test(agent) && /const readAloudClosingNote = \[moreNoteText, spokenActionsNote\]\.filter\(Boolean\)\.join\(' '\);/.test(agent));
check('the spoken available-actions sentence names only button(s) that are ACTUALLY on screen (gated by the same showActionsRow used for the visible buttons row, incl. the Advanced-Filter-open hide)', /const showActionsRow = \(hasMore \|\| canNarrowFurther\)\s*\n\s*&& !afInterviewOwnsBrowsing\(ageFlow\?\.phase \?\? null\);/.test(agent) && /const spokenActionsNote = !showActionsRow \? ''/.test(agent) && /\{showActionsRow \? \(/.test(agent));
check('the spoken action label(s) are the exact SAME t(\'Load more\')/t(\'Let’s narrow it down\') strings the visible buttons render — never a separately-worded copy', /const spokenActionLabels = \[hasMore && t\('Load more'\), canNarrowFurther && t\('Let’s narrow it down'\)\]\.filter\(Boolean\) as string\[\];/.test(agent));
// No raw/internal fields anywhere in the card-speech builder: id, source_url, free-text
// description/title, or a raw JSON dump. Platform name IS spoken (owner request, 2026-08-22) but only
// via the shared listingPlatformAr() display helper, never a raw listing.source read in this file.
const NO_INTERNAL_FIELDS = /listing\.id\b|listing\.source_url|listing\.source\b|listing\.description|listing\.title|JSON\.stringify/;
check('cardSpeech() never touches a raw id/URL/source/description/title field or serializes raw JSON (platform name comes only from listingPlatformAr)', !NO_INTERNAL_FIELDS.test(readAloudScript));
check('card facts come from the SAME Arabic display helpers ResultCard.tsx itself uses (one derivation, spoken can never disagree with shown)', /listingTypeAr\(listing\)/.test(readAloudScript) && /listingLocationAr\(listing\)/.test(readAloudScript) && /listingPriceAr\(listing\)/.test(readAloudScript) && /export function listingTypeAr/.test(listingDisplay) && /export function listingPriceAr/.test(listingDisplay));

// ── PLATFORM NAME (owner request, 2026-08-22): speak which platform hosts each card, using the exact
//    SAME 'Hosted on {name}' i18n key and sourceName() mapping ResultCard.tsx's visible "مستضاف على X"
//    badge uses — moved to listingDisplay.ts as the ONE shared mapping so the spoken platform can
//    never drift from what the card shows. ──────────────────────────────────────────────────────────
const resultCard = readFileSync(join(root, 'src/components/ResultCard.tsx'), 'utf8');
check('every card speaks its platform name last, via the shared listingPlatformAr() helper', /sentences\.push\(listingPlatformAr\(listing\)\);/.test(readAloudScript) && /import \{ listingTypeAr, listingLocationAr, listingPriceAr, listingPlatformAr \} from '\.\/listingDisplay';/.test(readAloudScript));
check('listingPlatformAr() reuses the SAME \'Hosted on {name}\' i18n key the visible card badge renders — cannot say a different platform than what is shown', /export function listingPlatformAr[\s\S]{0,120}?translate\('ar', 'Hosted on \{name\}', \{ name: translate\('ar', sourceName\(listing\.source\)\) \}\)/.test(listingDisplay));
check('sourceName() (the platform-slug-to-label mapping) lives in ONE place, listingDisplay.ts — ResultCard.tsx imports it rather than keeping its own copy', /export function sourceName\(source: string\): string \{/.test(listingDisplay) && /import \{ sourceName \} from '@\/lib\/listingDisplay';/.test(resultCard) && !/^function sourceName/m.test(resultCard));

// ── CLEANUP: never leaves a dangling utterance playing after the row unmounts (page navigation), or
//    across a new search on the same screen. ───────────────────────────────────────────────────────
check('FeedbackRow stops its own speech on unmount (ref-based, mount/unmount only — no redundant stop on every idle transition)', /useEffect\(\(\) => \(\) => \{ if \(speakingRef\.current\) stopReadAloud\(\); \}, \[\]\);/.test(feedbackRow));
check('starting a new search/turn stops any read-aloud left over from the previous response', /stopReadAloud\(\); \/\/ a new turn starting is "another response"/.test(agent));

// ── UI: no fabricated fallback voice/provider on error — the OS/browser's own behavior is the whole
//    story, per owner instruction ("do not switch to a paid service"). ─────────────────────────────
check('a unit error just ends the session cleanly (finishSession) — never falls back to a different (paid) speech path', /\(\) => finishSession\(\),/.test(readAloud) && /function finishSession\(\) \{/.test(readAloud) && !/(elevenlabs|googleapis|azure|cognitiveservices)/i.test(readAloud));

// ── FLOATING PLAYBACK CONTROLLER (owner 2026-08-22 — ChatGPT-popup-style pill, Ezhalah-branded,
//    interaction reference only, not pixel-copied). ─────────────────────────────────────────────────

// WEB PAUSE/RESUME BUG AVOIDANCE: expo-speech's own web shim remaps SpeechSynthesisUtterance's
// native onpause event to its OWN 'speakingStopped' event and deletes that utterance's callback
// registration — confirmed reading node_modules/expo-speech/build/ExponentSpeech.web.js. Calling
// Speech.pause() would therefore both mis-report "stopped" and permanently break that utterance's
// completion callback. The fix speaks/pauses/resumes/cancels via the raw Web Speech API directly on
// web instead (voice RESOLUTION still goes through expo-speech's getAvailableVoicesAsync — untouched,
// unaffected by this bug — only actual playback moves).
check('web playback bypasses expo-speech\'s buggy Speech.speak()/pause()/resume(), using window.speechSynthesis directly instead', /window\.speechSynthesis\.speak\(utterance\)/.test(readAloud) && /window\.speechSynthesis\.pause\(\)/.test(readAloud) && /window\.speechSynthesis\.resume\(\)/.test(readAloud) && /window\.speechSynthesis\.cancel\(\)/.test(readAloud));
check('voice RESOLUTION is untouched by the playback-engine rewrite — still expo-speech\'s getAvailableVoicesAsync via the same bounded poll', /Speech\.getAvailableVoicesAsync\(\)/.test(readAloud) && /const POLL_TIMEOUTS_MS = \[/.test(readAloud));
check('the raw web utterance still gets the exact confirmed Arabic voice object (resolved back from bestArabicVoice.identifier), never left unset', /function resolveWebVoiceObject\(\)/.test(readAloud) && /v\.voiceURI === bestArabicVoice!\.identifier/.test(readAloud) && /if \(voice\) utterance\.voice = voice;/.test(readAloud));
check('native (iOS) pause/resume still go through expo-speech\'s Speech.pause()/Speech.resume() directly — no such remapping bug exists there', /void Speech\.pause\(\); \} \/\/ iOS only/.test(readAloud) && /void Speech\.resume\(\); \} \/\/ iOS only/.test(readAloud));
check('Android (no native pause/resume in expo-speech) never silently no-ops a pause tap — it cancels the current unit and restarts it on resume, an honest degraded behavior, not a fake pause', /else if \(isAndroid\(\)\) \{/.test(readAloud) && /pendingRestart = true;/.test(readAloud));

// TRUE PAUSE PRESERVES THE QUEUE: a real pause (web/iOS) must NOT invalidate the in-flight
// utterance's own eventual completion callback — only an actual CANCEL (stop/seek/rate-change) may
// bump playToken. If pause bumped it too, the exact same "onDone never fires after resume" bug the
// web-shim workaround above exists to avoid would just be reintroduced by this file's own pause path.
{
  const pauseFnMatch = readAloud.match(/export function pauseReadAloud\(\) \{[\s\S]*?\n\}/);
  const pauseFnBody = pauseFnMatch ? pauseFnMatch[0] : '';
  check('pauseReadAloud() never increments playToken on the true-pause path itself — only its two cancel-fallback branches do (Android, which has no pause API; and the web-verify-timeout catching an iOS Safari no-op pause)', !!pauseFnBody && /pauseSpeakingNow\(\);/.test(pauseFnBody) && (pauseFnBody.match(/playToken\+\+/g) ?? []).length === 2);
}
// IOS SAFARI PAUSE-NO-OP HARDENING (found live, reported as "the voice thing doesn't work",
// 2026-08-23): WebKit has a long-documented bug where speechSynthesis.pause() silently does nothing
// — never trust it blindly. Verify shortly after that `speechSynthesis.paused` actually became true;
// if not, force the same cancel+restart fallback Android already uses (Android has no pause API at
// all, so that fallback was already proven). AND: if pause() no-ops and the utterance finishes
// naturally instead, the onDone callback must NOT auto-advance to the next unit while `state` is
// still 'paused' — that would speak straight through the pause, the exact "doesn't work" shape.
check('a real pause attempt is VERIFIED, not trusted blindly — falls back to cancel+restart if speechSynthesis.paused never actually became true', /const WEB_PAUSE_VERIFY_MS = 120;/.test(readAloud) && /enginePaused: window\.speechSynthesis\.paused/.test(readAloud) && /!o\.enginePaused/.test(voiceLogic));
check('the pause-verify fallback is gated on the SAME pause attempt still being current (token + state check) — a resume or a new pause in the verify window is never overridden by a stale check', /o\.state === 'paused' && o\.playToken === o\.tokenAtPause && !o\.enginePaused/.test(voiceLogic) && /shouldForcePauseFallback\(\{/.test(readAloud));
check('a unit that finishes naturally while state is "paused" (the iOS no-op case) does NOT auto-advance to the next unit — it waits for an explicit resume instead of talking through the pause', /if \(state !== 'playing'\) \{ pendingRestart = true; return; \}/.test(readAloud));
check('stopReadAloud(), a seek jump, and a speed change all invalidate the in-flight callback via playToken++ before cancelling — a cancelled utterance can never fire a stale onDone/onError', (readAloud.match(/playToken\+\+/g) ?? []).length >= 4);

// ELAPSED TIME: a real wall-clock tick, not a fabricated always-zero display or a naive re-render-
// driven counter that would keep ticking while paused.
check('elapsed time is tracked by a real ticking interval, started on play/resume and stopped on pause/stop/finish (frozen, not zeroed, while paused)', /function startTicking\(\)/.test(readAloud) && /function stopTicking\(\)/.test(readAloud) && /elapsedMs \+= now - lastTickAtMs;/.test(readAloud));
check('a new speakReadAloud() session resets elapsed to zero; pauseReadAloud()/resumeReadAloud() never reset it', /elapsedMs = 0;/.test(readAloud) && !/export function pauseReadAloud[\s\S]{0,400}?elapsedMs = 0/.test(readAloud) && !/export function resumeReadAloud[\s\S]{0,400}?elapsedMs = 0/.test(readAloud));

// SEEK ±15s IS HONEST, NOT FAKED: native TTS has no scrubbable timeline, so seeking jumps to the
// nearest sentence-level UNIT boundary along an ESTIMATED per-unit timeline — never a fabricated
// in-utterance text offset (which would require re-picking a voice mid-utterance, a real risk to the
// voice contract) and never a silence-only landing spot.
check('seeking is estimate-based and jumps to a real unit boundary (jumpTo), documented explicitly as an estimate rather than a literal audio position', /function estimateUnitMs\(/.test(readAloud) && /function relativeStartsMs\(/.test(readAloud) && /function jumpTo\(/.test(readAloud) && /ESTIMATE-BASED SEEK/.test(readAloud));
check('seeking never lands on a silence-only unit — it walks forward to the next real speak unit', /while \(idx < sessionUnits\.length - 1 && sessionUnits\[idx\]\.kind === 'pause'\) idx\+\+;/.test(readAloud));
check('seek target is clamped to [0, total estimated duration] — never negative, never past the end', /Math\.max\(0, Math\.min\(currentPos \+ deltaMs, total\)\)/.test(readAloud));
check('exported seek entrypoint takes a signed delta (±15000 per the owner spec), not a hardcoded direction', /export function seekReadAloud\(deltaMs: number\)/.test(readAloud));
// ROOT-CAUSE FIX (found LIVE, 2026-08-22, immediately after shipping): seeking must anchor its
// timeline at the REAL current position (elapsedMs), never an absolute estimate accumulated from
// unit 0 — the old version made a forward seek jump the displayed time BACKWARD once real playback
// had drifted from the character-count estimate (confirmed live: real 85s vs. the old absolute
// estimate's 46s for the same unit — a +15s seek from the estimate landed at 61s, behind where
// real playback already was).
check('seeking anchors the timeline at REAL elapsedMs (the actual current position), never an absolute unit-0 estimate that can drift from real playback over a long reading', /const currentPos = elapsedMs;/.test(readAloud) && /relativeStartsMs\(unitIndex, currentPos, rate\)/.test(readAloud));
check('relativeStartsMs extends forward/backward from the given anchor using per-unit estimates for the RELATIVE distance only — the anchor itself is never re-derived from an estimate', /function relativeStartsMs\(fromIndex: number, fromPosMs: number, atRate: number\)/.test(readAloud) && /starts\[fromIndex\] = fromPosMs;/.test(readAloud));

// SPEED CONTROL: cycles the exact owner-specified steps, restarts only the CURRENT unit (the Web
// Speech API cannot change an in-flight utterance's rate), and — critically — never touches voice
// selection, since that would risk reopening the root-cause bug this file exists to prevent.
check('RATE_STEPS is exactly the owner-specified cycle, extended with faster options: 0.8x, 1x, 1.2x, 1.3x, 1.5x, 1.75x, 2x', /export const RATE_STEPS = \[0\.8, 1, 1\.2, 1\.3, 1\.5, 1\.75, 2\] as const;/.test(readAloud));
{
  const rateFnMatch = readAloud.match(/export function cycleReadAloudRate\(\)[\s\S]*?\n\}/);
  const rateFnBody = rateFnMatch ? rateFnMatch[0] : '';
  check('cycleReadAloudRate() restarts only the current unit on a live change, and never references voice selection (bestArabicVoice/pickBestArabic/resolveVoice)', !!rateFnBody && /cancelSpeaking\(\);/.test(rateFnBody) && /playCurrentUnit\(\);/.test(rateFnBody) && !/bestArabicVoice|pickBestArabic|resolveVoice/.test(rateFnBody));
}

// SINGLE ACTIVE SESSION / CLOSE STOPS SPEECH: the floating controller's close button routes through
// the SAME stopReadAloud() every other stop path uses — one source of truth, not a second reset that
// could drift (e.g. leaving FeedbackRow's own icon stuck on "stop").
check('the controller\'s Close button calls the shared stopReadAloud() — not a separate/duplicate stop implementation', /const onClose = \(\) => stopReadAloud\(\);/.test(readAloudPlayer));
check('ReadAloudPlayer renders nothing when idle — it does not linger as an invisible-but-present overlay over the result cards', /if \(!mounted \|\| !snap\) return null;/.test(readAloudPlayer));
check('ReadAloudPlayer is mounted exactly ONCE in agent.tsx (one active session ⇒ one controller, not one per card/response)', (agent.match(/<ReadAloudPlayer \/>/g) ?? []).length === 1 && !/<FeedbackRow[\s\S]{0,500}?<ReadAloudPlayer/.test(agent));
check('the controller is NOT a full-screen modal — no absoluteFill/dimmed backdrop, just a small top-anchored pill', !/StyleSheet\.absoluteFill/.test(readAloudPlayer) && !/rgba\(8,18,12/.test(readAloudPlayer));
check('the controller stays fixed on web while the page scrolls (position: fixed on web, absolute on native) and respects the top safe-area inset', /Platform\.OS === 'web' \? 'fixed' : 'absolute'/.test(readAloudPlayer) && /useSafeAreaInsets/.test(readAloudPlayer) && /insets\.top/.test(readAloudPlayer));
// ROOT-CAUSE FIX (found live on a mobile viewport, reported as "the voice thing doesn't work",
// 2026-08-23): the original `insets.top + 12` sat at the same height as agent.tsx's own top bar
// (hamburger/title/share), so the pill rendered cramped/overlapping it instead of below it — not
// literally silent, but exactly the kind of visibly-broken layout a user would describe that way.
// `insets.top + 54` is the SAME already-proven "clears the top bar" offset the app's own feedback
// toast (fbToastWrap in agent.tsx) uses — reused, not re-guessed, so it can't drift back to a value
// that overlaps again.
check('the pill sits at the SAME proven below-the-top-bar offset as the app\'s own feedback toast (insets.top + 54) — never the too-shallow +12 that overlapped the top bar on mobile', /top: insets\.top \+ 54/.test(readAloudPlayer) && !/top: insets\.top \+ 12/.test(readAloudPlayer) && /top: insets\.top \+ 54/.test(agent));
// Verified LIVE on production (screenshot): Ezhalah's document is dir="rtl" whenever Arabic is
// active, and plain 'row' already flows right-to-left there (it follows the ambient inline
// direction) — 'row-reverse' would DOUBLE-reverse it back to an LTR-looking layout, which is
// exactly what shipped wrong in PR#921 and was caught this way. 'row' is the genuine RTL-native
// choice (primary play/pause — first in DOM — lands at the right, the Arabic reading-start side).
check('the controller\'s row direction is the RTL-CORRECT choice (verified live) — plain \'row\' in this RTL document, not \'row-reverse\' which would double-mirror it back to an LTR-looking layout', /flexDirection: isRTL \? 'row' : 'row-reverse'/.test(readAloudPlayer));
check('the appear/disappear animation is a plain fade+scale (~180ms), not a spring/bounce, and is skipped entirely under reduced motion', /useReducedMotion/.test(readAloudPlayer) && /duration = reducedMotion \? 0 : ANIM_MS/.test(readAloudPlayer) && !/Animated\.spring/.test(readAloudPlayer));
check('every control passes its accessibility label as label={t(...)} — never a raw literal string prop that could leak English into the Arabic UI', !/label="[A-Za-z]/.test(readAloudPlayer) && /label=\{t\(playing \? 'Pause reading' : 'Resume reading'\)\}/.test(readAloudPlayer) && /label=\{t\('Close'\)\}/.test(readAloudPlayer) && /label=\{t\('Back 15 seconds'\)\}/.test(readAloudPlayer) && /label=\{t\('Forward 15 seconds'\)\}/.test(readAloudPlayer) && /accessibilityLabel=\{t\('Playback speed'\)\}/.test(readAloudPlayer));

for (const key of ['Read aloud', 'Stop reading', 'Pause reading', 'Resume reading', 'Back 15 seconds', 'Forward 15 seconds', 'Playback speed', 'You can tap {a} or {b}.', 'You can tap {a}.']) {
  const m = i18n.match(new RegExp(`'${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}': '([^']+)'`));
  // Strip {placeholder} tokens before the Latin-free check — a param name like {a}/{b}/{n} is
  // necessarily Latin, not an English-word leak; the actual INTERPOLATED value at speak time is
  // always the Arabic button label (t('Load more') etc.), never the raw token.
  const withoutPlaceholders = m ? m[1].replace(/\{[a-zA-Z]+\}/g, '') : '';
  check(`AR dict has «${key}» with an Arabic, Latin-free value`, !!m && /[؀-ۿ]/.test(m![1]) && !/[A-Za-z]/.test(withoutPlaceholders));
}
{
  // Key contains an escaped apostrophe in source ('Listening isn\'t ...') — matched directly rather
  // than via the generic loop above, which assumes no internal quotes.
  const m = i18n.match(/'Listening isn\\'t available on this device': '([^']+)'/);
  check("AR dict has «Listening isn't available on this device» with an Arabic, Latin-free value", !!m && /[؀-ۿ]/.test(m![1]) && !/[A-Za-z]/.test(m![1]));
}

// ── EXECUTED: readAloud.ts's REAL pickBestArabic() scoring, run against concrete voice lists.
//
//    This block used to define its own hand-written copy of that scoring — "a faithful replica" —
//    that, because readAloud.ts imports expo-speech and react-native and a Node check cannot import
//    it. A replica is faithful exactly until someone edits production and not the copy, and then
//    this file proves the OLD formula, in green, forever. The scoring now lives in the import-free
//    `src/lib/readAloudVoice.ts` (same split as lib/supportDraft.ts vs lib/support.ts), so these
//    cases run the code production runs. Per-engine voice-list shapes and the WebKit pause watchdog
//    are covered in scripts/verify-read-aloud-voice-logic.ts; the priority-order cases stay here,
//    where they have always lived. ────
type TestVoice = { identifier: string; name: string; quality: 'Default' | 'Enhanced'; language: string; localService?: boolean };
const pickBestArabicReal = (voices: TestVoice[]): TestVoice | null =>
  pickBestArabicVoice(voices as unknown as (TestVoice & { language: string })[]) as TestVoice | null;
{
  const majed: TestVoice = { identifier: 'majed', name: 'Majed', quality: 'Default', language: 'ar-001', localService: true };
  const arSA: TestVoice = { identifier: 'ar-sa-1', name: 'Generic Saudi', quality: 'Default', language: 'ar-SA', localService: true };
  const arEG: TestVoice = { identifier: 'ar-eg-1', name: 'Generic Egyptian', quality: 'Default', language: 'ar-EG', localService: true };
  const arSARemote: TestVoice = { identifier: 'ar-sa-remote', name: 'Google Arabic (Saudi)', quality: 'Default', language: 'ar-SA', localService: false };
  const arEnhanced: TestVoice = { identifier: 'ar-enh', name: 'Enhanced Arabic', quality: 'Enhanced', language: 'ar-001', localService: true };
  const en: TestVoice = { identifier: 'samantha', name: 'Samantha', quality: 'Default', language: 'en-US', localService: true };

  check('macOS-shape device (only Majed, ar-001, generic) picks Majed — the real production case verified live', pickBestArabicReal([en, majed])?.identifier === 'majed');
  check('when both an exact ar-SA and a generic ar-EG voice exist, ar-SA wins (exact-locale priority)', pickBestArabicReal([arEG, arSA])?.identifier === 'ar-sa-1');
  // Owner's own stated priority is explicit and unconditional: "1. exact Saudi Arabic voice (ar-SA)
  // ... 2. other high-quality Arabic voice" — exact-locale wins even over a local generic voice.
  // On-device/local is a tiebreaker AMONG non-exact candidates (see the ar-SA-vs-ar-EG check above
  // and the "best-of-all-worlds" check below), never a reason to skip a genuinely exact match.
  check('an exact ar-SA voice wins even when it happens to be remote and a local generic voice is also available (owner priority: exact-locale first, unconditionally)', pickBestArabicReal([arSARemote, majed])?.identifier === 'ar-sa-remote');
  check('among candidates that are EQUALLY exact (or equally non-exact), local still wins over remote (the tiebreaker, not an override of exact-locale)', pickBestArabicReal([arSARemote, arSA])?.identifier === 'ar-sa-1');
  check('an Enhanced-quality voice beats a Default-quality voice when locale+locality are equal', pickBestArabicReal([majed, { ...arEnhanced }])?.identifier === 'ar-enh');
  check('best-of-all-worlds: exact ar-SA + local + Enhanced wins over every partial match', pickBestArabicReal([majed, arSARemote, arEG, { ...arSA, quality: 'Enhanced' }])?.identifier === 'ar-sa-1');
  check('zero Arabic voices on the device (Windows/Android with no AR language pack) correctly returns null — never an English voice', pickBestArabicReal([en]) === null);
  check('English-only voice list never gets picked even when it is the ONLY voice present', pickBestArabicReal([en])?.identifier !== 'samantha');
}

// ── EXECUTED: a faithful replica of readAloud.ts's ESTIMATE-BASED SEEK math (owner 2026-08-22;
//    real-anchor root-cause fix, same day), run against a concrete unit timeline — proves seeking
//    clamps to [0, total], never lands on a silence-only unit, moves by real unit boundaries (not
//    fabricated positions), and — the fix itself — never runs the displayed position backward on a
//    forward seek (or forward on a backward seek) however far real playback has drifted from the
//    character-count estimate. Same constant (14 chars/sec at rate 1) and algorithm structure as the
//    real estimateUnitMs/relativeStartsMs/seekReadAloud in readAloud.ts. ────────────────────────────
type TestUnit = { kind: 'speak'; text: string } | { kind: 'pause'; ms: number };
function estimateUnitMsReplica(u: TestUnit, atRate: number): number {
  if (u.kind === 'pause') return u.ms;
  return (u.text.length / (14 * atRate)) * 1000;
}
function relativeStartsMsReplica(units: TestUnit[], fromIndex: number, fromPosMs: number, atRate: number): number[] {
  const starts: number[] = new Array(units.length);
  starts[fromIndex] = fromPosMs;
  let acc = fromPosMs;
  for (let i = fromIndex + 1; i < units.length; i++) { acc += estimateUnitMsReplica(units[i - 1], atRate); starts[i] = acc; }
  acc = fromPosMs;
  for (let i = fromIndex - 1; i >= 0; i--) { acc -= estimateUnitMsReplica(units[i], atRate); starts[i] = Math.max(0, acc); }
  return starts;
}
// `currentPosMs` mirrors the real elapsedMs the live app passes in — an explicit parameter here
// (rather than derived from an absolute per-unit estimate) so a test can deliberately simulate real
// playback having drifted away from what the estimate alone would predict for `currentIndex`.
function seekTargetIndexReplica(units: TestUnit[], currentIndex: number, currentPosMs: number, atRate: number, deltaMs: number): number {
  const starts = relativeStartsMsReplica(units, currentIndex, currentPosMs, atRate);
  const total = starts[starts.length - 1] + estimateUnitMsReplica(units[units.length - 1], atRate);
  const target = Math.max(0, Math.min(currentPosMs + deltaMs, total));
  let idx = 0;
  for (let i = 0; i < starts.length; i++) { if (starts[i] <= target) idx = i; else break; }
  while (idx < units.length - 1 && units[idx].kind === 'pause') idx++;
  return idx;
}
{
  const speak = (len: number): TestUnit => ({ kind: 'speak', text: 'x'.repeat(len) });
  const pause = (ms: number): TestUnit => ({ kind: 'pause', ms });
  // إزهله -> pause -> summary -> pause -> card1(4 sentences: headline/price/stats/platform) -> pause -> card2…
  const timeline: TestUnit[] = [speak(5), pause(450), speak(30), pause(450), speak(40), speak(20), speak(25), speak(20), pause(450), speak(40)];
  // No-drift baseline positions (currentPosMs == what the pure estimate would say for that index) —
  // reproduces the exact numbers the tests pinned before the real-anchor fix, since anchoring at
  // (index, its own no-drift estimate) is mathematically identical to the old absolute-from-0 timeline.
  const noDriftPos = (idx: number) => { let acc = 0; for (let i = 0; i < idx; i++) acc += estimateUnitMsReplica(timeline[i], 1.3); return acc; };

  check('seeking +15s from the very start clamps to the LAST real unit, not past the end of the reading', seekTargetIndexReplica(timeline, 0, 0, 1.3, 15000) === 9);
  check('a modest forward seek lands on the correct real unit a few sentences ahead — real unit-boundary movement, not an arbitrary/fabricated jump', seekTargetIndexReplica(timeline, 0, 0, 1.3, 3000) === 4);
  check('seeking -15s from mid-reading clamps to unit 0, never negative', seekTargetIndexReplica(timeline, 6, noDriftPos(6), 1.3, -15000) === 0);
  check('a seek that estimates into the middle of a SILENCE gap snaps FORWARD to the next real speak unit — never lands on dead air', seekTargetIndexReplica(timeline, 2, noDriftPos(2), 1.3, 1700) === 4);
  // ── ROOT-CAUSE REGRESSION (found live, 2026-08-22): with the OLD absolute-from-unit-0 timeline, a
  //    forward seek could land BEHIND where real playback already was, once real elapsed had drifted
  //    ahead of the estimate — confirmed live (real 85s vs. the old estimate's 46s for the same unit;
  //    a "+15s" seek from 46s landed at 61s, behind the real 85s it started from). Simulate the same
  //    shape here: anchor at unit 4 with a real position FAR ahead of what the estimate would predict
  //    for unit 4 (drifted), and prove a forward seek can never move to an EARLIER real position, nor
  //    a backward seek to a LATER one — the fix (anchoring at the real position) holds regardless of
  //    how far the estimate has drifted. ─────────────────────────────────────────────────────────────
  {
    const driftedPos = noDriftPos(4) + 50000; // real elapsed is 50s further along than the estimate thinks
    const fwdIdx = seekTargetIndexReplica(timeline, 4, driftedPos, 1.3, 15000);
    const fwdStarts = relativeStartsMsReplica(timeline, 4, driftedPos, 1.3);
    const bwdIdx = seekTargetIndexReplica(timeline, 4, driftedPos, 1.3, -15000);
    const bwdStarts = relativeStartsMsReplica(timeline, 4, driftedPos, 1.3);
    check('forward seek from a DRIFTED real position never lands at an earlier real time than where playback already was (the exact live bug: +15s landed BEHIND the real position)', fwdStarts[fwdIdx] >= driftedPos);
    check('forward seek from a drifted position moves the unit index forward (or stays, at the end) — never backward', fwdIdx >= 4);
    check('backward seek from a drifted real position never lands at a LATER real time than where playback already was', bwdStarts[bwdIdx] <= driftedPos);
    check('the anchor unit itself always keeps exactly the real position passed in, regardless of drift (relativeStartsMs never re-derives "now" from the estimate)', relativeStartsMsReplica(timeline, 4, driftedPos, 1.3)[4] === driftedPos);
  }
  // A faster rate (1.3) makes each unit's ESTIMATED duration shorter, so the same 3000ms delta covers
  // MORE units (reaches an equal-or-higher index) than the slower 0.8x rate — confirms the estimate
  // actually reacts to the current speed, not a rate-blind fixed unit-count skip.
  check('a faster rate reaches an equal-or-later unit than a slower rate for the identical seek delta (the estimate reacts to current speed)', seekTargetIndexReplica(timeline, 0, 0, 1.3, 3000) >= seekTargetIndexReplica(timeline, 0, 0, 0.8, 3000) && seekTargetIndexReplica(timeline, 0, 0, 1.3, 3000) === 4 && seekTargetIndexReplica(timeline, 0, 0, 0.8, 3000) === 2);
}

console.log(failed === 0 ? '\n✓ read-aloud contract holds — native/OS TTS only, $0 at any volume' : `\n✗ ${failed} assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
