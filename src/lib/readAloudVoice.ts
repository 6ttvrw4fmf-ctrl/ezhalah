// Read-aloud's two ENGINE-SENSITIVE decisions, with NO imports on purpose (routine #6, 2026-09-03).
//
// WHY THEY LIVE HERE RATHER THAN IN readAloud.ts. Both are pure logic, and both were previously
// testable only through a REPLICA. `scripts/verify-read-aloud-contract.ts` carried its own
// `pickBestArabicReplica()` — "a faithful replica of readAloud.ts's pickBestArabic() scoring" — and
// asserted against that. A replica is faithful exactly until someone edits production and not the
// copy, at which point the barrier keeps proving the OLD formula, in green, forever. That is the
// failure this repo already names in `lib/supportDraft.ts` ("it lives apart from lib/support.ts —
// which reaches the network — so a barrier can import and EXECUTE the real validator instead of
// testing a copy of it") and in the support-message barrier's own §1. This module is that same
// split, applied to read-aloud: `readAloud.ts` imports expo-speech and react-native, so a Node
// barrier can never import it — which is precisely why the replica existed.
//
// Keep this file import-free. The moment it imports expo-speech for `VoiceQuality`, a barrier can no
// longer execute it and the replica comes back.

/** The locale the product reads Arabic in. Mirrors readAloud.ts's own AR_LANG. */
export const AR_LANG = 'ar-SA';

/** expo-speech's `VoiceQuality.Enhanced` is the string 'Enhanced'; compared by value so this module
 *  needs no import. `scripts/verify-read-aloud-voice-logic.ts` pins the two to each other. */
export const QUALITY_ENHANCED = 'Enhanced';

/** The shape read-aloud actually consumes — expo-speech's Voice, plus WebVoice's `localService`. */
export type ArabicVoiceCandidate = {
  identifier: string;
  language?: string | null;
  quality?: string | null;
  /** Web only. UNDEFINED on native, where every voice is on-device by construction. */
  localService?: boolean;
};

const norm = (lang?: string | null) => (lang ?? '').toLowerCase().replace('_', '-');

/**
 * Score one Arabic voice. Exact locale (4) outranks on-device (2) plus Enhanced quality (1)
 * COMBINED, so an exact ar-SA voice wins even when it is remote and a local generic one exists —
 * the owner's stated priority, unconditionally. A voice strong on every axis still wins outright.
 *
 * `localService !== false` rather than `=== true`: the field only exists on the web platform, and
 * `undefined` on native must score the same as an explicit local voice, because there every voice
 * IS on-device. Writing `=== true` would silently drop native voices two points and change which
 * voice every phone picks.
 */
export function scoreArabicVoice(v: ArabicVoiceCandidate): number {
  let s = 0;
  if (norm(v.language) === AR_LANG.toLowerCase()) s += 4;
  if (v.localService !== false) s += 2;
  if (v.quality === QUALITY_ENHANCED) s += 1;
  return s;
}

/**
 * The best Arabic voice a device offers, or null when it offers none.
 *
 * ENGINE-SENSITIVE BY NATURE, which is why it is worth executing rather than replicating: WebKit,
 * Gecko and Blink each return a different `getVoices()` list — different locales, different
 * `localService` flags, different quality tiers, and Firefox commonly reports no Arabic voice at
 * all. The barrier feeds this the real per-engine shapes; production behaviour then follows from the
 * same code path a user gets.
 */
export function pickBestArabicVoice<T extends ArabicVoiceCandidate>(voices: readonly T[]): T | null {
  const arabic = voices.filter((v) => norm(v.language).startsWith('ar'));
  if (!arabic.length) return null;
  return [...arabic].sort((a, b) => scoreArabicVoice(b) - scoreArabicVoice(a))[0];
}

/**
 * Did the engine actually honour `speechSynthesis.pause()`, or silently ignore it?
 *
 * iOS Safari has a real, long-documented WebKit bug: `pause()` returns normally, `paused` never
 * becomes true, and the audio keeps playing. Trusting it there makes the Pause button visibly do
 * nothing — plausibly exactly what "the voice thing doesn't work" describes on an iPhone. readAloud
 * therefore re-checks shortly after and falls back to cancel+restart (the same primitive Android
 * always uses, having no pause API at all).
 *
 * The three conditions are ALL load-bearing and each guards a different way of getting it wrong:
 *   · `state === 'paused'`      — the user may have hit Resume inside the verify window; forcing a
 *                                 cancel then would stop audio they just asked to continue.
 *   · `playToken === tokenAtPause` — a newer unit may have started; cancelling it would kill the
 *                                 wrong utterance, and the stale timer must not reach across units.
 *   · `!enginePaused`           — the engine DID hold, so there is nothing to fall back from;
 *                                 forcing anyway would restart the unit from its start on every
 *                                 pause, on every engine, which is a bug for every non-WebKit user.
 *
 * NOT VERIFIED ON A PHYSICAL DEVICE: this pins the DECISION, not iOS's audio behaviour. Whether
 * WebKit on a real iPhone reports `paused === false` here is a device fact no headless run settles.
 */
export function shouldForcePauseFallback(o: {
  state: 'idle' | 'playing' | 'paused';
  playToken: number;
  tokenAtPause: number;
  enginePaused: boolean;
}): boolean {
  return o.state === 'paused' && o.playToken === o.tokenAtPause && !o.enginePaused;
}
