// A DATE THE SOURCE NEVER PUBLISHED MUST NOT BECOME «أضيف مؤخراً».
//
// THE DEFECT (P2, found 2026-09-04, live on 107,254 active listings — 54.3% of inventory).
// src/data/remote.ts's finalize() mapped `listed: r.date_added ?? 'recently'`. `date_added` is NULL
// for more than half the inventory, and that `??` turned every one of those unknowns into a positive
// FRESHNESS CLAIM before any display code could see it. This is the owner-locked SOURCE IS TRUTH rule
// — silent → NULL, never unknown → a value — broken in the mapping layer.
//
// WHY THE CARD COULD NOT SAVE IT, and why the barrier belongs here rather than in ResultCard.
// ResultCard already does the right thing: `{listedClean ? <Stat/> : null}` renders NO chip for an
// empty value. But cleanDate() deliberately maps /recently|مؤخر/ to the localized «مؤخراً», because a
// source CAN genuinely publish that. So the manufactured sentinel was indistinguishable from a real
// one, and the display guard passed it through — correctly. The only place the fabrication can be
// stopped is where it is made.
//
// THIS BARRIER EXECUTES finalize(). It does not grep for `?? 'recently'`: a text tripwire over the
// exact defective line is the shape that stayed green through all five of the 2026-09-04 defects
// (AGENTS.md, "A FAILED FETCH IS NOT AN EMPTY ANSWER"). finalize()'s helpers carry no logic for the
// `listed` field, so they are stubbed in the prelude — the mapping under test is the real one.
//
// Run: node --experimental-strip-types scripts/verify-card-never-invents-a-date.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');
const REMOTE = join(ROOT, 'src/data/remote.ts');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

// Shims for what finalize() closes over. None of them touches `listed`; they exist so the real
// mapping can run.
//
// NO cleanDate SHIM (removed 2026-09-04 by routine #10). The prelude used to carry a nine-line
// HAND-COPIED reimplementation of ResultCard's cleanDate, above a header line claiming it was "lifted
// for real below". Neither half was true: it was a copy, not a lift, and finalize() never calls it —
// `listed: r.date_added ?? ''` is the whole mapping, and cleanDate appears in remote.ts only inside a
// comment. So the copy was dead weight that could drift from the shipped function while reading like
// coverage of it. The real cleanDate IS executed, by verify-added-date-iso.ts, which lifts it out of
// ResultCard.tsx and runs it against frozen production rows. One copy, in one place, that runs.
const PRELUDE = `
type Listing = Record<string, any>;
type Deal = 'Buy' | 'Rent';
type SourceKind = string;
const normalizeType = (t: any) => ({ cleanType: t ?? null, macro: null });
const decodeEntities = (s: any) => s;
const buildAdditionalInfo = () => null;
const gathernDistrictFallback = () => null;
const isDerivedTotal = () => false;
const isJunkLocationToken = () => false;
const listingPriceString = () => '';
`;

const load = async (source: string) => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'ezhalah-date-'));
  const f = join(dir, 'remote.ts');
  writeFileSync(f, source);
  return (await liftSymbols(f, [{ header: 'function finalize(' }], ['finalize'], PRELUDE)) as {
    finalize: (rows: any[], kind?: string) => any[];
  };
};

const real = readFileSync(REMOTE, 'utf8');
const { finalize } = await load(real);

// A row shaped like what the results RPC returns, with the ONE field under test varied.
const row = (date_added: string | null) => ({
  id: 1, source_table: 'aqar_residential_listings', transaction_type: 'Rent',
  property_type: 'شقة', city_ar: 'الرياض', district_ar: 'الملقا',
  price_annual: 60000, rent_period: 'annual', area: 120, bedrooms: 3, date_added,
});

// ── 1. THE RULE. A source that published no date produces NO date. ────────────────────────────
const unknown = finalize([row(null)])[0];
check('a NULL date_added produces an empty `listed` — no chip, no claim',
  !unknown.listed, `got ${JSON.stringify(unknown.listed)}`);
check('…and it is a string, so `listed: string` still holds and the RECENCY lookup is unchanged',
  typeof unknown.listed === 'string', `got ${typeof unknown.listed}`);

// ── 2. NOT VACUOUS. A source that DID publish a date must still show it. ──────────────────────
for (const d of ['21/08/2026', '2026-08-21T20:33:43+03:00']) {
  const got = finalize([row(d)])[0];
  check(`a source-published date (${d}) survives the mapping`, Boolean(got.listed),
    `got ${JSON.stringify(got.listed)}`);
}
// A source that genuinely says «مؤخراً» is a real claim and must NOT be suppressed by this fix.
check('a source that genuinely publishes «مؤخراً» still reaches the card',
  Boolean(finalize([row('أضيف مؤخراً')])[0].listed));

// ── 3. MUTATION PROOFS — the defect, re-introduced into the REAL file and re-executed. ────────
const mustCatch = async (what: string, mutate: (s: string) => string, expectPass: boolean) => {
  const mutated = mutate(real);
  if (mutated === real) { check(`MUTATION: ${what} — ANCHOR DRIFTED, mutant never applied`, false); return; }
  const { finalize: mf } = await load(mutated);
  const stillEmpty = !mf([row(null)])[0].listed;
  check(`MUTATION: catches ${what}`, expectPass ? stillEmpty : !stillEmpty);
};

await mustCatch("the `?? 'recently'` fabrication returning verbatim",
  (s) => s.replace(/listed: r\.date_added \?\? '',/, "listed: r.date_added ?? 'recently',"), false);
await mustCatch('the same fabrication wearing the Arabic string instead',
  (s) => s.replace(/listed: r\.date_added \?\? '',/, "listed: r.date_added ?? 'أضيف مؤخراً',"), false);
await mustCatch('a fallback to today\'s date — an invention that even looks precise',
  (s) => s.replace(/listed: r\.date_added \?\? '',/, "listed: r.date_added ?? '05/09/2026',"), false);

// WHY THE RULE LIVES HERE AND NOT IN THE CARD — asserted against the REAL ResultCard, because if
// either half of this changed, the mapping-layer fix would no longer be the load-bearing one.
const card = readFileSync(join(ROOT, 'src/components/ResultCard.tsx'), 'utf8');
check('ResultCard still hides the chip entirely when the date is empty (this fix relies on it)',
  /\{listedClean \?/.test(card));
check('…and cleanDate still maps a «recently»/«مؤخر» string to a VISIBLE chip — so the card cannot ' +
      'tell a fabricated sentinel from a real source claim, which is why the mapping must not make one',
  // The first alternative here used to be /recently\\s\*\$\|مؤخر/ — an escaped literal matching the
  // TEXT `recently\s*$|مؤخر`, which no source file can contain. It could never match, so the whole
  // check rested entirely on the `||` behind it. Assert what is actually meant: cleanDate maps BOTH
  // sentinels to a visible chip, which is exactly why the mapping layer must never manufacture one.
  /recently/.test(card) && /مؤخر/.test(card));

check('npm test runs this guard', npmTestRuns(ROOT, 'verify-card-never-invents-a-date'),
  'the guard is inert');

console.log(failed === 0
  ? `\n✅ verify-card-never-invents-a-date: an unpublished date stays unpublished.\n`
  : `\n❌ verify-card-never-invents-a-date: ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
