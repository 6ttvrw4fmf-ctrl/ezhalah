// THE META-DETECTOR HAD NOTHING WATCHING IT FROM THE REPO SIDE (ops_incident #72, routine #10).
//
// AGENTS.md rests every claim of monitoring coverage on one sentence: "mon_detect_orphaned_detectors()
// fires on any detector nothing reaches, and a detector outside the roster is decoration." Twelve
// scripts/verify-* files name that function. Every one of those mentions is a comment or a string
// literal — nothing in this repo has ever EXECUTED it or asserted what it decides. That is the
// source-TEXT tripwire shape AGENTS.md warns about, sitting on the meta-layer, where it is most
// expensive: if the predicate silently stops discriminating, ~176 detectors read as wired forever.
//
// THE DB HALF (already live, migrations 20260906021124 + 20260906021216) split deciding from
// raising, so the decision can be executed against an injected candidate with no writes:
//
//   mon_orphaned_detectors(p_extra_candidates)   PURE, stable, writes nothing, anon-executable.
//                                                Injected names go through the SAME reachability
//                                                filter as the real mon_detect_* functions.
//   mon_detect_orphaned_detectors()              unchanged contract; now asks the above and raises.
//   mon_detect_orphan_detector_is_blind()        the in-database self-test, on the roster, every
//                                                half hour: both directions, P1 blind_guard.
//
// THIS FILE is the repo half the incident was actually about — the barrier that EXECUTES the
// predicate instead of grepping for its name. It calls the live production function three times
// through the anon path and judges the answers:
//
//   1. POSITIVE      inject a name reachable from NOTHING  -> must come back as an orphan.
//   2. NEGATIVE      inject the rostered self-test's name  -> must NOT come back. A predicate that
//                    flagged everything satisfies (1) and is just as useless; this also proves
//                    mon_detect_orphan_detector_is_blind() is itself still reachable, so the guard
//                    on the guard cannot go dark unnoticed.
//   3. STANDING      the bare call must be empty. AGENTS.md requires a new detector's roster entry
//                    in the SAME migration, so a non-empty answer is a real defect, not noise.
//
// SAFE IN A REQUIRED CHECK: three reads of a `stable` SECURITY DEFINER function that writes nothing.
// It deliberately does NOT call mon_detect_orphan_detector_is_blind() itself — that one raises and
// resolves real alert_event rows, and a CI run must not move production's alert state.
//
// KNOWN CEILING: if the self-test function were dropped from pg_proc while its roster entry stayed,
// check (2) still reads "reachable" and passes. That path is not silent — mon_run_all_detectors()
// then errors on the missing name and reports it in its `failed` list, which the sweep contract
// already watches. Widening this file to cover it would need a live reader for pg_proc that anon
// does not have; adding one is a bigger hole than the case it closes.
//
// Run: node --experimental-strip-types scripts/verify-orphaned-detector-meta-check.ts
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const { url: URL_BASE, key: ANON_KEY } = resolvePublicSupabase();
const RPC = `${URL_BASE}/rest/v1/rpc/mon_orphaned_detectors`;

/** A name no function, roster entry or cron command has ever carried. */
export const PROBE = 'mon_detect_zz_unreachable_barrier_probe';
/** The in-database self-test: on the roster since 20260906021124, therefore reachable. */
export const SELF_TEST = 'mon_detect_orphan_detector_is_blind';

export type OrphanAnswers = {
  /** mon_orphaned_detectors() — the standing verdict over the real roster. */
  bare: string[];
  /** mon_orphaned_detectors(array[PROBE]) */
  withProbe: string[];
  /** mon_orphaned_detectors(array[SELF_TEST]) */
  withSelfTest: string[];
};

/**
 * THE JUDGEMENT, lifted so a mutation can be handed to it. Returns one line per way the live
 * predicate has stopped being able to tell an orphan from a wired detector. Empty = healthy.
 */
export function blindnessOf(a: OrphanAnswers): string[] {
  const blind: string[] = [];
  if (!a.withProbe.includes(PROBE)) {
    blind.push(
      `an injected detector reachable from NOTHING (${PROBE}) was not reported as an orphan — ` +
        `mon_orphaned_detectors() can no longer see the thing it exists to notice, so every ` +
        `downstream claim that the other detectors are wired is unbacked`,
    );
  }
  if (a.withSelfTest.includes(SELF_TEST)) {
    blind.push(
      `${SELF_TEST} came back as an orphan. Either the predicate flags everything (which would ` +
        `satisfy the positive half and be just as useless), or the in-database self-test lost its ` +
        `roster entry and the guard on the guard is dark`,
    );
  }
  if (a.bare.length > 0) {
    blind.push(
      `${a.bare.length} detector(s) are reachable from neither mon_run_all_detectors nor a cron ` +
        `job, so they never run: ${a.bare.join(', ')}. AGENTS.md requires the roster entry in the ` +
        `SAME migration that adds the detector — needle-edited off the LIVE body, never pasted`,
    );
  }
  return blind;
}

async function orphans(extra?: string[]): Promise<string[]> {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(extra ? { p_extra_candidates: extra } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  if (!r.ok) {
    throw new Error(
      `mon_orphaned_detectors(${extra ? JSON.stringify(extra) : ''}) -> HTTP ${r.status}: ` +
        `${text.slice(0, 300)}. A barrier that cannot execute the predicate proves nothing, so this ` +
        `is RED, not a skip.`,
    );
  }
  const parsed: unknown = text ? JSON.parse(text) : null;
  if (!Array.isArray(parsed) || parsed.some((x) => typeof x !== 'string')) {
    throw new Error(`mon_orphaned_detectors() returned ${text.slice(0, 200)}, not a text[]`);
  }
  return parsed as string[];
}

// ── THE LIVE EXECUTION ──────────────────────────────────────────────────────────────────────────
const answers: OrphanAnswers = {
  bare: await orphans(),
  withProbe: await orphans([PROBE]),
  withSelfTest: await orphans([SELF_TEST]),
};

const blind = blindnessOf(answers);
for (const b of blind) console.error(`  FAIL  ${b}`);
if (blind.length === 0) {
  console.log(`  PASS  an unreachable injected detector is reported (${PROBE})`);
  console.log(`  PASS  the rostered self-test is NOT reported (${SELF_TEST})`);
  console.log('  PASS  0 standing orphans over the live roster');
}

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
// The judgement is fed the answer sets a broken predicate really would return. Without these, a
// blindnessOf() that returned [] would pass everything above and this file would be decoration.
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

console.log('\nMutation proofs\n');

mustCatch(
  'the predicate ignores p_extra_candidates (the "simplify the union away" edit) — injection is a no-op',
  blindnessOf({ bare: [], withProbe: [], withSelfTest: [] }).length > 0,
);
mustCatch(
  'the predicate flags EVERY candidate (an inverted or dropped reachability test)',
  blindnessOf({ bare: ['mon_detect_a', 'mon_detect_b'], withProbe: [PROBE], withSelfTest: [SELF_TEST] }).length > 0,
);
mustCatch(
  `${SELF_TEST} loses its roster entry — the guard on the guard goes dark`,
  blindnessOf({ bare: [SELF_TEST], withProbe: [PROBE, SELF_TEST], withSelfTest: [SELF_TEST] }).length > 0,
);
mustCatch(
  'a real detector is wired to nothing (a roster clobber, the class of the four past restores)',
  blindnessOf({
    bare: ['mon_detect_unverified_inactivation'],
    withProbe: [PROBE, 'mon_detect_unverified_inactivation'],
    withSelfTest: ['mon_detect_unverified_inactivation'],
  }).length > 0,
);
mustCatch(
  '…while the healthy shape is NOT reported as blind (the judgement is not vacuously red)',
  blindnessOf({ bare: [], withProbe: [PROBE], withSelfTest: [] }).length === 0,
);

const ok = blind.length === 0 && mutFail === 0;
console.log(
  ok
    ? '\n✓ mon_orphaned_detectors() still tells an orphan from a wired detector — executed live, both directions'
    : `\n✗ ${blind.length} live failure(s), ${mutFail} mutation(s) survived`,
);
process.exit(ok ? 0 : 1);
