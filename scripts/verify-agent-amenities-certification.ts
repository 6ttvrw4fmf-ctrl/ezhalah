// AI CHAT → AMENITIES, first slice of one-shot understanding (owner ruling 2026-08-29).
// Auto-discovered barrier + edge-deploy gate.
//
// WHAT THIS ALLOWS. A user can now say everything at once — «أبي شقة بالرياض، ٣ غرف، فيها مصعد
// وموقف، إيجار سنوي» — and the amenities land as real filters without walking the Advanced Filter
// flow first.
//
// WHAT IT MUST NEVER DO, and what this barrier pins (each one an owner rule):
//   - never fuzzy-match an unknown token into a real one
//   - never widen the eligible set
//   - keep AND between requested filters
//   - UNKNOWN stays UNKNOWN — an uncertified cohort is EMPTY, never "no constraint"
//   - an uncertified amenity goes to the CLARIFICATION path, never to a guess
//
// afCohorts.ts is PURE by design, so this executes the real gate instead of grepping for it.
import { readFileSync } from "node:fs";
import { certifiedAmenityKeys, partitionRequestedAmenities } from "../src/lib/afCohorts.ts";

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
};
const eq = (label: string, a: unknown, b: unknown) =>
  check(label, JSON.stringify(a) === JSON.stringify(b), `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

// Minimal query shapes. Only the fields the gate reads: category/type/deal/rentPeriod.
const Q = (o: Record<string, unknown>) => ({ category: "Residential", deal: "Rent", rentPeriod: "annual", ...o }) as never;

console.log("── certified vocabulary per cohort (executed, not grepped) ──");
const aptAnnual = certifiedAmenityKeys(Q({ type: "Apartment" }));
check("Apartment/RentAnnual certifies the residential base", aptAnnual.includes("elevator") && aptAnnual.includes("parking"));
check("villa-only tokens are NOT certified for Apartment",
  !aptAnnual.includes("car_entrance") && !aptAnnual.includes("sanitation"),
  `got ${JSON.stringify(aptAnnual)}`);
const villa = certifiedAmenityKeys(Q({ type: "Villa" }));
check("Villa certifies its own car_entrance/sanitation", villa.includes("car_entrance") && villa.includes("sanitation"));
// Office certifies amenities for RentAnnual but NOT for Buy — verified by executing the real gate,
// not assumed. The commercial side renders EXACTLY its COHORT_CHIPS utilities and no residential token.
const office = certifiedAmenityKeys(Q({ type: "Office", category: "Commercial", deal: "Rent", rentPeriod: "annual" }));
eq("Office/RentAnnual certifies EXACTLY its utility trio",
  [...office].sort(), ["electricity", "sanitation", "water_supply"]);
check("a residential token is NOT certified for Office", !office.includes("elevator"));
// Rest House is a RESIDENTIAL-macro type with a commercial-style chip list plus kitchen.
eq("Rest House/RentAnnual certifies its kitchen + utilities",
  [...certifiedAmenityKeys(Q({ type: "Rest House" }))].sort(),
  ["electricity", "kitchen", "sanitation", "water_supply"]);

console.log("\n── gym-bug-class sweep (owner 2026-08-31): 8 rich columns that existed but were never wired ──");
// "أبي شقة فيها نادي وحمامين" applied nothing because "gym" was not in the model's vocabulary, not in
// afCohorts.ts, and not in the RPC whitelist, even though search_listings_ar.gym already carried real
// data. Same shape found in 7 siblings; all 8 pin here so none can silently regress back out.
const RICH_TOKENS = [
  "gym", "pool", "garden", "balcony", "laundry_room",
  "optical_fibers", "separate_electricity_meter", "separate_water_meter",
];
for (const tok of RICH_TOKENS) {
  check(`Apartment/RentAnnual certifies "${tok}"`, aptAnnual.includes(tok), `got ${JSON.stringify(aptAnnual)}`);
  check(`"${tok}" is NOT certified for Office (residential-only token)`, !office.includes(tok));
}
// "bathrooms" is a separate AF intent (afIntents.ts + applyAfIntents), never an amenities-array
// token — it is deliberately NOT passed here; partitionRequestedAmenities only knows the amenity
// vocabulary, so mixing it in would test a rejection this function is SUPPOSED to produce.
const gymReq = partitionRequestedAmenities(Q({ type: "Apartment" }), ["gym"]);
eq("the owner's own reproduction case: gym certifies for Apartment/RentAnnual", gymReq.certified, ["gym"]);
eq("...and nothing is rejected", gymReq.rejected, []);

console.log("\n── UNKNOWN stays UNKNOWN: an uncertified cohort is EMPTY, never 'no constraint' ──");
// These cohorts genuinely do not list 'amenities' in COHORT_QUESTIONS — confirmed by executing the
// gate. (An earlier version of this test used Apartment/RentMonthly on the strength of a stale header
// comment; Monthly AF shipped 2026-08-18 and that cohort IS certified. Test the data, not the prose.)
eq("Office/Buy certifies NOTHING (certified for RentAnnual only)",
  certifiedAmenityKeys(Q({ type: "Office", category: "Commercial", deal: "Buy", rentPeriod: undefined })), []);
eq("Residential Building/Buy certifies NOTHING",
  certifiedAmenityKeys(Q({ type: "Residential Building", deal: "Buy", rentPeriod: undefined })), []);
eq("an unknown/uncertified type certifies NOTHING", certifiedAmenityKeys(Q({ type: "Nonexistent Type" })), []);
eq("no type at all certifies NOTHING", certifiedAmenityKeys(Q({ type: null })), []);
// Cross-category scope must match nothing rather than falling through to one side.
eq("category/type mismatch certifies NOTHING",
  certifiedAmenityKeys(Q({ type: "Office", category: "Residential" })), []);

console.log("\n── requested tokens are partitioned, never fuzzy-matched ──");
const p1 = partitionRequestedAmenities(Q({ type: "Apartment" }), ["elevator", "parking"]);
eq("certified tokens pass through", p1.certified, ["elevator", "parking"]);
eq("nothing spurious is rejected", p1.rejected, []);
const p2 = partitionRequestedAmenities(Q({ type: "Apartment" }), ["elevator", "car_entrance"]);
eq("a token certified for ANOTHER type is rejected here", p2.certified, ["elevator"]);
eq("...and surfaced for the clarification path, not swallowed", p2.rejected, ["car_entrance"]);
const p3 = partitionRequestedAmenities(Q({ type: "Apartment" }), ["elevatorr", "ELEVATOR", "  parking  "]);
eq("a near-miss is NEVER fuzzy-matched into a real token", p3.rejected, ["elevatorr"]);
eq("case and whitespace normalise (that is not fuzzy matching)", p3.certified, ["elevator", "parking"]);
const p4 = partitionRequestedAmenities(Q({ type: "Residential Building", deal: "Buy", rentPeriod: undefined }), ["elevator"]);
eq("an uncertified COHORT rejects even a real token", p4.certified, []);
eq("...and routes it to clarification", p4.rejected, ["elevator"]);
eq("empty request stays empty", partitionRequestedAmenities(Q({ type: "Apartment" }), []).certified, []);

console.log("\n── the gate can never WIDEN, and AND is preserved ──");
// Certified output is always a SUBSET of the request: the gate can only ever remove.
for (const req of [["elevator", "parking", "ac"], ["car_entrance"], ["bogus", "elevator"]]) {
  const r = partitionRequestedAmenities(Q({ type: "Apartment" }), req);
  check(`subset-safe for ${JSON.stringify(req)}`,
    r.certified.every((k) => req.includes(k)) && r.certified.length + r.rejected.length === new Set(req).size,
    `certified=${JSON.stringify(r.certified)} rejected=${JSON.stringify(r.rejected)}`);
}

console.log("\n── wiring: one shared gate, and the edge must NOT own certification ──");
// "the client" is TWO files since 2026-09-01: AF certification moved out of agent.ts into the pure
// leaf module src/lib/afCertify.ts, precisely so a barrier can EXECUTE it instead of grepping it
// (see scripts/verify-af-certified-on-merged-state.ts, which runs the real pipeline). These text
// assertions still hold — they are about what the client DOES, not which file it lives in — so they
// read both halves. A grep-only check could not have caught the defect that forced the move.
const client = readFileSync(new URL("../src/data/agent.ts", import.meta.url), "utf8")
  + "\n" + readFileSync(new URL("../src/lib/afCertify.ts", import.meta.url), "utf8");
const edge = readFileSync(new URL("../supabase/functions/agent/index.ts", import.meta.url), "utf8");
check("the client gates amenities through the SHARED afCohorts function",
  /partitionRequestedAmenities\(q, b\.amenities\)/.test(client));
// Behaviour, not spelling: only `certified` may be unioned in. Pinning the exact mutable
// assignment made this fail when the pass moved into a pure module and became immutable — an
// assertion that breaks on a refactor it should not care about protects nothing.
check("only CERTIFIED tokens reach q.amenities",
  /amenities:\s*\[\.\.\.new Set\(\[\.\.\.\(q\.amenities \?\? \[\]\), \.\.\.certified\]\)\]/.test(client));
// Now push(), because furnished shares this one clarification list (owner: "the same
// clarification/rejection pattern").
// The certification pass now RETURNS its rejections and agent.ts assigns the whole list once, so
// there is a single writer (verify-af-certified-on-merged-state.ts §7 pins that). What matters here
// is unchanged: a refused token is recorded, never dropped on the floor.
check("rejected tokens are recorded for clarification, not discarded",
  /rejected\.push\(\.\.\.rej\);/.test(client) && /lastRejectedFilters = res\.rejected;/.test(client));
// The gate reads q.type/q.category/q.deal/q.rentPeriod — all of which applySourceFilter can still
// change. Certifying before that would certify against a scope the search never runs.
const gateIdx = client.indexOf("partitionRequestedAmenities(q, b.amenities)");
const srcIdx = client.indexOf("applySourceFilter(q, userText, b.platforms)");
check("the gate runs AFTER applySourceFilter (scope must be final)", gateIdx > srcIdx && srcIdx > -1);
// Must test for a real second IMPLEMENTATION, not a mention. The edge comment names
// certifiedAmenityKeys() to point a reader at the single gate — that is documentation, not drift.
check("the edge does NOT declare its own cohort tables (that is how paths drift)",
  !/const\s+COHORT_QUESTIONS|const\s+COHORT_CHIPS/.test(edge));
check("the edge does not import the client cohort module either",
  !/from\s+["'][^"']*afCohorts/.test(edge));
check("the edge contract offers a CLOSED amenity vocabulary", /"amenities" \(array; ONLY these exact tokens/.test(edge));
for (const tok of RICH_TOKENS) {
  check(`the edge's JSON_SHAPE_HINT enum includes "${tok}"`, new RegExp(`"${tok}"`).test(edge));
}
check("the edge tells the model to omit rather than guess", /never invent one, never map a word you are unsure of/.test(edge));

if (failed) {
  console.error(`\n✗ ${failed} check(s) FAILED — the amenity certification gate is not intact`);
  process.exit(1);
}
console.log("\nOK — amenities are certified per cohort, never fuzzy-matched, never widening");
