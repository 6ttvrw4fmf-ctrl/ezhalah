// A CHECK THAT GATES SOMEBODY ELSE'S PR MUST SURVIVE A SCHEMA-CACHE RELOAD (routine #10, 2026-09-23).
//
// THE DEFECT, measured. At 23:31:46Z `scripts/verify-p0-fast-lane-detection.ts` reported
// `UNREADABLE — HTTP 503 {"code":"PGRST002"}` on TWO unrelated PRs at once, 96 seconds after an
// unrelated session applied migration 20260923233010. Four function-creating migrations landed from
// three concurrent sessions inside twelve minutes that evening. PGRST002 is PostgREST reloading its
// schema cache — which is what ANY migration creating or replacing a function triggers — so every
// one of those windows fails whoever happens to have a PR open.
//
// This is ops_incident #573's class. The repair for it (scripts/lib/postgrestRetry.ts) was wired
// into the four live-reaching checks inside the REQUIRED `npm test` and stopped there. The checks
// that gate a PR from a WORKFLOW have exactly the same blast radius and got nothing, and nothing in
// the repo could tell you that: #573's own barrier proves the driver, not who uses it — a proof
// about a mechanism is not a measurement of its coverage.
//
// THE POPULATION, and why it is defined this way. A workflow with a `pull_request` trigger blocks a
// contributor's merge. A scheduled-only workflow going red wakes an owner and blocks nobody, so it
// is deliberately OUT: the rule earns its keep by being narrow enough that nobody wants to weaken
// it. `npm test` is out too — its members are covered by #573 already and by the hermeticity ratchet.
//
// NOT A STYLE RULE. The driver retries ONLY a 503 whose JSON `code` is exactly PGRST002, is bounded
// (~30s), and returns the LAST probe as-is, so an unbroken reload still fails. Adopting it cannot
// make any check more permissive about anything else; refusing it means a required PR gate whose
// verdict is decided by whoever applied a migration in the last minute.

import { networkCallArguments } from './liveReach.ts';

/** Everything the rule needs about one workflow, so a proof can hand it a world that does not exist. */
export type WorkflowFile = { path: string; source: string };

/** Everything the rule needs about one check script. */
export type CheckSource = { name: string; source: string };

/** A `pull_request` trigger, read off the `on:` block rather than anywhere in the file. */
export function hasPullRequestTrigger(source: string): boolean {
  // `pull_request_target` is deliberately NOT matched by the word boundary below: this repo bans it
  // for these workflows, and a file that somehow used it would be a different finding.
  const on = source.replace(/^\s*#.*$/gm, '');
  return /(^|\n)\s*(on:\s*)?[-\s]*pull_request\s*:/.test(on) || /(^|\n)\s*-\s*pull_request\s*$/m.test(on);
}

/** Scripts a workflow actually invokes. Comment lines are stripped first: a mention is not a run. */
export function scriptsInvokedBy(source: string): string[] {
  const code = source.replace(/^\s*#.*$/gm, '');
  return [...new Set([...code.matchAll(/scripts\/(verify-[a-z0-9-]+\.(?:ts|mjs))/g)].map((m) => m[1]))];
}

/**
 * Does this check really FETCH PostgREST — as opposed to merely naming the path?
 *
 * The distinction is load-bearing and was measured on the first run of the barrier over this file:
 * a bare `/\/rest\/v1\//.test(source)` counted scripts/verify-web-runtime-smoke.mjs, whose only
 * matches are Playwright interception patterns (`page.route('**\/rest/v1/rpc/…')`). Those name a
 * path and call nothing — and a browser's own requests could not be routed through a Node driver
 * anyway — so the naive reader put a browser-driving check onto a baseline it never belonged on,
 * which is how a ratchet starts over-reporting and hiding real growth underneath itself.
 *
 * networkCallArguments() is imported rather than re-implemented: a second copy of that walk is the
 * hand-copied-logic class this routine exists to remove.
 */
export const readsPostgrest = (source: string): boolean =>
  networkCallArguments(source).some((a) => a.includes('/rest/v1/'));

/** Does it route that read through the canonical driver? */
export const usesSchemaCacheDriver = (source: string): boolean =>
  /from\s+['"][^'"]*lib\/postgrestRetry\.ts['"]/.test(source);

export type Unprotected = { check: string; workflow: string };

/**
 * Returns every check that gates a PR, reads PostgREST, and does NOT route through the driver.
 *
 * `readCheck` returns a check's source, or null when it cannot be read. An unreadable check is
 * REPORTED, never skipped: a rule that treats "I could not look" as "nothing wrong" is the
 * manufactured negative this routine exists to remove.
 */
export function unprotectedPrGates(
  workflows: WorkflowFile[],
  readCheck: (name: string) => string | null,
): Unprotected[] {
  const out: Unprotected[] = [];
  const seen = new Set<string>();
  for (const wf of workflows) {
    if (!hasPullRequestTrigger(wf.source)) continue;
    for (const name of scriptsInvokedBy(wf.source)) {
      if (seen.has(name)) continue;
      const src = readCheck(name);
      if (src === null) {
        seen.add(name);
        out.push({ check: name, workflow: wf.path });
        continue;
      }
      if (!readsPostgrest(src)) continue;
      if (usesSchemaCacheDriver(src)) continue;
      seen.add(name);
      out.push({ check: name, workflow: wf.path });
    }
  }
  return out;
}
