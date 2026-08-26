// The merge gate's transport. ONE way to reach GitHub, usable from every session type.
//
// WHY THIS EXISTS (2026-08-26). `scripts/safe-pr-merge.ts` is the only sanctioned merge path in this
// repo, and it shelled out to the `gh` CLI for all three of its operations. Cloud agent sessions do
// not have `gh` installed — by design, they are given GitHub access through other means — so the
// mandated gate could not execute there AT ALL. The practical result was the worst of both worlds:
// the rule said "never merge without the gate", the gate could not run, and merges happened by hand
// with the conditions re-checked from memory. A safety tool that cannot run in the environment that
// needs it is not a safety tool; it is a rule people route around.
//
// So the transport is now the REST API over plain fetch, which works in a cloud session, in CI, and
// on a laptop. `gh` is still honoured as a CREDENTIAL SOURCE when it is present and no token is in
// the environment, but it is no longer required, and there is still exactly ONE code path through
// the gate — only the way the bytes arrive changed, never the decision.
//
// EVERY function here fails CLOSED. A call that cannot be completed throws; it never returns a
// permissive default. That is the whole point: the previous `requiredContexts()` swallowed its own
// failure and returned `[]`, which silently disabled the required-check half of the gate for anyone
// whose token could not read branch protection.

import { execFileSync } from 'node:child_process';

export type PrState = {
  number: number;
  headSha: string;
  baseRef: string;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  mergeStateStatus: string;
  files: string[];
};

export type RawCheck = { context: string; conclusion: string | null };

function token(): string {
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (env) return env;
  // `gh` is optional and only ever a credential source — never a required transport.
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new Error(
      'no GitHub credential: set GITHUB_TOKEN (or GH_TOKEN), or authenticate the gh CLI. ' +
      'The merge gate FAILS CLOSED rather than merging unverified.',
    );
  }
}

export function repoSlug(): string {
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  const m = url.match(/[:/]([^/]+\/[^/]+?)(\.git)?$/);
  if (!m) throw new Error(`could not parse owner/repo from remote URL: ${url}`);
  return m[1];
}


// ── Proxy: the one line that made this transport work in a cloud session ─────────────────────────
// Cloud agent sessions route egress through a policy proxy (HTTPS_PROXY) that injects the real
// GitHub credential — the token in the environment is only a placeholder. Node's built-in fetch
// does NOT read HTTPS_PROXY unless NODE_USE_ENV_PROXY is set (Node >= 22.21), which is why a plain
// fetch here returned 401 "Bad credentials" while curl to the same URL succeeded. Setting it before
// the process starts is the proxy's own documented fix (/root/.ccr/README.md, "Tool ignores the
// proxy entirely"). It CANNOT be set from here — undici builds its global dispatcher before this
// module body runs — so the entrypoint (scripts/safe-pr-merge.ts) re-execs itself once with it set.
// This note exists so nobody "helpfully" adds an assignment here and believes it took effect.

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ezhalah-safe-pr-merge',
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`GitHub ${init?.method ?? 'GET'} ${path} -> ${res.status}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}

/** REST reports `mergeable` as a nullable boolean; the gate speaks GraphQL's tri-state. A null
 *  (GitHub has not finished computing mergeability) is UNKNOWN, and UNKNOWN blocks — never assume. */
function triState(mergeable: boolean | null | undefined): PrState['mergeable'] {
  if (mergeable === true) return 'MERGEABLE';
  if (mergeable === false) return 'CONFLICTING';
  return 'UNKNOWN';
}

export async function getPr(slug: string, n: string): Promise<PrState> {
  const pr = (await api(`/repos/${slug}/pulls/${n}`)) as Record<string, any>;
  const files: string[] = [];
  // Paginate: a truncated file list would silently weaken the --expect-files comparison.
  for (let page = 1; ; page++) {
    const chunk = (await api(`/repos/${slug}/pulls/${n}/files?per_page=100&page=${page}`)) as Array<{ filename: string }>;
    files.push(...chunk.map((f) => f.filename));
    if (chunk.length < 100) break;
  }
  return {
    number: pr.number,
    headSha: pr.head.sha,
    baseRef: pr.base.ref,
    mergeable: triState(pr.mergeable),
    mergeStateStatus: String(pr.mergeable_state ?? 'unknown'),
    files,
  };
}

/** Every check result reported for this exact SHA: modern check-runs AND legacy commit statuses.
 *  A required context may be either kind, so reading only one of them can leave a required context
 *  looking "absent" (which blocks, correctly) or — worse — miss a failing legacy status entirely. */
export async function getChecks(slug: string, sha: string): Promise<RawCheck[]> {
  const out: RawCheck[] = [];
  for (let page = 1; ; page++) {
    const r = (await api(`/repos/${slug}/commits/${sha}/check-runs?per_page=100&page=${page}`)) as {
      check_runs: Array<{ name: string; status: string; conclusion: string | null }>;
    };
    for (const c of r.check_runs) {
      // A check that has not COMPLETED has no conclusion yet — represent that as null (PENDING),
      // never as a pass.
      out.push({ context: c.name, conclusion: c.status === 'completed' ? c.conclusion : null });
    }
    if (r.check_runs.length < 100) break;
  }
  const st = (await api(`/repos/${slug}/commits/${sha}/status`)) as {
    statuses: Array<{ context: string; state: string }>;
  };
  for (const s of st.statuses) out.push({ context: s.context, conclusion: s.state });
  return out;
}

export type RequiredContexts = { known: true; contexts: string[]; source: string } | { known: false; why: string };

/** The required-status-check contract, read WITHOUT admin scope.
 *
 *  `/branches/{base}/protection` needs admin and 403s for an ordinary token — that 403 is exactly
 *  what the old code swallowed into an empty list. `/branches/{base}` needs only read and carries
 *  the same `protection.required_status_checks.contexts`, so the contract is fully readable from a
 *  cloud session. Admin-only endpoint first (richer), plain branch second, and if NEITHER can be
 *  read we return known:false so the caller REFUSES. Unverifiable is never permissive. */
export async function getRequiredContexts(slug: string, base: string): Promise<RequiredContexts> {
  try {
    const p = (await api(`/repos/${slug}/branches/${base}/protection`)) as Record<string, any>;
    const ctx = p?.required_status_checks?.contexts;
    if (Array.isArray(ctx)) return { known: true, contexts: ctx, source: 'branches/protection (admin)' };
  } catch {
    /* fall through to the non-admin read */
  }
  const b = (await api(`/repos/${slug}/branches/${base}`)) as Record<string, any>;
  const ctx = b?.protection?.required_status_checks?.contexts;
  if (Array.isArray(ctx)) return { known: true, contexts: ctx, source: 'branches/{base}.protection' };
  // Reached the branch, and it reports no protection at all. That is a KNOWN answer — the branch
  // genuinely requires nothing — not an unreadable one. decideMerge still refuses to merge while
  // ANY reported check is non-SUCCESS, so "no protection configured" does not mean "anything goes".
  if (b && b.protection && b.protection.enabled === false) return { known: true, contexts: [], source: 'protection disabled' };
  return { known: false, why: `could not read required_status_checks for ${base} from either protection endpoint` };
}

/** Merge, pinned to the exact SHA the gate verified.
 *
 *  `gh pr merge` cannot do this: it merges whatever the head is at the moment the call lands. If a
 *  push arrives between the verification and the merge, the old path would merge code no check ever
 *  ran against — the 2026-08-24 incident's own failure mode, one step later. Passing `sha` makes
 *  GitHub itself reject the merge (409) when the head has moved, so the race is closed on the
 *  server, not hoped away on the client. */
export async function mergePr(slug: string, n: string, sha: string): Promise<{ sha: string; merged: boolean }> {
  const r = (await api(`/repos/${slug}/pulls/${n}/merge`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ merge_method: 'squash', sha }),
  })) as { sha: string; merged: boolean };
  return r;
}
