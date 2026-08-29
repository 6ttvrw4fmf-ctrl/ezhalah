// EVERY EDGE FUNCTION MUST PARSE (production outage 2026-08-29).
// Auto-discovered barrier + edge-deploy gate.
//
// THE OUTAGE. The agent function returned BOOT_ERROR — "Function failed to start" — on every
// request. Cause: `const t0 = Date.now();` declared TWICE in the same scope inside runModel(), one
// from the health heartbeat (PR#1290) and one from the usage telemetry (PR#1302), merged
// independently. Deno refuses to boot a module with a duplicate declaration.
//
// WHY NOTHING CAUGHT IT. `npm test` never parsed the edge sources, and `tsc --noEmit` runs against
// the app's tsconfig, which does not include supabase/functions. So main could contain a file that
// cannot even be parsed and every check stayed green — PR#1304's own title says exactly that:
// "close logUsage() — main did not parse, and no barrier could see it". That PR fixed its instance
// without adding a gate, and the very next merge reproduced the class.
//
// This is that gate. It is deliberately a PARSE check, not a type check: the edge runs under Deno
// with globals (Deno.env) the app's TypeScript config does not know, so type errors here would be
// noise. A file that cannot parse is unambiguous and is what actually takes production down.
import { readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
};

const root = new URL("..", import.meta.url).pathname;
const fnDir = join(root, "supabase/functions");
const fns = readdirSync(fnDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(fnDir, d.name, "index.ts")))
  .map((d) => d.name);

check(`found edge functions to check (${fns.length}: ${fns.join(", ")})`, fns.length > 0,
  "if this ever finds zero, the glob is wrong and the gate is silently off");

for (const name of fns) {
  const entry = join(fnDir, name, "index.ts");
  try {
    // esbuild parses TypeScript exactly as a bundler/runtime would, and reports duplicate
    // declarations, unbalanced braces and unterminated literals — the failures that cause BOOT_ERROR.
    execFileSync("npx", ["--yes", "esbuild@0.24.0", entry, "--outfile=/dev/null"],
      { stdio: ["ignore", "ignore", "pipe"], cwd: root, timeout: 120_000 });
    check(`${name}/index.ts parses`, true);
  } catch (e) {
    const err = (e as { stderr?: Buffer }).stderr?.toString() ?? String(e);
    check(`${name}/index.ts parses`, false, err.split("\n").slice(0, 8).join("\n      "));
  }
}

if (failed) {
  console.error(`\n✗ ${failed} check(s) FAILED — an edge function cannot parse and would BOOT_ERROR in production`);
  process.exit(1);
}
console.log("\nOK — every edge function parses");
