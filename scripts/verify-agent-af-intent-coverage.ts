// AI CHAT ↔ ADVANCED FILTER: full coverage, one gate, no drift (owner ruling 2026-08-29).
// Auto-discovered barrier + edge-deploy gate.
//
// PRODUCT PURPOSE. AI Chat is a natural-language doorway over BOTH filter layers. A user may state
// normal-filter and AF fields together in their FIRST message and every supported intent must land in
// the same canonical search state the manual Normal→AF sequence produces.
//
// THE PERMANENT INVARIANT:
//   DeepSeek may UNDERSTAND and PROPOSE. The existing AF certification decides what may be APPLIED.
//   Anything the agent applies as an AF filter must be something cohortAllows() permits for that
//   exact cohort. UNKNOWN stays UNKNOWN; missing data never becomes No/false/0.
//
// This barrier executes the REAL registry and the REAL gate against the REAL cohort matrix.
import { readFileSync } from "node:fs";
import { COHORT_QUESTIONS, cohortAllows } from "../src/lib/afCohorts.ts";
import { AF_INTENTS, GENERIC_INTENT_IDS, applyAfIntents } from "../src/lib/afIntents.ts";
import { CLEAN_MACRO } from "../src/data/propertyTypes.ts";

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
};
const eq = (l: string, a: unknown, b: unknown) =>
  check(l, JSON.stringify(a) === JSON.stringify(b), `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

// ── 1. NO DRIFT: the registry must cover the canonical AF vocabulary, derived not hand-listed ──────
console.log("── coverage: every certified AF question is reachable from chat ──");
const canonical = new Set<string>();
for (const cfg of Object.values(COHORT_QUESTIONS)) {
  for (const list of Object.values(cfg as Record<string, string[] | undefined>)) {
    for (const id of list ?? []) canonical.add(id);
  }
}
const registry = new Set(Object.keys(AF_INTENTS));
const missing = [...canonical].filter((id) => !registry.has(id));
const extra = [...registry].filter((id) => !canonical.has(id));
check(`the canonical vocabulary is real (${canonical.size} ids)`, canonical.size >= 9);
check("every canonical AF question has a registry entry — THIS is the anti-drift gate",
  missing.length === 0,
  `missing: ${JSON.stringify(missing)} — certify a question without teaching the agent and this fails`);
check("the registry invents no AF question of its own", extra.length === 0, `extra: ${JSON.stringify(extra)}`);
// applyAfIntents gates on the record KEY, so an entry whose `id` disagrees with its key would be a
// silent lie about which AF question certifies it — e.g. rnpl claiming to be 'amenities', which has
// 24 certified cohorts instead of rnpl's 3. (This exact mutation escaped the first version.)
const idMismatch = Object.entries(AF_INTENTS).filter(([key, v]) => v.id !== key).map(([k, v]) => `${k}→${v.id}`);
check("every registry entry's id matches its key (no question can impersonate another)",
  idMismatch.length === 0, `mismatched: ${JSON.stringify(idMismatch)}`);

// ── 2. CERTIFICATION: the agent can never apply what AF would refuse ───────────────────────────────
console.log("\n── the agent can never exceed AF, on any cohort ──");
const SAMPLE: Record<string, string> = {
  property_age: "new", street_width: "20", direction: "شمال", bathrooms: "3",
  rating: "9.0", rnpl: "rnpl", unit_subtype: "شقة", furnished: "yes",
};
let violations = 0, appliedSomewhere = 0;
for (const [type, cfg] of Object.entries(COHORT_QUESTIONS)) {
  const category = (CLEAN_MACRO as Record<string, string>)[type] ?? "Residential";
  for (const [name, deal, rentPeriod] of [
    ["RentAnnual", "Rent", "annual"], ["RentMonthly", "Rent", "monthly"], ["Buy", "Buy", undefined],
  ] as Array<[string, string, string | undefined]>) {
    const base = { type, category, deal, rentPeriod } as never;
    for (const id of GENERIC_INTENT_IDS) {
      if (id === "furnished") continue; // its own barrier covers it
      const { q, rejected } = applyAfIntents(base, { [id]: SAMPLE[id] });
      const changed = JSON.stringify(q) !== JSON.stringify(base);
      const certified = cohortAllows(base, id);
      if (changed && !certified) {
        violations++;
        console.log(`      VIOLATION ${type}/${name} applied ${id} without certification`);
      }
      if (changed) appliedSomewhere++;
      if (!certified && !rejected.includes(id)) {
        violations++;
        console.log(`      SILENT DROP ${type}/${name} ${id} neither applied nor reported`);
      }
    }
  }
}
check("no cohort applies an uncertified AF field (the permanent invariant)", violations === 0);
check("the registry does apply where certified (not dead code)", appliedSomewhere > 0);

// ── 3. RNPL keeps its OWN certification ───────────────────────────────────────────────────────────
console.log("\n── RNPL has its own gate, not the amenities gate ──");
// RNPL writes into q.amenities like an amenity token but is a SEPARATE AF question with far narrower
// certification (3 cohorts vs 24). Gating it on 'amenities' would let it through wherever generic
// amenities happen to be certified.
const aptBuy = { type: "Apartment", category: "Residential", deal: "Buy" } as never;
check("Apartment/Buy certifies amenities", cohortAllows(aptBuy, "amenities"));
check("...but NOT rnpl", !cohortAllows(aptBuy, "rnpl"));
const r = applyAfIntents(aptBuy, { rnpl: "rnpl" });
eq("rnpl is refused there even though amenities are certified", (r.q as { amenities?: string[] }).amenities, undefined);
check("...and the refusal is reported", r.rejected.includes("rnpl"));

// ── 4. VALUES: closed vocabulary, never fuzzy, never invented ─────────────────────────────────────
console.log("\n── values are canonicalized deterministically or refused ──");
const aptAnnual = { type: "Apartment", category: "Residential", deal: "Rent", rentPeriod: "annual" } as never;
eq("bathrooms 3 → bathMin 3", (applyAfIntents(aptAnnual, { bathrooms: "3" }).q as { bathMin?: number }).bathMin, 3);
eq("bathrooms 5 → the highest rung that exists (4+), not an invented 5 rung",
  (applyAfIntents(aptAnnual, { bathrooms: "5" }).q as { bathMin?: number }).bathMin, 4);
eq("bathrooms 0 is refused, not floored to 1",
  (applyAfIntents(aptAnnual, { bathrooms: "0" }).q as { bathMin?: number }).bathMin, undefined);
check("a garbage age bucket is rejected, never fuzzy-matched",
  applyAfIntents(aptAnnual, { property_age: "brand_new" }).rejected.includes("property_age:brand_new"));
check("a garbage direction is rejected", applyAfIntents(aptAnnual, { direction: ["north"] }).rejected.length > 0);
eq("property_age 'new' sets isNewConstruction and clears the range",
  (() => { const x = applyAfIntents(aptAnnual, { property_age: "new" }).q as Record<string, unknown>;
    return [x.isNewConstruction, x.ageMin, x.ageMax]; })(), [true, null, null]);
// Rating is a 0-10 scale and is certified ONLY on monthly cohorts (it is Gathern data), so the value
// check must run on a cohort that actually certifies it — otherwise the gate refuses first and the
// value rule is never exercised. A 0-5-style value must NOT be accepted: on a 0-10 scale it would
// match nearly everything, which is exactly the silent-invention this whole layer exists to stop.
const aptMonthly = { type: "Apartment", category: "Residential", deal: "Rent", rentPeriod: "monthly" } as never;
check("rating is certified on Apartment/RentMonthly (so the value rule is really exercised)",
  cohortAllows(aptMonthly, "rating"));
check("rating '4.5' (wrong scale) is REFUSED as a VALUE, not merely gated",
  applyAfIntents(aptMonthly, { rating: "4.5" }).rejected.includes("rating:4.5"));
eq("rating '9.0' applies ratingMin 9",
  (applyAfIntents(aptMonthly, { rating: "9.0" }).q as { ratingMin?: number }).ratingMin, 9);
eq("rating '9.0_rc10' also sets reviewsMin 10",
  (() => { const x = applyAfIntents(aptMonthly, { rating: "9.0_rc10" }).q as Record<string, unknown>;
    return [x.ratingMin, x.reviewsMin]; })(), [9, 10]);
check("'none'/empty are no-ops, never a filter",
  applyAfIntents(aptAnnual, { bathrooms: "none", direction: "" }).rejected.length === 0
  && JSON.stringify(applyAfIntents(aptAnnual, { bathrooms: "none" }).q) === JSON.stringify(aptAnnual));

// ── 5. WIRING ─────────────────────────────────────────────────────────────────────────────────────
console.log("\n── wiring: one loop, real gate, edge owns no certification ──");
// "the client" is TWO files since 2026-09-01: AF certification moved out of agent.ts into the pure
// leaf module src/lib/afCertify.ts, precisely so a barrier can EXECUTE it instead of grepping it
// (see scripts/verify-af-certified-on-merged-state.ts, which runs the real pipeline). These text
// assertions still hold — they are about what the client DOES, not which file it lives in — so they
// read both halves. A grep-only check could not have caught the defect that forced the move.
const client = readFileSync(new URL("../src/data/agent.ts", import.meta.url), "utf8")
  + "\n" + readFileSync(new URL("../src/lib/afCertify.ts", import.meta.url), "utf8");
const edge = readFileSync(new URL("../supabase/functions/agent/index.ts", import.meta.url), "utf8");
const reg = readFileSync(new URL("../src/lib/afIntents.ts", import.meta.url), "utf8");
check("the client runs the registry loop", /applyAfIntents\(q, af as Record<string, unknown>\)/.test(client));
check("rejected AF intents join the shared clarification list",
  /rejected\.push\(\.\.\.res\.rejected\);/.test(client) && /lastRejectedFilters = res\.rejected;/.test(client));
check("the registry gates on cohortAllows — the AF predicate itself",
  /if \(!cohortAllows\(out, id\)\) \{ rejected\.push\(id\); continue; \}/.test(reg),
  "certification must come BEFORE canonicalization, so a refusal can never look applied");
check("the edge declares no cohort tables", !/const\s+COHORT_QUESTIONS|const\s+COHORT_CHIPS/.test(edge));
check("the edge never calls a certification predicate", !/^\s*(?:if\s*\()?\s*cohortAllows\(/m.test(edge));
// 2026-08-31: af now passes through fillBathroomsIfAbsent() (a fill-absent-only deterministic
// backstop, postModel.ts) instead of the bare passthrough — it still carries af RAW/uncertified:
// postModel.ts is dependency-free (no afCohorts import, no cohortAllows call) by construction, so
// it cannot certify anything even accidentally; it only fills a gap the model left empty.
check("the edge carries af through raw (fill-absent-only backstop, never certification)",
  /af: fillBathroomsIfAbsent\(out\.af, text\)/.test(edge));

if (failed) {
  console.error(`\n✗ ${failed} check(s) FAILED — AI/AF coverage or certification is not intact`);
  process.exit(1);
}
console.log("\nOK — all canonical AF questions reachable, every one gated by the real AF certification");
