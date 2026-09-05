// THE GUARDIAN SUITE FILES P1 INCIDENTS AGAINST PRODUCTION. ITS ORACLES MUST DISCRIMINATE.
//
// e2e/guardian/run.mjs opens an owned ops_incident on a product failure. That is the right design
// and it is exactly why a sloppy oracle is expensive here: it does not merely go red in a log, it
// puts a P1 on a routine's queue naming a bug that does not exist. Two did, on 2026-09-05, and both
// were harness defects filing against an app that was behaving correctly (PART 9.4 — mine to fix).
//
// ── #4 / #23 · the auth invitation was detected by a control the product removed ────────────────
// The invitation has TWO presentations of the ONE AuthForm: the compact `signin-card` (desktop,
// unprompted) and the centered `auth-popup` (on demand, both viewports). The owner's 2026-09-03
// redesign removed the × from the modal's main step deliberately — «a press on the ground closes
// it» (AuthModal.tsx:272). The detector counted `auth-popup-close`, so on a phone it read 0 against
// an open, correct modal and filed «the only sign-in entry point at this viewport is dead». Five
// observations of a P1 that was never real.
//
// Measured on production 2026-09-05, 2/2 fresh contexts per viewport:
//   mobile 375   fresh → popup 0, card 0;  after «إنشاء حساب / تسجيل الدخول» → popup 1, card 0, Google 1
//   desktop 1440 fresh → popup 0, card 1, close 1
//   mobile, ground press at (10,10) → popup 1 → 0        (the dismissal genuinely works)
//
// THE DETECTOR AND THE DISMISSAL ARE ONE FIX, WHICH IS WHY THIS BARRIER COVERS BOTH. The first
// attempt at #23 fixed only the detector and had to be reverted: dismissAuthInvitation still looked
// for the ×, returned 'stuck', and left the modal covering the city field in four unrelated mobile
// journeys — 15 PASS / 1 FAIL / 0 UNDETERMINED became 11 / 0 / 5. A barrier that pinned only the
// detection half would have waved that regression straight through.
//
// ── #51 · one RPC name, two different acts, counted as one ──────────────────────────────────────
// `location_search_candidates_ar` carries BOTH the submitted results search (`p_limit: 1500`) and
// the per-option COUNT calls that decorate whatever scope options are on screen (`p_limit: 1`, one
// per visible option — src/data/remote.ts:920/:965). The guardian harness counted every request
// with that name, so «New Chat fired 1 property-search RPC — it must execute nothing» was filed as
// a P1 against a Filter home that had submitted nothing and merely counted an option.
//
// §11.3 states the rule in the spec and records the identical false verdict in the other suite
// («double-click fired the search twice» when both sides had submitted exactly one search). That
// suite has classifySearchRpc(); this one had nothing. It does now.
//
// THE FIX DOES NOT SILENCE THE FINDING, IT MAKES IT DISCRIMINATE — a real submitted search after
// New Chat still fails, and now says so truthfully. Both directions are asserted below, because a
// classifier that only ever excuses is the blindfold PART 9 warns about.
//
// EVERYTHING HERE EXECUTES THE REAL EXPORTS from e2e/guardian/, against stub pages. Every one of
// the five defects of 2026-09-04 had a source-TEXT tripwire over the exact line and every one of
// them stayed green for as long as the defect was live (AGENTS.md). A grep would have passed here
// too: the old code contained the string 'auth-popup' inside 'auth-popup-close'.
//
// Run: node --experimental-strip-types scripts/verify-guardian-oracles-discriminate.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isResultsSearch, dismissAuthInvitation, AUTH_INVITATION_SELECTOR } from '../e2e/guardian/harness.mjs';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (m: string, cond: boolean) => {
  if (cond) console.log(`  ok  ${m}`);
  else { console.error(`  FAIL  ${m}`); failed++; }
};
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught);

// ═══ §1 · the RPC classifier, executed, in BOTH directions ══════════════════════════════════════
console.log('§1 submitted search vs. option count');
check('p_limit 1500 is a submitted results search', isResultsSearch({ p_limit: 1500 }) === true);
check('p_limit 1 is an option COUNT, not a search', isResultsSearch({ p_limit: 1 }) === false);
check('p_limit 100 (a smaller page) is still a submitted search', isResultsSearch({ p_limit: 100 }) === true);
check('a body with no p_limit is not counted as a search', isResultsSearch({}) === false);
check('a string p_limit is not counted as a search', isResultsSearch({ p_limit: '1500' } as never) === false);
check('an unparseable body is not counted as a search', isResultsSearch(undefined as never) === false);

// The measured shape of ONE «بحث» press (§11.3): 1 results call + 5 p_limit:1 option counts.
const ONE_PRESS = [{ p_limit: 1500 }, ...Array.from({ length: 5 }, () => ({ p_limit: 1 }))];
check('one press of «بحث» classifies as exactly ONE submitted search, not six',
  ONE_PRESS.filter(isResultsSearch).length === 1);
// The #51 shape: a Filter home booting and decorating one option, having submitted nothing.
check('a boot that only decorates an option counts as ZERO submitted searches',
  [{ p_limit: 1 }].filter(isResultsSearch).length === 0);
// The direction that must NOT be excused — the guard still guards.
check('a genuine second submitted search is still counted (the classifier is not a blindfold)',
  [...ONE_PRESS, { p_limit: 1500 }].filter(isResultsSearch).length === 2);

console.log('§1 mutations');
{
  // The defect exactly as it shipped: count by RPC name alone.
  const byName = (_b: unknown) => true;
  mustCatch('counting every location_search_candidates_ar call as a submitted search (#51: a boot reads as a search)',
    [{ p_limit: 1 }].filter(byName).length !== 0);
  mustCatch('counting by name turning one press into six searches',
    ONE_PRESS.filter(byName).length !== 1);
  // The opposite mutation: excuse everything, so a real search never registers.
  const never = (_b: unknown) => false;
  mustCatch('a classifier that excuses everything, so a real second search never registers',
    [...ONE_PRESS, { p_limit: 1500 }].filter(never).length !== 2);
  // Off-by-one: `>= 1` would re-swallow the option counts.
  const gte1 = (b: { p_limit?: number }) => typeof b?.p_limit === 'number' && b.p_limit >= 1;
  mustCatch('a `>= 1` bound that puts the option counts back into the search count',
    [{ p_limit: 1 }].filter(gte1).length !== 0);
}

// ═══ §2 · the auth invitation: detection AND dismissal, executed together ═══════════════════════
// A stub page that models what production actually renders. It answers about whichever selector the
// real function asks for, so a mutation that reverts the selector genuinely changes the outcome.
/** @param present  the invitation hosts production is currently rendering
 *  @param stubborn true = nothing ever closes it (used to prove a closure check can still fail) */
function makePage(present: string[], stubborn = false) {
  let live = new Set(present);
  const has = (sel: string) => sel.split(',').some((s) => live.has(s.trim()));
  const p = {
    groundPresses: 0,
    closeClicks: 0,
    // page.$ resolves an element handle only for a selector that is actually rendered — so a
    // mutation reverting to a selector this presentation does not render really does get null.
    $: async (sel: string) => (has(sel) ? {
      click: async () => { p.closeClicks++; if (!stubborn) live = new Set(); },
    } : null),
    mouse: {
      // The ground press is the centered modal's own outer Pressable (AuthModal.tsx:139). A press
      // at (10,10) on a desktop card page lands on the page, not the card, so the card is untouched.
      click: async (_x: number, _y: number) => {
        p.groundPresses++;
        if (!stubborn && live.has('[data-testid="auth-popup"]')) live = new Set();
      },
    },
    // countVisible() goes through page.evaluate(fn, selector); the stub answers about whichever
    // selector the real function passes, which is what makes the selector mutations meaningful.
    evaluate: async (_fn: unknown, sel: string) => (has(sel) ? 1 : 0),
  };
  return p;
}

console.log('\n§2 the auth invitation is found and closed on BOTH presentations');
{
  // Mobile: the centered modal, no ×. This is the exact state that filed #4 five times.
  const p = makePage(['[data-testid="auth-popup"]']);
  const r = await dismissAuthInvitation(p as never, 1000);
  check('mobile centered modal (no ×) is FOUND, not reported absent', r !== 'absent');
  check('mobile centered modal is dismissed by a ground press', r === 'dismissed');
  check('the ground press was actually used (no × was clicked)', p.groundPresses === 1 && p.closeClicks === 0);
}
{
  // Desktop: the compact card, which keeps its ×.
  const p = makePage(['[data-testid="signin-card"]', '[data-testid="auth-popup-close"]']);
  const r = await dismissAuthInvitation(p as never, 1000);
  check('desktop compact card is dismissed by its ×', r === 'dismissed');
  check('the × was used on the card, not a ground press', p.closeClicks === 1 && p.groundPresses === 0);
}
{
  // Genuinely absent — a fact, not a failure. The journey relies on this to skip cleanly.
  const p = makePage([]);
  check('no invitation on screen returns "absent", never a false dismissal',
    (await dismissAuthInvitation(p as never, 300)) === 'absent');
}
check('the shared selector covers both presentations and nothing else',
  AUTH_INVITATION_SELECTOR.includes('auth-popup"]') && AUTH_INVITATION_SELECTOR.includes('signin-card'));

console.log('§2 mutations — the real file is edited and re-executed');
{
  const HARNESS = join(ROOT, 'e2e/guardian/harness.mjs');
  const original = readFileSync(HARNESS, 'utf8');
  const { writeFileSync } = await import('node:fs');
  let n = 0;
  type Page = ReturnType<typeof makePage>;
  const withMutation = async (
    label: string,
    mutate: (s: string) => string,
    expectBroken: (r: string, p: Page) => boolean,
    page: () => Page = () => makePage(['[data-testid="auth-popup"]']),
  ) => {
    const mutated = mutate(original);
    if (mutated === original) { console.error(`  FAIL  (mutation) «${label}» changed nothing — the anchor missed`); failed++; return; }
    writeFileSync(HARNESS, mutated);
    try {
      const mod = await import(`../e2e/guardian/harness.mjs?mut=${++n}`);
      const p = page();
      const r = await mod.dismissAuthInvitation(p as never, 300);
      mustCatch(label, expectBroken(r, p));
    } catch (e) {
      mustCatch(`${label} (module threw: ${String(e).slice(0, 60)})`, true);
    } finally {
      writeFileSync(HARNESS, original);
    }
  };
  // The baseline the mutations are measured against: on a modal that REFUSES to close, the real
  // function must say so. A closure check that cannot fail here is decoration, not a check.
  {
    const p = makePage(['[data-testid="auth-popup"]'], true);
    check('a modal that refuses to close is reported still-open (the closure check can fail)',
      (await dismissAuthInvitation(p as never, 300)) === 'still-open');
  }

  // M1 — the defect as it shipped: detect the invitation only by the × the product removed.
  await withMutation(
    'reverting detection to the × alone (#4: an open mobile modal reads as no invitation at all)',
    (s) => s.replace('const invitation = await until(() => page.$(AUTH_INVITATION_SELECTOR), budgetMs);',
      'const invitation = await until(() => page.$(\'[data-testid="auth-popup-close"]\'), budgetMs);'),
    (r) => r === 'absent',
  );

  // M2 — the half-fix that had to be reverted on 2026-09-04: detection widened, dismissal left
  // blind. The modal is found and then never closed, which is what covered the city field.
  await withMutation(
    'dropping the ground-press fallback, so a sheet with no × is found and never closed (the reverted half-fix)',
    (s) => s.replace('else await page.mouse.click(10, 10).catch(() => {});  // the empty ground, well clear of the card', ''),
    (r, p) => r === 'still-open' && p.groundPresses === 0,
  );

  // M3 — THE QUIET DIRECTION, and the one a green suite would never show you. Verify closure
  // against the × again. On the centered modal that × is never rendered, so countVisible is 0
  // before anything happens: the check is VACUOUSLY TRUE and certifies a dismissal that did not
  // occur. Executed against the STUBBORN page — the modal never closes, and the mutated function
  // must be caught calling it 'dismissed' anyway.
  await withMutation(
    'verifying closure by a × this presentation never renders, so a modal that never closed reports "dismissed"',
    (s) => s.replace('const gone = await until(async () => (await countVisible(page, AUTH_INVITATION_SELECTOR)) === 0, 8000);',
      'const gone = await until(async () => (await countVisible(page, \'[data-testid="auth-popup-close"]\')) === 0, 8000);'),
    (r) => r === 'dismissed',
    () => makePage(['[data-testid="auth-popup"]'], true),
  );
}

// ═══ §3 · the CLASS, not just the two examples ══════════════════════════════════════════════════
// Root cause of #51 was a journey asserting on RAW RPC traffic. Any journey that does it again is
// the same bug with a different name, so no guardian journey may read ctx.searches for a claim.
console.log('\n§3 no guardian journey asserts on raw RPC traffic');
{
  const src = readFileSync(join(ROOT, 'e2e/guardian/journeys.mjs'), 'utf8');
  const raw = [...src.matchAll(/ctx\.searches\.length/g)];
  check(`no journey counts ctx.searches.length for an assertion (found ${raw.length}, must be 0 — use ctx.resultsSearches)`,
    raw.length === 0);
  check('the journeys do assert on the classified list',
    src.includes('ctx.resultsSearches.length'));
}

if (failed) { console.error(`\nverify-guardian-oracles-discriminate: ${failed} check(s) failed`); process.exit(1); }
console.log('\nverify-guardian-oracles-discriminate: the guardian suite files P1s only on what production actually did.');
