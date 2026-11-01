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
  // A budget / deal word or «بالرياض» right after the name is not part of it (live 2026-10-13: «النرجس بحدود»).
  expect("ابي شقة ٣ غرف للايجار في الرياض حي النرجس بحدود ٦٠ ألف", "الرياض", ["النرجس"]);
  // A bathroom / room / feature count after the name is not part of it (ops_zero_result_log 2026-10-13 07:42: «الرجس حمامين»).
  expect("فيلا للإيجار في الرياض حي النرجس حمامين", "الرياض", ["النرجس"]);
  expect("شقة حي الملقا مجلس وصالة", "الرياض", ["الملقا"]);
  expect("بيت حي الياسمين دورين", "الرياض", ["الياسمين"]);
  expect("فيلا حي الملقا بالرياض", "الرياض", ["الملقا"]);
  expect("شقة حي الياسمين للايجار", "الرياض", ["الياسمين"]);
  // Two-word district names still keep both words.
  expect("شقة في حي الدار البيضاء", "الرياض", ["الدار البيضاء"]);
  expect("فيلا في حي ظهرة لبن", "الرياض", ["ظهرة لبن"]);
  // «حي» used as a plain word, followed by «في / من», names no district (live 2026-10-13: «في الرياض؟» became one).
  expect("وش أفضل حي في الرياض؟", "الرياض", []);
  expect("أي حي من أحياء جدة أحسن", "جدة", []);
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
const mustCatch = (label: string, caught: boolean) => {
  if (!caught) { console.error(`✗ mutation proof failed: ${label} was not caught`); process.exit(1); }
};
mustCatch("the 2026-10-08 «in X» regex (a city read as a district)", problems(mutant).length > 0);
// …and the 2026-10-13 Arabic regex (any second word kept: «النرجس بحدود»).
const AR_OLD = "  const arHiRe = /حي\\s+([؀-ۿ]+(?:\\s+(?!في|و|أو|منطقة|مدينة)[؀-ۿ]+)?)/g;";
const arLine = src.split("\n").find((l) => l.trimStart().startsWith("const arHiRe = "));
if (!arLine) { console.error("✗ arHiRe not found in " + FILE); process.exit(1); }
const arFile = join(dir, "agent-ar.ts");
writeFileSync(arFile, src.replace(arLine, AR_OLD));
const arMutant = (await liftSymbols(arFile, SYMBOLS, ["resolveDistrictsFromText"])).resolveDistrictsFromText as Fn;
mustCatch("the 2026-10-13 «حي X <any word>» regex (a budget word read into the district)", problems(arMutant).length > 0);
console.log("✓ an English city is never a district filter, and a budget word is never part of a district (14 cases; both old regexes caught)");
