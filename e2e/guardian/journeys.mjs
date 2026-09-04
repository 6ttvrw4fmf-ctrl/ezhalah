// ═══════════════════════════════════════════════════════════════════════════════════════════════
// GUARDIAN JOURNEYS — thirteen production journeys over the surfaces with ZERO live browser coverage.
//
// Each journey declares `surface`, drawn from the vocabulary public.incident_route_owner() routes
// to an owning routine (supabase/migrations/20260904144004_incident_spine…sql). That is what makes
// a failure ARRIVE somewhere instead of being printed into a log nobody reads.
//
// EVERY JOURNEY IS SIGNED OUT AND READ-ONLY. Two of the first eight are therefore driven through the
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
  searchAsGuest, sleep, tap, until, violated, waitForCards,
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
  // ONE invitation = one auth-popup-close. The signed-out card and the centred AuthModal are two
  // presentations of the same component (src/components/AuthModal.tsx) and each carries exactly one.
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
  { path: '/support', must: ['تواصل مع الدعم', 'الموضوع', 'الرسالة', 'بريدك الإلكتروني', 'وقت الاستجابة'], form: true },
  { path: '/about', must: ['من نحن', 'الثقة والشفافية', 'إخلاء المسؤولية'], form: false },
];

const G7 = {
  id: 'the-doors-open',
  title: '/about and /support each open the info modal, render their content, and close cleanly',
  surface: 'modal',
  steps: [
    'Navigate to https://ezhalah-app.vercel.app/support — assert the info modal opens on the home URL.',
    'Assert the support screen renders its heading, its Subject/Message/Email fields and the response-time panel. Do NOT press «إرسال».',
    'Press the modal close control and assert the modal is gone and the app is still rendered.',
    'Repeat for /about, asserting «من نحن», «الثقة والشفافية» and «إخلاء المسؤولية».',
  ],
  async run(page, ctx) {
    const bad = [];
    const evidence = {};
    for (const door of DOORS) {
      await open(page, door.path, { expect: '[data-testid="info-modal-close"]' });
      const opened = await until(async () => (await countVisible(page, '[data-testid="info-modal-close"]')) === 1, 20000);
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
      const close = await page.$('[data-testid="info-modal-close"]');
      await close.click().catch(() => {});
      const closed = await until(async () => (await countVisible(page, '[data-testid="info-modal-close"]')) === 0, 12000);
      if (!closed) bad.push(`${door.path}: the info modal did not close when its close control was pressed`);
      const alive = await until(() => page.$('[data-testid="city-input"]'), 20000);
      if (!alive) bad.push(`${door.path}: closing the info modal did not leave a rendered app behind`);
      evidence[door.path] = { url: page.url(), missing, closed: !!closed };
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SECOND TRANCHE (2026-09-04) — five more surfaces the owner named that still had no live journey:
// pagination, trending, advanced_filter, normal_filter, voice.
//
// Same three rules as the first eight, and they are what shaped every line below: signed out,
// READ-ONLY, and SHAPE/INVARIANT assertions only — never a count and never a listing, both of which
// change hourly. Where a journey needs a PREMISE (a cohort small enough to page to its end; the
// Advanced-Filter entry point the product only offers above 25 results), the premise failing is a
// HarnessError — UNDETERMINED, filing nothing — because "I could not set the test up" is not a
// statement about the product.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** «1,396» / «١٬٣٩٦» → 1396, else null. Arabic-Indic digits too: JS \d is ASCII-only (repo rule). */
const num = (s) => {
  const ascii = String(s ?? '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[,٬\s]/g, '');
  const m = ascii.match(/-?\d+/);
  return m ? Number(m[0]) : null;
};

/**
 * Click the nth match of a selector the way tap() clicks a label: scroll it in from the DOM first.
 * Playwright's own scrollIntoViewIfNeeded() does not move a react-native-web ScrollView, which is
 * why a control below the fold on a 390px phone otherwise times out (same reason as tap()).
 */
async function tapNth(page, selector, index = 0, timeout = 20000) {
  const el = page.locator(selector).nth(index);
  const there = await el.waitFor({ state: 'attached', timeout }).then(() => true).catch(() => false);
  if (!there) return false;
  await el.evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => {});
  await sleep(400);
  return el.click({ timeout }).then(() => true).catch(() => false);
}
const tapTestId = (page, testid, timeout) => tapNth(page, `[data-testid="${testid}"]`, 0, timeout);

/** The SELECTED fill every OptionBox is painted with — the theme's selFill token, both palettes. */
const SELECTED_FILL = 'rgb(47, 114, 71)';

/** Poll `read` until it returns the same value twice running, then return it. */
async function settle(page, read, budgetMs = 30000, everyMs = 900) {
  let last = null;
  let stable = 0;
  let out = null;
  await until(async () => {
    out = await read();
    const j = JSON.stringify(out);
    if (j === last) stable += 1; else { stable = 0; last = j; }
    return stable >= 2;
  }, budgetMs, everyMs);
  return out;
}

// ── G9 · pagination ──────────────────────────────────────────────────────────────────────────────
// «عرض المزيد» can lie in two directions and a static barrier sees neither: offer more when there is
// none (it pages into nothing), or hide itself while matches remain (the user can never reach them).
// src/data/resultCount.ts is unit-tested to death and none of that proves the RENDERED page obeys it.
//
// What this asserts, all as relationships and never as numbers:
//   • the pager is offered EXACTLY when the closing note says matches remain — both directions;
//   • the note's «shown» equals the number of cards actually on screen;
//   • one press APPENDS — the cards already there are still there IN THE SAME ORDER, and the added
//     ones are genuinely new (no identity is rendered twice);
//   • the «لقينا N إعلان» count chip does not move while paging: paging reveals, it never re-searches;
//   • at the end the note becomes «عرضت لك كل النتائج المطابقة» and the pager is GONE.
//
// THE PREMISE IS A BOUNDED COHORT, NOT A NUMBER. الرياض's ultra-luxury tail is real production
// inventory that is still small enough to page to its END (46 matches the day this was written).
// Nothing here asserts 46: the journey reads the total the product itself states and derives its
// click budget from it. If that band ever stops bounding the cohort, the end of the list can no
// longer be observed and the journey says so as a HARNESS failure — an oracle that quietly stops
// checking half its contract is worse than a red run.
const PAGER_PRICE_MIN = 90000000;
const PAGER_PRICE_MAX = 999000000;
const BROWSE_BATCH = 100;      // src/data/resultCount.ts — one press completes the next hundred.
const END_CLICK_BUDGET = 4;    // ⇒ the premise holds while the cohort stays under 400 matches.

/** The closing-note forms production renders (src/i18n.tsx), as one parsed verdict. */
const NOTE_ALL = /عرضت لك كل النتائج المطابقة\s*\(\s*([\d,٬٠-٩]+)\s+إعلان\s*\)/;
const NOTE_MORE = /عرضت لك أول\s+([\d,٬٠-٩]+)\s+من أصل\s+([\d,٬٠-٩]+)\s+إعلان مطابق/;
const NOTE_MORE_VAGUE = /عرضت لك أول\s+([\d,٬٠-٩]+)\s+إعلانات/;

/** Every listing on screen by an identity that survives a re-render: testid + its source domain. */
const cardIdentities = (page) => page.evaluate(() =>
  [...document.querySelectorAll('[data-testid^="card-listing-"]')].map((c) => {
    const src = (c.innerText || '').match(/سيأخذك إلى\s+(\S+)/);
    return `${c.getAttribute('data-testid')}@${src ? src[1] : '?'}`;
  }));

/** What the pager surface claims right now: the note, the cards, the chip, the button. */
async function pagerState(page) {
  const text = await bodyText(page);
  const all = text.match(NOTE_ALL);
  const more = text.match(NOTE_MORE);
  const vague = text.match(NOTE_MORE_VAGUE);
  const ids = await cardIdentities(page);
  const st = await resultsState(page);
  return {
    kind: all ? 'all' : more ? 'more' : vague ? 'more-narrowed' : null,
    shown: all ? num(all[1]) : more ? num(more[1]) : vague ? num(vague[1]) : null,
    total: all ? num(all[1]) : more ? num(more[2]) : null,
    rendered: ids.length,
    ids,
    chip: st.countChip,
    pager: st.loadMore,
  };
}

const G9 = {
  id: 'show-more-is-honest',
  title: '«عرض المزيد» is offered exactly while matches remain, appends without duplicating or reordering, leaves the count chip still, and stops being offered at the end',
  surface: 'pagination',
  steps: [
    'Open https://ezhalah-app.vercel.app/, dismiss the sign-in card, pick الرياض.',
    `Set the price band to ${PAGER_PRICE_MIN.toLocaleString('en-US')} – ${PAGER_PRICE_MAX.toLocaleString('en-US')} ر.س — a real cohort small enough to page to its end.`,
    'Press «بحث»; record the count chip, the closing note, and the identity (testid + source domain) of every rendered card.',
    'Assert results-load-more is present exactly when the note says matches remain, and that the note\'s «shown» equals the cards on screen.',
    'Press «عرض المزيد»; assert the previous identities are still there in the same order, the added ones are new, and the count chip did not move.',
    'Repeat until the note reads «عرضت لك كل النتائج المطابقة», then assert the pager is no longer offered.',
  ],
  async run(page, ctx) {
    await searchAsGuest(page, { city: 'الرياض', priceMin: PAGER_PRICE_MIN, priceMax: PAGER_PRICE_MAX });
    let now = await settle(page, () => pagerState(page), 45000);
    if (!now.rendered) throw new HarnessError('the premise search returned no listings at all — there is no pagination to judge');
    if (!now.kind) throw new HarnessError('the results screen rendered no closing note — nothing states whether more matches remain');
    if (now.total != null && now.total > END_CLICK_BUDGET * BROWSE_BATCH) {
      throw new HarnessError(`the premise cohort has grown to ${now.total} matches — more than ${END_CLICK_BUDGET} presses can page to its end, so the end of the list can no longer be observed; re-tune PAGER_PRICE_MIN`);
    }

    const bad = [];
    const seen = [];
    const chip0 = now.chip;
    let presses = 0;

    const judge = (label, s) => {
      seen.push({ at: label, kind: s.kind, shown: s.shown, total: s.total, rendered: s.rendered, pager: s.pager, chip: s.chip });
      // (1) offered EXACTLY while the product itself says matches remain — both directions.
      if (s.kind === 'all' && s.pager > 0) {
        bad.push(`${label}: the note says every match is on screen («عرضت لك كل النتائج المطابقة») yet «عرض المزيد» is still offered — pressing it can only page into nothing`);
      }
      if (s.kind !== 'all' && s.pager === 0 && s.total != null && s.shown != null && s.shown < s.total) {
        bad.push(`${label}: the note says ${s.shown} of ${s.total} matches are on screen and no «عرض المزيد» is offered — the rest are unreachable`);
      }
      // (2) the note is honest about the screen it sits on.
      if (s.shown != null && s.shown !== s.rendered) {
        bad.push(`${label}: the closing note claims ${s.shown} listing(s) are shown but ${s.rendered} card(s) are rendered`);
      }
      if (s.kind === 'more' && s.total != null && s.shown != null && s.shown >= s.total) {
        bad.push(`${label}: the note offers more while claiming ${s.shown} of ${s.total} are already shown`);
      }
      // (3) one listing, one card.
      const dupes = [...new Set(s.ids.filter((v, i) => s.ids.indexOf(v) !== i))];
      if (dupes.length) bad.push(`${label}: the same listing is rendered more than once — ${JSON.stringify(dupes.slice(0, 3))}`);
      // (4) paging REVEALS; it never re-states the size of the match set.
      if (s.chip !== chip0) bad.push(`${label}: the count chip moved while paging: «لقينا ${chip0}» → «لقينا ${s.chip}»`);
    };
    judge('initial results', now);

    while (now.kind !== 'all' && now.pager > 0 && presses < END_CLICK_BUDGET) {
      const before = now;
      if (!await tapTestId(page, 'results-load-more')) throw new HarnessError('«عرض المزيد» was on screen but could not be pressed');
      presses += 1;
      await waitForCards(page, 45000);
      // The added cards cascade in one at a time, so the note and the DOM CONVERGE rather than
      // landing together. Judging mid-cascade would accuse the product of a mismatch it is in the
      // middle of resolving — poll for the growth to finish, then read.
      await until(async () => {
        const s = await pagerState(page);
        return s.rendered > before.rendered && (s.shown == null || s.shown === s.rendered);
      }, 45000, 800);
      now = await settle(page, () => pagerState(page), 45000);
      judge(`after press ${presses}`, now);
      // (5) APPEND — never a re-shuffle, never a different page.
      const at = before.ids.findIndex((id, i) => now.ids[i] !== id);
      if (at >= 0) {
        bad.push(`after press ${presses}: «عرض المزيد» disturbed the results already on screen — position ${at + 1} was ${before.ids[at]} and is now ${now.ids[at] ?? '(gone)'}`);
      }
      if (now.rendered <= before.rendered) {
        bad.push(`after press ${presses}: «عرض المزيد» added nothing — ${before.rendered} card(s) before, ${now.rendered} after`);
        break;
      }
    }

    if (now.kind !== 'all' && !bad.length) {
      throw new HarnessError(`after ${presses} press(es) the results never reached their end (note «${now.kind}», ${now.shown} of ${now.total}) — the end-of-list half of this contract was not observed`);
    }
    if (ctx.pageErrors.length) bad.push(`uncaught page error while paging: ${ctx.pageErrors[0]}`);
    const evidence = { observations: seen, presses };
    return bad.length ? violated(bad, evidence) : ok(evidence);
  },
};

// ── G10 · trending ───────────────────────────────────────────────────────────────────────────────
// A Trending row is a PROMISE with a number on it: «الدمام · 6,486 إعلان». Tapping it must land the
// user on THAT scope. The failure is recent and expensive (PR#1647, 2026-09-03: «الهفوف — 2,478
// promised, 109 delivered», because the trending count and the results counted different tables),
// and the permanent rule it produced is that a count surface shares the results scope.
//
// So the assertion is the CARRY, on the state the product itself sends to the database: the city the
// row named is the ONLY city searched, the district the row named is the district searched, the deal
// the form shows is the deal searched, and the summary the user reads names both. The advertised
// number is asserted only as a RELATIONSHIP — the promise must be roughly kept, inside a 4× band,
// which the 22× miss above trips and which hourly churn can never reach.
const PROMISE_BAND = 4;

/** A search these two journeys drive themselves. Wider than the harness default: production has
 *  been measured taking over 90s for an unfiltered capital-city search, and a budget that expires
 *  on a slow-but-working search turns a healthy product into an UNDETERMINED run. */
const SLOW_SEARCH_BUDGET_MS = 150000;

/** The trending list as the user sees it: label + the count it advertises. */
const trendingRows = (page) => page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="trending-row"]')].map((e) => {
    const lines = (e.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
    return { label: lines[1] ?? null, sub: lines[2] ?? null, raw: (e.innerText || '').replace(/\n/g, ' · ') };
  }));

/** The listing FETCH the results screen ran — the paged one, never one of the count probes. */
const listingFetch = (ctx) => [...ctx.searches].reverse().find((b) => Number(b.p_limit) > 100) ?? null;

const G10 = {
  id: 'trending-carries-its-scope',
  title: 'A Trending row carries its scope: the city and district it names are the city and district actually searched, and the count it promised is roughly what arrives',
  surface: 'trending',
  steps: [
    'Open https://ezhalah-app.vercel.app/ and dismiss the sign-in card.',
    'Focus the city field with nothing typed and read the Trending Top-6 — each row must name a place and advertise an «N إعلان» count.',
    'Tap the last Trending city row; assert the city field now holds exactly that city.',
    'Focus the district field, tap the last Trending district row, and assert a district chip with that label appears.',
    'Press «بحث» and read the property-search RPC the results screen actually sent.',
    'Assert p_cities is exactly the city the row named, p_districts contains the district the row named, and p_deal matches the deal the form shows.',
    'Assert the search summary names the same city and district, and that the delivered count is within 4× of what the row promised.',
  ],
  async run(page, ctx) {
    await open(page, '/');
    await dismissAuthInvitation(page);
    const bad = [];
    const evidence = {};

    // ── the city row ──────────────────────────────────────────────────────────────────────────
    await page.locator('[data-testid="city-input"]').click();
    const cityRows = await until(async () => {
      const r = await trendingRows(page);
      return r.length ? r : null;
    }, 30000);
    if (!cityRows) throw new HarnessError('focusing the empty city field offered no Trending rows — the Top-6 pool never resolved, so there is no promise to test');
    evidence.cityRows = cityRows.map((r) => r.raw);
    for (const r of cityRows) {
      if (!r.label) bad.push(`a Trending city row rendered no place name (${JSON.stringify(r.raw)})`);
      else if (num(r.sub) == null) bad.push(`the Trending city row «${r.label}» advertises no count — a trending row is a promise with a number on it`);
    }
    // The LAST row is the smallest of the six: a real scope, and the fastest search to drive.
    const cityIdx = cityRows.length - 1;
    const city = cityRows[cityIdx];
    if (!await tapNth(page, '[data-testid="trending-row"]', cityIdx)) {
      throw new HarnessError('the Trending city rows were on screen but could not be pressed');
    }
    const held = await until(async () => {
      const v = await page.locator('[data-testid="city-input"]').inputValue().catch(() => '');
      return v ? v : null;
    }, 12000);
    if (held !== city.label) {
      bad.push(`tapping the Trending row «${city.label}» left the city field reading «${held ?? ''}» — the row did not carry its own place into the search`);
      return violated(bad, evidence);
    }

    // ── the district row (the same promise, one level down) ───────────────────────────────────
    // The district Top-6 renders through the SAME testid as the city Top-6, and the city list is
    // still mounted for a beat after the tap — so wait for the list to actually CHANGE. Reading the
    // stale city rows here would tap a city row believing it was a district and then accuse the
    // product of losing a district it was never given (measured while building this journey).
    const cityLabels = cityRows.map((r) => r.label).join('|');
    await page.locator('[data-testid="district-input"]').click().catch(() => {});
    const districtRows = await until(async () => {
      const r = await trendingRows(page);
      if (!r.length) return null;
      const labels = r.map((x) => x.label).join('|');
      return labels && labels !== cityLabels ? r : null;
    }, 30000);
    let district = null;
    if (districtRows) {
      evidence.districtRows = districtRows.map((r) => r.raw);
      for (const r of districtRows) {
        if (r.label && num(r.sub) == null) bad.push(`the Trending district row «${r.label}» advertises no count`);
      }
      const dIdx = districtRows.length - 1;
      district = districtRows[dIdx];
      if (await tapNth(page, '[data-testid="trending-row"]', dIdx)) {
        const chips = await until(async () => {
          const c = await page.evaluate(() => [...document.querySelectorAll('[data-testid="district-chip"]')].map((e) => (e.innerText || '').trim()));
          return c.length ? c : null;
        }, 12000);
        if (!chips || !chips.some((c) => c.includes(district.label))) {
          bad.push(`tapping the Trending district row «${district.label}» produced no matching district chip (chips: ${JSON.stringify(chips ?? [])}) — the district was not carried into the search`);
          district = null;
        }
      } else {
        district = null;                       // could not press it; the city leg still stands.
      }
    }
    // «شراء» is the form's default and no step above changed it, so the deal the user sees is Buy.
    const dealShown = 'بيع';

    // ── the search the product actually ran ───────────────────────────────────────────────────
    await runSearch(page, SLOW_SEARCH_BUDGET_MS);
    const body = listingFetch(ctx);
    if (!body) throw new HarnessError('the results screen sent no paged property-search RPC — there is no search state to compare the trending row against');
    evidence.rpc = { p_cities: body.p_cities, p_districts: body.p_districts, p_deal: body.p_deal };

    const cities = Array.isArray(body.p_cities) ? body.p_cities : [];
    if (cities.length !== 1 || cities[0] !== city.label) {
      bad.push(`the Trending row named «${city.label}» but the search ran over ${JSON.stringify(body.p_cities)} — a trending tap must not widen or reset the scope`);
    }
    if (body.p_deal !== dealShown) {
      bad.push(`the form shows «شراء» but the search ran with p_deal=${JSON.stringify(body.p_deal)} — the trending tap did not carry the deal on screen`);
    }
    if (district) {
      const ds = Array.isArray(body.p_districts) ? body.p_districts : [];
      if (!ds.includes(district.label)) {
        bad.push(`the Trending district row named «${district.label}» but the search ran with p_districts=${JSON.stringify(body.p_districts)}`);
      }
    }

    const text = await bodyText(page);
    if (!text.includes(`المدينة: ${city.label}`)) {
      bad.push(`the results summary does not name «${city.label}» as the city — the screen the user reads disagrees with the row they tapped`);
    }
    if (district && !text.includes(`الحي: ${district.label}`)) {
      bad.push(`the results summary does not name «${district.label}» as the district`);
    }

    // The promise, as a band and never as a value.
    const promised = num((district ?? city).sub);
    const state = await resultsState(page);
    const delivered = num(state.countChip);
    evidence.promise = { row: (district ?? city).raw, promised, delivered };
    if (promised != null && promised > 0) {
      if (delivered == null || delivered === 0) {
        bad.push(`the Trending row promised ${promised} listing(s) and the search it produced delivered none`);
      } else if (delivered * PROMISE_BAND < promised || promised * PROMISE_BAND < delivered) {
        bad.push(`the Trending row promised ${promised} listing(s) and the search it produced returned ${delivered} — more than ${PROMISE_BAND}× apart, so the row and the results are not counting the same scope`);
      }
    }

    if (ctx.pageErrors.length) bad.push(`uncaught page error on the trending surface: ${ctx.pageErrors[0]}`);
    evidence.state = state;
    return bad.length ? violated(bad, evidence) : ok(evidence);
  },
};

// ── G11 · advanced_filter ────────────────────────────────────────────────────────────────────────
// A JOURNEY check, deliberately NOT a count check: scripts/verify-af-live-truth.ts already certifies
// the numbers exhaustively, and duplicating it here would be a second, slower, flakier copy of a
// barrier that exists. What nothing drives is the ROUND as a piece of state:
//
//   • opening it from a results screen lands on a QUESTION with options that carry counts;
//   • THE DISPLAYED NUMBER BELONGS TO THE DISPLAYED SELECTION (certification 2026-08-24) — with one
//     option selected, the header chip and the «متابعة · N نتيجة» button must both read THAT
//     option's own number. Absent is the product's documented honest failure mode and is not a
//     violation; the previous selection's number surviving onto the new one is the whole bug;
//   • «رجوع» returns to the previous question WITH ITS ANSWER STILL SELECTED (owner 2026-08-22);
//   • ✕ hands back exactly the results that were already behind the card — same count chip, same
//     first card, same number of cards.
//
// The entry point is «خلّنا نحدد الطلب أكثر», which the product only offers above 25 results and
// only once its own eligibility probe has answered — so الرياض unfiltered is the premise, and the
// button never appearing is a HARNESS failure, not a product finding.
const AF_COUNT_BUDGET_MS = 20000;   // the count RPC's own timeout is 4s; this is four tries' worth.

/** The Advanced-Filter card as the user sees it, or null when it is not on screen. */
const afState = (page) => page.evaluate((selFill) => {
  const card = document.querySelector('[data-testid="af-card"]');
  if (!card) return null;
  const txt = (e) => (e ? (e.innerText || '').trim() : null);
  return {
    title: txt(document.querySelector('[data-testid="af-question-title"]')),
    chip: txt(document.querySelector('[data-testid="af-count-chip"]')),
    confirm: txt(document.querySelector('[data-testid="af-confirm"]')),
    back: !!document.querySelector('[data-testid="af-back"]'),
    skip: !!document.querySelector('[data-testid="af-skip"]'),
    intro: (card.innerText || '').includes('يلا نبدأ'),
    options: [...document.querySelectorAll('[data-testid^="af-option-"]')].map((o) => {
      // The row's selection check is an ICON FONT glyph, so it is a non-empty innerText line that
      // renders as nothing — taking it as the label prints «» into every violation this journey can
      // raise. Keep only lines that carry a letter or a digit.
      const lines = (o.innerText || '').split('\n').map((l) => l.trim())
        .filter((l) => /[\p{L}\p{N}]/u.test(l));
      const bg = getComputedStyle(o.parentElement).backgroundColor;
      return {
        key: o.getAttribute('data-testid').replace('af-option-', ''),
        label: lines[0] ?? null,
        count: lines[lines.length - 1] ?? null,
        // The selected row fills with the brand TINT (never selFill, which is the solid green the
        // Filter screen's boxes use) — so "selected" is read as "no longer the resting surface".
        selected: bg !== 'rgba(0, 0, 0, 0)' && bg !== 'rgb(255, 255, 255)' && bg !== selFill,
        bg,
      };
    }),
  };
}, SELECTED_FILL);

const G11 = {
  id: 'advanced-filter-round-trip',
  title: 'The Advanced Filter round holds its state: a question with a count chip that belongs to the selection, «رجوع» returns the previous answer, and ✕ hands back the same results',
  surface: 'advanced_filter',
  steps: [
    'Open https://ezhalah-app.vercel.app/, dismiss the sign-in card, pick الرياض and press «بحث».',
    'Record the results count chip, the first card and the number of cards.',
    'Press «خلّنا نحدد الطلب أكثر» and, if the opening card appears, «يلا نبدأ».',
    'Assert a question renders with at least two options, each carrying a count, and رجوع / تخطي / متابعة.',
    'Select the largest option; assert the count chip and the «متابعة · N نتيجة» button both read THAT option\'s number (or neither shows one).',
    'Press «متابعة» to reach the next question, then «رجوع», and assert the first question returns with its option still selected.',
    'Press ✕ and assert the card closes and the results behind it are unchanged — same count chip, same first card, same number of cards.',
  ],
  async run(page, ctx) {
    await searchAsGuest(page, { city: 'الرياض' });
    const before = await resultsState(page);
    if (!before.cards || !before.countChip) throw new HarnessError('the premise search rendered no results — there is nothing for the Advanced Filter to narrow');

    const entry = await until(() => page.$('[data-testid="results-narrow"]'), 60000);
    if (!entry) throw new HarnessError('the results screen never offered «خلّنا نحدد الطلب أكثر» — the Advanced Filter could not be opened, so nothing can be concluded about the round');
    if (!await tapTestId(page, 'results-narrow')) throw new HarnessError('«خلّنا نحدد الطلب أكثر» was on screen but could not be pressed');

    const opened = await until(async () => {
      const s = await afState(page);
      return s && (s.title || s.intro) ? s : null;
    }, 60000);
    if (!opened) throw new HarnessError('the Advanced Filter card never got past its loading state');
    if (!opened.title && opened.intro) {
      await tap(page, 'يلا نبدأ');
    }
    const q1 = await until(async () => {
      const s = await afState(page);
      return s && s.title ? s : null;
    }, 60000);
    if (!q1) throw new HarnessError('the Advanced Filter opened but never rendered a question');

    const bad = [];
    const evidence = { before, q1Title: q1.title };
    let sawChip = q1.chip != null;

    if (q1.options.length < 2) bad.push(`the Advanced Filter question «${q1.title}» offered ${q1.options.length} option(s) — a question the user cannot choose between is not a question`);
    for (const o of q1.options) {
      if (num(o.count) == null) bad.push(`the Advanced Filter option «${o.label ?? o.key}» carries no count`);
    }
    if (!q1.back) bad.push('the Advanced Filter question offers no «رجوع»');
    if (!q1.skip) bad.push('the Advanced Filter question offers no «تخطي»');
    if (!q1.confirm) bad.push('the Advanced Filter question offers no «متابعة»');
    if (bad.length) return violated(bad, evidence);

    // The chip may legitimately take a beat (its RPC has its own 4s timeout); poll before concluding.
    if (!sawChip) {
      sawChip = !!await until(async () => (await afState(page))?.chip != null, AF_COUNT_BUDGET_MS);
    }

    // Pick the LARGEST option: it keeps the cohort above the 25 the interview stops at, so a second
    // question genuinely follows and «رجوع» has somewhere to come back from.
    const pick = [...q1.options].sort((a, b) => (num(b.count) ?? 0) - (num(a.count) ?? 0))[0];
    const picked = num(pick.count);
    if (!await tapTestId(page, `af-option-${pick.key}`)) throw new HarnessError(`the Advanced Filter option «${pick.label}» could not be pressed`);
    const sel = await settle(page, () => afState(page), 30000);
    const selRow = sel?.options.find((o) => o.key === pick.key);
    if (!selRow?.selected) bad.push(`selecting «${pick.label}» left the option row unselected (background ${selRow?.bg}) — the card does not show what the user picked`);

    // THE DISPLAYED NUMBER MUST BELONG TO THE DISPLAYED SELECTION. Poll for it, then judge whatever
    // is on screen: no number is the documented honest failure, another selection's number is the bug.
    await until(async () => (await afState(page))?.chip != null, AF_COUNT_BUDGET_MS);
    const withSel = await afState(page);
    if (withSel?.chip != null) sawChip = true;
    evidence.selection = { option: pick.label, optionCount: picked, chip: withSel?.chip ?? null, confirm: withSel?.confirm ?? null };
    if (withSel?.chip != null && num(withSel.chip) !== picked) {
      bad.push(`«${pick.label}» is selected and advertises ${picked}, but the card's count chip reads «${withSel.chip}» — the number on screen does not belong to the selection on screen`);
    }
    if (withSel?.chip != null && num(withSel.confirm) !== num(withSel.chip)) {
      bad.push(`the count chip reads «${withSel.chip}» while the primary button reads «${withSel.confirm}» — one card, two different numbers for one selection`);
    }

    // «متابعة» → the next question; «رجوع» → this one, with its answer still on it.
    if (!await tapTestId(page, 'af-confirm')) throw new HarnessError('«متابعة» could not be pressed');
    const q2 = await until(async () => {
      const s = await afState(page);
      return s && s.title && s.title !== q1.title ? s : null;
    }, 60000);
    if (!q2) throw new HarnessError('«متابعة» did not advance to another question — this round had nothing to come back from');
    evidence.q2Title = q2.title;
    if (q2.chip != null) sawChip = true;

    if (!await tapTestId(page, 'af-back')) throw new HarnessError('«رجوع» could not be pressed');
    const returned = await until(async () => {
      const s = await afState(page);
      return s && s.title === q1.title ? s : null;
    }, 40000);
    if (!returned) {
      bad.push(`«رجوع» from «${q2.title}» did not return to «${q1.title}» — the previous question was not restored`);
    } else {
      const back = await settle(page, () => afState(page), 30000);
      if (back?.chip != null) sawChip = true;
      const row = back?.options.find((o) => o.key === pick.key);
      if (!row) bad.push(`«رجوع» returned to «${q1.title}» without the option «${pick.label}» the user had answered it with`);
      else if (!row.selected) bad.push(`«رجوع» returned to «${q1.title}» with «${pick.label}» no longer selected — the answer was erased, not paused`);
      if (back?.chip != null && num(back.chip) !== picked) {
        bad.push(`«رجوع» restored «${pick.label}» (${picked}) but the count chip reads «${back.chip}» — the number belongs to a selection that is not on screen`);
      }
    }

    if (!sawChip) bad.push('the Advanced Filter round never showed a count chip at all — the user is narrowing with no idea how far');

    // ✕ — the decline. It must hand back exactly the results that were already behind the card.
    const closed = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="af-card"]');
      if (!card) return false;
      // The ✕ is the one focusable control in the card with no testid that is not the full-bleed
      // backdrop: a ~30px square in the title bar. Matched by SHAPE because the icon it draws is a
      // font glyph with no text of its own to locate it by.
      const x = [...card.querySelectorAll('[tabindex]')]
        .filter((e) => !e.getAttribute('data-testid'))
        .find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.width <= 60 && r.height <= 60; });
      if (!x) return false;
      x.click();
      return true;
    });
    if (!closed) throw new HarnessError('the Advanced Filter card rendered no ✕ control to close it with');
    const gone = await until(async () => (await afState(page)) === null, 25000);
    if (!gone) bad.push('pressing ✕ did not close the Advanced Filter card');

    const after = await settle(page, () => resultsState(page), 30000);
    evidence.after = after;
    if (after.countChip !== before.countChip) bad.push(`closing the Advanced Filter with ✕ changed the results count chip: «${before.countChip}» → «${after.countChip}»`);
    if (after.firstCard !== before.firstCard) bad.push(`closing the Advanced Filter with ✕ changed the first result: ${before.firstCard} → ${after.firstCard}`);
    if (after.cards !== before.cards) bad.push(`closing the Advanced Filter with ✕ changed the number of results on screen: ${before.cards} → ${after.cards}`);

    if (ctx.pageErrors.length) bad.push(`uncaught page error during the Advanced Filter round: ${ctx.pageErrors[0]}`);
    return bad.length ? violated(bad, evidence) : ok(evidence);
  },
};

// ── G12 · normal_filter ──────────────────────────────────────────────────────────────────────────
// STATE, not matching — routine #4 owns whether the results are right. What this owns is whether the
// form still holds what the user typed by the time they press «بحث», and whether «مسح الكل» really
// clears rather than merely looking cleared. Both failures are silent by construction: a control
// that quietly reverts, or a value that survives a clear, changes the search WITHOUT changing the
// screen the user is reading — which is the only way a filter can lie.
//
// Selection is read off the paint (the selFill token every OptionBox fills with when chosen), so the
// oracle sees what the user sees rather than what the store believes. The last leg presses «بحث» and
// reads the property-search RPC itself: after a clear, the predicates must be gone from the WIRE,
// not merely from the screen.
const DEAL_BUY = 'شراء';
const DEAL_RENT = 'إيجار';
const CATEGORY_RESIDENTIAL = 'سكني';
const BEDS_ANY = 'أي عدد';
const CLEAR_ALL = 'مسح الكل';
const FILTER_CITY = 'الدمام';
const FILTER_GROUP = 'الفلل والبيوت';

/** Whether each named control is painted as SELECTED right now. An ambiguous label is a harness fact. */
const controlStates = (page, labels) => page.evaluate(([wanted, selFill]) => {
  const out = {};
  for (const label of wanted) {
    const hits = [...document.querySelectorAll('*')]
      .filter((e) => e.children.length === 0 && (e.textContent || '').trim() === label);
    out[label] = hits.length !== 1
      ? { found: hits.length, selected: null }
      : { found: 1, selected: getComputedStyle(hits[0].parentElement).backgroundColor === selFill };
  }
  return out;
}, [labels, SELECTED_FILL]);

const inputs = (page) => page.evaluate(() => {
  const v = (t) => document.querySelector(`[data-testid="${t}"]`)?.value ?? null;
  return {
    city: v('city-input'),
    priceMin: v('price-min-input'),
    priceMax: v('price-max-input'),
    areaMin: v('area-min-input'),
    areaMax: v('area-max-input'),
    districtChips: [...document.querySelectorAll('[data-testid="district-chip"]')].length,
  };
});

const G12 = {
  id: 'filter-state-survives',
  title: 'The Filter form holds what the user set while other controls change, and «مسح الكل» really clears it — off the screen and off the wire',
  surface: 'normal_filter',
  steps: [
    'Open https://ezhalah-app.vercel.app/ and dismiss the sign-in card.',
    `Set a full filter: «${DEAL_RENT}», the city ${FILTER_CITY}, the type group «${FILTER_GROUP}», 3 bedrooms, an area range and a price range.`,
    'Change an unrelated control (add a second bedroom count) and re-read every other control.',
    'Assert the deal, city, type group, area range and price range all still hold what was set.',
    `Press «${CLEAR_ALL}».`,
    'Assert the city, price and area fields are empty, the bedrooms are back to «أي عدد», the deal is back to «شراء», the category is back to «سكني», and the «مسح الكل» control itself is gone.',
    'Pick a city and press «بحث»; assert the property-search RPC carries no bedroom, price, area or district predicate left over from before the clear.',
  ],
  async run(page, ctx) {
    await open(page, '/');
    await dismissAuthInvitation(page);
    const bad = [];
    const evidence = {};

    // ── set a full filter ─────────────────────────────────────────────────────────────────────
    if (!await tap(page, DEAL_RENT)) throw new HarnessError(`the filter form offered no «${DEAL_RENT}» control`);
    await sleep(1500);
    if (!await pickCity(page, FILTER_CITY)) throw new HarnessError(`the product did not offer the city «${FILTER_CITY}»`);
    if (!await tap(page, FILTER_GROUP)) throw new HarnessError(`the filter form offered no «${FILTER_GROUP}» type group`);
    await sleep(1500);
    if (!await tap(page, '3')) throw new HarnessError('the filter form offered no «3» bedroom control');
    await sleep(1200);
    await page.locator('[data-testid="area-min-input"]').fill('150').catch(() => {});
    await page.locator('[data-testid="area-max-input"]').fill('400').catch(() => {});
    await page.locator('[data-testid="price-min-input"]').fill('40000').catch(() => {});
    await page.locator('[data-testid="price-max-input"]').fill('180000').catch(() => {});
    await sleep(1500);

    const LABELS = [DEAL_BUY, DEAL_RENT, CATEGORY_RESIDENTIAL, FILTER_GROUP, BEDS_ANY, '2', '3'];
    const set = { controls: await controlStates(page, LABELS), fields: await inputs(page) };
    evidence.set = set;
    for (const [label, s] of Object.entries(set.controls)) {
      if (s.found !== 1) throw new HarnessError(`the control «${label}» matched ${s.found} elements on the filter form — its state cannot be read unambiguously`);
    }
    if (!set.controls[DEAL_RENT].selected) throw new HarnessError(`pressing «${DEAL_RENT}» did not select it — the state to be preserved was never set`);
    if (!set.controls[FILTER_GROUP].selected) throw new HarnessError(`pressing «${FILTER_GROUP}» did not select it — the state to be preserved was never set`);
    if (!set.controls['3'].selected) throw new HarnessError('pressing the «3» bedroom control did not select it — the state to be preserved was never set');
    if (set.fields.city !== FILTER_CITY) throw new HarnessError(`the city field holds «${set.fields.city}» instead of «${FILTER_CITY}»`);

    // ── change ONE unrelated control and re-read everything else ──────────────────────────────
    if (!await tap(page, '2')) throw new HarnessError('the filter form offered no «2» bedroom control');
    await sleep(2000);
    const kept = { controls: await controlStates(page, LABELS), fields: await inputs(page) };
    evidence.afterUnrelatedChange = kept;
    const survives = (label) => {
      if (kept.controls[label].selected !== set.controls[label].selected) {
        bad.push(`adding a second bedroom count changed «${label}» from ${set.controls[label].selected ? 'selected' : 'unselected'} to ${kept.controls[label].selected ? 'selected' : 'unselected'} — a control the user did not touch moved under them`);
      }
    };
    for (const label of [DEAL_BUY, DEAL_RENT, CATEGORY_RESIDENTIAL, FILTER_GROUP]) survives(label);
    if (!kept.controls['3'].selected) bad.push('adding the «2» bedroom count dropped the «3» the user had already chosen');
    for (const [field, was] of Object.entries(set.fields)) {
      if (field === 'districtChips') continue;
      if (kept.fields[field] !== was) bad.push(`adding a second bedroom count changed the ${field} field from «${was}» to «${kept.fields[field]}»`);
    }

    // ── «مسح الكل» must actually clear ────────────────────────────────────────────────────────
    if (!await tap(page, CLEAR_ALL)) throw new HarnessError(`the filter form offered no «${CLEAR_ALL}» control to clear with`);
    await sleep(2500);
    const cleared = { controls: await controlStates(page, LABELS), fields: await inputs(page) };
    evidence.afterClear = cleared;
    for (const [field, v] of Object.entries(cleared.fields)) {
      if (field === 'districtChips') { if (v !== 0) bad.push(`«${CLEAR_ALL}» left ${v} district chip(s) behind`); continue; }
      if (v) bad.push(`«${CLEAR_ALL}» left «${v}» in the ${field} field — a later search would still be scoped by it`);
    }
    if (cleared.controls[DEAL_RENT].found === 1 && cleared.controls[DEAL_RENT].selected) bad.push(`«${CLEAR_ALL}» left «${DEAL_RENT}» selected — the deal was not reset`);
    if (cleared.controls[DEAL_BUY].found === 1 && !cleared.controls[DEAL_BUY].selected) bad.push(`«${CLEAR_ALL}» left the deal on neither «${DEAL_BUY}» nor its default`);
    if (cleared.controls[CATEGORY_RESIDENTIAL].found === 1 && !cleared.controls[CATEGORY_RESIDENTIAL].selected) bad.push(`«${CLEAR_ALL}» left the category off «${CATEGORY_RESIDENTIAL}» — the category must always be exactly one`);
    if (cleared.controls[FILTER_GROUP].found === 1 && cleared.controls[FILTER_GROUP].selected) bad.push(`«${CLEAR_ALL}» left the type group «${FILTER_GROUP}» selected`);
    if (cleared.controls[BEDS_ANY].found === 1 && !cleared.controls[BEDS_ANY].selected) bad.push(`«${CLEAR_ALL}» left the bedroom count off «${BEDS_ANY}»`);
    for (const beds of ['2', '3']) {
      if (cleared.controls[beds].found === 1 && cleared.controls[beds].selected) bad.push(`«${CLEAR_ALL}» left the «${beds}» bedroom count selected`);
    }
    // The control renders only while a filter is active, so its own disappearance is the product's
    // verdict on whether anything survived the clear.
    const stillOffered = await page.evaluate((t) => [...document.querySelectorAll('*')]
      .some((e) => e.children.length === 0 && (e.textContent || '').trim() === t), CLEAR_ALL);
    if (stillOffered) bad.push(`«${CLEAR_ALL}» is still on screen after clearing — the form still considers a filter active, so something survived`);

    // ── and off the wire ──────────────────────────────────────────────────────────────────────
    if (!await pickCity(page, 'الرياض')) throw new HarnessError('the product did not offer the city «الرياض» after the clear');
    await runSearch(page, SLOW_SEARCH_BUDGET_MS);
    const body = listingFetch(ctx);
    if (!body) throw new HarnessError('the search after the clear sent no paged property-search RPC to inspect');
    evidence.rpcAfterClear = {
      p_deal: body.p_deal, p_districts: body.p_districts,
      p_beds_exact: body.p_beds_exact, p_beds_min: body.p_beds_min,
      p_price_min: body.p_price_min, p_price_max: body.p_price_max,
      p_area_min: body.p_area_min, p_area_max: body.p_area_max,
    };
    for (const [k, v] of Object.entries(evidence.rpcAfterClear)) {
      if (k === 'p_deal') continue;
      const empty = v == null || (Array.isArray(v) && v.length === 0);
      if (!empty) bad.push(`the search after «${CLEAR_ALL}» still carries ${k}=${JSON.stringify(v)} — the cleared filter is silently scoping the new search`);
    }
    if (body.p_deal !== 'بيع') bad.push(`the search after «${CLEAR_ALL}» ran with p_deal=${JSON.stringify(body.p_deal)} — the form shows «${DEAL_BUY}», so the cleared deal did not reach the search`);

    if (ctx.pageErrors.length) bad.push(`uncaught page error on the filter form: ${ctx.pageErrors[0]}`);
    return bad.length ? violated(bad, evidence) : ok(evidence);
  },
};

// ── G13 · voice ──────────────────────────────────────────────────────────────────────────────────
// The mic is gated on a LIVE capability probe with no browser-name exclusion of any kind (owner
// ruling 2026-08-25, reversing the day-old "hide it on iOS Safari"): isVoiceInputSupported() asks
// only whether the runtime exposes SpeechRecognition and getUserMedia. A UA sniff creeping back in
// would hide the mic from browsers that support it, and dropping the gate would show a mic that can
// only ever flash a failure and revert. Both directions are the same bug, so both are proven here:
// once against the browser's REAL capability, and once in a context where the recognizer has been
// removed before the app boots.
//
// THE MIC IS NEVER PRESSED. Pressing it asks for the microphone, which is a permission prompt from a
// monitoring run; its presence is the whole contract and presence is what is read.
const VOICE_TAB = 'الوكيل الذكي';

const voiceSurface = (page) => page.evaluate(() => ({
  recognizer: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
  getUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  mics: [...document.querySelectorAll('[data-testid="voice-mic"]')].filter((e) => {
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(e);
    return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.01;
  }).length,
}));

/** Open the AI Agent composer as a guest. The mic lives beside Send, so the composer is the gate. */
async function openComposer(page) {
  await open(page, '/');
  await dismissAuthInvitation(page);
  if (!await tap(page, VOICE_TAB)) throw new HarnessError(`the app offered no «${VOICE_TAB}» tab to reach the composer`);
  const composer = await until(() => page.$('textarea'), 30000);
  if (!composer) throw new HarnessError('the AI Agent composer never rendered — the voice control cannot be judged');
  await sleep(2500);
}

const G13 = {
  id: 'voice-button-matches-capability',
  title: 'The microphone is offered exactly when the browser can actually listen: present with SpeechRecognition, absent without it',
  surface: 'voice',
  steps: [
    'Open https://ezhalah-app.vercel.app/, dismiss the sign-in card and switch to الوكيل الذكي.',
    'Read the browser\'s real capability (window.SpeechRecognition / webkitSpeechRecognition and navigator.mediaDevices.getUserMedia) and count the visible voice-mic controls.',
    'Assert the mic is present when and only when the runtime can actually run speech recognition.',
    'Reload the app in a context where SpeechRecognition and webkitSpeechRecognition are removed before the app boots.',
    'Assert the capability now reads false and no voice-mic control is rendered. The mic is never pressed — no microphone permission is ever requested.',
  ],
  async run(page, ctx) {
    const bad = [];
    await openComposer(page);
    const live = await voiceSurface(page);
    const capable = live.recognizer && live.getUserMedia;
    if (capable && live.mics === 0) {
      bad.push(`this browser exposes SpeechRecognition and getUserMedia yet no microphone control is rendered — voice input is hidden from a runtime that supports it (owner ruling 2026-08-25: capability only, never a browser-name guess)`);
    }
    if (!capable && live.mics > 0) {
      bad.push(`the microphone control is rendered although the runtime cannot listen (SpeechRecognition=${live.recognizer}, getUserMedia=${live.getUserMedia}) — pressing it can only fail`);
    }
    if (live.mics > 1) bad.push(`${live.mics} microphone controls are rendered in the composer at once`);

    // The other direction, proven rather than assumed: same app, same page, no recognizer at boot.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
      Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
    });
    await openComposer(page);
    const stripped = await voiceSurface(page);
    if (stripped.recognizer) {
      throw new HarnessError('the recognizer was still present after it was removed at boot — the incapable half of this journey never actually ran');
    }
    if (stripped.mics > 0) {
      bad.push(`with SpeechRecognition removed before boot the composer still renders ${stripped.mics} microphone control(s) — the mic is not gated on the capability it needs`);
    }

    if (ctx.pageErrors.length) bad.push(`uncaught page error on the voice surface: ${ctx.pageErrors[0]}`);
    const evidence = { live, stripped };
    return bad.length ? violated(bad, evidence) : ok(evidence);
  },
};

/** The suite. Order is the order the runner drives them. */
export const JOURNEYS = [G1, G2, G3, G4, G5, G6, G7, G8, G9, G10, G11, G12, G13];

/** The surfaces incident_route_owner() knows. A journey outside this set has no owner. */
export const ALLOWED_SURFACES = [
  'theme', 'chat_persistence', 'auth', 'navigation', 'result_card', 'loading_states', 'modal', 'search',
  'pagination', 'trending', 'advanced_filter', 'normal_filter', 'voice',
];

export { BASE };
