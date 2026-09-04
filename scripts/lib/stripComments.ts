// A COMMENT IS NOT A CODE PATH — the strip every source-shape assertion must run first.
//
// WHY THIS EXISTS AS A SHARED FUNCTION. A barrier that greps un-stripped source is satisfied by
// prose, so the most plausible mutation there is — a developer refactoring a line and leaving the
// original behind as `// was: …` — passes. Measured on this repo 2026-09-01: with
// `const query = useMemo(() => reconcileCommittedAf(storeQuery, AF_ALL_QUESTIONS))` replaced by
// `() => storeQuery` and the original restored verbatim inside a `/* … */` block elsewhere in the
// file, BOTH new AF barriers printed ✓ and the FULL 285-check suite passed — while in production the
// Filter screen no longer called the reconciliation at all. The same shape hid a dead chip «×» and a
// deleted AF_PREDICATE_FIELDS spread. Every barrier that survived those mutants was one that
// stripped comments, so the strip is the load-bearing part, not the regex.
//
// SCOPE, honestly stated: this is a lexer-free approximation. It removes block comments non-greedily
// and whole-line `//` comments; it does NOT understand strings, template literals or regex literals,
// so a `/*` inside one would over-strip. That direction is fail-CLOSED for a shape assertion (the
// text disappears, the assertion goes red and a human looks), which is the right way round. Verified
// against src/app/index.tsx and src/app/agent.tsx: neither contains a quoted `/*`.
//
// TRAILING `//` COMMENTS ARE STRIPPED TOO, and that is not optional: an earlier draft of this
// function removed only whole-LINE comments, and a mutant that pointed the Trending city counts at
// the raw store — `rpcAllNarrowingParams(storeQuery);  // was: rpcAllNarrowingParams(query)` — then
// survived BOTH AF barriers AND the trending barrier. A decoy is a decoy wherever it sits.
// `[^:]` keeps `https://…` intact, which is the only `//`-inside-a-string shape these barriers'
// source files contain (checked: zero in-string `//` across index.tsx, agent.tsx, remote.ts,
// search.ts and advancedFilters.ts). If a future file breaks that, the assertion goes red, not green.
export const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1');

// Shell variant of the same rule. The deploy guards are bash, and their barriers grep the script
// text — so a mutant that guts a check and leaves the original line behind as a `#` comment passes
// an un-stripped grep. Measured 2026-09-03 while hardening the alias gate: replacing
// `if ! dtg_bundle_is_authentic "$BUNDLE_BODY" "$ALIAS_BUNDLE"; then` with `if false; then` left the
// name alive in a nearby comment, and verify-deploy-target-guard.ts stayed GREEN on a deploy gate
// that no longer verified anything. COUNT the survivors of this strip, never the raw source.
//
// SCOPE, honestly stated: whole-line `#` comments, plus trailing comments introduced by at least two
// spaces before the `#` — the convention every script in scripts/ follows. Deliberately NOT stripped:
// `${VAR#prefix}`, `$#`, `#!/usr/bin/env bash`, and any `#` with a single preceding space, because
// over-stripping a shape assertion is only fail-closed when the text really was a comment.
export const stripShellComments = (s: string): string =>
  s.replace(/^\s*#.*$/gm, '')
    .replace(/ {2,}#.*$/gm, '');
