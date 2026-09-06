// A HARNESS MAY NOT CONFIRM AN ACTION WITH THE VALUE IT TYPED ITSELF.
// Routine #10, ops_incident #103, 2026-09-06.
//
// THE DEFECT, MEASURED ON PRODUCTION. Both browser harnesses confirmed a city pick like this:
//
//     await input.fill(city);          // the harness writes «الرياض» into the field
//     ...click the suggestion...
//     const committed = await input.inputValue();          // reads back «الرياض»
//     return !!committed && committed.includes(city);      // ...and calls the pick successful
//
// The read can never fail, because the harness itself wrote the value. Measured 2026-09-06, mobile
// 390 px, filter-state flow: 2 of 4 attempts left the field reading «الرياض» while `citySelected`
// was NULL, «الرجاء اختيار مدينة من القائمة.» was on screen, and ZERO RPCs had fired. pickCity()
// returned true every time. The suggestion tap missed because the option was scrolled with
// Playwright's scrollIntoViewIfNeeded(), which does not move a react-native-web ScrollView — a fact
// sweep.mjs already documents 90 lines further down, for the «بحث» button, for the identical reason.
//
// WHY IT IS EXPENSIVE, AND WHY IT IS THIS ROUTINE'S. A harness that reports a successful pick and
// then observes a refused search does not report a harness miss — it reports a PRODUCT DEFECT. The
// comment that justified the old check («a click that missed leaves the field empty») stated the
// premise production disproved. This is the apparatus accusing the product of its own failure, which
// is the most expensive kind of wrong answer a test can give.
//
// THE RULE THIS PINS. Confirm with a signal only the APP can produce. `selected-city-visual` renders
// iff `citySelected` is set (src/app/index.tsx) — the same state onSearch requires — so it cannot be
// faked by anything the harness typed. scripts/verify-af-live-truth.ts already used that oracle.
//
// HOW IT IS CHECKED: BY EXECUTION, NOT BY READING. Both real pickCity() functions are lifted out of
// their harnesses with scripts/lib/liftSymbols.ts and RUN against a stub page that reproduces the
// production miss exactly — the field holds the typed text, and the app's confirmation element never
// appears. A source-TEXT tripwire over these files is precisely the shape that let five barriers
// stay green for the entire life of the bugs they covered (2026-09-04), and the old defect here was
// itself protected by a comment asserting the wrong thing.
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

// `mustCatch` is `check` under the name that says what it is: the real predicate applied to a
// deliberately broken input, asserted to CATCH it. Naming matters — scripts/verify-new-barriers-are-
// mutation-proven.ts looks for exactly this, and a barrier whose proof is invisible to the ratchet is
// a barrier the ratchet stops counting.
const mustCatch = (label: string, caught: boolean, why = '') => check(label, caught, why);

const ROOT = join(import.meta.dirname, '..');
console.log('\nA harness confirms a city pick with the APP\'s signal, never with its own typing\n');

// ── the stub page ───────────────────────────────────────────────────────────────────────────────
// It behaves the way the real one did in the measured failure: fill() writes the field, the option
// is found and clicked, and `selected-city-visual` NEVER appears because the app never accepted the
// pick. `appSelects` flips that to the healthy case.
function stubPage(appSelects: boolean) {
  let field = '';
  const clicks = { option: 0 };
  const el = {
    scrollIntoViewIfNeeded: async () => {},
    evaluate: async (_fn: unknown) => undefined,
    click: async () => { clicks.option++; },
    asElement() { return this; },
  };
  const page = {
    locator: () => ({
      click: async () => {},
      fill: async (v: string) => { field = v; },          // the harness's OWN typing
      inputValue: async () => field,                       // ...read straight back
    }),
    waitForFunction: async () => true,                     // the suggestion appeared
    evaluateHandle: async () => el,
    evaluate: async () => undefined,
    // THE POINT: the app's own confirmation element only ever exists if the app accepted the pick.
    waitForSelector: async (sel: string) => {
      if (sel.includes('selected-city-visual') && !appSelects) throw new Error('timeout');
      return el;
    },
  };
  return { page, clicks, typed: () => field };
}

const PRELUDE = `
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 1)));
const CITY_OPTION_TIMEOUT_MS = 1;
const until = async (fn) => await fn();
`;

// The two harnesses declare pickCity differently (sweep.mjs exports it in a trailing export list),
// so each names its own header. `endsWith` is explicit because liftSymbols' default terminator
// picker only recognises `function`/`export function`, not `export async function`.
const HARNESSES = [
  { name: 'e2e/live-sweep/sweep.mjs', file: 'e2e/live-sweep/sweep.mjs',
    header: 'async function pickCity(page, city) {' },
  { name: 'e2e/guardian/harness.mjs', file: 'e2e/guardian/harness.mjs',
    header: 'export async function pickCity(page, city) {' },
];

for (const h of HARNESSES) {
  const lifted = await liftSymbols(
    join(ROOT, h.file),
    [{ header: h.header, endsWith: /^\}$/ }],
    ['pickCity'],
    PRELUDE,
  ).catch((e) => { check(`${h.name}: pickCity could be lifted and executed`, false, String(e)); return null; });
  if (!lifted) continue;
  const pickCity = lifted.pickCity as (page: unknown, city: string) => Promise<boolean>;

  // ── THE MUTATION PROOF *IS* THE CHECK HERE, and it is executed rather than described: the REAL
  // shipped pickCity() is run against a world shaped exactly like the measured production failure —
  // the field holds «الرياض» because the harness typed it, and the app's confirmation element never
  // appears because the app never accepted the pick. A barrier that only read this source could not
  // tell the fixed function from the broken one; this one runs both and can only pass on the fixed.
  const miss = stubPage(false);
  const missResult = await pickCity(miss.page, 'الرياض');
  mustCatch(`${h.name}: THE #103 SHAPE — a pick the app NEVER accepted reported as successful`,
    missResult === false,
    `pickCity returned ${missResult} while the app's confirmation element never appeared — and the `
    + `field reads "${miss.typed()}" only because the harness typed it. The caller then walks into a `
    + 'search that will be REFUSED and reports it as a product defect.');

  // ── The negative control. A rule that is false for everything is not a confirmation rule, and
  // would fail every journey as a harness miss.
  const hit = stubPage(true);
  mustCatch(`${h.name}: a pick the app DID accept is NOT reported as a miss`,
    (await pickCity(hit.page, 'الرياض')) === true,
    'the confirmation no longer succeeds on the healthy path');

  // ── The retry is real: a missed pick must be attempted more than once before being given up on.
  mustCatch(`${h.name}: a missed pick is retried before it is reported as a miss`,
    miss.clicks.option >= 2,
    `the option was clicked ${miss.clicks.option} time(s) — without the retry a single transient `
    + 'miss becomes a failed journey');
}

console.log(
  failed === 0
    ? '\n✅ both harnesses confirm a city pick with the app\'s own state, and retry before giving up.\n'
    : `\n❌ ${failed} check(s) failed — a harness can report a pick the app never accepted.\n`,
);
process.exit(failed === 0 ? 0 : 1);
