// Live recording waveform — the composer's center while voice input is active (owner brief §4).
// Draws the REAL mic level history from src/lib/voiceInput.ts: thin refined bars, quiet history on
// the left fading toward a stronger active edge at the current recording point (right, beside
// Stop/Send), soft neutral gray — restrained, never a nightclub equalizer. Silence reads as an
// almost-flat low line because the DATA is almost flat — nothing here invents movement.
//
// Web-only <canvas> (react-native-web renders DOM hosts natively): 60fps drawing with zero React
// re-renders — the level data lives in voiceInput's module ring buffer and this component just
// paints it each frame. Drawing uses rAF (freezing in a hidden tab only pauses the PICTURE; the
// data keeps sampling on voiceInput's interval — repo rule: never gate function on an animation
// callback). The canvas is absolutely pinned inside its own clipped wrapper, so however loud the
// input gets the waveform can never grow the row or push Stop/Send around (owner brief §1/§4) —
// scripts/verify-voice-composer-contract.ts pins that shape. Under reduced motion this stays as-is:
// the waveform is live information (actual input level), not decoration (owner brief §18).
import { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';
import { colors } from '@/theme/tokens';
import { getVoiceLevelHistory } from '@/lib/voiceInput';

const BAR_W = 2;
const GAP_W = 2;
const MIN_BAR_H = 2.5;

export default function VoiceWaveform() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = window.devicePixelRatio || 1;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const slots = Math.max(1, Math.floor(w / (BAR_W + GAP_W)));
      const history = getVoiceLevelHistory();
      const start = Math.max(0, history.length - slots);
      const mid = h / 2;
      for (let i = 0; i < slots; i++) {
        const level = history[start + i] ?? 0;
        // sqrt lifts quiet speech into visibility while keeping the loud/soft contrast honest.
        const bar = Math.max(MIN_BAR_H, Math.sqrt(level) * h * 0.85);
        // Newest sample lands at the RIGHT edge (the current recording point, beside Stop/Send);
        // history drifts left and quiets down via alpha — the ChatGPT reading direction.
        const x = w - (slots - i) * (BAR_W + GAP_W);
        const age = (i + Math.max(0, slots - history.length)) / slots;
        ctx.globalAlpha = 0.3 + 0.7 * age;
        ctx.fillStyle = colors.muted;
        // roundRect is everywhere Ezhalah web runs (Chrome 99+/Safari 16+), but a plain rect is a
        // fine fallback for anything older — never worth a polyfill.
        if (typeof (ctx as any).roundRect === 'function') {
          ctx.beginPath();
          (ctx as any).roundRect(x, mid - bar / 2, BAR_W, bar, BAR_W / 2);
          ctx.fill();
        } else {
          ctx.fillRect(x, mid - bar / 2, BAR_W, bar);
        }
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  if (Platform.OS !== 'web') return <View />; // voice input is web-only today (see voiceInput.ts)
  // Lowercase DOM host under react-native-web — pinned absolute so the canvas can never size its
  // parent; the wrapper (agent.tsx s.voiceWaveWrap) owns all layout and clips overflow.
  return <canvas ref={canvasRef as any} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />;
}
