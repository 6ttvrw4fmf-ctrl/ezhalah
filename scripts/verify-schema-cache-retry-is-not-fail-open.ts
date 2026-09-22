// THE RETRY THAT MUST NEVER BECOME A SHRUG (ops_incident #573).
//
// scripts/lib/postgrestRetry.ts lets the four live required checks survive a PostgREST schema-cache
// reload (HTTP 503 / code PGRST002) instead of reddening every open PR in the repo while a migration
// applies. A retry is the single easiest way to turn a fail-CLOSED check into a fail-OPEN one, and
// BARRIER_ENGINEER.md Prohibition 1 forbids exactly that, so the driver is not trusted — it is
// EXECUTED here against every near-miss of the condition it is allowed to retry.
//
// The two directions this proves, in the words of the rule:
//   POSITIVE — the one real transient IS absorbed, so the repair is not vacuous.
//   NEGATIVE — every other failure is returned on the FIRST attempt, unretried and still not-ok;
//              and even an unbroken run of the transient is BOUNDED and ends RED.
//
// The trap that gets this wrong in review is `body.includes('PGRST002')`. That is fail-open: a
// genuine error quoting the code in its message — or a row of real data containing it — would be
// retried and could be masked. Proof 5 below plants exactly that body and requires a refusal.
//
// Run: node --experimental-strip-types scripts/verify-schema-cache-retry-is-not-fail-open.ts
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isSchemaCacheReload,
  retryingSchemaCacheReload,
  DEFAULT_RETRY,
  SCHEMA_CACHE_RELOAD,
  type Probe,
  type RetryOpts,
} from './lib/postgrestRetry.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`  PASS  ${label}`); return; }
  failures++;
  console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const mustCatch = (label: string, caught: boolean) => check(`refuses to retry: ${label}`, caught);

// THE REAL BODY, copied verbatim from the measured failure in ops_incident #573 — production's own
// wording, not one this barrier invented. (BARRIER_ENGINEER.md R1: a proof that supplies its own
// input proves nothing.)
const REAL_RELOAD_BODY =
  '{"code":"PGRST002","details":null,"hint":null,"message":"Could not query the database for the schema cache. Retrying."}';

const probe = (status: number, body: string): Probe =>
  ({ status, ok: status >= 200 && status < 300, body, headers: new Headers() });

/** A scripted `once` that records how many attempts were actually taken. */
function scripted(seq: Probe[]) {
  const taken: Probe[] = [];
  return {
    taken,
    once: async () => {
      const p = seq[Math.min(taken.length, seq.length - 1)];
      taken.push(p);
      return p;
    },
  };
}

/** Test options: same shape, same bound, but no real time passes. */
const FAST: RetryOpts = { attempts: 5, delayMs: () => 0, sleep: async () => {} };

console.log('\n1. THE CLASSIFIER — only the one self-describing transient\n');

check('the real measured production body IS a schema-cache reload (the repair is not vacuous)',
  isSchemaCacheReload(503, REAL_RELOAD_BODY));

mustCatch('a 503 with no `code` field at all',
  !isSchemaCacheReload(503, '{"message":"Service Unavailable"}'));
mustCatch('a 503 carrying a DIFFERENT PostgREST code (PGRST301, JWT expired)',
  !isSchemaCacheReload(503, '{"code":"PGRST301","message":"JWT expired"}'));
mustCatch(
  'a 503 whose MESSAGE TEXT merely mentions PGRST002 while its code is something else — ' +
    'the `body.includes()` trap, which would be fail-OPEN',
  !isSchemaCacheReload(503, '{"code":"PGRST100","message":"parse error, unlike PGRST002 this is permanent"}'));
mustCatch('a 503 whose body is not JSON at all (an HTML gateway page)',
  !isSchemaCacheReload(503, '<html><body>503 Service Unavailable PGRST002</body></html>'));
mustCatch('a 503 whose body is a JSON ARRAY of real rows that happen to contain the code',
  !isSchemaCacheReload(503, '[{"code":"PGRST002"}]'));
mustCatch('a 500 carrying the reload code — a different status is judged on its own terms',
  !isSchemaCacheReload(500, REAL_RELOAD_BODY));
mustCatch('a 401 (the anon key really was rotated — this must stay instantly RED)',
  !isSchemaCacheReload(401, '{"message":"Invalid API key"}'));
mustCatch('a 404 (the RPC was renamed or dropped)',
  !isSchemaCacheReload(404, '{"code":"PGRST202","message":"Could not find the function"}'));
mustCatch('an empty body',
  !isSchemaCacheReload(503, ''));

console.log('\n2. THE DRIVER — absorbs that one state, retries nothing else\n');

{
  const s = scripted([probe(503, REAL_RELOAD_BODY), probe(200, '[]')]);
  const got = await retryingSchemaCacheReload(s.once, FAST);
  check('a reload followed by success returns the SUCCESS (ops_incident #573 is actually repaired)',
    got.ok && got.status === 200 && s.taken.length === 2, `took ${s.taken.length}, got ${got.status}`);
}

for (const [label, p] of [
  ['a genuine 503 with no code', probe(503, '{"message":"down"}')],
  ['a 500', probe(500, REAL_RELOAD_BODY)],
  ['a 401', probe(401, '{"message":"Invalid API key"}')],
  ['a 404', probe(404, '{"code":"PGRST202"}')],
] as const) {
  const s = scripted([p, probe(200, '[]')]);
  const got = await retryingSchemaCacheReload(s.once, FAST);
  check(`${label} is returned on the FIRST attempt, unretried and still not-ok`,
    s.taken.length === 1 && !got.ok && got.status === p.status,
    `took ${s.taken.length} attempt(s), returned ${got.status} ok=${got.ok}`);
}

console.log('\n3. BOUNDEDNESS — an unbroken reload still ends RED\n');

{
  const s = scripted([probe(503, REAL_RELOAD_BODY)]);
  const got = await retryingSchemaCacheReload(s.once, FAST);
  check('a reload that NEVER clears exhausts the budget and returns not-ok (never a synthesised pass)',
    !got.ok && got.status === 503 && s.taken.length === FAST.attempts,
    `took ${s.taken.length} of ${FAST.attempts}, returned ok=${got.ok}`);
}
{
  const s = scripted([probe(503, REAL_RELOAD_BODY)]);
  await retryingSchemaCacheReload(s.once, { ...FAST, attempts: 1 });
  check('attempts:1 disables retrying entirely (the bound is honoured at its floor)',
    s.taken.length === 1, `took ${s.taken.length}`);
}
check('the shipped default budget is finite and small (a bound nobody can quietly remove)',
  Number.isFinite(DEFAULT_RETRY.attempts) && DEFAULT_RETRY.attempts >= 2 && DEFAULT_RETRY.attempts <= 8,
  `attempts=${DEFAULT_RETRY.attempts}`);
check('the shipped default backoff is finite at every step within the budget',
  Array.from({ length: DEFAULT_RETRY.attempts }, (_, i) => DEFAULT_RETRY.delayMs(i + 1))
    .every((d) => Number.isFinite(d) && d >= 0 && d <= 30000));

console.log('\n4. NO PATH TURNS A FAILURE INTO A PASS\n');

// The structural guarantee the whole repair rests on: every value this driver returns is a probe
// `once` really produced. Exhaustively over a scripted run, the returned probe must be identical to
// the last attempt taken — never merged, defaulted or synthesised.
{
  let identical = true;
  for (const seq of [
    [probe(503, REAL_RELOAD_BODY)],
    [probe(503, REAL_RELOAD_BODY), probe(503, '{"message":"down"}')],
    [probe(503, REAL_RELOAD_BODY), probe(200, '[]')],
    [probe(418, 'teapot')],
    [probe(200, '[]')],
  ]) {
    const s = scripted(seq);
    const got = await retryingSchemaCacheReload(s.once, FAST);
    if (got !== s.taken[s.taken.length - 1]) identical = false;
  }
  check('the driver always returns the LAST probe actually taken, by identity — it cannot synthesise one',
    identical);
}
{
  // The only claim that matters to a caller: ok is never invented.
  const s = scripted([probe(503, REAL_RELOAD_BODY)]);
  const got = await retryingSchemaCacheReload(s.once, FAST);
  check('`ok` is false whenever every attempt was not-ok (the caller keeps its original verdict)',
    got.ok === false && s.taken.every((t) => !t.ok));
}

console.log('\n5. WIRING\n');

check('this check runs in `npm test` (npmTestRuns, never a grep over package.json)',
  npmTestRuns(ROOT, 'verify-schema-cache-retry-is-not-fail-open'));
check(`the retried code is pinned to the one constant (${SCHEMA_CACHE_RELOAD})`,
  SCHEMA_CACHE_RELOAD === 'PGRST002');

console.log(failures === 0
  ? '\n✅ the schema-cache retry absorbs exactly one self-describing transient and weakens nothing else'
  : `\n❌ ${failures} failure(s) — the retry is not provably fail-closed`);
process.exit(failures === 0 ? 0 : 1);
