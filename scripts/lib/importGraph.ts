// WHICH CHECKS CAN REACH PRODUCTION? — a structural answer, computed rather than grepped.
//
// Routine #10, ops_incident #104, 2026-09-06. `npm test` is the REQUIRED status check on every PR,
// so its verdict must depend only on the diff. A check that cannot answer without reaching
// production violates that by construction: measured on 2026-09-06, four such checks flipped on
// UNCHANGED code — one went RED, GREEN on immediate re-run, then RED again on a single commit, and
// another went red because a platform went live between two runs.
//
// scripts/lib/public-supabase.ts is the ONE canonical way a check obtains the live endpoint, so
// "does this check transitively import that module" is a real, computable property of the module
// graph — not a phrase to search for. That distinction is the whole point: a source-TEXT tripwire is
// the shape that made five barriers pass for the entire life of the bugs they covered (2026-09-04).
//
// IMPORTING IS NOT THE SAME AS CALLING, and this function does not pretend otherwise. It answers
// "can this file reach the live endpoint through its imports", which makes it a CANDIDATE finder.
// Whether a candidate actually depends on production at run time is settled by MEASUREMENT, and
// scripts/live-reaching-required-checks.txt records that measurement per candidate. See
// scripts/verify-required-suite-is-hermetic.ts for how the two halves fit together.

/** Local relative-import specifiers in a source file, resolved against its own directory. */
export function localImportsOf(
  file: string,
  readFile: (path: string) => string | null,
  resolveFrom: (fromFile: string, spec: string) => string,
): string[] {
  const src = readFile(file);
  if (src === null) return [];
  const out: string[] = [];
  // Covers `import … from './x'`, `export … from './x'` and `await import('./x')` — the three ways
  // a check actually pulls in a sibling module. Quotes may be single or double.
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
    out.push(resolveFrom(file, m[1]));
  }
  return out;
}

/**
 * Does `entry` reach `isTarget` through local imports (including itself)? Cycle-safe.
 *
 * Everything is injected so the rule can be run against a synthetic module graph and watched to
 * fail — see the mutation proofs in scripts/verify-required-suite-is-hermetic.ts.
 */
export function transitivelyReaches(
  entry: string,
  isTarget: (file: string) => boolean,
  readFile: (path: string) => string | null,
  resolveFrom: (fromFile: string, spec: string) => string,
): boolean {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (isTarget(file)) return true;
    for (const dep of localImportsOf(file, readFile, resolveFrom)) {
      if (!seen.has(dep)) stack.push(dep);
    }
  }
  return false;
}
