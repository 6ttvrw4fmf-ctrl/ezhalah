// AI CHAT → FURNISHED, second slice of one-shot understanding (owner ruling 2026-08-29).
// Auto-discovered barrier + edge-deploy gate.
//
// furnished is NOT an amenity. It maps to q.furnishedPref — TRI-STATE: true = confirmed furnished
// only, false = confirmed unfurnished only, null/undefined = no preference — and it is gated by
// cohortAllows(q, 'furnished'), the exact predicate the AF furnished question uses. There is no
// second certification system; this barrier proves the chat uses that one.
//
// WHY THE GATE IS NOT A FORMALITY (measured on production 2026-08-29):
//   Apartment RentAnnual  27,688 listings, furnished known on 46.4%
//   Apartment RentMonthly 30,544 listings, furnished known on  0.0%  (5 rows)
// Applying furnishedPref on the monthly cohort would turn UNKNOWN into No and collapse 30,544
// listings to 4. That is precisely what UNKNOWN-stays-UNKNOWN exists to prevent, and it is why the
// owner's own example — «إيجار شهري ... مفروشة» — must CLARIFY rather than apply.
//
// The cohort matrix below is ENUMERATED FROM THE REAL CONFIG, not hand-listed: a fixture copy would
// silently go stale the moment a cohort is certified, which is exactly how the previous slice's
// barrier got a cohort wrong.
import { readFileSync } from "node:fs";
import { cohortAllows, COHORT_QUESTIONS } from "../src/lib/afCohorts.ts";
import { CLEAN_MACRO } from "../src/data/propertyTypes.ts";

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
};

type Cohort = { label: string; q: Record<string, unknown>; certifiedInConfig: boolean };
const MATRIX: Cohort[] = [];
for (const [type, cfg] of Object.entries(COHORT_QUESTIONS)) {
  const category = (CLEAN_MACRO as Record<string, string>)[type] ?? "Residential";
  const variants: Array<[string, string, string | undefined, string[] | undefined]> = [
    ["RentAnnual", "Rent", "annual", cfg.RentAnnual],
    ["RentMonthly", "Rent", "monthly", cfg.RentMonthly],
    ["Buy", "Buy", undefined, cfg.Buy],
  ];
  for (const [name, deal, rentPeriod, list] of variants) {
    MATRIX.push({
      label: `${type}/${name}`,
      q: { type, category, deal, rentPeriod },
      certifiedInConfig: (list ?? []).includes("furnished"),
    });
  }
}

console.log(`── cohort matrix enumerated from the real config: ${MATRIX.length} cohorts ──`);
check("the matrix is real, not a stub", MATRIX.length >= 30, `only ${MATRIX.length} cohorts`);

// cohortAllows must agree with the config for EVERY cohort — no cohort may be certified by the gate
// that the config does not certify (that would be the chat widening beyond AF).
let mismatches = 0;
for (const c of MATRIX) {
  if (cohortAllows(c.q as never, "furnished") !== c.certifiedInConfig) {
    mismatches++;
    console.log(`      MISMATCH ${c.label}: gate=${cohortAllows(c.q as never, "furnished")} config=${c.certifiedInConfig}`);
  }
}
check("the gate agrees with the config on every cohort (chat can never exceed AF)", mismatches === 0);

const certified = MATRIX.filter((c) => c.certifiedInConfig).map((c) => c.label);
const rejected = MATRIX.filter((c) => !c.certifiedInConfig).map((c) => c.label);
console.log(`\n   CERTIFIED (${certified.length}): ${certified.join(", ")}`);
console.log(`   REJECTED  (${rejected.length} cohorts)`);
check("at least one cohort certifies furnished (otherwise the feature is dead)", certified.length > 0);
check("MOST cohorts do NOT certify it — this is a narrow, data-driven permission",
  rejected.length > certified.length);

console.log("\n── the cohorts that matter to the owner's example ──");
const apt = (rentPeriod: string) => ({ type: "Apartment", category: "Residential", deal: "Rent", rentPeriod });
check("Apartment/RentAnnual CAN apply furnished (46.4% known)", cohortAllows(apt("annual") as never, "furnished"));
check("Apartment/RentMonthly must CLARIFY, not apply (0.0% known — 5 of 30,544)",
  !cohortAllows(apt("monthly") as never, "furnished"),
  "certifying this would turn UNKNOWN into No and collapse 30,544 listings to 4");
check("Apartment/Buy must CLARIFY, not apply",
  !cohortAllows({ type: "Apartment", category: "Residential", deal: "Buy" } as never, "furnished"));

console.log("\n── wiring: same gate, tri-state, never an amenity ──");
const client = readFileSync(new URL("../src/data/agent.ts", import.meta.url), "utf8");
const edge = readFileSync(new URL("../supabase/functions/agent/index.ts", import.meta.url), "utf8");
// STRUCTURAL, not a substring: the assignment must sit INSIDE the gate. A prose comment naming
// cohortAllows satisfied the old regex even after the gate was deleted — that mutation escaped, and
// it is the third time in this workstream a comment has masqueraded as a code path.
check("the client gates furnished through cohortAllows — the AF predicate itself",
  /if \(cohortAllows\(q, 'furnished'\)\)\s*q\.furnishedPref = /.test(client),
  "the furnishedPref assignment must be guarded BY the gate, not merely near it");
check("certified ⇒ sets the TRI-STATE furnishedPref (not an amenity token)",
  /q\.furnishedPref = b\.furnished === 'yes'/.test(client));
check("uncertified ⇒ routed to the SAME clarification list as rejected amenities",
  /else lastRejectedFilters\.push\('furnished'\)/.test(client));
check("'none' never sets a preference (absence must stay absence)",
  /if \(b\.furnished === 'yes' \|\| b\.furnished === 'no'\)/.test(client));
check("furnished is NOT in the amenity vocabulary any more",
  !/\|"furnished" — emit a token/.test(edge) && /"furnished" \(one of "yes"\|"no"\|"none"/.test(edge));
check("the edge normalises to the closed tri-state, never passes raw model text",
  /out\.furnished === "yes" \? "yes" : out\.furnished === "no" \? "no" : "none"/.test(edge));
// Test for a real second IMPLEMENTATION, not a mention: the edge comment names
// cohortAllows(q,'furnished') to point a reader at the single gate. That is documentation, not drift.
// (The amenities slice's barrier made this exact mistake — a comment is not a code path.)
check("the edge declares no cohort tables of its own",
  !/const\s+COHORT_QUESTIONS|const\s+COHORT_CHIPS/.test(edge));
check("the edge does not import the client cohort module",
  !/from\s+["'][^"']*afCohorts/.test(edge));
check("the edge never CALLS a certification predicate (only the client decides)",
  !/^\s*(?:if\s*\()?\s*cohortAllows\(/m.test(edge));

if (failed) {
  console.error(`\n✗ ${failed} check(s) FAILED — the furnished gate is not intact`);
  process.exit(1);
}
console.log("\nOK — furnished is tri-state, cohort-certified by the AF predicate, never widening");
