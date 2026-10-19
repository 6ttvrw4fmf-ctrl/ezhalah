// PERMANENT BARRIER: the number a finished search QUOTES is the match total, never the page limit.
//
// THE DEFECT (reproduced live on ezhalah-app.vercel.app, 2026-08-23). After the Advanced Filter
// interview, the «digging» transition (src/components/MiningTransition.tsx) always claimed
// «لقينا 1,500 عقار أقرب لطلبك» whenever the narrowed set was larger than one page:
//     Rent / الرياض / شقة, answered «يقبل التقسيط» → the chip promised 3,897 (DB truth: 3,897 rows,
//     3,897 distinct listing_ids), the overlay said 1,500, and the chat line right behind it said
//     3,897. Three surfaces, ONE search, two different numbers — and 1,500 is not a count at all,
//     it is the p_limit the app sends on every search request.
//
// THE CAUSE. agent.tsx's runRefine fed the overlay `result.total`, which runSearch defines as
// `listings.length` — this page's buffer, hard-capped by remote.ts's QUERY_LIMIT (1500) and the
// SHOW_ALL_MAX slice. The honest count is `result.matchTotal` (the RPC's count(*) over() across the
// whole filtered set), which the results headline was already using. A page/display cap and the true
// total are two different numbers (same owner rule as src/data/resultCount.ts) and may never swap.
//
// THE FIX. ONE helper — quotableTotal() in src/data/search.ts — is now the only definition of "the
// number this search may state", used by BOTH the headline and the interview's closing beat, so the
// two can no longer disagree. It returns null when no honest number exists (nothing matched, or a
// client-only narrower / an agent-annualized budget means the RPC count OVERSTATES what the user can
// actually reach) and the caller then says nothing rather than a wrong count.
//
// ── WHAT CHANGED HERE, 2026-09-21 (routine #10, R1 + R3) ────────────────────────────────────────
//
// This file was on scripts/mutation-proof-grandfathered.txt — a barrier nobody had ever watched
// fail — and it had the two shapes that list exists to find.
//
//   1. IT TESTED A HAND-COPIED REPLICA. Section A executed a local `quotableTotal` written out in
//      this file, with the real function's suppression rule FLATTENED INTO TWO BOOLEAN FLAGS:
//
//          const quotableTotal = (r) => {            // the old replica
//            const total = r.matchTotal ?? r.loaded;
//            if (!(total > 0)) return null;
//            if (r.priceIsAnnual || r.clientOnly) return null;   // ← `clientOnly` is not a field
//            return total;
//          };
//
//      `clientOnly` does not exist in production. The shipped line is
//      `r.query && (r.query.priceIsAnnual || hasClientOnlyNarrowing(r.query))`, and
//      hasClientOnlyNarrowing() is where the honesty actually lives: keywords, a per-m² context
//      size, a bare Buy budget in the 100–50,000 range, and the ambiguous-deal budget that
//      overstated the reachable set by ~3.8× when it was found. NONE of those five branches was
//      executed by anything. The barrier proved that a boolean flag suppresses a count.
//      This is PART 1.6 — a barrier holding its own copy of production logic — the class that
//      shipped `extractPrice` broken on 2026-08-29 behind a green test.
//
//   2. ITS "MUTATION PROOF" MUTATED THE REPLICA. Old section D built `(r) => r.total` and compared
//      it against the replica in the same file. Both sides were written here; production was not
//      involved in either. That is the fake-proof shape PART 3 R1 refuses: a proof that supplies its
//      own input proves nothing.
//
// THE REPAIR. The REAL quotableTotal(), hasClientOnlyNarrowing() and numOrNull() are LIFTED out of
// src/data/search.ts (scripts/lib/liftSymbols.ts) and EXECUTED. The verdict is one pure function,
// problems(quotable), so §MUTATIONS can re-break the REAL source IN MEMORY, lift the broken version
// and re-run the same function — the proof is now a statement about the code that decides, not about
// a copy of it. Nothing is written into the tree: a mutant that cannot be left behind cannot be
// committed by a concurrent session in this shared working directory.
//
// ONE LEAF IS STUBBED, AND IT IS STUBBED SO THAT IT CANNOT INVENT AN ANSWER. bedroomSpec() reaches
// bedroomTokens() → effectiveTypes/effectiveBeds/detailFor → i18n, which `node
// --experimental-strip-types` cannot load. The stub THROWS unless the calling test states the answer
// on the query itself (`__bedroomSpec`), so a branch can never be taken on logic this file invented,
// and a future dependency added to the lifted functions fails loudly with a ReferenceError instead
// of quietly resolving to something plausible.
//
//   node --experimental-strip-types scripts/verify-mining-total-honesty.ts   (in `npm test`)

import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = join(import.meta.dirname, '..');
const SEARCH = join(ROOT, 'src/data/search.ts');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nThe quoted total is the match total, never the 1500-row page limit\n');

const PAGE_LIMIT = 1500; // remote.ts QUERY_LIMIT — the buffer ceiling that was being quoted as a count

// ── THE REAL CODE, LIFTED AND EXECUTED ──────────────────────────────────────────────────────────
type Quotable = (r: Record<string, unknown>) => number | null;

const PRELUDE = `
// The ONE stubbed leaf. It refuses to guess: a test that reaches this branch must say what the real
// bedroomSpec() would have answered, so no branch of hasClientOnlyNarrowing is ever decided by logic
// this barrier invented. Anything else the lifted code needs is NOT declared here on purpose — an
// added dependency then fails loudly (ReferenceError) instead of resolving to something plausible.
const bedroomSpec = (q) => {
  if (!(q && '__bedroomSpec' in q)) {
    throw new Error('bedroomSpec stub reached: this test must state __bedroomSpec on the query');
  }
  return q.__bedroomSpec;
};
`;

async function liftQuotable(file: string): Promise<Quotable> {
  const mod = await liftSymbols(
    file,
    [
      { header: 'const numOrNull' },
      { header: 'export function hasClientOnlyNarrowing' },
      { header: 'export function quotableTotal' },
    ],
    ['numOrNull', 'hasClientOnlyNarrowing', 'quotableTotal'],
    PRELUDE,
  );
  return mod.quotableTotal as Quotable;
}

const quotableTotal = await liftQuotable(SEARCH);

// ── THE VERDICT, AS ONE PURE FUNCTION SO A MUTANT CAN BE JUDGED BY IT ────────────────────────────
// Every input below is the shape production actually builds: a SearchResult with `listings` (the
// page buffer) and `query` (the real SearchQuery fields hasClientOnlyNarrowing reads).
const page = (n: number) => new Array(Math.min(n, PAGE_LIMIT)).fill(0);
const q = (over: Record<string, unknown> = {}) =>
  ({ deal: 'Rent', priceInput: '', ...over });

/** Returns the label of every honesty property the given quotableTotal VIOLATES. Empty = healthy. */
function problems(quotable: Quotable): string[] {
  const bad: string[] = [];
  const no = (label: string, ok: boolean) => { if (!ok) bad.push(label); };

  // The exact live case: 3,897 matched, one 1,500-row page buffered.
  no('3,897 matches with a 1,500-row page → quotes 3,897, NEVER 1,500',
    quotable({ matchTotal: 3897, listings: page(3897), query: q() }) === 3897);

  for (const trueTotal of [1, 25, 26, 100, 1499, 1500, 1501, 3897, 10618, 10639, 30399]) {
    const r = { matchTotal: trueTotal, listings: page(trueTotal), query: q() };
    const got = quotable(r);
    no(`trueTotal ${trueTotal} → quotes ${trueTotal}`, got === trueTotal);
    if (trueTotal > PAGE_LIMIT) {
      no(`trueTotal ${trueTotal} → never quotes the page limit or the buffer length`,
        got !== PAGE_LIMIT && got !== (r.listings as unknown[]).length);
    }
  }

  // No honest number ⇒ null (say nothing), never a substitute.
  no('zero matches → null (the caller has its own no-results copy)',
    quotable({ matchTotal: 0, listings: [], query: q() }) === null);

  // ── the five REAL hasClientOnlyNarrowing branches the old replica flattened into one flag ──
  no('keywords narrow on the client → null',
    quotable({ matchTotal: 9647, listings: page(134), query: q({ keywords: ['مسبح'] }) }) === null);
  no('a per-m² context size with no area bound → null (the 2026-07-30 «9,647 vs 134» headline lie)',
    quotable({ matchTotal: 9647, listings: page(134), query: q({ contextSize: '٣٠٠ متر' }) }) === null);
  no('a `detail` with no bedroom spec and no area bound → null',
    quotable({ matchTotal: 800, listings: page(80),
      query: q({ detail: 'دوبلكس', __bedroomSpec: null }) }) === null);
  no('a bare Buy budget in the 100–50,000 band → null (agentPriceCapAnnual leaves it to the client)',
    quotable({ matchTotal: 5000, listings: page(90),
      query: q({ deal: 'Buy', priceInput: '٨٠٠ ألف'.replace('٨٠٠ ألف', '800') }) }) === null);
  no('an AMBIGUOUS-deal budget → null (measured to overstate the reachable set by ~3.8×)',
    quotable({ matchTotal: 5000, listings: page(90),
      query: q({ bothDeals: true, priceInput: '5000' }) }) === null);

  // …and the agent-annualized budget, the other half of the suppression rule.
  no('agent-annualized budget (priceIsAnnual nulls the RPC price bound) → null',
    quotable({ matchTotal: 5000, listings: page(80), query: q({ priceIsAnnual: true }) }) === null);

  // THE NON-VACUITY SIDE. A gate that is "always null" is as useless as one that always quotes.
  no('a plain server-side filter IS quotable (the gate is not "always null")',
    quotable({ matchTotal: 4321, listings: page(200), query: q() }) === 4321);
  no('an explicit bedroom spec beside a detail is STILL quotable',
    quotable({ matchTotal: 640, listings: page(120),
      query: q({ detail: '٣ غرف', __bedroomSpec: { n: 3, atLeast: false } }) }) === 640);
  no('a Buy budget ABOVE the client-only band is still quotable',
    quotable({ matchTotal: 2200, listings: page(150),
      query: q({ deal: 'Buy', priceInput: '900000' }) }) === 2200);
  no('no matchTotal (a restored/legacy result) → the loaded length, never a fabricated number',
    quotable({ matchTotal: undefined, listings: page(37), query: q() }) === 37);

  return bad;
}

// ── A. THE SHIPPED FUNCTION IS HONEST ───────────────────────────────────────────────────────────
const live = problems(quotableTotal);
check(`the REAL quotableTotal() honours every property (${live.length ? '' : 'all'} checked by execution)`,
  live.length === 0, live.join('\n      '));

// ── B. THE CALL SITES — the page-capped total must not reach any user-facing sentence ───────────
const strip = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l.trim())).join('\n');
const agent = strip(readFileSync(join(ROOT, 'src/app/agent.tsx'), 'utf8'));

check('runRefine reports the honest total to the mining overlay (onFetched)',
  /const honestTotal = quotableTotal\(result\);/.test(agent) && /onFetched\?\.\(honestTotal\)/.test(agent),
  'the overlay count must come from quotableTotal(), not result.total');
check('agent.tsx never reads the page-capped `result.total` for a displayed count',
  !/\bresult\.total\b/.test(agent),
  'result.total is listings.length — a page buffer capped at 1500; it is not a match count');
check('the results headline quotes the SAME helper as the overlay',
  /const introTotal = quotableTotal\(m\.result\)/.test(agent),
  'two surfaces describing one search must not compute the total two different ways');

// THE OVERLAY IS GONE (owner 2026-09-20: "there is this pop-up that pops up with a magnifying
// glass … this needs to be gone"). The checks that stood here read MiningTransition.tsx and proved
// it could not invent a count of its own. The component is deleted, so the strongest form of that
// guarantee is simply that there is no overlay to invent one — asserted below.
check('there is no mining overlay left to state a count of its own',
  !existsSync(join(ROOT, 'src/components/MiningTransition.tsx')),
  'a re-added overlay must come back with its own honesty checks, and this file reviewed again');

// ── C. MUTATIONS — the REAL source is re-broken in memory and the SAME predicate re-run ─────────
const REAL = readFileSync(SEARCH, 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'ezhalah-mining-mutant-'));

async function mutation(label: string, from: string, to: string): Promise<void> {
  if (!REAL.includes(from)) {
    failures++;
    console.error(`FAIL  mutation anchor MOVED — ${label}\n      not found: ${JSON.stringify(from)}`);
    return;                       // a moved anchor is a loud failure, never a proof that stopped proving
  }
  const file = join(dir, `${label.replace(/\W+/g, '-')}.ts`);
  writeFileSync(file, REAL.replace(from, to));
  let caught: string[];
  try {
    caught = problems(await liftQuotable(file));
  } catch (e) {
    caught = [`the mutant did not even load: ${(e as Error).message}`];
  }
  check(`mutation caught: ${label}`, caught.length > 0,
    'the mutated quotableTotal satisfied every property — this barrier cannot see the defect');
}

// M1 — THE ORIGINAL DEFECT, restored in the real file: quote the page buffer instead of the count.
await mutation('quoting the 1,500-row page buffer instead of the RPC match count (the 2026-08-23 bug)',
  'const total = r.matchTotal ?? r.listings.length;',
  'const total = r.listings.length;');

// M2 — the client-only suppression dropped: the «9,647 claimed vs 134 actual» headline returns.
await mutation('dropping the client-only-narrowing suppression',
  'if (r.query && (r.query.priceIsAnnual || hasClientOnlyNarrowing(r.query))) return null;',
  'if (r.query && r.query.priceIsAnnual) return null;');

// M3 — the annualized-budget suppression dropped.
await mutation('dropping the agent-annualized budget suppression',
  'if (r.query && (r.query.priceIsAnnual || hasClientOnlyNarrowing(r.query))) return null;',
  'if (r.query && hasClientOnlyNarrowing(r.query)) return null;');

// M4 — the zero guard removed: a search that matched nothing quotes 0 as a result count.
await mutation('removing the zero guard so an empty search quotes a number',
  'if (!(total > 0)) return null;',
  'if (false) return null;');

// M5 — inside hasClientOnlyNarrowing: the keywords branch, the cheapest one to "simplify" away.
await mutation('neutering the keywords branch of hasClientOnlyNarrowing',
  'if (q.keywords && q.keywords.length) return true;',
  'if (false) return true;');

// M6 — the ambiguous-deal branch, the most recently earned one (~3.8× overstatement when found).
await mutation('neutering the ambiguous-deal budget branch',
  'if (digits && parseInt(digits, 10) >= 100) return true;',
  'if (false) return true;');

// NEGATIVE CONTROL. A barrier that is red for everything is as useless as one that is green for
// everything — and a file-hash masquerading as a barrier is how a real guard gets weakened out of
// annoyance. Reformatting the shipped source must NOT trip the rule.
await (async () => {
  const file = join(dir, 'negative-control.ts');
  writeFileSync(file, REAL.replace('const total = r.matchTotal ?? r.listings.length;',
    'const total = (r.matchTotal ?? r.listings.length);'));
  const bad = problems(await liftQuotable(file));
  check('NEGATIVE CONTROL: a harmless reformat of the same logic is NOT flagged', bad.length === 0,
    bad.join('\n      '));
})();

console.log(failures === 0
  ? '\n✓ one total, quoted everywhere: the RPC match count — never the 1500-row page limit\n'
  : `\n✗ ${failures} check(s) FAILED — a search could quote a page cap as its result count\n`);
process.exit(failures === 0 ? 0 : 1);
