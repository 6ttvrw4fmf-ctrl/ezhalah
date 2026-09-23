// A CHECK CAN REACH PRODUCTION WITHOUT IMPORTING THE ONE MODULE THAT KNOWS THE ENDPOINT.
//
// WHY THIS EXISTS (routine #10, 2026-09-23, the ops_incident #391 pattern applied to the repo half).
// verify-required-suite-is-hermetic.ts discovers live-reaching checks by walking the module graph for
// a transitive import of scripts/lib/public-supabase.ts. That is the right primary arm and it stays.
// But it is a CANDIDATE SET, and a candidate set is a blind spot nobody measures: everything that
// reaches production by any OTHER route is excluded before the assertion ever runs, so the barrier
// reads clean over a class it cannot see. Its printed line — `required run set: 511 · live-reaching
// candidates: 9` — reads as a measurement of the class and is a measurement of one import edge.
//
// MEASURED, by planting the mutant. A four-line check placed in scripts/ (therefore in the REQUIRED
// `npm test`, by discovery) doing a bare
//
//     await fetch('https://<project>.supabase.co/rest/v1/', { signal: AbortSignal.timeout(5000) })
//
// really reached production — HTTP 401 from the live endpoint — and passed EVERY meta-guard:
// verify-required-suite-is-hermetic.ts exit 0, verify-test-registry-complete.ts exit 0, and
// verify-new-barriers-are-mutation-proven.ts exit 0 once a single mustCatch line was added. Nothing
// in the repo would have noticed a required check whose verdict is decided by production.
//
// MEASURED AT THE SAME TIME, and the reason this is a latent risk rather than a live outage: of the
// eight files in scripts/verify-* that name a `*.supabase.co` host without importing the resolver,
// ZERO reach it — four are excluded from `npm test` entirely, and the four inside it hold the host
// only in a fixture env object, an error-message fixture, or an assertion about a shell script's
// source. Those four are this predicate's named negative controls.
//
// WHAT THIS IS NOT. It is not a grep for a hostname; a grep flags all eight. The question it answers
// is whether a production host reaches a NETWORK CALL — either written directly into the call's
// arguments, or bound to an identifier that is then passed to one. The residual gap is stated rather
// than hidden: a URL composed at runtime from fragments, or fetched through an indirection this
// reader cannot follow, is still invisible here. The module-graph arm and this one are complements,
// and neither is exhaustive alone.

import { stripComments } from './stripComments.ts';

/** Hosts that are production, wherever they appear. Any Supabase project host counts, not just ours. */
export const PRODUCTION_HOST = /https?:\/\/[A-Za-z0-9.-]*(?:\.supabase\.co|ezhalah-app\.vercel\.app)/;

/**
 * Calls that open a socket, or can. `execSync` and friends are here because
 * `execSync('curl https://…')` reaches production exactly as `fetch` does, and a barrier that only
 * knew about `fetch` would be one shell-out away from the same blindness it exists to close.
 */
const NETWORK_CALLS = ['fetch', 'execSync', 'execFileSync', 'spawnSync', 'exec', 'request'];

/**
 * The text of a call's argument list, starting at the '(' that follows `src.slice(at)`'s callee.
 * Quote-aware so a ')' inside a string does not close the list early. Returns '' if unbalanced.
 */
function argumentText(src: string, openParen: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openParen; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return src.slice(openParen + 1, i);
    }
  }
  return '';
}

/** `const NAME = '…a production host…'` — the identifier a later network call may use. */
function endpointIdentifiers(src: string): string[] {
  const names: string[] = [];
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([`'"][^`'"]*[`'"])/g;
  for (const m of src.matchAll(re)) {
    if (PRODUCTION_HOST.test(m[2])) names.push(m[1]);
  }
  return names;
}

/**
 * Returns a description of how `source` reaches a production endpoint without the resolver, or null.
 *
 * Fail-closed by construction: it reports what it CAN see and never converts "I could not tell" into
 * a clean answer — a caller that wants certainty must combine it with the module-graph arm.
 */
export function reachesProductionOutsideResolver(source: string): string | null {
  const src = stripComments(source);
  // Arm 1's territory. A file that imports the canonical resolver is already a graph candidate, and
  // reporting it here would double-count rather than widen anything.
  if (/from\s+['"][^'"]*lib\/public-supabase\.ts['"]/.test(src)) return null;

  const idents = endpointIdentifiers(src);
  for (const call of NETWORK_CALLS) {
    const re = new RegExp(`(?<![\\w$.])${call}\\s*\\(`, 'g');
    for (const m of src.matchAll(re)) {
      const open = m.index + m[0].length - 1;
      const args = argumentText(src, open);
      if (!args) continue;
      if (PRODUCTION_HOST.test(args)) {
        return `${call}(…) is called with a production host written straight into its arguments`;
      }
      const used = idents.find((n) => new RegExp(`(?<![\\w$.])${n}(?![\\w$])`).test(args));
      if (used) {
        return `${call}(…) is called with ${used}, which is bound to a production host literal`;
      }
    }
  }
  return null;
}

/** The run-set filter both the barrier and its proofs use. `read` returns a file's source, or null. */
export function reachersOutsideResolver(
  runSet: string[],
  read: (name: string) => string | null,
): { name: string; why: string }[] {
  const out: { name: string; why: string }[] = [];
  for (const name of runSet) {
    const src = read(name);
    // A file in the run set that cannot be read is NOT evidence of health. The runner will fail on
    // it anyway, but this predicate must not be the layer that quietly calls it clean.
    if (src === null) {
      out.push({ name, why: 'is in the required run set but its source could not be read, so ' +
        'whether it reaches production is UNKNOWN — never assume it does not' });
      continue;
    }
    const why = reachesProductionOutsideResolver(src);
    if (why) out.push({ name, why });
  }
  return out;
}
