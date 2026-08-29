// Every Supabase edge function must actually PARSE.
//
// WHY THIS EXISTS (2026-08-29). PR #1302 merged with all 237 barriers green onto a
// supabase/functions/agent/index.ts that was missing one closing brace — logUsage() never closed.
// The whole suite passed because every barrier that reads this file reads it as TEXT and matches
// regexes against it. A regex is happy with a file that no compiler would accept. The break only
// surfaced at `supabase functions deploy`:
//
//   Error: Expected '}', got '<eof>' at .../supabase/functions/agent/index.ts:1179:1
//   failed to bundle function: exit 1
//
// The deploy failed closed, so production was never harmed — but the defect reached main, and the
// agent is the one function with no CI that ever compiles it (Deno is not installed on the runner
// and `tsc` does not include supabase/functions in the app's tsconfig).
//
// This is the owner's standing rule applied to a new surface: a barrier that matches a STRING is
// not evidence about CODE. See feedback_a-comment-is-not-a-code-path. The fix is to stop asserting
// about the text and make something actually parse it.
//
// Deliberately not a full typecheck: these files import from Deno/esm URLs that Node cannot
// resolve, so type resolution is unavailable here. But two classes ARE checkable without resolving
// a single import, and both have now broken production:
//
//   1. SYNTAX — the missing brace above. Caught by the parser.
//   2. REDECLARATION — 2026-08-29, one hour later: the same merge left TWO `const t0 = Date.now()`
//      in one scope. It PARSED fine, so the parse check passed, the bundle succeeded, the deploy
//      reported success, and the function then failed to BOOT on every request:
//        worker boot error: Uncaught SyntaxError: Identifier 't0' has already been declared
//      The agent was down until it was fixed. A merge that unions two branches' edits into one
//      function body is exactly how a duplicate declaration appears, so this is a merge hazard,
//      not a typo hazard — it will happen again.
//
// Redeclaration is a BINDER diagnostic, not a parser one, so it needs a Program. We build one with
// noResolve + noLib so no import is ever fetched, and report only the small set of error codes that
// are decidable without types. Everything else (missing modules, unknown types) is ignored on
// purpose — this barrier must never fail for a Deno import Node cannot see.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const ROOT = "supabase/functions";
let failures = 0;
let checked = 0;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

for (const file of walk(ROOT)) {
  checked++;
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  // parseDiagnostics is not on the public type but is populated by createSourceFile and is the
  // only way to see syntax errors without a full Program (which cannot resolve Deno imports).
  const diags = ((sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics) ?? [];
  if (diags.length === 0) {
    console.log(`PASS  parses: ${file}`);
    continue;
  }
  failures++;
  for (const d of diags.slice(0, 5)) {
    const { line, character } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
    const msg = ts.flattenDiagnosticMessageText(d.messageText, " ");
    console.log(`FAIL  ${file}:${line + 1}:${character + 1} — ${msg}`);
  }
  if (diags.length > 5) console.log(`      …and ${diags.length - 5} more`);
}

// ── REDECLARATION PASS ────────────────────────────────────────────────────────
// Only these codes. They are decidable from the binder alone, need no type resolution, and each
// one means the Deno runtime refuses to boot the worker.
const BOOT_FATAL = new Map<number, string>([
  [2451, "Cannot redeclare block-scoped variable"],
  [2300, "Duplicate identifier"],
  [2567, "Enum declarations can only merge with namespace or other enum declarations"],
]);

const files = walk(ROOT);
const program = ts.createProgram(files, {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  noResolve: true, // never fetch a Deno/esm.sh URL
  noLib: true, // no DOM/Node libs — we are not typechecking, only binding
  allowJs: false,
  skipLibCheck: true,
});

for (const file of files) {
  const sf = program.getSourceFile(file);
  if (!sf) continue;
  const fatal = program
    .getSemanticDiagnostics(sf)
    .filter((d) => BOOT_FATAL.has(d.code));
  if (fatal.length === 0) {
    console.log(`PASS  no duplicate declarations: ${file}`);
    continue;
  }
  failures++;
  for (const d of fatal) {
    const { line, character } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
    const msg = ts.flattenDiagnosticMessageText(d.messageText, " ");
    console.log(`FAIL  ${file}:${line + 1}:${character + 1} — ${msg} (TS${d.code})`);
    console.log(`      the Deno worker would refuse to boot: "Identifier has already been declared"`);
  }
}

if (checked === 0) {
  console.log(`FAIL  no edge functions found under ${ROOT}/ — this barrier would pass vacuously`);
  failures++;
}

console.log(
  failures === 0
    ? `\n✓ all ${checked} edge-function source files parse`
    : `\n✗ ${failures} edge-function file(s) do not parse — \`supabase functions deploy\` would fail`,
);
process.exit(failures === 0 ? 0 : 1);
