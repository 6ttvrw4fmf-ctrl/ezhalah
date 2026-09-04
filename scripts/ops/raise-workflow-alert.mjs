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

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

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
    res = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/rpc/${call.fn}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(call.body),
    });
  } catch (e) {
    die(`${call.fn} could not be reached: ${e.message}`);
  }
  if (!res.ok) die(`${call.fn} returned HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);

  console.log(`raise-workflow-alert: ${call.fn} ok — kind=${parsed.kind} dedup=${dedupKey(parsed.workflow)}`);
}

// Importable (the barrier executes parseArgs/buildRpcCall directly) but still a CLI when run.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
