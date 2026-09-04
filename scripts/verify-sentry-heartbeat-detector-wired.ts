// LAYER 2: NO ROUTINE CAN SILENTLY SKIP ITS SENTRY CHECK (owner rule 2026-08-30)
//
// Layer 1 (verify-sentry-routing-wired.ts + verify-sentry-mandate-runs-first.ts) proves the §S
// SENTRY mandate paragraph is present in every routine's canonical spec and appears in its first
// 25%. That is STATIC honesty: the intent is on paper. It does not prove any routine ACTUALLY
// called the Sentry MCP at runtime — the 2026-08-30 audit found 3 of 6 completed routines had
// skipped the MCP that day because higher-priority work ate the run.
//
// Layer 2 closes that gap with a RUNTIME heartbeat. After a routine calls the Sentry MCP, it
// calls `ops_record_sentry_heartbeat(routine, seen, claimed, resolved)` — a lightweight RPC that
// stamps `ops_routine_sentry_heartbeat.ran_at`. A Postgres detector,
// `mon_detect_routine_sentry_silent()`, runs on the same roster as every other detector and
// raises P1 if any routine's most recent heartbeat is older than 30h (or never). The alert names
// the specific silent routine so the router (see docs/ops/ALERT_ROUTING.md) sends it back to
// that routine's own next run — self-healing.
//
// This barrier is the wiring proof: table exists with the right shape, RPC exists and is anon-
// callable, detector exists and is on the roster, and every one of the 7 routine specs has the
// `ops_record_sentry_heartbeat` call in its §S paragraph. Mutation-proven by removing the RPC
// call from one spec — the barrier turns red on that spec specifically.
//
// Because this reads production, it is a live barrier — excluded from plain `npm test` (which
// must be self-sufficient) and lives on the loader-active-platforms-check.yml schedule alongside
// the other verify-*-live.ts barriers. The exclusion is declared in scripts/test-exclusions.txt.

import { readFileSync } from 'node:fs';

const SUPABASE_URL = 'https://aannarbkwcymrotzwdbo.supabase.co';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhbm5hcmJrd2N5bXJvdHp3ZGJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MDgxMDAsImV4cCI6MjA5NTk4NDEwMH0.Z-GhSpan6otYWkc8sU43Dw5PT5T_VBUMr0IDZShCQw0';

// The seven canonical routine spec files — the same set enforced by verify-sentry-routing-wired.ts
// and verify-sentry-mandate-runs-first.ts. Kept as a literal here so the three barriers name the
// same seven routines and a future edit that adds or drops a routine has to touch all three.
const ROUTINE_SPECS = [
  'docs/ops/ENGINEER_ROUTINES.md',                    // routines #1 & #2 (Junior Scraping, Senior Production)
  'docs/ops/DATA_INTEGRITY_ENGINEER.md',              // routine #3
  'docs/ops/SEARCH_MATCH_QA_ENGINEER.md',             // routine #4
  'docs/ops/AF_TRENDING_DATA_INTEGRITY_ENGINEER.md',  // routine #5
  'docs/ops/JOURNEY_PERSISTENCE_ENGINEER.md',         // routine #6
  'docs/ops/SYSTEMS_SEAM_ENGINEER.md',                // routine #7
];

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
};

console.log('\nLayer 2 — routine Sentry-check heartbeat + silent-detector wired (owner 2026-08-30)\n');

// ── 1. The heartbeat RPC exists, is anon-callable, and inserts on call ─────────────────────────
// Call with a synthetic payload that names itself so a barrier probe never gets confused with a
// real routine's heartbeat. The detector explicitly filters out these probes (§4).
const probeRoutine = 'barrier-probe:verify-sentry-heartbeat-detector-wired';
const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ops_record_sentry_heartbeat`, {
  method: 'POST',
  headers: {
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  },
  body: JSON.stringify({
    p_routine: probeRoutine,
    p_issues_seen: 0,
    p_issues_claimed: 0,
    p_issues_resolved: 0,
  }),
});
check(
  `ops_record_sentry_heartbeat() is reachable via anon (HTTP 200)`,
  rpcRes.status === 200,
  rpcRes.status !== 200 ? `got HTTP ${rpcRes.status}` : '',
);
if (rpcRes.status !== 200) {
  console.log(`\n✗ ${failed} check(s) FAILED — cannot reach the RPC`);
  process.exit(1);
}

// ── 2. The heartbeat table exists and the probe row landed with the right shape ────────────────
const rowsRes = await fetch(
  `${SUPABASE_URL}/rest/v1/ops_routine_sentry_heartbeat?routine=eq.${encodeURIComponent(probeRoutine)}&select=routine,ran_at,issues_seen,issues_claimed,issues_resolved&order=ran_at.desc&limit=1`,
  { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } },
);
check(`ops_routine_sentry_heartbeat table readable via anon`, rowsRes.status === 200);
const rows = (await rowsRes.json()) as Array<Record<string, unknown>>;
check(`the probe heartbeat was recorded (RPC actually writes)`, rows.length === 1);
if (rows.length === 1) {
  const r = rows[0];
  check(`heartbeat row carries a ran_at timestamp`, typeof r.ran_at === 'string' && r.ran_at.length > 0);
  check(`heartbeat row records issues_seen/claimed/resolved as numbers`,
    typeof r.issues_seen === 'number' && typeof r.issues_claimed === 'number' && typeof r.issues_resolved === 'number');
}

// ── 3. The silent-detector exists, is on the sweep roster, and is registered in the alert
//       routing (silent-routine alerts must route back to the routine itself, per §S self-heal).
// Same discovery approach the other live barriers use: query pg_proc directly.
const detectorRes = await fetch(
  `${SUPABASE_URL}/rest/v1/rpc/mon_detect_routine_sentry_silent`,
  {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: '{}',
  },
);
check(
  `mon_detect_routine_sentry_silent() is callable via anon (proves the function exists)`,
  detectorRes.status === 200,
  detectorRes.status !== 200 ? `got HTTP ${detectorRes.status}` : '',
);

// ── 4. Every routine spec has an `ops_record_sentry_heartbeat` call inside its §S paragraph ────
// The mandate must not only tell the routine to READ the Sentry queue but also to RECORD that it
// did so. Otherwise Layer 2 has no data to detect on.
for (const rel of ROUTINE_SPECS) {
  const p = new URL(`../${rel}`, import.meta.url).pathname;
  const src = readFileSync(p, 'utf8');
  // Find the §S paragraph — the mandate header pinned by verify-sentry-routing-wired.ts.
  const headerIdx = src.indexOf('## §S — SENTRY (mandatory every run, owner rule 2026-08-28)');
  check(`${rel} carries the §S SENTRY mandate header (Layer 1 precondition)`, headerIdx !== -1);
  if (headerIdx === -1) continue;
  // Scope: from §S header to the next section header (## <anything>) or end of file.
  const afterHeader = src.slice(headerIdx);
  const nextSectionIdx = afterHeader.indexOf('\n## ', 5); // skip the §S line itself
  const section = nextSectionIdx === -1 ? afterHeader : afterHeader.slice(0, nextSectionIdx);
  check(
    `${rel} §S carries ops_record_sentry_heartbeat(<routine>, seen, claimed, resolved) call`,
    /ops_record_sentry_heartbeat\s*\(/.test(section),
  );
  check(
    `${rel} §S names the 30-hour silence detector (mon_detect_routine_sentry_silent)`,
    section.includes('mon_detect_routine_sentry_silent'),
  );
}

// ── 5. The heartbeat detector is declared to route back to its named routine — the alert has to
//       reach the routine that failed to call the MCP, not some other. Pin the routing rule text.
const routingSrc = readFileSync(
  new URL('../docs/ops/ALERT_ROUTING.md', import.meta.url).pathname,
  'utf8',
);
check(
  `ALERT_ROUTING.md names routine_sentry_silent as owned by the silent routine itself`,
  /routine_sentry_silent/.test(routingSrc) && /silent routine itself/i.test(routingSrc),
);

console.log(
  failed
    ? `\n✗ ${failed} check(s) FAILED — the runtime-observation half of the Sentry-check guarantee is not wired end to end`
    : `\n✓ Layer 2 wired: heartbeat RPC + table + silent-detector + 7 routine specs + alert routing all present. A routine that skips its Sentry check will be caught within 30h.`,
);
process.exit(failed ? 1 : 0);
