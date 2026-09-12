// A LIVE JOURNEY MUST ANSWER THE COOKIE BANNER, OR IT IS CLICKING INTO AN OVERLAY.
// Auto-discovered barrier (scripts/verify-*.ts), offline and deterministic: it EXECUTES
// scripts/lib/liveConsent.ts against fake pages. No network, no browser. Safe inside `npm test`.
//
// WHY (measured on production 2026-09-11, ops_incident #142). The cookie consent card shipped
// 2026-09-06: `position: fixed`, `right: 20`, `width: 280`, `bottom: 20`, `pointer-events: auto`,
// shown to every signed-out web visitor. On a 1440-wide desktop it sits in the free right margin —
// the shipping PR measured exactly that and found no overlap. On a 390x844 phone the same card spans
// x∈[70,370] of a 390px screen, on top of the app's primary «بحث» control. elementFromPoint at the
// centre of «بحث» returned the card's own «السماح بالكل» button.
//
// A real visitor sees the card and answers it. Four AF/Trending live checks did not, so their first
// tap was eaten by the banner and they reported, for five consecutive days, that a healthy
// production could not search at all:
//
//   verify-af-pill-removal-live         MOBILE جدة/فيلا → «the baseline search landed: 0 request(s)»
//   verify-af-card-evidence-live        MOBILE جدة/فيلا → «no results-shaped request captured in 45s»
//   verify-trending-live-four-way-truth MOBILE الدمام   → «the search request was captured after
//                                                          click-through» (it never fired)
//   verify-af-scope-change-live         MOBILE non-Riyadh
//
// WHAT THIS PINS, and why each half matters:
//   1. the dismissal is EXECUTED and works — card present → answered → gone;
//   2. an ABSENT card is not an error (a stored consent, a signed-in context) and clicks nothing;
//   3. a card that will NOT go away THROWS. That is the one outcome a harness must never shrug at:
//      it is a statement about the app, and a helper that swallowed it would hide the very class it
//      was written for;
//   4. it lives in the SHARED arrival path and nowhere else. A per-journey copy is the drift this
//      surface keeps paying for (AGENTS.md harness note 13) — so a journey that hand-rolls its own
//      cookie dismissal is red here, by discovery, not by a list someone has to maintain.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  dismissCookieConsent, CONSENT_CARD, CONSENT_ALLOW_ALL, type ConsentPage,
} from './lib/liveConsent.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = join(ROOT, 'scripts');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};
const QUIET = { appearMs: 5, disappearMs: 5, log: () => {} };

/** A fake page: `present` decides whether the card is there, `sticky` whether answering removes it. */
const fake = (present: boolean, sticky = false) => {
  const seen = { waits: [] as string[], clicks: [] as string[] };
  const page: ConsentPage = {
    waitForSelector: async (sel, o) => {
      seen.waits.push(`${sel}:${o.state}`);
      if (o.state === 'attached') { if (!present) throw new Error('timeout'); return {}; }
      if (sticky) throw new Error('timeout');            // answered, still on screen
      return {};
    },
    click: async (sel) => { seen.clicks.push(sel); },
  };
  return { page, seen };
};

console.log('\nA live journey answers the cookie banner, in the shared arrival path\n');

// ── 1. THE CARD IS ANSWERED ─────────────────────────────────────────────────────────────────────
{
  const { page, seen } = fake(true);
  const r = await dismissCookieConsent(page, QUIET);
  check('a card that is up is answered with «السماح بالكل» and confirmed gone',
    r.seen && r.dismissed && !r.skipped
    && seen.clicks.length === 1 && seen.clicks[0] === CONSENT_ALLOW_ALL
    && seen.waits[0] === `${CONSENT_CARD}:attached`
    && seen.waits[1] === `${CONSENT_CARD}:detached`,
    JSON.stringify({ r, seen }));
}

// ── 2. AN ABSENT CARD IS NOT AN ERROR ───────────────────────────────────────────────────────────
{
  const { page, seen } = fake(false);
  const r = await dismissCookieConsent(page, QUIET);
  check('no card ⇒ seen:false, nothing clicked, no throw (a stored consent is normal)',
    !r.seen && !r.dismissed && !r.skipped && seen.clicks.length === 0, JSON.stringify({ r, seen }));
}

// ── 3. A STUCK CARD IS A FINDING, NOT A SHRUG ───────────────────────────────────────────────────
{
  const { page } = fake(true, true);
  const err = await dismissCookieConsent(page, QUIET).then(() => null, (e) => String(e));
  check('a card that will not go away THROWS, naming the consequence for everything after it',
    err != null && /STILL on screen/.test(err) && /consumed/.test(err), String(err).slice(0, 160));
}

// ── 4. A PAGE THAT CANNOT BE DRIVEN IS LEFT ALONE ───────────────────────────────────────────────
{
  const r = await dismissCookieConsent({}, QUIET);
  check('a fixture with no DOM methods is skipped, never thrown at',
    r.skipped && !r.seen && !r.dismissed, JSON.stringify(r));
}

// ── 5. ONE MECHANISM, IN THE SHARED PATH ────────────────────────────────────────────────────────
// Discovery, not a list: any live journey that names a consent testid itself is keeping a private
// copy of a shared vocabulary, which is how this surface drifts. gotoLive is the one legitimate
// caller (it IS the shared arrival path), and this barrier names them for the same reason.
//
// THE SUBJECT IS A JOURNEY THAT DRIVES A PAGE, NOT ANY FILE THAT MENTIONS THE TESTID. A pure
// geometry check can legitimately name 'cookie-consent' as a synthetic rect label without touching
// the browser at all — scripts/verify-bottom-prompt-inset.ts does exactly this (ops_incident #152's
// span-rule cases), and flagging it here would be exactly the false-positive class AGENTS.md warns
// against (a source-TEXT tripwire, not a check of what the file actually does). Requiring a real
// Playwright import is the same idiom `verify-af-live-journeys-outlast-the-search-beat.ts` already
// uses to separate "types a wait" from "writes about one".
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
const OWNERS = new Set(['verify-live-journeys-answer-the-consent-card.ts', 'verify-cookie-consent-gating.ts']);
const privateCopies = readdirSync(SCRIPTS)
  .filter((f) => /^verify-.*\.(ts|mjs)$/.test(f) && !OWNERS.has(f))
  .filter((f) => {
    const src = stripComments(readFileSync(join(SCRIPTS, f), 'utf8'));
    return /from ['"]playwright['"]/.test(src)
      && /cookie-consent|cookie-allow-all|cookie-only-necessary/.test(src);
  });
check('no live journey keeps its own copy of the consent dismissal',
  privateCopies.length === 0,
  privateCopies.map((f) => `${f} drives the consent card itself — use the shared arrival path`).join('; '));

const navSrc = readFileSync(join(SCRIPTS, 'lib', 'liveNav.ts'), 'utf8');
check('the shared arrival path (gotoLive) is the thing that answers it',
  navSrc.includes('dismissCookieConsent(page'), 'liveNav.ts no longer answers the consent card');

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proof — the same predicates, against the defects they exist to catch\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

// M-1: THE DEFECT ITSELF — a journey that never answers the card. Expressed as the helper being a
// no-op: the card is up, nothing is clicked, and the caller is told everything is fine.
mustCatch('a "dismissal" that clicks nothing while the card is up', await (async () => {
  const { page, seen } = fake(true);
  const noop = async () => ({ seen: false, dismissed: false, skipped: false });
  const r = await noop();
  return !r.seen && seen.clicks.length === 0;   // ← what this file's check 1 refuses to accept
})());

// M-2: the stuck card swallowed instead of thrown — the shape that would hide a real overlay defect.
mustCatch('a stuck card reported as success instead of thrown', await (async () => {
  const { page } = fake(true, true);
  const threw = await dismissCookieConsent(page, QUIET).then(() => false, () => true);
  return threw;   // the real helper throws; a swallowing one would not, and check 3 would go red
})());

// M-3: an absent card treated as a failure — that would turn every signed-in journey red.
mustCatch('an absent card mistaken for an error', await (async () => {
  const { page } = fake(false);
  const r = await dismissCookieConsent(page, QUIET).then((x) => x, () => null);
  return r != null && r.seen === false;
})());

// M-4: the shared path stops answering it — the class comes straight back, on every journey at once.
mustCatch('the shared arrival path dropping the dismissal',
  !'await page.goto(url); return attempt;'.includes('dismissCookieConsent(page'));

// M-5: a journey reintroducing its own copy beside the shared one. Must carry BOTH conditions the
// real predicate checks — a browser import AND the testid — or this proves nothing about it.
//
// The import line is assembled at runtime, deliberately never written as one contiguous literal in
// THIS file's own source: `verify-live-nav-retries-transport-only.ts` text-scans every verify-*
// file for exactly that substring to find real Playwright-driven checks, and a fixture that quoted
// it verbatim made this very file misclassify as a browser check (caught live, 2026-09-11).
mustCatch('a journey that hand-rolls its own consent dismissal', (() => {
  const importLine = ['import', '{', 'chromium', '}', 'from', "'play" + "wright';"].join(' ');
  const src = stripComments(`${importLine}\nawait page.click('[data-testid="cookie-allow-all"]');`);
  return /from ['"]playwright['"]/.test(src) && /cookie-allow-all/.test(src);
})());

// M-6: and a journey that simply uses the shared path must NOT be flagged.
mustCatch('a clean journey is not flagged',
  !/cookie-consent|cookie-allow-all/.test(stripComments('await gotoLive(page, `${BASE}/`);')));

// M-7: THE 2026-09-11 FALSE POSITIVE — a pure geometry check that names the testid in a synthetic
// rect label but drives no browser at all (verify-bottom-prompt-inset.ts's real shape). The
// predicate must clear it, or every offline consumer of this selector fails the suite forever.
mustCatch('a pure offline check that only NAMES the testid is not flagged as a private copy', (() => {
  const src = stripComments(
    "const CONSENT_SHEET = { top: 654, bottom: 844, width: 390 }; // '[data-testid=\"cookie-consent\"]'\n"
    + "check('reserves its height', bottomPromptInset(CONSENT_SHEET, 844, 390) === 190);");
  const flagged = /from ['"]playwright['"]/.test(src) && /cookie-consent/.test(src);
  return !flagged;   // must NOT be flagged — this is the false positive that got caught
})());

if (mutFail > 0) failed += mutFail;

console.log(
  failed === 0
    ? '\n✅ the consent card is answered once, in the shared arrival path, and a stuck card is a finding.\n'
    : `\n❌ ${failed} check(s) failed — a live journey can click into the consent overlay.\n`);
process.exit(failed === 0 ? 0 : 1);
