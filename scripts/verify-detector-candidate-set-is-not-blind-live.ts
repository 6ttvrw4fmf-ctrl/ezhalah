// THE LIVE HALF: EXECUTE THE CANDIDATE-SET GUARD AGAINST PRODUCTION (ops_incident #391, routine #10).
//
// Its hermetic twin — scripts/verify-detector-candidate-set-is-not-blind.ts — stays in the required
// `npm test` and mutation-proves candidateSetBlindness(), the judgement BOTH halves import. This file
// is the half whose verdict is decided by production's detector population, so it must never sit in
// the required per-PR suite: PRODUCTION_DEPENDENT_CEILING is a shrink-only ratchet and growing it is
// the weakening routine #10 is forbidden to do (AGENTS.md, "The required suite is HERMETIC").
//
// It calls the live function three times through the ANON path and judges the answers:
//
//   1. STANDING   the bare call must be empty. 239 of 239 mon_detect_* functions were inside the
//                 candidate set when this landed; a non-empty answer means a detector has left the
//                 population and mon_detect_unresolvable_detector() no longer examines it.
//   2. POSITIVE   inject a detector that raises through a WRAPPER -> must be reported as outside.
//   3. NEGATIVE   inject a detector that raises directly          -> must NOT be reported. A filter
//                 that flagged everything satisfies (2) and is just as useless.
//
// SAFE TO RUN ANYWHERE: mon_detectors_outside_raise_candidate_set() is `stable`, writes nothing, and
// returns only function names. It deliberately does NOT call mon_detect_unresolvable_detector()
// itself — that one raises and resolves real alert_event rows, and a CI run must not move
// production's alert state.
//
// MUTATION-PROOF-EXEMPT: this file has no judgement of its own to mutate. Every verdict it prints
// comes from candidateSetBlindness() in scripts/lib/candidateSetBlindness.ts, which is
// mutation-proven against five broken inputs — including the #391 defect itself — on every PR by
// the hermetic twin scripts/verify-detector-candidate-set-is-not-blind.ts. Re-proving it here would
// require a COPY of that judgement, which is the drift class this split exists to avoid. What is
// left in this file is the HTTP call, and it fails CLOSED and loudly on any non-2xx (A FAILED FETCH
// IS NOT AN EMPTY ANSWER). The live directions ARE exercised on every run, against production, by
// the two injected candidates below — a green run here has already watched the guard report the
// wrapper-raiser and stay silent on the direct raiser.
//
// Run: node --experimental-strip-types scripts/verify-detector-candidate-set-is-not-blind-live.ts
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import { fetchRetryingSchemaCacheReload } from './lib/postgrestRetry.ts';
import {
  candidateSetBlindness,
  DIRECT_RAISER,
  WRAPPER_RAISER,
  type CandidateSetAnswers,
  type InjectedSource,
} from './lib/candidateSetBlindness.ts';

const { url: URL_BASE, key: ANON_KEY } = resolvePublicSupabase();
const RPC = `${URL_BASE}/rest/v1/rpc/mon_detectors_outside_raise_candidate_set`;

async function outside(extra?: InjectedSource[]): Promise<string[]> {
  // ONE transient schema-cache reload is absorbed and nothing else (ops_incident #573); every other
  // failure still fails on the first attempt.
  const { status, ok, body: text } = await fetchRetryingSchemaCacheReload(RPC, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(extra ? { p_extra_sources: extra } : {}),
    signal: AbortSignal.timeout(20000),
  });
  if (!ok) {
    // A FAILED FETCH IS NOT AN EMPTY ANSWER. An unreachable guard proves nothing, so this is RED.
    throw new Error(
      `mon_detectors_outside_raise_candidate_set(${extra ? JSON.stringify(extra.map((e) => e.name)) : ''})` +
        ` -> HTTP ${status}: ${text.slice(0, 300)}`,
    );
  }
  const parsed: unknown = text ? JSON.parse(text) : null;
  if (!Array.isArray(parsed) || parsed.some((x) => typeof x !== 'string')) {
    throw new Error(
      `mon_detectors_outside_raise_candidate_set() returned ${text.slice(0, 200)}, not a text[]`,
    );
  }
  return parsed as string[];
}

console.log('\nNo detector has left the raise candidate set (ops_incident #391)\n');

const answers: CandidateSetAnswers = {
  bare: await outside(),
  withWrapperRaiser: await outside([WRAPPER_RAISER]),
  withDirectRaiser: await outside([DIRECT_RAISER]),
};

const blind = candidateSetBlindness(answers);
for (const b of blind) console.error(`  FAIL  ${b}`);
if (blind.length === 0) {
  console.log(`  PASS  a wrapper-raising detector is reported as outside (${WRAPPER_RAISER.name})`);
  console.log(`  PASS  a directly-raising detector is NOT reported (${DIRECT_RAISER.name})`);
  console.log('  PASS  0 real detectors outside the candidate set');
}

console.log(
  blind.length === 0
    ? '\n✓ mon_detect_unresolvable_detector() still examines every detector in production'
    : `\n✗ ${blind.length} live failure(s)`,
);
process.exit(blind.length === 0 ? 0 : 1);
