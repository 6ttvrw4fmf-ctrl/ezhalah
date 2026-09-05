// ═══════════════════════════════════════════════════════════════════════════════════════════════
// GUARDIAN JOURNEYS — eight production journeys over the surfaces with ZERO live browser coverage.
//
// Each journey declares `surface`, drawn from the vocabulary public.incident_route_owner() routes
// to an owning routine (supabase/migrations/20260904144004_incident_spine…sql). That is what makes
// a failure ARRIVE somewhere instead of being printed into a log nobody reads.
//
// EVERY JOURNEY IS SIGNED OUT AND READ-ONLY. Two of the eight are therefore driven through the
// guest-reachable form of their contract rather than the signed-in control — noted inline, at the
// journey, so nobody later "fixes" it by adding a sign-in:
//   • G2 uses the RELOAD trigger of New Chat (owner 2026-08-16), because the sidebar's «محادثة
//     جديدة» button renders only for a signed-in user (src/components/Sidebar.tsx: `{user ? …}`).
//   • G4 returns from the listing's EXTERNAL tab, because on web a card opens `window.open` (see
//     src/lib/openListing.ts) and never navigates the results tab — plus the real browser-Back,
//     asserted for what production actually does with it.
//
// Assertions are SHAPE, never inventory: no counts, no listing ids, no platform names.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import {
  BASE, HarnessError, bodyText, contrastRatio, countVisible, dismissAuthInvitation,
  loadersPresent, ok, open, parseColor, pickCity, relativeLuminance, resultsState, runSearch,
  searchAsGuest, sleep, tap, until, violated,
} from './harness.mjs';

// ── G1 · theme ───────────────────────────────────────────────────────────────────────────────────
// WHAT THIS ASSERTS, AND WHY IT IS NOT "the guest app must be dark".
// The owner ruled 2026-08-28 that appearance is an AUTHENTICATED-user asset: signed out the app is
// ALWAYS Light, pinned by both the pre-hydration boot script (+html.tsx) and ThemeProvider
// (src/theme/theme.tsx: `if (!auth.signedIn) d.setAttribute('data-theme','light')`). A journey that
// demanded a dark ground for a guest would therefore fail every single night against a product that
// is exactly right — the cry-wolf failure this suite exists to avoid. So the honest dark-mode
// invariants, all of which are real regressions when broken, are:
//   (a) under prefers-color-scheme: dark the guest pin HOLDS — data-theme="light" and a genuinely
//       light ground. That is the "sticky dark" bug class the owner has personally reported.
//   (b) the DARK palette production actually serves is genuinely dark AND readable — dark paper,
//       light ink, WCAG-passing contrast between them. Read out of the live stylesheet, so a dark
//       palette that ships same-tone text on same-tone paper is caught before anyone signs in.
//   (c) no visible text renders at near-zero contrast against its own background, in EITHER media
//       setting. Computed styles, never pixels.
const DARK_PAPER_MAX_LUM = 0.05;   // #171717 ≈ 0.0075
const LIGHT_PAPER_MIN_LUM = 0.70;  // #fbfbfa ≈ 0.97
const PALETTE_MIN_CONTRAST = 4.5;  // WCAG AA body text
// Deliberately far below "readable" (AA is 4.5). This journey hunts INVISIBLE text — same-tone on
// same-tone, which lands at ~1.0 — not styling opinions. A threshold near AA would turn every
// muted caption and hairline label into a nightly incident.
const INVISIBLE_TEXT_MAX_CONTRAST = 1.35;
// A painted home screen carries well over a hundred text leaves; anything near zero means the read
// happened before the app rendered, which is a harness fact, not a product one.
const MIN_TEXT_SAMPLES = 25;

/** Both palettes as production serves them, read out of the live stylesheet. */
const readPalettes = (page) => page.evaluate(() => {
  const want = ['--ez-paper', '--ez-ink'];
  const out = { light: {}, dark: {}, sawDarkRule: false };
  const take = (into, text) => { for (const v of want) { const m = text.match(new RegExp(`${v}\\s*:\\s*([^;]+);`)); if (m) into[v] = m[1].trim(); } };
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules) {
      const text = rule.cssText || '';
      if (/^:root\s*\{/.test(text)) take(out.light, text);
      if (text.includes('[data-theme="dark"]') && !text.includes('@media')) { out.sawDarkRule = true; take(out.dark, text); }
    }
  }
  return out;
});

/**
 * Every visible text leaf, with its own colour and the first opaque background behind it.
 * Elements sitting over a background IMAGE are skipped: their effective backdrop is the picture,
 * which a computed-style oracle cannot see — accusing the product of a contrast failure it cannot
 * verify is exactly the blindness-as-defect mistake this suite must not make.
 */
const textContrastSamples = (page) => page.evaluate(() => {
  const out = [];
  const opaque = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return false; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length < 4 || p[3] > 0.9; };
  for (const el of document.querySelectorAll('*')) {
    if (el.children.length !== 0) continue;
    const text = (el.textContent || '').trim();
    if (!text) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none') continue;
    if (parseFloat(st.fontSize) < 10) continue;
    if (!opaque(st.color)) continue;
    let effOpacity = 1, node = el, bg = null, overImage = false;
    while (node && node !== document.documentElement) {
      const ns = getComputedStyle(node);
      effOpacity *= Number(ns.opacity);
      if (ns.backgroundImage && ns.backgroundImage !== 'none') overImage = true;
      if (!bg && opaque(ns.backgroundColor)) bg = ns.backgroundColor;
      node = node.parentElement;
    }
    if (effOpacity < 0.9 || overImage) continue;
    if (!bg) bg = getComputedStyle(document.documentElement).getPropertyValue('--ez-paper').trim() || null;
    if (!bg) continue;
    out.push({ text: text.slice(0, 40), color: st.color, bg, tag: el.tagName });
  }
  return out;
});

/** Poll until the painted text stops changing: the home screen fades in, so an eager read is a lie. */
async function stableTextSamples(page, budgetMs = 30000) {
  let samples = [];
  let last = -1;
  let stable = 0;
  await until(async () => {
    samples = await textContrastSamples(page);
    if (samples.length >= MIN_TEXT_SAMPLES && samples.length === last) stable += 1;
    else { stable = 0; last = samples.length; }
    return stable >= 2;
  }, budgetMs, 800);
  return samples;
}

const G1 = {
  id: 'dark-mode-is-honest',
  title: 'Dark mode is honest: the guest light-pin holds, the dark palette is genuinely dark and readable, and no text is invisible',
  surface: 'theme',
  steps: [
    'Open https://ezhalah-app.vercel.app/ with prefers-color-scheme: dark.',
    'Read documentElement[data-theme] and the resolved --ez-paper / --ez-ink.',
    'Read the :root and :root[data-theme="dark"] rules out of the live stylesheet.',
    'Sample every visible text leaf and compare its colour with the first opaque background behind it.',
    'Reload with prefers-color-scheme: light and repeat.',
  ],
  async run(page, ctx) {
    const bad = [];
    const evidence = {};
    for (const scheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, '/');
      // The theme is applied in an effect after auth is known, so poll for the attribute to settle
      // instead of sampling one frame — a mid-boot read is a harness artefact, not a product fact.
      const settled = await until(async () => (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) !== null, 20000);
      if (!settled) throw new HarnessError(`data-theme never settled under prefers-color-scheme: ${scheme}`);

      const state = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        return {
          dataTheme: document.documentElement.getAttribute('data-theme'),
          paper: cs.getPropertyValue('--ez-paper').trim(),
          ink: cs.getPropertyValue('--ez-ink').trim(),
          prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
        };
      });
      evidence[scheme] = state;

      // (a) the guest pin.
      if (state.dataTheme !== 'light') {
        bad.push(`prefers-color-scheme:${scheme} — a signed-out visitor resolved data-theme="${state.dataTheme}"; the owner's 2026-08-28 rule is that guests are ALWAYS pinned Light`);
      }
      const paper = parseColor(state.paper);
      if (!paper) throw new HarnessError(`--ez-paper did not resolve to a colour (${state.paper})`);
      const paperLum = relativeLuminance(paper);
      if (paperLum < LIGHT_PAPER_MIN_LUM) {
        bad.push(`prefers-color-scheme:${scheme} — the guest ground painted ${state.paper} (luminance ${paperLum.toFixed(3)}), which is not a light ground; the light pin did not reach the paint`);
      }

      // (c) nothing invisible.
      const samples = await stableTextSamples(page);
      // Below this the screen is still animating in and "nothing looked wrong" would be a statement
      // about an empty sample, not about the product. Measured 2026-09-04: a read taken one second
      // after load saw NINE text leaves on desktop and ZERO on a phone — the home screen's entrance
      // starts every element at opacity 0, so an eager oracle reads an unpainted page and passes.
      if (samples.length < MIN_TEXT_SAMPLES) {
        throw new HarnessError(`only ${samples.length} painted text samples under prefers-color-scheme: ${scheme} — the screen never finished painting, nothing can be concluded`);
      }
      const rated = samples
        .map((s) => ({ ...s, ratio: (() => { const f = parseColor(s.color), b = parseColor(s.bg); return f && b ? contrastRatio(f, b) : null; })() }))
        .filter((s) => s.ratio != null);
      const invisible = rated.filter((s) => s.ratio < INVISIBLE_TEXT_MAX_CONTRAST);
      const worst = rated.reduce((m, s) => (m == null || s.ratio < m.ratio ? s : m), null);
      // The worst ratio is recorded on every run, pass or fail: a threshold nobody can see the
      // headroom of is a threshold that gets tuned by guesswork the first time it fires.
      evidence[`${scheme}_samples`] = samples.length;
      evidence[`${scheme}_worst_contrast`] = worst ? { ratio: Number(worst.ratio.toFixed(2)), text: worst.text, color: worst.color, bg: worst.bg } : null;
      for (const s of invisible.slice(0, 6)) {
        bad.push(`prefers-color-scheme:${scheme} — «${s.text}» renders ${s.color} on ${s.bg} (contrast ${s.ratio.toFixed(2)}:1) — text on a same-tone background`);
      }

      // (b) the dark palette itself, once (it is the same stylesheet in both media).
      if (scheme === 'dark') {
        const pal = await readPalettes(page);
        evidence.palettes = pal;
        if (!pal.sawDarkRule) {
          bad.push('the served stylesheet carries no :root[data-theme="dark"] rule — a signed-in user choosing Dark would get the light palette');
        } else {
          const dp = parseColor(pal.dark['--ez-paper']);
          const di = parseColor(pal.dark['--ez-ink']);
          if (!dp || !di) {
            bad.push(`the dark rule does not define both --ez-paper and --ez-ink (paper=${pal.dark['--ez-paper']}, ink=${pal.dark['--ez-ink']})`);
          } else {
            const lum = relativeLuminance(dp);
            if (lum > DARK_PAPER_MAX_LUM) bad.push(`the DARK palette's --ez-paper is ${pal.dark['--ez-paper']} (luminance ${lum.toFixed(3)}) — that is not a dark ground`);
            const ratio = contrastRatio(di, dp);
            if (ratio < PALETTE_MIN_CONTRAST) bad.push(`the DARK palette renders ink ${pal.dark['--ez-ink']} on paper ${pal.dark['--ez-paper']} at ${ratio.toFixed(2)}:1 — below WCAG AA (${PALETTE_MIN_CONTRAST}:1)`);
          }
        }
      }
    }
    if (ctx.pageErrors.length) bad.push(`uncaught page error while switching appearance: ${ctx.pageErrors[0]}`);
    return bad.length ? violated(bad, evidence) : ok(evidence);
  },
};

// ── G2 · chat_persistence ────────────────────────────────────────────────────────────────────────
// NEW CHAT MUST START BLANK. The store's newChat() resets the query and lets agent.tsx's component
// state be destroyed by navigating to '/' (src/store.tsx). The sidebar button that calls it renders
// only when signed in, so the guest-reachable trigger for the same contract is a RELOAD of the
// results URL — the owner's 2026-08-16 ruling, "a refresh must start a new chat and execute
// nothing", which scripts/verify-web-runtime-smoke.mjs Journey B pins against a LOCAL build and
// nothing pins against production.
const G2 = {
  id: 'new-chat-starts-blank',
  title: 'New Chat starts blank: no result cards, no Advanced-Filter card, no carried-over composer text, and no search RPC',
  surface: 'chat_persistence',
  steps: [
    'Open https://ezhalah-app.vercel.app/, dismiss the sign-in card, pick الرياض and press «بحث».',
    'Wait for results (cards + count chip).',
    'Trigger New Chat: reload the results URL (the guest-reachable form of newChat(); the sidebar button is signed-in only).',
    'Count result cards, af-card, non-empty composers and property-search RPCs after the reload.',
  ],
  async run(page, ctx) {
    await searchAsGuest(page);
    const before = await resultsState(page);
    if (!before.cards) throw new HarnessError('the search produced no cards to clear — nothing to prove about New Chat');

    const searchesBefore = ctx.searches.length;
    await page.reload({ waitUntil: 'load', timeout: 90000 })
      .catch((e) => { throw new HarnessError(`reload failed: ${String(e).slice(0, 160)}`); });
    const booted = await until(() => page.$('[data-testid="city-input"],[data-testid^="card-listing-"]'), 45000);
    if (!booted) throw new HarnessError('the app never re-rendered after the reload');
    // Let anything the new chat WOULD do actually happen before judging that it did not.
    await sleep(6000);

    const after = await resultsState(page);
    const fired = ctx.searches.length - searchesBefore;
    const bad = [];
    if (after.cards > 0) bad.push(`New Chat left ${after.cards} result card(s) on screen`);
    if (after.afCards > 0) bad.push(`New Chat left ${after.afCards} Advanced-Filter card(s) on screen`);
    if (after.countChip) bad.push(`New Chat left the previous count chip «لقينا ${after.countChip}» on screen`);
    const dirty = after.composers.filter((v) => v.trim().length > 0);
    if (dirty.length) bad.push(`New Chat left text in the composer: ${JSON.stringify(dirty.slice(0, 2))}`);
    if (fired > 0) bad.push(`New Chat fired ${fired} property-search RPC(s) — it must execute nothing`);
    return bad.length
      ? violated(bad, { before, after, searchesFired: fired })
      : ok({ before, after, searchesFired: fired });
  },
};

// ── G3 · auth ────────────────────────────────────────────────────────────────────────────────────
// Google and Apple ONLY (owner ruling 2026-09-01). Phone/WhatsApp OTP was removed; scripts/
// verify-no-phone-auth.ts pins it in the SOURCE — this pins it in what production actually renders.
const PHONE_MARKERS = /رقم الجوال|رقم الهاتف|رمز التحقق|واتساب|WhatsApp|\bOTP\b|\+966/;
/** The always-present entry point that raises the auth surface on demand (both viewports). */
const SIGNIN_ENTRY = 'إنشاء حساب / تسجيل الدخول';

/** Everything about the auth surface as a guest sees it, in one read. */
const authSurface = (page) => page.evaluate((phoneSrc) => {
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(e);
    return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.01;
  };
  // ONE invitation = one auth-popup-close.
  //
  // KNOWN DEFECT, ROUTED NOT PATCHED (incident hunt-2026-09-04:auth:22). The owner's 2026-09-04 popup
  // redesign removed the × from the sign-in sheet, so on a phone — where the desktop signin-card does
  // not exist and the invitation is the centred AuthModal — this counts 0 and the journey reports
  // «the only sign-in entry point at this viewport is dead» against a modal that is open and correct.
  // Measured on production: auth-popup-close 0, signin-card 0, Google button 1, heading present.
  //
  // Counting the Google button instead was TRIED HERE and made things WORSE: dismissAuthInvitation
  // verifies the same way, and with no × and no working Escape it returned 'stuck', which took the
  // suite from 15 PASS / 1 FAIL / 0 UNDETERMINED to 11 / 0 / 5 — the auth modal then covered the city
  // field and broke four unrelated mobile journeys. Reverted. The detector and the DISMISSAL have to
  // change together, with a real dismissal mechanism for a sheet that has no ×, and that is routine
  // #6's surface. Left exactly as main had it so the failure stays a single, honest, known one.
  const invitations = [...document.querySelectorAll('[data-testid="auth-popup-close"]')].filter(vis);
  const scope = invitations.map((c) => c.closest('[data-testid="signin-card"]') || c.parentElement?.parentElement?.parentElement || document.body);
  const text = scope.map((s) => s.innerText || '').join('\n') || document.body.innerText;
  const phoneFields = [...document.querySelectorAll('input')].filter(vis).filter((e) => {
    const hay = `${e.type} ${e.placeholder} ${e.inputMode} ${e.name} ${e.autocomplete}`;
    return e.type === 'tel' || /tel|phone|otp|one-time/i.test(hay);
  }).map((e) => e.placeholder || e.type);
  // Is the primary CTA reachable, or does the invitation sit on top of it?
  let ctaCovered = null;
  for (const e of document.querySelectorAll('*')) {
    if (e.children.length === 0 && (e.textContent || '').trim() === 'بحث') {
      e.scrollIntoView({ block: 'center' });
      const r = e.getBoundingClientRect();
      if (r.width && r.height && r.top >= 0 && r.bottom <= innerHeight) {
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        ctaCovered = top ? !!(top.closest('[data-testid="signin-card"]') || top.closest('[data-testid="auth-popup-close"]')) : null;
      }
      break;
    }
  }
  return {
    invitations: invitations.length,
    offersGoogle: /Google/.test(text),
    offersApple: /Apple/.test(text),
    phoneText: new RegExp(phoneSrc).test(text),
    phoneFields,
    ctaCovered,
  };
}, PHONE_MARKERS.source);

const G3 = {
  id: 'signed-out-auth-surface',
  title: 'Signed out: exactly one auth invitation, Google and Apple only, no phone/OTP field, dismissal sticks, and it never covers «بحث»',
  surface: 'auth',
  steps: [
    'Open https://ezhalah-app.vercel.app/ signed out and read the auth invitation.',
    'Assert exactly one invitation is visible, that it offers Google and Apple, and that no phone/OTP field or copy is present.',
    'Assert the invitation does not cover the primary «بحث» control.',
    'If no invitation is offered at this viewport, press «إنشاء حساب / تسجيل الدخول» to open one and repeat those assertions.',
    'Open the sidebar sign-in entry point and assert there is still exactly one invitation.',
    'Dismiss the invitation, switch to الوكيل الذكي and back to تصفية, and assert it stays dismissed.',
  ],
  async run(page, ctx) {
    await open(page, '/');
    const bad = [];
    const seen = {};
    // The card mounts a beat after the form; poll for it rather than judging an unpainted frame.
    await until(async () => (await authSurface(page)).invitations > 0, 12000);

    const check = (label, s) => {
      seen[label] = s;
      if (s.invitations > 1) bad.push(`${label}: ${s.invitations} auth invitations visible at once — there must be exactly one`);
      if (s.invitations === 1) {
        if (!s.offersGoogle) bad.push(`${label}: the auth invitation does not offer Google`);
        if (!s.offersApple) bad.push(`${label}: the auth invitation does not offer Apple`);
        if (s.phoneFields.length) bad.push(`${label}: a phone/OTP field is back on the auth surface (${JSON.stringify(s.phoneFields)}) — owner ruling 2026-09-01 is Google and Apple only`);
        if (s.phoneText) bad.push(`${label}: the auth invitation carries phone/OTP copy — owner ruling 2026-09-01 is Google and Apple only`);
      }
      if (s.ctaCovered === true) bad.push(`${label}: the auth invitation is covering the primary «بحث» control`);
    };

    const fresh = await authSurface(page);
    check('fresh load', fresh);

    // THE CARD IS DESKTOP-ONLY, AND THAT IS THE PRODUCT, NOT A GAP (src/lib/authPopupBehavior.ts:
    // shouldShowSignInCard returns false below DOCK_BREAKPOINT). On a phone the invitation is
    // OPENED on demand from «إنشاء حساب / تسجيل الدخول», which raises the same AuthForm in its
    // centred presentation. Returning early there would have left the whole auth surface untested
    // on exactly the viewport most of this app's users are on — a journey passing on silence.
    if (fresh.invitations === 0) {
      const opened = await tap(page, SIGNIN_ENTRY);
      if (!opened) {
        bad.push(`signed out with no auth invitation on screen and no «${SIGNIN_ENTRY}» entry point to open one — there is no way to sign in`);
        return violated(bad, seen);
      }
      await sleep(2500);
      const onDemand = await authSurface(page);
      check('after the on-demand sign-in entry point', onDemand);
      if (onDemand.invitations === 0) {
        bad.push(`pressing «${SIGNIN_ENTRY}» opened no auth invitation — the only sign-in entry point at this viewport is dead`);
        return violated(bad, seen);
      }
    }

    // The sidebar entry point must SWAP the invitation, never add a second one.
    const cta = await page.$('[data-testid="sidebar-signin-cta"]');
    if (cta) {
      await cta.click().catch(() => {});
      await sleep(2500);
      check('after the sidebar sign-in entry point', await authSurface(page));
    }

    // Dismissal must survive client-side navigation, for the session (a RELOAD legitimately brings
    // it back — that is the product's own design and is deliberately not asserted against).
    const closed = await until(async () => (await dismissAuthInvitation(page)) === 'dismissed' || (await authSurface(page)).invitations === 0, 15000);
    if (!closed) throw new HarnessError('the auth invitation could not be dismissed');
    if ((await authSurface(page)).invitations !== 0) bad.push('dismissing the auth invitation did not close it');

    await tap(page, 'الوكيل الذكي');
    await sleep(2500);
    const onAgent = await authSurface(page);
    seen['agent tab after dismissal'] = onAgent;
    if (onAgent.invitations > 0) bad.push('the dismissed auth invitation came back after switching to الوكيل الذكي — dismissal must hold for the session');
    await tap(page, 'تصفية');
    await sleep(2500);
    const backHome = await authSurface(page);
    seen['filter tab after dismissal'] = backHome;
    if (backHome.invitations > 0) bad.push('the dismissed auth invitation came back after returning to تصفية — dismissal must hold for the session');

    if (ctx.pageErrors.length) bad.push(`uncaught page error on the auth surface: ${ctx.pageErrors[0]}`);
    return bad.length ? violated(bad, seen) : ok(seen);
  },
};

// ── G4 · navigation ──────────────────────────────────────────────────────────────────────────────
// On web a result card opens its source in a NEW TAB (src/lib/openListing.ts → window.open), so the
// results tab never navigates and there is no in-app Back from a listing. The journey therefore
// asserts BOTH halves of "leaving and coming back does not lose my results":
//   (1) open the card's external tab, close it, come back → same count chip, same first card,
//       and NOT ONE extra property-search RPC;
//   (2) the real browser Back → lands on the filter home, still renders the form, fires no search.
const G4 = {
  id: 'back-preserves-results',
  title: 'Leaving results and coming back preserves them: the same count chip, the same first card, and no duplicate search',
  surface: 'navigation',
  steps: [
    'Open https://ezhalah-app.vercel.app/, dismiss the sign-in card, pick الرياض and press «بحث».',
    'Record the count chip, the first card testid, and the property-search RPC count.',
    'Click the first result card, close the external tab it opens, and return to the app tab.',
    'Re-read the count chip, the first card testid and the RPC count.',
    'Press browser Back and assert the filter home renders and no search RPC fires.',
  ],
  async run(page, ctx) {
    await searchAsGuest(page);
    const before = await resultsState(page);
    if (!before.cards || !before.firstCard) throw new HarnessError('the search rendered no cards — there is no return trip to test');
    if (!before.countChip) throw new HarnessError('the results screen rendered no count chip to compare');

    const bad = [];
    const rpcBefore = ctx.searches.length;
    const opening = page.context().waitForEvent('page', { timeout: 25000 }).catch(() => null);
    const clicked = await page.locator('[data-testid^="card-listing-"]').first()
      .click({ timeout: 20000 }).then(() => true).catch(() => false);
    if (!clicked) throw new HarnessError('the first result card could not be clicked');
    const tab = await opening;
    if (tab) { await tab.close().catch(() => {}); }
    await page.bringToFront().catch(() => {});
    await sleep(2500);

    const after = await resultsState(page);
    if (after.countChip !== before.countChip) bad.push(`returning from the listing changed the count chip: «${before.countChip}» → «${after.countChip}»`);
    if (after.firstCard !== before.firstCard) bad.push(`returning from the listing changed the first card: ${before.firstCard} → ${after.firstCard}`);
    if (after.cards === 0) bad.push('returning from the listing left zero result cards on screen');
    const duplicate = ctx.searches.length - rpcBefore;
    if (duplicate > 0) bad.push(`returning from the listing fired ${duplicate} duplicate property-search RPC(s)`);

    // Browser Back out of results.
    const rpcBeforeBack = ctx.searches.length;
    const went = await page.goBack({ timeout: 40000 }).then(() => true).catch(() => false);
    if (!went) throw new HarnessError('browser Back did not navigate');
    const home = await until(() => page.$('[data-testid="city-input"]'), 30000);
    if (!home) bad.push('browser Back out of the results screen did not land on a rendered filter home — the filter form never appeared');
    const backSearches = ctx.searches.length - rpcBeforeBack;
    if (backSearches > 0) bad.push(`browser Back fired ${backSearches} property-search RPC(s) — going back must not re-run a search`);

    if (ctx.pageErrors.length) bad.push(`uncaught page error during the return trip: ${ctx.pageErrors[0]}`);
    const evidence = { before, after, duplicateSearches: duplicate, openedExternalTab: !!tab, backUrl: page.url() };
    return bad.length ? violated(bad, evidence) : ok(evidence);
  },
};

// ── G5 · result_card ─────────────────────────────────────────────────────────────────────────────
// The known bug class (2026-09-02): the card reads RAW tables rather than canonical, so a NULL
// renders as false/0. And the standing watch `no-html-entities-rendered`. Assertions are about the
// SHAPE of what a card must always carry — never about a particular listing.
const CARD_JUNK = [
  ['&bull;|&quot;|&ndash;|&amp;|&nbsp;|&#\\d+;', 'a raw HTML entity'],
  ['\\[object Object\\]', 'a stringified object'],
  ['(?<![\\p{L}\\d])undefined(?![\\p{L}\\d])', 'the literal «undefined»'],
  ['(?<![\\p{L}\\d])NaN(?![\\p{L}\\d])', 'the literal «NaN»'],
];
// A price line is either a real money figure or the honest sentinel. A bare zero is the documented
// symptom of the raw-vs-canonical bug («سعر المتر ر.س 0» on five live dealapp cards, 2026-07-26).
const PRICE_ON_REQUEST = 'السعر عند الطلب';
const ZERO_MONEY = /(?:ر\.س\s*0(?![\d.,])|(?<![\d.,])0\s*(?:ر\.س|ريال\/م²|ريال(?![\p{L}])))/u;

const G5 = {
  id: 'result-card-tells-the-truth',
  title: 'Every result card carries a real price treatment, a source attribution and a location — and no entities, zeros or placeholder junk',
  surface: 'result_card',
  steps: [
    'Open https://ezhalah-app.vercel.app/, dismiss the sign-in card, pick الرياض and press «بحث».',
    'Read the rendered text of every card-listing-* element.',
    'For each card assert: a price figure or «السعر عند الطلب»; a «سيأخذك إلى <domain>» source attribution; a non-empty location before «المملكة العربية السعودية».',
    'For each card assert no HTML entity, no «[object Object]», no bare «undefined»/«NaN», and no zero-valued money token.',
  ],
  async run(page, ctx) {
    await searchAsGuest(page);
    const cards = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="card-listing-"]')]
      .map((c) => ({ id: c.getAttribute('data-testid'), text: c.innerText || '' })));
    if (!cards.length) throw new HarnessError('the search rendered no cards to inspect');

    const bad = [];
    const junk = CARD_JUNK.map(([src, label]) => [new RegExp(src, 'u'), label]);
    for (const card of cards) {
      const t = card.text;
      const hasPrice = /ر\.س\s*[\d٠-٩][\d٠-٩,٬.]*/u.test(t) || t.includes(PRICE_ON_REQUEST);
      if (!hasPrice) bad.push(`${card.id}: no price treatment at all — neither a figure nor «${PRICE_ON_REQUEST}»`);
      const zero = t.match(ZERO_MONEY);
      if (zero) bad.push(`${card.id}: renders a zero-valued money token «${zero[0].trim()}» — a NULL price surfacing as 0`);
      const source = t.match(/سيأخذك إلى\s+(\S+\.\S+)/u);
      if (!source) bad.push(`${card.id}: no source attribution — the «الضغط على هذا الإعلان سيأخذك إلى <منصة>» line names no domain`);
      const location = t.match(/(.*)،?\s*المملكة العربية السعودية/u) || t.match(/([^\n]+),\s*المملكة العربية السعودية/u);
      if (!location || !location[1].trim()) bad.push(`${card.id}: no location — the country line names no city`);
      for (const [re, label] of junk) {
        const m = t.match(re);
        if (m) bad.push(`${card.id}: renders ${label} («${m[0]}») in card text`);
      }
    }
    if (ctx.pageErrors.length) bad.push(`uncaught page error while rendering results: ${ctx.pageErrors[0]}`);
    const evidence = { cardsInspected: cards.length, sample: cards[0]?.text.slice(0, 300) ?? null };
    return bad.length ? violated(bad, evidence) : ok(evidence);
  },
};

// ── G6 · loading_states ──────────────────────────────────────────────────────────────────────────
// A loader that never resolves is the shape of failure a static barrier can never see: the page is
// up, the bundle parses, the RPC is healthy, and the user is looking at a spinner forever.
const LOADER_BUDGET_MS = 25000;

const G6 = {
  id: 'loaders-resolve',
  title: 'Every loading affordance resolves: no skeleton, spinner or «يبحث في المنصات» is still on screen after a bounded wait',
  surface: 'loading_states',
  steps: [
    'Open https://ezhalah-app.vercel.app/ and wait up to 25s for every loading affordance to clear.',
    'Dismiss the sign-in card, pick الرياض and press «بحث».',
    'After the results settle, wait up to 25s again and assert no loading affordance is still visible.',
    'Switch to الوكيل الذكي and assert the same there.',
  ],
  async run(page, ctx) {
    const bad = [];
    const evidence = {};
    const settle = async (surface) => {
      const cleared = await until(async () => (await loadersPresent(page)).length === 0, LOADER_BUDGET_MS, 500);
      const left = await loadersPresent(page);
      evidence[surface] = { cleared: !!cleared, left };
      if (left.length) bad.push(`${surface}: loading affordance still on screen after ${LOADER_BUDGET_MS}ms — ${left.join(', ')}`);
    };

    await open(page, '/');
    await settle('filter home');
    await dismissAuthInvitation(page);
    if (!await pickCity(page, 'الرياض')) throw new HarnessError('the product did not offer the city «الرياض»');
    await runSearch(page);
    await settle('results');
    await tap(page, 'الوكيل الذكي');
    await sleep(2500);
    await settle('agent screen');

    if (ctx.pageErrors.length) bad.push(`uncaught page error while waiting for loaders: ${ctx.pageErrors[0]}`);
    return bad.length ? violated(bad, evidence) : ok(evidence);
  },
};

// ── G7 · modal ───────────────────────────────────────────────────────────────────────────────────
// /about and /support are DOORS (owner 2026-09-03): each raises components/InfoModal and replaces
// the URL with '/'. There is exactly ONE About and ONE Support experience, and these routes must
// open it. THE SUPPORT FORM IS ASSERTED TO RENDER AND NEVER SENT — pressing «إرسال» would write a
// row to support_messages, and harness.mjs's FORBIDDEN_LABELS refuses that click structurally.
const DOORS = [
  { path: '/support', must: ['تواصل مع الدعم', 'الموضوع', 'الرسالة', 'بريدك الإلكتروني', 'وقت الاستجابة'],
    form: true, closer: '[data-testid="info-modal-close"]' },
  // «من نحن» HAS NO ×, BY DESIGN. InfoModal.tsx: `const hasClose = kind !== 'about'` — the owner's
  // 2026-09-04 popup redesign removed it from About and the sign-in sheet, leaving it on Support and
  // the legal reader, which are a form and a long read. This journey used to assert the × for BOTH
  // doors and therefore reported «/about never raised the info modal» on a modal that was open and
  // correct in front of it — a false alarm on a deliberate product decision. The open-signal and the
  // close step are per-door now: a door with no closer is asserted on its CONTENT and its close
  // mechanism is left uncovered rather than guessed at.
  { path: '/about', must: ['من نحن', 'الثقة والشفافية', 'إخلاء المسؤولية'], form: false, closer: null },
];

const G7 = {
  id: 'the-doors-open',
  title: '/about and /support each open the info modal, render their content, and close cleanly',
  surface: 'modal',
  steps: [
    'Navigate to https://ezhalah-app.vercel.app/support — assert the info modal opens on the home URL.',
    'Assert the support screen renders its heading, its Subject/Message/Email fields and the response-time panel. Do NOT press «إرسال».',
    'Press the modal close control and assert the modal is gone and the app is still rendered.',
    'Repeat for /about, asserting «من نحن», «الثقة والشفافية» and «إخلاء المسؤولية». /about has no × by design, so it is proven open by its own copy and its close mechanism is recorded as NOT COVERED.',
  ],
  async run(page, ctx) {
    const bad = [];
    const evidence = {};
    for (const door of DOORS) {
      // A door with a × is proven open by its ×; a door without one is proven open by its own copy.
      const openSignal = door.closer ?? null;
      await open(page, door.path, openSignal ? { expect: openSignal } : {});
      const opened = openSignal
        ? await until(async () => (await countVisible(page, openSignal)) === 1, 20000)
        : await until(async () => (await bodyText(page)).includes(door.must[0]), 20000);
      if (!opened) throw new HarnessError(`${door.path} never raised the info modal`);
      const text = await bodyText(page);
      const missing = door.must.filter((m) => !text.includes(m));
      if (missing.length) bad.push(`${door.path}: the info modal opened but did not render ${JSON.stringify(missing)}`);
      if (door.form) {
        const fields = await page.evaluate(() => ({
          textareas: document.querySelectorAll('textarea').length,
          send: [...document.querySelectorAll('*')].some((e) => e.children.length === 0 && (e.textContent || '').trim() === 'إرسال'),
        }));
        evidence[`${door.path} form`] = fields;
        if (!fields.textareas) bad.push(`${door.path}: the support message form rendered no message field`);
        if (!fields.send) bad.push(`${door.path}: the support message form rendered no «إرسال» control`);
      }
      let closed = null;
      if (door.closer) {
        const close = await page.$(door.closer);
        await close.click().catch(() => {});
        closed = await until(async () => (await countVisible(page, door.closer)) === 0, 12000);
        if (!closed) bad.push(`${door.path}: the info modal did not close when its close control was pressed`);
        const alive = await until(() => page.$('[data-testid="city-input"]'), 20000);
        if (!alive) bad.push(`${door.path}: closing the info modal did not leave a rendered app behind`);
      }
      // NOT a silent skip: a door whose close mechanism this journey does not cover says so in its
      // own evidence, so "we did not look" can never read as "we looked and it was fine".
      evidence[door.path] = { url: page.url(), missing, closed: door.closer ? !!closed : 'NOT COVERED — this door has no × by design' };
    }
    if (ctx.pageErrors.length) bad.push(`uncaught page error on the info doors: ${ctx.pageErrors[0]}`);
    return bad.length ? violated(bad, evidence) : ok(evidence);
  },
};

// ── G8 · search ──────────────────────────────────────────────────────────────────────────────────
// An impossible-but-VALID budget: a real city, a real deal, a price band nothing in the Kingdom
// sits in. The product must say so in Arabic rather than quietly widening or padding the page.
// «عرض المزيد» is asserted by TESTID, never by text: the same words are also a per-card attribute
// expander, so a text search would fail on a perfectly honest zero screen.
const ZERO_PHRASES = ['ما فيه نتائج', 'ما لقيت', 'ما لقينا'];

const G8 = {
  id: 'empty-results-are-honest',
  title: 'An impossible-but-valid search says plainly in Arabic that there is nothing, renders zero cards, and offers no pager',
  surface: 'search',
  steps: [
    'Open https://ezhalah-app.vercel.app/, dismiss the sign-in card, pick الرياض.',
    'Set the price band to 999,000,000 – 999,999,999 ر.س (valid, impossible).',
    'Press «بحث» and wait for the results screen to settle.',
    'Assert an Arabic no-results statement, zero card-listing-* elements, no results-load-more, and no «لقينا N إعلان» count chip.',
  ],
  async run(page, ctx) {
    await searchAsGuest(page, { priceMin: 999000000, priceMax: 999999999 });
    const state = await resultsState(page);
    const text = await bodyText(page);
    const bad = [];
    const said = ZERO_PHRASES.find((p) => text.includes(p));
    if (!said) bad.push(`an impossible budget produced no Arabic no-results statement (expected one of ${JSON.stringify(ZERO_PHRASES)})`);
    if (state.cards > 0) bad.push(`an impossible budget still rendered ${state.cards} result card(s)`);
    if (state.loadMore > 0) bad.push('an impossible budget still offered the «عرض المزيد» pager');
    if (state.countChip) bad.push(`an impossible budget still claimed «لقينا ${state.countChip} إعلان»`);
    if (ctx.pageErrors.length) bad.push(`uncaught page error on the empty-results screen: ${ctx.pageErrors[0]}`);
    const evidence = { state, said: said ?? null };
    return bad.length ? violated(bad, evidence) : ok(evidence);
  },
};

/** The suite. Order is the order the runner drives them. */
export const JOURNEYS = [G1, G2, G3, G4, G5, G6, G7, G8];

/** The surfaces incident_route_owner() knows. A journey outside this set has no owner. */
export const ALLOWED_SURFACES = [
  'theme', 'chat_persistence', 'auth', 'navigation', 'result_card', 'loading_states', 'modal', 'search',
];

export { BASE };
