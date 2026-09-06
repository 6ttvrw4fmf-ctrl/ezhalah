// ═══════════════════════════════════════════════════════════════════════════════════════════════
// GUARDIAN RUNNER — drives every journey across both viewports and files an OWNED incident when a
// product invariant breaks.
//
//   node e2e/guardian/run.mjs                       # everything, against production
//   BASE_URL=http://localhost:8081 node …           # against a local build
//   GUARDIAN_ONLY=the-doors-open node …             # one journey while developing
//   GUARDIAN_VIEWPORT=mobile node …                 # one viewport
//
// THREE OUTCOMES, AND ONLY ONE OF THEM FILES ANYTHING:
//   PASS          the journey ran and every invariant held.
//   FAIL          the page loaded and an invariant was VIOLATED  → ops_incident, P1, source
//                 'journey', fingerprint `journey:<id>:<viewport>`.
//   UNDETERMINED  the journey could not be judged — navigation timeout, network error, a 5xx, a
//                 control that never mounted because the app never booted. The run still exits
//                 non-zero (a check that cannot check is not a green check), but NOTHING is filed.
//
// That split is the whole point. This repo already has the failure mode where alerts are ignored
// because they cry wolf — 11 deploys reported failure while shipping perfectly fine. A harness
// hiccup filing a P1 against routine-6 would reproduce it inside the very mechanism built to end it.
//
// A PASS NEVER RESOLVES ANYTHING. If an incident with the same fingerprint is open, a pass appends
// `last_passed_at` to its detail and changes nothing else. Resolution requires a permanent barrier
// AND a production verification — ops_incident_resolution_is_earned enforces that in the database —
// and a journey passing once is evidence, not a fix. This runner has NO code path that closes an
// incident at all; scripts/verify-guardian-journeys.ts fails the moment one appears.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { hostname } from 'node:os';
import { JOURNEYS, ALLOWED_SURFACES } from './journeys.mjs';
import { BASE, HarnessError, VIEWPORTS, withPage } from './harness.mjs';

export const SEVERITY = 'P1';
export const SOURCE = 'journey';

/** `journey:<id>:<viewport>` — the id of the FINDING, never of the run. PURE. */
export const fingerprintFor = (journeyId, viewportName) => `journey:${journeyId}:${viewportName}`;

/**
 * What this outcome means for ops_incident. PURE, and the barrier EXECUTES it rather than grepping
 * for its shape — a harness failure filing a product incident is the one bug that would poison the
 * whole loop, so the decision is a function with a test, not a convention.
 */
export function incidentAction(outcome) {
  if (outcome.status === 'FAIL') return 'open';
  if (outcome.status === 'PASS') return 'note-pass';
  return 'none';               // UNDETERMINED — a harness failure NEVER files a product incident.
}

/**
 * What a THROWN error means. Always UNDETERMINED — by design, not by omission.
 * A HarnessError is an explicit "could not judge". Anything else unexpected is treated the same way
 * on purpose: an unclassified throw is not evidence about the product, and guessing that it is would
 * file a bug against a routine on the strength of a stack trace. PURE; the barrier executes it.
 */
export const statusForThrow = () => 'UNDETERMINED';

/** The run this finding came from: the CI run URL when there is one, else an honest local id. */
export const runRef = () => process.env.GUARDIAN_RUN_URL
  || (process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : `local:${hostname()}@${new Date().toISOString()}`);

// ── Supabase (service role: ops_incident has RLS on and no anon grants) ──────────────────────────
const creds = () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/+$/, ''), key } : null;
};

async function rpc({ url, key }, fn, body) {
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${fn} → HTTP ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function openIncident(c, outcome) {
  return rpc(c, 'incident_open', {
    p_fingerprint: outcome.fingerprint,
    p_title: `${outcome.title} [${outcome.viewport}]`,
    p_surface: outcome.surface,
    p_severity: SEVERITY,
    p_source: SOURCE,
    p_source_ref: outcome.runRef,
    p_detail: {
      journey: outcome.id,
      viewport: outcome.viewport,
      base_url: BASE,
      observed_at: outcome.at,
      expected: outcome.expected,
      found: outcome.violations,
      reproduction_steps: outcome.steps,
      evidence: outcome.evidence,
    },
  });
}

/**
 * A pass, recorded on an incident that is still open. Appends `last_passed_at` to its detail and
 * touches NOTHING else — no state, no resolved_at. PostgREST cannot merge jsonb server-side, so the
 * detail is read, merged here, and written back, scoped to rows that are not already terminal.
 */
async function notePass({ url, key }, outcome) {
  const q = `${url}/rest/v1/ops_incident?fingerprint=eq.${encodeURIComponent(outcome.fingerprint)}`
    + '&state=not.in.(resolved,wont_fix)&select=id,detail';
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const r = await fetch(q, { headers, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`read ops_incident → HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const rows = await r.json();
  if (!rows.length) return null;                     // nothing open under this fingerprint — fine.
  const row = rows[0];
  const w = await fetch(`${url}/rest/v1/ops_incident?id=eq.${row.id}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      detail: {
        ...(row.detail ?? {}),
        last_passed_at: outcome.at,
        last_passed_run: outcome.runRef,
        last_passed_note: 'This journey passed against production. That is EVIDENCE, not a fix: '
          + 'closing this incident still requires a permanent regression barrier AND a production '
          + 'verification, which the database enforces (ops_incident_resolution_is_earned).',
      },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!w.ok) throw new Error(`patch ops_incident → HTTP ${w.status}: ${(await w.text()).slice(0, 200)}`);
  return row.id;
}

// ── running one journey ──────────────────────────────────────────────────────────────────────────
async function runOne(journey, viewport) {
  const at = new Date().toISOString();
  const base = {
    id: journey.id,
    title: journey.title,
    surface: journey.surface,
    viewport: viewport.name,
    steps: journey.steps,
    expected: journey.title,
    fingerprint: fingerprintFor(journey.id, viewport.name),
    runRef: runRef(),
    at,
  };
  const started = Date.now();
  try {
    const { violations, evidence } = await withPage(viewport, (page, ctx) => journey.run(page, ctx));
    return violations.length
      ? { ...base, status: 'FAIL', violations, evidence, ms: Date.now() - started }
      : { ...base, status: 'PASS', violations: [], evidence, ms: Date.now() - started };
  } catch (e) {
    const why = e instanceof HarnessError ? e.message : `${e?.name ?? 'Error'}: ${String(e?.message ?? e).slice(0, 300)}`;
    return { ...base, status: statusForThrow(e), violations: [], reason: why, harness: e instanceof HarnessError, ms: Date.now() - started };
  }
}

// ── the run ──────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const only = process.env.GUARDIAN_ONLY;
  const onlyViewport = process.env.GUARDIAN_VIEWPORT;
  const journeys = only ? JOURNEYS.filter((j) => j.id === only) : JOURNEYS;
  const viewports = onlyViewport ? VIEWPORTS.filter((v) => v.name === onlyViewport) : VIEWPORTS;
  if (!journeys.length) { console.error(`GUARDIAN_ONLY=${only} matches no journey`); process.exit(2); }
  if (!viewports.length) { console.error(`GUARDIAN_VIEWPORT=${onlyViewport} matches no viewport`); process.exit(2); }

  console.error(`\n══ GUARDIAN JOURNEYS — ${new Date().toISOString()} ══`);
  console.error(`target: ${BASE}`);
  console.error(`journeys: ${journeys.length} × viewports: ${viewports.map((v) => v.name).join(', ')}\n`);

  const outcomes = [];
  for (const journey of journeys) {
    for (const viewport of viewports) {
      process.stderr.write(`▶ ${journey.id} [${viewport.name}] … `);
      // A failure never stops the run: the point is to collect EVERYTHING, so one broken surface
      // does not hide the other seven.
      const outcome = await runOne(journey, viewport);
      outcomes.push(outcome);
      const mark = outcome.status === 'PASS' ? 'PASS' : outcome.status === 'FAIL' ? 'FAIL' : 'UNDETERMINED';
      console.error(`${mark} (${Math.round(outcome.ms / 1000)}s)`);
      if (outcome.status === 'FAIL') outcome.violations.forEach((v) => console.error(`    ✗ ${v}`));
      if (outcome.status === 'UNDETERMINED') console.error(`    ? ${outcome.reason}`);
    }
  }

  // ── incidents ──────────────────────────────────────────────────────────────────────────────────
  const c = creds();
  const filed = [];
  const noted = [];
  const fileErrors = [];
  if (!c) {
    // LOUD, never silent. A run that quietly decides not to file is indistinguishable from a run
    // with nothing to file — which is exactly how a reporting chain dies without anyone noticing.
    console.error('\n⚠ ══════════════════════════════════════════════════════════════════════════════');
    console.error('⚠ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.');
    console.error('⚠ NO INCIDENT WAS FILED for anything below. The journeys ran; the findings have');
    console.error('⚠ NO OWNER and nobody has been told. Set both and re-run to file them.');
    console.error('⚠ ══════════════════════════════════════════════════════════════════════════════');
  } else {
    for (const outcome of outcomes) {
      const action = incidentAction(outcome);
      if (action === 'none') continue;
      try {
        if (action === 'open') {
          const id = await openIncident(c, outcome);
          filed.push(`#${id} ${outcome.fingerprint}`);
        } else {
          const id = await notePass(c, outcome);
          if (id) noted.push(`#${id} ${outcome.fingerprint}`);
        }
      } catch (e) {
        fileErrors.push(`${outcome.fingerprint}: ${String(e.message ?? e).slice(0, 200)}`);
      }
    }
  }

  // ── report ─────────────────────────────────────────────────────────────────────────────────────
  const tally = (s) => outcomes.filter((o) => o.status === s).length;
  console.error('\n═════════════════ GUARDIAN JOURNEYS — REPORT ═════════════════');
  for (const o of outcomes) {
    console.error(`${o.status.padEnd(12)} ${o.id} [${o.viewport}] · ${o.surface}`);
  }
  console.error('──────────────────────────────────────────────────────────────');
  console.error(`PASS ${tally('PASS')} · FAIL ${tally('FAIL')} · UNDETERMINED ${tally('UNDETERMINED')}`);
  console.error(`INCIDENTS OPENED/RE-OBSERVED: ${filed.length ? filed.join(', ') : 0}`);
  console.error(`OPEN INCIDENTS NOTED AS PASSING (state untouched): ${noted.length ? noted.join(', ') : 0}`);
  if (fileErrors.length) { console.error('INCIDENT WRITES THAT FAILED:'); fileErrors.forEach((e) => console.error(`  ✗ ${e}`)); }
  if (!c) console.error('INCIDENTS: NOT FILED — no service-role credentials (see the warning above)');
  // `n/ALLOWED_SURFACES.length` is 8/8 BY CONSTRUCTION — the denominator is the list we chose to
  // cover, so this ratio can never read anything else and cannot fail. Left as-is it is a false
  // green: it looks like a coverage score and is really a tautology. Labelled for what it measures,
  // and printed beside the coverage this suite genuinely does NOT have.
  console.error(`SURFACES COVERED (logged-out): ${[...new Set(outcomes.map((o) => o.surface))].length}/${ALLOWED_SURFACES.length}`);
  console.error('SIGNED-IN COVERAGE: NONE — every journey above runs LOGGED OUT (ops_incident #29).');
  console.error('  Favorites, saved chats, account flows and authenticated persistence have no');
  console.error('  automated journey at all. Auth is Google + Apple only, so no harness can complete');
  console.error('  the consent flow; closing this needs a QA identity, which is an owner decision.');
  console.error('  The line above is logged-out coverage only. It is not a coverage score.');
  console.error('══════════════════════════════════════════════════════════════\n');

  if (process.env.GUARDIAN_JSON) console.log(JSON.stringify(outcomes, null, 2));

  // A write that failed is also a check that did not report. Red.
  process.exit(tally('FAIL') || tally('UNDETERMINED') || fileErrors.length ? 1 : 0);
}

if (process.argv[1] && process.argv[1].endsWith('run.mjs')) {
  await main();
}
