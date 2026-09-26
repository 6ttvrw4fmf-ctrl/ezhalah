// The failure→alert bridge for unattended workflows (2026-09-04).
//
// WHAT WAS BROKEN. 17 scheduled workflows could fail and raise NOTHING. They went red in the
// Actions tab and notified nobody — issue #1349 recorded the observed consequence: ui-parity failed
// five nights running with zero alerts. Only selector-e2e.yml and migration-drift-guard.yml called
// mon_raise, so the system's own production checks were the weakest link in its own alerting.
//
// A red X in a tab nobody opens is the same silence as no check at all — the exact failure this
// repo has been burned by before (nine dark detectors reading as a clean bill of health,
// AGENTS.md §"Read this first"). alert_event is where a finding becomes a GitHub issue with an
// owning routine (alert-dispatch.yml + scripts/lib/alertRouting.ts). This is the on-ramp.
//
//   node scripts/ops/raise-workflow-alert.mjs \
//     --kind <alert kind> --workflow <workflow file name> \
//     --status <success|failure|cancelled|skipped> --run-url <url>
//
// ONE OPEN ALERT PER WORKFLOW, NOT PER RUN. The dedup key is `workflow_failed:<workflow-file>`, so
// a check failing every night for a week is one issue that stays open, not seven. `mon_raise`
// returns 0 when the key is already open; a green run calls `mon_resolve_key` on the same key and
// the alert self-heals, exactly as selector-e2e.yml does.
//
// FAILS LOUD, NEVER SILENT. Missing credentials, a bad argument, a non-2xx RPC or a network error
// all exit non-zero. A bridge that quietly does nothing is precisely the bug class being closed
// here — it would restore the old silence while every file still LOOKS wired.
//
// ...BUT LOUD IS NOT DELIVERED, AND THIS BRIDGE COULD NOT RAISE AT THE ONE MOMENT IT MATTERS MOST
// (ops_incident #658, fixed 2026-09-26 by routine-7). Measured 2026-09-23 23:31:56Z on
// p0-fast-lane-coverage.yml:
//
//     raise-workflow-alert: mon_raise returned HTTP 503 {"code":"PGRST002"}
//
// PGRST002 is PostgREST reloading its schema cache — which is exactly what ANY migration that
// creates or replaces a function triggers. So the bridge failed in the one window where reds are
// MOST likely, because the same migration that opens the reload window is what breaks live checks.
// The consequence is precisely the thing this file exists to prevent: a red unattended run that
// notified nobody. Exiting 1 made the already-red run redder and wrote no alert_event row at all.
//
// THE FIX REUSES THE ONE EXISTING POLICY — it does not invent a second one. The repo already has a
// deliberately strict, mutation-proven classifier for this exact transient in
// scripts/lib/postgrestRetry.ts (ops_incident #573), used by ten `.ts` checks. This bridge was the
// only caller that could not reach it.
//
// The recorded blocker for that was WRONG, and checking it is what unblocked this: #658 says the
// bridge "is .mjs and is invoked as plain `node`, so it cannot import scripts/lib/postgrestRetry.ts
// (a .ts module) without either a strip-types flag on every bridge step or a .mjs sibling of the
// driver." Node strips types by default since 22.18, and all 32 bridge invocations run on Node 24 —
// so a plain `node` .mjs imports the .ts driver with no flag, no sibling, and no second copy of the
// decision. Verified by execution before this change was written.
//
// So ONLY a 503 whose JSON `code` is exactly PGRST002 is retried, bounded at DEFAULT_RETRY. Every
// other failure — the HTTP 500 / 57014 statement timeout that took aqar-drift-detector-mutation-
// proof.yml red the same morning, a 503 that merely MENTIONS the code in prose, a non-JSON body —
// is still returned on the FIRST attempt and still exits non-zero. Nothing here can turn a not-ok
// into an ok: the driver hands back the last probe it really took.
//
// Barrier: scripts/verify-workflow-alert-bridge-survives-schema-cache-reload.ts EXECUTES sendRpc()
// against an injected PostgREST, because the pre-existing barrier over this file
// (verify-scheduled-checks-alert-on-failure.ts) proves every workflow is WIRED to the bridge and
// nothing proved the bridge DELIVERS — a pointer reading as coverage, AGENTS.md PART 1.11.

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { fetchRetryingSchemaCacheReload, DEFAULT_RETRY } from '../lib/postgrestRetry.ts';

/** Severity for a dead production check. P1 = "a human must look today". */
export const SEVERITY = 'P1';

/** Statuses that mean the run reached a verdict. Anything else proves nothing either way. */
const VERDICT = new Set(['success', 'failure']);
const NO_VERDICT = new Set(['cancelled', 'skipped']);

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--')) throw new Error(`expected a --flag, got "${key}"`);
    if (value === undefined) throw new Error(`${key} has no value`);
    args[key.slice(2)] = value;
  }
  for (const required of ['kind', 'workflow', 'status', 'run-url']) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  const status = args.status.toLowerCase();
  if (!VERDICT.has(status) && !NO_VERDICT.has(status)) {
    throw new Error(`--status must be success|failure|cancelled|skipped, got "${args.status}"`);
  }
  return { kind: args.kind, workflow: args.workflow, status, runUrl: args['run-url'] };
}

/** The dedup key. The WORKFLOW FILE is the identity — never the run id. */
export const dedupKey = (workflow) => `workflow_failed:${workflow}`;

/**
 * The RPC this run should make, or null when the run reached no verdict (cancelled/skipped —
 * raising would be a false alarm and resolving would erase a real one).
 * Pure: the barrier executes THIS function rather than re-implementing it.
 */
export function buildRpcCall({ kind, workflow, status, runUrl }) {
  const dedup = dedupKey(workflow);
  if (status === 'success') return { fn: 'mon_resolve_key', body: { p_kind: kind, p_dedup: dedup } };
  if (status !== 'failure') return null;
  return {
    fn: 'mon_raise',
    body: {
      p_sev: SEVERITY,
      p_kind: kind,
      p_platform: null,
      p_dedup: dedup,
      p_detail: {
        workflow,
        run_url: runUrl,
        why: `${workflow} runs unattended and failed. A red run in the Actions tab notifies nobody, ` +
          `so this row is the only thing that reaches a human — the check it performs is currently ` +
          `not protecting production.`,
        action: `Open run_url, read the failing step and fix the cause. A green run of ${workflow} ` +
          `resolves this alert automatically (mon_resolve_key on the same dedup key); nothing else ` +
          `clears it, and re-failures fold into this one alert rather than opening new ones.`,
      },
    },
  };
}

/**
 * POST the RPC, retrying ONLY a PostgREST schema-cache reload, and return the last probe taken.
 *
 * Exported so the barrier can EXECUTE it against a stub PostgREST rather than grep for the import —
 * every defect in this repo's "a failed fetch is not an empty answer" family had a source-TEXT
 * tripwire over the exact line that passed for the whole time the defect was live (AGENTS.md).
 *
 * `opts` is injected by the barrier so its proofs run without real time passing. Production uses
 * DEFAULT_RETRY: 5 attempts, ~30s of total patience — enough for a cache reload, short of an outage.
 * The return value is always a probe the network really produced; it is never a synthesised success.
 */
export async function sendRpc({ url, key, call }, opts = DEFAULT_RETRY) {
  return fetchRetryingSchemaCacheReload(
    `${url.replace(/\/+$/, '')}/rest/v1/rpc/${call.fn}`,
    {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(call.body),
    },
    opts,
  );
}

const die = (message) => {
  console.error(`::error::raise-workflow-alert: ${message}`);
  process.exit(1);
};

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (e) {
    die(`${e.message}. Usage: --kind K --workflow F.yml --status S --run-url URL`);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Fail CLOSED on missing credentials. Warning-and-continue here is how a bridge becomes
  // decoration: every workflow would look wired and none would ever write an alert.
  if (!url || !key) {
    die('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set — without them nothing can ' +
      'reach alert_event, and this workflow would be silently back to alerting nobody');
  }

  const call = buildRpcCall(parsed);
  if (!call) {
    console.log(`raise-workflow-alert: status=${parsed.status} — no verdict, leaving alert_event untouched.`);
    return;
  }

  let res;
  try {
    res = await sendRpc({ url, key, call });
  } catch (e) {
    die(`${call.fn} could not be reached: ${e.message}`);
  }
  if (!res.ok) die(`${call.fn} returned HTTP ${res.status}: ${res.body.slice(0, 400)}`);

  console.log(`raise-workflow-alert: ${call.fn} ok — kind=${parsed.kind} dedup=${dedupKey(parsed.workflow)}`);
}

// Importable (the barrier executes parseArgs/buildRpcCall directly) but still a CLI when run.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
