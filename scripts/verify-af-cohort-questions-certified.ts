// NO AF QUESTION SHIPS WITHOUT A CERTIFICATION ROW — Product Contract R2.1.2.
//
// THE RULE, in the contract's words: "Cohort entries are added ONLY after per-cohort profiling
// against real production data proves the source field has meaningful coverage for that exact
// type/deal/period. Evidence lives in docs/AF_COHORT_LEDGER.md. **No question ships without a
// ledger entry.**" R2.1.3 states the other half: "Uncertified = do not ask" is the design.
//
// UNTIL THIS FILE, THAT RULE WAS ENFORCED BY NOTHING. It was graded N (no coverage) in
// scripts/lib/afContractCoverage.ts — the AF coverage map's only weight-3 gap. Nothing anywhere
// compared `COHORT_QUESTIONS` (src/lib/afCohorts.ts — the pool a scope may draw from) against the
// certification record, so a cohort could be handed a question list by an ordinary code edit, with
// no profiling behind it, and every other AF barrier would stay green: the counts would be
// truthful, the narrowing gate would still fire, the card would render correctly. The only thing
// wrong would be that AF was asking about a field nobody proved this cohort's sources publish —
// which surfaces to the user as a question whose options are thin, skewed, or empty.
//
// WHICH ANCHOR, AND WHY. The contract names two: `docs/AF_COHORT_LEDGER.md` and
// `public.af_cohort_registry`. This barrier uses the REGISTRY, and the ledger's own header is why —
// it calls the file PLUS that table "the control plane", and the table is the machine-readable half:
// one row per `type_ar × deal_ar × rent_period_ar` with an `enabled` flag and the certification
// evidence in `note`. Prose in a markdown file cannot be checked for a cohort that does not appear
// in it; a missing table row can.
//
// `npm test` is HERMETIC and must never reach production (that is deliberate — see AGENTS.md on why
// verify-migration-drift-vs-production.ts is kept OUT of the suite), so the registry is read from
// `sql/mirrors/af_cohort_registry.sql`, captured byte-exact and guarded for staleness by
// verify-sql-mirrors-not-stale.ts. Same pattern as sql/mirrors/af_eligibility_clause.sql.
//
// GRANULARITY, STATED EXPLICITLY SO IT IS NOT "TIGHTENED" BY MISTAKE. The question pool is keyed by
// CLEAN type ('Apartment', 'Villa', …) — that is what `cohortAllows()` consults. The registry is
// keyed by `type_ar`, which is FINER: one clean type expands to several Arabic spellings and
// near-synonyms («شقة» + «مبنى شقق مخدومة» + «ملحق علوي» are all Apartment). So the assertion is
// "at least one enabled row exists for this cohort", not "every type_ar alias has its own row".
// Demanding a row per alias would fail on 13 cohorts today that are certified and correct, and
// would be asserting something the contract does not say. §3 records the alias coverage as
// INFORMATION so a future run can see it without it being a gate.
//
//   node --experimental-strip-types scripts/verify-af-cohort-questions-certified.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { COHORT_QUESTIONS } from '../src/lib/afCohorts.ts';
import { CLEAN_TO_TYPE_AR } from '../src/data/propertyTypes.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `\n        ${detail}` : ''}`);
};

// ── the mirror, parsed ──────────────────────────────────────────────────────────────────────────
// Rows look like:  ('إيجار', 'سنوي', 'شقة', true),   /   ('بيع', NULL, 'فيلا', true)
const MIRROR = 'sql/mirrors/af_cohort_registry.sql';
const mirrorSrc = readFileSync(MIRROR, 'utf8');
const ROW_RE = /\(\s*'((?:[^']|'')*)'\s*,\s*(NULL|'(?:[^']|'')*')\s*,\s*'((?:[^']|'')*)'\s*,\s*(true|false)\s*\)/g;
const unq = (s: string) => s.replace(/^'|'$/g, '').replace(/''/g, "'");

type Row = { deal: string; period: string; type: string; enabled: boolean };
const registry: Row[] = [...mirrorSrc.matchAll(ROW_RE)].map((m) => ({
  deal: unq(m[1]),
  period: m[2] === 'NULL' ? '' : unq(m[2]),
  type: unq(m[3]),
  enabled: m[4] === 'true',
}));

const enabledKeys = new Set(registry.filter((r) => r.enabled).map((r) => `${r.deal}|${r.period}|${r.type}`));

check('§0 the registry mirror parses into rows (the barrier can see its own input)',
  registry.length > 0, `${MIRROR} yielded 0 rows — a parse break must fail, never silently pass`);
check('§0 the mirror row count matches the count its own header recorded',
  /\b59 rows\b/.test(mirrorSrc) ? registry.length === 59 : registry.length > 0,
  `header says 59, parsed ${registry.length}`);

// The COHORT_QUESTIONS slot names, mapped to the registry's (deal_ar, rent_period_ar) coordinates.
const SLOT: Record<string, { deal: string; period: string }> = {
  Buy:         { deal: 'بيع',   period: ''      },
  RentAnnual:  { deal: 'إيجار', period: 'سنوي' },
  RentMonthly: { deal: 'إيجار', period: 'شهري' },
};

type Shipping = { clean: string; slot: string; questions: string[]; typeAr: string[] };
const shipping: Shipping[] = [];
for (const [clean, cfg] of Object.entries(COHORT_QUESTIONS)) {
  for (const [slot, questions] of Object.entries(cfg ?? {})) {
    if (!Array.isArray(questions) || questions.length === 0) continue;   // absence is deliberate (R2.1.3)
    shipping.push({ clean, slot, questions, typeAr: CLEAN_TO_TYPE_AR[clean] ?? [] });
  }
}

check('§0 there are shipping cohorts to check (this barrier can bite)',
  shipping.length > 0, 'COHORT_QUESTIONS produced no non-empty cohort — nothing was actually asserted');
check('§0 every COHORT_QUESTIONS slot name is a known deal/period coordinate',
  shipping.every((s) => s.slot in SLOT),
  `unmapped slot(s): ${[...new Set(shipping.filter((s) => !(s.slot in SLOT)).map((s) => s.slot))].join(', ')}`);

// ── §1 — every shipping cohort has an ENABLED registry row ──────────────────────────────────────
{
  const gaps = shipping.filter((s) => {
    const co = SLOT[s.slot];
    return !co || !s.typeAr.some((t) => enabledKeys.has(`${co.deal}|${co.period}|${t}`));
  });
  check('§1 every cohort that ships questions has an enabled af_cohort_registry row',
    gaps.length === 0,
    gaps.map((g) => `${g.clean}/${g.slot} asks [${g.questions.join(', ')}] with no certified row (type_ar: ${g.typeAr.join(', ') || 'NONE'})`).join('\n        '));
}

// ── §2 — a clean type with no type_ar expansion can never be certified, so it must not ship ─────
// This is a distinct failure from §1: an unmapped clean type would make the §1 lookup vacuously
// search an empty list. Naming it separately keeps a typo'd cohort key from reading as "uncertified"
// when the real fault is that CLEAN_TO_TYPE_AR never heard of it.
{
  const unmapped = shipping.filter((s) => s.typeAr.length === 0);
  check('§2 every shipping cohort key maps to at least one type_ar (no orphan cohort keys)',
    unmapped.length === 0,
    unmapped.map((u) => `${u.clean}/${u.slot} is not in CLEAN_TO_TYPE_AR`).join('; '));
}

// ── §3 — DISABLED rows are honoured, and the enabled/disabled distinction is load-bearing ───────
// `enabled` exists so a cohort can be RETRACTED without deleting its evidence. If the barrier read
// the table row-blind, retracting a cohort would be invisible here — so assert the predicate really
// is enabled-aware by proving a synthetic disabled row would not satisfy §1.
{
  const sample = shipping[0];
  const co = SLOT[sample.slot];
  const disabledOnly = new Set(
    registry.filter((r) => r.enabled === false).map((r) => `${r.deal}|${r.period}|${r.type}`),
  );
  const satisfied = sample.typeAr.some((t) => enabledKeys.has(`${co.deal}|${co.period}|${t}`));
  check('§3 §1 is satisfied through the ENABLED set only (retraction stays visible)',
    satisfied && [...disabledOnly].every((k) => !enabledKeys.has(k)),
    'a disabled row must never also count as enabled');
}

// ── §4 — informational: alias coverage, deliberately NOT a gate (see the header) ────────────────
{
  const partial: string[] = [];
  for (const s of shipping) {
    const co = SLOT[s.slot];
    const missing = s.typeAr.filter((t) => !enabledKeys.has(`${co.deal}|${co.period}|${t}`));
    if (missing.length && missing.length < s.typeAr.length) partial.push(`${s.clean}/${s.slot}: ${missing.join(', ')}`);
  }
  console.log(`\n      cohorts shipping questions: ${shipping.length}  ·  registry rows (enabled): ${enabledKeys.size}`);
  if (partial.length) {
    console.log(`      INFO — ${partial.length} cohort(s) certified on their canonical type_ar but not on every`);
    console.log('      spelling variant that rides the same clean type. Not a gate: the question pool is');
    console.log('      keyed by CLEAN type, so these cohorts ARE certified. Listed so a future run can');
    console.log('      decide whether the registry should also carry the aliases:');
    for (const p of partial) console.log(`        · ${p}`);
  }
}

console.log(failed === 0
  ? '\n✓ every shipping AF cohort is certified — no question ships without a registry entry'
  : `\n✗ ${failed} assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
