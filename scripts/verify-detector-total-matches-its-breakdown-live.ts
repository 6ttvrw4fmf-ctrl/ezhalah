// A DETECTOR MAY NOT THRESHOLD ONE NUMBER AND PUBLISH ANOTHER.
//
// THE CONTRACT. When a detector payload carries BOTH a scalar total AND a `by_*` breakdown of the
// same population, the total must equal the sum of the breakdown. They describe one set; if they
// disagree, at most one of them is the number the alert thresholds are written against — and the
// other one is what a human reads when deciding whether the system is healthy.
//
// THE DEFECT (P1, incident #36, found 2026-09-05 by routine #9). `price_fidelity()` returned:
//
//     { "mismatches": 2, "by_platform": { "gathern": 1561, "mustqr": 2 }, ... }
//
// because the total was taken over the GROUPED derived table:
//
//     select count(*), jsonb_object_agg(platform, cnt)
//       into v_mismatch, v_by_platform
//       from (select platform, count(*) cnt from mm group by platform) q;
//
// so `mismatches` counted PLATFORMS, not rows. `mon_detect_price_fidelity()` thresholds that value
// at `> 250 → P1` and `> 25 → P2` — unmistakably row-scale numbers. With ~34 platforms in the fleet
// the P1 arm was mathematically unreachable and P2 needed 26 platforms drifting at once, so the
// detector had raised ZERO `price_drift` alerts in its entire life while 1,562 rows were serving a
// price the card does not show. A count that is not its own set, inside the very thing built to
// notice that class.
//
// WHY THIS IS A CLASS BARRIER AND NOT A `price_fidelity` TEST. The shape — an aggregate computed one
// way and published another way beside it — has nothing to do with prices. Any detector that
// summarises a population two ways can carry it, and the disagreement is invisible from either
// number alone: you have to hold both at once, which is exactly what nothing did.
//
// WHY IT IS LIVE. The two numbers only exist together in a payload the production function returns.
// A source-text reading of the SQL would prove a string is present, never that the numbers agree —
// and this repo has been burned by that shape often enough to have a name for it. So this executes
// the REAL production function, through the publishable (anon) key, and compares what it actually
// returned. Excluded from `npm test` for the reason every live check is: production being
// momentarily unhealthy must not fail an unrelated PR.
//
// WATCHED TO FAIL AGAINST THE REAL DEFECT, not only against a synthetic one. At 2026-09-05T05:32Z
// this check ran against production carrying the live drift and printed
// «FAIL LIVE price_fidelity(): mismatches (2) == sum(by_platform) (1563)»; at 05:53Z, after the
// 1,562 rows were repaired, the same code printed «PASS … (0) == (0)». Both directions, on the real
// thing — which is the one form of mutation proof a synthetic payload cannot give.
//
// WHAT THIS DOES **NOT** PROVE, stated here so nobody reads a green run as more than it is. This is
// a MONITOR for the live condition, not a proof about the SQL. `price_fidelity()`'s total is still
// `count(*)` over a GROUP BY as of 2026-09-05; when the mismatch population is empty the total and
// the breakdown are both 0 and agree trivially, so this check goes GREEN over the unfixed shape. It
// fires again the moment any platform drifts — which is when the number matters — but the structural
// repair is ops_incident #36 (count the rows: `sum(cnt)` over the grouped table, or `count(*)` over
// `mm` before the group by), and closing #36 is what makes the class impossible rather than merely
// observed. Do not resolve #36 on the strength of a green run here.
//
//   node --experimental-strip-types scripts/verify-detector-total-matches-its-breakdown-live.ts

// resolvePublicSupabase(), NOT a hand-rolled process.env read with a literal fallback — caught by
// scripts/verify-live-checks-self-sufficient.ts on this file's first scheduled run, whose message
// names the exact history: a live barrier that reaches for a repo secret directly "can only run if
// a repo secret happens to be set, which is exactly how both barriers silently never ran". The
// shared resolver is what makes a scheduled live check self-sufficient.
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const { url: SUPA, key: KEY } = resolvePublicSupabase();

/** Detector functions whose payload carries a total beside a breakdown. Anon-callable, read-only. */
const DETECTORS = ['price_fidelity'];

/** Scalar keys that name "how many of the thing the breakdown breaks down". */
const TOTAL_KEYS = ['mismatches', 'total', 'rows', 'count', 'violations', 'affected'];

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failed++;
};

// ── THE PREDICATE, stated once so the mutations below exercise THIS rule and not a copy of it ────
export type Verdict =
  | { kind: 'agrees'; totalKey: string; breakdownKey: string; total: number; sum: number }
  | { kind: 'disagrees'; totalKey: string; breakdownKey: string; total: number; sum: number }
  | { kind: 'unpairable'; why: string };

/**
 * Hold the two summaries of one population side by side.
 *
 * Deliberately returns `unpairable` rather than `agrees` when it cannot find exactly one total and
 * exactly one numeric breakdown. A check that goes quiet on what it does not understand reads as
 * protection while protecting nothing — the caller PRINTS every unpairable payload, so a detector
 * that stops publishing its breakdown becomes visible instead of becoming green.
 */
export function totalAgreesWithBreakdown(payload: unknown): Verdict {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { kind: 'unpairable', why: 'payload is not an object' };
  }
  const p = payload as Record<string, unknown>;
  const breakdowns = Object.entries(p).filter(([k, v]) =>
    /^by_/.test(k) && !!v && typeof v === 'object' && !Array.isArray(v));
  if (breakdowns.length !== 1) {
    return { kind: 'unpairable', why: `${breakdowns.length} by_* breakdown objects (need exactly 1)` };
  }
  const [breakdownKey, rawBreakdown] = breakdowns[0];
  const values = Object.values(rawBreakdown as Record<string, unknown>);
  // An EMPTY breakdown is the healthy state, not an unreadable one: nothing is wrong, so nothing
  // breaks down. The invariant still binds — the total must be 0 — which is what catches «7
  // mismatches and no breakdown». Reporting the clean case as unreadable would make this check red
  // on every healthy system, and a barrier that cries wolf is one people learn to route around.
  if (!values.length) {
    const t = TOTAL_KEYS.filter((k) => typeof p[k] === 'number' && Number.isFinite(p[k] as number));
    if (t.length !== 1) return { kind: 'unpairable', why: `${breakdownKey} is empty and ${t.length} candidate total keys` };
    const tv = p[t[0]] as number;
    return { kind: tv === 0 ? 'agrees' : 'disagrees', totalKey: t[0], breakdownKey, total: tv, sum: 0 };
  }
  if (!values.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return { kind: 'unpairable', why: `${breakdownKey} holds non-numeric values` };
  }
  const totals = TOTAL_KEYS.filter((k) => typeof p[k] === 'number' && Number.isFinite(p[k] as number));
  if (totals.length !== 1) {
    return { kind: 'unpairable', why: `${totals.length} candidate total keys (${TOTAL_KEYS.join('|')}); need exactly 1` };
  }
  const totalKey = totals[0];
  const total = p[totalKey] as number;
  const sum = (values as number[]).reduce((a, b) => a + b, 0);
  return { kind: total === sum ? 'agrees' : 'disagrees', totalKey, breakdownKey, total, sum };
}

// ── MUTATIONS — both directions, so neither a vacuous green nor a vacuous red can pass for proof ──
const mustCatch = (what: string, caught: boolean) => check(`MUTATION: catches ${what}`, caught);
const disagrees = (p: unknown) => totalAgreesWithBreakdown(p).kind === 'disagrees';
const unpairable = (p: unknown) => totalAgreesWithBreakdown(p).kind === 'unpairable';

// The real payload, verbatim as production returned it on 2026-09-05T05:29:47Z.
const THE_DEFECT = { mismatches: 2, by_platform: { gathern: 1561, mustqr: 2 }, sync_recent: true };
mustCatch('the price_fidelity defect verbatim (a platform count thresholded as a row count)',
  disagrees(THE_DEFECT));
// …and the SAME payload with the total corrected must go green, or the check above proves nothing.
mustCatch('nothing — the corrected payload (mismatches = 1563) is not flagged',
  !disagrees({ ...THE_DEFECT, mismatches: 1563 }));
// A healthy zero state is the everyday case and must never be a false alarm.
mustCatch('nothing — a clean detector (0 mismatches, 0 in the breakdown) is not flagged',
  !disagrees({ mismatches: 0, by_platform: { gathern: 0 } }));
// The direction that matters least often and hurts most: a total LARGER than its parts.
mustCatch('a total larger than the sum of its parts (double counting)',
  disagrees({ total: 40, by_platform: { a: 10, b: 10 } }));
// A subtle one-off: exactly the shape a `> n` boundary error produces.
mustCatch('an off-by-one between the total and its breakdown',
  disagrees({ mismatches: 1562, by_platform: { gathern: 1561, mustqr: 2 } }));
// The empty breakdown, BOTH directions. Clean is clean; a total with nothing behind it is not.
// Written after this check reported the healthy 2026-09-05T05:52 state (0 / {}) as unreadable and
// went red on a production that was, at that moment, correct — the false-RED twin of what it hunts.
mustCatch('a total with an EMPTY breakdown behind it (7 mismatches, nothing broke them down)',
  disagrees({ mismatches: 7, by_platform: {} }));
mustCatch('nothing — the healthy zero state (0 mismatches, empty breakdown) is not flagged',
  !disagrees({ mismatches: 0, by_platform: {} }) && !unpairable({ mismatches: 0, by_platform: {} }));
mustCatch('a non-numeric breakdown as UNPAIRABLE', unpairable({ mismatches: 7, by_platform: { a: 'lots' } }));
mustCatch('a payload with no total key at all as UNPAIRABLE', unpairable({ by_platform: { a: 1 } }));
mustCatch('two competing total keys as UNPAIRABLE', unpairable({ mismatches: 3, total: 9, by_platform: { a: 3 } }));
mustCatch('a payload with no breakdown at all as UNPAIRABLE', unpairable({ mismatches: 3 }));

// ── LIVE — the real production function, through the publishable key ─────────────────────────────
for (const fn of DETECTORS) {
  let payload: unknown;
  try {
    const r = await fetch(`${SUPA}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
    payload = await r.json();
  } catch (e) {
    // A live check that cannot reach production has proven NOTHING. Say so and fail — it is out of
    // `npm test` precisely so this cannot redden an unrelated PR.
    check(`LIVE ${fn}(): reachable`, false, `${String(e).split('\n')[0]} — UNREACHABLE, so nothing below was tested`);
    continue;
  }
  const v = totalAgreesWithBreakdown(payload);
  if (v.kind === 'unpairable') {
    check(`LIVE ${fn}(): total and breakdown are comparable`, false,
      `${v.why} — this detector publishes a summary nothing can check; either give it one total and one by_* breakdown, or take the breakdown out`);
  } else {
    check(`LIVE ${fn}(): ${v.totalKey} (${v.total}) == sum(${v.breakdownKey}) (${v.sum})`, v.kind === 'agrees',
      `the number the alert thresholds are written against is not the number the payload publishes; `
      + `at most one of them describes the real population`);
  }
}

console.log(failed
  ? `\n❌ verify-detector-total-matches-its-breakdown-live: ${failed} failure(s).`
  : '\n✅ verify-detector-total-matches-its-breakdown-live: every detector total equals the breakdown it publishes.');
process.exit(failed ? 1 : 0);
