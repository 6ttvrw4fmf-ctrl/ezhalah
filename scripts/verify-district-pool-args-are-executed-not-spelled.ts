// THE DISTRICT POOL MUST SEND THE SCOPE IT WAS ASKED FOR — PROVEN BY EXECUTION, NOT BY SPELLING.
//
// THE BLIND GUARD THIS REPLACES (ops_incident #208, routine #10, 2026-09-12).
// --------------------------------------------------------------------------
// Found by the PART 4.8 mutant survival sweep. One line was inserted into src/data/locations.ts,
// immediately BEFORE the `district_options_ar` args literal inside ensureDistrictOptions:
//
//     category = null as any;
//     const args: Record<string, unknown> = { p_city_id: cityId, p_deal: dealAr(deal), p_category: category };
//
// Then `npm run test:all`. **All 435 checks passed. SUITE_EXIT=0.**
//
// That mutant is a real defect, not a curiosity: the district panel's per-حي counts would be computed
// over EVERY category while the search applies the picked one, so every number beside every حي is a
// promise the search does not keep — the count-vs-results scope class this repo has been bitten by
// repeatedly (the 2026-09-03 Trending-vs-results scope defect, and the p_tables defect recorded
// above this very call site).
//
// WHY BOTH EXISTING GUARDS STAYED GREEN, and why it is one root cause rather than two:
//
//   • `verify-count-scope-parity.ts` asserts the SOURCE TEXT contains
//     `p_city_id: cityId, p_deal: dealAr(deal), p_category: category`. The mutant leaves that string
//     byte-identical and corrupts the VALUE flowing into it. A substring cannot tell "the right
//     variable is named here" from "the right variable is named here AND was overwritten one line
//     up".
//   • `verify-district-diagnosis-count-is-category-scoped.ts` — the barrier whose NAME is this
//     invariant — contains zero liftSymbols/import calls. It never executes the path either.
//
// This is ops_incident #136's shape generalised, and the generalisation is the point: **a barrier
// pinning a call-site literal asserts one SPELLING, not a contract.** It fails in BOTH directions
// from the same root cause — it goes RED on a correct refactor (rename `category`, or reorder the
// object, and the guard breaks while the code is fine) and it stays GREEN for a defect introduced
// one line upstream. AGENTS.md names the class: every one of the five defects of 2026-09-04 had a
// barrier over the exact line.
//
// WHAT THIS FILE DOES INSTEAD. It lifts the REAL ensureDistrictOptions out of locations.ts with
// scripts/lib/liftSymbols.ts and RUNS it against a stub client that RECORDS the args handed to
// `.rpc()`, then asserts the recorded object against the arguments the caller passed. It never reads
// the call site as text, so it is indifferent to spelling and cannot be satisfied by a comment.
// Same technique, same module, as scripts/verify-failed-location-index-is-not-a-load.ts.
//
// The stub RESOLVES `{ data, error }` the way supabase-js really behaves — it NEVER THROWS — which is
// also why the failure-path assertions below are meaningful rather than decorative.
//
//   node --experimental-strip-types scripts/verify-district-pool-args-are-executed-not-spelled.ts

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src/data/locations.ts');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught, 'the executed invariant did NOT report this defect');

console.log('\nThe district pool sends the scope it was asked for — executed, not spelled\n');

// The ONLY stand-ins are the per-key memo maps and the injected client. None carries logic: in
// production these are plain Maps and a module-level `supabase`. `dealAr` and `districtCacheKey` are
// LIFTED FOR REAL below, because the assertions read what they produce — a hand-written copy of
// either is the duplicate-logic defect this barrier exists to remove.
const PRELUDE = `
type Deal = any; type Category = any; type AfParams = any;
type DistrictOption = any; type PoolStatus = any;
let supabase: any = null;
const setClient = (c: any) => { supabase = c; };
const _districtCache = new Map<string, any>();
const _districtFetchedAt = new Map<string, number>();
const _districtPromises = new Map<string, any>();
const _districtPoolStatus = new Map<string, any>();
const POOL_TTL_MS = 30 * 60 * 1000;
`;

type Lifted = {
  ensureDistrictOptions: (
    cityId: number, deal: string | null, category: string | null,
    periodTok?: string | null, types?: string[] | null, scope?: Record<string, unknown> | null,
  ) => Promise<unknown[]>;
  setClient: (c: unknown) => void;
  clearCaches: () => void;
};

async function load(source: string): Promise<Lifted> {
  const dir = mkdtempSync(join(tmpdir(), 'ezhalah-distpool-'));
  const file = join(dir, 'locations.ts');
  writeFileSync(file, source);
  return await liftSymbols(file, [
    { header: 'function dealAr(', endsWith: /^\}$/ },
    { header: 'const pmKey = ', endsWith: /;$/ },
    { header: 'const typesKey = ', endsWith: /;$/ },
    { header: 'const afKey = ', endsWith: /^\};$/ },
    { header: 'const districtCacheKey = ', endsWith: /;$/ },
    { header: 'export async function ensureDistrictOptions(', endsWith: /^\}$/ },
  ], ['ensureDistrictOptions', 'setClient', 'clearCaches'],
  // clearCaches is appended, not stubbed: each probe must start cold, or the memo would answer the
  // second call and the args would never be built at all — a probe that silently stops probing.
  `${PRELUDE}\nconst clearCaches = () => { _districtCache.clear(); _districtFetchedAt.clear(); _districtPromises.clear(); _districtPoolStatus.clear(); };\n`,
  ) as unknown as Lifted;
}

type Recorded = { rpc: string; args: Record<string, unknown> };
/** Records every rpc() call and resolves the way supabase-js does — never throwing. */
const recordingClient = (log: Recorded[], result: { data: unknown; error: unknown }) => ({
  rpc: (rpc: string, args: Record<string, unknown>) => {
    log.push({ rpc, args: { ...args } });
    return { abortSignal: () => Promise.resolve(result) };
  },
});

const ROWS = [{ district_ar: 'النرجس', listing_count: 42, match_values: ['النرجس'], total_in_city: 900 }];

/**
 * The invariant, as ONE runnable predicate — applied verbatim to the real file and to every mutant.
 *
 * It asks what the caller asked for and what the RPC was actually told, and nothing about how either
 * is written. Returns the list of violations.
 */
async function violations(mod: Lifted): Promise<string[]> {
  const bad: string[] = [];

  // Case 1: the shape the mutant broke — a category IS picked, and must reach the RPC.
  {
    mod.clearCaches();
    const log: Recorded[] = [];
    mod.setClient(recordingClient(log, { data: ROWS, error: null }));
    await mod.ensureDistrictOptions(66, 'Rent', 'Residential', 'شهري', null, null);
    const call = log[0];
    if (!call) bad.push('no district_options_ar call was made at all');
    else {
      if (call.rpc !== 'district_options_ar') bad.push(`called '${call.rpc}', not district_options_ar`);
      if (call.args.p_category !== 'Residential') {
        bad.push(`p_category reached the RPC as ${JSON.stringify(call.args.p_category)} when the `
          + "caller passed 'Residential' — the district counts would be computed over every category "
          + 'while the search applies one');
      }
      if (call.args.p_city_id !== 66) bad.push(`p_city_id was ${JSON.stringify(call.args.p_city_id)}, not 66`);
      // dealAr is lifted for real, so this asserts the TRANSLATION, not a spelling.
      if (typeof call.args.p_deal !== 'string' || !call.args.p_deal) {
        bad.push(`p_deal did not translate to an Arabic token: ${JSON.stringify(call.args.p_deal)}`);
      }
      if (call.args.p_rent_period !== 'شهري') {
        bad.push(`p_rent_period was ${JSON.stringify(call.args.p_rent_period)}, not the token passed`);
      }
    }
  }

  // Case 2: a NULL category must stay null — the barrier must not merely demand "non-null", or it
  // would forbid the legitimate all-categories pool. Both directions, as PART 6 requires.
  {
    mod.clearCaches();
    const log: Recorded[] = [];
    mod.setClient(recordingClient(log, { data: ROWS, error: null }));
    await mod.ensureDistrictOptions(66, 'Buy', null, null, null, null);
    const call = log[0];
    if (!call) bad.push('no call was made for the null-category pool');
    else {
      if (call.args.p_category !== null && call.args.p_category !== undefined) {
        bad.push(`a null category was turned into ${JSON.stringify(call.args.p_category)} — the pool `
          + 'would silently narrow a search the user did not narrow');
      }
      if ('p_rent_period' in call.args) {
        bad.push('p_rent_period was sent for an unknown period — owner rule: period = source, and '
          + 'unknown is never annual');
      }
    }
  }

  // Case 3: THE TABLE SCOPE. The comment above the call site records that the period fallback "drops
  // the PERIOD, never the table scope", because a widened table set describes results the search
  // cannot deliver. Execute the fallback and assert exactly that.
  {
    mod.clearCaches();
    const log: Recorded[] = [];
    let n = 0;
    mod.setClient({
      rpc: (rpc: string, args: Record<string, unknown>) => {
        log.push({ rpc, args: { ...args } });
        // First call errors (an older signature rejecting p_rent_period), second succeeds.
        const result = ++n === 1 ? { data: null, error: { message: 'PGRST202' } } : { data: ROWS, error: null };
        return { abortSignal: () => Promise.resolve(result) };
      },
    });
    await mod.ensureDistrictOptions(66, 'Rent', 'Residential', 'سنوي', null, { p_tables: ['a', 'b'] });
    const fallback = log[log.length - 1];
    if (log.length < 2) bad.push('the period fallback never fired, so its scope could not be checked');
    else {
      if (JSON.stringify(fallback.args.p_tables) !== JSON.stringify(['a', 'b'])) {
        bad.push('the period fallback DROPPED the table scope — a widened table set promises results '
          + `the search cannot deliver: ${JSON.stringify(fallback.args.p_tables)}`);
      }
      if (fallback.args.p_category !== 'Residential') {
        bad.push('the period fallback dropped the CATEGORY as well as the period');
      }
    }
  }

  // Case 4: A FAILED FETCH IS NOT AN EMPTY ANSWER. supabase-js never throws, so an errored RPC
  // resolves with data null; the pool must report 'error', not cache an empty pool as the truth.
  {
    mod.clearCaches();
    const log: Recorded[] = [];
    mod.setClient(recordingClient(log, { data: null, error: { message: 'FetchError: network request failed' } }));
    const out = await mod.ensureDistrictOptions(66, 'Rent', 'Residential', 'شهري', null, null);
    if (!Array.isArray(out) || out.length !== 0) {
      bad.push(`a failed RPC returned ${JSON.stringify(out)} instead of an empty list`);
    }
    // The retry must be possible: a parked promise would make the failure permanent for the session.
    mod.setClient(recordingClient(log, { data: ROWS, error: null }));
    const retried = await mod.ensureDistrictOptions(66, 'Rent', 'Residential', 'شهري', null, null);
    if (!Array.isArray(retried) || retried.length !== 1) {
      bad.push('after a failure the pool did not retry — the failed promise stayed parked, so the '
        + 'district panel would show nothing for the rest of the session');
    }
  }

  return bad;
}

// ── THE REAL SHIPPED FUNCTION ───────────────────────────────────────────────────────────────────
const REAL = readFileSync(SRC, 'utf8');
const real = await load(REAL);
const realViolations = await violations(real);
check('the shipped ensureDistrictOptions sends the scope it was asked for',
  realViolations.length === 0, realViolations.join('\n      '));

// ── MUTATION PROOFS — the real file, really mutated, really re-executed ─────────────────────────
// Each mutant is applied to a COPY of the actual source and run through the same predicate. The
// first is the exact mutant the whole 435-check suite passed on 2026-09-12.
console.log('\n  mutation proof — the real source, mutated and re-executed\n');

const ARGS_LINE = '        const args: Record<string, unknown> = { p_city_id: cityId, p_deal: dealAr(deal), p_category: category };';
if (!REAL.includes(ARGS_LINE)) {
  // Not a text assertion about correctness — an anchor check. If the line moves, the mutants below
  // would silently become no-ops and every proof would pass vacuously, which is the failure mode
  // this whole file exists to prevent. So it fails LOUDLY instead.
  check('the mutation anchor still exists in locations.ts', false,
    'the args line moved; re-anchor the mutants below, because a no-op mutant proves nothing');
}

/**
 * Apply a mutation to the real source, REFUSING any anchor that is not unique.
 *
 * This guard earned itself on its first run. The period mutant below anchored on
 * `if (periodTok !== null) args.p_rent_period = periodTok;`, which appears TWICE in locations.ts —
 * once in the city pool (line 857) and once in the district pool (line 1011). `String.replace` takes
 * the FIRST, so the mutant landed in a function this barrier does not probe and the proof was a
 * NO-OP. It failed rather than passing vacuously only because the predicate is executed; a
 * source-text barrier with the same bug would have reported a clean pass.
 *
 * A vacuous mutant is the worst possible defect in a mutation proof: it makes the grandfather list
 * and every coverage count read as protection while proving nothing. So a missing OR duplicated
 * anchor is a hard failure, never a silent first-match.
 */
const mutantOf = (find: string, replace: string): string => {
  const n = REAL.split(find).length - 1;
  if (n !== 1) {
    check(`the mutation anchor is unique (${n} occurrence(s))`, false,
      `the anchor appears ${n} time(s) in locations.ts, so this mutant would ${n === 0
        ? 'not apply at all' : 'land on the first match, which may be a different function'}`
      + `:\n      ${find.split('\n')[0].trim()}`);
    return REAL;               // unmutated: the proof below will fail, loudly, as it must
  }
  return REAL.replace(find, replace);
};

/** Same, but scoped to the region AFTER `anchor` — for a line that legitimately recurs. */
const mutantAfter = (anchor: string, find: string, replace: string): string => {
  const at = REAL.indexOf(anchor);
  if (at < 0) {
    check('the scoping anchor exists', false, `not found: ${anchor.slice(0, 60)}`);
    return REAL;
  }
  const head = REAL.slice(0, at);
  const tail = REAL.slice(at);
  const n = tail.split(find).length - 1;
  if (n < 1) {
    check('the scoped mutation anchor exists after its scope', false,
      `not found after the scoping anchor: ${find.trim()}`);
    return REAL;
  }
  return head + tail.replace(find, replace);
};

mustCatch('THE MEASURED CASE: category nulled one line above the args literal (suite was GREEN, 435/435)',
  (await violations(await load(mutantOf(ARGS_LINE, `        category = null as any;\n${ARGS_LINE}`))))
    .some((v) => v.includes('p_category reached the RPC as null')));

mustCatch('the category silently replaced by a DIFFERENT one (a plausible copy-paste)',
  (await violations(await load(mutantOf(ARGS_LINE, `        category = 'Commercial' as any;\n${ARGS_LINE}`))))
    .some((v) => v.includes('p_category reached the RPC as')));

mustCatch('p_category dropped from the args object entirely',
  (await violations(await load(mutantOf(ARGS_LINE,
    '        const args: Record<string, unknown> = { p_city_id: cityId, p_deal: dealAr(deal) };'))))
    .some((v) => v.includes('p_category')));

mustCatch('a NULL category being defaulted to Residential (narrowing a search the user did not narrow)',
  (await violations(await load(mutantOf(ARGS_LINE,
    "        const args: Record<string, unknown> = { p_city_id: cityId, p_deal: dealAr(deal), p_category: category ?? 'Residential' };"))))
    .some((v) => v.includes('a null category was turned into')));

mustCatch('the period fallback quietly dropping the TABLE SCOPE (the p_tables over-promise returning)',
  (await violations(await load(mutantOf(
    "            .rpc('district_options_ar', { p_city_id: cityId, p_deal: dealAr(deal), p_category: category, ...(scope ?? {}) })",
    "            .rpc('district_options_ar', { p_city_id: cityId, p_deal: dealAr(deal), p_category: category })"))))
    .some((v) => v.includes('DROPPED the table scope')));

// Scoped: this exact line also exists in the CITY pool (line 857), which this barrier does not probe.
mustCatch('an unknown period being sent as a token anyway (period = source; unknown is never annual)',
  (await violations(await load(mutantAfter(
    'export async function ensureDistrictOptions(',
    '        if (periodTok !== null) args.p_rent_period = periodTok;',
    "        args.p_rent_period = periodTok ?? 'سنوي';"))))
    .some((v) => v.includes('p_rent_period was sent for an unknown period')));

mustCatch('a failed RPC leaving its promise PARKED, so the panel never recovers in that session',
  (await violations(await load(mutantOf(
    `      _districtPoolStatus.set(key, 'error');
      _districtPromises.delete(key);
      return [];
    } catch {`,
    `      _districtPoolStatus.set(key, 'error');
      return [];
    } catch {`))))
    .some((v) => v.includes('did not retry')));

// ── negative control ────────────────────────────────────────────────────────────────────────────
// A predicate red for everything guards nothing. The real file is re-run through the SAME loader and
// the SAME predicate, so this is a statement about the executed path rather than about the source.
mustCatch('…while the UNMUTATED shipped function is NOT flagged (the predicate is not vacuously red)',
  (await violations(await load(REAL))).length === 0);

console.log(failures === 0
  ? '\n✓ the district pool\'s scope is proven by execution — a defect upstream of the call site is now visible\n'
  : `\n✗ ${failures} check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
