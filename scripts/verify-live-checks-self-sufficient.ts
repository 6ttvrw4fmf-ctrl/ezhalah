// A SCHEDULED BARRIER MUST BE ABLE TO RUN. (2026-08-10 senior audit, run #8.)
//
// THE DEFECT THIS LOCKS OUT FOREVER: `.github/workflows/diversity-live-check.yml` and
// `district-suggestion-parity-live-check.yml` — the two LIVE behavioral barriers the owner asked for
// so a search regression "cannot silently break later" — had NEVER EXECUTED ONCE. Both pass
// `${{ secrets.EXPO_PUBLIC_SUPABASE_ANON_KEY }}`, that repo secret was never created, an unset
// secret expands to the EMPTY STRING, and each script's `if (!KEY) { SKIP-FAIL; exit(1) }` branch
// fired on every scheduled run since the day it shipped. Every run was red, so "red" carried no
// information — indistinguishable from the real regression the barrier exists to catch. The static
// half of each barrier kept passing in `npm test`, so nothing else noticed.
//
// The failure CLASS is "a guard whose ability to run depends on configuration nobody is watching".
// Fixing the two scripts is not enough — the next live barrier someone adds would repeat it. So this
// check DISCOVERS live-check scripts from the workflows themselves and proves each one can obtain a
// working PUBLIC endpoint with a hostile, Actions-shaped environment (every relevant var set to '').
//
// Hermetic: no network, no DB. Wired into `npm test`.
//   node --experimental-strip-types scripts/verify-live-checks-self-sufficient.ts

import { readFileSync, readdirSync } from 'node:fs';
import { resolvePublicSupabase, PUBLIC_SUPABASE_ANON_KEY } from './lib/public-supabase.ts';

let failed = 0;
const ok = (name: string) => console.log(`  ok    ${name}`);
const bad = (name: string, detail: string) => { failed++; console.log(`  FAIL  ${name}\n        ${detail}`); };

// ---------------------------------------------------------------------------
// 1. The resolver survives the exact environment GitHub Actions produces for an unset secret:
//    the variables are PRESENT and EMPTY, which `??` would happily accept.
// ---------------------------------------------------------------------------
console.log('\n1) resolver vs an Actions environment with unset secrets');
{
  const actionsEnvUnsetSecrets = {
    EXPO_PUBLIC_SUPABASE_URL: '',
    EXPO_PUBLIC_SUPABASE_ANON_KEY: '',
    EXPO_PUBLIC_SUPABASE_KEY: '',
  } as unknown as NodeJS.ProcessEnv;

  const r = resolvePublicSupabase(actionsEnvUnsetSecrets);
  if (r.key && r.key.length > 40) ok('empty-string secrets still yield a usable key');
  else bad('empty-string secrets still yield a usable key', `got key=${JSON.stringify(r.key)} — this is the exact never-runs bug`);

  if (/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(r.url)) ok(`empty-string secrets still yield a usable url (${r.url})`);
  else bad('empty-string secrets still yield a usable url', `got url=${JSON.stringify(r.url)}`);

  const empty = resolvePublicSupabase({} as NodeJS.ProcessEnv);
  if (empty.key && empty.url) ok('a completely empty environment still resolves');
  else bad('a completely empty environment still resolves', JSON.stringify(empty));
}

// ---------------------------------------------------------------------------
// 2. Environment still WINS — the fallback must not pin the barrier to production forever.
// ---------------------------------------------------------------------------
console.log('\n2) explicit environment overrides the committed fallback');
{
  const r = resolvePublicSupabase({
    EXPO_PUBLIC_SUPABASE_URL: 'https://example-branch.supabase.co',
    EXPO_PUBLIC_SUPABASE_ANON_KEY: 'branch-key-value',
  } as NodeJS.ProcessEnv);
  if (r.url === 'https://example-branch.supabase.co' && r.key === 'branch-key-value') ok('env wins over the fallback');
  else bad('env wins over the fallback', JSON.stringify(r));

  const alt = resolvePublicSupabase({ EXPO_PUBLIC_SUPABASE_KEY: 'preflight-named-key' } as NodeJS.ProcessEnv);
  if (alt.key === 'preflight-named-key') ok('EXPO_PUBLIC_SUPABASE_KEY (deploy-preflight name) is honoured');
  else bad('EXPO_PUBLIC_SUPABASE_KEY (deploy-preflight name) is honoured', JSON.stringify(alt));
}

// ---------------------------------------------------------------------------
// 3. The committed key is the ANON role — never the service role. These barriers assert production
//    behaviour through the path real clients hit; a privileged key would mask the very RLS and
//    permission regressions they exist to catch (and must never be committed at all).
// ---------------------------------------------------------------------------
console.log('\n3) the committed key is anon, not service_role');
{
  let role = '';
  try {
    role = JSON.parse(Buffer.from(PUBLIC_SUPABASE_ANON_KEY.split('.')[1], 'base64url').toString('utf8')).role;
  } catch (e) { bad('committed key decodes as a JWT', String(e)); }
  if (role === 'anon') ok('committed key carries role=anon');
  else bad('committed key carries role=anon', `role=${JSON.stringify(role)} — a non-anon key must NEVER be committed`);
}

// ---------------------------------------------------------------------------
// 4. Every live-check script a WORKFLOW schedules must be self-sufficient. Discovered from the
//    workflows, so a newly added barrier is covered the day it is added, not the day it is noticed.
// ---------------------------------------------------------------------------
console.log('\n4) every workflow-scheduled live check can obtain an endpoint without a secret');
{
  const wfDir = new URL('../.github/workflows/', import.meta.url);
  const referenced = new Set<string>();
  for (const f of readdirSync(wfDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))) {
    const body = readFileSync(new URL(f, wfDir), 'utf8');
    // `live` must be a HYPHEN/DOT-DELIMITED TOKEN, not a bare substring (2026-08-26).
    // The old pattern was `[A-Za-z0-9._-]*live[A-Za-z0-9._-]*\.ts`, which matches "de-LIVE-ry":
    // scripts/verify-alert-delivery-coverage.ts is a pure offline check with no Supabase call in
    // it, and was flagged as a live check that must use resolvePublicSupabase(). Left alone this
    // forces any future *delivery*/*deliverable* script to either take a misleading name or add
    // dead network code to satisfy a barrier it has nothing to do with.
    // Boundary chosen so every real live check still matches: verify-af-live-truth.ts,
    // verify-count-rpc-parity-live.ts, verify-district-suggestion-parity-live.ts,
    // verify-platform-diversity-live.ts, verify-recency-fallback-live.ts (all `-live`), and a
    // future verify-live-*.ts (start of name). §4a below pins both directions.
    for (const m of body.matchAll(/scripts\/((?:[A-Za-z0-9._-]*[.-])?live[A-Za-z0-9._-]*\.ts)/g)) referenced.add(m[1]);
  }

  if (referenced.size === 0) bad('live-check scripts discovered from workflows', 'found none — the discovery regex has drifted from the workflows');
  else ok(`discovered ${referenced.size} workflow-scheduled live check(s): ${[...referenced].join(', ')}`);

  // §4a — pin the token boundary in BOTH directions (2026-08-26). A regex that quietly stops
  // matching real live checks is the same failure this whole file exists to prevent, so widening
  // it back to a bare substring and narrowing it past the real names must both be caught here.
  {
    const DISCOVER = /scripts\/((?:[A-Za-z0-9._-]*[.-])?live[A-Za-z0-9._-]*\.ts)/g;
    const hit = (s: string) => { DISCOVER.lastIndex = 0; return DISCOVER.test(`scripts/${s}`); };
    const MUST_MATCH = [
      'verify-af-live-truth.ts',
      'verify-count-rpc-parity-live.ts',
      'verify-district-suggestion-parity-live.ts',
      'verify-platform-diversity-live.ts',
      'verify-recency-fallback-live.ts',
      'live-check.ts',
    ];
    const MUST_NOT_MATCH = [
      'verify-alert-delivery-coverage.ts', // "de-LIVE-ry": the 2026-08-26 false positive
      'verify-deliverable-report.ts',
      'verify-oblivest.ts',
    ];
    for (const n of MUST_MATCH) {
      if (hit(n)) ok(`§4a discovery still matches real live check ${n}`);
      else bad(`§4a discovery no longer matches ${n}`, 'the regex was narrowed too far — a real live check would go unchecked');
    }
    for (const n of MUST_NOT_MATCH) {
      if (!hit(n)) ok(`§4a discovery correctly ignores ${n}`);
      else bad(`§4a discovery falsely matches ${n}`, '"live" is being matched as a bare substring again, not as a name token');
    }
  }

  for (const script of [...referenced].sort()) {
    let src: string;
    try { src = readFileSync(new URL(`../scripts/${script}`, import.meta.url), 'utf8'); }
    catch { bad(script, 'referenced by a workflow but missing from scripts/'); continue; }

    if (!/resolvePublicSupabase\s*\(/.test(src)) {
      bad(script, 'does not use resolvePublicSupabase() — it can only run if a repo secret happens to be set, which is exactly how both barriers silently never ran');
      continue;
    }
    // The old shape: bail out when the env is missing. Any surviving copy re-opens the hole.
    const skipFail = src.match(/^.*SKIP-FAIL.*$/m);
    if (skipFail) bad(script, `still has a SKIP-FAIL bail-out: ${skipFail[0].trim().slice(0, 120)}`);
    else ok(`${script} resolves its endpoint without depending on a repo secret`);
  }
}

console.log(failed === 0
  ? '\n✓ every scheduled live barrier can actually run.\n'
  : `\n✗ ${failed} check(s) failed — a scheduled barrier that cannot run protects nothing.\n`);
process.exit(failed === 0 ? 0 : 1);
