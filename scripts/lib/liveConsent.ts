// A LIVE JOURNEY MUST ANSWER THE COOKIE BANNER, THE WAY EVERY REAL VISITOR DOES.
//
// WHY THIS EXISTS (measured 2026-09-11, ops_incident #142). The cookie consent card shipped on
// 2026-09-06 (PR #2093): a `position: fixed` card, `right: 20`, `width: 280`, `bottom: 20`, shown to
// every signed-out web visitor once the session restore settles. On a DESKTOP viewport it sits in the
// free right margin — the PR measured 1440/1512 and found no overlap with the centred filter card.
//
// On a 390x844 PHONE it spans x∈[70,370] of a 390px screen, directly over the app's primary action.
// Measured on production with elementFromPoint at the centre of «بحث»:
//
//     DIV … txt="السماح بالكل"   pointer-events:auto  ← the consent card's own button
//
// A real visitor SEES that card and answers it. A harness that does not is not reproducing a user —
// it is clicking into an overlay, and the first tap on «بحث» is consumed by «السماح بالكل» instead
// of running a search. Six live steps across four AF/Trending checks had been red for five days on
// exactly that, every one of them reporting a correct production as broken:
//
//   verify-af-pill-removal-live        MOBILE جدة/فيلا  → «the baseline search landed: 0 request(s)»
//   verify-af-card-evidence-live       MOBILE جدة/فيلا  → «a plain search landed: no results-shaped
//                                                          request captured in 45s»
//   verify-trending-live-four-way-truth MOBILE الدمام   → «the search request was captured after
//                                                          click-through» (never fired)
//   verify-af-scope-change-live        MOBILE non-Riyadh
//
// THE RULE. Answering the banner is part of ARRIVING at the app, not part of any one journey — so it
// lives in the shared navigation path (gotoLive) and nowhere else. A per-file copy of a shared
// vocabulary is the drift this surface keeps paying for (AGENTS.md harness note 13), and a
// dismissal that each journey has to remember is a dismissal the next journey will forget.
//
// FAIL CLOSED, BOTH WAYS:
//   • banner ABSENT within the budget → `seen: false`. Not an error: a signed-in context, a stored
//     consent, or a page that never mounts it. Nothing is clicked and nothing is asserted.
//   • banner PRESENT and it will not go away after being answered → THROW. A consent card stuck over
//     the app is a real finding about the app, and a harness that shrugged at it would be hiding the
//     very class it was written for.
//
// It clicks «السماح بالكل» because that is the owner's own implied default for a visitor who just
// gets on with it ("left without choosing = allow all", PR #2093) — the journey is reproducing a
// user, not exercising the consent choice, which `scripts/verify-cookie-consent-gating.ts` owns.
//
// Structurally typed on purpose: no import from 'playwright', so the offline barrier can execute
// this against a fake page and prove both directions without a browser.

export const CONSENT_CARD = '[data-testid="cookie-consent"]';
export const CONSENT_ALLOW_ALL = '[data-testid="cookie-allow-all"]';

/** The subset of a Playwright page this needs. Every method optional: a fake page carrying only
 *  `goto` (the offline gotoLive barrier's fixture) must pass straight through, untouched. */
export type ConsentPage = Partial<{
  waitForSelector: (
    sel: string, opts: { timeout: number; state: 'attached' | 'detached' },
  ) => Promise<unknown>;
  click: (sel: string, opts: { timeout: number }) => Promise<unknown>;
}>;

export type ConsentOutcome = {
  /** the card was on screen and had to be answered. */
  seen: boolean;
  /** it was answered and is gone. */
  dismissed: boolean;
  /** the page cannot be driven (a fixture with no DOM methods) — nothing was attempted. */
  skipped: boolean;
};

export type DismissOptions = {
  /** How long to wait for the card to appear. It renders after the auth check settles. Default 9s. */
  appearMs?: number;
  /** How long to wait for it to go away once answered. Default 5s. */
  disappearMs?: number;
  log?: (msg: string) => void;
};

/**
 * Answer the cookie consent card if it is up, so the next click reaches the APP.
 *
 * Returns what happened; throws only when the card was present and did not go away, which is a
 * statement about the app rather than about this helper.
 */
export async function dismissCookieConsent(
  page: ConsentPage, opts: DismissOptions = {},
): Promise<ConsentOutcome> {
  const appearMs = opts.appearMs ?? 9_000;
  const disappearMs = opts.disappearMs ?? 5_000;
  const log = opts.log ?? ((m: string) => console.log(m));

  if (typeof page.waitForSelector !== 'function' || typeof page.click !== 'function') {
    return { seen: false, dismissed: false, skipped: true };
  }

  const appeared = await page
    .waitForSelector(CONSENT_CARD, { timeout: appearMs, state: 'attached' })
    .then(() => true, () => false);
  if (!appeared) return { seen: false, dismissed: false, skipped: false };

  await page.click(CONSENT_ALLOW_ALL, { timeout: disappearMs });
  const gone = await page
    .waitForSelector(CONSENT_CARD, { timeout: disappearMs, state: 'detached' })
    .then(() => true, () => false);
  if (!gone) {
    throw new Error(
      'the cookie consent card was answered («السماح بالكل») and is STILL on screen. It is '
      + '`position: fixed` with `pointer-events: auto`, so every click under it is being consumed '
      + 'by the card instead of by the app — nothing after this point would be testing the app.');
  }
  log('      [consent] cookie card answered («السماح بالكل») before driving the app');
  return { seen: true, dismissed: true, skipped: false };
}
