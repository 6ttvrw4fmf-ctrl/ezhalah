// Read Aloud — 100% free, native/OS text-to-speech ONLY (owner P0, 2026-08-18; Arabic-only +
// voice tuning, 2026-08-19). Uses expo-speech, which wraps window.speechSynthesis on web and the
// OS's own TTS (AVSpeechSynthesizer on iOS, android.speech.tts.TextToSpeech on Android) on native —
// never a paid API, never a network call Ezhalah is billed for, at any volume.
// scripts/verify-read-aloud-contract.ts is the permanent, machine-enforced barrier that this file
// (and its callers) never grows a paid-provider import.
//
// ARABIC ONLY (owner 2026-08-19): every utterance speaks as ar-SA — no English branch. Ezhalah's AI
// replies are Arabic-canonical by design (locations, results, everything are shown in Arabic; a
// stray English reply is not a case worth a second code path for), so this is a real simplification,
// not a lost capability.
//
// Single-speaker by construction: speak() always stops whatever is currently playing FIRST, so
// there is never a queue to manage and never two utterances overlapping. Never autoplays — every
// caller must be a user-gesture handler (onPress); this module never calls speak() on its own.
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

// VOICE QUALITY (owner feedback 2026-08-19 — "sounds robotic"): most platforms register more than
// one voice per language, and expo-speech surfaces a first-class Enhanced/Default quality tier — an
// Enhanced Arabic voice sounds noticeably less robotic than the Default compact one, and costs
// nothing extra (it's a free OS voice, just not always the one the engine defaults to). Resolved
// ONCE and cached, never awaited inside speakReadAloud(): iOS Safari silently drops speak() unless
// it runs SYNCHRONOUSLY inside the user's tap, so this module prefetches voices in the background as
// soon as it loads and simply uses whatever's cached by the time the user actually taps — falling
// back to a bare language-only request (still correct, just not voice-pinned) on a very first, cold
// tap before that prefetch has resolved.
let bestArabicVoice: Voice | null | undefined; // undefined = not resolved yet, null = none found
function pickBestArabic(voices: Voice[]): Voice | null {
  const arabic = voices.filter((v) => v.language?.toLowerCase().startsWith('ar'));
  if (!arabic.length) return null;
  return arabic.find((v) => v.quality === VoiceQuality.Enhanced) ?? arabic[0];
}
void Speech.getAvailableVoicesAsync()
  .then((voices) => { bestArabicVoice = pickBestArabic(voices); })
  .catch(() => { bestArabicVoice = null; });

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
// cannot self-trigger even if it wanted to; there's no queue/timer path in here that could fire one
// on its own, and the voice lookup above is pre-resolved rather than awaited here for the same
// reason. A pending inter-segment pause from a PREVIOUS call is harmless if it fires after a stop()
// or a newer speakReadAloud() — the `currentId` check below turns it into a no-op.
export function speakReadAloud(id: string, segments: ReadAloudSegment[]) {
  stopReadAloud();
  const units = buildUnits(segments);
  if (!units.length) return;
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
      ...(bestArabicVoice ? { voice: bestArabicVoice.identifier } : {}),
      onDone: advance,
      onStopped: () => { if (currentId === id) setCurrent(null); },
      // No paid fallback on error (owner requirement) — if the device has no matching voice, the
      // OS/browser either substitutes its default voice or no-ops; either way we just stop cleanly.
      onError: () => { if (currentId === id) setCurrent(null); },
    });
  };
  advance();
}
