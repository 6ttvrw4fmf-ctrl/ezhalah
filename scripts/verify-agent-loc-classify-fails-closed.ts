// FAIL CLOSED, NOT OPEN — regression guard for the 2026-08-31 loc_classify production incident.
//
// loc_classify() is the DB-authoritative backstop deciding whether a user-typed location is a real
// twin (city/district) or a region-vs-city same-name ambiguity. The edge function's locClassify()
// helper used to fail OPEN on any error (`return null`, no timeout at all): a genuine RPC failure
// was silently treated as "unambiguous", so the agent proceeded on the model's raw location string
// as if it had been confirmed — risking a silent guess between two real, different places. See
// [[project_loc_classify_postgrest_timeout_incident]] and docs/LOCATION_SYSTEM.md.
//
// THIS BARRIER, in two parts:
//   1. EXECUTES the real locClassify()/locClassifyOnce() (extracted from the actual edge-function
//      source via scripts/lib/extractRealLocClassify.ts — never a re-typed copy, so it cannot pass
//      on a stale duplicate; see [[feedback_never-test-a-copy-of-production-code]]) against a mocked
//      `fetch`, proving the REAL bounded-timeout + one-retry + fail-closed-sentinel behaviour.
//   2. Asserts the CALL SITE (which cannot be cleanly extracted — it is inline in the 2,000+ line
//      runModel(), reading a dozen turn-scoped locals) reacts to that sentinel by clearing the
//      location term, and does so BEFORE it ever reads `cls?.kind` — a structural, not identifier,
//      assertion (see [[feedback_a-comment-is-not-a-code-path]]: a bare mention proves nothing).
//
// MUTATION-PROVEN: reverting supabase/functions/agent/index.ts's locClassify() to the pre-fix shape
// (`try { ...; if (!r.ok) return null; return await r.json(); } catch { return null; }`, no
// AbortController, no retry, no sentinel) makes checks (a)-(f) below fail — verified by hand during
// the fix (git stash the fix, run this file, confirm RED; restore, confirm GREEN) before shipping.
//
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/verify-agent-loc-classify-fails-closed.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRealLocClassify } from "./lib/extractRealLocClassify.ts";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ""}`);
};

const root = join(import.meta.dirname, "..");
const realFetch = globalThis.fetch;
const realSetTimeout = globalThis.setTimeout;

// Fires every timer at once instead of waiting real wall-clock ms — the abort/retry SHAPE is what
// these checks prove, not literal wall-clock time (the live latency bound has its own separate,
// deliberately-excluded-from-npm-test check: scripts/verify-loc-classify-postgrest-latency.ts).
function withInstantTimers<T>(fn: () => Promise<T>): Promise<T> {
  // @ts-ignore — test-only monkeypatch, restored in the finally below.
  globalThis.setTimeout = ((cb: (...a: unknown[]) => void, _ms?: number, ...args: unknown[]) =>
    realSetTimeout(cb, 0, ...args)) as typeof setTimeout;
  return fn().finally(() => { globalThis.setTimeout = realSetTimeout; });
}

function mockFetchSequence(behaviors: Array<"ok" | "http500" | "reject" | "hang">) {
  let calls = 0;
  // @ts-ignore — test-only monkeypatch.
  globalThis.fetch = async (_url: string, init?: { signal?: AbortSignal }) => {
    const behavior = behaviors[calls] ?? behaviors[behaviors.length - 1];
    calls++;
    if (behavior === "ok") return { ok: true, status: 200, json: async () => ({ kind: "city", name: "جدة" }) };
    if (behavior === "http500") return { ok: false, status: 500, json: async () => ({}) };
    if (behavior === "reject") throw new Error("network error");
    // "hang": never resolves on its own — only settles if/when the real AbortController fires.
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  };
  return () => calls;
}

async function main() {
  const { locClassify, LOC_CLASSIFY_FAILED, LOC_CLASSIFY_TIMEOUT_MS } = await loadRealLocClassify();

  console.log("\n(a) a clean first response is returned as-is, exactly one fetch\n");
  {
    const getCalls = mockFetchSequence(["ok"]);
    const r = await locClassify("جدة");
    check("returns the real classify object", r !== null && r !== LOC_CLASSIFY_FAILED && (r as Record<string, unknown>).kind === "city", JSON.stringify(r));
    check("exactly one fetch — no wasted retry on success", getCalls() === 1, `calls=${getCalls()}`);
  }

  console.log("\n(b) an HTTP error on BOTH attempts fails CLOSED, never null\n");
  {
    const getCalls = mockFetchSequence(["http500", "http500"]);
    const r = await withInstantTimers(() => locClassify("العزيزية"));
    check("returns LOC_CLASSIFY_FAILED, not null (null already means \"empty token\")", r === LOC_CLASSIFY_FAILED, JSON.stringify(r));
    check("retried exactly once (two attempts total)", getCalls() === 2, `calls=${getCalls()}`);
  }

  console.log("\n(c) a network error on BOTH attempts fails CLOSED\n");
  {
    const getCalls = mockFetchSequence(["reject", "reject"]);
    const r = await withInstantTimers(() => locClassify("الحفيرة"));
    check("returns LOC_CLASSIFY_FAILED on a thrown/rejected fetch", r === LOC_CLASSIFY_FAILED, JSON.stringify(r));
    check("retried exactly once", getCalls() === 2, `calls=${getCalls()}`);
  }

  console.log("\n(d) fails once, then succeeds — the retry actually RECOVERS\n");
  {
    const getCalls = mockFetchSequence(["http500", "ok"]);
    const r = await withInstantTimers(() => locClassify("الرياض"));
    check("second attempt's real data is returned, not FAILED", r !== null && r !== LOC_CLASSIFY_FAILED, JSON.stringify(r));
    check("used exactly two attempts to recover", getCalls() === 2, `calls=${getCalls()}`);
  }

  console.log("\n(e) a hung request is BOUNDED — the AbortController is really wired in\n");
  {
    const getCalls = mockFetchSequence(["hang", "hang"]);
    let timedOutAt = -1;
    // @ts-ignore — capture the real timeout constant threaded into the real setTimeout call.
    globalThis.setTimeout = ((cb: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
      if (ms === LOC_CLASSIFY_TIMEOUT_MS) timedOutAt = ms;
      return realSetTimeout(cb, 0, ...args);
    }) as typeof setTimeout;
    let r: unknown;
    try { r = await locClassify("حي العزيزية"); } finally { globalThis.setTimeout = realSetTimeout; }
    check("a request that never resolves still terminates with LOC_CLASSIFY_FAILED (not an infinite hang)", r === LOC_CLASSIFY_FAILED, JSON.stringify(r));
    check(`the real AbortController timer used LOC_CLASSIFY_TIMEOUT_MS (${LOC_CLASSIFY_TIMEOUT_MS}ms), not an unbounded/missing timeout`, timedOutAt === LOC_CLASSIFY_TIMEOUT_MS, `saw ms=${timedOutAt}`);
    check("attempted exactly twice even though neither call ever resolved on its own", getCalls() === 2, `calls=${getCalls()}`);
  }

  console.log("\n(f) LOC_CLASSIFY_TIMEOUT_MS carries real headroom over the fixed query's measured cost\n");
  // Measured live via the real PostgREST path after the DB fix (search_listings_ar swap): the
  // heaviest of the three known ambiguity cases (twin_district, 53 candidates) took ~2.7s wall.
  // The timeout must clear that with real margin, and must not have regressed back toward the old
  // unbounded (Infinity-equivalent) or an accidentally-too-tight value that would fire on a healthy
  // response.
  check(`LOC_CLASSIFY_TIMEOUT_MS (${LOC_CLASSIFY_TIMEOUT_MS}ms) has real headroom over the ~2.7s measured fixed cost`,
    LOC_CLASSIFY_TIMEOUT_MS >= 4000 && LOC_CLASSIFY_TIMEOUT_MS <= 15000,
    "expected something in [4000, 15000]ms: enough headroom to not fire on a healthy response, bounded enough to never again hang the turn");

  globalThis.fetch = realFetch;

  // ── THE CALL SITE ────────────────────────────────────────────────────────────────────────────
  // locClassify()'s sentinel is only half the fix — index.ts's runModel() must actually react to it.
  // This half of runModel() closes over ~15 turn-scoped locals (out, text, history, prevQuery,
  // askCount, …) and cannot be cleanly extracted the way extractRealLocClassify.ts extracts a pure
  // function, so it is asserted structurally instead — SHAPE, not a bare identifier mention, so a
  // mutation that keeps the string around in a comment while deleting the real branch still fails.
  console.log("\n(g) the call site actually clears `location` on LOC_CLASSIFY_FAILED — never guesses\n");
  const agentSrc = readFileSync(join(root, "supabase/functions/agent/index.ts"), "utf8");

  check("the OLD fail-open shape (`if (!r.ok) return null;`) is gone from the source",
    !/if\s*\(!r\.ok\)\s*return null;/.test(agentSrc),
    "this exact line is the pre-fix bug: an RPC error silently became \"proceed unchanged\"");
  check("the OLD blanket catch-swallow (`catch { return null; }`) is gone",
    !/catch\s*\{\s*return null;\s*\}/.test(agentSrc),
    "a bare catch-returns-null cannot distinguish a real failure from an empty token");

  const callSiteIdx = agentSrc.indexOf("const cls = await locClassify(location);");
  check("locClassify(location) is still called exactly where the backstop runs", callSiteIdx >= 0);
  const guardMatch = /if\s*\(cls\s*===\s*LOC_CLASSIFY_FAILED\)\s*\{\s*(?:\/\/[^\n]*\n\s*)*location\s*=\s*"";/.exec(agentSrc);
  check("`location = \"\"` is a REAL statement inside `if (cls === LOC_CLASSIFY_FAILED) { … }` (not a comment)",
    !!guardMatch, "the assignment must be the guarded branch's own bare statement");
  const ckIdx = agentSrc.indexOf('const ck = String(cls?.kind ?? "");');
  check("the failure check runs BEFORE `cls?.kind` is ever read — a reorder could dodge the guard while both strings stay present",
    guardMatch !== null && ckIdx > 0 && agentSrc.indexOf(guardMatch[0]) < ckIdx,
    `guardAt=${guardMatch ? agentSrc.indexOf(guardMatch[0]) : -1} ckAt=${ckIdx}`);

  // The four genuine-classification branches must be UNTOUCHED — this fix only adds a sibling
  // failure branch, it must never alter what a DB-confirmed kind does (owner requirement: preserve
  // «منطقة X» → Region semantics exactly as they work today).
  for (const mustStillExist of [
    'if (ck === "region_or_city")',
    'else if (ck === "twin_city")',
    'else if (ck === "twin_district")',
    'else if (ck === "region" && !alreadyAsked)',
    "location = `منطقة ${nm}`", // the explicit «منطقة X» → Region reconstruction, byte-for-byte
  ]) {
    check(`untouched: ${mustStillExist}`, agentSrc.includes(mustStillExist));
  }

  console.log(failures === 0
    ? "\n✅ verify-agent-loc-classify-fails-closed: all checks passed.\n"
    : `\n❌ verify-agent-loc-classify-fails-closed: ${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
