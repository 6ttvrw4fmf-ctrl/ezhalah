// THE INDEPENDENT ORACLE MUST KNOW EVERY PARAM THE APP CAN SEND.
//
// ── THE INCIDENT THIS EXISTS FOR (2026-09-01) ────────────────────────────────────────────────────
//
// PR #1361 (2026-08-30) added ONE parameter to the search RPC call in src/data/remote.ts:
//
//     p_rotation_seed: rotationSeed(),
//
// It is sent on EVERY search. `scripts/lib/afOracleFilter.ts` had no `case` for it, so it fell to
// the translator's `default:` arm and was reported UNHANDLED — correct, fail-closed behaviour for a
// parameter nobody has classified. The consequence was not correct at all: because the oracle
// refuses to produce a count whenever anything is unhandled, EVERY AF journey lost its independent
// verdict at once. `scripts/verify-af-live-truth.ts` and its scheduled workflow
// (.github/workflows/af-live-truth-check.yml) went red at 2026-08-30T18:33Z and stayed red through
// 2026-09-01 — three days in which AF's deepest correctness check (RPC vs independent DB truth,
// exact ID-set diffs) produced NO VERDICT, on a surface whose whole point is that its counts are
// independently provable.
//
// Nothing offline caught it. The red workflow was the only signal, and a scheduled live check that
// is red for a translator gap looks exactly like one that is red for a production regression — so
// it read as known-noise. Note the direction of the failure: the oracle did not lie, it went QUIET.
// That is the same shape as the nine dark detectors in AGENTS.md — a check that cannot reach a
// verdict reads, from a distance, like a check that passed.
//
// ── WHAT THIS BARRIER PINS ───────────────────────────────────────────────────────────────────────
//
// Every `p_*` parameter the app can put on a location_search_candidates_ar request must be
// EXPLICITLY classified in the translator — as a predicate it translates, or as ordering/paging
// metadata it may skip. Being unknown is not a third option. The check is offline, deterministic
// and runs in `npm test`, so the PR that adds the parameter is the thing that turns red, instead of
// a live workflow going quiet three days later.
//
// Classifying a new parameter is deliberately a one-line act — add its `case` to buildOracleQS —
// but it CANNOT be done by accident, and it forces the author to answer the only question that
// matters: does this narrow the result set, or only order it? Getting that answer wrong is what
// `verify-af-oracle-soundness.ts` and the live differential exist to catch; this file only
// guarantees the question is asked.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const REMOTE = join(ROOT, 'src/data/remote.ts');
const TRANSLATOR = join(ROOT, 'scripts/lib/afOracleFilter.ts');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nverify-af-oracle-classifies-every-search-param: no parameter the app sends may be\n' +
            '  unknown to the independent oracle (a quiet oracle is a dark oracle).\n');

const remote = readFileSync(REMOTE, 'utf8');
const translator = readFileSync(TRANSLATOR, 'utf8');

// ── 1. what the app can send ─────────────────────────────────────────────────────────────────────
//
// Scoped to the regions that literally build the search request, so params belonging to the OTHER
// RPCs in this file (loc_rel_rank's p_listing_ids, property_age_option_counts_ar's p_source_tables,
// the agent's p_intents) cannot leak in and raise a false failure.
function balancedFrom(src: string, anchor: string, open: string, close: string): string {
  const start = src.indexOf(anchor);
  if (start < 0) return '';
  let i = src.indexOf(open, start);
  if (i < 0) return '';
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === open) depth++;
    else if (src[j] === close && --depth === 0) return src.slice(i, j + 1);
  }
  return '';
}

const REGIONS: [string, string][] = [
  ['rpcFilterParams()', 'function rpcFilterParams('],
  // The AF half of the results request comes from the ONE shared builder since 2026-09-02 (the
  // baseRpcParams literal spreads it instead of re-typing its 11 keys), so its keys are read here.
  ['rpcAdvancedFilterParams()', 'export function rpcAdvancedFilterParams('],
  ['resolveSearchScope()', 'export async function resolveSearchScope('],
  ['baseRpcParams literal', 'const baseRpcParams = {'],
  ['location_search_candidates_ar call site', "supabase.rpc('location_search_candidates_ar'"],
];

const sent = new Set<string>();
for (const [name, anchor] of REGIONS) {
  const body = balancedFrom(remote, anchor, '{', '}');
  check(`the search-request region ${name} is still locatable in src/data/remote.ts`, body.length > 0,
        `anchor not found: ${anchor} — if this moved, update the anchor rather than deleting the region`);
  for (const m of body.matchAll(/\bp_[a-z0-9_]+\s*:/g)) sent.add(m[0].replace(/\s*:$/, ''));
}
check('at least the well-known search params were extracted (the scan is not silently empty)',
      sent.size >= 15 && ['p_deal', 'p_cities', 'p_types', 'p_limit'].every((p) => sent.has(p)),
      `extracted ${sent.size}: ${[...sent].sort().join(' ')}`);

// ── 2. what the translator classifies ────────────────────────────────────────────────────────────
//
// The switch's `case` labels ARE the classification — read them from the source rather than from a
// hand-kept list, so the two can never drift apart. A param handled in the pre-switch numeric block
// also carries a `case` there (they `break` so the switch cannot re-apply them), which is exactly
// why that convention is worth keeping.
const classified = new Set(
  [...translator.matchAll(/case\s+'(p_[a-z0-9_]+)'\s*:/g)].map((m) => m[1]),
);
check('the translator still classifies params via `case` labels (the parse found some)',
      classified.size >= 20, `found ${classified.size}`);

// ── 3. the contract ──────────────────────────────────────────────────────────────────────────────
const unknown = [...sent].filter((p) => !classified.has(p)).sort();
check('EVERY param the app can send is explicitly classified by the oracle translator',
      unknown.length === 0,
      unknown.length
        ? `UNCLASSIFIED: ${unknown.join(', ')}\n      ` +
          'Add a `case` for each in buildOracleQS (scripts/lib/afOracleFilter.ts): translate it if it\n      ' +
          'narrows the result set, or `break` beside p_sort_by/p_rotation_seed if it only orders or\n      ' +
          'pages. Do NOT delete this check — an unclassified param silently blanks the entire AF\n      ' +
          'independent oracle (see this file\'s header).'
        : `${sent.size} params, all classified`);

// ── 4. the specific regression, pinned by name ───────────────────────────────────────────────────
check('p_rotation_seed specifically stays classified (the 3-day outage this file records)',
      classified.has('p_rotation_seed'));

// ── 5. the fail-closed default must survive ──────────────────────────────────────────────────────
//
// The whole barrier is worthless if someone "fixes" a future unclassified param by making the
// translator ignore unknown keys instead of classifying them: the oracle would then agree with a
// wrong RPC for the wrong reason, which is worse than going dark.
check('the translator still reports unknown params as unhandled rather than skipping them',
      /default:\s*unhandled\.push\(/.test(translator),
      'the `default: unhandled.push(...)` arm is gone — an unknown param would now be silently ' +
      'dropped, making the oracle agree with a wrong RPC instead of refusing');

console.log(failures
  ? `\n✗ verify-af-oracle-classifies-every-search-param: ${failures} check(s) failed.\n`
  : '\n✅ verify-af-oracle-classifies-every-search-param: all checks passed.\n');
process.exit(failures ? 1 : 0);
