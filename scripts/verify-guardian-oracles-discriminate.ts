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
const CARD = '[data-testid="signin-card"]';
const MODAL = '[data-testid="auth-popup"]';
const CLOSE_X = '[data-testid="auth-popup-close"]';

/** @param present  the invitation hosts production is currently rendering
 *  @param stubborn true = nothing ever closes it (used to prove a closure check can still fail)
 *  @param remount  what MOUNTS after this one closes, and how long it takes to appear. This is the
 *                  #118 state and the reason the stub needed it: production does not go to an empty
 *                  screen when the modal closes, it hands over to the card (measured 3/3,
 *                  harness.mjs). Modelling the close as "everything is gone forever" is what let
 *                  this barrier stay green for the whole time the defect was live. */
function makePage(
  present: string[],
  stubborn = false,
  remount: { hosts: string[]; afterMs: number } | null = null,
) {
  let live = new Set(present);
  // ONE-SHOT, like the product: the modal hands over to the card once. Dismissing that card is a
  // dismissal, not another hand-off — a stub that re-armed here would make the journey's two-step
  // look like an infinite loop and hide the fact that the second dismissal genuinely sticks.
  let pending = remount;
  const has = (sel: string) => sel.split(',').some((s) => live.has(s.trim()));
  const hostOf = (sel: string) => sel.split(',').map((s) => s.trim()).find((s) => live.has(s));
  const closed = () => {
    if (stubborn) return;
    live = new Set();
    // The hand-off, on a real timer: the card mounts a beat after the modal unmounts.
    if (pending) { const { hosts, afterMs } = pending; pending = null; setTimeout(() => { live = new Set(hosts); }, afterMs); }
  };
  const p = {
    groundPresses: 0,
    closeClicks: 0,
    // page.$ resolves an element handle only for a selector that is actually rendered — so a
    // mutation reverting to a selector this presentation does not render really does get null.
    // The handle carries its own scoped .$(), because the × belongs to a PRESENTATION: the compact
    // card renders one inside itself, the modal's main step renders none (AuthModal.tsx:272). A
    // page-wide lookup cannot tell those apart, which is the shape the scoped lookup exists to stop.
    $: async (sel: string) => {
      const host = hostOf(sel);
      if (!host) return null;
      const click = async () => { p.closeClicks++; closed(); };
      return {
        host,
        click,
        $: async (s: string) => (s === CLOSE_X && live.has(CLOSE_X) && host !== MODAL ? { click } : null),
      };
    },
    mouse: {
      // The ground press is the centered modal's own outer Pressable (AuthModal.tsx:139). A press
      // at (10,10) on a desktop card page lands on the page, not the card, so the card is untouched.
      click: async (_x: number, _y: number) => {
        p.groundPresses++;
        if (live.has(MODAL)) closed();
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

// ═══ §2b · #118 · closing the modal is not a dismissal, and a transient zero is not either ═══════
// Production, desktop 1440, 3/3 fresh contexts, sampled every 250 ms after the ground press:
//     0/1 → 0/0 → 1/0 → 1/0 …        (card/modal; ~250-750 ms with NEITHER on screen)
// The card is suppressed only while the modal is open, so closing the modal hands back to the card
// with a gap in between. Returning on the first zero certified a dismissal that never happened, and
// the journey then filed «the dismissed auth invitation came back» as a P1 against correct product
// behaviour. The verdict must therefore survive the hand-off window, and «it came back» is its own
// answer — not a failure, and above all not a success.
console.log('\n§2b a dismissal verdict survives the modal→card hand-off (#118)');
{
  const p = makePage([MODAL], false, { hosts: [CARD, CLOSE_X], afterMs: 600 });
  const r = await dismissAuthInvitation(p as never, 1000);
  check('closing the modal, with the card taking its place, reports "reappeared" — never "dismissed"',
    r === 'reappeared');
  check('the modal was closed by a ground press, as the product requires', p.groundPresses === 1);
}
{
  // The same call on the card that took over: nothing replaces it, so this one really is a dismissal.
  const p = makePage([CARD, CLOSE_X]);
  check('dismissing the card, with nothing taking its place, is a real "dismissed"',
    (await dismissAuthInvitation(p as never, 1000)) === 'dismissed');
}
{
  // The two-step the journey performs, executed end to end: modal → card → stably gone.
  const p = makePage([MODAL], false, { hosts: [CARD, CLOSE_X], afterMs: 400 });
  const first = await dismissAuthInvitation(p as never, 1000);
  // the card that arrived renders its own ×, exactly as the compact presentation does
  const second = await dismissAuthInvitation(p as never, 2000);
  check('dismiss → reappeared → dismiss again ends stably gone (the journey\'s own sequence)',
    first === 'reappeared' && second === 'dismissed');
}
// KNOWN BOUND, stated rather than hidden: the hold is 1500 ms against a measured 250-750 ms
// hand-off. A presentation that took longer than the hold to mount would read as 'dismissed'. The
// margin is 2×; if the product's hand-off ever slows, this number is what has to move.
{
  const p = makePage([MODAL], false, { hosts: [CARD, CLOSE_X], afterMs: 5000 });
  check('a hand-off SLOWER than the hold is the documented blind spot, not a silent one',
    (await dismissAuthInvitation(p as never, 1000)) === 'dismissed');
}
{
  // HARDENING, not the measured defect: today the card is unmounted while the modal is up, so a
  // page-wide × lookup finds nothing and falls through to the ground press by luck. If both are
  // ever on screen at once, the mechanism must still be the one belonging to the surface found.
  const p = makePage([MODAL, CLOSE_X]);
  await dismissAuthInvitation(p as never, 1000);
  check('with a stray × elsewhere on the page, the modal is still closed by its ground press',
    p.groundPresses === 1 && p.closeClicks === 0);
}

console.log('§2 mutations — the real file is edited and re-executed');
{
  const HARNESS = join(ROOT, 'e2e/guardian/harness.mjs');
  const original = readFileSync(HARNESS, 'utf8');
  const { writeFileSync } = await import('node:fs');

  // THE `finally` BELOW DOES NOT RUN ON A SIGNAL, AND THIS FILE MUTATES A TRACKED FILE IN PLACE.
  // scripts/run-tests.mjs treats a signal-killed child (status === null — timeout, OOM) as a
  // FAILURE precisely because it happens; when it does, the `finally` is skipped and a semantic
  // mutant — here, a DELETED `else` branch that still parses and still runs — is left sitting in
  // the working tree. AGENTS.md states this working directory is shared by concurrent sessions with
  // no isolation, so the next `git add -A` in any session commits it. Observed during the 2026-09-11
  // apparatus sweep: `git status` showed exactly that diff mid-run.
  //
  // SIGKILL and a hard OOM cannot be trapped by anyone; SIGTERM and SIGINT — the realistic timeout
  // and Ctrl-C cases — can, so they are. The handler re-raises after restoring so the process still
  // dies the way the runner expects, and the listeners are removed on the normal path so this block
  // leaves nothing armed behind it.
  const restore = () => { try { writeFileSync(HARNESS, original); } catch { /* best effort */ } };
  const onSignal = (sig: NodeJS.Signals) => {
    restore();
    process.removeListener(sig, onSignal);
    process.kill(process.pid, sig);
  };
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
  process.once('exit', restore);

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
      // A THROW IS NOT A KILLED MUTATION. All three mutations here are string substitutions that
      // must still parse and still run — the evidence has to be the BEHAVIOUR changing, never the
      // module falling over. Counting a throw as a pass is the "proof that cannot fail" shape
      // verify-new-barriers-are-mutation-proven.ts exists to reject, and it caught this exact line
      // in the first draft of this file. So a throw fails the check and says what broke.
      console.error(`  FAIL  (mutation) «${label}» broke the module instead of changing its `
        + `behaviour — no behavioural evidence was obtained: ${String(e).slice(0, 120)}`);
      failed++;
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
    (s) => s.replaceAll('countVisible(page, AUTH_INVITATION_SELECTOR)',
      'countVisible(page, \'[data-testid="auth-popup-close"]\')'),
    (r) => r === 'dismissed',
    () => makePage([MODAL], true),
  );

  // M4 — THE #118 DEFECT ITSELF: take the first zero and call it a dismissal. On the hand-off page
  // that lands in the ~250-750 ms window where the modal has gone and the card has not arrived, and
  // certifies a dismissal that never happened. This is the mutation the barrier existed for and
  // could not express until the stub could model a re-mount.
  await withMutation(
    'returning on the first zero, so the modal→card hand-off window reads as a dismissal (#118)',
    (s) => s.replace(`      const hold = Date.now() + DISMISSAL_HOLD_MS;
      while (Date.now() < hold) {
        await sleep(250);
        if ((await countVisible(page, AUTH_INVITATION_SELECTOR)) !== 0) return 'reappeared';
      }
      return 'dismissed';`, `      return 'dismissed';`),
    (r) => r === 'dismissed',
    () => makePage([MODAL], false, { hosts: [CARD, CLOSE_X], afterMs: 600 }),
  );

  // M5 — the scoped × reverted to a page-wide lookup: it reaches for a control that belongs to a
  // presentation other than the one on screen, and clicks it instead of closing what is up.
  await withMutation(
    'looking the × up page-wide, so one presentation is dismissed by another presentation\'s control',
    (s) => s.replace("const close = await invitation.$('[data-testid=\"auth-popup-close\"]');",
      "const close = await page.$('[data-testid=\"auth-popup-close\"]');"),
    (_r, p) => p.closeClicks === 1 && p.groundPresses === 0,
    () => makePage([MODAL, CLOSE_X]),
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
