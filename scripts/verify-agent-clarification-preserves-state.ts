// CLARIFICATION MUST NOT RESET THE CONVERSATION (owner-reported production bug 2026-08-29).
// Auto-discovered barrier + edge-deploy gate.
//
// THE BUG, reproduced live before the fix:
//   T1 «ابي شقة تقييم الشقة تكون 9.5 و فوق شهرية» → Apartment · monthly · rating 9.5   ✅
//   T2 «الرياض»                                    → + الرياض, all three kept          ✅
//   T3 «عطني الإقليم»                              → kind="message", query GONE        ❌
// One more clarifying question and every understood field vanished: «شهرية» came back as RentAnnual
// and the 9.5 rating disappeared from the executed search entirely.
//
// ROOT CAUSE: queryFromBackend() rebuilt the query FRESH from the model's latest output every turn.
// Only `price` had a carry-forward. Everything else existed only while the model kept re-stating it.
//
// PERMANENT INVARIANT: clarification may ADD or explicitly MODIFY state. It must NEVER silently
// reset unrelated already-understood filters.
import { readFileSync } from "node:fs";
import { mergeConversationState, rescuedFields, STICKY_FIELDS } from "../src/lib/conversationState.ts";

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
};
const eq = (l: string, a: unknown, b: unknown) =>
  check(l, JSON.stringify(a) === JSON.stringify(b), `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

console.log("── THE EXACT REPORTED FLOW ──");
// State after T2, exactly as production produced it.
const afterT2 = {
  type: "Apartment", category: "Residential", deal: "Rent", rentPeriod: "monthly",
  location: "الرياض", ratingMin: 9.5, priceInput: "",
} as never;
// T3 «عطني الإقليم» resolves ONLY the city-vs-region ambiguity; the model returned nothing else.
const t3Fresh = { deal: "Rent", location: "الرياض", regionPin: "منطقة الرياض", priceInput: "" } as never;
const merged = mergeConversationState(afterT2, t3Fresh) as Record<string, unknown>;
eq("propertyType survives the clarification", merged.type, "Apartment");
eq("rentPeriod stays MONTHLY — never silently annual", merged.rentPeriod, "monthly");
eq("ratingMin 9.5 survives", merged.ratingMin, 9.5);
eq("the clarification's OWN answer is applied", merged.regionPin, "منطقة الرياض");
eq("location survives", merged.location, "الرياض");
check("the rescue is visible, not silent",
  rescuedFields(afterT2, t3Fresh).includes("rentPeriod") && rescuedFields(afterT2, t3Fresh).includes("ratingMin"));

console.log("\n── an EXPLICIT change always wins over history ──");
// The whole point: carry-forward must never override the user actually changing their mind.
eq("monthly → annual when the user says so",
  (mergeConversationState({ rentPeriod: "monthly" } as never, { rentPeriod: "annual" } as never) as Record<string, unknown>).rentPeriod,
  "annual");
eq("a new type replaces the old", (mergeConversationState({ type: "Apartment" } as never, { type: "Villa" } as never) as Record<string, unknown>).type, "Villa");
eq("a new city replaces the old", (mergeConversationState({ location: "الرياض" } as never, { location: "جدة" } as never) as Record<string, unknown>).location, "جدة");
eq("furnishedPref FALSE is a real value, not an absence",
  (mergeConversationState({ furnishedPref: true } as never, { furnishedPref: false } as never) as Record<string, unknown>).furnishedPref, false);
eq("a numeric 0 is a real value, not an absence",
  (mergeConversationState({ bathMin: 3 } as never, { bathMin: 0 } as never) as Record<string, unknown>).bathMin, 0);

console.log("\n── every canonical dimension is sticky ──");
for (const f of ["rentPeriod", "type", "location", "price", "priceIsAnnual", "amenities", "furnishedPref",
                 "ratingMin", "reviewsMin", "bathMin", "ageMin", "ageMax", "streetWidthMin",
                 "directions", "unitSubtypes", "isNewConstruction", "detail"]) {
  check(`sticky: ${f}`, (STICKY_FIELDS as readonly string[]).includes(f));
}
// Per-utterance intents describe THIS request, not a standing constraint.
for (const f of ["sort", "count", "keywords"]) {
  check(`NOT sticky (per-utterance): ${f}`, !(STICKY_FIELDS as readonly string[]).includes(f));
}

console.log("\n── nothing unrelated is disturbed ──");
const rich = { type: "Villa", rentPeriod: "annual", ratingMin: 9, bathMin: 3, ageMin: 1, ageMax: 2,
  streetWidthMin: 20, directions: ["شمال"], amenities: ["elevator"], furnishedPref: true,
  unitSubtypes: ["شقة"], price: "80000", priceInput: "80000" } as never;
const afterAsk = mergeConversationState(rich, { location: "جدة", priceInput: "" } as never) as Record<string, unknown>;
for (const [k, v] of Object.entries(rich as Record<string, unknown>)) {
  if (k === "priceInput") continue;
  eq(`preserved through an unrelated clarification: ${k}`, afterAsk[k], v);
}

console.log("\n── wiring ──");
const data = readFileSync(new URL("../src/data/agent.ts", import.meta.url), "utf8");
const ui = readFileSync(new URL("../src/app/agent.tsx", import.meta.url), "utf8");
// Structure, not formatting: the invariant is that the merge WRAPS the fresh per-turn query with
// the accumulated state, whatever else wraps that in turn. (2026-08-30: AF re-certification now
// wraps the merge, and the call spans several lines — a one-line regex failed on a change that
// strengthened the very thing it guards.)
{
  const mergeIdx = data.indexOf("mergeConversationState(");
  const inner = mergeIdx > -1 ? data.slice(mergeIdx, mergeIdx + 400) : "";
  check("the merge wraps queryFromBackend",
    mergeIdx > -1 && /ctx\.prevQuery \?\? null/.test(inner) && /queryFromBackend\(/.test(inner));
  // A defaulted field (rentPeriod/deal/category) must be carried by what the turn STATED, not by the
  // shape of its value — emptyQuery()'s 'annual' is non-empty and silently beat the carry-forward.
  // Assert the CALL SITE, not the declaration: a bare /statedKeys\(/ also matches the function's own
  // definition, so removing the argument from the merge would leave the check green.
  const cs = readFileSync(new URL("../src/lib/conversationState.ts", import.meta.url), "utf8");
  check("the merge is told which fields this turn actually stated",
    /mergeConversationState\([\s\S]{0,400}?statedKeys\(/.test(data)
    && /stated\?: Iterable<string>/.test(cs) && /DEFAULTED_FIELDS/.test(cs));
  check("a defaulted field is only 'established' when the turn stated it",
    /said && defaulted\.has\(key\) \? said\.has\(key\)/.test(cs),
    "otherwise emptyQuery()'s rentPeriod:'annual' silently beats an established monthly");
  check("DEFAULTED_FIELDS actually covers the defaulted normal-filter fields",
    /'deal'/.test(cs) && /'rentPeriod'/.test(cs) && /'category'/.test(cs));
  // Certification must see the MERGED cohort: a follow-up that states only an AF value arrives with
  // no type, and cohortAllows() would reject every intent the user just stated.
  check("AF certification runs against the merged state",
    /certifyAfOnMergedState\(\s*\n?\s*mergeConversationState\(/.test(data),
    "the re-certification must WRAP the merge, not sit beside it");
}
check("prevQuery is threaded through respond()", /prevQuery: opts\?\.prevQuery \?\? null/.test(data));
check("the UI passes the conversation's last query", /prevQuery: lastQueryRef\.current/.test(ui));
// The invariant is "a turn that produced state gets recorded", not one exact line. It was pinned to
// the listings-only shape, which went red on the change that BROADENED it to clarifications too.
check("the UI records the state from any turn that produced it",
  /turn\.query\) lastQueryRef\.current = turn\.query;/.test(ui));
// A CLARIFICATION MAY PAUSE EXECUTION; IT MAY NEVER ERASE STATE (owner ruling 2026-08-30).
check("a clarification turn is NOT excluded from being recorded",
  !/turn\.kind === 'listings' && turn\.query\) lastQueryRef/.test(ui),
  "listings-only recording is exactly how «مدينة ولا منطقة؟» threw away type, period and rating");
check("a message turn can carry the state it understood",
  /kind: 'message'; reply: string; query\?: SearchQuery/.test(data));
check("a clarification's understanding goes through the SAME merge+certify pipeline as a search",
  /d\.kind === 'message'[\s\S]{0,900}certifyAfOnMergedState\([\s\S]{0,200}mergeConversationState\(/.test(data),
  "a paused turn and a searching turn must not accumulate state by different rules");
// Owner rule (PR#832): New Chat inherits NOTHING.
check("New Chat clears the accumulated state", /lastQueryRef\.current = null;\s*\/\/ …and not the previous conversation's accumulated filters/.test(ui));
check("a Filter-originated search replaces it too",
  /makeRun\('filter'\);[\s\S]{0,700}?lastQueryRef\.current = null;/.test(ui));

if (failed) {
  console.error(`\n✗ ${failed} check(s) FAILED — clarification can silently reset conversation state`);
  process.exit(1);
}
console.log("\nOK — clarification adds or explicitly modifies; it never silently resets");
