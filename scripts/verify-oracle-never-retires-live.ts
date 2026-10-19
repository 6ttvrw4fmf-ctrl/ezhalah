// THE LIVE HALF: ASK PRODUCTION WHETHER ITS ORACLES CAN STILL RETIRE ANYTHING (routine #3, 2026-09-26).
//
// Its hermetic twin — scripts/verify-oracle-never-retires.ts — stays in the required `npm test` and
// mutation-proves oracleNeverRetires(), the judgement BOTH halves import. This file is the half
// whose verdict is decided by production's probe history, so it must never sit in the required
// per-PR suite (AGENTS.md, "The required suite is HERMETIC").
//
// It makes two calls and does three things with them:
//
//   1. DIFFERENTIAL   apply the SHARED TypeScript predicate to mon_oracle_retirement_facts() — the
//                     raw per-platform counts — and assert it names exactly the platforms the SQL
//                     function mon_oracle_never_retires() names. This is the anti-drift bond: two
//                     implementations of one rule, compared over the whole live fleet every run.
//                     Neither can quietly become the only one that is right.
//   2. LIVE MUTATION  re-ask with an absurd ask-floor. Nothing has been probed 10,000,000 times, so
//                     the answer MUST go empty. A rule that returned the same set regardless of its
//                     own threshold would pass (1) and be measuring nothing.
//   3. REPORT         print any platform whose oracle has never once answered. This is a finding to
//                     fix at the PROBE, never by lowering a floor or retiring the stranded rows.
//
// It is READ-ONLY. Both functions are `stable`, write nothing, and move no alert_event row — a CI
// run must not touch production's alert state, so it deliberately does NOT call the mon_detect_*
// raiser.
//
// MUTATION-PROOF-EXEMPT: this file has no judgement of its own. Every verdict it prints comes from
// oracleNeverRetires() in scripts/lib/oracleRetirement.ts, mutation-proven against nine broken
// worlds on every PR by the hermetic twin. Re-proving it here would need a COPY of that judgement,
// which is the drift class this split exists to avoid. What is left here is the HTTP call, and it
// fails CLOSED and loudly on any non-2xx: A FAILED FETCH IS NOT AN EMPTY ANSWER, and a coverage
// check that cannot reach its subject and reports "no gaps found" is a manufactured clean bill.
//
// Run: node --experimental-strip-types scripts/verify-oracle-never-retires-live.ts
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import { fetchRetryingSchemaCacheReload } from './lib/postgrestRetry.ts';
import {
  neverRetiringPlatforms,
  MIN_ASKS_FOR_JUDGEMENT,
  type PlatformOracleFacts,
} from './lib/oracleRetirement.ts';

const { url: URL_BASE, key: ANON_KEY } = resolvePublicSupabase();

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

async function rpc(fn: string, body: unknown): Promise<any[]> {
  const { status, ok, body: text } = await fetchRetryingSchemaCacheReload(
    `${URL_BASE}/rest/v1/rpc/${fn}`,
    {
      method: 'POST',
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
  // Three outcomes, never two. 404 means the migration has not been applied — a different repair,
  // but still a failure, never a skip.
  if (!ok) {
    throw new Error(
      status === 404
        ? `${fn} is not shipped (PGRST202) — apply the migration that creates it`
        : `${fn} unreachable: HTTP ${status} ${String(text).slice(0, 300)}`,
    );
  }
  const rows = JSON.parse(String(text));
  if (!Array.isArray(rows)) throw new Error(`${fn} returned a non-array payload`);
  return rows;
}

try {
  const factRows = await rpc('mon_oracle_retirement_facts', {});
  // An empty fact set is not a clean fleet: it means nothing could be graded. Fail closed.
  if (factRows.length === 0) {
    throw new Error(
      'mon_oracle_retirement_facts() returned NO rows — no oracle claim can be graded at all. ' +
        'That is unjudgeable, never clean; check the coverage snapshot job.',
    );
  }

  const facts: PlatformOracleFacts[] = factRows.map((r) => ({
    platform: String(r.platform),
    strategy: String(r.strategy),
    active: Number(r.active),
    asks: Number(r.asks),
    affirmative: Number(r.affirmative),
  }));

  // 1. DIFFERENTIAL — the shared predicate vs the live SQL, over the whole fleet.
  const fromPredicate = neverRetiringPlatforms(facts);
  const fromSql = (await rpc('mon_oracle_never_retires', {})).map((r) => String(r.platform)).sort();
  check(
    `SQL and the shared predicate agree over all ${facts.length} oracle-claiming platforms`,
    fromPredicate.join(',') === fromSql.join(','),
    `predicate: [${fromPredicate.join(', ')}]\n      SQL:       [${fromSql.join(', ')}]`,
  );

  // 2. LIVE MUTATION — the ask-floor must actually be consulted.
  const absurd = await rpc('mon_oracle_never_retires', { p_min_asks: 10_000_000 });
  check(
    'raising the ask floor to 10,000,000 empties the answer (the floor is load-bearing live)',
    absurd.length === 0,
    `still flagged: ${absurd.map((r) => String(r.platform)).join(', ')}`,
  );

  // 3. REPORT — the standing finding, if any.
  if (fromSql.length === 0) {
    console.log(`\nEvery oracle-claiming platform asked >= ${MIN_ASKS_FOR_JUDGEMENT} times has ` +
      'produced at least one affirmative (GONE or LIVE) verdict.');
  } else {
    console.log('\nORACLES THAT HAVE NEVER RETIRED ANYTHING — fix the PROBE, never the floor:');
    for (const f of facts.filter((x) => fromSql.includes(x.platform))) {
      console.log(
        `  ${f.platform.padEnd(16)} ${String(f.asks).padStart(6)} asks, ` +
          `${f.affirmative} affirmative, ${f.active} active listings`,
      );
    }
  }
} catch (err) {
  check('production is reachable and gradeable', false, (err as Error).message);
}

console.log(failed === 0 ? '\nOK' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
