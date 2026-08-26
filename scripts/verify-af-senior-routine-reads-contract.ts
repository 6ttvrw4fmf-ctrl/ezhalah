// SENIOR AF ROUTINE MUST READ THE PRODUCT CONTRACT (owner rule 2026-08-26)
//
// The Senior Advanced Filter + Trending Data Integrity Engineer routine (spec:
// docs/ops/AF_TRENDING_DATA_INTEGRITY_ENGINEER.md) has ONE canonical source of truth for what
// Advanced Filter does: docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md. The routine spec's own §0.1
// makes reading that contract the first mandatory step of every run, and its FINAL REPORT format
// requires a "CONTRACT READ" line naming the file. This barrier pins those obligations to the
// routine spec so a future edit cannot quietly loosen them and let a future run drift back to
// reconstructing AF rules from old chats/PRs/memory.
//
// This is a source-shape barrier (no browser, no network), executable as plain Node.

import { readFileSync, existsSync, statSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
};

console.log('\nSenior AF routine reads the Product Contract (owner 2026-08-26)\n');

// 1. Canonical contract exists.
const contractPath = new URL('../docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md', import.meta.url).pathname;
check('the canonical AF Product Contract exists at docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md', existsSync(contractPath));
const contract = readFileSync(contractPath, 'utf8');
check('contract identifies itself as PERMANENT/CANONICAL in its title', /PERMANENT, CANONICAL/.test(contract));
check('contract carries the core philosophy sentence (§0)', /Advanced Filter exists to narrow[\s\S]{0,120}25 listings/.test(contract));
check('contract is non-trivial (≥ 200 lines to be a real spec, not a stub)', contract.split('\n').length >= 200);

// 2. Senior AF routine spec references it as the READ-FIRST source of truth.
const routinePath = new URL('../docs/ops/AF_TRENDING_DATA_INTEGRITY_ENGINEER.md', import.meta.url).pathname;
const routine = readFileSync(routinePath, 'utf8');
check('routine spec has a §0.1 READ FIRST section', /## §0\.1 — READ FIRST/.test(routine));
check('§0.1 names ADVANCED_FILTER_PRODUCT_CONTRACT.md explicitly as CANONICAL',
  /docs\/ADVANCED_FILTER_PRODUCT_CONTRACT\.md[\s\S]{0,300}(canonical|CANONICAL)/.test(routine));
check('§0.1 forbids reconstructing rules from old chats/PRs/memory',
  /NOT\s+reconstruct[\s\S]{0,200}(chats|PRs|memory)/.test(routine));
check('§0.1 states the Product Contract wins on any behavior disagreement',
  /Product Contract,?\s+the Product Contract\s+wins/s.test(routine));
check('§0.1 spells out the contract-vs-production protocol (two outcomes: regression vs owner decision)',
  /investigate first/.test(routine) && /REGRESSION/.test(routine)
  && /STOP on that specific decision/.test(routine));
check('§0.1 requires contract updates land in the SAME PR as the code change, when owner-authorized',
  /same PR/i.test(routine) && /owner authorizes/i.test(routine));

// 3. §0 mandate names the 12-step contract-driven job.
check('mandate names all 12 steps of the routine in order',
  ['1\\. \\*\\*Read\\*\\* `docs/ADVANCED_FILTER_PRODUCT_CONTRACT\\.md`',
   '2\\. \\*\\*Test\\*\\*', '3\\. \\*\\*Investigate\\*\\*', '4\\. \\*\\*Determine\\*\\*',
   '5\\. \\*\\*Fix\\*\\*', '6\\. \\*\\*Add or strengthen a regression barrier\\*\\*',
   '7\\. \\*\\*Mutation-prove\\*\\*', '8\\. \\*\\*Run\\*\\* `npm test`',
   '9\\. \\*\\*Merge\\*\\*', '10\\. \\*\\*Deploy\\*\\*',
   '11\\. \\*\\*Verify\\*\\* production independently',
   '12\\. \\*\\*Update `ADVANCED_FILTER_PRODUCT_CONTRACT\\.md`\\*\\*']
  .every((rx) => new RegExp(rx).test(routine)));

// 4. PART 6 (barriers) carries the contract-audit expectation.
check('PART 6 requires each run to spot-audit Product Contract rules end to end',
  /Contract-audit expectation[\s\S]{0,600}ADVANCED_FILTER_PRODUCT_CONTRACT\.md/.test(routine));
check('the audit covers barrier existence AND live behavior AND DB oracle (each side)',
  /confirm they[\s\S]{0,80}exist[\s\S]{0,80}wired into `npm test`/.test(routine)
  && /production behavior/.test(routine)
  && /DB oracle/.test(routine));

// 5. FINAL REPORT format has the required declarations.
check('FINAL REPORT starts with `CONTRACT READ: YES` including the file path and blob sha',
  /CONTRACT READ: YES \(docs\/ADVANCED_FILTER_PRODUCT_CONTRACT\.md, \{sha7 of the file's git blob\}\)/.test(routine));
check('FINAL REPORT lists spot-audited rule numbers this run',
  /CONTRACT RULES SPOT-AUDITED THIS RUN:/.test(routine));
check('FINAL REPORT declares contract/production conflicts and owner-decision requests separately',
  /CONTRACT\/PRODUCTION CONFLICTS FOUND:/.test(routine) && /OWNER DECISIONS OPENED/.test(routine));
check('FINAL REPORT carries BOTH an AF System Rating and an Engineer Performance Rating (as owner requested)',
  /AF SYSTEM RATING: X\/10/.test(routine) && /ENGINEER PERFORMANCE RATING: X\/10/.test(routine));

// 6. Existing scope structure kept — the update did not silently gut earlier parts.
check('PART 1 (AF) still exists', /## PART 1 — ADVANCED FILTER/.test(routine));
check('PART 6 (BARRIERS) still exists', /## PART 6 — BARRIERS/.test(routine));
check('PART 7 (FIX, DON\'T JUST REPORT) still exists', /## PART 7 — FIX, DON'T JUST REPORT/.test(routine));

// 7. Governance link to AGENTS.md remains intact (this routine still obeys the fleet contract).
check('routine still links to AGENTS.md / AGENT_AUTHORITY for the authority grant',
  /AGENT_AUTHORITY\.md/.test(routine) || /AGENTS\.md/.test(routine));

// 8. Companion docs enumerated in §0.1 exist.
for (const p of [
  '../docs/ADVANCED_FILTER_DESIGN_CONTRACT.md',
  '../docs/ADVANCED_FILTER_PATTERN.md',
  '../docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md',
  '../docs/AF_COHORT_LEDGER.md',
]) {
  const abs = new URL(p, import.meta.url).pathname;
  check(`companion doc exists: ${p.replace(/^\.\.\//, '')} (${existsSync(abs) ? statSync(abs).size + ' bytes' : 'MISSING'})`, existsSync(abs));
}

console.log(failed ? `\n✗ ${failed} check(s) FAILED — Senior AF routine no longer pins the Product Contract as canonical` : '\n✓ Senior AF routine pins the Product Contract as canonical, mandatory-read source of truth');
process.exit(failed ? 1 : 0);
