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

// ────────────────────────────────────────────────────────────────────────────────────────────────
// CODE ONLY — comments, string literals, template literals AND regex literals removed, in ONE
// left-to-right pass.
//
// `stripComments` above is deliberately string-unaware and says so; that is fine for a shape
// assertion over product source, where over-stripping fails closed. It is NOT enough for a barrier
// that scans OTHER BARRIERS, because a barrier legitimately quotes the anti-pattern it forbids —
// inside its own mutation proofs. Such a file must be able to describe a defect without committing
// it, which needs the strings blanked, not just the comments.
//
// WHY ONE PASS (2026-09-11, routine #10, ops_incident #132). The previous reader of this shape ran
// each quote kind as its own independent global `.replace()`. The single-quote pass therefore ran
// before the double-quote pass could consume its own string, so an ordinary apostrophe inside a
// double-quoted string opened a bogus literal that ran to the next `'` on the line and swallowed
// whatever sat between. Measured consequence, in the direction that matters most: a file carrying a
// real proof AND an unconditional `mustCatch(…, true)` read as CLEAN, because the fake one was eaten.
// Scanning once fixes it by construction — whichever delimiter OPENS FIRST consumes the others,
// exactly as the JavaScript tokenizer does.
//
// REGEX LITERALS ARE A DELIMITER KIND TOO, and omitting them reproduced the same bug one layer out:
// a scanner without regex awareness read the backtick inside `/`(?:[^`\\]|\\.)*`/g` as a TEMPLATE
// opener and, templates being multiline, spliced together fragments many lines apart. A `/` only
// opens a regex where an operand may not appear, so the previous significant character decides;
// `a / b` stays division and a `[…]` class may hold a bare `/`.
//
// Two properties are deliberate: a `//` directly after `:` or a word character is not a comment (so
// `https://…` survives), and an UNTERMINATED quote is emitted verbatim rather than swallowing the
// rest of the file — the conservative direction for an apostrophe in prose or a stray backtick.
//
// Behaviour is mutation-proven in scripts/verify-new-barriers-are-mutation-proven.ts, which is the
// reader's primary consumer; it imports this function rather than keeping a copy, because a barrier
// holding its own duplicate of shared logic is the drift class this repo has already been bitten by.
const REGEX_MAY_START =
  /(?:^|[(,=:[!&|?{};*%+\-~^<>]|\b(?:return|typeof|case|in|of|new|delete|void|instanceof|yield|await))$/;

export const stripCommentsAndStrings = (s: string): string => {
  let out = '';
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      i = end === -1 ? s.length : end + 2;
      continue;
    }
    if (c === '/' && s[i + 1] === '/' && !/[:\w]/.test(out.slice(-1))) {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && s[i + 1] !== '/' && s[i + 1] !== '*' && REGEX_MAY_START.test(out.trimEnd())) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < s.length) {
        if (s[j] === '\\') { j += 2; continue; }
        if (s[j] === '\n') break;                         // a regex literal cannot span lines
        if (s[j] === '[') inClass = true;
        else if (s[j] === ']') inClass = false;
        else if (s[j] === '/' && !inClass) { closed = true; break; }
        j++;
      }
      if (closed) {
        out += '/x/';
        i = j + 1;
        while (i < s.length && /[dgimsuvy]/.test(s[i])) i++;   // trailing flags
        continue;
      }
    }
    if (c === "'" || c === '"' || c === '`') {
      const multiline = c === '`';
      let j = i + 1;
      let closed = false;
      while (j < s.length) {
        if (s[j] === '\\') { j += 2; continue; }
        if (s[j] === c) { closed = true; break; }
        if (s[j] === '\n' && !multiline) break;
        j++;
      }
      if (closed) { out += c + c; i = j + 1; continue; }
    }
    out += c;
    i++;
  }
  return out;
};

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
