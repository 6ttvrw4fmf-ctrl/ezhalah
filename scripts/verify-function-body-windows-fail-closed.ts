// PERMANENT META-BARRIER — a barrier that reads a SQL function body may not ASSUME the dollar tag,
// and may never fall back to the un-narrowed source (2026-09-24, routine-10-barrier).
//
// ── THE DEFECT, WATCHED BY EXECUTION ──────────────────────────────────────────────────────────────
//
// Five barriers narrowed a migration to one function's body with a reader of this shape:
//
//     const rest  = sql.slice(headerMatch.index);
//     const close = rest.match(/\$function\$\s*;/i);
//     body = close ? rest.slice(0, close.index! + close[0].length) : rest;
//                                                                    ^^^^
// PostgreSQL dollar-quoting lets a function body be delimited by ANY tag — `$function$`, `$$`,
// `$mig$`, `$f$`. `pg_get_functiondef` emits `$function$`, which is why these readers work today:
// most of this tree's committed definitions were pasted back from it. Hand-written migrations use
// `$$`, and this tree is full of them. Against one of those, `close` is null and the "body" becomes
// THE WHOLE REST OF THE FILE, so every assertion underneath matches text that is not in the function.
//
// REPRODUCED on scripts/verify-nonprice-price-monitor.ts, 2026-09-24, before any repair. A plausible
// follow-up migration — `create or replace function public.mon_detect_field_integrity() … as $$
// <the P0 phone/ID-price guard deleted> $$;` followed by the data repair such a migration obviously
// carries (`update … where price_total between 500000000 and 599999999`) — and the barrier printed:
//
//     PASS  winning body checks the phone-band [500000000,599999999]
//     PASS  winning body checks the ID artifact band [100000000,101000000]
//     PASS  winning body raises the field_integrity_phone_price alert
//     ✓ non-price (phone/ID) price monitor is present in migrations
//
// with the guard gone. A sixth site, scripts/verify-stale-remediation-detector.ts, wore the same
// hazard in a different disguise: `detector.slice(detector.indexOf('$function$'))` — `indexOf`
// returns -1, `slice(-1)` yields THE LAST CHARACTER of the file, and every forbidden-write pattern
// below it then fails to match, so a detector that DID write to a listings table read as clean.
//
// This is R4's hazard (scripts/lib/sourceWindow.ts, BARRIER_ENGINEER.md PART 3) in a second
// mechanism, and it has R4's defining property: the blinding change — writing `$$` instead of
// `$function$` in some unrelated migration — is innocent in isolation, is not a change to the
// barrier, and need never be made by the same person or in the same month as the defect it hides.
//
// ── WHAT IS ASSERTED ─────────────────────────────────────────────────────────────────────────────
//
// No barrier may PARSE a function body using a hardcoded tag. The correct reader already existed,
// exported, in scripts/lib/rpcReplay.ts — `replayFunction()` finds the ACTUAL tag, requires its
// matching close, reports what it could not interpret in `unresolved`, and replays later
// needle-edits. Five barriers had hand-rolled a broken copy beside it. Use it, or read the tag with
// `/\$([A-Za-z_][A-Za-z0-9_]*)?\$/` and fail closed when there is no matching close.
//
// WRITING a `$function$` literal into synthetic SQL is not parsing it, and is not flagged: a barrier
// that builds a fixture is stating what the shape looks like, not assuming it. The two are told
// apart by EXECUTION below, in both directions.
//
//   node --experimental-strip-types scripts/verify-function-body-windows-fail-closed.ts
//   (auto-discovered into `npm test` by scripts/lib/testRegistry.ts)

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './lib/stripComments.ts';

const ROOT = join(import.meta.dirname, '..');
const SCRIPTS = join(ROOT, 'scripts');

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  ❌ ${m}`); };
const ok = (m: string) => console.log(`  ✓ ${m}`);

/** A hardcoded body tag being used to PARSE — i.e. to locate a position in text someone else wrote.
 *
 *  The tell is the tag literal standing next to a search verb. A fixture writes the tag INTO a
 *  string it is constructing; a parser hands the tag TO `match` / `indexOf` / `search` / `exec` /
 *  `split` / `slice`. That is the distinction, and it is proven in both directions below. */
const PARSE_VERBS = String.raw`(?:match|indexOf|lastIndexOf|search|exec|split|slice)`;
const TAG_LITERAL = String.raw`(?:'\$(?:function|procedure)\$[^']*'|"\$(?:function|procedure)\$[^"]*"|/\\\$(?:\(?function|procedure)[^/]*/)`;

export function hardcodedTagParses(source: string): string[] {
  const code = stripComments(source);
  const hits: string[] = [];
  // `x.match(/\$function\$…/)`, `x.indexOf('$function$')`, `x.split('$procedure$')`
  const direct = new RegExp(String.raw`\.\s*${PARSE_VERBS}\s*\(\s*${TAG_LITERAL}`, 'g');
  for (const m of code.matchAll(direct)) hits.push(m[0].replace(/\s+/g, ' ').slice(0, 80));
  // `const re = /\$function\$\s*;/i` assigned, then used — the two-step form the five sites used.
  const assigned = new RegExp(String.raw`=\s*/\\\$(?:function|procedure)\\\$[^/\n]*/`, 'g');
  for (const m of code.matchAll(assigned)) hits.push(m[0].replace(/\s+/g, ' ').slice(0, 80));
  // `new RegExp(\`…\\\\$function\\\\$([\\s\\S]*?)\\\\$function\\\\$\`)` — the tag baked into a
  // pattern STRING rather than a literal. This one fails CLOSED (the definition is simply not
  // found), which sounds harmless and is not: the barrier then goes RED because some unrelated
  // migration used `$$`, and a guard that cries wolf is a guard someone lowers.
  const inPatternString = /new\s+RegExp\([\s\S]{0,200}?\\\\\$(?:function|procedure)\\\\\$/g;
  for (const m of code.matchAll(inPatternString)) hits.push(m[0].replace(/\s+/g, ' ').slice(0, 80));
  return hits;
}

// SHRINK-ONLY. A row is `script | why this parse is safe`. It may not grow: a new hardcoded-tag
// parse is RED, and a row whose script no longer parses with a hardcoded tag is RED AS STALE, so
// this ledger can never read better than the tree. Measured 2026-09-24: EMPTY, because all five
// fail-open sites and the sixth `slice(indexOf(...))` site were converted in the same change.
const BASELINE: Record<string, string> = {};

const scripts = readdirSync(SCRIPTS)
  .filter((f) => (f.endsWith('.ts') || f.endsWith('.mjs')) && f !== 'verify-function-body-windows-fail-closed.ts');
const libs = readdirSync(join(SCRIPTS, 'lib')).filter((f) => f.endsWith('.ts')).map((f) => join('lib', f));

const offenders = new Map<string, string[]>();
for (const rel of [...scripts, ...libs]) {
  const hits = hardcodedTagParses(readFileSync(join(SCRIPTS, rel), 'utf8'));
  if (hits.length) offenders.set(rel, hits);
}

console.log(
  `verify-function-body-windows-fail-closed: ${scripts.length + libs.length} script(s) scanned, `
  + `${offenders.size} parsing a function body with a hardcoded tag`,
);

for (const [rel, hits] of offenders) {
  if (BASELINE[rel]) { ok(`${rel}: baselined — ${BASELINE[rel]}`); continue; }
  fail(
    `${rel} parses a SQL function body with a HARDCODED dollar tag: ${hits.join(' · ')}\n`
    + `      A body delimited with \`$$\` (or any other tag) is not found, and the reader then either\n`
    + `      widens to the rest of the file or narrows to nothing — both of which read as HEALTHY.\n`
    + `      Fix: use replayFunction() from scripts/lib/rpcReplay.ts, or read the tag with\n`
    + `      /\\$([A-Za-z_][A-Za-z0-9_]*)?\\$/ and return '' when it has no matching close.`,
  );
}
for (const rel of Object.keys(BASELINE)) {
  if (!offenders.has(rel)) fail(`${rel}: baselined but no longer parses with a hardcoded tag — remove the stale row`);
}
if (offenders.size === 0) ok('no barrier assumes the dollar tag of a function body');

// ── MUTATION PROOFS — the predicate is EXECUTED against real and broken shapes ──────────────────
const mustCatch = (what: string, run: () => boolean) => {
  if (run()) ok(`mutation caught: ${what}`);
  else fail(`MUTATION SURVIVED: ${what}`);
};

// The five sites' EXACT historical shapes, verbatim from git history.
mustCatch('the `close ? … : rest` shape (verify-nonprice-price-monitor.ts, pre-repair)', () =>
  hardcodedTagParses(
    'const close = rest.match(/\\$function\\$\\s*;/i);\n'
    + 'found = { file: f, body: close ? rest.slice(0, close.index! + close[0].length) : rest };',
  ).length > 0);
mustCatch('the function-or-procedure variant (verify-aqar-trigger-preserves-source-ppm.ts, pre-repair)', () =>
  hardcodedTagParses('const close = rest.match(/\\$(function|procedure)\\$\\s*;/i);').length > 0);
mustCatch('the `slice(indexOf(tag))` variant (verify-stale-remediation-detector.ts, pre-repair)', () =>
  hardcodedTagParses("const body = detector.slice(detector.indexOf('$function$'));").length > 0);
mustCatch('the `indexOf(tag, indexOf(tag)+1)` variant (verify-p0-sweep-exposure-evidence.ts, pre-repair)', () =>
  hardcodedTagParses("const end = rest.indexOf('$function$', rest.indexOf('$function$') + 1);").length > 0);
mustCatch('the regex assigned to a const first, then used', () =>
  hardcodedTagParses('const CLOSE = /\\$function\\$\\s*;/i;\nconst m = rest.match(CLOSE);').length > 0);

// …and it is not vacuously red. These are the shapes that must keep passing, or the ratchet becomes
// a tax on writing fixtures and gets lowered — which is how a ratchet dies.
const notFlagged = (label: string, src: string) => {
  if (hardcodedTagParses(src).length === 0) ok(`negative control: ${label}`);
  else fail(`over-broad: ${label} is flagged`);
};
notFlagged('a FIXTURE writing $function$ into synthetic SQL',
  "const OLD = `CREATE OR REPLACE FUNCTION public.f() RETURNS int AS $function$ begin return 1; end; $function$;`;");
notFlagged('a template-literal fixture across lines',
  'const sql = `create or replace function public.g()\nreturns integer language plpgsql as $function$\nbegin return 0; end\n$function$;`;');
notFlagged('a COMMENT describing the tag (prose is not a code path)',
  "// Body is dollar-quoted ($function$ … $function$ / $$ … $$). Take through the CLOSING tag.");
notFlagged('the CORRECT tag-generic reader in scripts/lib/rpcReplay.ts',
  "const tagM = /\\$([A-Za-z_][A-Za-z0-9_]*)?\\$/.exec(sql.slice(start));\n"
  + 'const closeAt = sql.indexOf(tag, openAt + tag.length);');
notFlagged('an ordinary .match on something unrelated', "const m = body.match(/price_total\\s+between/);");

// The corpus itself must be non-trivial — an empty scan is a failure, never a clean bill of health.
if (scripts.length + libs.length < 400) {
  fail(`only ${scripts.length + libs.length} script(s) scanned — discovery has gone blind`);
} else {
  ok(`${scripts.length + libs.length} script(s) in the scanned corpus`);
}

console.log(
  failures === 0
    ? '\n✅ no barrier assumes a function body\'s dollar tag; the correct reader is the shared one'
    : `\n❌ verify-function-body-windows-fail-closed: ${failures} failure(s)`,
);
process.exit(failures === 0 ? 0 : 1);
