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

import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve as resolvePath, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
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
// Transitive import-graph helpers (2026-09-01, reviewer-proven gap). `touchesSupabase` used to be
// `/supabase/i.test(src)` against the CHECKED FILE'S OWN TEXT ONLY. A script that imports a wrapper
// which itself re-exports resolvePublicSupabase (e.g. `import { getEndpoint } from
// './lib/db-endpoint-wrapper.ts'`) never has the literal word "supabase" in its own source, so the
// old check reported "needs no Supabase secret at all" and skipped it entirely — the exact
// "barrier reads text, not the real code path" failure class this project has been burned by
// before. Fix: recursively resolve every LOCAL (`./`/`../`) import a script makes and look at the
// real graph, not a substring of one file. Bounded and shallow on purpose — this repo never needs
// to chase into node_modules to answer "does this touch Supabase".
// ---------------------------------------------------------------------------
const RESOLVER_MODULE_PATH = fileURLToPath(new URL('./lib/public-supabase.ts', import.meta.url));
const LOCAL_IMPORT_RE = /\b(?:from|import)\s*\(?\s*['"](\.\.?\/[^'"]+)['"]/g;
const MAX_CLOSURE_FILES = 200; // ponytail: bounded fan-out guard; raise if a real live check legitimately needs a deeper local import tree

function resolveImportPath(fromFile: string, specifier: string): string | null {
  const base = resolvePath(dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// BFS over local imports starting at entryFile. Returns absolutePath -> source for every file
// reached, including entryFile itself (missing entirely if entryFile can't be read).
function collectImportClosure(entryFile: string): Map<string, string> {
  const files = new Map<string, string>();
  const stack = [entryFile];
  while (stack.length && files.size < MAX_CLOSURE_FILES) {
    const file = stack.pop()!;
    if (files.has(file)) continue;
    let src: string;
    try { src = readFileSync(file, 'utf8'); } catch { continue; }
    files.set(file, src);
    for (const m of src.matchAll(LOCAL_IMPORT_RE)) {
      const resolved = resolveImportPath(file, m[1]);
      if (resolved && !files.has(resolved)) stack.push(resolved);
    }
  }
  return files;
}

// A literal, precise signal that a file talks to Supabase directly — a real host or the known raw
// env var names, NOT the bare word "supabase" (which also shows up in innocent prose comments like
// "see supabase/migrations/..." — src/lib/afCohorts.ts has exactly that, and it must NOT flip a
// script that never touches Supabase into looking gated).
const RAW_SUPABASE_SIGNAL =
  /supabase\.(?:co|io)\b|@supabase\/supabase-js|\bEXPO_PUBLIC_SUPABASE_(?:URL|ANON_KEY|KEY)\b|\bSUPABASE_(?:URL|ANON_KEY|SERVICE_ROLE_KEY)\b/i;

function classifyLiveCheck(entryFile: string): {
  missing: boolean;
  touchesSupabase: boolean;
  importsResolver: boolean;
  skipFailMatch: string | null;
  fileCount: number;
} {
  const closure = collectImportClosure(entryFile);
  if (!closure.has(entryFile)) {
    return { missing: true, touchesSupabase: false, importsResolver: false, skipFailMatch: null, fileCount: 0 };
  }

  // Structural: does ANY file in the closure hold an import specifier that resolves to the
  // sanctioned resolver module? This survives renaming/aliasing (`export { resolvePublicSupabase
  // as getEndpoint }`) because it compares resolved FILE PATHS, not identifier text.
  let importsResolver = false;
  for (const [file, text] of closure) {
    if (file === RESOLVER_MODULE_PATH) continue;
    for (const m of text.matchAll(LOCAL_IMPORT_RE)) {
      if (resolveImportPath(file, m[1]) === RESOLVER_MODULE_PATH) { importsResolver = true; break; }
    }
    if (importsResolver) break;
  }

  // Raw signal: excludes the resolver module's OWN file, which legitimately names the host and the
  // env vars it reads as fallbacks — that is not evidence of a SCRIPT bypassing it.
  let rawSupabaseSignal = false;
  for (const [file, text] of closure) {
    if (file === RESOLVER_MODULE_PATH) continue;
    if (RAW_SUPABASE_SIGNAL.test(text)) { rawSupabaseSignal = true; break; }
  }

  // Excludes the resolver module's own file, whose header comment quotes the historical
  // "SKIP-FAIL: ..." bail-out text as documentation of the bug this file fixed — not a live
  // bail-out in the SCRIPT being checked.
  let skipFailMatch: string | null = null;
  for (const [file, text] of closure) {
    if (file === RESOLVER_MODULE_PATH) continue;
    const m = text.match(/^.*SKIP-FAIL.*$/m);
    if (m) { skipFailMatch = m[0]; break; }
  }

  return {
    missing: false,
    touchesSupabase: importsResolver || rawSupabaseSignal,
    importsResolver,
    skipFailMatch,
    fileCount: closure.size,
  };
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
    const entryFile = fileURLToPath(new URL(`../scripts/${script}`, import.meta.url));
    const result = classifyLiveCheck(entryFile);
    if (result.missing) { bad(script, 'referenced by a workflow but missing from scripts/'); continue; }

    // A script needs resolvePublicSupabase() (anywhere in its LOCAL import graph, not just its own
    // text) only if it talks to Supabase at all — that is the ONLY way an unset repo secret can
    // silently gate it (2026-09-01: verify-frontend-bundle-matches-source-live.ts hits nothing but
    // the public production website over plain HTTPS; it cannot be affected by a missing SUPABASE
    // secret because it never reads one, so requiring the resolver from it would be a dead import
    // satisfying a check it has nothing to do with — the same shape §4a's "de-LIVE-ry" fix already
    // rejected for the discovery regex).
    if (result.touchesSupabase && !result.importsResolver) {
      bad(script, `talks to Supabase but does not use resolvePublicSupabase() anywhere in its import graph (${result.fileCount} local file(s) checked) — it can only run if a repo secret happens to be set, which is exactly how both barriers silently never ran`);
      continue;
    }
    // The old shape: bail out when the env is missing. Any surviving copy re-opens the hole —
    // checked across the whole graph so a wrapper can't hide one either.
    if (result.skipFailMatch) bad(script, `still has a SKIP-FAIL bail-out: ${result.skipFailMatch.trim().slice(0, 120)}`);
    else if (result.touchesSupabase) ok(`${script} resolves its endpoint without depending on a repo secret (${result.fileCount} local file(s) in its import graph)`);
    else ok(`${script} needs no Supabase secret at all — cannot be gated by one being unset`);
  }
}

// ---------------------------------------------------------------------------
// 5. Regression-pin the exact reviewer-proven gap (2026-09-01): a script hiding its Supabase access
//    behind ONE layer of local indirection must still be classified correctly — for the resolver
//    it must be recognised as touching Supabase via the sanctioned resolver, and for a raw env-var
//    read it must still fail closed. Built from real files on disk (not inline strings matched
//    against a copy of the logic) so this exercises the SAME collectImportClosure/classifyLiveCheck
//    the real check above runs.
// ---------------------------------------------------------------------------
console.log('\n5) transitive detection survives one layer of local import indirection');
{
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const fixtureDir = mkdtempSync(join(scriptsDir, '.self-check-fixture-'));
  try {
    const resolverSpecifier = (() => {
      const rel = relative(fixtureDir, RESOLVER_MODULE_PATH).split(sep).join('/');
      return rel.startsWith('.') ? rel : `./${rel}`;
    })();

    const goodEntry = join(fixtureDir, 'verify-fixture-good-live.ts');
    writeFileSync(join(fixtureDir, 'wrapper.ts'), `export { resolvePublicSupabase as getEndpoint } from '${resolverSpecifier}';\n`);
    writeFileSync(goodEntry, `import { getEndpoint } from './wrapper.ts';\nconst { url, key } = getEndpoint(process.env);\nvoid url; void key;\n`);

    const badEntry = join(fixtureDir, 'verify-fixture-bad-live.ts');
    writeFileSync(join(fixtureDir, 'bad-wrapper.ts'), `export function getEndpoint(env: NodeJS.ProcessEnv) {\n  return { url: env.EXPO_PUBLIC_SUPABASE_URL, key: env.EXPO_PUBLIC_SUPABASE_ANON_KEY };\n}\n`);
    writeFileSync(badEntry, `import { getEndpoint } from './bad-wrapper.ts';\nconst { url, key } = getEndpoint(process.env);\nvoid url; void key;\n`);

    const good = classifyLiveCheck(goodEntry);
    if (good.touchesSupabase && good.importsResolver) ok('one-hop resolver re-export (reviewer repro) is now recognised, not silently skipped');
    else bad('one-hop resolver re-export (reviewer repro) is now recognised', JSON.stringify(good));

    const badResult = classifyLiveCheck(badEntry);
    if (badResult.touchesSupabase && !badResult.importsResolver) ok('one-hop raw env-var read still fails closed (does not use resolvePublicSupabase)');
    else bad('one-hop raw env-var read still fails closed', JSON.stringify(badResult));
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

console.log(failed === 0
  ? '\n✓ every scheduled live barrier can actually run.\n'
  : `\n✗ ${failed} check(s) failed — a scheduled barrier that cannot run protects nothing.\n`);
process.exit(failed === 0 ? 0 : 1);
