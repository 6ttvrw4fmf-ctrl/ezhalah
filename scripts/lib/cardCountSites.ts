// THE PURE PREDICATE BEHIND scripts/verify-live-card-counts-walk-the-cascade.ts.
//
// It lives here, apart from the barrier, for the reason this repo already applies to every split
// check: the proofs at the bottom of the barrier must be statements about the code that decides the
// real verdict, not about a copy of it (AGENTS.md, "The required suite is HERMETIC"). Nothing in
// here touches the filesystem or the network — every function takes its input as an argument
// precisely so a proof can hand it a broken one.
//
// The contract it enforces, and why, is documented at the top of the barrier and in
// scripts/live-card-count-sites.txt.
//
// WHAT IT DELIBERATELY DOES NOT DO: dataflow. An earlier draft chased every name a card count
// could reach, to a fixpoint, so it could decide for itself which statements "compare a count to a
// total". Measured on the real instruments it was wrong in BOTH directions at once — it swallowed a
// 1,100-line journey whole (every line then looked like a comparison) and it found nothing at all in
// a journey whose card count is an `out[i].cards++` inside a page.evaluate. A predicate that is red
// for everything is as useless as one that is green for everything, and a barrier nobody can trust
// is a barrier the next author deletes. So the parts that are MECHANICAL are executed here, exactly;
// the one part that is a judgement (what a count is used FOR) is written down per file in the
// ledger, with a falsifier this file can execute against it.

export const LEDGER = 'scripts/live-card-count-sites.txt';

export type Verdict = 'walks-the-cascade' | 'count-is-not-judged-against-a-total' | 'no-card-count';
export const VERDICTS: Verdict[] = ['walks-the-cascade', 'count-is-not-judged-against-a-total', 'no-card-count'];
export type Row = { path: string; verdict: Verdict; why: string };

export function parseLedger(text: string): { rows: Row[]; problems: string[] } {
  const rows: Row[] = [];
  const problems: string[] = [];
  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length < 3) { problems.push(`${LEDGER}:${i + 1} is not \`path | verdict | why\``); continue; }
    const [path, verdict, ...rest] = parts;
    if (!VERDICTS.includes(verdict as Verdict)) {
      problems.push(`${LEDGER}:${i + 1} unknown verdict «${verdict}» (expected one of ${VERDICTS.join(', ')})`);
      continue;
    }
    const why = rest.join(' | ').trim();
    if (why.length < 20) {
      problems.push(`${LEDGER}:${i + 1} «${path}» has no real reason — a row nobody can read is a row nobody can review`);
      continue;
    }
    if (rows.some((r) => r.path === path)) problems.push(`${LEDGER}:${i + 1} «${path}» is listed twice`);
    rows.push({ path, verdict: verdict as Verdict, why });
  }
  return { rows, problems };
}

// ── the mechanical vocabulary ───────────────────────────────────────────────────────────────────

/** A card query reduced to a NUMBER, on one line. `++` is in here because the pill journey counts
 *  cards by incrementing a per-turn tally inside a page.evaluate rather than by taking a length. */
const REDUCER = /\.length\b|\.count\s*\(\s*\)|countVisible\s*\(|\+\+/;
/** How this repo spells a TOTAL. A vocabulary, deliberately, and not an inference: it is reviewable,
 *  it is extended by a one-line diff, and it cannot quietly grow to mean everything. */
const TOTAL = /\brpcTotal\b|\btotal_count\b|\btotalCount\b|\bhonestTotal\b|\bcountChip\b|resultsFoundCount|\bquotableTotal\b|\bexpectedFirstPage\b|\brevealTarget\b|initialReveal\s*\(|\btotal\b|من أصل/;
const SCROLLS = /scrollBy|scrollTo\b|scrollIntoView|scrollTop\s*[+]?=|mouse\.wheel|scrollToBottom\s*\(/;
const LOOP = /\bfor\s*\(|\bwhile\s*\(|\brounds\b/;
export const IMPORTS_CASCADE_FROM_PRODUCT =
  /import\s*\{[^}]*\bCASCADE_MAX\b[^}]*\}\s*from\s*['"][^'"]*\/src\/lib\/initialReveal(?:\.ts)?['"]/;
const RETYPES_CASCADE = /(?:const|let|var)\s+CASCADE_MAX\s*=\s*\d/;

const DOM_VERB = /querySelectorAll|querySelector|\.locator\s*\(|\$\$\s*\(|getAttribute|data-testid/;
/** THE READ HELPERS: a short top-level declaration whose body actually QUERIES the DOM for the
 *  product's cards — `CARD_IDS` in redteam-chain-live.mjs, `READ_TURN_CARD_COUNTS` in the pill
 *  journey. A walk that calls one of these IS re-reading the count, and a reader that only looked
 *  for a literal selector inside the loop would not see it.
 *
 *  BOTH conditions are load-bearing and both were measured. Without the DOM verb,
 *  verify-listing-ids-draw-from-one-sequence.ts became a "card reader" because it NAMES the testID
 *  in an error message it prints — prose, in a file with no browser at all. Without the ≤20-line
 *  body, verify-af-option-card-truth-live.ts's 130-line `proveQuestion` became one, and then every
 *  line that called it looked like a card count standing next to a total. A helper that reads the
 *  cards and returns them is small; one that does a page of other work is not a read helper. */
export function cardReaders(lines: string[], prefix: string, maxBody = 20): Set<string> {
  const decls: Array<{ name: string; at: number }> = [];
  lines.forEach((line, i) => {
    const d = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(line);
    if (d) decls.push({ name: d[1] ?? d[2], at: i });
  });
  const out = new Set<string>();
  decls.forEach((d, k) => {
    const end = decls[k + 1]?.at ?? lines.length;
    if (end - d.at > maxBody) return;
    const body = lines.slice(d.at, end);
    if (body.some((l) => l.includes(prefix)) && body.some((l) => DOM_VERB.test(l))) out.add(d.name);
  });
  return out;
}

/** TWO HOPS, never a fixpoint: the names a card count is given on the line that produces it, and
 *  the names taken from THOSE. Two is not arbitrary — it is what the real instruments need and no
 *  more. redteam-chain-live.mjs binds the ids first (`onScreen = page.evaluate(CARD_IDS)`) and the
 *  number only after (`shown = onScreen.length`), so a one-hop reader misses the very site this
 *  barrier exists for; an unbounded fixpoint, measured, swallowed a 1,100-line journey whole and
 *  made every line in it look like a violation.
 *
 *  Binding is strictly LHS ← RHS: a name is only taken when a card count is on the RIGHT of the
 *  assignment. A looser rule binds the whole file within two passes. */
export function countNames(lines: string[], prefix: string, hops = 2): Set<string> {
  const readers = cardReaders(lines, prefix);
  const out = new Set<string>();
  const bind = (line: string, rhsCarriesACount: (rhs: string) => boolean) => {
    for (const m of line.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]*)/g))
      if (rhsCarriesACount(m[2])) out.add(m[1]);
    for (const m of line.matchAll(/(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*:\s*([^,;}]*)/g))
      if (rhsCarriesACount(m[2])) out.add(m[1]);
    for (const m of line.matchAll(/(?:^|[;{])\s*([A-Za-z_$][\w$]*)\s*=\s*([^=;][^;]*)/g))
      if (rhsCarriesACount(m[2])) out.add(m[1]);
    for (const m of line.matchAll(/\.([A-Za-z_$][\w$]*)\s*\+\+/g)) out.add(m[1]);
  };
  // A card count comes from a card QUERY, never from a string that merely spells the prefix.
  // Without the DOM verb, `MISSED = { tid: 'card-listing-11678443' }` — a FIXTURE id in
  // verify-af-offer-click-lands.ts — seeded three names, and a coverage ledger's prose evidence
  // seeded eight more, in two files that never open a browser.
  const seeded = (s: string) => (s.includes(prefix) && DOM_VERB.test(s))
    || [...readers].some((n) => new RegExp(`\\b${n}\\b`).test(s));
  for (const line of lines) if (seeded(line)) bind(line, () => true);
  for (let hop = 1; hop < hops; hop++) {
    const known = [...out].map((n) => new RegExp(`\\b${n}\\b`));
    for (const line of lines) bind(line, (rhs) => known.some((re) => re.test(rhs)));
  }
  for (const junk of ['e', 'id', 'el', 'n', 'i', 's', 'r', 't', 'v', 'map', 'key', 'text']) out.delete(junk);
  return out;
}

/** Every line that RE-READS the product's cards from the page: the selector itself, or a call to one
 *  of the file's own card read helpers. This is what a cascade walk must do inside its loop, and it
 *  is deliberately NARROWER than "mentions a count": a scroll loop that merely carries a number
 *  around is not watching the reveal. Measured — with the #699 defect restored, the looser form
 *  found a "walk" in an unrelated `window.scrollTo` and the mutant survived. */
export function cardTouchLines(lines: string[], prefix: string): number[] {
  const readers = cardReaders(lines, prefix);
  const out: number[] = [];
  lines.forEach((l, i) => {
    if (l.includes(prefix) || [...readers].some((n) => new RegExp(`\\b${n}\\b`).test(l))) out.push(i + 1);
  });
  return out;
}

/** Every line that reduces the product's cards to a NUMBER. */
export function countReadLines(lines: string[], prefix: string): number[] {
  const readers = cardReaders(lines, prefix);
  const names = countNames(lines, prefix);
  const out: number[] = [];
  lines.forEach((l, i) => {
    if (!REDUCER.test(l)) return;
    if (l.includes(prefix)
      || [...readers].some((n) => new RegExp(`\\b${n}\\b`).test(l))
      || [...names].some((n) => new RegExp(`\\b${n}\\b`).test(l))) out.push(i + 1);
  });
  return out;
}

/** A line that puts a card count next to a total. The FALSIFIER for the judgement verdict: it is
 *  what goes red the day a settling-only counter starts deciding whether a pager is missing. */
export function countBesideTotalLines(lines: string[], prefix: string): Array<{ line: number; text: string }> {
  const names = countNames(lines, prefix);
  const out: Array<{ line: number; text: string }> = [];
  lines.forEach((text, i) => {
    if (!TOTAL.test(text)) return;
    if (text.includes(prefix) || [...names].some((n) => new RegExp(`\\b${n}\\b`).test(text)))
      out.push({ line: i + 1, text: text.trim().slice(0, 130) });
  });
  return out;
}

/** THE CASCADE WALK, recognised by what it DOES rather than by a name: a loop that scrolls and
 *  RE-READS the card count, so it stops when the reveal stops growing. A bare `scrollIntoView`
 *  before a click is not a walk, and that distinction carries the whole barrier —
 *  redteam-chain-live.mjs held seven other scroll calls while the #699 defect was live, so a reader
 *  that accepted any scroll would have passed the defect unchanged.
 *
 *  Returns the lines at which a walk is REACHED: an inline walk is its own line, a walk inside a
 *  named function is every line that CALLS it. A walk defined and never called is decoration. */
export function walkLines(lines: string[], prefix: string): number[] {
  const reads = new Set(cardTouchLines(lines, prefix));
  const reached: number[] = [];
  for (const [i, line] of lines.entries()) {
    if (!SCROLLS.test(line)) continue;
    const from = Math.max(0, i - 14), to = Math.min(lines.length, i + 15);
    const hasRead = [...reads].some((n) => n > from && n <= to);
    const hasLoop = lines.slice(from, to).some((l) => LOOP.test(l));
    if (!hasRead || !hasLoop) continue;
    // The enclosing helper, if any — anchored at TOP LEVEL. An earlier draft took the nearest
    // declaration of any kind and picked up `const n = (await page.evaluate(CARD_IDS)).length`
    // INSIDE the walk, then looked for calls to `n`, found none, and fell back to the walk's own
    // line — which made "the walk is reached before the read" trivially true and let the
    // walk-moved-after-the-read mutant survive.
    let fn: string | null = null;
    for (let j = i; j >= 0 && j >= i - 60; j--) {
      const m = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\()/.exec(lines[j]);
      if (m) { fn = m[1] ?? m[2]; break; }
    }
    if (fn == null) { reached.push(i + 1); continue; }
    const declared = lines.findIndex((l) => new RegExp(`^(?:export\\s+)?(?:async\\s+)?(?:function\\s+${fn}\\s*\\(|(?:const|let)\\s+${fn}\\s*=)`).test(l));
    const calls = lines
      .map((l, k) => (new RegExp(`\\b${fn}\\s*\\(`).test(l) && k !== declared ? k + 1 : 0))
      .filter(Boolean);
    reached.push(...(calls.length ? calls : [i + 1]));
  }
  return [...new Set(reached)].sort((x, y) => x - y);
}

export function siteFacts(code: string, prefix: string) {
  const lines = code.split('\n');
  return {
    namesPrefix: code.includes(prefix),
    countReads: countReadLines(lines, prefix),
    besideTotal: countBesideTotalLines(lines, prefix),
    importsCascadeFromProduct: IMPORTS_CASCADE_FROM_PRODUCT.test(code),
    retypesCascade: RETYPES_CASCADE.test(code),
    walks: walkLines(lines, prefix),
  };
}

/** The whole verdict for one row, pure, so a proof can hand it a broken copy of the real file. */
export function rowProblems(row: Row, code: string, prefix: string): string[] {
  const f = siteFacts(code, prefix);
  const bad: string[] = [];
  if (!f.namesPrefix) {
    bad.push(`${row.path} no longer names «${prefix}» — this row is STALE, and a ledger that reads better than the tree is the defect it exists to prevent`);
    return bad;
  }
  if (row.verdict === 'walks-the-cascade') {
    // NOT "it must import CASCADE_MAX". What makes an instrument safe is that it WALKS; naming the
    // constant is only useful to the ones that also assert what the arrival looked like, and
    // demanding an unused import of the rest is ceremony — the churn this spec's §R1 step 1 warns
    // about. What IS forbidden is holding a COPY of the product's number.
    if (f.retypesCascade)
      bad.push(`${row.path} declares its own CASCADE_MAX — the product owns that number`);
    if (f.walks.length === 0)
      bad.push(`${row.path} has no cascade walk: no loop that scrolls AND re-reads the card count until it stops growing. It reads the arrival screenful and calls it the whole reveal`);
    else if (f.besideTotal.length > 0 && Math.min(...f.walks) > f.besideTotal.at(-1)!.line)
      bad.push(`${row.path} puts a card count beside a total at line ${f.besideTotal.at(-1)!.line}, and its cascade walk is only reached at line ${Math.min(...f.walks)} — a walk after the read is not a walk`);
  }
  if (row.verdict === 'count-is-not-judged-against-a-total') {
    if (f.countReads.length === 0)
      bad.push(`${row.path} is classified count-is-not-judged-against-a-total but no longer reduces a card query to a number — reclassify it`);
    for (const c of f.besideTotal)
      bad.push(`${row.path}:${c.line} now puts a card count beside a total — «${c.text}». Either it walks the cascade first and is reclassified walks-the-cascade, or it is asserting the contract production retired on 2026-09-20`);
  }
  if (row.verdict === 'no-card-count') {
    if (f.countReads.length > 0)
      bad.push(`${row.path}:${f.countReads[0]} is classified no-card-count but now reduces a card query to a number — reclassify it`);
  }
  return bad;
}

/** Discovery + the ledger's completeness. `read` is injected so a proof can supply a broken tree. */
export function ledgerProblems(
  discovered: string[], rows: Row[], read: (p: string) => string, prefix: string,
  strip: (s: string) => string,
): string[] {
  const bad: string[] = [];
  const listed = new Set(rows.map((r) => r.path));
  for (const p of discovered) {
    if (!listed.has(p))
      bad.push(`${p} reads result cards off a real screen and has NO row in ${LEDGER} — classify it (a new instrument is RED until somebody says what it does with the count)`);
  }
  for (const r of rows) {
    let code: string | null = null;
    try { code = strip(read(r.path)); } catch { code = null; }
    if (code == null) {
      // Fail CLOSED: an unreadable file is UNKNOWN, never a quiet pass.
      bad.push(`${r.path} is in ${LEDGER} and could not be read — UNKNOWN, never green`);
      continue;
    }
    if (!discovered.includes(r.path)) {
      bad.push(`${r.path} is in ${LEDGER} but discovery no longer finds it — remove the STALE row`);
      continue;
    }
    bad.push(...rowProblems(r, code, prefix));
  }
  return bad;
}
