// Navigating to production from a live check, without turning a transport hiccup into a red barrier
// — and without ever hiding a real one.
//
// WHY THIS EXISTS (2026-09-02). The post-deploy run of verify-af-live-truth.ts failed twice in a row,
// on a DIFFERENT journey each time, both with the same error before a single assertion had run:
//
//     Error: page.goto: net::ERR_TIMED_OUT at https://ezhalah-app.vercel.app/
//       - navigating to "…", waiting until "domcontentloaded"
//
// The app was fine: 20 of 20 sequential `curl` loads returned 200 from the same container in the same
// minute, and the other four live browser checks were green against the same bundle. What differs is
// volume — verify-af-live-truth.ts navigates NINE times per run where the others navigate once, so it
// draws nine chances at the hiccup. The container's egress proxy is also rejecting every listing-photo
// CDN the page requests (1,656 refused CONNECTs observed in one earlier browser run), so Chromium's
// network stack is contending with hundreds of failing subresource fetches while the document loads.
//
// "Flake" is not a root cause and is not what this claims. The root cause is that a check which must
// answer "is the deployed app correct?" was letting "did one TCP connection complete?" decide the
// answer, with one attempt and no distinction between the two questions.
//
// SO: retry the TRANSPORT, never an assertion, and stay fail-closed.
//   • only the initial navigation is retried — nothing that has observed app behaviour;
//   • exhausting the attempts still THROWS, so a genuine outage is still a red barrier;
//   • the thrown message says the page never loaded, so a reader can tell an unreachable site from a
//     wrong one — the distinction the single-attempt version could not make;
//   • a retry that succeeds is PRINTED, so a degrading network shows up as noise in the log instead of
//     silently costing wall-clock.
//
// Structurally typed on purpose: no import from 'playwright' here, so the offline barrier can execute
// this against a fake page and prove both directions.

/** The one method this helper needs. Structural, so a test can supply a fake. */
export type Navigable = {
  goto: (url: string, opts: { waitUntil: 'domcontentloaded'; timeout: number }) => Promise<unknown>;
};

export type GotoLiveOptions = {
  /** Total attempts, including the first. Default 3. */
  attempts?: number;
  /** Per-attempt navigation timeout in ms. Default 60_000. */
  timeout?: number;
  /** Backoff base in ms; attempt N waits N × this. Default 2_000. Set 0 in tests. */
  backoffMs?: number;
  /** Where the retry notice goes. Default console.log. */
  log?: (msg: string) => void;
  /** Sleep hook, so a test does not actually wait. */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Load `url`, retrying only a failed navigation. Returns the attempt number that succeeded (1 when
 * the first try worked). Throws when every attempt fails — the caller must NOT swallow that: it means
 * the page never loaded, so nothing after it was tested.
 */
export async function gotoLive(
  page: Navigable, url: string, opts: GotoLiveOptions = {},
): Promise<number> {
  const attempts = opts.attempts ?? 3;
  const timeout = opts.timeout ?? 60_000;
  const backoffMs = opts.backoffMs ?? 2_000;
  const log = opts.log ?? ((m: string) => console.log(m));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const failures: string[] = [];

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      if (attempt > 1) log(`      [nav] ${url} loaded on attempt ${attempt}/${attempts}`);
      return attempt;
    } catch (e) {
      failures.push(`attempt ${attempt}: ${String(e).split('\n')[0]}`);
      if (attempt < attempts) await sleep(backoffMs * attempt);
    }
  }
  throw new Error(
    `could not load ${url} in ${attempts} attempt(s) — the PAGE NEVER LOADED, so nothing after this `
    + `was tested. This is an availability or transport failure, not a wrong result:\n  `
    + failures.join('\n  '),
  );
}
