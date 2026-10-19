// THE ONE PREDICATE that decides whether the Results-Found sentence a user is looking at is WHOLE.
//
// ops_incident #347 (P1, 2026-09-19): after the second «عرض المزيد» press the sentence froze one
// tick short of its end and stayed there for 90s+, rendering a LONE HIGH SURROGATE — half an emoji,
// a ▯ box — as its final character:
//     "لقينا لك 72,470 نتيجة تطابق بحثك \ud83c"   (34 of 35 UTF-16 code units)
// Twenty of the forty shipped templates end in a non-BMP emoji, `Typer` sliced by UTF-16 CODE UNIT,
// and `runTypewriter`'s finish() never committed under the 500-card render load. It is also the root
// cause of #331: the sentence on screen was not any shipped template, so the pool-derived count
// parser correctly read null and the «عرض المزيد» journey reported its headline as 21,384 → null.
//
// Both halves of the barrier import THIS function, so the offline mutation proof is a statement
// about the code that actually decides production's verdict — not about a copy of it
// (SEARCH_MATCH_QA_ENGINEER.md, "the required suite is HERMETIC": both halves import the SAME
// predicate from a shared lib).
//
//   • hermetic half — scripts/verify-results-sentence-renders-whole.ts        (in `npm test`)
//   • live half     — scripts/verify-results-sentence-renders-whole-live.ts   (live-search-sweep.yml)

/**
 * Every unpaired high or low surrogate in `s` — exactly what `text.slice()` on a code-unit boundary
 * leaves behind, and what the browser then renders as ▯.
 *
 * Note this is NOT the same question as "does the string contain an emoji": a correctly rendered
 * 🎉 is a well-formed PAIR and must pass. The defect is a pair cut in half.
 */
export function loneSurrogates(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) out.push(`high \\u${c.toString(16)} at ${i}`);
      else i++;                                   // a well-formed pair — skip its low half
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out.push(`low \\u${c.toString(16)} at ${i}`);
    }
  }
  return out;
}

export interface SentenceReading {
  /** The LAST pool-matched sentence on the page, or null when no WHOLE template matched. */
  sentence: string | null;
  /** The same reading taken earlier, to catch a reveal that never commits. */
  earlier: string | null;
  /** What the pool-derived parser reads out of the page, or null (this is #331's signal). */
  quoted: number | null;
  /** The RPC's own total_count for the search, or null if none was observed. */
  rpcTotal: number | null;
  /** Numbers present in the rendered sentence — used only to accept the 500-cap terminal wording. */
  numbersInSentence: number[];
  /** Nearest results-shaped text, quoted when nothing matched so a human can act on the failure. */
  evidence: string;
}

/**
 * The verdict. Empty array = the sentence is whole, settled, and honest.
 *
 * Deliberately NOT a boolean: a barrier whose failure message is "false" gets loosened instead of
 * investigated, and this class already cost two incidents' worth of misattribution.
 */
export function sentenceProblems(r: SentenceReading): string[] {
  const problems: string[] = [];

  if (r.sentence == null) {
    // No WHOLE shipped template matched. Either the sentence is a truncated prefix of one (#347) or
    // it is not on the page at all — the evidence string is what tells a human which.
    problems.push('no WHOLE shipped Results-Found template matches what is rendered — the sentence '
      + 'on screen is a truncated prefix of one, or is absent. This is the #347/#331 signature. '
      + `Nearest results-shaped text: ${r.evidence}`);
    return problems;   // every assertion below is about a sentence that exists
  }

  const lone = loneSurrogates(r.sentence);
  if (lone.length) {
    problems.push('the sentence the user is left with contains an unpaired UTF-16 surrogate '
      + `(the ▯ box, ops_incident #347): ${lone.join(', ')}`);
  }

  if (r.earlier !== null && r.earlier !== r.sentence) {
    // Still CHANGING after the wire went quiet means the reveal never committed. A sentence merely
    // still revealing is not a defect — which is why the caller must take both reads with the
    // network already idle, and why this compares two settled reads rather than polling.
    problems.push('the sentence was still changing after the wire went quiet — the reveal never '
      + `committed (#347's freeze): ${JSON.stringify(r.earlier)} → ${JSON.stringify(r.sentence)}`);
  }

  if (r.quoted == null) {
    problems.push('the pool-derived parser cannot read a count out of the page — exactly what made '
      + '#331 report its «عرض المزيد» headline as null');
  } else if (r.rpcTotal != null && r.quoted !== r.rpcTotal && !r.numbersInSentence.includes(r.rpcTotal)) {
    // The 500-cap terminal sentence legitimately quotes 500 alongside the true total, so the true
    // total appearing ANYWHERE in the sentence is enough — but it must appear.
    problems.push(`the displayed sentence does not carry the true total: quotes ${r.quoted}, `
      + `RPC total_count ${r.rpcTotal}`);
  }

  return problems;
}
