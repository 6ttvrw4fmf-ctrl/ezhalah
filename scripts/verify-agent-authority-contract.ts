// Agent-authority contract guard (owner-granted autonomy, 2026-08-04).
//
// docs/ops/AGENT_AUTHORITY.md is what makes the Senior and Junior routines act instead of asking.
// Because it GRANTS power, the risk runs the other way from most guards: the danger is not that it
// gets deleted, but that it quietly WIDENS — an agent trimming the RED list to unblock itself, or a
// careless edit dropping "taxonomy" or "bulk/destructive" from the approval list.
//
// Widening GREEN or narrowing RED is an OWNER decision. This check makes an agent unable to grant
// itself authority silently: drop a RED category and CI goes red before it can matter.
//
// It also pins the load-bearing link — AGENTS.md is what actually overrides the routine prompts, so
// if AGENTS.md stops pointing at the contract, the contract stops governing anything.
import { readFileSync, existsSync } from 'node:fs';

const CONTRACT = 'docs/ops/AGENT_AUTHORITY.md';
const AGENTS = 'AGENTS.md';

const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

for (const f of [CONTRACT, AGENTS]) {
  if (!existsSync(f)) {
    console.error(`❌ agent-authority-contract: ${f} is missing — the autonomy grant is incoherent.`);
    process.exit(1);
  }
}

const contract = readFileSync(CONTRACT, 'utf8');
const agents = readFileSync(AGENTS, 'utf8');
const lc = contract.toLowerCase();
// Prose checks run against an emphasis-stripped copy: the contract is written for humans and uses
// **bold** on exactly the phrases worth pinning, which would otherwise break a naive literal match
// and make this guard fail for a formatting reason rather than a substantive one.
const plain = contract.replace(/[*_`]/g, '');
// Prose in this file is hard-wrapped at ~100 cols, so any pinned phrase long enough to matter will
// straddle a newline. Collapse whitespace for those — otherwise a guard silently stops guarding the
// moment someone reflows a paragraph, which is the worst failure mode a guard can have.
const flat = plain.replace(/\s+/g, ' ');

// ── 1. AGENTS.md must still route agents to the contract. ────────────────────────────────────
// AGENTS.md is loaded into every session and declared as overriding; the contract only has force
// because AGENTS.md points at it.
check(agents.includes('docs/ops/AGENT_AUTHORITY.md'),
  'AGENTS.md links the authority contract (so it overrides routine prompts)',
  `${AGENTS} must reference ${CONTRACT} — otherwise the contract governs nothing`);

// ── 2. Every RED category must survive. These are the owner's reserved decisions. ────────────
const RED_CATEGORIES: Array<[string, RegExp]> = [
  ['business/product decisions', /business\s*\/?\s*product decision/i],
  ['taxonomy changes',           /taxonomy change/i],
  ['Region → City → District',   /region\s*→\s*city\s*→\s*district/i],
  ['bulk/destructive listings',  /bulk (or destructive )?listing/i],
  ['new search/product semantics', /new search\s*\/?\s*product semantics/i],
  ['destructive schema changes', /destructive or high-risk schema/i],
  ['not easily reversible',      /not easily reversible/i],
  ['weakening a safety gate',    /weakening or bypassing a safety gate/i],
  ['genuine ambiguity',          /genuine ambiguity/i],
];
for (const [name, re] of RED_CATEGORIES) {
  check(re.test(plain),
    `RED preserved: ${name}`,
    `RED category "${name}" is missing from ${CONTRACT} — an agent may not narrow the approval list`);
}

// ── 3. The gates must still be declared non-waivable by the grant. ───────────────────────────
check(/never remov/i.test(plain),
  'contract states autonomy never removes the gates',
  'contract must state that autonomy means walking through the gates, never removing them');
for (const gate of ['deploy lock', 'safe-deploy.sh', 'target lock']) {
  check(lc.includes(gate.toLowerCase()),
    `gate still named as in force: ${gate}`,
    `contract must still name "${gate}" as remaining in force`);
}

// ── 4. The two rules that stop autonomy becoming recklessness. ───────────────────────────────
check(/never deploy to (prove|test)/i.test(plain),
  'contract forbids deploying merely to test the pipeline',
  'contract must forbid deploying just to prove the pipeline works');
check(/evidence before the write/i.test(plain),
  'contract requires evidence captured before any write',
  'contract must require evidence before the write (no speculative fixes)');
check(/fidelity/i.test(plain),
  'contract preserves the source-fidelity rule',
  'contract must preserve source fidelity (never "correct" a source-published value)');

// ── 4b. RED #5 keeps its core even though count defects were carved out of it. ───────────────
// Checks 2 pins that the nine RED categories still EXIST by name. It cannot see scope erosion
// INSIDE one — a carve-out that hollows a category out passes every check above. That is not
// hypothetical: the 2026-08-22 count-correctness ruling did exactly that to RED #5 (correctly, and
// by owner decision), and this guard did not notice. So pin the boundary the carve-out must not
// cross: fixing a surface so an EXISTING rule holds is GREEN, but *changing the rule itself* stays
// the owner's. Without this, a later agent can widen "count fixes are GREEN" into "filter semantics
// are GREEN" one sentence at a time, each step passing CI.
check(/redefining what a filter means/i.test(flat),
  'RED #5 still reserves redefining what a filter means',
  'contract must keep "redefining what a filter means" RED — the count-defect carve-out may not ' +
    'grow into a licence to change filter semantics');
check(/implementing an existing rule correctly is never a new product decision/i.test(flat),
  'count-defect carve-out states its own basis (existing rule, not a new one)',
  'the count-defect carve-out must state that it only covers implementing an EXISTING rule — ' +
    'otherwise it reads as blanket authority over counts');

// ── 5. Self-amendment is an owner decision. ──────────────────────────────────────────────────
check(/owner decision and requires owner approval/i.test(plain),
  'widening GREEN / narrowing RED reserved to the owner',
  'contract must state that changing the authority itself requires owner approval');

console.log('agent-authority-contract: the autonomy grant must keep its limits');
for (const line of ok) console.log(`  ✓ ${line}`);

if (problems.length > 0) {
  console.error('\n❌ agent-authority-contract: the autonomy grant lost a limit:');
  for (const p of problems) console.error(`     • ${p}`);
  console.error('\n   An engineering agent may NOT grant itself authority. If the owner is genuinely');
  console.error('   widening the grant, they change this guard in the same reviewed commit.');
  process.exit(1);
}

console.log('\n✓ agent-authority-contract: passed.');
