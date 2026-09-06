// A BARRIER THAT SPLIT OFF ITS LIVE HALF MUST BE ABLE TO PROVE THE LIVE HALF STILL RUNS.
//
// WHY THIS EXISTS (routine #10, ops_incident #104, 2026-09-06). Several barriers were one file
// doing two incompatible jobs: a HERMETIC predicate + mutation proof (which belongs in the required
// per-PR `npm test`), and a LIVE read of production (which does not — its verdict is decided by
// production's state and by a stopwatch, so it fails unrelated PRs on unchanged code). The repair is
// to split them. The split is only safe if the live half provably still executes SOMEWHERE, because
// otherwise "moved out of npm test" and "silently deleted" look identical from inside the suite.
//
// So this is the predicate every offline half runs against its own live sibling: the live file
// exists, it has a declared row in scripts/test-exclusions.txt, that row names a WORKFLOW (not
// `manual`, which is how scripts/test-exclusions.txt becomes a graveyard), and that workflow
// ACTUALLY INVOKES it — asked with workflowInvokes(), never a bare `src.includes(name)`. On
// 2026-09-03 that exact shortcut left two checks named only by a workflow COMMENT saying they were
// deliberately NOT run there, and neither had executed anywhere for weeks.
//
// Everything is injected — the registry, the existence test, the workflow reader — so the rule can
// be fed a broken world and watched to fail. `scripts/verify-live-half-homing.ts` does exactly that.
import { workflowInvokes } from './testRegistry.ts';

/**
 * How a live half must judge an RPC response — the ONE rule, shared by every split live check.
 *
 * This exists because the dominant defect class in this repo is a request that FAILED being rendered
 * as a confident negative: "there are no listings in this location" for a region holding 32,203.
 * AGENTS.md states it as a permanent rule — **A FAILED FETCH IS NOT AN EMPTY ANSWER** — and it binds
 * the verification layer exactly as it binds the product. A coverage check that cannot reach its
 * subject and reports "no gaps found" is a manufactured clean bill of health.
 *
 * So there are three outcomes and never two: only `ok` may be interpreted as data. `not-shipped`
 * (PGRST202) is distinguished from a generic failure because it means the migration has not been
 * applied yet, which is a different repair — but it is still a FAILURE, never a skip.
 */
export type RpcOutcome = 'ok' | 'not-shipped' | 'unreachable';

export const rpcProbeOutcome = (status: number): RpcOutcome =>
  status === 200 ? 'ok' : status === 404 ? 'not-shipped' : 'unreachable';

/** Only `ok` carries data. Everything else fails the check — closed, loudly, never silently. */
export const outcomeIsUsable = (o: RpcOutcome): boolean => o === 'ok';

export type ExclusionLike = { name: string; where: string };
export type RegistryLike = { excluded: ExclusionLike[] };

/**
 * Returns the reasons `liveName` is NOT provably still running. Empty means it is homed and invoked.
 *
 * @param liveName      bare filename of the live half, e.g. 'verify-x-live.ts'
 * @param registry      the parsed test registry (loadRegistry(root))
 * @param fileExists    does scripts/<liveName> exist on disk?
 * @param readWorkflow  read a repo-relative workflow path; null when it cannot be read
 */
export function liveHalfProblems(
  liveName: string,
  registry: RegistryLike,
  fileExists: (bareName: string) => boolean,
  readWorkflow: (repoRelPath: string) => string | null,
): string[] {
  const problems: string[] = [];

  if (!fileExists(liveName)) {
    // The whole point of the split is that the live assertion survives it. If the file is gone, the
    // class has NO live coverage at all — and the offline half would otherwise still read green.
    problems.push(`scripts/${liveName} does not exist — the live half was deleted, not relocated, `
      + 'so this class has no live coverage anywhere');
    return problems;
  }

  const row = registry.excluded.find((e) => e.name === liveName);
  if (!row || !row.where) {
    problems.push(`no row for ${liveName} in scripts/test-exclusions.txt — a check that is neither `
      + 'in npm test nor declared with a home runs nowhere and is counted by nobody');
    return problems;
  }

  if (!row.where.startsWith('.github/')) {
    // 'manual / live run' is a promise nothing keeps. A relocated half needs a trigger, not an
    // intention: this is the difference between moving a check and retiring it without saying so.
    problems.push(`${liveName} is homed at "${row.where}", which is not a workflow — a live half `
      + 'split out of the required suite must land somewhere that actually fires on its own');
    return problems;
  }

  const src = readWorkflow(row.where);
  if (src === null) {
    problems.push(`${liveName} names ${row.where}, which cannot be read — a home that does not `
      + 'exist is not a home');
    return problems;
  }

  if (!workflowInvokes(src, liveName)) {
    problems.push(`${row.where} does not invoke ${liveName} (asked with workflowInvokes, which `
      + 'strips comments first — a workflow that only MENTIONS a check in a comment runs nothing)');
  }

  return problems;
}
