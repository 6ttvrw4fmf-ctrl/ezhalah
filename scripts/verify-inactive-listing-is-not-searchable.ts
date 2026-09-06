// A SOURCE-CONFIRMED-DEAD LISTING MUST NOT STILL BE SERVED.
//
// Routine #11's barrier 1 — the row the owner stated as the whole object of the routine:
//
//   > If a source-confirmed listing is inactive/removed, the user must stop seeing it in Ezhalah
//   > immediately.
//
// "Immediately" on this chain means BY THE NEXT COMPLETE PROPAGATION, not instantly
// (docs/ops/LISTING_LIFECYCLE_ENGINEER.md §2.3): a deactivation reaches the served index only after
// `REFRESH active_listing_ids_v2` and then `sync_search_listings_ar()` have both run, and in
// production those fire at :20 and :14 — in the "wrong" order within the hour. A row deactivated at
// 04:25 legitimately survives the 05:14 sync. A leak that outlives one COMPLETE refresh+sync cycle
// is a defect; anything inside that window is latency and this barrier must not call it a bug.
//
// THE INCIDENT (ops_incident #27, P2, surface `lifecycle`). `sync_search_listings_ar()` aborts its
// DELETE leg when the rows-to-remove count exceeds `greatest(2000, 15% of the index)` — it writes a
// `sync_delete_circuit_breaker` row to `location_pipeline_alerts` and deletes NOTHING. That brake is
// correct and must never be weakened. But `location_search_candidates_ar` carries no `active`
// predicate of its own; aliveness is enforced entirely upstream. So a genuine mass delisting trips
// the brake and confirmed-dead inventory keeps being served until a human notices. The visibility
// half shipped in migration 20260905052403 (`mon_detect_inactive_still_searchable`, DETECT-ONLY,
// rostered, with a BLIND guard). #27 stayed open on the half a detector cannot supply: an executable
// barrier, watched to go red on the defect, that a PR and a schedule can both run.
//
// WHAT THIS ASSERTS — two readings of one invariant, with deliberately different blind spots.
//
//   [A] EXHAUSTIVE, index-level. `ops_lifecycle_inactive_still_searchable()` — production's own
//       shared resolver, the same one both #11 detectors read, so this cannot become a second copy
//       of the scope — must return the EMPTY SET over the whole fleet. It joins search_listings_ar
//       against active_listing_ids_v2 and confirms each candidate on its raw row, so it sees every
//       row the served RPC could possibly return. Its blind spot: it identifies candidates by
//       ABSENCE from the aliveness matview, so a STALE matview hides a fresh leak from it.
//
//   [B] SERVED-PATH, matview-independent. Rows are taken from `location_search_candidates_ar`
//       itself — the function a real user's search calls — and each one's raw row is read back
//       through the anon REST path. Every row a user is shown must be `active = true` in its own
//       source table. This never touches active_listing_ids_v2, so it closes [A]'s blind spot; its
//       own blind spot is that it is SAMPLED (pages spread across two deals and across the depth of
//       the index), not a full walk of 126k rows.
//
//   Neither is complete alone and this file does not pretend otherwise. Together they have no shared
//   blind spot for a leak of any size that a mass delisting would produce; the residual gap — a
//   handful of dead rows sitting on pages the sample missed WHILE the matview is simultaneously
//   stale — is covered continuously by mon_detect_inactive_still_searchable()'s privileged sweep and
//   its BLIND guard, which is the thing this barrier is the external reader of.
//
// IT REFUSES TO BE VACUOUSLY GREEN, three ways. A NULL propagation cutoff (cron history cannot date
// a complete cycle) is BLIND, never clean. A served sample that came back empty is BLIND. A sample
// whose raw rows could not be read is BLIND on the rows it could not read, and the readable count
// has a floor — a shrunken sample fails instead of passing quietly.
//
// SCOPE, so a green run is not read as more than it is. A served row whose RAW ROW IS GONE is an
// orphan, not a source-confirmed-dead leak: it is reported here with its routing kind
// (`orphan_after_delete`, barrier 9 / mon_detect_orphaned_search_row) and does not redden this
// check, which owns the `inactive_still_searchable` kind only. A row whose `active` is anything but
// `true` — including NULL — IS treated as dead, matching production's own `t.active is not true`;
// serving a row with no aliveness fact is the same leak wearing a different value.
//
// WHY IT IS LIVE, and where it runs. The invariant is a fact about what production serves; a
// source-text reading of the SQL proves a string is present, never that no dead row comes back, and
// this repo has been burned by that shape repeatedly (AGENTS.md). So it executes the real production
// functions through the publishable (anon) key — the exact path a visitor's client takes. Like every
// other live barrier it is OUT of the required `npm test` (scripts/test-exclusions.txt) so a
// momentarily unhealthy production cannot redden an unrelated PR, and it runs in
// .github/workflows/af-live-truth-check.yml. Its mutation proofs are hermetic and run either way.
//
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//     scripts/verify-inactive-listing-is-not-searchable.ts

// resolvePublicSupabase(), never a hand-rolled env read: an unset repo secret expands to the EMPTY
// STRING, and two live barriers once spent weeks red-because-never-run on exactly that
// (scripts/verify-live-checks-self-sufficient.ts).
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const { url: SUPA, key: KEY } = resolvePublicSupabase();
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failed++;
};

// ── THE PREDICATE — stated once, so the mutations below exercise THIS rule and not a copy of it ───

export type Served = { source_table: string; listing_id: number };
export type RawRow = { active: unknown; deactivated_at: string | null };
export type Leak = Served & { active: unknown; deactivated_at: string | null };
export type Verdict =
  | { kind: 'blind'; why: string }
  | { kind: 'leaking'; leaked: Leak[]; orphans: Served[]; inspected: number }
  | { kind: 'clean'; orphans: Served[]; inspected: number };

/** `${source_table}:${listing_id}` — the identity every surface in this system keys a listing by. */
export const rowKey = (r: Served) => `${r.source_table}:${r.listing_id}`;

/**
 * Hold what the search SERVED next to what the SOURCE TABLE says about the same rows.
 *
 * `raw` maps rowKey -> the raw row, and a MISSING entry means the raw row is gone (an orphan). Rows
 * whose table could not be read at all are removed by the caller before they get here, so absence
 * cannot be silently manufactured by a permission error.
 *
 * Returns `blind` rather than `clean` whenever the comparison could not actually be made. That
 * direction is the whole point: this barrier exists because a 0 that nobody could have measured
 * reads exactly like a 0 that was measured.
 */
export function servedLeakVerdict(
  cutoffIso: string | null,
  served: Served[],
  raw: Map<string, RawRow>,
): Verdict {
  if (!cutoffIso) {
    return { kind: 'blind', why:
      'ops_lifecycle_propagation_cutoff() is NULL — cron history cannot date one COMPLETE '
      + 'refresh+sync cycle, so "this row has had its chance to leave the index" is unknowable and '
      + 'a green here would be a guess, not a measurement' };
  }
  const cutoff = Date.parse(cutoffIso);
  if (!Number.isFinite(cutoff)) {
    return { kind: 'blind', why: `the propagation cutoff is unparseable: ${JSON.stringify(cutoffIso)}` };
  }
  if (!served.length) {
    return { kind: 'blind', why:
      'the served RPC returned no rows at all — this run inspected nothing, and "no dead row was '
      + 'found in zero rows" is not evidence' };
  }

  const leaked: Leak[] = [];
  const orphans: Served[] = [];
  for (const s of served) {
    const r = raw.get(rowKey(s));
    // A served row pointing at a raw row that no longer exists is `orphan_after_delete` — barrier 9
    // and mon_detect_orphaned_search_row own it. Reported, never swallowed, never counted here.
    if (!r) { orphans.push(s); continue; }
    // `active !== true` mirrors production's `t.active is not true`: NULL is not an aliveness fact,
    // and a string 'false' or a 0 is not "alive" either. Serving any of them is the same leak.
    if (r.active === true) continue;
    const dead = r.deactivated_at ? Date.parse(r.deactivated_at) : NaN;
    // Inside one propagation cycle this is NORMAL LATENCY, not a defect (§2.3). Strictly `>=`, the
    // mirror of production's `deactivated_at < cutoff` — a row deactivated exactly at the cutoff has
    // not yet had a complete cycle.
    if (Number.isFinite(dead) && dead >= cutoff) continue;
    // An UNDATEABLE death (deactivated_at NULL) does NOT get the benefit of the doubt. The safe
    // direction for a barrier is to show the row, not to hide it; production's own resolver reads
    // `t.deactivated_at is null or t.deactivated_at < cutoff` for the same reason.
    leaked.push({ ...s, active: r.active, deactivated_at: r.deactivated_at });
  }

  const inspected = served.length - orphans.length;
  if (inspected === 0) {
    return { kind: 'blind', why:
      `all ${served.length} served rows were orphans — no raw aliveness state was read, so this run `
      + 'compared nothing' };
  }
  return leaked.length
    ? { kind: 'leaking', leaked, orphans, inspected }
    : { kind: 'clean', orphans, inspected };
}

// ── MUTATIONS — the defect re-introduced as the STATE it produces, and executed ───────────────────
//
// The defect this barrier exists for is `prune_inactive_from_search()` gone from the sync body (or
// its DELETE leg aborted on the circuit breaker): the raw row goes `active = false`, a full
// refresh+sync cycle passes, and the row is STILL returned by the served RPC. That cannot be
// injected into production — writing a dead row into the live index to watch a barrier notice is
// exactly the thing routine #11 may never do — so the mutations feed the predicate the EXACT STATE
// that removal produces, and each is watched to go red. Both directions, every time: a mutation that
// only ever proves red would pass over a predicate that is red on everything.

const mustCatch = (what: string, caught: boolean) => check(`MUTATION: catches ${what}`, caught);

const CUT = '2026-09-06T01:20:59.946Z';                    // a real production cutoff value
const ROW: Served = { source_table: 'sanadak_residential_listings', listing_id: 4744698 };
const one = (r: RawRow) => servedLeakVerdict(CUT, [ROW], new Map([[rowKey(ROW), r]]));
const leaks = (r: RawRow) => one(r).kind === 'leaking';
const clean = (r: RawRow) => one(r).kind === 'clean';

console.log('\nMutations — the defect state, and the states that must NOT be called a defect\n');

// 1. THE DEFECT VERBATIM: prune_inactive_from_search() removed from the sync body / the DELETE leg
//    aborted on the breaker — a confirmed-dead row still served a full cycle later.
mustCatch('a confirmed-dead row still served one full refresh+sync cycle later (the #27 defect)',
  leaks({ active: false, deactivated_at: '2026-09-05T04:22:00.000Z' }));
// 2. …and the same row alive must NOT be flagged, or check 1 proves only that this predicate is red.
mustCatch('nothing — the same row with active=true is not flagged',
  clean({ active: true, deactivated_at: null }));
// 3. LATENCY IS NOT A DEFECT. A deactivation newer than the cutoff has not had its cycle yet.
mustCatch('nothing — a row deactivated AFTER the cutoff is propagation latency, not a leak',
  clean({ active: false, deactivated_at: '2026-09-06T02:00:00.000Z' }));
// 4. The boundary, both sides of it: `< cutoff` is the rule, so exactly-at-cutoff is not yet late.
mustCatch('nothing — a row deactivated exactly AT the cutoff is not yet late',
  clean({ active: false, deactivated_at: CUT }));
mustCatch('a row deactivated one millisecond before the cutoff',
  leaks({ active: false, deactivated_at: new Date(Date.parse(CUT) - 1).toISOString() }));
// 5. A SECOND, DIFFERENT BREAK of the same rule: the deactivation that cannot be dated. An
//    `active = false` row with no deactivated_at must not slip through for want of a timestamp.
mustCatch('a dead row whose deactivation cannot be dated (deactivated_at NULL)',
  leaks({ active: false, deactivated_at: null }));
// 6. A THIRD: aliveness that is not a fact. NULL / 'false' / 0 are not `true`, and production's own
//    resolver reads `is not true` — a predicate written as `active === false` would miss all three.
mustCatch('a served row whose aliveness is NULL', leaks({ active: null, deactivated_at: null }));
mustCatch('a served row whose active is the STRING "false"',
  leaks({ active: 'false', deactivated_at: '2026-09-01T00:00:00.000Z' }));
mustCatch('a served row whose active is 0', leaks({ active: 0, deactivated_at: '2026-09-01T00:00:00.000Z' }));

// 7. VACUOUS GREENS. Each of these once read as "no dead rows found".
const blind = (v: Verdict) => v.kind === 'blind';
mustCatch('an undateable propagation cycle (NULL cutoff) as BLIND, not clean',
  blind(servedLeakVerdict(null, [ROW], new Map([[rowKey(ROW), { active: false, deactivated_at: null }]]))));
mustCatch('an EMPTY served sample as BLIND, not clean', blind(servedLeakVerdict(CUT, [], new Map())));
mustCatch('a sample whose raw rows were all unreadable as BLIND, not clean',
  blind(servedLeakVerdict(CUT, [ROW], new Map())));
// 8. An orphan is REPORTED and ROUTED, never silently dropped and never mistaken for this kind.
{
  const live: Served = { source_table: 'aqar_residential_listings', listing_id: 1 };
  const v = servedLeakVerdict(CUT, [live, ROW], new Map([[rowKey(live), { active: true, deactivated_at: null }]]));
  mustCatch('an orphaned served row as an ORPHAN (routed to orphan_after_delete), not as clean silence',
    v.kind === 'clean' && v.orphans.length === 1 && rowKey(v.orphans[0]) === rowKey(ROW) && v.inspected === 1);
}
// 9. One dead row among many live ones — the realistic shape, and the one a `.some()`/`.every()`
//    inversion would miss.
{
  const many: Served[] = Array.from({ length: 40 }, (_, i) => ({ source_table: 'aqar_residential_listings', listing_id: i + 1 }));
  const raw = new Map<string, RawRow>(many.map((m) => [rowKey(m), { active: true, deactivated_at: null }]));
  raw.set(rowKey(many[17]), { active: false, deactivated_at: '2026-09-04T00:00:00.000Z' });
  const v = servedLeakVerdict(CUT, many, raw);
  mustCatch('exactly one dead row hidden among 39 live ones',
    v.kind === 'leaking' && v.leaked.length === 1 && v.leaked[0].listing_id === 18);
}

// ── LIVE — the real production functions, through the publishable key ─────────────────────────────

const rpc = async (fn: string, body: unknown): Promise<unknown> => {
  const r = await fetch(`${SUPA}/rest/v1/rpc/${fn}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

console.log('\nLive — production, through the anon path a real client uses\n');

// [A] EXHAUSTIVE — production's own shared resolver, over the whole fleet.
let cutoff: string | null = null;
try {
  cutoff = (await rpc('ops_lifecycle_propagation_cutoff', {})) as string | null;
} catch (e) {
  check('ops_lifecycle_propagation_cutoff() is reachable', false,
    `${String(e).split('\n')[0]} — UNREACHABLE, so nothing below was measured`);
}
check('a COMPLETE refresh+sync cycle can be dated from cron history (the detector is not BLIND)',
  !!cutoff,
  'the cutoff is NULL: either sync_search_listings_ar or the active_listing_ids_v2 refresh has no '
  + 'recorded successful run, so every deactivation since then may still be served and no reading '
  + 'below can tell. Fix the refresh/sync chain first — and deactivate nothing in response.');
if (cutoff) console.log(`      propagation cutoff: ${cutoff}`);

try {
  const leaked = (await rpc('ops_lifecycle_inactive_still_searchable', {})) as Leak[];
  const byTable = new Map<string, number>();
  for (const l of leaked) byTable.set(l.source_table, (byTable.get(l.source_table) ?? 0) + 1);
  check(`[A] EXHAUSTIVE: no confirmed-inactive row survives in the served index (${leaked.length} found)`,
    leaked.length === 0,
    [...byTable].map(([t, n]) => `${t}: ${n}`).join(', ')
    + ` — sample ${JSON.stringify(leaked.slice(0, 5))}. These are active=false in their source table `
    + 'and STILL in search_listings_ar a full refresh+sync cycle after their deactivation, so '
    + 'location_search_candidates_ar can return them to a user. Look at the sync DELETE leg first '
    + '(location_pipeline_alerts, alert_type sync_delete_circuit_breaker) — and NEVER fix this by '
    + 'raising that breaker.');
} catch (e) {
  check('[A] ops_lifecycle_inactive_still_searchable() is reachable', false,
    `${String(e).split('\n')[0]} — UNREACHABLE, so the exhaustive half measured nothing`);
}

// [B] SERVED PATH — sampled off location_search_candidates_ar itself, and read back against the raw
// tables. Two deals × depths spread across the index: shallow pages carry the per-platform diversity
// ordering (many platforms), deep pages carry the tail (the two largest). One page is 200 rows.
const PAGE = 200;
const MIN_INSPECTED = 200;      // a shrunken sample must FAIL, not pass quietly
const served: Served[] = [];
let sampleFailures = 0;
for (const p_deal of ['بيع', 'إيجار']) {
  for (const p_offset of [0, 400, 5000, 20000, 60000]) {
    try {
      const rows = (await rpc('location_search_candidates_ar', { p_deal, p_limit: PAGE, p_offset })) as Served[];
      for (const r of rows) served.push({ source_table: r.source_table, listing_id: r.listing_id });
    } catch (e) {
      sampleFailures++;
      console.log(`      (page ${p_deal} @${p_offset} failed: ${String(e).split('\n')[0]})`);
    }
  }
}
check('the served RPC answered every sampled page', sampleFailures === 0,
  `${sampleFailures} page(s) failed — the sample below is smaller than it was meant to be`);

// Read each sampled row's own aliveness back out of its source table. A table that answers a batch
// of N ids with ZERO rows is treated as UNREADABLE, not as N orphans: a whole-batch miss is an RLS
// or permission answer far more often than 200 simultaneous hard deletes, and inventing orphans
// would be a false red pointed at the wrong routine.
const uniq = new Map<string, Served>(served.map((s) => [rowKey(s), s]));
const byTable = new Map<string, number[]>();
for (const s of uniq.values()) byTable.set(s.source_table, [...(byTable.get(s.source_table) ?? []), s.listing_id]);

const raw = new Map<string, RawRow>();
const unreadable: string[] = [];
for (const [table, ids] of byTable) {
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    const url = `${SUPA}/rest/v1/${table}?id=in.(${chunk.join(',')})&select=id,active,deactivated_at`;
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`);
      const rows = (await r.json()) as { id: number; active: unknown; deactivated_at: string | null }[];
      if (!rows.length) { unreadable.push(`${table} (batch of ${chunk.length} returned 0 rows)`); continue; }
      for (const row of rows) raw.set(`${table}:${row.id}`, { active: row.active, deactivated_at: row.deactivated_at });
    } catch (e) {
      unreadable.push(`${table}: ${String(e).split('\n')[0]}`);
    }
  }
}
// Rows whose table could not be read are dropped from the sample rather than counted as orphans, so
// a permission answer can never be mistaken for a deleted listing in either direction.
const unreadableTables = new Set(unreadable.map((u) => u.split(/[ :]/)[0]));
const comparable = [...uniq.values()].filter((s) => !unreadableTables.has(s.source_table));
if (unreadable.length) console.log(`      unreadable (dropped from the sample): ${unreadable.join(' | ')}`);

const verdict = servedLeakVerdict(cutoff, comparable, raw);
if (verdict.kind === 'blind') {
  check('[B] SERVED PATH: the sample could be compared at all', false, verdict.why);
} else {
  check(`[B] SERVED PATH: every row the search returned is active=true in its own source table `
    + `(${verdict.inspected} rows, ${byTable.size} tables)`,
    verdict.kind === 'clean',
    verdict.kind === 'leaking'
      ? `${verdict.leaked.length} served row(s) are NOT alive at the source: `
        + `${JSON.stringify(verdict.leaked.slice(0, 5))}. This reading never touches `
        + 'active_listing_ids_v2, so it stands even when that matview is stale.'
      : '');
  check(`[B] the sample is big enough to mean something (${verdict.inspected} >= ${MIN_INSPECTED})`,
    verdict.inspected >= MIN_INSPECTED,
    'the served sample shrank — a green over a handful of rows is not the measurement this barrier '
    + 'claims to make');
  if (verdict.orphans.length) {
    console.log(`      NOTE ${verdict.orphans.length} served row(s) have no raw row at all — that is `
      + `orphan_after_delete (routine #11 barrier 9 / mon_detect_orphaned_search_row), not this kind: `
      + `${JSON.stringify(verdict.orphans.slice(0, 5))}`);
  }
}

console.log(failed
  ? `\n❌ verify-inactive-listing-is-not-searchable: ${failed} failure(s).`
  : '\n✅ verify-inactive-listing-is-not-searchable: no source-confirmed-dead listing is being served.');
process.exit(failed ? 1 : 0);
