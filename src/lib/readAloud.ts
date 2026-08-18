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
// A touch slower than the engine's own default (1.0) reads calmer and less clipped — the cheapest,
// still-$0 lever on how "robotic" the built-in voice sounds (owner feedback 2026-08-19). Pitch is
// left at the engine default: pushing it further tends toward uncanny rather than more natural.
const SPEECH_RATE = 0.92;

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

// Speak `text` (always Arabic) as `id` (pass the message id a caller already has — e.g. the
// results/agent message id FeedbackRow is keyed by). Must be called from a user-gesture handler
// (onPress) — iOS Safari silently drops speak() calls made any other way, so this module cannot
// self-trigger even if it wanted to; there's no queue/timer path in here that could fire one on its
// own, and the voice lookup above is pre-resolved rather than awaited here for the same reason.
export function speakReadAloud(id: string, text: string) {
  stopReadAloud();
  const trimmed = text.trim();
  if (!trimmed) return;
  setCurrent(id);
  const parts = splitIntoChunks(trimmed);
  let i = 0;
  const speakNext = () => {
    if (currentId !== id) return; // superseded by a stop() or another speakReadAloud() meanwhile
    if (i >= parts.length) { setCurrent(null); return; }
    const part = parts[i++];
    Speech.speak(part, {
      language: AR_LANG,
      rate: SPEECH_RATE,
      ...(bestArabicVoice ? { voice: bestArabicVoice.identifier } : {}),
      onDone: speakNext,
      onStopped: () => { if (currentId === id) setCurrent(null); },
      // No paid fallback on error (owner requirement) — if the device has no matching voice, the
      // OS/browser either substitutes its default voice or no-ops; either way we just stop cleanly.
      onError: () => { if (currentId === id) setCurrent(null); },
    });
  };
  speakNext();
}
