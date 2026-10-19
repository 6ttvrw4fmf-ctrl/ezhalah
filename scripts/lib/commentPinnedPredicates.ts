// A COMMENT IS NOT BEHAVIOUR — so a barrier's PREDICATE may never require one to be present.
//
// THE DEFECT, REPRODUCED BY EXECUTION 2026-09-27 (routine #10, ops_incident #727).
// `scripts/verify-read-aloud-contract.ts:184` asserted the property "starting a new search/turn stops
// any read-aloud left over from the previous response" with
//
//     /stopReadAloud\(\); \/\/ a new turn starting is "another response"/.test(agent)
//
// The trailing `//` comment is INSIDE the predicate. Rewording that comment in `src/app/agent.tsx`
// — one line, zero behavioural change, `stopReadAloud()` still called from the same place — was
// measured to produce:
//
//     FAIL  starting a new search/turn stops any read-aloud left over from the previous response
//     FAIL  98 of 99 read-aloud contract assertions hold
//     FAIL  (mutation) BLIND to …while the REAL shipped tree is NOT flagged
//     FAIL  (mutation) BLIND to …while the RETARGETED, executed property is untouched by that rename
//     ✗ 2 mutation(s) went UNCAUGHT — contractProblems cannot fail for them
//
// So a comment-only reword does not merely fail the check: it invalidates that barrier's OWN
// mutation proofs, because their negative control ("the real shipped tree is NOT flagged") no longer
// holds. One reworded sentence of prose takes down the assertion and the evidence for it together.
//
// WHY THIS IS A BARRIER DEFECT AND NOT PEDANTRY. Two directions, and both are bad:
//
//   • FALSE RED on a no-op refactor. The check reports a regression that does not exist. That is the
//     precise pressure `docs/ops/BARRIER_ENGINEER.md` Prohibition 1 exists to resist — a guard that
//     cries wolf at a reworded sentence is a guard someone eventually loosens, and the loosening is
//     then indistinguishable from the legitimate repair.
//   • The comment is usually LOAD-BEARING AS A LOCATOR. In every site measured, the prose is the
//     only thing telling one `stopReadAloud()` / `Speech.pause()` / `clearBlurTimer(...)` call from
//     its siblings. That means the barrier is not asserting a property at all — it is freezing one
//     exact expression under a label that states a property, which is ops_incident #727's class
//     verbatim ("the LABEL states a property while the ASSERTION freezes one exact expression").
//
// THEREFORE THE REPAIR IS NEVER "DELETE THE COMMENT FROM THE REGEX". Deleting it makes the check
// LESS strict, which is Prohibition 1 in the other direction. The repair is to replace the prose
// locator with a STRUCTURAL one — the enclosing function, a distinguishing argument, or (best) an
// executed lift of the real symbol — so the predicate names the property and not the paragraph.
//
// WHAT THIS DELIBERATELY DOES NOT COUNT, so there is ONE ledger per class and not two. A source
// WINDOW anchored on a comment — `src.slice(src.indexOf(A), src.indexOf('// auto_select'))` — is the
// same hazard one layer out, and worse, because a lost marker widens the window instead of failing:
// measured 2026-09-27 on verify-google-onetap.ts, rewording that comment in the product left the
// barrier at a full 14/14 green with the window running to one character before end-of-file. But that
// is ALREADY the R4 class, and all four such sites (verify-google-onetap.ts ×2,
// verify-saved-search-identity.ts, verify-transcript-capture-survives-navigation.ts) are ALREADY
// rows in scripts/source-window-baseline.txt with the same repair (windowBetween(), which THROWS).
// A second ledger over the same sites would let one shrink while the other stood still, so this
// counts only what R4 cannot see: a predicate that requires a comment WITHOUT narrowing a window.
// The aggravating fact — that those anchors are PROSE, which moves more freely than code — is
// recorded in that baseline's own header rather than duplicated here.
//
// SCOPE, honestly stated. This finds a comment marker that a predicate REQUIRES. It cannot find the
// general #727 class (a frozen expression carrying no comment), and does not claim to; it finds the
// sub-class whose own syntax proves the author was pinning text rather than asserting behaviour.
// That sub-class is the mechanisable part, and the tell is exact: a barrier that needs `//` in the
// product's bytes is reading prose.

export type PinSite = { file: string; line: number; snippet: string };

/**
 * ONE left-to-right scan that finds REGEX LITERALS and quoted STRINGS, the way the tokenizer does.
 * A `/` only opens a regex where an operand may not appear, so the previous significant character
 * decides — the same rule `stripCommentsAndStrings` documents, and for the same reason: a scanner
 * that guesses splices unrelated fragments together and the ledger stops meaning anything.
 */
type Lit = { kind: 'regex' | 'str'; text: string; start: number; before: string };

function literals(line: string): Lit[] {
  const out: Lit[] = [];
  let i = 0;
  let prev = '';                       // previous significant (non-space) character
  while (i < line.length) {
    const c = line[i];
    if (c === '/' && line[i + 1] === '/' && !/[\w$)\]'"`:]/.test(prev)) break;   // the LINE'S OWN comment
    if (c === '/' && line[i + 1] === '*') break;
    if (c === "'" || c === '"' || c === '`') {
      const start = i; i++;
      while (i < line.length && line[i] !== c) { if (line[i] === '\\') i++; i++; }
      out.push({ kind: 'str', text: line.slice(start + 1, i), start, before: line.slice(0, start) });
      i++; prev = c; continue;
    }
    if (c === '/' && !/[\w$)\]'"`]/.test(prev)) {
      const start = i; i++;
      let cls = false;
      while (i < line.length) {
        const d = line[i];
        if (d === '\\') { i += 2; continue; }
        if (d === '[') cls = true;
        else if (d === ']') cls = false;
        else if (d === '/' && !cls) break;
        i++;
      }
      if (i >= line.length) { prev = '/'; i = start + 1; continue; }   // not a regex after all
      out.push({ kind: 'regex', text: line.slice(start + 1, i), start, before: line.slice(0, start) });
      i++; prev = '/'; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

/** A regex handed straight to `.replace()` / `.split()` STRIPS prose; it never requires prose. */
const STRIPS = /\.(?:replace|replaceAll|split|match|matchAll|search)\s*\(\s*$/;

/** Required PROSE after the marker: a space, then a word. `/\/\/.*$/` matches any comment; a pin names one. */
const PROSE = /^(?:\\?[ \t])+[\w\u0600-\u06FF"'(\u00AB]/;

/**
 * Does a predicate on this line REQUIRE (or require the ABSENCE of) a source comment?
 *
 * Takes the file text as an argument so a proof can hand it a broken copy — the mutation-proof shape
 * this repo requires of every predicate.
 */
export function commentPinsInSource(file: string, src: string): PinSite[] {
  const out: PinSite[] = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trimStart();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    for (const lit of literals(raw)) {
      if (STRIPS.test(lit.before)) continue;
      if (lit.kind !== 'regex') continue;
      // Inside a regex literal a comment marker is written ESCAPED — an unescaped `//` cannot appear
      // there at all (it would close the literal), so the escaped form is the whole question. A
      // quoted STRING carrying `//` is almost always a mutation proof's synthetic INPUT (the healthy
      // pattern: prose fed in deliberately, to show the predicate ignores it), and flagging those
      // would make this ratchet cry wolf — so strings are not counted here at all.
      const m = lit.text.match(/\\\/\\\//);
      if (m && PROSE.test(lit.text.slice(m.index! + m[0].length))) {
        out.push({ file, line: i + 1, snippet: raw.trim().slice(0, 160) }); break;
      }
    }
  }
  return out;
}

/** Every site across a set of barrier files, sorted so the ledger is stable. */
export function commentPinSites(files: { path: string; src: string }[]): PinSite[] {
  return files
    .flatMap(({ path, src }) => commentPinsInSource(path, src))
    .sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
}
