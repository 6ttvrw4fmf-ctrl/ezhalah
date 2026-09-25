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

/**
 * WHY a tap on 🔊 produced no speech — the THIRD real state, which the UI used to throw away.
 *
 * `speakReadAloud()` returns a boolean, and a boolean cannot carry what readAloud.ts's own voice
 * resolution genuinely knows. That module keeps THREE states on purpose (its §VOICE RESOLUTION note
 * spells them out): a confirmed voice; no voice and the search EXHAUSTED; and no voice YET while the
 * bounded poll plus its `RETRY_WINDOW_MS = 45_000` background retry are still running. The first
 * speaks. The other two both refuse — and they are not the same fact about the user's device.
 *
 * Collapsing them is the repo's owner-locked **silent -> NULL, never unknown -> NO** rule broken in
 * the read-aloud surface, the same shape AGENTS.md records as "A FAILED FETCH IS NOT AN EMPTY
 * ANSWER": a lookup still in flight rendered to the user as a confident negative. Here the negative
 * is «الاستماع غير متاح على هذا الجهاز» — a permanent-sounding verdict about their hardware, shown
 * while the app was still looking for a voice. i18n.tsx's own comment on that string already stated
 * the intended contract and had been false since the retry window landed: "shown ONLY when the
 * device/browser has no Arabic voice at all".
 *
 * MEASURED on production (routine #6, 2026-09-25, Chromium, 4/4 fresh contexts, real clicks): the 🔊
 * control does not exist until an agent search has returned cards, which took t = 29,283 / 30,290 /
 * 30,311 / 30,695 ms since page load — every one of them ~15s INSIDE the 45s window, because
 * `resolveVoice()` starts at module import. So this is not a narrow startup race: the moment the
 * button first becomes tappable and the still-looking window OVERLAP on the ordinary path. readAloud
 * .ts's own comment claimed the opposite ("rare in practice ... well before a real tap") and the
 * measurement is what corrects it. Tapping again at t = 52,977 / 53,345 ms, past the window, produced
 * the byte-identical message, so the two states were indistinguishable to the user.
 *
 * PURE, and here rather than in readAloud.ts, for the reason this whole module exists: readAloud.ts
 * imports expo-speech, so a Node barrier cannot execute anything defined in it, and a barrier that
 * cannot EXECUTE a decision can only pin its source text — which AGENTS.md records as passing for
 * the entire time a defect is live. `scripts/verify-read-aloud-voice-logic.ts` runs this.
 */
export type ReadAloudRefusal = 'none' | 'no-voice-on-device' | 'still-resolving';

export function readAloudRefusalVerdict(o: {
  /** A matching Arabic voice has been confirmed — readAloud.ts's `bestArabicVoice`. */
  voiceConfirmed: boolean;
  /** The poll AND its background retry window have both finished — `voiceCheckExhausted`. */
  checkExhausted: boolean;
}): ReadAloudRefusal {
  if (o.voiceConfirmed) return 'none';
  return o.checkExhausted ? 'no-voice-on-device' : 'still-resolving';
}

/**
 * Which sentence the user is shown for a refusal — the i18n KEY, or null for "say nothing".
 *
 * This lives beside the verdict, and is pure, so a barrier can execute the ENTIRE user-visible
 * decision — (voiceConfirmed, checkExhausted) -> verdict -> the sentence on screen — rather than
 * executing the verdict and then grepping FeedbackRow for the branch. AGENTS.md is explicit that a
 * source-text tripwire passes for the whole time a defect is live, and the defect this replaces was
 * precisely a wrong BRANCH over a correct state: readAloud.ts already knew it was still looking, and
 * the component rendered the device verdict anyway.
 *
 * 'none' maps to null rather than to a reassuring string: if a tap is ever refused while a voice IS
 * confirmed, the cause is not the voice (an empty segment list, say) and inventing a verdict about
 * the device would be the same class of lie in a new place.
 */
export function readAloudRefusalMessageKey(r: ReadAloudRefusal): string | null {
  if (r === 'no-voice-on-device') return "Listening isn't available on this device";
  if (r === 'still-resolving') return 'Still preparing the voice — tap again in a moment';
  return null;
}
