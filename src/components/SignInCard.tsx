// THE SMALL SIGN-IN CARD (owner 2026-08-29): «i dont want this popup to show, i want it small
// where the user can drag and move around in the filter and ai agent, it goes away once the user
// sends something, put it in the side.»
//
// This is the UNPROMPTED auth surface — a compact draggable glass card for signed-out desktop-web
// visitors on the Filter home and the Agent screen, holding the FULL working login (Google /
// Apple / phone+OTP) via AuthModal's shared AuthForm in its `compact` presentation. It never
// blocks anything: no scrim, no modality — it floats at zIndex 40 (below every real overlay) in
// the free column on the right of the search form (owner-approved placement).
//
// IT NEVER SITS ON THE FORM OR ON THE COOKIE CARD (owner 2026-11-10: «make sure never ever get this mistake ever.
// Ever again»). Measured that day: on every laptop narrower than ~1306 px the card lay on the search boxes, and a
// tap meant for the form opened Apple sign-in; in English it also lay on the cookie card. Three rules now:
//   1. it exists only where a free column exists — SIGNIN_CARD_BREAKPOINT, not the sidebar's dock breakpoint;
//   2. its resting place is MEASURED (its own height, the cookie card's real top edge) — signInCardRestPos;
//   3. when the window is too short to hold it above the cookie card, it stays OFF the screen (invisible and
//      untouchable) until there is room — the visitor answers the cookie card and the sign-in card takes its turn.
// It re-checks whenever the window, its own size (language switch) or the cookie card changes. A card the visitor
// dragged is theirs and is only kept on-screen. The browser robot
// scripts/verify-web-laptop-nothing-cut-or-covered.mjs measures all of it on every PR.
//
// LIFECYCLE (all gates in shouldShowSignInCard — pure, barrier-executed):
//   appears   signed-out + desktop web + '/' or '/agent', after the session restore settles.
//   goes away the moment the user SENDS something — a Filter search submit or an Agent message
//             (voice included) — via store.dismissSignInCard() at those two send sites; or via
//             its X (AuthForm's close → onRequestClose → the same dismissal).
//   returns   on a page refresh / fresh load: the dismissal is IN-MEMORY store state, never
//             persisted — dying with the load IS the owner's return rule. An auth transition also
//             clears it (#1214 epoch), so sign-out lands in the canonical logged-out state.
//   never     for signed-in users, on screens with no free column beside the form (top-bar pill /
//             sidebar button + on-demand centered modal instead), or on native.
//
// DRAG: the owner-loved machinery (lib/cardDrag.ts, shared with the centered modal) in ABSOLUTE
// mode — the painted translate IS the card's position; clamped fully on-screen, session position
// in sessionStorage (position memory may outlive the dismissal — the card returns where the user
// left it). Themed from birth: every color below is a var(--ez-*) token role (#1206/#1211).
import { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { usePathname } from 'expo-router';
import { useApp } from '@/store';
import { useAtLeast } from '@/lib/useAtLeast';
import { SIGNIN_CARD_BREAKPOINT } from '@/lib/responsive';
import { colors, radius } from '@/theme/tokens';
import { AuthForm, AuthSky } from '@/components/AuthModal';
import { attachCardDrag } from '@/lib/cardDrag';
import { OWN_DOCKED_PROMPT_SELECTOR, observeOwnDockedCard } from '@/lib/bottomPromptInset';
import {
  shouldShowSignInCard,
  clampAuthPopupOffset,
  signInCardRestPos,
  SIGNIN_CARD_W,
  SIGNIN_CARD_POS_KEY,
} from '@/lib/authPopupBehavior';

export default function SignInCard() {
  const sideRoom = useAtLeast(SIGNIN_CARD_BREAKPOINT);
  const { user, authChecked, authOpen, signInCardDismissed, dismissSignInCard, signIn } = useApp();
  const pathname = usePathname();
  const hostRef = useRef<View | null>(null);
  const gripRef = useRef<View | null>(null);

  const visible = shouldShowSignInCard({
    isWeb: Platform.OS === 'web',
    sideRoom,
    authChecked,
    user,
    dismissed: signInCardDismissed,
    modalOpen: authOpen,
    pathname,
  });

  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;
    const node = hostRef.current as unknown as HTMLElement | null;
    const grip = gripRef.current as unknown as HTMLElement | null;
    if (!node || !grip) return;
    // ABSOLUTE MODE: base {0,0} + live size, so the painted translate is the card's position.
    const clamp = (p: { x: number; y: number }) => clampAuthPopupOffset(
      p,
      { left: 0, top: 0, width: node.offsetWidth || SIGNIN_CARD_W, height: node.offsetHeight || 320 },
      { w: innerWidth, h: innerHeight },
    );
    // WHERE THE COOKIE CARD'S TOP EDGE RESTS — read from its layout, not from where it is painted this frame (it
    // slides up 12 px as it arrives; a reading taken mid-slide would park this card 12 px too low). null = there is
    // no cookie card on the page.
    const cookieTop = (): number | null => {
      const c = document.querySelector(OWN_DOCKED_PROMPT_SELECTOR) as HTMLElement | null;
      if (!c || !c.offsetHeight) return null;
      const gap = parseFloat(getComputedStyle(c).bottom);
      return innerHeight - (Number.isFinite(gap) ? gap : 0) - c.offsetHeight;
    };
    const room = () => signInCardRestPos({
      vw: innerWidth, vh: innerHeight, cardH: node.offsetHeight || 320, cookieTop: cookieTop(),
    });
    const slot = () => { const r = room(); return clamp({ x: r.x, y: r.y }); };

    const drag = attachCardDrag(node, grip, {
      posKey: SIGNIN_CARD_POS_KEY,
      clamp,
      initial: slot,
      rest: slot,
    });

    // ON SCREEN ONLY WHEN IT HAS ROOM. `shown` is what the last look decided (null: not looked yet).
    let shown: boolean | null = null;
    let fade = 0;
    const show = (on: boolean) => {
      if (on === shown) return;
      shown = on;
      cancelAnimationFrame(fade);
      node.style.pointerEvents = on ? '' : 'none';
      if (!on) {
        // No room: invisible AND untouchable — still in the page, so its real height can be measured.
        node.style.transition = 'none';
        node.style.visibility = 'hidden';
        node.style.opacity = '0';
        return;
      }
      // Materialize quietly in place (opacity only — never transition transform: the drag owns it).
      node.style.visibility = 'visible';
      node.style.opacity = '0';
      fade = requestAnimationFrame(() => {
        node.style.transition = 'opacity 240ms ease';
        node.style.opacity = '1';
      });
    };

    let cookieWas: number | null = null;
    const settle = (why: 'start' | 'cookie' | 'size') => {
      const ct = cookieTop();
      const cookieLeft = cookieWas != null && ct == null;
      cookieWas = ct;
      // NO HOP: when the cookie card goes away (the visitor tapped something) a card they are looking at stays where
      // it is. A card that was waiting for room takes its place now; a resized window re-places it either way.
      if (!(why === 'cookie' && cookieLeft && shown)) drag.toRest();
      show(drag.pinned() || room().fits);
    };
    settle('start');
    const onResize = () => settle('size');
    addEventListener('resize', onResize);   // registered after attachCardDrag's own listener, which re-places first
    // A language switch or a late font changes the card's height — and so whether it still fits.
    const sizes = typeof ResizeObserver === 'function' ? new ResizeObserver(() => settle('size')) : null;
    sizes?.observe(node);
    const unwatchCookie = observeOwnDockedCard(() => settle('cookie'));
    return () => {
      cancelAnimationFrame(fade);
      removeEventListener('resize', onResize);
      sizes?.disconnect();
      unwatchCookie();
      drag();
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <View
      ref={hostRef}
      // @ts-expect-error web-only DOM props on the RNW host node
      dataSet={{ testid: 'signin-card' }}
      style={[
        st.host,
        Platform.OS === 'web' && ({
          position: 'fixed',
          boxShadow: '0 18px 44px -20px rgba(18, 37, 27, 0.35)',
        } as never),
      ]}
    >
      <AuthSky radius={radius.card} />
      {/* The grab strip: the card's whole header row. AuthForm's close X (zIndex 5) floats above
          the strip's overlap, so closing never begins a drag — same layering as the modal. */}
      <View
        ref={gripRef}
        // @ts-expect-error web-only DOM props on the RNW host node
        dataSet={{ testid: 'signin-card-drag-handle' }}
        style={[st.grip, Platform.OS === 'web' && ({ cursor: 'grab', touchAction: 'none', userSelect: 'none' } as never)]}
      >
        <View style={st.pill} />
      </View>
      <AuthForm compact onRequestClose={dismissSignInCard} onSignedIn={signIn} />
    </View>
  );
}

const st = StyleSheet.create({
  // zIndex 40 — the retired dock's own layer: above page content, below the Sidebar drawer (50),
  // ShareSheet (60), InfoModal (70), IntroVideo (100) and the centered AuthModal (200).
  host: {
    top: 0,
    left: 0,
    width: SIGNIN_CARD_W,
    zIndex: 40,
    backgroundColor: 'transparent', // AuthSky paints the card (owner 2026-10-24)
    // BORN INVISIBLE. The effect above places the card and only then fades it in (show()). Without this the card
    // was painted for one frame at the top-left corner of the screen, fully solid, before it jumped to its slot
    // (measured 2026-11-10, frame by frame, on every laptop size). The effect's inline opacity wins over this.
    opacity: 0,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.fieldLine,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  grip: { height: 22, alignItems: 'center', justifyContent: 'center' },
  pill: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.line, marginTop: 4 },
});
