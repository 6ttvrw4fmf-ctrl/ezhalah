// Barrier: A SUCCESSFUL EDGE DEPLOY IS NOT A WORKING FUNCTION.
// Owner ruling, 2026-08-29: "edge function deploy success != production success. Every production
// agent deploy must perform a real post-deploy boot/request smoke test and fail the deployment
// verification if the function returns BOOT_ERROR/5xx or silently cannot initialize."
//
// WHAT WENT WRONG. `supabase functions deploy` bundled the agent cleanly and
// deploy-edge-function.yml reported SUCCESS, while every request to the deployed function returned
//   {"code":"BOOT_ERROR","message":"Function failed to start (please check logs)"}
// because the module had two `const t0` declarations in one scope. The bundler accepts that; the
// Deno worker refuses to boot. Green deploy, dead production.
//
// WHY IT STAYED INVISIBLE. src/data/agent.ts falls back to its bundled offline heuristic on ANY
// agent failure, so users saw a working product with a dead AI. Nothing else in the pipeline calls
// the deployed function, so nothing else could catch this class. It was found by hand.
//
// WHAT THIS FILE PINS:
//   1. the deploy workflow HAS a post-deploy step that makes a REAL request to the deployed function
//   2. that step is BLOCKING — it exits non-zero, so a broken deploy is a RED run
//   3. it explicitly fails on BOOT_ERROR and on 5xx (the two shapes of "it did not start")
//   4. it cannot be skipped for want of a credential
//   5. the pre-deploy half is also wired: verify-edge-functions-parse.ts runs in the deploy gate
//
// Offline and deterministic: reads the workflow YAML, no network.
import { readFileSync } from 'node:fs';

const WF = '.github/workflows/deploy-edge-function.yml';
const wf = readFileSync(WF, 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

// The step must exist, and must run on a real deploy (not dry runs, not deletes).
const stepIdx = wf.indexOf('Post-deploy boot smoke test');
check('the deploy workflow has a post-deploy boot smoke test', stepIdx > -1);

const step = stepIdx > -1 ? wf.slice(stepIdx, stepIdx + 4000) : '';
check('the boot test runs only on a REAL deploy (not dry_run, not delete)',
  /if:\s*\$\{\{\s*!inputs\.dry_run\s*&&\s*inputs\.action\s*!=\s*'delete'\s*\}\}/.test(step));

// It must make an actual HTTP request to the deployed function — not inspect a status API.
check('it makes a real HTTP request to the deployed function',
  /curl\b/.test(step) && /functions\/v1\//.test(step),
  'a deployment status API says the bundle shipped, not that the worker runs');
check('it posts to the function that was just deployed',
  /\$\{\{\s*inputs\.function\s*\}\}/.test(step));

// It must FAIL the job. A detector that only prints is decoration.
check('the boot test is BLOCKING (exits non-zero)', /exit 1/.test(step),
  'a smoke test that cannot fail the run is decoration');
check('it fails on BOOT_ERROR explicitly', /BOOT_ERROR/.test(step));
check('it fails on 5xx explicitly', /-ge 500|>= *500/.test(step));
check('it fails when there is no HTTP response at all (timeout/DNS/TLS)', /"000"|= *000/.test(step));
check('it validates the body is the JSON contract, not just any 200',
  /json\.load|json\.loads/.test(step),
  'a proxy error page can return 200 with an HTML body');

// Cold start must not be reported as a broken deploy.
check('it retries before declaring failure (cold start is not a break)',
  /for attempt in/.test(step) && /sleep/.test(step));

// It must never be silently skipped because a secret is missing — that would turn the gate off
// without turning it red. SUPABASE_PUBLISHABLE_KEY is referenced elsewhere in .github/workflows but
// is NOT configured in this repo's Actions secrets; using it here would resolve to an empty string.
check('the boot test does not depend on the unconfigured SUPABASE_PUBLISHABLE_KEY secret',
  !/secrets\.SUPABASE_PUBLISHABLE_KEY/.test(step));
check('it has a credential fallback so the gate cannot be skipped',
  /\$\{ANON_KEY:-/.test(step));

// The pre-deploy half: the parse/redeclare barrier must run in the deploy gate.
check('the pre-deploy gate runs the edge-function parse + redeclaration barrier',
  /scripts\/verify-edge-functions-parse\.ts/.test(wf),
  'the missing brace and the duplicate t0 were both catchable before shipping');

// The failure message must tell the reader the product looks fine while the AI is dead — the single
// most important fact about this failure mode.
check('the failure output warns that users will NOT see an error',
  /will NOT see an error|offline heuristic/i.test(step));

console.log(
  failures === 0
    ? '\n✓ edge deploys are gated on the function actually booting'
    : `\n✗ ${failures} boot-test check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
