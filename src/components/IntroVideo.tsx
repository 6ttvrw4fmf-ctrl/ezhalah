import { useEffect, useRef } from 'react';
import { Animated, Image, Platform, StyleSheet, Text } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors } from '@/theme/tokens';
import { useApp } from '@/store';

// ─── The first-run cinematic intro (the eagle clip) ──────────────────────────────────────────────
//
// Shows ONCE, full-screen, only for a brand-new logged-out visitor (gated by `showIntro` in the
// store). No skip button — by product decision it plays to the end — so the clip is meant to be
// SHORT (~5s). As a safety net we still auto-dismiss on playback error or after a hard timeout, so a
// user is never trapped on a black screen if the video fails to load.
//
// HOW TO PLUG IN THE VIDEO:
//   1. Export the generated clip as a vertical 9:16 MP4 (H.264), ~5s, muted, ideally < 5 MB.
//   2. Save it at:  assets/intro/eagle.mp4
//   3. Replace the line below with:  const INTRO_SOURCE = require('../../assets/intro/eagle.mp4');
// Until then INTRO_SOURCE is null and the intro silently no-ops (the app opens straight to Home),
// so the build never breaks waiting on the asset.
// HOW TO PLUG IN THE EAGLE CLIP (from Higgsfield): export a vertical 9:16 MP4 (H.264), ~5s, muted,
// ideally < 5 MB; save it at assets/intro/eagle.mp4; then replace the line below with:
//   const INTRO_SOURCE = require('../../assets/intro/eagle.mp4');
// While this is null the intro silently no-ops (the app opens straight to Home) so the build never
// breaks waiting on the asset.
const INTRO_SOURCE: number | string | null = null;

// Hard ceiling: if the video hasn't finished (stalled/slow network) by this long, give up and let
// the user into the app. Keep it a little above the clip length (~5s clip → 9s ceiling).
const SAFETY_MS = 9000;

const EAGLE_MARK = require('../../assets/images/eagle-mark.png');

export default function IntroVideo() {
  const { showIntro, dismissIntro } = useApp();
  // Conditionally mount the player so the expo-video hooks only run when there's actually something
  // to show. (A child component lets us keep the rules-of-hooks happy.)
  if (!showIntro || INTRO_SOURCE == null) return null;
  return <IntroPlayer source={INTRO_SOURCE} onDone={dismissIntro} />;
}

function IntroPlayer({ source, onDone }: { source: number | string; onDone: () => void }) {
  const fade = useRef(new Animated.Value(1)).current; // whole-overlay opacity (fades out at the end)
  const poster = useRef(new Animated.Value(1)).current; // branded poster, fades once video paints
  const finished = useRef(false);

  const player = useVideoPlayer(source, (p) => {
    p.muted = true; // web blocks autoplay-with-sound; muted guarantees it starts
    p.loop = false;
    p.play();
  });

  // Fade the overlay out, then hand control back to the app exactly once.
  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    Animated.timing(fade, { toValue: 0, duration: 420, useNativeDriver: true }).start(() => onDone());
  };

  // Web autoplay hardening: some browsers (notably iOS Safari) only autoplay a muted video that also
  // carries the `playsinline` + `muted` attributes on the element itself. expo-video drives playback
  // via JS, so we set the attributes directly and nudge play() once on mount.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = typeof document !== 'undefined' ? document.querySelector('video') : null;
    if (el) {
      el.muted = true;
      el.setAttribute('playsinline', '');
      el.setAttribute('webkit-playsinline', '');
      el.setAttribute('autoplay', '');
      Promise.resolve(el.play()).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const endSub = player.addListener('playToEnd', finish);
    const statusSub = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') finish(); // network/codec failure → don't trap the user
      if (status === 'readyToPlay') {
        Animated.timing(poster, { toValue: 0, duration: 500, useNativeDriver: true }).start();
      }
    });
    const timer = setTimeout(finish, SAFETY_MS);
    return () => {
      endSub.remove();
      statusSub.remove();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, { opacity: fade }]} pointerEvents="auto">
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
      />
      {/* Branded poster — covers the brief load gap, then fades as the first frame paints. */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.poster, { opacity: poster }]} pointerEvents="none">
        <Image source={EAGLE_MARK} style={styles.mark} resizeMode="contain" />
        <Text style={styles.word}>EZHALAH</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { zIndex: 100, backgroundColor: colors.dark },
  poster: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dark, gap: 14 },
  mark: { width: 96, height: 96, opacity: 0.95 },
  word: { color: '#ffffff', fontSize: 22, fontWeight: '700', letterSpacing: 3 },
});
