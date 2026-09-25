// A TAP THE ADVANCED FILTER OFFER NEVER RECEIVED MUST NEVER READ AS A TAP (routine #5, 2026-09-24).
//
// THE DEFECT. `openAfOffer()` (scripts/lib/afOfferLive.ts) is the ONE opener the AF live journeys
// share. It measured the CTA's centre in one round trip and clicked those coordinates in the next —
// and the agent conversation reflows between the two, because cards are still revealing and the turn
// is still growing. When the page moved, the click landed on a listing card and the helper returned
// `{ opened: true }` regardless. Every caller then waited its full budget for an Advanced Filter card
// that had never been asked for, and reported a PRODUCT defect:
//
//     SKIP  an AF question card rendered
//           NOT VERIFIED — the offer opened but no [data-testid="af-card"] appeared in 45s
//     ✗ could not reach an Advanced Filter question; nothing about §12A was proved
//
// MEASURED ON PRODUCTION 2026-09-24, الرياض/شراء/شقة desktop, fleet healthy (ops_search_load_now:
// 356 ms mean, 0.98 qps, degraded=false): 11 of 24 taps landed on `card-listing-11678443` instead of
// the CTA. All 11 produced the exact signature of `ops_incident` #340 — no card, no chips, the CTA
// still on screen, and NOT ONE probe RPC issued, because `startAgeFlow` was never called. Every tap
// observed to land on the CTA opened the card in 73–123 ms. The discriminator is the click.
//
// All four browser steps that were red in af-live-truth-check.yml run 424 go through this helper.
//
// WHAT THIS BARRIER DOES. It EXECUTES the real `openAfOffer` against a stub page whose click misses,
// exactly the way the repo's other apparatus barriers execute a lifted symbol against an injected
// failure rather than grepping the source (AGENTS.md: "Barriers for this class must EXECUTE the
// function against an injected failure"). A source-text tripwire would have passed for the entire
// time this defect was live — the defective line looked correct.
//
// It also carries the mutation as a FIRST-CLASS CASE: `legacyOpenAfOffer` below is the pre-fix body,
// byte-for-byte in behaviour, and the barrier asserts it FAILS the same predicate the shipped one
// passes. So the predicate is proven to discriminate, not merely to be satisfied.
import { openAfOffer, CLICK_LEAF_SRC, CTA_PRESENT_SRC, AF_OFFER_TESTID, AF_OFFER_CTA } from './lib/afOfferLive.ts';
import { ARM_CLICK_WITNESS_SRC, READ_CLICK_WITNESS_SRC, clickWitnessed, isStable } from './lib/liveClick.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// Each mutation below is a shape this helper actually had. `mustCatch` is the repo's proof call:
// it applies the barrier's own predicate to a deliberately broken input and fails if the mutant
// survives (scripts/verify-new-barriers-are-mutation-proven.ts).
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught,
    caught ? '' : 'MUTANT SURVIVED — the assertion it pairs with is blind to the defect it exists for');

console.log('\nAn Advanced Filter tap is only a tap once the page says the CTA took it\n');

// ── the stub page ────────────────────────────────────────────────────────────────────────────────
// `evaluate` dispatches on FUNCTION IDENTITY for the three sources whose return value decides
// anything. The other two (the bottom-scroller and the has-turn reader) are not exported; the
// has-turn reader is the only one whose value is read, so the fallback returns `hasTurn`.
type Stub = {
  page: any;
  attempts: () => number;
  /** what the click landed on, per attempt (1-based) */
  lands: (n: number) => boolean;
};

const MISSED = { onTarget: false, tid: 'card-listing-11678443', txt: '#13 شقة للبيع' };

function stubPage(opts: {
  ctaPresent: boolean;
  hasTurn: boolean;
  lands: (attempt: number) => boolean;
  /** simulate a page that never reports a click event at all */
  silentWitness?: boolean;
  /** simulate a conversation still reflowing: the CTA's measured point moves on every poll */
  movingTarget?: boolean;
  /** simulate the `ops_incident` #687 shape: the CTA IS in the DOM, but the click probe can never
   *  measure it (it sits under a running reveal cascade / below the fold, and `innerText` is empty
   *  for a node the engine has not laid out). Presence true, measurability false. */
  unmeasurable?: boolean;
}): Stub {
  let attempt = 0;
  let drift = 0;
  let armed = false;
  let hit: any = null;
  const page = {
    evaluate: async (fn: any, arg?: any) => {
      if (fn === CTA_PRESENT_SRC) return opts.ctaPresent;            // PRESENCE — the DOM question
      if (fn === CLICK_LEAF_SRC)                                      // CLICKABILITY — a different one
        return opts.ctaPresent && !opts.unmeasurable ? { x: 100, y: 200 + (opts.movingTarget ? (drift += 40) : 0) } : null;
      if (fn === ARM_CLICK_WITNESS_SRC) { armed = true; hit = null; return undefined; }
      if (fn === READ_CLICK_WITNESS_SRC) { const h = hit; hit = null; return h; }
      return opts.hasTurn;                       // the has-turn reader (and the scroller, ignored)
    },
    mouse: {
      click: async () => {
        attempt++;
        if (!armed || opts.silentWitness) return;  // a click nobody witnessed leaves `hit` null
        hit = opts.lands(attempt) ? { onTarget: true, tid: AF_OFFER_TESTID, txt: AF_OFFER_CTA } : MISSED;
      },
    },
    waitForTimeout: async (ms: number) => { await new Promise((r) => setTimeout(r, Math.min(ms, 5))); },
  };
  return { page, attempts: () => attempt, lands: opts.lands };
}

const FAST = { timeoutMs: 400, pollMs: 5 };

// ── 1. the honest case: the click lands, and it is reported as opened ────────────────────────────
{
  const s = stubPage({ ctaPresent: true, hasTurn: true, lands: () => true });
  const r = await openAfOffer(s.page, FAST);
  check('a click the CTA receives is reported as opened, on the first attempt',
    r.opened === true && (r as any).attempts === 1, JSON.stringify(r));
}

// ── 2. THE DEFECT: every click lands on a listing card ───────────────────────────────────────────
{
  const s = stubPage({ ctaPresent: true, hasTurn: true, lands: () => false });
  const r = await openAfOffer(s.page, FAST);
  check('a click that lands on a listing card is NEVER reported as opened',
    r.opened === false, JSON.stringify(r));
  check('…and it is named as INTERCEPTED — a harness miss, never an absent offer',
    r.opened === false && r.reason === 'intercepted', `reason=${(r as any).reason}`);
  check('…and it names what took the click, so the next reader is not sent after Advanced Filter',
    r.opened === false && r.reason === 'intercepted' && r.hit.includes('card-listing-11678443'),
    `hit=${(r as any).hit}`);
  check('…and it says how many attempts were spent (an interception is retried, not accepted)',
    r.opened === false && r.reason === 'intercepted' && r.attempts > 1, `attempts=${(r as any).attempts}`);
  check('…and the retries are BOUNDED — a stray click lands on a live listing card, so it is never hammered',
    r.opened === false && r.reason === 'intercepted' && r.attempts <= 6, `attempts=${(r as any).attempts}`);
}

// ── 2b. the CTA is on screen but never holds still: still a harness verdict, never «absent» ──────
{
  const s = stubPage({ ctaPresent: true, hasTurn: true, lands: () => true, movingTarget: true });
  const r = await openAfOffer(s.page, FAST);
  check('a CTA that never stops moving is NOT clicked at all (no stray click on a listing card)',
    s.attempts() === 0, `clicks=${s.attempts()}`);
  check('…and it is reported as INTERCEPTED, never as an absent offer',
    r.opened === false && r.reason === 'intercepted', JSON.stringify(r));
}

// ── 2c. a CTA that flickers once and is genuinely gone is still «absent», not «intercepted» ─────
{
  // The flicker is in BOTH probes, because that is what a one-frame CTA really is: present and
  // measurable for a single poll, then gone from the DOM entirely. (A CTA that stays PRESENT while
  // only the click probe loses it is the #687 shape, covered in 5b — and must NOT read as absent.)
  let seen = 0, polls = 0;
  const page = {
    evaluate: async (fn: any) => {
      if (fn === CTA_PRESENT_SRC) return ++seen === 1;                               // one frame only
      if (fn === CLICK_LEAF_SRC) return ++polls === 1 ? { x: 100, y: 200 } : null;   // one frame only
      return true;                                                                   // a turn landed
    },
    mouse: { click: async () => { throw new Error('must not click: the point was never stable'); } },
    waitForTimeout: async () => {},
  };
  const r = await openAfOffer(page as any, FAST);
  check('a one-frame flicker of the CTA does not downgrade a REAL absence to a harness verdict',
    r.opened === false && r.reason === 'absent', JSON.stringify(r));
}

// ── 3. the reflow settles: a miss is retried inside the same budget ──────────────────────────────
{
  const s = stubPage({ ctaPresent: true, hasTurn: true, lands: (n) => n >= 3 });
  const r = await openAfOffer(s.page, FAST);
  check('a click that misses twice and lands on the third attempt is opened, not failed',
    r.opened === true && (r as any).attempts === 3, JSON.stringify(r));
}

// ── 4. a page that reports no click at all fails CLOSED ──────────────────────────────────────────
{
  const s = stubPage({ ctaPresent: true, hasTurn: true, lands: () => true, silentWitness: true });
  const r = await openAfOffer(s.page, FAST);
  check('a click the page never witnessed is not an opened offer (fail closed, never assumed)',
    r.opened === false && r.reason === 'intercepted', JSON.stringify(r));
}

// ── 5. the two REAL absences still read the way their callers depend on ──────────────────────────
{
  const absent = await openAfOffer(stubPage({ ctaPresent: false, hasTurn: true, lands: () => true }).page, FAST);
  check('no CTA on a landed turn is still «absent» — a real AF verdict the callers fail on',
    absent.opened === false && absent.reason === 'absent', JSON.stringify(absent));
  const noTurn = await openAfOffer(stubPage({ ctaPresent: false, hasTurn: false, lands: () => true }).page, FAST);
  check('no CTA and no turn is still «no-turn» — a dependency timeout, never an AF verdict',
    noTurn.opened === false && noTurn.reason === 'no-turn', JSON.stringify(noTurn));
}

// ── 5b. THE #687 DEFECT: present in the DOM, never measurable — that is a HARNESS verdict ────────
//
// Measured on production 2026-09-25 (الرياض/شراء/شقة desktop, fleet healthy): after removing the
// last AF pill, `[data-testid="results-narrow"]` AND an exact `textContent` leaf for
// «خلّنا نحدد الطلب أكثر» were present at EVERY 3 s sample for the full 60 s budget, while the click
// probe returned null on every poll — the offer renders under a reveal cascade that was still
// mounting cards (90 → 150 during the window). `openAfOffer` counted `ctaSeen` off the CLICK probe,
// so it read 0, and returned `reason: 'absent'` — the one verdict in this file that blames Advanced
// Filter. Three runs recorded a correct production as a broken contract rule R9.2.3.
//
// Presence and clickability are now two different questions, and only presence may retire `absent`.
{
  const s = stubPage({ ctaPresent: true, hasTurn: true, unmeasurable: true, lands: () => true });
  const r = await openAfOffer(s.page, FAST);
  check('a CTA that is in the DOM but never measurable is NEVER «absent» (that would blame AF)',
    r.opened === false && r.reason !== 'absent', JSON.stringify(r));
  check('…it is named INTERCEPTED — a harness fact — and no click was spent on a point never measured',
    r.opened === false && r.reason === 'intercepted' && (r as any).attempts === 0, JSON.stringify(r));
}

// ── 5c. MUTATION: counting presence off the CLICK probe brings the false accusation straight back ─
// The exact pre-fix rule, run against the exact stub above. If a future edit re-fuses the two
// questions, 5b turns red — proven here by executing the old rule, not asserted.
{
  const s = stubPage({ ctaPresent: true, hasTurn: true, unmeasurable: true, lands: () => true });
  let ctaSeenFromClickProbe = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < FAST.timeoutMs) {
    if (await s.page.evaluate(CLICK_LEAF_SRC, { testid: AF_OFFER_TESTID, txt: AF_OFFER_CTA })) ctaSeenFromClickProbe++;
    await s.page.waitForTimeout(FAST.pollMs);
  }
  const legacyReason = ctaSeenFromClickProbe >= 3 ? 'intercepted' : 'absent';
  mustCatch('the pre-fix rule calling a present-but-unmeasurable CTA «absent» — the predicate bites',
    legacyReason === 'absent');
}

// ── 6. MUTATION: the pre-fix opener must FAIL the predicate this barrier enforces ────────────────
// The body `openAfOffer` carried until 2026-09-24. If a future edit reverts to it — or to anything
// that reports a tap it did not observe — case 2 above turns red. Proven here, not asserted.
async function legacyOpenAfOffer(page: any, opts: { timeoutMs?: number; pollMs?: number } = {}) {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const pollMs = opts.pollMs ?? 400;
  const t0 = Date.now();
  let sawTurn = false;
  while (Date.now() - t0 < timeoutMs) {
    await page.evaluate(() => {}).catch(() => {});
    if (!sawTurn) sawTurn = await page.evaluate(() => {}).catch(() => false);
    const box = await page.evaluate(CLICK_LEAF_SRC, '').catch(() => null);
    if (box) {
      await page.mouse.click(box.x, box.y);
      return { opened: true as const, waitedMs: Date.now() - t0 };
    }
    await page.waitForTimeout(pollMs);
  }
  return { opened: false as const, reason: sawTurn ? 'absent' : 'no-turn', waitedMs: Date.now() - t0 };
}
{
  const s = stubPage({ ctaPresent: true, hasTurn: true, lands: () => false });
  const r = await legacyOpenAfOffer(s.page, FAST);
  mustCatch('the pre-fix opener reporting a missed click as opened — the predicate bites',
    r.opened === true);
}

// ── 7. the in-page half: the witness itself, executed against a fake document ────────────────────
// The arming and reading sources run inside the browser, where the stub above cannot reach them.
// Execute them here against a minimal window/document so the arming, the clearing, the testid test
// and the text walk are proven rather than assumed.
{
  const listeners: Array<(e: any) => void> = [];
  const leaf = (tid: string, inTarget: boolean, txt: string, parentTxt?: string) => ({
    getAttribute: (k: string) => (k === 'data-testid' ? tid : null),
    closest: (sel: string) => (inTarget && sel.includes(AF_OFFER_TESTID) ? {} : null),
    innerText: txt,
    parentElement: parentTxt == null ? null : { innerText: parentTxt, parentElement: null, getAttribute: () => null, closest: () => null },
  });
  const g = globalThis as any;
  const savedWin = g.window, savedDoc = g.document;
  g.window = {};
  g.document = { addEventListener: (_t: string, fn: any, _c: boolean) => listeners.push(fn) };
  try {
    const WANT = { testid: AF_OFFER_TESTID, text: AF_OFFER_CTA };
    ARM_CLICK_WITNESS_SRC(WANT);
    check('the witness registers exactly one capture listener', listeners.length === 1, `n=${listeners.length}`);
    ARM_CLICK_WITNESS_SRC(WANT);
    check('…and re-arming does not stack a second listener on the same page',
      listeners.length === 1, `n=${listeners.length}`);

    listeners[0]({ target: leaf('card-listing-11678443', false, '#13 شقة للبيع') });
    const miss = READ_CLICK_WITNESS_SRC();
    check('a click outside the target is recorded as onTarget=false, with what it hit',
      miss?.onTarget === false && miss.tid === 'card-listing-11678443', JSON.stringify(miss));
    check('…and reading the witness CONSUMES it, so a stale hit can never read as a fresh landing',
      READ_CLICK_WITNESS_SRC() == null);

    listeners[0]({ target: leaf('', true, AF_OFFER_CTA) });
    check('a click anywhere inside the target subtree is recorded as onTarget=true (testid path)',
      READ_CLICK_WITNESS_SRC()?.onTarget === true);

    // THE TEXT PATH: the label often sits on an ancestor of the leaf that received the event.
    listeners[0]({ target: leaf('', false, '', AF_OFFER_CTA) });
    check('…and a leaf whose ANCESTOR carries the label is still a landing (text path)',
      READ_CLICK_WITNESS_SRC()?.onTarget === true);

    // ARMING CLEARS. A stale landing left over from a previous attempt must not be read as this
    // attempt's — the same "absence read as an answer" shape the repo names everywhere.
    listeners[0]({ target: leaf('', true, AF_OFFER_CTA) });
    ARM_CLICK_WITNESS_SRC(WANT);
    mustCatch('a stale landing surviving into the next attempt (arming clears it)',
      READ_CLICK_WITNESS_SRC() == null);
  } finally {
    g.window = savedWin; g.document = savedDoc;
  }
}

// ── 8. the stability gate is a real predicate, not decoration ────────────────────────────────────
{
  check('isStable: a point that has not moved qualifies', isStable({ x: 10, y: 20 }, { x: 10, y: 20 }));
  check('isStable: a 2px jitter still qualifies', isStable({ x: 10, y: 20 }, { x: 12, y: 18 }));
  check('isStable: a point that slid a row does NOT qualify', !isStable({ x: 10, y: 20 }, { x: 10, y: 60 }));
  check('isStable: with nothing to compare against, nothing is stable', !isStable(null, { x: 10, y: 20 }));
}

// ── 9. clickWitnessed itself: the one call every journey should reach for ────────────────────────
{
  const calls: string[] = [];
  let hit: any = null;
  const page = {
    evaluate: async (fn: any, arg?: any) => {
      if (fn === ARM_CLICK_WITNESS_SRC) { calls.push('arm'); hit = null; return undefined; }
      if (fn === READ_CLICK_WITNESS_SRC) { calls.push('read'); const h = hit; hit = null; return h; }
      return undefined;
    },
    mouse: { click: async () => { calls.push('click'); hit = { onTarget: true, tid: 'x', txt: 'y' }; } },
  };
  const r = await clickWitnessed(page as any, { x: 1, y: 2 }, { testid: 'x' });
  check('clickWitnessed arms BEFORE it clicks and reads AFTER — never the other way round',
    calls.join(',') === 'arm,click,read', calls.join(','));
  check('…and reports the landing the page confirmed', r.landed === true, JSON.stringify(r));

  const silent = {
    evaluate: async (fn: any) => (fn === READ_CLICK_WITNESS_SRC ? null : undefined),
    mouse: { click: async () => {} },
  };
  const r2 = await clickWitnessed(silent as any, { x: 1, y: 2 }, { testid: 'x' });
  mustCatch('a page that reports no click reading as a landing (fail closed)',
    r2.landed === false && r2.hit === '(no click event seen)');
}

console.log(failed
  ? `\n✗ ${failed} check(s) failed — a missed tap could be reported as a tap\n`
  : '\n✓ the Advanced Filter offer is only reported as opened when the page witnessed the CTA take the click\n');
process.exit(failed ? 1 : 0);
