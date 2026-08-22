// Read Aloud — 100% free, native/OS text-to-speech ONLY (owner P0, 2026-08-18; Arabic-only +
// voice tuning, 2026-08-19; voice-selection root-cause fix, 2026-08-22). Uses expo-speech, which
// wraps window.speechSynthesis on web and the OS's own TTS (AVSpeechSynthesizer on iOS,
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
const SPEECH_RATE = 1.3;

// VOICE RESOLUTION (rewritten 2026-08-22 — see the file-header root-cause note). Three real states,
// not a boolean: `bestArabicVoice` is the confirmed match the moment one is found (read directly by
// speakReadAloud — this is the ONLY thing that gates whether we ever speak); `voiceCheckExhausted`
// only matters for distinguishing "still checking" from "genuinely none" when nothing has been found
// yet (both cases refuse to speak, per the root-cause fix, but only the exhausted one is worth
// treating as a stable "unavailable" rather than "try again in a moment").
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
// forever — it just correctly falls through to "no Arabic voice found" after the last attempt. Total
// worst case ~3s, and every real user reaches the Read Aloud button well after that (a search itself
// takes at least a second or two) — this resolves LONG before any real tap in practice.
const POLL_TIMEOUTS_MS = [120, 250, 500, 900, 1200];
function getVoicesOnce(timeoutMs: number): Promise<Voice[]> {
  return Promise.race([
    Speech.getAvailableVoicesAsync().catch(() => [] as Voice[]),
    new Promise<Voice[]>((resolve) => setTimeout(() => resolve([]), timeoutMs)),
  ]);
}
async function resolveVoice() {
  for (const timeout of POLL_TIMEOUTS_MS) {
    const found = pickBestArabic(await getVoicesOnce(timeout));
    if (found) { bestArabicVoice = found; return; }
  }
  voiceCheckExhausted = true;
}
void resolveVoice();

let currentId: string | null = null;
const listeners = new Set<(id: string | null) => void>();
function setCurrent(id: string | null) {
  currentId = id;
  for (const l of listeners) l(id);
}

// Subscribe to "which message id is speaking right now" (null = nothing). Returns an unsubscribe
// function. This is the ONLY cross-component state Read Aloud needs — every button derives its own
// `isSpeaking = id === speakingId` from it, so "only one response speaks, starting another stops
// the previous one" falls out of the single shared `currentId` rather than needing a queue/manager.
export function subscribeReadAloud(cb: (id: string | null) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function stopReadAloud() {
  void Speech.stop();
  if (currentId !== null) setCurrent(null);
}

// Chrome (Windows/Linux) has a long-standing bug where a single speak() call on text longer than
// ~15s of speech silently stalls (Chromium issue 41294170, still open). The documented workaround
// is to split into shorter utterances and chain them off each one's completion — harmless on every
// other platform, so it's applied unconditionally rather than browser-sniffed.
function splitIntoChunks(text: string): string[] {
  const parts = text.split(/(?<=[.!?؟۔])\s+/).map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts : [text.trim()];
}

// One spoken block, with an optional silent gap AFTER it — e.g. {text:'إزهله', pauseAfterMs:450}
// reads the word then leaves a short natural pause before the next segment starts. There's no SSML
// <break> in the Web Speech API (or expo-speech), so a pause is just a real setTimeout gap between
// utterances — the standard workaround (owner structure requirement, 2026-08-19: إزهله → pause →
// summary → pause → cards in order).
export type ReadAloudSegment = { text: string; pauseAfterMs?: number };

type Unit = { kind: 'speak'; text: string } | { kind: 'pause'; ms: number };

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

// Speak `segments` in order (always Arabic) as `id` (pass the message id a caller already has —
// e.g. the results/agent message id FeedbackRow is keyed by). Must be called from a user-gesture
// handler (onPress) — iOS Safari silently drops speak() calls made any other way, so this module
// cannot self-trigger even if it wanted to; the voice lookup above is pre-resolved rather than
// awaited here for the same reason. A pending inter-segment pause from a PREVIOUS call is harmless if
// it fires after a stop() or a newer speakReadAloud() — the `currentId` check below turns it into a
// no-op.
//
// Returns true if it actually started speaking, false if it refused (no confirmed Arabic voice —
// root-cause fix, 2026-08-22: NEVER hand Arabic text to a non-Arabic voice; the caller shows a
// graceful Arabic "not available" message instead, per owner requirement). This can only return
// false on a device/browser with genuinely no Arabic voice, or in the (rare in practice — polling
// above resolves in ~1s typically, well before a real tap) window before voice resolution settles.
export function speakReadAloud(id: string, segments: ReadAloudSegment[]): boolean {
  stopReadAloud();
  if (!bestArabicVoice) return false; // never fall back to the browser/OS default (English) voice
  const units = buildUnits(segments);
  if (!units.length) return false;
  setCurrent(id);
  let i = 0;
  const advance = () => {
    if (currentId !== id) return; // superseded by a stop() or another speakReadAloud() meanwhile
    if (i >= units.length) { setCurrent(null); return; }
    const unit = units[i++];
    if (unit.kind === 'pause') { setTimeout(advance, unit.ms); return; }
    Speech.speak(unit.text, {
      language: AR_LANG,
      rate: SPEECH_RATE,
      voice: bestArabicVoice!.identifier,
      onDone: advance,
      onStopped: () => { if (currentId === id) setCurrent(null); },
      // No paid fallback on error (owner requirement) — an error here means the OS/browser itself
      // failed to play the already-confirmed Arabic voice; we just stop cleanly, never substitute a
      // different (non-Arabic) voice or provider.
      onError: () => { if (currentId === id) setCurrent(null); },
    });
  };
  advance();
  return true;
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
