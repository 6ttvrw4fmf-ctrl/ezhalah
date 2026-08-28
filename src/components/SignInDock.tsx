// DESKTOP SIGN-IN DOCK (owner 2026-08-26) — a small floating sign-in prompt for signed-out desktop
// visitors, docked at the far RIGHT of the home screen and draggable anywhere the user prefers.
//
// It is a PROMPT, never a modal: tapping it opens the existing AuthModal untouched. It exists so a
// signed-out desktop visitor is offered an account without a blocking interruption — and it gets out
// of the way the moment they start actually searching.
//
// EVERY GATE READS EXISTING STATE — there is no parallel session/search tracking here:
//   desktop     useDocked()            the SSR-safe viewport gate (lib/useAtLeast + DOCK_BREAKPOINT)
//   signed out  authChecked && !user   BOTH halves matter: during the initial Supabase session
//                                      restore `user` is null, so `!user` alone flashes this card at
//                                      a logged-in visitor for a frame. GoogleOneTap documents the
//                                      same trap at its own gate.
//   home state  activeChatId === null  the store's conversation identity. A search that lands sets
//                                      it (recordHistory); «محادثة جديدة» clears it and returns to
//                                      the filter home — so "disappears after a search" and "comes
//                                      back on a fresh New Chat" are the SAME one condition, not two
//                                      hand-maintained flags that could disagree.
//   route       pathname === '/'       the filter home, where New Chat lands.
//
// PLACEMENT. Measured on production at 1280×720: the docked nav rail occupies 14→285 and the filter
// card 529→1051, leaving a 229 px free column on the right. The card is 208 px wide with a 16 px
// margin, so it sits in that gap and covers no control at the width where it first appears. Below
// DOCK_BREAKPOINT (900) it does not render at all, which is also the mobile answer.
//
// MOTION (Apple, WWDC 2018 «Designing Fluid Interfaces»): the drag tracks the pointer 1:1 from the
// grab offset via Pointer Events with capture, keeps a short velocity history, rubber-bands past the
// viewport edge instead of hard-stopping, and on release projects the throw and settles on a spring
// seeded with the release velocity (damping 1.0 / response 0.4 — Apple's own "move/reposition"
// pair). It enters from the right edge it docks to, so it leaves along the path it arrived on.
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { useApp } from '@/store';
import { useI18n } from '@/i18n';
import { useDocked } from '@/components/Sidebar';
import { colors, radius } from '@/theme/tokens';
import { shouldShowSignInDock } from '@/lib/signInDockVisibility';

const W = 208;              // fits the measured 229 px free column at the 900 px breakpoint
const EDGE = 16;            // breathing room from the viewport edge
const DRAG_THRESHOLD = 8;   // px before a press becomes a drag (below this it is still a tap)
const POS_KEY = 'ezhalah.signInDock.pos';   // session-scoped, per the owner's "if easy/safe"

// Apple's projection: where a throw would come to rest. Used to pick the settle point so a flick
// throws the card rather than dropping it where the finger happened to lift.
const project = (v: number, rate = 0.998) => (v / 1000) * rate / (1 - rate);

export default function SignInDock() {
  const docked = useDocked();
  const { user, authChecked, activeChatId, openAuth } = useApp();
  const { t } = useI18n();
  const pathname = usePathname();
  const hostRef = useRef<View | null>(null);
  const [ready, setReady] = useState(false);

  // The whole gate lives in one pure function so the barrier executes the REAL rule, not a copy.
  const visible = shouldShowSignInDock({ docked, authChecked, user, activeChatId, pathname, isWeb: Platform.OS === 'web' });

  // Entrance + drag. Everything here is web-only DOM work on the node this component owns.
  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;
    const node = hostRef.current as unknown as HTMLElement | null;
    if (!node) return;

    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clamp = (x: number, y: number) => ({
      x: Math.min(Math.max(x, EDGE), Math.max(EDGE, innerWidth - W - EDGE)),
      y: Math.min(Math.max(y, EDGE), Math.max(EDGE, innerHeight - node.offsetHeight - EDGE)),
    });

    // Restore this session's moved position, else dock far right at a height that clears the header.
    let pos = clamp(innerWidth - W - EDGE, Math.round(innerHeight * 0.46));
    try {
      const saved = sessionStorage.getItem(POS_KEY);
      if (saved) { const p = JSON.parse(saved); if (typeof p?.x === 'number' && typeof p?.y === 'number') pos = clamp(p.x, p.y); }
    } catch { /* private mode / blocked storage — the default dock is always fine */ }

    const paint = (x: number, y: number) => { node.style.transform = `translate3d(${x}px, ${y}px, 0)`; };
    paint(pos.x, pos.y);
    // Materialize from the edge it docks to (§7 spatial consistency, §12 materials).
    node.style.opacity = '0';
    requestAnimationFrame(() => {
      node.style.transition = reduced ? 'opacity 200ms ease' : 'opacity 260ms ease, filter 260ms ease';
      node.style.opacity = '1';
      setReady(true);
    });

    let raf = 0;
    let dragging = false, moved = false, id = -1;
    let grabX = 0, grabY = 0;
    let hist: Array<{ x: number; y: number; t: number }> = [];

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging = true; moved = false; id = e.pointerId;
      node.setPointerCapture(id);
      cancelAnimationFrame(raf);
      node.style.transition = 'none';
      grabX = e.clientX - pos.x; grabY = e.clientY - pos.y;   // respect WHERE they grabbed
      hist = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    };

    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const nx = e.clientX - grabX, ny = e.clientY - grabY;
      if (!moved && Math.hypot(nx - pos.x, ny - pos.y) > DRAG_THRESHOLD) moved = true;
      if (!moved) return;
      // Rubber-band past the edges: resistance, never a hard stop.
      const c = clamp(nx, ny);
      const band = (v: number, cl: number) => cl + (v - cl) * 0.35;
      pos = { x: band(nx, c.x), y: band(ny, c.y) };
      paint(pos.x, pos.y);
      hist.push({ x: e.clientX, y: e.clientY, t: performance.now() });
      if (hist.length > 6) hist.shift();
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      try { node.releasePointerCapture(id); } catch { /* already released */ }
      if (!moved) { openAuth(); return; }        // a press that never moved is a tap on the prompt
      // Velocity from the recent history, then project the throw and settle there.
      const a = hist[0], b = hist[hist.length - 1];
      const dt = Math.max(1, b.t - a.t);
      const vx = ((b.x - a.x) / dt) * 1000, vy = ((b.y - a.y) / dt) * 1000;
      const target = clamp(pos.x + project(vx), pos.y + project(vy));
      try { sessionStorage.setItem(POS_KEY, JSON.stringify(target)); } catch { /* non-fatal */ }
      if (reduced) { pos = target; paint(pos.x, pos.y); return; }
      // Critically damped spring (damping 1.0, response 0.4), seeded with the release velocity so
      // there is no seam between the finger and the animation.
      const k = (2 * Math.PI / 0.4) ** 2, c2 = 2 * (2 * Math.PI / 0.4);
      let px = pos.x, py = pos.y, vX = vx, vY = vy, last = performance.now();
      const step = (now: number) => {
        const h = Math.min(0.032, (now - last) / 1000); last = now;
        vX += (-k * (px - target.x) - c2 * vX) * h; px += vX * h;
        vY += (-k * (py - target.y) - c2 * vY) * h; py += vY * h;
        paint(px, py);
        if (Math.hypot(px - target.x, py - target.y) < 0.5 && Math.hypot(vX, vY) < 12) {
          pos = target; paint(pos.x, pos.y); return;
        }
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };

    const onResize = () => { pos = clamp(pos.x, pos.y); paint(pos.x, pos.y); };

    node.addEventListener('pointerdown', onDown);
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', onUp);
    node.addEventListener('pointercancel', onUp);
    addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onUp);
      removeEventListener('resize', onResize);
    };
  }, [visible, openAuth]);

  if (!visible) return null;

  return (
    <View
      ref={hostRef}
      // @ts-expect-error web-only DOM props on the RNW host node
      dataSet={{ testid: 'signin-dock' }}
      style={{
        position: 'fixed' as never, top: 0, left: 0, width: W, zIndex: 40,
        backgroundColor: 'rgba(255,255,255,0.82)', borderRadius: radius.card,
        borderWidth: 1, borderColor: colors.fieldLine,
        paddingVertical: 14, paddingHorizontal: 14,
        ...(Platform.OS === 'web' ? ({
          backdropFilter: 'blur(18px) saturate(150%)',
          boxShadow: '0 18px 40px -22px rgba(20,40,30,0.34)',
          cursor: 'grab', userSelect: 'none', touchAction: 'none',
          opacity: ready ? 1 : 0,
        } as Record<string, unknown>) : {}),
      }}
    >
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <View style={{ width: 26, height: 26, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="person-outline" size={14} color="#fff" />
        </View>
        <Text style={{ flex: 1, textAlign: 'right', fontSize: 13.5, fontWeight: '700', color: colors.ink, writingDirection: 'rtl' }}>
          {t('Sign up / Log in')}
        </Text>
      </View>
      <Text style={{ textAlign: 'right', fontSize: 11.5, lineHeight: 17, color: colors.muted, writingDirection: 'rtl', marginBottom: 10 }}>
        {t('Save your searches and come back to them anytime.')}
      </Text>
      <Pressable
        // @ts-expect-error web-only DOM props on the RNW host node
        dataSet={{ testid: 'signin-dock-cta' }}
        onPress={openAuth}
        style={{ backgroundColor: colors.primary, borderRadius: radius.field, paddingVertical: 9, alignItems: 'center' }}
      >
        <Text style={{ color: '#fff', fontSize: 12.5, fontWeight: '700' }}>{t('Sign in')}</Text>
      </Pressable>
    </View>
  );
}
