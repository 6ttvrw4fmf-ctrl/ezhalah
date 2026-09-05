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
// HOW THIS TESTS IT. src/data/search.ts cannot be imported here (it pulls i18n, the listing pools and
// alias imports), so — exactly as scripts/verify-advanced-filter-count-honesty.ts does for apply() —
// section A EXECUTES a replica of the shipped helper against the live numbers, and section B pins the
// shipped source to that replica so the two cannot drift. Section C scans the call sites.
// Mutation-proven: restore `result.total` in runRefine, or make quotableTotal prefer `total`, and
// section B/C fail. See the MUTATION note at the end.
//
//   node --experimental-strip-types scripts/verify-mining-total-honesty.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nThe quoted total is the match total, never the 1500-row page limit\n');

const PAGE_LIMIT = 1500; // remote.ts QUERY_LIMIT — the buffer ceiling that was being quoted as a count

// ── A. EXECUTED replica of the shipped quotableTotal() ───────────────────────────────────────────
type R = { matchTotal?: number; loaded: number; clientOnly?: boolean; priceIsAnnual?: boolean };
const quotableTotal = (r: R): number | null => {
  const total = r.matchTotal ?? r.loaded;
  if (!(total > 0)) return null;
  if (r.priceIsAnnual || r.clientOnly) return null;
  return total;
};

// The exact live case: 3,897 matched, one 1,500-row page buffered.
check('3,897 matches with a 1,500-row page → quotes 3,897, NEVER 1,500',
  quotableTotal({ matchTotal: 3897, loaded: PAGE_LIMIT }) === 3897,
  `got ${quotableTotal({ matchTotal: 3897, loaded: PAGE_LIMIT })}`);

for (const trueTotal of [1, 25, 26, 100, 1499, 1500, 1501, 3897, 10618, 10639, 30399]) {
  const loaded = Math.min(trueTotal, PAGE_LIMIT);
  const got = quotableTotal({ matchTotal: trueTotal, loaded });
  check(`trueTotal ${trueTotal} → quotes ${trueTotal}`, got === trueTotal, `got ${got}`);
  if (trueTotal > PAGE_LIMIT) {
    check(`trueTotal ${trueTotal} → never quotes the page limit ${PAGE_LIMIT} or the buffer length`,
      got !== PAGE_LIMIT && got !== loaded);
  }
}

// No honest number ⇒ null (say nothing), never a substitute.
check('zero matches → null (the caller has its own no-results copy)',
  quotableTotal({ matchTotal: 0, loaded: 0 }) === null);
check('client-only narrowing → null: the RPC count overstates what is reachable',
  quotableTotal({ matchTotal: 9647, loaded: 134, clientOnly: true }) === null,
  'the 2026-07-30 «9,647 claimed vs 134 actual» headline lie');
check('agent-annualized budget (priceIsAnnual nulls the RPC price bound) → null',
  quotableTotal({ matchTotal: 5000, loaded: 80, priceIsAnnual: true }) === null);
check('a plain server-side filter IS quotable (the gate is not "always null")',
  quotableTotal({ matchTotal: 4321, loaded: 200 }) === 4321);
check('no matchTotal (a restored/legacy result) → the loaded length, never a fabricated number',
  quotableTotal({ matchTotal: undefined, loaded: 37 }) === 37);

// ── B. the shipped helper must still BE that replica ─────────────────────────────────────────────
const strip = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l.trim())).join('\n');
const search = strip(readFileSync(new URL('../src/data/search.ts', import.meta.url), 'utf8'));
const body = (search.match(/export function quotableTotal\(r: SearchResult\): number \| null \{[\s\S]*?\n\}/) ?? [''])[0];

check('src/data/search.ts exports quotableTotal(SearchResult)', body.length > 0,
  'the single definition of "the total this search may state" is gone');
check('it prefers matchTotal (the RPC count) over the page buffer',
  /const total = r\.matchTotal \?\? r\.listings\.length;/.test(body),
  'matchTotal is count(*) over() — listings.length is a 1500-capped page buffer');
check('it never returns r.total (the page-capped count)', !/r\.total/.test(body),
  'r.total IS the bug: listings.length, capped at the QUERY_LIMIT');
check('it suppresses the count under client-only narrowing',
  /hasClientOnlyNarrowing\(r\.query\)/.test(body));
check('it suppresses the count for an agent-annualized budget',
  /r\.query\.priceIsAnnual/.test(body));
check('it returns null (not 0, not a cap) when there is nothing honest to say',
  /return null;/.test(body) && /!\(total > 0\)/.test(body));

// ── C. SOURCE SCAN — the page-capped total must not reach any user-facing sentence ───────────────
const agent = strip(readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8'));

check('runRefine reports the honest total to the mining overlay (onFetched)',
  /const honestTotal = quotableTotal\(result\);/.test(agent) && /onFetched\?\.\(honestTotal\)/.test(agent),
  'the overlay count must come from quotableTotal(), not result.total');
check('agent.tsx never reads the page-capped `result.total` for a displayed count',
  !/\bresult\.total\b/.test(agent),
  'result.total is listings.length — a page buffer capped at 1500; it is not a match count');
check('the results headline quotes the SAME helper as the overlay',
  /const introTotal = quotableTotal\(m\.result\)/.test(agent),
  'two surfaces describing one search must not compute the total two different ways');

const mining = strip(readFileSync(new URL('../src/components/MiningTransition.tsx', import.meta.url), 'utf8'));
// 2026-08-31 redesign: the overlay claims NO completion count at all (the «لقينا N» beat is gone —
// even stronger than "only the handed count"); the sole number it may speak is the handed
// from-count, and it still has no path to a locally-invented total.
check('MiningTransition claims no completion count and cannot invent one locally',
  !/grouped\(to\)/.test(mining)
  && /\{ count: grouped\(from\) \}/.test(mining)
  && !/listings|matchTotal|1500/.test(mining));

// ── D. MUTATION PROOF (self-checking) ────────────────────────────────────────────────────────────
// The removed bug, restored in miniature: quoting `total` instead of `matchTotal`. If this ever
// agrees with the fixed helper on the live case, section A is not actually asserting anything.
{
  const buggy = (r: { total: number }) => r.total;               // the shipped bug, verbatim
  const live = { matchTotal: 3897, loaded: PAGE_LIMIT, total: PAGE_LIMIT };
  check('MUTATION: quoting result.total returns the page limit and is caught here',
    buggy(live) === PAGE_LIMIT && quotableTotal(live) !== buggy(live),
    `buggy=${buggy(live)} fixed=${quotableTotal(live)}`);
}

console.log(failures === 0
  ? '\n✓ one total, quoted everywhere: the RPC match count — never the 1500-row page limit\n'
  : `\n✗ ${failures} check(s) FAILED — a search could quote a page cap as its result count\n`);
process.exit(failures === 0 ? 0 : 1);
