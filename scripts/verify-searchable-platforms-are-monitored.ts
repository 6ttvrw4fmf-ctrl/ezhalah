// A PLATFORM THAT PUTS LISTINGS IN FRONT OF USERS MUST BE ONE THE PER-PLATFORM DETECTORS ACTUALLY READ.
//
// THE DEFECT THIS EXISTS FOR (senior production run, 2026-09-05). Every per-platform detector in this
// database filters `platform_registry` on `status = 'active' AND kind = 'source'` —
// mon_detect_silent_scraper_death, mon_detect_zero_new_stall, mon_detect_stale_active_fraction,
// mon_detect_field_integrity, mon_detect_stale_no_remediation_path and the rest. muktamel sat at
// `status = 'dormant'` while serving 523 production_ready rows in search_listings_ar, with 28
// scrape_runs in the preceding 7 days (latest 2026-09-05 06:00:30Z). Measured before the repair:
// the silent-scraper-death cohort held 37 platforms and muktamel was not one of them. Its capture
// could have died and 523 user-searchable listings would have gone stale with no P0 — no barrier
// anywhere would have said a word.
//
// WHY THE EXISTING GUARD MISSED IT. mon_detect_registry_orphans had two limbs and the defect fell
// between them: limb 1 (`registry_orphan_dead`) only looks at rows ALREADY `status='active'`; limb 2
// (`registry_orphan_label`) only fires when a scrape_runs label has NO platform_registry row AT ALL.
// muktamel had a row, so limb 2 passed it; the row said 'dormant', so limb 1 never looked. A registry
// row that EXISTS but excludes itself from monitoring was a blind spot by construction.
//
// WHY THIS FILE EXISTS SEPARATELY FROM THE DETECTOR THAT NOW CATCHES IT. Limb 3 of
// mon_detect_registry_orphans is the live enforcement and runs twice hourly. But a barrier that can
// only be verified by reading that function's own body is a source-TEXT tripwire, and AGENTS.md is
// explicit about how those fail: on 2026-09-04, five separate defects each had a barrier over the
// exact line, and every one of those barriers passed for the entire time the defect was live — two
// of them pinned the defective line as correct. So this barrier never reads the detector. It calls
// `ops_searchable_platforms_unmonitored()`, which computes the invariant from production's own
// searchable set, and stays true if limb 3 is rewritten, renamed or deleted outright.
//
// NO PLATFORM LIST, deliberately — the same reason migration 20260904151820 gives: "the previous
// barriers failed precisely because they enumerated instead of deriving." A platform onboarded
// tomorrow is graded the moment its first production_ready row lands.
//
// A FAILED FETCH IS NOT AN EMPTY ANSWER. An empty result here means "no unmonitored platform", which
// is the PASS state — so a request that fails must never be allowed to look like one. Every failure
// mode (non-200, non-array body, timeout, network error) is an explicit UNKNOWN that exits non-zero,
// and §3 below proves that by executing this file's own verdict function against injected failures
// rather than asserting it from source text.
//
// WHERE IT RUNS: .github/workflows/loader-active-platforms-check.yml — the existing anon-read live
// check on the same subject (a platform must not be represented as more than it is), with an
// alert_event bridge so a red run reaches a human. Excluded from `npm test` for the reason that file
// states: `npm test` is a required check on every PR, and a live check there would fail unrelated
// PRs whenever production momentarily disagreed.

const SUPABASE_URL = 'https://aannarbkwcymrotzwdbo.supabase.co';
// The anon key real users' browsers use — pinned here (matches scripts/safe-deploy.sh
// LOCK_ANON_KEY). If it ever rotates, safe-deploy.sh is the one truth source and this moves with it.
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhbm5hcmJrd2N5bXJvdHp3ZGJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MDgxMDAsImV4cCI6MjA5NTk4NDEwMH0.Z-GhSpan6otYWkc8sU43Dw5PT5T_VBUMr0IDZShCQw0';

const TIMEOUT_MS = 20_000;

export type UnmonitoredRow = {
  platform: string;
  searchable_rows: number;
  registry_status: string;
  registry_kind: string;
};

/** A fetch that could not establish the truth. Distinct from a genuine empty answer. */
export const PROBE_FAILED = Symbol('probe-failed');
export type Probe = UnmonitoredRow[] | { [PROBE_FAILED]: string };
export const isProbeFailure = (p: Probe): p is { [PROBE_FAILED]: string } =>
  !Array.isArray(p) && typeof p === 'object' && p !== null && PROBE_FAILED in p;

/**
 * The whole decision, pure and executable. Returns null when the invariant holds; otherwise the
 * reason it does not. An UNKNOWN is a failure — never a pass.
 */
export function verdict(probe: Probe): string | null {
  if (isProbeFailure(probe)) {
    return `UNKNOWN — could not establish the invariant: ${probe[PROBE_FAILED]}. ` +
      'A request that failed is not an answer of "no unmonitored platforms".';
  }
  if (probe.length === 0) return null;
  return probe
    .map(
      (r) =>
        `${r.platform}: ${r.searchable_rows} production_ready rows in search_listings_ar, but ` +
        `platform_registry says status=${r.registry_status} kind=${r.registry_kind} — every ` +
        'per-platform detector skips it',
    )
    .join('\n         ');
}

/** Ask production. Any failure comes back as PROBE_FAILED, never as []. */
export async function probeProduction(
  fetchImpl: typeof fetch = fetch,
): Promise<Probe> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(
      `${SUPABASE_URL}/rest/v1/rpc/ops_searchable_platforms_unmonitored`,
      {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
        signal: ctl.signal,
      },
    );
    if (!res.ok) {
      return { [PROBE_FAILED]: `RPC returned HTTP ${res.status}` };
    }
    const body: unknown = await res.json();
    if (!Array.isArray(body)) {
      return { [PROBE_FAILED]: `RPC body was ${typeof body}, expected an array` };
    }
    return body as UnmonitoredRow[];
  } catch (e) {
    return { [PROBE_FAILED]: `request threw: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

// ── run ────────────────────────────────────────────────────────────────────────────────────────
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
};

console.log('\nEvery production-searchable platform must be inside the monitored registry\n');

// 1. The live invariant.
const probe = await probeProduction();
const v = verdict(probe);
check(
  'no platform serves production_ready rows from outside (status=active AND kind=source)',
  v === null,
  v ?? (probe as UnmonitoredRow[]).length === 0 ? 'production clean' : '',
);
if (v !== null) console.log(`\n         ${v}\n`);

// 2. The probe really reached production (a PASS above must not be a silent UNKNOWN).
check('the invariant was actually established (not an UNKNOWN)', !isProbeFailure(probe));

// 3. MUTATION PROOF — execute this barrier's OWN predicate against deliberately broken input. It is
//    not enough that it passes today: it must be shown to FAIL when the defect is present, and to
//    fail rather than pass when the truth cannot be established.
const mustCatch = (label: string, caught: boolean) => {
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) ${label}`);
  if (!caught) failed++;
};

mustCatch(
  'catches the real 2026-09-05 defect shape (searchable + dormant)',
  verdict([
    { platform: 'muktamel', searchable_rows: 523, registry_status: 'dormant', registry_kind: 'source' },
  ]) !== null,
);
mustCatch(
  'catches a platform with no registry row at all',
  verdict([
    {
      platform: 'ghost',
      searchable_rows: 1,
      registry_status: '<no registry row>',
      registry_kind: '<no registry row>',
    },
  ]) !== null,
);
mustCatch(
  'catches a failed fetch instead of reading it as an honest zero',
  verdict({ [PROBE_FAILED]: 'HTTP 503' }) !== null,
);
// The predicate is not vacuous: a genuine empty answer must still be the PASS state, or the three
// proofs above would be satisfied by a verdict() that simply always fails.
check('verdict PASSES on a genuine empty answer (the proofs are not vacuous)', verdict([]) === null);

// 4. The failure paths are real, not theoretical: drive probeProduction with stub fetches that fail
//    the way the network actually fails, and prove none of them degrades into [].
const stubNon200 = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
const stubBadBody = (async () =>
  new Response('{"message":"boom"}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })) as unknown as typeof fetch;
const stubThrows = (async () => {
  throw new Error('ECONNRESET');
}) as unknown as typeof fetch;

mustCatch(
  'a non-200 response becomes PROBE_FAILED, not []',
  isProbeFailure(await probeProduction(stubNon200)),
);
mustCatch(
  'a non-array body becomes PROBE_FAILED, not []',
  isProbeFailure(await probeProduction(stubBadBody)),
);
mustCatch(
  'a thrown request becomes PROBE_FAILED, not []',
  isProbeFailure(await probeProduction(stubThrows)),
);

console.log(
  failed
    ? `\n✗ ${failed} check(s) FAILED — a platform may be serving users while no detector watches it`
    : '\n✓ Every production-searchable platform is inside the monitored registry',
);
process.exit(failed ? 1 : 0);
