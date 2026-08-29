// THE SMALL SIGN-IN CARD (owner 2026-08-29): «i dont want this popup to show, i want it small
// where the user can drag and move around in the filter and ai agent, it goes away once the user
// sends something, put it in the side.»
//
// This is the UNPROMPTED auth surface — a compact draggable glass card for signed-out desktop-web
// visitors on the Filter home and the Agent screen, holding the FULL working login (Google /
// Apple / phone+OTP) via AuthModal's shared AuthForm in its `compact` presentation. It never
// blocks anything: no scrim, no modality — it floats at zIndex 40 (below every real overlay) in
// the side slot the retired 2026-08-26 SignInDock owned (owner-approved placement, measured on
// production: the free right column beside the filter card).
//
// LIFECYCLE (all gates in shouldShowSignInCard — pure, barrier-executed):
//   appears   signed-out + desktop web + '/' or '/agent', after the session restore settles.
//   goes away the moment the user SENDS something — a Filter search submit or an Agent message
//             (voice included) — via store.dismissSignInCard() at those two send sites; or via
//             its X (AuthForm's close → onRequestClose → the same dismissal).
//   returns   on a page refresh / fresh load: the dismissal is IN-MEMORY store state, never
//             persisted — dying with the load IS the owner's return rule. An auth transition also
//             clears it (#1214 epoch), so sign-out lands in the canonical logged-out state.
//   never     for signed-in users, on mobile (top-bar pill + on-demand centered modal instead),
//             or on native.
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
import { DOCK_BREAKPOINT } from '@/lib/responsive';
import { colors, radius } from '@/theme/tokens';
import { AuthForm } from '@/components/AuthModal';
import { attachCardDrag } from '@/lib/cardDrag';
import {
  shouldShowSignInCard,
  clampAuthPopupOffset,
  signInCardDefaultPos,
  SIGNIN_CARD_W,
  SIGNIN_CARD_POS_KEY,
} from '@/lib/authPopupBehavior';

export default function SignInCard() {
  const docked = useAtLeast(DOCK_BREAKPOINT);
  const { user, authChecked, authOpen, signInCardDismissed, dismissSignInCard, signIn } = useApp();
  const pathname = usePathname();
  const hostRef = useRef<View | null>(null);
  const gripRef = useRef<View | null>(null);

  const visible = shouldShowSignInCard({
    isWeb: Platform.OS === 'web',
    docked,
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
    // Materialize quietly in place (opacity only — never transition transform: the drag owns it).
    node.style.opacity = '0';
    requestAnimationFrame(() => {
      node.style.transition = 'opacity 240ms ease';
      node.style.opacity = '1';
    });
    return attachCardDrag(node, grip, {
      posKey: SIGNIN_CARD_POS_KEY,
      clamp,
      initial: () => clamp(signInCardDefaultPos(innerWidth, innerHeight)),
    });
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
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.fieldLine,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  grip: { height: 22, alignItems: 'center', justifyContent: 'center' },
  pill: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.line, marginTop: 4 },
});
