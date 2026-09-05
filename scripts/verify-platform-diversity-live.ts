// LIVE BEHAVIORAL regression barrier for platform diversity (owner 2026-08-09: "I want the stronger
// live behavioral regression barrier so this cannot silently break later").
//
// The two existing guards are STATIC: verify-rpc-clause-invariants.ts pins the div_rank ORDER-BY *text*,
// and verify-platform-diversity.ts models the sort key OFFLINE. Neither executes the real RPC, so a SQL
// change that keeps the pinned text but alters behavior another way (a new UNION arm, an added WHERE, a
// different partition source, a data shift) would pass CI. THIS script closes that blind spot: it calls
// the REAL production RPC through the same anon key the app uses and asserts the owner's rules on the
// actual returned rows — MATCH FIRST → DIVERSIFY SECOND, correctness never traded for diversity.
//
// It calls location_search_candidates_ar with p_per_platform=null (the ONLY branch the app uses — the
// diversified round-robin branch), mirroring src/data/remote.ts:1065.
//
// WHY LIVE + anon key (not the service role): the anon REST path is exactly what real clients hit, so RLS
// / permission differences can't mask a regression (memory: verify-via-anon-key rule).
//
// NOT wired into `npm test` (that CI has no network/DB). Runs from .github/workflows/diversity-live-check.yml
// on a schedule (job failure → GitHub notifies), and from the daily production audit. Manual:
//   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
//     node --experimental-strip-types scripts/verify-platform-diversity-live.ts

// Env wins when set; otherwise the committed PUBLIC endpoint. The URL already defaulted this way —
// before 2026-08-10 the KEY did not, and the workflow's repo secret did not exist, so this barrier
// exited 1 without ever running once since it shipped.
// Shared pacing (owner 2026-09-04): wraps fetch so this harness's production searches are
// spaced against every OTHER routine's, not just its own. Never drops or alters a request.
import './lib/searchPacer.mjs';
import { resolvePublicSupabase } from './lib/public-supabase.ts';
const { url: URL_BASE, key: KEY } = resolvePublicSupabase();

const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const enc = encodeURIComponent;
const BUY = 'بيع';
const RENT = 'إيجار';
const PAGE = 300; // page-0 window; app page size is larger but 300 is plenty to prove the ordering shape

type Row = {
  platform: string;
  listing_id: number;
  effective_price: number | null;
  city_ar: string | null;
  total_count: number;
};

async function rpc(args: Record<string, unknown>): Promise<Row[]> {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/location_search_candidates_ar`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ p_per_platform: null, p_limit: PAGE, p_offset: 0, ...args }),
  });
  if (!res.ok) throw new Error(`rpc ${res.status}: ${await res.text()}`);
  return (await res.json()) as Row[];
}

// count of the given listing_ids that ALSO satisfy an extra predicate — proves no ineligible row was
// inserted for variety (eligibility is never changed for diversity).
async function countIdsMatching(ids: number[], extra: string): Promise<number> {
  if (!ids.length) return 0;
  const res = await fetch(
    `${URL_BASE}/rest/v1/search_listings_ar?select=listing_id&limit=1&listing_id=in.(${ids.join(',')})&${extra}`,
    { headers: { ...HEADERS, Prefer: 'count=exact' } },
  );
  if (!res.ok && res.status !== 206) throw new Error(`table ${res.status}: ${await res.text()}`);
  const total = Number((res.headers.get('content-range') ?? '').split('/')[1]);
  if (!Number.isFinite(total)) throw new Error(`no count in content-range`);
  return total;
}

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

function longestRun(platforms: string[]): { plat: string; start: number; len: number } {
  let best = { plat: '', start: 0, len: 0 };
  let start = 0;
  for (let i = 0; i < platforms.length; i++) {
    if (i === 0 || platforms[i] !== platforms[i - 1]) start = i;
    const len = i - start + 1;
    if (len > best.len) best = { plat: platforms[i], start, len };
  }
  return best;
}

// A run longer than a 2-row group-boundary seam is only allowed if it is an EXHAUSTION tail — i.e. every
// OTHER platform present in the window already appeared before the run began (owner: no domination while
// other qualifying platforms still have unshown inventory).
function streakExplained(platforms: string[], run: { plat: string; start: number; len: number }): boolean {
  if (run.len <= 2) return true;
  const first: Record<string, number> = {};
  platforms.forEach((p, i) => { if (!(p in first)) first[p] = i; });
  return Object.entries(first).every(([p, idx]) => p === run.plat || idx < run.start);
}

// AF-narrowed cases (2026-08-22, owner cert pass): same params verify-af-independent-oracle.ts already
// proved correct in isolation — here we prove diversity ordering doesn't smuggle an ineligible row back
// in when it's LAYERED on top of a real AF predicate (requirement #11: diversification must not
// introduce an ineligible listing, specifically for the AF-narrowed case, not just the base search).
type Q = { name: string; args: Record<string, unknown>; deal?: string; afRest?: string };
const QUERIES: Q[] = [
  { name: 'Buy · الرياض · شقة', args: { p_deal: BUY, p_cities: ['الرياض'], p_types: ['شقة'] }, deal: BUY },
  { name: 'Buy · جدة (broad)', args: { p_deal: BUY, p_cities: ['جدة'] }, deal: BUY },
  { name: 'Rent annual · الرياض', args: { p_deal: RENT, p_cities: ['الرياض'], p_rent_period: 'سنوي' }, deal: RENT },
  { name: 'Rent monthly · الرياض', args: { p_deal: RENT, p_cities: ['الرياض'], p_rent_period: 'شهري' }, deal: RENT },
  { name: 'Commercial · الرياض', args: { p_category: 'تجاري', p_cities: ['الرياض'] } },
  { name: 'AF-narrowed: Buy · الرياض · فيلا/تاون هاوس/بيت · bathrooms ≥ 3',
    args: { p_deal: BUY, p_cities: ['الرياض'], p_types: ['فيلا', 'تاون هاوس', 'بيت'], p_bath_min: 3 },
    deal: BUY, afRest: 'bathrooms=gte.3' },
  { name: 'AF-narrowed: Rent annual · الرياض · شقة/مبنى شقق مخدومة/ملحق علوي · confirmed furnished',
    args: { p_deal: RENT, p_cities: ['الرياض'], p_types: ['شقة', 'مبنى شقق مخدومة', 'ملحق علوي'],
      p_rent_period: 'سنوي', p_furnished: true },
    deal: RENT, afRest: 'furnished=is.true' },
];

async function main() {
  for (const q of QUERIES) {
    const page0 = await rpc(q.args);
    if (!page0.length) { check(`${q.name}: has results`, false, 'RPC returned 0 rows'); continue; }
    const platforms = page0.map((r) => r.platform);
    const ids0 = page0.map((r) => r.listing_id);
    const total = Number(page0[0].total_count);
    const P = new Set(platforms).size;

    // (1) div_rank leads → the first P rows are P DISTINCT platforms (round-robin #1s).
    const frontDistinct = new Set(platforms.slice(0, P)).size;
    check(`${q.name}: round-robin front (first ${P} rows are ${P} distinct platforms)`, frontDistinct === P,
      `platforms=${P} front_distinct=${frontDistinct} · first=[${platforms.slice(0, Math.min(P, 12)).join(', ')}]`);

    // (2) no excessive streak — a long run must be an exhaustion tail, not domination.
    const run = longestRun(platforms);
    check(`${q.name}: longest streak explained (=${run.len})`, streakExplained(platforms, run),
      `run of ${run.plat} len=${run.len} at ${run.start}; other platforms not all exhausted before it`);

    // (7) no duplicates within the page, and none across Show More (offset paging over one total order).
    check(`${q.name}: no dup within page`, new Set(ids0).size === ids0.length,
      `fetched=${ids0.length} distinct=${new Set(ids0).size}`);
    if (total > page0.length) {
      const page1 = await rpc({ ...q.args, p_offset: page0.length });
      const set0 = new Set(ids0);
      const overlap = page1.map((r) => r.listing_id).filter((id) => set0.has(id));
      check(`${q.name}: no dup across Show More (offset ${page0.length})`, overlap.length === 0,
        `overlap=${overlap.length}`);
    }

    // (1/8) correctness never traded for diversity — every returned row satisfies the deal filter.
    if (q.deal) {
      const sample = ids0.slice(0, 150);
      const matched = await countIdsMatching(sample, `deal_ar=eq.${enc(q.deal)}`);
      check(`${q.name}: every returned row satisfies the deal filter (0 ineligible inserted)`,
        matched === sample.length, `matched=${matched}/${sample.length}`);
    }

    // (11) AF-narrowed case: every returned row ALSO satisfies the AF predicate — diversity ordering
    // never pulls in a row the AF answer would have excluded.
    if (q.afRest) {
      const sample = ids0.slice(0, 150);
      const matched = await countIdsMatching(sample, q.afRest);
      check(`${q.name}: every returned row satisfies the AF predicate (0 ineligible inserted by diversity)`,
        matched === sample.length, `matched=${matched}/${sample.length}`);
    }
  }

  // (6) an explicit objective sort WINS — diversity steps aside, price is monotonic across the page seam.
  const s0 = await rpc({ p_deal: BUY, p_cities: ['الرياض'], p_types: ['شقة'], p_sort_by: 'price_asc', p_limit: 200 });
  const s1 = await rpc({ p_deal: BUY, p_cities: ['الرياض'], p_types: ['شقة'], p_sort_by: 'price_asc', p_limit: 200, p_offset: 200 });
  const seq = [...s0, ...s1];
  const prices = seq.map((r) => r.effective_price).filter((v): v is number => v != null).map(Number);
  let mono = true;
  for (let i = 1; i < prices.length; i++) if (prices[i] < prices[i - 1]) { mono = false; break; }
  check('sort preserved: price_asc is non-decreasing across the Show More boundary', mono && prices.length > 0,
    `n=${prices.length} first=${prices[0]} last=${prices[prices.length - 1]}`);
  const sids = seq.map((r) => r.listing_id);
  check('sort: 0 duplicates across the boundary', new Set(sids).size === sids.length,
    `fetched=${sids.length} distinct=${new Set(sids).size}`);

  console.log(failed === 0
    ? '\n✓ platform-diversity live behavior holds — MATCH-FIRST round-robin, no domination, no dupes, sort preserved'
    : `\n✗ ${failed} live diversity check(s) FAILED against production`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
