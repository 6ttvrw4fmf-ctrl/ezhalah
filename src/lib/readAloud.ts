// Read Aloud — 100% free, native/OS text-to-speech ONLY (owner P0, 2026-08-18; Arabic-only +
// voice tuning, 2026-08-19; voice-selection root-cause fix, 2026-08-22; floating playback
// controller — pause/resume/seek/speed, 2026-08-22). Uses expo-speech, which wraps
// window.speechSynthesis on web and the OS's own TTS (AVSpeechSynthesizer on iOS,
// android.speech.tts.TextToSpeech on Android) on native — never a paid API, never a network call
// Ezhalah is billed for, at any volume.
// scripts/verify-read-aloud-contract.ts is the permanent, machine-enforced barrier that this file
// (and its callers) never grows a paid-provider import.
//
// ARABIC ONLY (owner 2026-08-19): every utterance speaks as ar-SA — no English branch. Ezhalah's AI
// replies are Arabic-canonical by design (locations, results, everything are shown in Arabic; a
// stray English reply is not a case worth a second code path for), so this is a real simplification,
// not a lost capability.
//
// ROOT CAUSE OF "sounds English / robotic" (owner report, 2026-08-22 — reproduced live against
// production): SpeechSynthesisUtterance.lang is only a HINT on the Web Speech API — Chrome (and most
// engines) do NOT search for a lang-matching voice when .voice is left unset; they use the browser's
// SYSTEM DEFAULT voice instead, silently, regardless of .lang. Confirmed live: this Mac's Chrome
// default voice was Apple's "Samantha" — US English. The OLD code fell into exactly this trap whenever
// bestArabicVoice was still `undefined` (unresolved — voiceschanged is genuinely unreliable on some
// engines) OR `null` (device has no Arabic voice at all, e.g. a stock Windows/Android install with
// no Arabic language pack): it still called Speech.speak() with only `language: AR_LANG` set, no
// `.voice` — an ENGLISH voice reading Arabic text, which sounds exactly like the reported "English
// robot." Fix: (1) resolve the voice via a short bounded POLL, not a single voiceschanged await —
// far more reliable across browsers/engines; (2) NEVER call Speech.speak() without an explicitly
// resolved matching voice — if genuinely none exists after polling, fail gracefully (see
// speakReadAloud's return value) instead of ever handing Arabic text to a non-Arabic voice.
import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { VoiceQuality, type Voice } from 'expo-speech';

const AR_LANG = 'ar-SA';
// CHATGPT-LIKE PACING (owner 2026-08-19 — "don't assume slower is correct, compare against
// ChatGPT and test a few real responses"). Measured, not guessed: timed the actual "Majed" voice at
// several rates via real onstart/onend playback (browser Console, this session) against Standard
// Arabic's documented natural rate (~4.5 syllables/second — Aldholmi et al., Interspeech 2021). The
// PREVIOUS value here (0.92, picked to sound "less clipped") was measured at only ~3.2-3.75 syll/s —
// SLOWER than natural speech, not faster; slowing it further was the wrong direction. 1.3 measured
// closest to the natural-pace benchmark (~4.2-4.8 syll/s depending on syllable-count assumptions) —
// also broadly consistent with ChatGPT voice mode's own default pace, which targets natural
// conversational speed rather than an artificially slowed reading voice. Pitch is left at the engine
// default: pushing it further tends toward uncanny rather than more natural.
const DEFAULT_RATE = 1.3;
// Speed-control steps (owner 2026-08-22: "cycle through 0.8x → 1x → 1.2x → 1.3x"; extended
// 2026-08-23 — owner: "let the user make the speed faster"). The label IS the real
// SpeechSynthesisUtterance.rate multiplier, not a separately-normalized "feel" scale — the Web
// Speech API's `rate` is already defined as a multiplier of the voice's own default pace, so "1.3x"
// on screen already means exactly what it says. 1.3 stays the DEFAULT a fresh reading starts at
// (it's the measured natural-pace value — see DEFAULT_RATE above); these extra faster steps are an
// explicit user choice via the speed chip, not a change to what a first-time listener hears.
export const RATE_STEPS = [0.8, 1, 1.2, 1.3, 1.5, 1.75, 2] as const;

// VOICE RESOLUTION (rewritten 2026-08-22 — see the file-header root-cause note). Three real states,
// not a boolean: `bestArabicVoice` is the confirmed match the moment one is found (read directly by
// speakReadAloud — this is the ONLY thing that gates whether we ever speak); `voiceCheckExhausted`
// only matters for distinguishing "still checking" from "genuinely none" when nothing has been found
// yet (both cases refuse to speak, per the root-cause fix, but only the exhausted one is worth
// treating as a stable "unavailable" rather than "try again in a moment"). UNCHANGED by the playback-
// controller work below — the controller only adds pause/resume/seek/speed around this same
// already-shipped, already-tested voice contract; it never re-decides which voice to use.
let bestArabicVoice: Voice | null = null;
let voiceCheckExhausted = false;

// Priority, exactly per owner spec: (1) exact ar-SA wins UNCONDITIONALLY, even over a local generic
// Arabic voice — the owner's own ordering names it first and explicitly ("explicitly use an Arabic
// Saudi voice where the device/browser provides one"), so exact-locale is never traded away for
// speed. (2) among voices tied on locale-exactness, prefer on-device/local over a network one — free-
// and-fast over free-but-slow, and this app should never depend on network TTS when a local
// alternative exists. (3) among those, prefer Enhanced quality when the device has it downloaded.
// (4) any Arabic voice at all beats none. Scored (weights 4/2/1) rather than chained .find()s so a
// voice strong on more than one axis (a local, Enhanced-quality, exact ar-SA voice, when a device has
// one) always wins outright, while still keeping exact-locale worth more than local+quality combined.
function pickBestArabic(voices: Voice[]): Voice | null {
  const norm = (lang?: string | null) => (lang ?? '').toLowerCase().replace('_', '-');
  const arabic = voices.filter((v) => norm(v.language).startsWith('ar'));
  if (!arabic.length) return null;
  // `localService` only exists on expo-speech's WebVoice (web platform) — absent (undefined) on
  // native, where every voice is already on-device by construction, so `!== false` scores it the
  // same as an explicit local voice there too.
  const score = (v: Voice) => {
    let s = 0;
    if (norm(v.language) === AR_LANG.toLowerCase()) s += 4; // exact ar-SA
    if ((v as { localService?: boolean }).localService !== false) s += 2; // on-device — no network round trip, never slow/flaky
    if (v.quality === VoiceQuality.Enhanced) s += 1; // higher-quality tier, when downloaded
    return s;
  };
  return [...arabic].sort((a, b) => score(b) - score(a))[0];
}

// Bounded poll, not a single voiceschanged await (owner 2026-08-22: "test the browser issue where
// getVoices() may load voices asynchronously... make sure we wait/listen for voiceschanged
// correctly"). A single await is NOT enough — voiceschanged is well-documented as unreliable across
// engines (fires late, fires more than once, or never fires at all on some WebViews); the FIRST call
// resolving with 0 voices used to permanently cache bestArabicVoice = null and never look again. Each
// attempt re-checks getAvailableVoicesAsync()'s synchronous fast path first (it returns immediately
// once the platform has actually populated its voice list, from ANY attempt, not just its own), and
// is individually timeout-bounded so an engine that never fires voiceschanged at all can't hang this
// forever.
const POLL_TIMEOUTS_MS = [120, 250, 500, 900, 1200];
function getVoicesOnce(timeoutMs: number): Promise<Voice[]> {
  return Promise.race([
    Speech.getAvailableVoicesAsync().catch(() => [] as Voice[]),
    new Promise<Voice[]>((resolve) => setTimeout(() => resolve([]), timeoutMs)),
  ]);
}
// ROOT-CAUSE FIX (owner report, 2026-08-23 — Windows Chrome: tapping the button always said "not
// available on this device"). The original fast poll gave up and set voiceCheckExhausted PERMANENTLY
// after ~3s TOTAL, measured from PAGE LOAD (resolveVoice() runs unconditionally at module import).
// But a real tap happens long after that — a full search + results cycle, routinely 10-40+ seconds
// in this app's own observed behaviour — so a platform whose voice list populates slower than macOS's
// instant local voices (e.g. Windows Chrome enumerating a remote/network voice, or a slower SAPI
// voice-list build) could have a real, usable Arabic voice arrive well AFTER the poll had already
// given up and cached failure forever. Fix: after the fast poll, keep quietly re-checking in the
// background at a slower cadence for a much longer window — one that comfortably covers a real
// search-to-tap gap — before finally giving up. Still resolves in ~1s on the common fast-path
// (macOS/most engines); this only changes how long a SLOW engine gets before being called "genuinely
// unavailable".
const BACKGROUND_RETRY_MS = 3000;
const RETRY_WINDOW_MS = 45000; // generous vs. any real page-load-to-first-tap gap observed in this app
async function resolveVoice() {
  const deadline = Date.now() + RETRY_WINDOW_MS;
  for (const timeout of POLL_TIMEOUTS_MS) {
    const found = pickBestArabic(await getVoicesOnce(timeout));
    if (found) { bestArabicVoice = found; return; }
  }
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, BACKGROUND_RETRY_MS));
    const found = pickBestArabic(await getVoicesOnce(500));
    if (found) { bestArabicVoice = found; return; }
  }
  voiceCheckExhausted = true;
}
void resolveVoice();

// On web, resolve the SAME confirmed voice (by voiceURI == expo-speech's `identifier`) back to the
// real SpeechSynthesisVoice object — needed because the playback engine below speaks via the raw Web
// Speech API on web (see WEB PAUSE/RESUME BUG note), which needs an actual voice object, not a
// string id. Voice SELECTION itself is untouched: this only re-looks-up the exact voice
// pickBestArabic already chose.
function resolveWebVoiceObject(): SpeechSynthesisVoice | null {
  if (!bestArabicVoice || typeof window === 'undefined' || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.voiceURI === bestArabicVoice!.identifier) ?? null;
}

// One spoken block, with an optional silent gap AFTER it — e.g. {text:'إزهله', pauseAfterMs:450}
// reads the word then leaves a short natural pause before the next segment starts. There's no SSML
// <break> in the Web Speech API (or expo-speech), so a pause is just a real setTimeout gap between
// utterances — the standard workaround (owner structure requirement, 2026-08-19: إزهله → pause →
// summary → pause → cards in order).
export type ReadAloudSegment = { text: string; pauseAfterMs?: number };

type Unit = { kind: 'speak'; text: string } | { kind: 'pause'; ms: number };

// Chrome (Windows/Linux) has a long-standing bug where a single speak() call on text longer than
// ~15s of speech silently stalls (Chromium issue 41294170, still open). The documented workaround
// is to split into shorter utterances and chain them off each one's completion — harmless on every
// other platform, so it's applied unconditionally rather than browser-sniffed. A side benefit for the
// playback controller: sentence-level units are also the natural seek/pause granularity below.
function splitIntoChunks(text: string): string[] {
  const parts = text.split(/(?<=[.!?؟۔])\s+/).map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts : [text.trim()];
}

// Segments -> a flat ordered list of speak/pause units. Each segment's OWN text is still split on
// sentence boundaries and chained with NO gap (the Chrome-15s-bug workaround above) — the pause only
// ever sits BETWEEN segments, which is what makes it read as a structural beat, not just a breath.
function buildUnits(segments: ReadAloudSegment[]): Unit[] {
  const units: Unit[] = [];
  for (const seg of segments) {
    const trimmed = seg.text.trim();
    if (!trimmed) continue;
    for (const chunk of splitIntoChunks(trimmed)) units.push({ kind: 'speak', text: chunk });
    if (seg.pauseAfterMs) units.push({ kind: 'pause', ms: seg.pauseAfterMs });
  }
  return units;
}

// ── PLAYBACK ENGINE (owner 2026-08-22 — floating controller: pause/resume/seek ±15s/speed). ────────
//
// WEB PAUSE/RESUME BUG (found reading node_modules/expo-speech/build/ExponentSpeech.web.js while
// implementing this): expo-speech's web shim wires every utterance's native `onpause` event to emit
// its OWN `'Exponent.speakingStopped'` event — the exact same event a hard stop/cancel emits — AND
// deletes that utterance's callback registration when it fires. That means routing pause through
// `Speech.pause()` would (a) fire our onStopped handler as if the user had tapped Stop, resetting all
// UI state the instant they tap Pause, and (b) permanently break the onDone chain for that utterance,
// since the shim can never deliver a real completion event for an id it already deleted — so a
// subsequent resume() would appear to work but silently never advance to the next unit. Native iOS's
// pause()/resume() (SpeechModule.swift) have no such remapping and are safe to use as-is. So: on web,
// speak/pause/resume/cancel go straight to window.speechSynthesis (bypassing expo-speech's Speech.*
// entirely for playback, while still using expo-speech's getAvailableVoicesAsync() for voice
// resolution above — that path has no such bug). On iOS, keep using Speech.pause()/resume() directly.
// Android's expo-speech module implements neither (confirmed reading its Kotlin source — no
// pause/resume at all, and the JS docs say so too) — pausing there restarts the CURRENT unit only
// (never the whole reading) rather than throwing or silently doing nothing.
function isWeb() { return Platform.OS === 'web'; }
function isAndroid() { return Platform.OS === 'android'; }

export type PlaybackState = 'idle' | 'playing' | 'paused';
export type ReadAloudSnapshot = {
  id: string | null;
  state: PlaybackState;
  elapsedMs: number;
  rate: number;
  canSeekBack: boolean;
  canSeekForward: boolean;
};

let sessionId: string | null = null;
let sessionUnits: Unit[] = [];
let unitIndex = 0;
let rate: number = DEFAULT_RATE;
let state: PlaybackState = 'idle';
// A monotonically increasing token. Bumped only when we CANCEL an in-flight utterance out from under
// its own onDone/onError (seek, speed change, stop) — a real pause never bumps it, since we expect
// that SAME utterance's completion to still be valid once resumed. Every completion callback closes
// over the token it was issued with and no-ops if it no longer matches, so a cancelled utterance's
// late-arriving browser event can never advance the queue or end the session out of turn.
let playToken = 0;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let inSilence = false;
let silenceRemainingMs = 0;
let silenceStartedAtMs = 0;
// Set only when a seek/jump lands while PAUSED: there is nothing left for the OS to resume (the
// in-flight utterance was cancelled to jump), so the next resume must START a fresh utterance at the
// new position instead of calling the platform's resume().
let pendingRestart = false;

let elapsedMs = 0;
let tickHandle: ReturnType<typeof setInterval> | null = null;
let lastTickAtMs = 0;

const idListeners = new Set<(id: string | null) => void>();
const playbackListeners = new Set<(snapshot: ReadAloudSnapshot) => void>();

function snapshot(): ReadAloudSnapshot {
  return {
    id: sessionId,
    state,
    elapsedMs: Math.round(elapsedMs),
    rate,
    canSeekBack: state !== 'idle' && unitIndex > 0,
    canSeekForward: state !== 'idle' && unitIndex < sessionUnits.length - 1,
  };
}
function notifyId() { for (const l of idListeners) l(sessionId); }
function notifyPlayback() { const s = snapshot(); for (const l of playbackListeners) l(s); }

// Subscribe to "which message id is speaking right now" (null = nothing). Returns an unsubscribe
// function. UNCHANGED contract (FeedbackRow's own 🔊/⏹ button still just starts/stops, exactly as
// before the floating controller existed) — every button derives its own `isSpeaking = id ===
// speakingId` from it, so "only one response speaks, starting another stops the previous one" falls
// out of the single shared `sessionId` rather than needing a queue/manager.
export function subscribeReadAloud(cb: (id: string | null) => void): () => void {
  idListeners.add(cb);
  return () => { idListeners.delete(cb); };
}

// Richer subscription for the floating playback controller (state/elapsed/rate/seek-availability).
// Fires immediately with the current snapshot on subscribe, so a controller mounting mid-session
// (e.g. after a fast remount) never has to wait for the next state change to render correctly.
export function subscribeReadAloudPlayback(cb: (snapshot: ReadAloudSnapshot) => void): () => void {
  playbackListeners.add(cb);
  cb(snapshot());
  return () => { playbackListeners.delete(cb); };
}

function startTicking() {
  stopTicking();
  lastTickAtMs = Date.now();
  tickHandle = setInterval(() => {
    const now = Date.now();
    elapsedMs += now - lastTickAtMs;
    lastTickAtMs = now;
    notifyPlayback();
  }, 250);
}
function stopTicking() {
  if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
}

function clearPendingTimer() {
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
}

function cancelSpeaking() {
  if (isWeb()) { window.speechSynthesis.cancel(); }
  else { void Speech.stop(); }
}
function pauseSpeakingNow() {
  if (isWeb()) { window.speechSynthesis.pause(); }
  else { void Speech.pause(); } // iOS only — callers gate isAndroid() before reaching here
}
function resumeSpeakingNow() {
  if (isWeb()) { window.speechSynthesis.resume(); }
  else { void Speech.resume(); } // iOS only
}

// Speaks ONE unit's text and reports completion via onDone/onError, tagged with `token` so a
// cancelled/superseded call can never fire the CURRENT queue's callbacks (see `playToken` above).
function speakUnitText(text: string, token: number, onDone: () => void, onError: () => void) {
  if (isWeb()) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = AR_LANG;
    utterance.rate = rate;
    const voice = resolveWebVoiceObject();
    if (voice) utterance.voice = voice;
    utterance.onend = () => { if (token === playToken) onDone(); };
    utterance.onerror = () => { if (token === playToken) onError(); };
    window.speechSynthesis.speak(utterance);
    return;
  }
  Speech.speak(text, {
    language: AR_LANG,
    rate,
    voice: bestArabicVoice!.identifier,
    onDone: () => { if (token === playToken) onDone(); },
    onStopped: () => { if (token === playToken) onError(); },
    // No paid fallback on error (owner requirement) — an error here means the OS/browser itself
    // failed to play the already-confirmed Arabic voice; we just stop cleanly, never substitute a
    // different (non-Arabic) voice or provider.
    onError: () => { if (token === playToken) onError(); },
  });
}

function finishSession() {
  clearPendingTimer();
  stopTicking();
  state = 'idle';
  sessionId = null;
  sessionUnits = [];
  unitIndex = 0;
  inSilence = false;
  pendingRestart = false;
  notifyId();
  notifyPlayback();
}

function playCurrentUnit() {
  if (unitIndex >= sessionUnits.length) { finishSession(); return; }
  const unit = sessionUnits[unitIndex];
  const token = playToken;
  if (unit.kind === 'pause') {
    inSilence = true;
    silenceRemainingMs = unit.ms;
    silenceStartedAtMs = Date.now();
    pendingTimer = setTimeout(() => {
      if (token !== playToken) return;
      inSilence = false;
      unitIndex++;
      playCurrentUnit();
    }, unit.ms);
    return;
  }
  inSilence = false;
  speakUnitText(
    unit.text,
    token,
    () => {
      // Real WebKit/iOS Safari bug (documented, several versions): speechSynthesis.pause() can be a
      // silent no-op — audio just keeps playing. If that happens, this utterance finishes NATURALLY
      // while `state` is still 'paused'. Auto-advancing here would speak straight through the pause
      // (the exact "it doesn't work" shape) — instead, land ready to resume from the NEXT unit and
      // stay silent until the user actually taps resume.
      unitIndex++;
      if (state !== 'playing') { pendingRestart = true; return; }
      playCurrentUnit();
    },
    () => finishSession(),
  );
}

export function stopReadAloud() {
  playToken++; // invalidate any in-flight callback before cancelling
  clearPendingTimer();
  cancelSpeaking();
  stopTicking();
  const wasActive = sessionId !== null || state !== 'idle';
  sessionId = null;
  sessionUnits = [];
  unitIndex = 0;
  inSilence = false;
  pendingRestart = false;
  state = 'idle';
  if (wasActive) { notifyId(); notifyPlayback(); }
}

// Speak `segments` in order (always Arabic) as `id` (pass the message id a caller already has —
// e.g. the results/agent message id FeedbackRow is keyed by). Must be called from a user-gesture
// handler (onPress) — iOS Safari silently drops speak() calls made any other way, so this module
// cannot self-trigger even if it wanted to; the voice lookup above is pre-resolved rather than
// awaited here for the same reason.
//
// Returns true if it actually started speaking, false if it refused (no confirmed Arabic voice —
// root-cause fix, 2026-08-22: NEVER hand Arabic text to a non-Arabic voice; the caller shows a
// graceful Arabic "not available" message instead, per owner requirement). This can only return
// false on a device/browser with genuinely no Arabic voice, or in the (rare in practice — polling
// above resolves in ~1s typically, well before a real tap) window before voice resolution settles.
//
// `rate` deliberately is NOT reset here — the user's last chosen speed (see cycleReadAloudRate)
// carries over into the next response, same as a real player remembering your speed preference.
export function speakReadAloud(id: string, segments: ReadAloudSegment[]): boolean {
  stopReadAloud();
  if (!bestArabicVoice) return false; // never fall back to the browser/OS default (English) voice
  const units = buildUnits(segments);
  if (!units.length) return false;
  sessionId = id;
  sessionUnits = units;
  unitIndex = 0;
  elapsedMs = 0;
  state = 'playing';
  notifyId();
  startTicking();
  playCurrentUnit();
  notifyPlayback();
  return true;
}

// iOS Safari has a real, long-documented WebKit bug where speechSynthesis.pause() silently no-ops —
// it returns normally, `speechSynthesis.paused` never becomes true, and audio just keeps playing.
// Trusting pause() blindly there would make "Pause" visibly do nothing — plausibly exactly what "the
// voice thing doesn't work" describes on an iPhone. Rather than assume it worked, verify shortly
// after and fall back to cancel+restart (the same safe primitive Android already uses, since Android
// has no pause API at all) if the engine ignored it.
const WEB_PAUSE_VERIFY_MS = 120;

// Pause in place. TRUE pause on web and iOS when the engine actually honours it (the OS/engine
// freezes the actual audio mid-utterance — see the WEB PAUSE/RESUME BUG note above for why web
// bypasses expo-speech to get this correctly). Falls back to cancel+restart-current-unit — same as
// Android, which has no pause API at all — whenever the engine doesn't actually hold (iOS Safari,
// or a natural completion race): never a silent no-op, and never a fake "paused" state that isn't
// actually holding anything.
export function pauseReadAloud() {
  if (state !== 'playing') return;
  state = 'paused';
  stopTicking();
  if (inSilence) {
    clearPendingTimer();
    silenceRemainingMs = Math.max(0, silenceRemainingMs - (Date.now() - silenceStartedAtMs));
  } else if (isAndroid()) {
    playToken++; // no true pause available — cancel; resume restarts this same unit from its start
    cancelSpeaking();
    pendingRestart = true;
  } else {
    const tokenAtPause = playToken;
    pauseSpeakingNow();
    if (isWeb()) {
      setTimeout(() => {
        // Still the same pause attempt and still meant to be paused, but the engine silently ignored
        // pause() (the iOS Safari bug this exists for) — force it the same way Android always does.
        if (state === 'paused' && playToken === tokenAtPause && !window.speechSynthesis.paused) {
          playToken++;
          cancelSpeaking();
          pendingRestart = true;
          notifyPlayback();
        }
      }, WEB_PAUSE_VERIFY_MS);
    }
  }
  notifyPlayback();
}

export function resumeReadAloud() {
  if (state !== 'paused') return;
  state = 'playing';
  startTicking();
  if (pendingRestart) {
    pendingRestart = false;
    playCurrentUnit();
  } else if (inSilence) {
    const token = playToken;
    silenceStartedAtMs = Date.now();
    pendingTimer = setTimeout(() => {
      if (token !== playToken) return;
      inSilence = false;
      unitIndex++;
      playCurrentUnit();
    }, silenceRemainingMs);
  } else {
    resumeSpeakingNow();
  }
  notifyPlayback();
}

// ESTIMATE-BASED SEEK (owner 2026-08-22 — "do NOT fake seeking... investigate the cleanest truthful
// implementation"). Native TTS is not an audio file: there is no scrubbable timeline, and the Web
// Speech API cannot resume an utterance from an arbitrary mid-point without re-synthesizing from a
// text offset (which would mean re-picking a voice mid-utterance — a real risk to the voice contract
// this file exists to protect). The honest, contract-safe implementation: ±15s jumps along an
// ESTIMATED per-unit timeline (unit length in characters ÷ an assumed reading speed, scaled by the
// current rate) to the START of the nearest not-yet-finished unit — real inter-sentence granularity,
// not a fabricated audio position.
// ESTIMATED_CHARS_PER_SEC_AT_RATE_1 is a documented estimate, not a live measurement — this session
// has no infrastructure to time individual utterances in production; it's derived from the ~60s/
// 5-card measurement already on file at rate 1.3 (see DEFAULT_RATE above) and standard TTS reading
// speed ballparks. Refine with real onstart/onend timing if seek ever feels meaningfully off.
const ESTIMATED_CHARS_PER_SEC_AT_RATE_1 = 14;
function estimateUnitMs(unit: Unit, atRate: number): number {
  if (unit.kind === 'pause') return unit.ms; // exact — a scheduled silence, not an estimate
  return (unit.text.length / (ESTIMATED_CHARS_PER_SEC_AT_RATE_1 * atRate)) * 1000;
}
// ROOT-CAUSE FIX (found live, 2026-08-22, testing the controller right after it shipped): a forward
// seek made the displayed time jump BACKWARD. Cause: the original version built one ABSOLUTE
// timeline from unit 0 using ONLY estimates, then re-anchored `elapsedMs` (which is REAL wall-clock
// during normal playback) to that absolute estimate on every seek. Real playback at this measured
// rate runs meaningfully slower than the 14-chars/sec estimate, so by several units in, real elapsed
// (e.g. 85s) had drifted far ahead of what the absolute estimate thought that unit's start was (e.g.
// 46s) — seeking "+15s" from the ESTIMATE (46+15=61s) landed BEHIND where real playback already was.
// Fix: anchor the timeline at the REAL current position (`elapsedMs`, exactly where we are — never an
// estimate) and use the character-count estimate only for the RELATIVE distance to NEIGHBOURING units
// forward/backward from right now. Estimation error can now only affect "how many units is 15
// estimated seconds," never "what does now mean" — so the displayed time can no longer run backward
// on a forward seek, or vice versa, however far a long reading has drifted from the estimate.
function relativeStartsMs(fromIndex: number, fromPosMs: number, atRate: number): number[] {
  const starts: number[] = new Array(sessionUnits.length);
  starts[fromIndex] = fromPosMs;
  let acc = fromPosMs;
  for (let i = fromIndex + 1; i < sessionUnits.length; i++) { acc += estimateUnitMs(sessionUnits[i - 1], atRate); starts[i] = acc; }
  acc = fromPosMs;
  for (let i = fromIndex - 1; i >= 0; i--) { acc -= estimateUnitMs(sessionUnits[i], atRate); starts[i] = Math.max(0, acc); }
  return starts;
}

function jumpTo(targetIndex: number, anchorElapsedMs: number) {
  playToken++; // cancel whatever is in flight — its callback must not fire for the new position
  clearPendingTimer();
  cancelSpeaking();
  inSilence = false;
  unitIndex = Math.max(0, Math.min(targetIndex, sessionUnits.length - 1));
  elapsedMs = anchorElapsedMs;
  if (state === 'playing') {
    playCurrentUnit();
  } else if (state === 'paused') {
    // Nothing left for the OS to hold (we just cancelled it) — land here but stay visibly paused;
    // resumeReadAloud() below knows to START fresh rather than call the platform's resume().
    pendingRestart = true;
  }
  notifyPlayback();
}

// deltaMs > 0 seeks forward, < 0 seeks backward (owner spec: ±15000).
export function seekReadAloud(deltaMs: number) {
  if (state === 'idle' || !sessionId || !sessionUnits.length) return;
  const currentPos = elapsedMs; // REAL current position — see relativeStartsMs's note above
  const starts = relativeStartsMs(unitIndex, currentPos, rate);
  const total = starts[starts.length - 1] + estimateUnitMs(sessionUnits[sessionUnits.length - 1], rate);
  const target = Math.max(0, Math.min(currentPos + deltaMs, total));
  let idx = 0;
  for (let i = 0; i < starts.length; i++) { if (starts[i] <= target) idx = i; else break; }
  while (idx < sessionUnits.length - 1 && sessionUnits[idx].kind === 'pause') idx++; // never land on silence
  jumpTo(idx, starts[idx] ?? total);
}

// Cycles 0.8x → 1x → 1.2x → 1.3x → 0.8x → … . The Web Speech API cannot change an in-flight
// utterance's rate — a new SpeechSynthesisUtterance must be spoken. Rate changes therefore restart
// the CURRENT unit (a single sentence, at most a few seconds) from its beginning at the new speed;
// completed units and queue position are untouched. Never touches voice selection or language.
export function cycleReadAloudRate(): number {
  const idx = RATE_STEPS.indexOf(rate as (typeof RATE_STEPS)[number]);
  rate = RATE_STEPS[(idx + 1 + RATE_STEPS.length) % RATE_STEPS.length] ?? RATE_STEPS[0];
  if (state === 'playing' && !inSilence && sessionId) {
    playToken++;
    cancelSpeaking();
    playCurrentUnit();
  }
  notifyPlayback();
  return rate;
}

// Synchronous snapshot for callers that want to show a hint before the user even taps (optional —
// FeedbackRow currently reacts to speakReadAloud's return value instead, which covers the same
// "genuinely unavailable" case without needing a second subscription).
export function isReadAloudVoiceConfirmed(): boolean {
  return !!bestArabicVoice;
}
export function isReadAloudDefinitelyUnavailable(): boolean {
  return voiceCheckExhausted && !bestArabicVoice;
}
