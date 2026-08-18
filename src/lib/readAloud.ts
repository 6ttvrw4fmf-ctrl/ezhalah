// Read Aloud — 100% free, native/OS text-to-speech ONLY (owner P0, 2026-08-18). Uses expo-speech,
// which wraps window.speechSynthesis on web and the OS's own TTS (AVSpeechSynthesizer on iOS,
// android.speech.tts.TextToSpeech on Android) on native — never a paid API, never a network call
// Ezhalah is billed for, at any volume. scripts/verify-read-aloud-contract.ts is the permanent,
// machine-enforced barrier that this file (and its callers) never grows a paid-provider import.
//
// Single-speaker by construction: speak() always stops whatever is currently playing FIRST, so
// there is never a queue to manage and never two utterances overlapping. Never autoplays — every
// caller must be a user-gesture handler (onPress); this module never calls speak() on its own.
import * as Speech from 'expo-speech';
import { msgRTL } from './textDirection';

export type ReadAloudLang = 'ar-SA' | 'en-US';

// The utterance language IS the same detection the bubble's own RTL layout already uses — one
// definition, so a reply can never be laid out as Arabic yet spoken as English or vice versa.
export function readAloudLang(text: string): ReadAloudLang {
  return msgRTL(text) ? 'ar-SA' : 'en-US';
}

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

// Speak `text` as `id` (pass the message id a caller already has — e.g. the results/agent message
// id FeedbackRow is keyed by). Must be called from a user-gesture handler (onPress) — iOS Safari
// silently drops speak() calls made any other way, so this module cannot self-trigger even if it
// wanted to; there's no queue/timer path in here that could fire one on its own.
export function speakReadAloud(id: string, text: string, lang: ReadAloudLang) {
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
      language: lang,
      onDone: speakNext,
      onStopped: () => { if (currentId === id) setCurrent(null); },
      // No paid fallback on error (owner requirement) — if the device has no matching voice, the
      // OS/browser either substitutes its default voice or no-ops; either way we just stop cleanly.
      onError: () => { if (currentId === id) setCurrent(null); },
    });
  };
  speakNext();
}
