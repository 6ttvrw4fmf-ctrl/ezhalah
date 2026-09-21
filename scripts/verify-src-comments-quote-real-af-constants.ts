// PERMANENT BARRIER — A TUNING CONSTANT WRITTEN INTO A SOURCE COMMENT IS A CLAIM, AND CLAIMS GET
// EXECUTED. This is the `src/` half of the rule `verify-docs-quote-real-af-constants.ts` states for
// `docs/`.
//
// THE DEFECT THIS EXISTS FOR, measured 2026-09-20 (routine #9, production red team).
// PR #3383 moved the Advanced Filter stop line back from 50 to 25 the same morning. `afRanking.ts`
// moved, and — because the docs barrier landed in the very same window (bb24552) — every canonical
// document moved with it: 38 constant claims across 40 docs, all correct. FOUR claims in `src/`
// comments did not, and nothing anywhere read them:
//
//   src/app/agent.tsx:908        "INTERVIEW_STOP_AT (50, owner product rule 2026-09-04 — was 25)"
//   src/app/agent.tsx:3598       "floors on the SAME MIN_TOTAL_TO_SHOW=51 constant"   (real: 26)
//   src/app/agent.tsx:3702       "more than INTERVIEW_STOP_AT=50 left to narrow"
//   src/lib/chatTranscript.ts:117 "An AF-completed chat (R11.1, ≤ INTERVIEW_STOP_AT = 50 rows…)"
//
// The first sat three lines from code that reads the real constant. The second was stale twice over:
// `MIN_TOTAL_TO_SHOW` is derived as `INTERVIEW_STOP_AT + 1`, so it had been 51 and was 26.
//
// WHY THIS IS NOT "just a comment". The docs barrier's own header records what the `docs/` version of
// this cost: a stale 50 read as a contract-vs-production conflict and burned real investigation time,
// and it names the worse case — "a journey sized to '> 50' … would pick options against a floor 25 too
// high and report a CORRECT production as broken". A comment beside the code is read by exactly the
// people most likely to act on it, and `docs/ops/PRODUCTION_RED_TEAM_ENGINEER.md` PART 7 is explicit
// that an oracle which accuses the product for its own imprecision is worse than no oracle. This is
// that failure mode's seed.
//
// ONE PREDICATE, TWO SCOPES — never a second copy. `constantClaims()` / `wrongClaims()` are IMPORTED
// from `scripts/lib/afConstantClaims.ts`, which BOTH barriers import (it was moved out of the docs
// barrier for this, because importing a `verify-*` script to borrow its predicate executes that
// script's own checks as a side effect). The constants are IMPORTED from `src/lib/afRanking.ts` and
// read at run time, never regexed. So a constant added or re-valued tomorrow is covered here for
// free, and the two halves cannot drift into disagreeing about what an assertion even is.
//
// SCOPE — COMMENT LINES IN `src/` ONLY, deliberately. Code is not judged: `const x = 50` is not a
// claim about `INTERVIEW_STOP_AT`, and a test fixture may legitimately use any number. Only `//`,
// `/* … */` and JSX `{/* … */}` comment text is scanned, so this can never fight the compiler.
//
// HISTORY IS NOT DRIFT, and the predicate already draws that line in the only place it can be drawn
// safely: on WHICH NUMBER IS BOUND TO THE NAME. "was true at INTERVIEW_STOP_AT = 25 and false at 50"
// binds 25 — the live value — and passes, which is why `afRanking.ts`'s deliberate historical
// narration survives untouched. A line-level "mentions the word was ⇒ history" exclusion would have
// been the tempting rule and it would have MISSED the real defect, whose text is literally
// "(50, … — was 25)". Both directions are proven by mutation below.
//
//   node --experimental-strip-types scripts/verify-src-comments-quote-real-af-constants.ts
//   (auto-discovered into `npm test` by scripts/lib/testRegistry.ts)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as AF from '../src/lib/afRanking.ts';
import { constantClaims, wrongClaims, type Claim } from './lib/afConstantClaims.ts';

const root = join(import.meta.dirname, '..');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
/** A mutation proof: the predicate must REJECT a deliberately broken input, or it proves nothing. */
const mustCatch = (what: string, found: Claim[]) =>
  check(`(mutation) catches ${what}`, found.length > 0, 'the predicate stayed silent on broken input');
/** Its mirror: a predicate that rejects everything proves as little as one that rejects nothing. */
const mustPass = (what: string, found: Claim[]) =>
  check(`(mutation) does NOT cry wolf over ${what}`, found.length === 0,
    found.map((c) => `${c.name}=${c.claimed} :: ${c.text}`).join(' | '));

// ── the constants, READ OFF THE REAL MODULE (never a list, never a regex) ───────────────────────
const CONSTANTS: Record<string, number> = Object.fromEntries(
  Object.entries(AF).filter(([k, v]) => typeof v === 'number' && /^[A-Z][A-Z0-9_]*$/.test(k)),
) as Record<string, number>;

check('afRanking exports numeric constants this barrier can judge', Object.keys(CONSTANTS).length >= 5,
  Object.entries(CONSTANTS).map(([k, v]) => `${k}=${v}`).join(', '));

// ── comment extraction ──────────────────────────────────────────────────────────────────────────
/**
 * Blank out everything that is NOT comment text, preserving newlines so reported line numbers stay
 * true.
 *
 * WRITTEN AS A SCANNER, NOT COMPOSED REGEXES, BECAUSE THE REGEX VERSION WAS BLIND — and its own
 * mutation proof is what caught it (routine #9, 2026-09-20). The first cut "kept" block comments
 * with a no-op replace and then blanked every line containing no line-comment marker, which erases
 * a JSX block comment wholesale. That is not hypothetical: `src/app/agent.tsx:3702` — one of the
 * four real stale claims this barrier exists for — is exactly that form, so the barrier would have
 * shipped green over a defect it was written to catch. A single left-to-right pass tracking
 * string / line-comment / block-comment state cannot have that gap.
 */
export function commentsOnly(src: string): string {
  const out: string[] = [];
  type S = 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl';
  let state: S = 'code';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    const keep = () => out.push(c === '\n' ? '\n' : c);
    const drop = () => out.push(c === '\n' ? '\n' : ' ');
    switch (state) {
      case 'code':
        if (c === '/' && n === '/') { state = 'line'; keep(); }
        else if (c === '/' && n === '*') { state = 'block'; keep(); }
        else {
          if (c === "'") state = 'sq';
          else if (c === '"') state = 'dq';
          else if (c === '`') state = 'tpl';
          drop();
        }
        break;
      case 'line':
        if (c === '\n') state = 'code';
        // The newline itself belongs to no comment; keeping it preserves line numbers either way.
        c === '\n' ? drop() : keep();
        break;
      case 'block':
        keep();
        if (c === '*' && n === '/') { out.push('/'); i++; state = 'code'; }
        break;
      case 'sq': case 'dq': case 'tpl': {
        if (c === '\\') { drop(); if (i + 1 < src.length) { out.push(src[i + 1] === '\n' ? '\n' : ' '); i++; } break; }
        const close = state === 'sq' ? "'" : state === 'dq' ? '"' : '`';
        if (c === close) state = 'code';
        drop();
        break;
      }
    }
  }
  return out.join('');
}

/**
 * Every .ts/.tsx/.mjs/.cjs file under a code root, discovered — never a list someone must remember
 * to extend.
 *
 * THE CORPUS WIDENED 2026-09-21 (routine #10, ops_incident #367). This barrier shipped on
 * 2026-09-20 reading `src/` only, beside a sibling reading `docs/` only, and #367 routed the
 * question its own header raises: a barrier whose NAME states a CLASS and whose SCOPE is one
 * corpus is PART 1.11 in a new dress — a pointer reading as coverage.
 *
 * Measured before widening, with THIS predicate over every other tracked corpus:
 *
 *     scrapers/ (368 files) · .github/ (74) · supabase/migrations/ (1,145)  →  ZERO claims
 *     e2e/ (25 files)  →  2 claims, both correct
 *     scripts/ (627 files)  →  24 claims, and SEVEN of them wrong
 *
 * So the sibling corpus is not "everywhere": it is exactly the TypeScript comment corpora, and the
 * one nothing read was `scripts/` — the directory the barriers themselves live in, where a stated
 * constant is trusted most. Two of the seven were live defects rather than narration:
 * `verify-af-live-truth.ts` justified an 8-attempt bound with "AF_ROUND_MAX_QUESTIONS is 5" (it is
 * 4), and `verify-af-terminal-at-25-no-load-more.ts` — renamed 50 → 25 — still stated the rule as
 * the rule as an INTERVIEW_STOP_AT of 50 or fewer in its opening paragraph. Both are fixed here.
 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(tsx?|mjs|cjs)$/.test(entry)) out.push(p);
  }
  return out;
}

/** The code corpora this rule covers. `docs/` is its sibling's; nothing else carries a claim. */
const CODE_ROOTS = ['src', 'scripts', 'e2e'];

const claimsInComments = (src: string): Claim[] => constantClaims(commentsOnly(src), CONSTANTS);

// ── MUTATION PROOFS — both directions, on the REAL predicate ────────────────────────────────────
const live = CONSTANTS.INTERVIEW_STOP_AT;
const wrong = live + 25;

mustCatch('a stale `NAME = <wrong>` in a line comment',
  wrongClaims(claimsInComments(`// the line is INTERVIEW_STOP_AT = ${wrong} today\nconst a = 1;\n`), CONSTANTS));
mustCatch('a stale `NAME=<wrong>` inside a JSX block comment',
  wrongClaims(claimsInComments(`{/* more than INTERVIEW_STOP_AT=${wrong} left to narrow */}\n`), CONSTANTS));
mustCatch('THE REAL 2026-09-20 DEFECT SHAPE — `NAME (<wrong>, … — was <live>)`',
  wrongClaims(claimsInComments(`// INTERVIEW_STOP_AT (${wrong}, owner product rule 2026-09-04 — was ${live}): the same line\n`), CONSTANTS));
mustCatch('a derived constant quoted at its old value (MIN_TOTAL_TO_SHOW=51)',
  wrongClaims(claimsInComments('// floors on the SAME MIN_TOTAL_TO_SHOW=51 constant\n'), CONSTANTS));

mustPass('a comment quoting the REAL value',
  wrongClaims(claimsInComments(`// the canonical INTERVIEW_STOP_AT (${live}, R11.1): the line at which AF stops\n`), CONSTANTS));
mustPass('deliberate historical narration that BINDS the live value',
  wrongClaims(claimsInComments(
    `// examples that used to sit here were written against INTERVIEW_STOP_AT = ${live} and silently\n`
    + `// became false; "one yielding 46 qualifies" was true at INTERVIEW_STOP_AT = ${live} and false at 50.\n`), CONSTANTS));
mustPass('CODE is not a claim — a bare number assigned to an unrelated name',
  wrongClaims(claimsInComments(`const FIRST_PAGE = ${wrong};\nconst other = { INTERVIEW_STOP_AT: ${wrong} };\n`), CONSTANTS));
mustPass('a `//` sequence inside a STRING literal does not open a comment',
  wrongClaims(claimsInComments(`const u = 'https://x/y?INTERVIEW_STOP_AT = ${wrong}';\n`), CONSTANTS));

// ── THE CITATION DISCRIMINATOR (ops_incident #367, added with the scripts/ corpus) ──────────────
// Widening to scripts/ hits one case that must be DISTINGUISHED rather than punished: a barrier's
// own header QUOTES the stale sentence it was written to catch. Six such lines exist, all in the
// two halves of this very rule. Both directions are proven, and the fixtures are the REAL lines.
mustPass('a barrier QUOTING the defect it catches is a citation, not an assertion (this file\'s own '
  + 'header, verbatim)',
  wrongClaims(claimsInComments(
    '//   src/app/agent.tsx:3702       "more than INTERVIEW_STOP_AT=50 left to narrow"\n'
    + '//   src/lib/chatTranscript.ts:117 "An AF-completed chat (R11.1, \u2264 INTERVIEW_STOP_AT = 50 rows)"\n'
    + '//   docs/ops/JOURNEY_PERSISTENCE_ENGINEER.md         "(\u2264 `INTERVIEW_STOP_AT` = 50)"\n'), CONSTANTS));

// …and the exemption is NOT a way to hide a stale claim behind quotation marks. BOTH conditions are
// required, so removing either one puts the claim back in front of the rule.
mustCatch('a quoted stale claim on a line that names NO file is still judged',
  wrongClaims(claimsInComments(`// the rule is "INTERVIEW_STOP_AT = ${wrong}" today\n`), CONSTANTS));
mustCatch('an UNQUOTED stale claim on a line that names a file is still judged',
  wrongClaims(claimsInComments(`// src/app/agent.tsx still assumes INTERVIEW_STOP_AT = ${wrong}\n`), CONSTANTS));
mustCatch('a quoted span that does not CONTAIN the constant does not exempt the claim beside it',
  wrongClaims(claimsInComments(
    `// src/app/agent.tsx:1 "the load-more row" is gated on INTERVIEW_STOP_AT = ${wrong}\n`), CONSTANTS));

// The predicate must be able to see a claim at all — a scanner that finds nothing is vacuous.
check('the comment scan finds real constant claims to judge (not a no-op)',
  claimsInComments(`// INTERVIEW_STOP_AT = ${live} is the line\n`).length > 0);

// ── THE LIVE ASSERTION — every constant claim in every src/ comment quotes the real value ────────
const files = CODE_ROOTS.flatMap((r) => sourceFiles(join(root, r)));
check(`the code-comment scan covers every code corpus (${CODE_ROOTS.join(', ')})`,
  files.length >= 400 && CODE_ROOTS.every((r) => files.some((f) => f.includes(`/${r}/`))),
  `${files.length} files`);

const offenders: string[] = [];
let claimsSeen = 0;
for (const f of files) {
  const claims = claimsInComments(readFileSync(f, 'utf8'));
  claimsSeen += claims.length;
  for (const c of wrongClaims(claims, CONSTANTS)) {
    offenders.push(`${f.replace(root + '/', '')}:${c.line}  says ${c.name} = ${c.claimed}, module exports ${CONSTANTS[c.name]}\n        ${c.text.slice(0, 120)}`);
  }
}

check('every afRanking constant named with a value in a code comment quotes the REAL value',
  offenders.length === 0, offenders.join('\n      '));
check('the code-comment scan actually found constant claims to judge (the barrier is not a no-op)',
  claimsSeen > 0, `${claimsSeen} claims`);

console.log(offenders.length === 0
  ? `\n✅ ${claimsSeen} constant claim(s) in src/ + scripts/ + e2e/ comments all match src/lib/afRanking.ts.`
  : `\n❌ ${offenders.length} stale constant claim(s) in code comments.`);

process.exit(failures === 0 ? 0 : 1);
