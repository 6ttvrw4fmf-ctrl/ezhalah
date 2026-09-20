// THE SHARED PREDICATE for "a tuning constant written down is a claim, and claims get executed".
//
// TWO BARRIERS EXECUTE IT, over two different corpora, and neither owns a copy:
//   scripts/verify-docs-quote-real-af-constants.ts   — canonical docs/ (routine #5, 2026-09-20)
//   scripts/verify-src-comments-quote-real-af-constants.ts — src/ comments (routine #9, 2026-09-20)
//
// It lives here rather than in either script because importing a `verify-*` script to borrow its
// predicate EXECUTES that script's own checks as a side effect — measured: the src/ barrier's first
// run printed the whole docs barrier's output before its own. One predicate, one home, no copy.

// ── THE PREDICATE, exported shape so it can be executed against synthetic text below ───────────
export type Claim = { name: string; claimed: number; line: number; text: string };

/**
 * Pull every explicit numeric claim about a known constant out of one document.
 *
 * Deliberately CONSERVATIVE — it fires only on an assertion form, never on prose. "raised from 25",
 * "it was briefly 50", "between 25 and 50" are all history or commentary and are left alone; a
 * barrier that flags narrative is a barrier someone deletes.
 *
 * Recognised:
 *   NAME = 25 · NAME == 25 · NAME = **25** · `NAME` = `25` · NAME (25) · NAME: 25 · NAME is 25
 *   | `NAME` | 25 | …            (markdown table: name cell, then value cell)
 */
export function constantClaims(doc: string, known: Record<string, number>): Claim[] {
  const out: Claim[] = [];
  const names = Object.keys(known);
  if (!names.length) return out;
  const alt = names.join('|');
  // NAME <op> <number>, where op is an assignment/equality/parenthetical — not a preposition.
  const assign = new RegExp('`?\\b(' + alt + ')\\b`?\\s*(?:=|==|:|\\bis\\b)\\s*\\*{0,2}`?(-?\\d+(?:\\.\\d+)?)`?', 'g');
  // THE PARENTHETICAL DOES NOT HAVE TO CLOSE ON THE NUMBER (widened 2026-09-20, routine #9).
  // It used to require `\)` immediately after the digits, so `NAME (50)` was judged and
  // `NAME (50, owner product rule 2026-09-04 — was 25)` was not. That second form is the one that
  // actually occurs in prose, and it was live in `src/app/agent.tsx:908` asserting 50 while the
  // module exported 25. A lookahead for the delimiter keeps the form an ASSERTION (the number is
  // still bound to the name by the paren) without requiring the sentence to end there.
  // Measured before widening: across all of src/ and docs/ this catches exactly one more site —
  // that real defect — and produces zero new claims anywhere else, so it is not a wolf.
  const paren = new RegExp('`?\\b(' + alt + ')\\b`?\\s*\\(\\s*`?(-?\\d+(?:\\.\\d+)?)`?\\s*(?=[,;)])', 'g');
  // STRUCK-THROUGH TEXT IS RETIRED BY DEFINITION. `ADVANCED_FILTER_PRODUCT_CONTRACT.md` R5.4.1
  // states the live rule (`MIN_OPTIONS_SINGLE = 1`) and then quotes the superseded one inside ~~…~~
  // so a reader can see the rule MOVED — exactly the provenance AGENTS.md asks for. Judging it would
  // punish the clearest way to record a reversal.
  //
  // STRIPPED ACROSS THE WHOLE DOCUMENT, NOT PER LINE: R5.4.1's span opens on one line and closes two
  // lines later, so a per-line strip cannot see it (measured — that exact row survived the first cut
  // of this barrier). Newlines inside the span are PRESERVED so reported line numbers stay true.
  const struckless = doc.replace(/~~[\s\S]*?~~/g, (m) => m.replace(/[^\n]/g, ' '));
  const rawLines = doc.split('\n');
  struckless.split('\n').forEach((text, i) => {
    const raw = rawLines[i] ?? '';
    for (const re of [assign, paren]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) out.push({ name: m[1], claimed: Number(m[2]), line: i + 1, text: raw.trim() });
    }
    // Markdown table row: the constant in one cell, its value in the NEXT cell.
    if (raw.trimStart().startsWith('|')) {
      const cells = text.split('|').map((c) => c.trim());
      for (let c = 0; c < cells.length - 1; c++) {
        const nameCell = cells[c].replace(/`/g, '').trim();
        if (!names.includes(nameCell)) continue;
        const valCell = cells[c + 1].replace(/[`*]/g, '').trim();
        if (/^-?\d+(\.\d+)?$/.test(valCell)) out.push({ name: nameCell, claimed: Number(valCell), line: i + 1, text: text.trim() });
      }
    }
  });
  return out;
}

/** Claims that disagree with the real constant. */
export const wrongClaims = (claims: Claim[], known: Record<string, number>): Claim[] =>
  claims.filter((c) => known[c.name] !== c.claimed);
