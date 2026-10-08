// A city named in English («… for sale in Riyadh») must never become a DISTRICT filter.
//
// HOW THIS WAS EARNED (🔧 Quality & Repair, 2026-10-08). ops_zero_result_log held two real users'
// «no results» for «شقة للبيع» in الرياض and in الدمام. The query carried districts ["Al Riyadh"] /
// ["Al Dammam"]: resolveDistrictsFromText() in src/data/agent.ts read ANY «in X» as a district and
// prefixed it with «Al ». No listing has a district called «Al Riyadh», so the RPC answered 0 while
// the same search without it returned thousands (location_search_candidates_ar, measured).
//
// This EXECUTES the real function (lifted from the source, never a copy) and then plants the old
// regex back into a copy of the source to prove the check goes RED on it.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { liftSymbols } from "./lib/liftSymbols.ts";

const FILE = "src/data/agent.ts";
const SYMBOLS = [
  { header: "const AREA_DISTRICTS: Record<string, string[]> = {" },
  { header: "function resolveDistrictsFromText(" },
];

type Fn = (text: string, city: string) => string[];

function problems(fn: Fn): string[] {
  const out: string[] = [];
  const expect = (text: string, city: string, want: string[]) => {
    const got = fn(text, city);
    if (JSON.stringify(got) !== JSON.stringify(want)) out.push(`${JSON.stringify(text)} → ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  };
  // A city is never a district.
  expect("apartment for sale in Riyadh", "Riyadh", []);
  expect("villa for rent in Dammam", "Dammam", []);
  expect("land in Al Khobar", "Al Khobar", []);
  // A real English district mention still works (the word «district»/«neighborhood» is required).
  expect("apartment in Hittin district", "Riyadh", ["Al Hittin"]);
  expect("flat in the district of Al Olaya", "Riyadh", ["Al Olaya"]);
  expect("house in Malqa neighbourhood", "Riyadh", ["Al Malqa"]);
  // Arabic «حي X» is unchanged.
  expect("شقة للبيع حي النرجس في الرياض", "Riyadh", ["النرجس"]);
  return out;
}

const real = (await liftSymbols(FILE, SYMBOLS, ["resolveDistrictsFromText"])).resolveDistrictsFromText as Fn;
const bad = problems(real);
if (bad.length) {
  console.error("✗ resolveDistrictsFromText turns a place into the wrong district filter:\n  " + bad.join("\n  "));
  process.exit(1);
}

// Mutation proof: the 2026-10-08 regex must be caught.
const OLD = "const enHiRe = /\\b(?:in|district\\s+of|neighborhood\\s+of)\\s+(?:al[-\\s])?([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,2})\\s*(?:district|neighborhood)?/g;";
const src = readFileSync(FILE, "utf8");
const line = src.split("\n").find((l) => l.trimStart().startsWith("const enHiRe = "));
if (!line) { console.error("✗ enHiRe not found in " + FILE); process.exit(1); }
const dir = mkdtempSync(join(tmpdir(), "ezhalah-mut-"));
const mutFile = join(dir, "agent.ts");
writeFileSync(mutFile, src.replace(line, "  " + OLD).replace("out.push(`Al ${m[1] ?? m[2]}`)", "out.push(`Al ${m[1]}`)"));
const mutant = (await liftSymbols(mutFile, SYMBOLS, ["resolveDistrictsFromText"])).resolveDistrictsFromText as Fn;
if (problems(mutant).length === 0) {
  console.error("✗ mutation proof failed: the old «in X» regex was not caught");
  process.exit(1);
}
console.log("✓ an English city is never a district filter (7 cases; old regex caught)");
