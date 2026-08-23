// Voice Input — 100% free, native/browser speech-to-text ONLY (owner brief, 2026-08-23: "free"
// repeated seven times — absolute). This module is the ONLY place microphone capture happens.
// It uses exactly two built-in browser APIs and nothing else:
//   1. Web Speech API SpeechRecognition (window.SpeechRecognition / webkitSpeechRecognition) for
//      the transcript — the browser/OS's own recognizer, no network service Ezhalah pays for.
//   2. getUserMedia + Web Audio AnalyserNode for the REAL live input level driving the composer's
//      waveform — actual mic amplitude, never a fake random animation (owner brief §4).
// NEVER add a paid provider (ElevenLabs, Whisper API, Google/Azure Cloud Speech, or any fetch()
// to a transcription endpoint). scripts/verify-voice-composer-contract.ts pins this permanently.
//
// ARABIC ONLY (owner clarification): the recognizer is pinned to ar-SA. No language pickers, no
// English recognition path — same contract as readAloud.ts on the output side.
//
// SEPARATE FROM READ ALOUD by design (owner brief §19): this module never imports readAloud.ts and
// readAloud.ts never imports this — voice input (user → Ezhalah) and read aloud (Ezhalah → user)
// share zero state. The caller (agent.tsx) is the single coordinator that stops one when the other
// starts, so the two can never fight over audio.
//
// LIFECYCLE SAFETY (owner brief §16/§17): one module-level session guarded by a generation token.
// Every async continuation (the permission prompt resolving, a recognizer restart, a late
// recognition event) checks its generation and no-ops if a cancel/stop/new-start superseded it —
// so "X while the permission request is resolving" tears the just-granted stream down immediately,
// and a hidden mic can never keep capturing after the UI left recording mode.
import { Platform } from 'react-native';

export type VoiceHandlers = {
  // Fired when capture could not start or died: 'denied' = mic permission refused/revoked,
  // 'unavailable' = no mic / no recognizer on this platform, 'error' = the recognizer failed in a
  // way a silent restart couldn't cover. The session is already fully torn down when this fires —
  // the caller only needs to restore its UI and show a graceful Arabic message (never the raw
  // browser error text).
  onFailure: (kind: 'denied' | 'unavailable' | 'error') => void;
};

export function isVoiceInputSupported(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const w = window as any;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition) && !!navigator.mediaDevices?.getUserMedia;
}

const AR_LANG = 'ar-SA';

// Rolling live-level history (0..1 per sample), newest last — the waveform's data source. Sampled
// on a plain interval, NOT requestAnimationFrame: rAF freezes in hidden tabs (repo lesson, PR
// #341/#346) and the level history is recording DATA, not decoration — it must keep flowing even
// when the tab is momentarily hidden. Drawing (VoiceWaveform) may use rAF; sampling never does.
const LEVEL_HISTORY_CAP = 160;
const LEVEL_SAMPLE_MS = 40;
const levelHistory: number[] = [];
export function getVoiceLevelHistory(): readonly number[] {
  return levelHistory;
}

let generation = 0;
let active = false;
let finalText = '';
let interimText = '';
let recognizer: any = null;
let stream: MediaStream | null = null;
let audioCtx: AudioContext | null = null;
let levelTimer: ReturnType<typeof setInterval> | null = null;

export function isVoiceCapturing(): boolean {
  return active;
}

// Full synchronous teardown — recognizer aborted, every mic track stopped, audio graph closed,
// sampling stopped. Idempotent; called by cancel/stop/failure and by a superseding start.
function teardown() {
  generation++; // invalidate every in-flight async continuation FIRST
  active = false;
  if (recognizer) {
    try { recognizer.onresult = recognizer.onend = recognizer.onerror = null; recognizer.abort(); } catch {}
    recognizer = null;
  }
  if (stream) {
    for (const track of stream.getTracks()) { try { track.stop(); } catch {} }
    stream = null;
  }
  if (audioCtx) { try { void audioCtx.close(); } catch {} audioCtx = null; }
  if (levelTimer) { clearInterval(levelTimer); levelTimer = null; }
  levelHistory.length = 0;
}

// Starts one capture session. Resolves true once the mic is live and the recognizer running; false
// when it could not start (onFailure already fired with the reason). Starting while a session is
// active supersedes it (the old one is discarded) — "another recording beginning" is a stop cause.
export async function startVoiceInput(handlers: VoiceHandlers): Promise<boolean> {
  teardown();
  if (!isVoiceInputSupported()) { handlers.onFailure('unavailable'); return false; }
  const gen = generation;
  finalText = '';
  interimText = '';

  // 1. The mic stream first — it owns the permission prompt, and its rejection is the ONE reliable
  //    cross-browser denial signal. The analyser hangs off this same stream.
  let mediaStream: MediaStream;
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err: any) {
    if (gen !== generation) return false; // cancelled while the prompt was up — nothing to clean
    const name = String(err?.name ?? '');
    handlers.onFailure(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
    return false;
  }
  if (gen !== generation) {
    // X was tapped while the permission prompt was resolving — the grant arrived for a session that
    // no longer exists. Stop the tracks NOW; no hidden mic survives (owner brief §17).
    for (const track of mediaStream.getTracks()) { try { track.stop(); } catch {} }
    return false;
  }
  stream = mediaStream;

  // 2. Real level sampling for the waveform: RMS of the time-domain signal, normalized to ~0..1.
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    audioCtx = new Ctx();
    // Autoplay policy: a context can be born 'suspended'; the mic tap is a real user gesture, so an
    // explicit resume always brings it up. Without this, levels honestly read 0 (flat waveform) —
    // never wrong, but needlessly degraded.
    void audioCtx!.resume?.().catch(() => {});
    const source = audioCtx!.createMediaStreamSource(mediaStream);
    const analyser = audioCtx!.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    levelTimer = setInterval(() => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const d = (buf[i] - 128) / 128; sum += d * d; }
      const rms = Math.sqrt(sum / buf.length);
      levelHistory.push(Math.min(1, rms * 3.2));
      if (levelHistory.length > LEVEL_HISTORY_CAP) levelHistory.shift();
    }, LEVEL_SAMPLE_MS);
  } catch {
    // Analyser failure is non-fatal: transcription still works; the waveform just stays near-flat
    // (an honest "no level available", never a fabricated animation).
  }

  // 3. The recognizer — Arabic only, continuous, with interim results so Send-mid-speech can
  //    finalize everything said so far.
  const Rec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const rec = new Rec();
  rec.lang = AR_LANG;
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (ev: any) => {
    if (gen !== generation) return;
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) finalText = `${finalText} ${r[0]?.transcript ?? ''}`.trim();
      else interim += r[0]?.transcript ?? '';
    }
    interimText = interim.trim();
  };
  rec.onerror = (ev: any) => {
    if (gen !== generation) return;
    const code = String(ev?.error ?? '');
    // 'no-speech'/'aborted' are routine (silence, engine hiccup) — onend's keep-alive restart
    // covers them. Silence NEVER auto-submits and never ends the session (owner brief §6).
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      teardown();
      handlers.onFailure('denied');
    }
  };
  rec.onend = () => {
    if (gen !== generation) return;
    // KEEP-ALIVE: browser recognizers end themselves after silence. The user owns the decision to
    // finish (Send / Stop / X) — so while the session is still active, quietly restart, keeping
    // every final already accumulated. This is the standard free-API pattern, not a product rule.
    try { rec.start(); } catch {
      teardown();
      handlers.onFailure('error');
    }
  };
  try { rec.start(); } catch {
    teardown();
    handlers.onFailure('unavailable');
    return false;
  }
  recognizer = rec;
  active = true;
  return true;
}

// Finish listening and return everything recognized (finals + trailing interim), fully torn down.
// Idempotent: a second call (Stop tapped twice, Stop then Send racing) returns '' and no-ops — the
// transcript is handed out exactly once, so no path can double-consume it.
export function stopVoiceInput(): string {
  if (!active) return '';
  const text = `${finalText} ${interimText}`.trim();
  teardown();
  return text;
}

// Discard everything — no transcript survives. Safe to call in any state (unmount, route change,
// New Chat, permission mid-flight).
export function cancelVoiceInput(): void {
  teardown();
}
