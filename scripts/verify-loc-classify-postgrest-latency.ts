// LIVE production check: loc_classify() over the REAL PostgREST path (not a privileged SQL
// session) must resolve the three known ambiguity shapes correctly and FAST.
//
// WHY THIS EXISTS (2026-08-31 incident). loc_classify()'s candidate subqueries were scanning the
// unindexed listing_native_location_v2 VIEW once per catalog candidate row — ~31s per row, ~5.8M
// buffer hits, measured live via EXPLAIN ANALYZE. Over the real PostgREST path (anon/authenticated
// statement_timeout=20s) even the simplest case ("الرياض", one candidate row) reproduced as a live
// HTTP 500 `{"code":"57014","message":"canceling statement due to statement timeout"}` at ~20.5s.
// Fixed by pointing both correlated subqueries at the indexed search_listings_ar table instead
// (migration 20260831020730). This check is the permanent guard against that regressing — e.g. an
// index dropped, the migration reverted, or the view swapped back — via the SAME path real traffic
// uses, with a real publishable key, not scripts/verify-agent-loc-classify-fails-closed.ts's mocked
// unit test of the edge function's own retry/timeout wrapper (that one is deterministic and runs in
// npm test; this one is live and does not — see scripts/test-exclusions.txt).
//
// DELIBERATELY NOT IN `npm test`: a live network call to production can flake on backend load
// (same reasoning AGENTS.md gives for verify-migration-drift-vs-production.ts and every other
// *-live.ts check in test-exclusions.txt) — npm test is a required status check on every PR, and a
// momentary production blip must not fail unrelated work. Run via `npm run verify:loc-classify-latency`,
// or wire into a scheduled workflow alongside the other live-production checks when one exists for
// this surface.
//
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/verify-loc-classify-postgrest-latency.ts

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "https://aannarbkwcymrotzwdbo.supabase.co";
// Public by design (same key hardcoded in scripts/agent-surface.sh's `smoke` verb and shipped in
// the app bundle) — used only as a fallback so this check can never be skipped for want of a
// credential. A real env var, if present, is preferred.
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhbm5hcmJrd2N5bXJvdHp3ZGJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MDgxMDAsImV4cCI6MjA5NTk4NDEwMH0.Z-GhSpan6otYWkc8sU43Dw5PT5T_VBUMr0IDZShCQw0";

// Real headroom over the ~0.3-2.7s measured live after the fix, comfortably under the anon-role
// PostgREST statement_timeout (20s) — regresses loudly long before a real user would ever time out.
const LATENCY_BOUND_MS = 8000;

const CASES: Array<{ token: string; expectKind: string; label: string }> = [
  { token: "الرياض", expectKind: "region_or_city", label: "region_or_city (single candidate — the case that reproduced the incident at 20.5s)" },
  { token: "الحفيرة", expectKind: "twin_city", label: "twin_city (~5 regions)" },
  { token: "حي العزيزية", expectKind: "twin_district", label: "twin_district (~53 candidates — the heaviest known shape)" },
];

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ""}`);
};

async function main() {
  for (const { token, expectKind, label } of CASES) {
    const ac = new AbortController();
    const hardStop = setTimeout(() => ac.abort(), LATENCY_BOUND_MS + 5000); // let a slow call finish enough to report its own timing, don't hang the script
    const t0 = performance.now();
    let status = 0;
    let body: Record<string, unknown> | null = null;
    let errText = "";
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/loc_classify`, {
        method: "POST",
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ p_token: token }),
        signal: ac.signal,
      });
      status = r.status;
      body = await r.json().catch(() => null);
    } catch (e) {
      errText = String((e as Error)?.message ?? e);
    } finally {
      clearTimeout(hardStop);
    }
    const elapsedMs = performance.now() - t0;

    console.log(`\n"${token}" — ${label}`);
    check(`HTTP 200 (real PostgREST path, anon key) — ${errText || `status=${status}`}`, status === 200, JSON.stringify(body).slice(0, 300));
    check(`kind === "${expectKind}"`, body?.kind === expectKind, `got kind=${JSON.stringify(body?.kind)}`);
    check(`completed within ${LATENCY_BOUND_MS}ms (real headroom over the fixed ~0.3-2.7s baseline) — took ${elapsedMs.toFixed(0)}ms`,
      elapsedMs < LATENCY_BOUND_MS);
  }

  console.log(failures === 0
    ? "\n✅ verify-loc-classify-postgrest-latency: all checks passed.\n"
    : `\n❌ verify-loc-classify-postgrest-latency: ${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
