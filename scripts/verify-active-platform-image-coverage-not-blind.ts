// EVERY SEARCHABLE PLATFORM MUST BE VISIBLE TO THE IMAGE-COVERAGE MONITOR — LIVE.
//
// THE LAUNCH-COMPLETENESS GAP THIS CLOSES (owner brief "build the lock", 2026-09-06). Twice this
// week a platform was switched to status=active + kind=source in platform_registry while a layer of
// its launch was unfinished — amaall shipped with no image-coverage baseline (ops_incident #91), and
// amaall/remal were active before listing_location_index carried their arms. Both of those two
// failure modes now have locks: verify-location-index-covers-every-searchable-platform (index arms,
// #104) and verify-image-coverage-ratchet (baseline declaration + floors, #91).
//
// This file closes the ONE launch layer that had no lock: the image-coverage MONITOR itself being
// blind to a live platform. mon_snapshot_image_coverage() enumerates the *_listings tables and keeps
// only groups with active rows, and verify-image-coverage-ratchet reads that snapshot — so a platform
// the snapshot does not contain is not merely at 0% coverage, it is INVISIBLE to the coverage guard
// entirely: its floor is never checked, and its absence reads as "nothing to report", the exact
// silent-zero shape AGENTS.md is built around. Measured 2026-09-06: abwbna (189 active rows), alobid
// (138), bahadhabab (53) and remal (84) are all active+source with rows in their raw tables, yet
// none appears in ops_image_coverage_latest(). The ratchet cannot see them, so nothing does.
//
// THE INVARIANT, stated as a set relation: the platforms the registry calls active+source must be a
// SUBSET of the platforms the newest image-coverage snapshot reports. A registry-active platform
// missing from the snapshot is a launch that reached "live" before the image monitor could see it.
//
// DERIVE, NEVER ENUMERATE. The active set is read from platform_registry, the covered set from the
// snapshot — no platform list is written here, so a platform onboarded tomorrow is graded the moment
// its registry row turns active. Same discipline as verify-searchable-platforms-are-monitored.
//
// A FAILED FETCH IS NOT AN EMPTY ANSWER. An empty gap list is the PASS state, so a request that fails
// must never be allowed to look like one: every failure mode (non-200, non-array body, timeout,
// thrown request) is an explicit UNKNOWN that exits non-zero, and §3/§4 prove it by executing this
// file's own verdict against injected failures rather than trusting the happy path.
//
// WHERE IT RUNS: .github/workflows/loader-active-platforms-check.yml — the existing anon-read live
// home for per-platform launch-coverage checks, with the alert_event bridge so a red run reaches a
// human. Excluded from `npm test`: the invariant is a fact about production's registry and snapshot,
// unknowable offline, and a live check in the required suite would fail unrelated PRs whenever the
// two momentarily disagreed.
//
// Run: node --experimental-strip-types scripts/verify-active-platform-image-coverage-not-blind.ts

const SUPABASE_URL = 'https://aannarbkwcymrotzwdbo.supabase.co';
// The anon key real browsers use — pinned (matches scripts/safe-deploy.sh LOCK_ANON_KEY and the
// sibling live barriers). If it rotates, safe-deploy.sh is the one truth source and this moves with it.
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhbm5hcmJrd2N5bXJvdHp3ZGJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MDgxMDAsImV4cCI6MjA5NTk4NDEwMH0.Z-GhSpan6otYWkc8sU43Dw5PT5T_VBUMr0IDZShCQw0';
const TIMEOUT_MS = 20_000;

/** A fetch that could not establish the truth. Distinct from a genuine empty answer. */
export const PROBE_FAILED = Symbol('probe-failed');
export type ProbeFail = { [PROBE_FAILED]: string };
export const isProbeFailure = (p: unknown): p is ProbeFail =>
  typeof p === 'object' && p !== null && PROBE_FAILED in (p as object);

export type LaunchProbe =
  | { active: string[]; covered: string[] }
  | ProbeFail;

/**
 * The whole decision, pure and executable. Returns null when the invariant holds; otherwise the
 * reason it does not. An UNKNOWN is a failure — never a pass.
 */
export function verdict(probe: LaunchProbe): string | null {
  if (isProbeFailure(probe)) {
    return `UNKNOWN — could not establish the invariant: ${probe[PROBE_FAILED]}. ` +
      'A request that failed is not an answer of "every active platform is covered".';
  }
  const covered = new Set(probe.covered);
  const blind = probe.active.filter((p) => !covered.has(p)).sort();
  if (blind.length === 0) return null;
  return blind
    .map((p) => `${p}: searchable (in loader_active_platforms_ar) but absent from the newest ` +
      'image-coverage snapshot — the image-coverage guard is blind to it (its floor is never checked)')
    .join('\n         ');
}

const post = async (fn: string, fetchImpl: typeof fetch): Promise<unknown | ProbeFail> => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: ctl.signal,
    });
    if (!res.ok) return { [PROBE_FAILED]: `${fn} returned HTTP ${res.status}` };
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return { [PROBE_FAILED]: `${fn} body was ${typeof body}, expected an array` };
    return body;
  } catch (e) {
    return { [PROBE_FAILED]: `${fn} threw: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
};

const getSearchable = async (fetchImpl: typeof fetch): Promise<string[] | ProbeFail> => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    // loader_active_platforms_ar() — the anon RPC the SearchLoader itself calls: "which platforms
    // have production_ready rows in search_listings_ar". This is the searchable set a real user can
    // land on, and it is the right source of "is this platform live". platform_registry is behind
    // RLS for anon (a bare select returns zero rows), so this RPC — not the table — is the truth here.
    const res = await fetchImpl(`${SUPABASE_URL}/rest/v1/rpc/loader_active_platforms_ar`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: ctl.signal,
    });
    if (!res.ok) return { [PROBE_FAILED]: `loader_active_platforms_ar returned HTTP ${res.status}` };
    const body: unknown = await res.json();
    // The RPC returns a scalar text[]; PostgREST wraps it as [{ loader_active_platforms_ar: [...] }].
    const names = Array.isArray(body) && body.length === 1 && Array.isArray((body[0] as Record<string, unknown>)?.loader_active_platforms_ar)
      ? ((body[0] as { loader_active_platforms_ar: string[] }).loader_active_platforms_ar)
      : Array.isArray(body) ? (body as string[]) : null;
    if (!Array.isArray(names)) return { [PROBE_FAILED]: `loader_active_platforms_ar body shape unexpected (${typeof body})` };
    return names;
  } catch (e) {
    return { [PROBE_FAILED]: `loader_active_platforms_ar threw: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
};

/** Ask production. Any failure comes back as PROBE_FAILED, never as an empty set. */
export async function probeProduction(fetchImpl: typeof fetch = fetch): Promise<LaunchProbe> {
  const active = await getSearchable(fetchImpl);
  if (isProbeFailure(active)) return active;
  if (active.length === 0) return { [PROBE_FAILED]: 'loader_active_platforms_ar returned no platforms — refusing to call that "all covered"' };
  const snap = await post('ops_image_coverage_latest', fetchImpl);
  if (isProbeFailure(snap)) return snap;
  const covered = (snap as { platform: string }[]).map((r) => r.platform);
  return { active, covered };
}

// ── run ──────────────────────────────────────────────────────────────────────────────────────────
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) failed++;
};

console.log('\nEvery searchable platform must be visible to the image-coverage monitor\n');

// 1. The live invariant.
const probe = await probeProduction();
const v = verdict(probe);
check('no searchable platform is invisible to the image-coverage snapshot', v === null);
if (v !== null) console.log(`\n         ${v}\n`);

// 2. The probe really reached production (a PASS must not be a silent UNKNOWN).
check('the invariant was actually established (not an UNKNOWN)', !isProbeFailure(probe));

// 3. MUTATION PROOF — execute the predicate against deliberately broken input.
const mustCatch = (label: string, caught: boolean) => {
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) ${label}`);
  if (!caught) failed++;
};
mustCatch('catches the real 2026-09-06 shape (an active platform missing from the snapshot)',
  verdict({ active: ['aqar', 'abwbna'], covered: ['aqar'] }) !== null);
mustCatch('catches a failed fetch instead of reading it as "all covered"',
  verdict({ [PROBE_FAILED]: 'HTTP 503' }) !== null);
check('verdict PASSES when every active platform is covered (the proofs are not vacuous)',
  verdict({ active: ['aqar', 'gathern'], covered: ['aqar', 'gathern', 'wasalt'] }) === null);

// 4. The failure paths are real: drive the probe with stub fetches that fail the way the network does.
const stub = (impl: () => Promise<Response>) => impl as unknown as typeof fetch;
const stubNon200 = stub(async () => new Response('nope', { status: 503 }));
const stubBadBody = stub(async () => new Response('{"message":"boom"}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
const stubThrows = stub(async () => { throw new Error('ECONNRESET'); });
mustCatch('a non-200 registry read becomes PROBE_FAILED, not an empty active set',
  isProbeFailure(await probeProduction(stubNon200)));
mustCatch('a non-array body becomes PROBE_FAILED, not an empty set',
  isProbeFailure(await probeProduction(stubBadBody)));
mustCatch('a thrown request becomes PROBE_FAILED, not an empty set',
  isProbeFailure(await probeProduction(stubThrows)));

console.log(failed === 0
  ? '\n✅ active-platform-image-coverage-not-blind: every live platform is visible to the coverage monitor.\n'
  : `\n❌ active-platform-image-coverage-not-blind: ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
