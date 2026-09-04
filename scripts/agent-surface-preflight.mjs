#!/usr/bin/env node
// COLLISION PREFLIGHT for the AI agent edge function (owner ruling 2026-08-29).
//
// The parse gate catches SYNTACTIC collisions. It cannot catch two logically valid changes that
// overwrite or contradict each other — which is the residual risk once several sessions edit one
// ~113KB production file. This is the check for that.
//
//   node scripts/agent-surface-preflight.mjs before   # run BEFORE writing: is anyone else in here?
//   node scripts/agent-surface-preflight.mjs final    # run AFTER rebase, BEFORE merge/deploy
//
// `final` is the important one. It answers: "after rebasing onto main, is the merged function still
// exactly my intended change plus whatever main legitimately gained — or did a rebase silently drop,
// duplicate or overwrite something?"
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const FILE = "supabase/functions/agent/index.ts";
const mode = process.argv[2] ?? "before";
const sh = (c) => execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
let problems = 0;
const fail = (m, d = "") => { problems++; console.log(`✗ ${m}${d ? `\n    ${d}` : ""}`); };
const ok = (m) => console.log(`✓ ${m}`);

console.log(`── agent-surface preflight (${mode}) ──\n`);

// 1. main must be current — a stale checkout is how you rebase onto the wrong thing.
sh("git fetch -q origin main");
const local = sh("git rev-parse HEAD");
const mainSha = sh("git rev-parse origin/main");
const branch = sh("git rev-parse --abbrev-ref HEAD");
const behind = Number(sh(`git rev-list --count HEAD..origin/main`));
console.log(`   branch ${branch}  HEAD ${local.slice(0, 8)}  origin/main ${mainSha.slice(0, 8)}`);
if (behind > 0) {
  (mode === "final" ? fail : (m) => console.log(`! ${m}`))(
    `${behind} commit(s) behind origin/main — REBASE before merging.`,
    "git fetch origin main && git merge origin/main (or rebase), then re-run `final`.");
} else ok("up to date with origin/main");

// 2. Who else is touching this exact surface? Open PRs first — those are the live collisions.
let openPrs = [];
try {
  openPrs = JSON.parse(sh(`gh pr list --state open --limit 60 --json number,title,headRefName,author`));
} catch { console.log("! could not list open PRs (gh unavailable) — check manually"); }
const touching = [];
for (const pr of openPrs) {
  if (pr.headRefName === branch) continue;             // this branch is mine
  try {
    const files = sh(`gh pr diff ${pr.number} --name-only`).split("\n");
    if (files.includes(FILE)) touching.push(pr);
  } catch { /* diff unavailable — skip rather than guess */ }
}
if (touching.length) {
  fail(`${touching.length} OPEN PR(s) also modify ${FILE}:`,
    touching.map((p) => `#${p.number} ${p.title} (${p.author?.login ?? "?"})`).join("\n    ")
    + "\n    Two logically-correct changes to one function is exactly what broke production on 2026-08-29."
    + "\n    Coordinate or wait — do not merge over them.");
} else ok("no other OPEN PR touches this file");

// 3. Recently merged changes to the same surface — what your rebase just absorbed.
const recent = sh(`git log --oneline -8 origin/main -- ${FILE}`);
console.log(`\n   recent commits to ${FILE}:\n${recent.split("\n").map((l) => "     " + l).join("\n")}\n`);

if (mode === "final") {
  // 4. THE SEMANTIC DIFF. Compare the merged file against main and show exactly what this branch
  //    adds. A reviewer (human or agent) must be able to say "yes, that is my change and nothing else".
  if (!existsSync(FILE)) fail(`${FILE} is missing`);
  else {
    const diff = sh(`git diff origin/main -- ${FILE} || true`);
    const added = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
    const removed = diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
    console.log(`   SEMANTIC DIFF vs origin/main — +${added.length} / -${removed.length} lines`);
    if (removed.length) {
      console.log(`   REMOVED lines (confirm every one is intentional — this is where a silent overwrite hides):`);
      for (const l of removed.slice(0, 25)) console.log(`     ${l}`);
      if (removed.length > 25) console.log(`     … ${removed.length - 25} more`);
    }
    // Duplicate top-level declarations are the 2026-08-29 outage signature. The parse gate catches
    // them too, but naming them here tells you WHY before you spend a deploy finding out.
    const src = readFileSync(FILE, "utf8");
    const decls = [...src.matchAll(/^\s*(?:const|let|function)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
    const dupes = [...new Set(decls.filter((d, i) => decls.indexOf(d) !== i))];
    if (dupes.length) console.log(`   ! repeated declaration names (check scope): ${dupes.slice(0, 12).join(", ")}`);
    ok("semantic diff printed — review REMOVED lines before merging");
  }
  // 5. The file must actually parse. Cheap here; a production outage otherwise.
  try { execSync(`node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/verify-edge-functions-parse.ts`, { stdio: "pipe" }); ok("edge functions parse"); }
  catch (e) { fail("edge parse gate FAILED", (e.stdout?.toString() ?? "").split("\n").slice(-6).join("\n    ")); }
}

console.log("");
if (problems) {
  console.log(`✗ ${problems} blocker(s). Do not write/merge this surface until resolved.`);
  process.exit(1);
}
console.log("✓ preflight clear.");
