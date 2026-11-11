// THE SIGN-IN SURFACES' CONTRACT (owner 2026-08-29 revision)
//
//   node --experimental-strip-types scripts/verify-auth-popup.ts        (discovered by `npm test`)
//
// The 2026-08-28 large AUTO-SHOWING popup is RETIRED by the owner's next-day revision: «i dont
// want this popup to show, i want it small where the user can drag and move around in the filter
// and ai agent, it goes away once the user sends something, put it in the side.» What holds now:
//
//   • SignInCard — the small draggable side card — is the UNPROMPTED invitation for signed-out
//     desktop-web visitors on '/' and '/agent'. Full compact login inside it (AuthModal's shared
//     AuthForm). It dismisses the moment the user SENDS something (Filter search submit, Agent
//     message — voice funnels into the same send()) or closes it; the dismissal is IN-MEMORY, so
//     a refresh brings the card back; an auth transition clears it (#1214 epoch).
//   • AuthModal — the centered popup — opens ONLY via explicit sign-in controls (openAuth). It
//     NEVER auto-raises. Its owner-loved drag, clamp and mobile behaviour are unchanged.
//
// Every rule is a pure function (src/lib/authPopupBehavior.ts) EXECUTED here over its input
// space; the wiring section then pins that components actually delegate to them.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  shouldShowSignInCard,
  canDragAuthPopup,
  clampAuthPopupOffset,
  dismissalOutlivesTransition,
  signInCardRestPos,
  AUTH_POPUP_EDGE,
  SIGNIN_CARD_W,
  CARD_GAP,
  type SignInCardGate,
} from '../src/lib/authPopupBehavior.ts';
import { DOCK_BREAKPOINT, DOCK_WIDTH, SIGNIN_CARD_BREAKPOINT, COOKIE_CORNER_BREAKPOINT } from '../src/lib/responsive.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        ${detail}` : ''}`);
};

// ── 1. WHEN THE SMALL CARD EXISTS — signed-out desktop web on Filter/Agent, until dismissed ──────
const SHOWN: SignInCardGate = { isWeb: true, sideRoom: true, authChecked: true, user: null, dismissed: false, modalOpen: false, pathname: '/' };

check('card SHOWS on the Filter home for a signed-out desktop visitor', shouldShowSignInCard(SHOWN));
check('card SHOWS on the Agent screen too', shouldShowSignInCard({ ...SHOWN, pathname: '/agent' }));
check('LOGGED-IN users never see it',            !shouldShowSignInCard({ ...SHOWN, user: { id: 'u1' } }));
check('LOGGED-IN users never see it (on Agent)', !shouldShowSignInCard({ ...SHOWN, user: { id: 'u1' }, pathname: '/agent' }));
check('HIDDEN while the session is still restoring (no flash at a logged-in visitor)',
  !shouldShowSignInCard({ ...SHOWN, authChecked: false }));
check('HIDDEN on native (web only)',   !shouldShowSignInCard({ ...SHOWN, isWeb: false }));
check('HIDDEN where there is no free column beside the form — the pill + on-demand modal are the way in',
  !shouldShowSignInCard({ ...SHOWN, sideRoom: false }));
check('DISMISS-ON-SEND / close is respected — gone for the rest of this load',
  !shouldShowSignInCard({ ...SHOWN, dismissed: true }));
check('…and holds across Filter↔Agent navigation (no re-appear nag)',
  !shouldShowSignInCard({ ...SHOWN, dismissed: true, pathname: '/agent' }));
check('HIDDEN on every other route', ['/about', '/support', '/browser', '/interview', '/auth']
  .every((pathname) => !shouldShowSignInCard({ ...SHOWN, pathname })));

// THE OWNER'S LOCKED SHOW-MATRIX, row by row. "Fresh", "signed-out", "post-delete" and
// "expired/revoked session" all reduce to the same state the store lands in: user=null,
// authChecked=true, dismissed cleared by the epoch writer — asserted as such, per row:
for (const who of ['fresh visitor', 'signed-out user', 'post-delete user', 'expired/revoked session']) {
  check(`LOCKED matrix: ${who} → card on Filter AND Agent`,
    shouldShowSignInCard({ ...SHOWN, pathname: '/' }) && shouldShowSignInCard({ ...SHOWN, pathname: '/agent' }));
}
check('LOCKED matrix: logged-in → never (any route)',
  ['/', '/agent', '/about'].every((pathname) => !shouldShowSignInCard({ ...SHOWN, user: { id: 'u' }, pathname })));

// MUTUAL EXCLUSION (locked): the open modal suppresses the card; closing it (no login) returns
// the card — because suppression is a separate input, dismissed is untouched by the round-trip.
check('LOCKED modal open ⇒ card suppressed', !shouldShowSignInCard({ ...SHOWN, modalOpen: true }));
check('LOCKED modal closed without login ⇒ card returns', shouldShowSignInCard({ ...SHOWN, modalOpen: false }));
check('LOCKED …but a send-dismissal persists through a modal round-trip',
  !shouldShowSignInCard({ ...SHOWN, dismissed: true, modalOpen: false }));
check('LOCKED successful login ⇒ BOTH gone (user set closes the card; done() closes the modal)',
  !shouldShowSignInCard({ ...SHOWN, user: { id: 'u' }, modalOpen: false }));

// Full truth table: 2^6 × 3 pathnames = 192 combinations; exactly the two good-gate rows show.
{
  let shown = 0, shownSignedIn = 0, shownWithModal = 0;
  for (const isWeb of [true, false]) for (const sideRoom of [true, false])
    for (const authChecked of [true, false]) for (const user of [null, { id: 'u' }])
      for (const dismissed of [true, false]) for (const modalOpen of [true, false])
        for (const pathname of ['/', '/agent', '/about']) {
          const v = shouldShowSignInCard({ isWeb, sideRoom, authChecked, user, dismissed, modalOpen, pathname });
          if (v) shown++;
          if (v && user) shownSignedIn++;
          if (v && modalOpen) shownWithModal++;
        }
  check('exactly TWO of the 192 gate combinations show the card (Filter home + Agent)', shown === 2, `got ${shown}`);
  check('ZERO of the signed-in combinations show it', shownSignedIn === 0, `got ${shownSignedIn}`);
  check('ZERO combinations ever stack the card with the open modal', shownWithModal === 0, `got ${shownWithModal}`);
}

// RETURN-ON-REFRESH is structural: the dismissal is plain component state (verified in WIRING
// below — never persisted), so a fresh load ALWAYS starts at dismissed=false:
check('a fresh load (dismissed=false by construction) shows the card again', shouldShowSignInCard({ ...SHOWN, dismissed: false }));

// ── 2. DRAGGING EXISTS ONLY ON DESKTOP WEB (both surfaces share the gate) ────────────────────────
check('drag ENABLED on desktop web',    canDragAuthPopup({ isWeb: true, docked: true }));
check('drag DISABLED on mobile web',    !canDragAuthPopup({ isWeb: true, docked: false }));
check('drag DISABLED on native',        !canDragAuthPopup({ isWeb: false, docked: true }));
check('drag DISABLED on native mobile', !canDragAuthPopup({ isWeb: false, docked: false }));

// ── 3. DRAG BOUNDS — neither surface can ever be dragged off-screen ──────────────────────────────
{
  // THE SMALL CARD (absolute mode: base {0,0} + its size; the translate IS the position).
  const card = { left: 0, top: 0, width: SIGNIN_CARD_W, height: 340 };
  const vp = { w: 1340, h: 720 };
  const inBounds = (p: { x: number; y: number }) =>
    p.x >= AUTH_POPUP_EDGE && p.y >= AUTH_POPUP_EDGE
    && p.x + card.width <= vp.w - AUTH_POPUP_EDGE && p.y + card.height <= vp.h - AUTH_POPUP_EDGE;
  check('card: a violent throw right/down clamps fully on-screen', inBounds(clampAuthPopupOffset({ x: 1e6, y: 1e6 }, card, vp)));
  check('card: a violent throw left/up clamps fully on-screen',    inBounds(clampAuthPopupOffset({ x: -1e6, y: -1e6 }, card, vp)));
  let all = true;
  for (let x = -2000; x <= 2000; x += 137) for (let y = -2000; y <= 2000; y += 173)
    if (!inBounds(clampAuthPopupOffset({ x, y }, card, vp))) all = false;
  check('card: every offset in a ±2000px sweep clamps fully on-screen', all);
  // WHERE THE CARD RESTS (owner 2026-11-10) — from what is MEASURED on the screen, never from written-down heights.
  const dp = signInCardRestPos({ vw: vp.w, vh: vp.h, cardH: card.height, cookieTop: null });
  check('card: with no cookie card up it rests in the right-hand side slot, on the 0.46 line, in bounds',
    dp.fits && dp.x === vp.w - SIGNIN_CARD_W - AUTH_POPUP_EDGE && dp.y === Math.round(vp.h * 0.46)
    && inBounds(clampAuthPopupOffset(dp, card, vp)));

  // ── 3b. COOKIE-COLLISION GUARD (owner-reported 2026-09-19) — SignInCard and CookieConsent are
  // BOTH right-anchored in the same corner (SignInCard: SIGNIN_CARD_W wide at AUTH_POPUP_EDGE from
  // the right edge; CookieConsent: 280 wide at `right:20`), so whenever their Y ranges overlap they
  // visually collide — reproduced live at 1280×720 production before this fix (card top landed at
  // the fixed-0.46 fraction, well inside the cookie card's own reserved band). The guard is a pure
  // Y-axis check: the card's default position must never let its (padded) bottom edge cross into
  // the cookie card's reserved band, across every realistic desktop/laptop viewport height.
  //
  // MIN_COLLISION_FREE_H is the shortest viewport where avoiding the overlap is even POSSIBLE:
  // stacking SIGNIN_CARD_H + CARD_GAP + COOKIE_RESERVED with AUTH_POPUP_EDGE of top margin literally
  // does not fit in anything shorter, no matter where the card sits — that is a fixed-size layout
  // running out of room, not a positioning defect, so the sweep starts there rather than at 0.
  //
  // REWRITTEN 2026-11-10 (owner: «make sure never ever get this mistake ever. Ever again»). The 2026-09-19 guard
  // above swept a formula built from two WRITTEN-DOWN heights (card 300, cookie band 320) and was green the whole
  // time the two cards sat on each other in English: those were Arabic numbers. Measured on the built app by
  // scripts/verify-web-laptop-nothing-cut-or-covered.mjs — sign-in card 297 px (Arabic) / 350 (English), cookie
  // corner card 293 / 348. The placement now takes what is really on the screen, so this sweep hands it both
  // languages' real sizes, every window height from 400 to 1400, and asks three things at each one:
  //   · when it says the card FITS, the card (plus its gap) really ends above the cookie card and below the top margin;
  //   · it says DOES NOT FIT exactly when stacking the two with their margins is impossible — never "fits" on top
  //     of the cookie card, and never "no room" when there was room;
  //   · it always sits in the right-hand slot.
  {
    const MEASURED = [
      { lang: 'Arabic', cardH: 297, cookieH: 293 },
      { lang: 'English', cardH: 350, cookieH: 348 },
    ];
    const COOKIE_CORNER_BOTTOM = 20;   // CookieConsent's corner card rests 20 px above the window's bottom edge
    let clear = true, honest = true, slot = true, checked = 0, fitted = 0, hidden = 0;
    for (const m of MEASURED) for (const w of [SIGNIN_CARD_BREAKPOINT, COOKIE_CORNER_BREAKPOINT, 1920]) {
      for (let h = 400; h <= 1400; h += 10) {
        checked++;
        const cookieTop = h - COOKIE_CORNER_BOTTOM - m.cookieH;
        const pos = signInCardRestPos({ vw: w, vh: h, cardH: m.cardH, cookieTop });
        const possible = AUTH_POPUP_EDGE + m.cardH + CARD_GAP <= cookieTop;
        if (pos.fits !== possible) honest = false;
        if (pos.x !== w - SIGNIN_CARD_W - AUTH_POPUP_EDGE) slot = false;
        if (pos.fits) { fitted++; if (pos.y < AUTH_POPUP_EDGE || pos.y + m.cardH + CARD_GAP > cookieTop) clear = false; }
        else hidden++;
      }
    }
    check(`card NEVER rests on the cookie card — ${checked} windows (Arabic + English real sizes, 400–1400 px tall)`, clear);
    check('card says "no room" exactly when the two cards cannot both fit — never a guess either way', honest,
      `fitted ${fitted}, no room ${hidden}`);
    check('…and the sweep really met both answers (so neither check above is empty)', fitted > 0 && hidden > 0,
      `fitted ${fitted}, no room ${hidden}`);
    check('card always rests in the right-hand side slot', slot);

    // No cookie card on the page: the only floor is the window's own bottom margin.
    let alone = true;
    for (const m of MEASURED) for (let h = 300; h <= 1400; h += 10) {
      const pos = signInCardRestPos({ vw: 1440, vh: h, cardH: m.cardH, cookieTop: null });
      const possible = AUTH_POPUP_EDGE + m.cardH + AUTH_POPUP_EDGE <= h;
      if (pos.fits !== possible) alone = false;
      if (pos.fits && (pos.y < AUTH_POPUP_EDGE || pos.y + m.cardH > h - AUTH_POPUP_EDGE)) alone = false;
    }
    check('card alone (no cookie card): fully on-screen with the edge margin whenever the window can hold it', alone);

    // The two ordinary laptops the owner sees: where the card lands, in plain numbers.
    const ar900 = signInCardRestPos({ vw: 1440, vh: 900, cardH: 297, cookieTop: 900 - 20 - 293 });
    const en900 = signInCardRestPos({ vw: 1440, vh: 900, cardH: 350, cookieTop: 900 - 20 - 348 });
    const en700 = signInCardRestPos({ vw: 1440, vh: 700, cardH: 350, cookieTop: 700 - 20 - 348 });
    check('1440×900 Arabic: fits, 16 px above the cookie card', ar900.fits && ar900.y + 297 + CARD_GAP === 900 - 20 - 293, JSON.stringify(ar900));
    check('1440×900 English: fits, 16 px above the cookie card', en900.fits && en900.y + 350 + CARD_GAP === 900 - 20 - 348, JSON.stringify(en900));
    check('1440×700 English: NO ROOM — the card waits off-screen instead of sitting on the cookie card', !en700.fits, JSON.stringify(en700));

    // MUTATION 1 — the retired placement, exactly as it shipped: constants 300 / 320 and no measurement. On a
    // 1440×900 English screen it puts the card's bottom edge BELOW the cookie card's top. This is the bug.
    const retiredY = Math.max(AUTH_POPUP_EDGE, Math.min(Math.round(900 * 0.46), 900 - 320 - 300 - CARD_GAP));
    check('MUTATION — the retired written-down-heights placement DOES put the card on the cookie card in English at 1440×900',
      retiredY + 350 > 900 - 20 - 348, `retired y ${retiredY}`);
    // MUTATION 2 — a placement that never admits "no room" pins the card at the top margin and overlaps anyway.
    check('MUTATION — a placement that always says "fits" WOULD overlap at 1440×700 English',
      AUTH_POPUP_EDGE + 350 > 700 - 20 - 348);
    // MUTATION 3 — the even older fixed-0.46 line (the 2026-09-19 report) still overlaps at 720 tall.
    check('MUTATION — the fixed-0.46-of-the-window line DOES overlap the cookie card at 720 px tall',
      Math.round(720 * 0.46) + 297 > 720 - 20 - 293);
  }

  // ── 3c. WHERE THE TWO CARDS MAY EXIST AT ALL (owner 2026-11-10) ────────────────────────────────────────────────
  // Both cards used to switch on where the SIDEBAR docks. The home column is 560 wide, centred in what the docked
  // sidebar leaves, so its right edge sits at  window/2 + DOCK_WIDTH/2 + 280.  A card may only float beside it
  // when its own left edge is to the right of that. The real pixels are measured by the browser robot; this is the
  // same sum on paper, so a breakpoint edited back down fails here first, without a browser.
  {
    const formRight = (vw: number) => vw / 2 + DOCK_WIDTH / 2 + 280;      // the white panel's right edge
    const controlsRight = (vw: number) => formRight(vw) - 12;                // its boxes and buttons (12 px padding)
    const signInLeft = (vw: number) => vw - SIGNIN_CARD_W - AUTH_POPUP_EDGE;
    const cookieLeft = (vw: number) => vw - 280 - 20;
    check('the sign-in card only floats where it clears the search form', signInLeft(SIGNIN_CARD_BREAKPOINT) >= formRight(SIGNIN_CARD_BREAKPOINT),
      `card left ${signInLeft(SIGNIN_CARD_BREAKPOINT)} vs form right ${formRight(SIGNIN_CARD_BREAKPOINT)}`);
    check('the cookie corner card only exists where it clears every box and button of the search form', cookieLeft(COOKIE_CORNER_BREAKPOINT) >= controlsRight(COOKIE_CORNER_BREAKPOINT),
      `card left ${cookieLeft(COOKIE_CORNER_BREAKPOINT)} vs controls right ${controlsRight(COOKIE_CORNER_BREAKPOINT)}`);
    check('MUTATION — at the sidebar\'s dock width (the old switch) BOTH cards would sit on the form',
      signInLeft(DOCK_BREAKPOINT) < formRight(DOCK_BREAKPOINT) && cookieLeft(DOCK_BREAKPOINT) < controlsRight(DOCK_BREAKPOINT));
    check('MUTATION — at 1280 (an ordinary laptop) both would still sit on the form',
      signInLeft(1280) < formRight(1280) && cookieLeft(1280) < controlsRight(1280));
  }

  // THE CENTERED MODAL (offset mode) keeps its own bounds.
  const modal = { left: 435, top: 160, width: 470, height: 400 };
  const mIn = (o: { x: number; y: number }) => {
    const l = modal.left + o.x, t2 = modal.top + o.y;
    return l >= AUTH_POPUP_EDGE && t2 >= AUTH_POPUP_EDGE
      && l + modal.width <= vp.w - AUTH_POPUP_EDGE && t2 + modal.height <= vp.h - AUTH_POPUP_EDGE;
  };
  check('modal: throws in both directions still clamp fully on-screen',
    mIn(clampAuthPopupOffset({ x: 1e6, y: 1e6 }, modal, vp)) && mIn(clampAuthPopupOffset({ x: -1e6, y: -1e6 }, modal, vp)));
  // Taller than the viewport: the range inverts; the TOP (grab) edge must win.
  const tall = { left: 435, top: -100, width: 470, height: 900 };
  const r = clampAuthPopupOffset({ x: 0, y: 1e6 }, tall, { w: 1340, h: 700 });
  check('a surface taller than the viewport pins its TOP (grab) edge on-screen',
    tall.top + r.y === AUTH_POPUP_EDGE, `top ended at ${tall.top + r.y}`);
}

// ── 4. THE LARGE AUTO-SHOW IS GONE — removed decision, not a hidden one ──────────────────────────
const root = join(import.meta.dirname, '..');
const SRC = (f: string) => readFileSync(join(root, 'src', f), 'utf8');
const layout = SRC('app/_layout.tsx');
const authModal = SRC('components/AuthModal.tsx');
const signInCard = SRC('components/SignInCard.tsx');
const store = SRC('store.tsx');
const filter = SRC('app/index.tsx');
const agent = SRC('app/agent.tsx');
const behavior = SRC('lib/authPopupBehavior.ts');

check('shouldAutoShowAuthPopup no longer EXISTS (the auto-show decision is deleted, not bypassed)',
  !behavior.includes('shouldAutoShowAuthPopup') && !layout.includes('shouldAutoShowAuthPopup'));
// Comment-stripped (provenance comments citing openAuth are welcome; a CODE call is the breach —
// same convention as verify-single-auth-invitation.ts).
const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const stripLine = stripComments;   // code only — a comment may name a retired constant, code may not use it
check('the layout never CALLS openAuth — nothing raises the centered modal unprompted',
  !stripComments(layout).includes('openAuth'));
check('closeAuth is a plain state close again (no sessionStorage dismissal stamp)',
  store.includes('closeAuth: () => setAuthOpen(false)') && !store.includes('AUTH_POPUP_DISMISSED_KEY'));
check('AuthModal renders nothing unless explicitly opened', authModal.includes('if (!authOpen) return null;'));

// ── 5. ONE AUTH UI, TWO PRESENTATIONS — the card renders the SAME AuthForm, no duplicate system ──
check('AuthModal exports AuthForm and its Sheet renders it', authModal.includes('export function AuthForm(')
  && authModal.includes('<AuthForm onRequestClose={close} onSignedIn={onSignedIn}'));
check('SignInCard renders the SAME AuthForm compact — full login inside the card',
  /import \{ AuthForm(, AuthSky)? \} from '@\/components\/AuthModal'/.test(signInCard)
  && signInCard.includes('<AuthForm compact onRequestClose={dismissSignInCard} onSignedIn={signIn} />'));
check('SignInCard hosts NO auth logic of its own (providers live only in the shared form)',
  !signInCard.includes('signInWithProvider') && !signInCard.includes('verifyPhoneOtp') && !signInCard.includes('sendPhoneOtp'));

// ── 6. CARD WIRING ───────────────────────────────────────────────────────────────────────────────
check('WIRING SignInCard delegates its visibility to the pure gate',
  signInCard.includes('shouldShowSignInCard({'));
check('WIRING the card is mounted exactly once, AFTER the Stack (its phone <input> must never become the page’s first input)',
  (layout.match(/<SignInCard \/>/g) ?? []).length === 1
  && layout.indexOf('<SignInCard />') > layout.indexOf('</Stack>'));
check('WIRING the card drags via the shared machinery with its own position memory',
  signInCard.includes('attachCardDrag(node, grip, {') && signInCard.includes('SIGNIN_CARD_POS_KEY')
  && signInCard.includes('signInCardRestPos({'));
// Owner 2026-11-10 — the four wires that keep the card off the form and off the cookie card. Each one was the
// missing piece of a measured failure, so each is pinned by name.
check('WIRING the card exists only where a free column exists (its own breakpoint, through useAtLeast)',
  signInCard.includes('const sideRoom = useAtLeast(SIGNIN_CARD_BREAKPOINT);') && /\n\s*sideRoom,\n/.test(signInCard)
  && !stripLine(signInCard).includes('DOCK_BREAKPOINT'));
check('WIRING the card goes back to its measured slot when the window changes (rest slot handed to the drag)',
  /initial: slot,\s*rest: slot,/.test(signInCard));
check('WIRING the card is taken OFF the screen when there is no room for it (and a dragged card is left alone)',
  signInCard.includes('show(drag.pinned() || room().fits);') && signInCard.includes("node.style.visibility = 'hidden';")
  && signInCard.includes("node.style.pointerEvents = on ? '' : 'none';"));
check('WIRING the card hears the cookie card arrive, resize and leave',
  signInCard.includes("observeOwnDockedCard(() => settle('cookie'))") && signInCard.includes('OWN_DOCKED_PROMPT_SELECTOR'));
{
  const cookie = SRC('components/CookieConsent.tsx');
  const inset = SRC('lib/bottomPromptInset.ts');
  check('WIRING the cookie card is a corner card only where a free corner exists (its own breakpoint)',
    cookie.includes('const beside = useAtLeast(COOKIE_CORNER_BREAKPOINT);') && !stripLine(cookie).includes('DOCK_BREAKPOINT'));
  check('WIRING "faded out" and "gone" are two different answers (or the card waiting for room never hears it left)',
    /return rects\.length \? \{ top: -3, bottom: -3 \} : \{ top: -2, bottom: -2 \};/.test(inset));
}
// Owner 2026-09-03: the centered modal starts PERFECTLY CENTERED on every open — dragging only
// changes its position after the user moves it, and only for that open. So: no posKey (the small
// card keeps its own memory above).
check('WIRING the modal drags via the SAME shared machinery (owner-loved, kept) with NO position memory',
  authModal.includes('attachCardDrag(node, grip, {') && !/posKey:/.test(authModal)
  && authModal.includes('clamp: clampOffsetOnScreen(node)'));
check('WIRING card clamps through clampAuthPopupOffset (absolute mode)',
  signInCard.includes('clampAuthPopupOffset('));
check('WIRING testIDs: signin-card / signin-card-drag-handle; the close X is the shared auth-popup-close',
  signInCard.includes("testid: 'signin-card'") && signInCard.includes("testid: 'signin-card-drag-handle'")
  && authModal.includes("testid: 'auth-popup-close'"));
// Owner 2026-09-03: the CENTERED modal has no × on its main step (a press on the ground closes it);
// the compact card keeps its × (its dismissal) and the preview-only inner steps keep the back chevron.
check('the centered modal renders NO × on its main step; the compact card and inner steps keep theirs',
  authModal.includes("{(cp || step !== 'main') && (") && authModal.includes('onPress={() => backRef.current()}'));
check('NO email (or any) text input on the sign-in surfaces — Google and Apple only (owner 2026-09-03)',
  !/<TextInput/.test(authModal) && !/TextInput/.test(authModal.slice(0, authModal.indexOf('export default')))
  && authModal.includes("t('Continue with Google')") && authModal.includes("t('Continue with Apple')"));
check('the agreement sentence links to the legal reader ONLY when real legal text exists (never a link to nothing)',
  authModal.includes('const legalLive = hasLegalDocs();') && /legalLive \? \(/.test(authModal)
  && authModal.includes("onPress={() => openModal('legal')}"));
// Owner 2026-10-24: the card is painted by the shared AuthSky (sky blue light / dusk sky dark), not a flat surface.
check('WIRING themed from birth: the card paints with the shared AuthSky + token roles, no hardcoded surface hexes',
  signInCard.includes('<AuthSky ') && signInCard.includes('colors.fieldLine')
  && !/backgroundColor:\s*'#/.test(signInCard));

// ── 7. DISMISS-ON-SEND — both send sites, and NOTHING persists the flag ──────────────────────────
check('WIRING Filter search submit dismisses the card (successful path only)',
  /dismissSignInCard\(\);\s*\n\s*router\.push\(\{ pathname: '\/agent'/.test(filter));
check('WIRING Agent send() dismisses the card after its guard (voice funnels into the same send)',
  /if \(!v \|\| busy\) return;[\s\S]{0,400}?dismissSignInCard\(\);/.test(agent)
  && agent.includes('void send(merged)'));
check('WIRING the dismissal is IN-MEMORY state — a refresh MUST bring the card back',
  store.includes('const [signInCardDismissed, setSignInCardDismissed] = useState(false);')
  && store.includes('dismissSignInCard: () => setSignInCardDismissed(true)')
  && !/(sessionStorage|localStorage|AsyncStorage)[\s\S]{0,80}?signInCardDismiss/i.test(store));
check('WIRING position memory is the ONLY persistence (sessionStorage key for pos, none for dismissal)',
  behavior.includes("SIGNIN_CARD_POS_KEY = 'ezhalah.signInCard.pos'") && !/DISMISSED_KEY/.test(behavior));

// THE THREE-AND-ONLY-THREE DISMISSAL TRIGGERS (locked): Filter search submit, Agent message send,
// the card's own X. Counted across the whole src tree — a fourth caller (a typing handler, a
// filter chip, a property option) is exactly the regression the owner enumerated as forbidden.
{
  const { readdirSync, statSync } = await import('node:fs');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const q = join(dir, n);
    return statSync(q).isDirectory() ? walk(q) : /\.(ts|tsx)$/.test(n) ? [q] : [];
  });
  const callers: string[] = [];
  for (const f of walk(join(root, 'src'))) {
    const t2 = readFileSync(f, 'utf8');
    const n = (t2.match(/dismissSignInCard\(\)/g) ?? []).length;
    for (let i = 0; i < n; i++) callers.push(f.slice(root.length + 1));
  }
  const expected = ['src/app/agent.tsx', 'src/app/index.tsx', 'src/components/SignInCard.tsx'];
  check('LOCKED exactly THREE dismissal call sites: Filter send, Agent send, the card X',
    callers.length === 3 && expected.every((e) => callers.includes(e)), `callers: ${callers.join(', ')}`);
  // The X: SignInCard passes dismissSignInCard as onRequestClose (a reference, not a call) — count
  // that as the third writer explicitly:
  check('LOCKED the card X is the third writer (onRequestClose={dismissSignInCard})',
    signInCard.includes('onRequestClose={dismissSignInCard}'));
  // NON-TRIGGERS (locked, each enumerated by the owner): typing, clicking filters, selecting
  // property options. Structural form: no onChangeText / onChange handler anywhere calls the
  // dismissal, and neither Filter nor Agent references it outside its ONE send site.
  check('LOCKED typing never dismisses (no text-change handler touches dismissSignInCard)',
    !/onChangeText=[^\n]*dismissSignInCard/.test(filter) && !/onChangeText=[^\n]*dismissSignInCard/.test(agent));
  check('LOCKED Filter has exactly ONE dismissal call (the search submit) — chips/options cannot hide it',
    (filter.match(/dismissSignInCard\(\)/g) ?? []).length === 1);
  check('LOCKED Agent has exactly ONE dismissal call (send) — typing/focus cannot hide it',
    (agent.match(/dismissSignInCard\(\)/g) ?? []).length === 1);
}

// ── 8. MODAL PRESERVED — mobile responsive cap, desktop wide, on-demand only ─────────────────────
check('modal keeps the mobile 400 cap and the desktop 500 width (owner 2026-09-03)', authModal.includes('maxWidth: 400')
  && authModal.includes('popWrapWide: { maxWidth: 500 }'));
check('modal drag still gated by canDragAuthPopup', authModal.includes("canDragAuthPopup({ isWeb: Platform.OS === 'web', docked })"));

// ═══ THE AUTH EPOCH (#1214) — retargeted to the card's in-memory flag ════════════════════════════
check('EPOCH a sign-IN transition voids the dismissal',  !dismissalOutlivesTransition(false, true));
check('EPOCH a sign-OUT / deletion transition voids it', !dismissalOutlivesTransition(true, false));
check('EPOCH no transition keeps it (Filter↔Agent nav within one epoch)',
  dismissalOutlivesTransition(false, false) && dismissalOutlivesTransition(true, true));
{
  type World = { signedIn: boolean; dismissed: boolean };
  const transition = (w: World, nowSignedIn: boolean): World => ({
    signedIn: nowSignedIn,
    dismissed: dismissalOutlivesTransition(w.signedIn, nowSignedIn) ? w.dismissed : false,
  });
  const cardOn = (w: World, pathname = '/') => shouldShowSignInCard({
    isWeb: true, sideRoom: true, authChecked: true, user: w.signedIn ? { id: 'u' } : null,
    dismissed: w.dismissed, modalOpen: false, pathname,
  });
  let w: World = { signedIn: false, dismissed: false };
  check('J1 fresh visitor: card shows', cardOn(w));
  w = { ...w, dismissed: true };                       // sends a search
  check('J2 after sending: card gone, stays gone across nav', !cardOn(w) && !cardOn(w, '/agent'));
  w = transition(w, true);                             // signs in via the sidebar CTA → modal
  check('J3 signed in: never', !cardOn(w));
  const out = transition(w, false);                    // signs out / deletes the account
  check('J4 sign-out lands in the canonical logged-out state: card RETURNS', cardOn(out) && cardOn(out, '/agent'),
    'a stale dismissal must not survive the transition');
  check('J5 refresh (fresh state) after anything: card returns', cardOn({ signedIn: false, dismissed: false }));
}
{
  const s2 = store.slice(store.indexOf('prevSignedInRef'), store.indexOf('prevSignedInRef') + 900);
  check('WIRING the store clears the card dismissal through the pure epoch rule (one writer)',
    /dismissalOutlivesTransition\(prev, now\)/.test(store) && /setSignInCardDismissed\(false\)/.test(s2));
  check('WIRING the writer skips the mount pass', /prev === null \|\| dismissalOutlivesTransition/.test(store));
  check('WIRING it watches the user value itself (covers onAuthStateChange deaths)', /\}, \[user\]\);/.test(s2));
}

// ── in-file MUTATION DEMONSTRATIONS (the real proofs are run against the tree) ───────────────────
{
  const noUserGate = (g: SignInCardGate) => shouldShowSignInCard({ ...g, user: null });  // "forgot" the user gate
  check('MUT a card shown to a signed-in user would be caught',
    noUserGate({ ...SHOWN, user: { id: 'u' } }) !== shouldShowSignInCard({ ...SHOWN, user: { id: 'u' } }));
  const noDismiss = (g: SignInCardGate) => shouldShowSignInCard({ ...g, dismissed: false }); // "forgot" dismissal
  check('MUT a card ignoring dismissal (send does nothing) would be caught',
    noDismiss({ ...SHOWN, dismissed: true }) !== shouldShowSignInCard({ ...SHOWN, dismissed: true }));
  const rawClamp = (p: { x: number; y: number }) => p;                                    // clamp removed
  check('MUT an unclamped drag would be caught',
    rawClamp({ x: 1e6, y: 1e6 }).x !== clampAuthPopupOffset({ x: 1e6, y: 1e6 }, { left: 0, top: 0, width: SIGNIN_CARD_W, height: 340 }, { w: 1340, h: 720 }).x);
  const storeText = readFileSync(join(root, 'src/store.tsx'), 'utf8');
  // SUPERSEDED (owner 2026-08-28/29, appearance-auth-lifecycle): the Light reset moved from
  // AccountMenu's screen handler into the store's OWN completed-action paths — deleteAccount()
  // resets after the server-confirmed guard, and (new rule, superseding «sign-out keeps the
  // theme») signOut() resets too: the appearance is an authenticated-user asset, so EVERY
  // completed transition to signed-out lands in the canonical Light guest state with the stored
  // keys cleared. The deep matrix lives in scripts/verify-appearance-lifecycle.ts; these pins keep
  // THIS file's canonical-logged-out-state story true against the real wiring.
  const delBodyStart = storeText.indexOf('deleteAccount: async () => {');
  const delBody = storeText.slice(delBodyStart, storeText.indexOf('return true;', delBodyStart));
  check('WIRING deletion returns the app to Light (owner rule) — reset in the store, after the guard',
    delBody.indexOf('resetThemeForSignOut()') > delBody.indexOf('if (!serverDeleted) return false;')
    && delBody.includes('if (!serverDeleted) return false;'));
  check('WIRING …but a FAILED deletion changes nothing (no reset before the server confirms)',
    delBody.indexOf('if (!serverDeleted) return false;') !== -1
    && !delBody.slice(0, delBody.indexOf('if (!serverDeleted) return false;')).includes('resetThemeForSignOut'));
  const signOutBody = storeText.slice(storeText.indexOf('signOut: () => {'), delBodyStart);
  check('WIRING sign-out ALSO resets to Light (owner 2026-08-28/29 — supersedes the deletion-only rule)',
    signOutBody.includes('resetThemeForSignOut()'));
}

// ── MUTATION PROOFS for the epoch ────────────────────────────────────────────────────────────────
{
  const inverted = (a: boolean, b: boolean) => a !== b;      // keeps the flag exactly when it must clear
  check('MUT-E1 an inverted epoch rule is DETECTED',
    inverted(true, false) !== dismissalOutlivesTransition(true, false));
  const sticky = (_a: boolean, _b: boolean) => true;          // the pre-fix behaviour: flag never clears
  check('MUT-E2 the pre-fix behaviour (dismissal survives deletion) is DETECTED',
    sticky(true, false) !== dismissalOutlivesTransition(true, false));
  const trigger = (_a: boolean, _b: boolean) => false;        // clears on every pass → dismissal dead
  check('MUT-E3 clearing without a transition (kills the no-nag rule) is DETECTED',
    trigger(false, false) !== dismissalOutlivesTransition(false, false));

}

if (failed) {
  console.error(`\n❌ verify-auth-popup: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\n✅ verify-auth-popup: the sign-in surfaces contract holds');
