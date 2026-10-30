import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image as XImage } from 'expo-image';
import Animated from 'react-native-reanimated';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { SKY_CALM_PROPS } from '@/lib/scrollCalm';
import { startNameParty, claimNameParty } from '@/lib/nameParty';
import { hasJustSignedIn } from '@/lib/loginWelcome';
import CloudWisp from './CloudWisp';

// The guest falconer (plain outline) — the owner's reference image (2026-10-26), 167x192.
const FALCONER = require('../../assets/icons/insight-falconer-original.png');
const ART_W = 167, ART_H = 192;
// THE GUEST FALCONER (owner 2026-10-28/29: «make it the same [falconer] for the first one, not signed up user … I want
// him to remove his mask, throw it down, let it seem it's falling, then fly … a different colour mask», approved from
// the preview, red hood). The SAME traced falconer as the sign-in story, plain (no beard, no bulb), his eagle in green
// wearing a RED hood: the eagle bows, he takes the hood off with his mouth (the sign-in seating move in reverse), drops
// it so it tumbles down, and the eagle takes off. ~4 s on EVERY open and refresh, never loops; he keeps the last frame
// (his empty glove). Built by scripts/build-guest-falconer.mjs from falconer-signin.svg; same canvas as the sign-in SVG.
const GUEST = require('../../assets/images/falconer-guest.svg');
// every mount of the guest falconer gets its own fresh timeline (a browser shares one per SVG URL)
let guestPlays = 0;

// THE SIGN-IN ANIMATION (owner 2026-10-26, approved after review), one self-contained SVG traced from the owner's two
// logos so the original drawing is kept exactly. It plays once, only when a sign-in welcome is taken:
//   the gold eagle glides in and lands on his glove (his arm dips under its weight); he draws the hood from his vest
//   with his teeth and seats it on the eagle; a green light runs from his mouth through his face, arm and body and the
//   beard and bisht appear behind it; he pauses and thinks 🤔 (head tilts up, a small side-to-side, a hold); a golden
//   bulb lights INSIDE his head and a soft green glow breathes through him; he settles into the still final look a
//   signed-in user keeps (falconer-final.svg) — and only THEN the confetti party starts.
// FASTER, AND THE STORY FINISHES BEFORE THE CONFETTI (owner 2026-10-27: «the animation must be clear, first the
// animation … it finished, then the confetti … it feels slow»): every time in the SVG was scaled to 0.7 (8.8 s → 6.2 s,
// same steps in the same order), and the confetti now starts when the story ends instead of during the bulb.
// Both SVGs share one canvas, viewBox -140 -170 310 385 in the drawing's own 167x192 coordinates.
const SIGNIN = require('../../assets/images/falconer-signin.svg');
const SIGNED_IN_STILL = require('../../assets/images/falconer-final.svg');
const SIGNIN_CANVAS = { x: -140, y: -170, w: 310, h: 385 };
export const SIGNIN_SEQUENCE_MS = 6200;
// The bulb starts lighting at 5.005 s and is fully lit by ~5.6 s (falconer-signin.svg). AFTER THE BULB (owner
// 2026-10-30: «the fireworks pop before the lightbulb … wait like 2 seconds, then a lot»): the rockets leave about
// 1.7 s after the bulb is lit, so the first pop lands ~2 s after it (~7.6 s). On 2026-10-29 they had been moved to the
// bulb itself (5.0 s), which put the first pop on top of it.
export const BULB_LIT_MS = 5600;
export const RAIN_AT_MS = BULB_LIT_MS + 1700;
// how long the story waits for its file before its clock starts anyway
const LOAD_WAIT_MS = 4000;
// how long, after he appears, a marked sign-in may keep the box empty waiting for its story to start
const STORY_WAIT_MS = 4000;

// A browser shares one animation timeline per SVG URL, so a second sign-in in the same tab would show the already-
// finished animation. A per-play query string gives every play its own fresh timeline.
const freshSource = (src: unknown, play: number) => {
  const uri = typeof src === 'string' ? src : (src as { uri?: string } | null)?.uri;
  return uri ? { uri: `${uri}${uri.includes('?') ? '&' : '?'}play=${play}` } : src;
};

// The falconer above the home title (owner 2026-10-26): standing in the sky, partly covered by soft clouds that drift
// slowly across him. `flip` mirrors the drawing (and the falcon with it) in Arabic; the clouds keep their own shapes.
// Reduced motion: the clouds stay still and nothing flies.
const DRIFT_PX = 7;
const drift = (ms: number, px: number) => ({
  animationName: { from: { transform: [{ translateX: -px }] }, to: { transform: [{ translateX: px }] } },
  animationDuration: ms,
  animationIterationCount: 'infinite',
  animationDirection: 'alternate',
  animationTimingFunction: 'ease-in-out',
} as const);

export default function HeroFalconer({ size, flip, signedIn = false, celebrate = 0, inline = false }: {
  size: { width: number; height: number }; flip: boolean; signedIn?: boolean; celebrate?: number;
  /** At the end of the headline (owner 2026-10-27): no clouds, so nothing drifts over the words. */
  inline?: boolean;
}) {
  const reduced = useReducedMotion();
  const { width: w, height: h } = size;

  // GUEST: the hood comes off and the eagle flies on EVERY open and refresh (owner 2026-10-26 / 2026-10-29).
  // Reduced motion: the plain still drawing, nothing moves.
  const [guestPlay] = useState(() => ++guestPlays);

  // SIGNED IN: the sign-in animation, once per sign-in welcome (`celebrate` is bumped when it is taken).
  // Derived, not set in an effect, so the first frame of a sign-in already shows the animation's start (no flash of
  // the end). Reduced motion: the still final look at once, no rain.
  const [done, setDone] = useState(0);
  // while he is on screen, the confetti is his alone (one party per sign-in, after his story)
  useEffect(() => claimNameParty(), []);
  // SMOOTH (owner 2026-10-27: «it doesn't look smooth»): the story's clock starts when its file is ON SCREEN (onLoad),
  // not when it was asked for — the 240 KB SVG used to arrive after the timers had started, so the confetti could land
  // mid-story and the end was cut. After the story he KEEPS its last frame (the same drawing as the still) instead of
  // swapping to another file, which flashed blank while it loaded.
  const [loadedFor, setLoadedFor] = useState(0);
  const story = signedIn && !reduced && celebrate > 0;
  const playing = story && celebrate !== done;
  // NO STILL BEFORE THE STORY (owner 2026-10-28: «I don't like how the person shows first, then it happens»). Right after
  // a sign-in the page drew the finished still for a moment, then the story restarted from its beginning. While a
  // sign-in is marked and its story has not started yet (at most STORY_WAIT_MS after he appears), the box stays empty.
  const mountedAt = useRef(Date.now());
  const [, recheck] = useState(0);
  useEffect(() => { const id = setTimeout(() => recheck(1), STORY_WAIT_MS); return () => clearTimeout(id); }, []);
  const awaitingStory = signedIn && !reduced && celebrate === 0
    && Date.now() - mountedAt.current < STORY_WAIT_MS && hasJustSignedIn(Date.now());
  useEffect(() => {
    if (!playing) return;
    const fallback = setTimeout(() => setLoadedFor(celebrate), LOAD_WAIT_MS); // a load event that never comes
    return () => clearTimeout(fallback);
  }, [celebrate, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!playing || loadedFor !== celebrate) return;
    const timers = [
      setTimeout(() => startNameParty(reduced), RAIN_AT_MS),
      setTimeout(() => setDone(celebrate), SIGNIN_SEQUENCE_MS),
    ];
    return () => timers.forEach(clearTimeout);
  }, [loadedFor, celebrate, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // contentFit="contain": where the drawing really sits inside the box, so the falcon sits on his hand.
  const k = Math.min(w / ART_W, h / ART_H);
  const ox = (w - ART_W * k) / 2, oy = (h - ART_H * k) / 2;
  // the signed-in canvas, placed so its drawing lands exactly on the guest drawing's box
  const signinBox = {
    position: 'absolute' as const,
    left: ox + SIGNIN_CANVAS.x * k, top: oy + SIGNIN_CANVAS.y * k,
    width: SIGNIN_CANVAS.w * k, height: SIGNIN_CANVAS.h * k,
  };

  return (
    <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: w, height: h }}>
      {inline ? null : <CloudWisp variant={0} width={w * 1.35} height={h * 0.3} opacity={0.5} style={{ bottom: -h * 0.07, left: -w * 0.27 }} />}
      <View style={[StyleSheet.absoluteFill, flip && s.flip]}>
        {!signedIn ? (
          reduced ? (
            <XImage source={FALCONER} contentFit="contain" accessible={false} style={StyleSheet.absoluteFill} />
          ) : (
            <XImage testID="hero-falconer-guest" source={freshSource(GUEST, guestPlay) as any} priority="high" contentFit="fill" accessible={false} style={signinBox} />
          )
        ) : awaitingStory ? null : story ? (
          <XImage testID="hero-falconer-signin" source={freshSource(SIGNIN, celebrate) as any} priority="high" onLoad={() => setLoadedFor(celebrate)} contentFit="fill" accessible={false} style={signinBox} />
        ) : (
          <XImage testID="hero-falconer-final" source={SIGNED_IN_STILL} contentFit="fill" accessible={false} style={signinBox} />
        )}
      </View>
      {inline ? null : (<>
      {/* In FRONT of him: a low bank over his chest and a thin wisp across his shoulder, each on its own slow clock. */}
      <Animated.View testID="hero-falconer-clouds" {...SKY_CALM_PROPS} style={[StyleSheet.absoluteFill, !reduced && drift(5200, DRIFT_PX)]}>
        <CloudWisp variant={2} width={w * 1.25} height={h * 0.36} opacity={0.82} style={{ bottom: h * 0.02, left: -w * 0.15 }} />
      </Animated.View>
      <Animated.View {...SKY_CALM_PROPS} style={[StyleSheet.absoluteFill, !reduced && drift(7400, DRIFT_PX + 3)]}>
        <CloudWisp variant={1} width={w * 0.95} height={h * 0.22} opacity={0.6} style={{ top: h * 0.38, right: -w * 0.3 }} />
      </Animated.View>
      </>)}
    </View>
  );
}

const s = StyleSheet.create({
  flip: { transform: [{ scaleX: -1 }] },
});
