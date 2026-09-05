// THE REPLY MAY NOT CLAIM WHAT THE DATABASE HAS NOT SAID (owner ruling 2026-08-29).
// Auto-discovered barrier + edge-deploy gate.
//
// ARCHITECTURAL FACT THIS RESTS ON: the agent edge function writes its reply BEFORE any search runs —
// the client executes the query afterwards. So a past-tense inventory claim in that reply
// («لقيت لك خيارات», «عندي نتائج») is, by construction, a claim about data nobody has fetched.
// The owner's rule is exact: never say «عندي خيارات» unless we actually queried and confirmed.
//
// Also pinned: no promise to WIDEN or relax the search — the query is built strictly and never
// widened, so «راح أوسّع البحث» describes something the product will not do. Same reply/query drift
// class as promising "cheapest" with no sort.
//
// And: do not search too early. A "listings" turn carrying nothing searchable is a shrug rendered as
// a search; it must ask instead.
import { readFileSync } from "node:fs";

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
};

const edge = readFileSync(new URL("../supabase/functions/agent/index.ts", import.meta.url), "utf8");
const wiring = readFileSync(new URL("../supabase/functions/agent/turnWiring.ts", import.meta.url), "utf8");

// Extract the REAL patterns from the deployed source and exercise them, rather than re-typing them
// (a copy would drift; see feedback_never-test-a-copy-of-production-code).
const grab = (name: string): RegExp => {
  const m = edge.match(new RegExp(`const ${name} =\\s*\\n?\\s*(/.*?/i);`, "s"));
  if (!m) throw new Error(`${name} not found in the deployed source`);
  // eslint-disable-next-line no-eval
  return eval(m[1]) as RegExp;
};
const CLAIMS = grab("CLAIMS_INVENTORY");
const WIDENS = grab("PROMISES_WIDENING");

console.log("── an ungrounded inventory claim is caught ──");
for (const r of ["لقيت لك عدة خيارات قريبة من اللي تبيه",
                 "عندي خيارات مناسبة لطلبك",
                 "عندنا نتائج تطابق المواصفات",
                 "وجدت لك شقق في الرياض",
                 "I found several options for you",
                 "I have options matching your request"]) {
  check(`claims inventory: «${r.slice(0, 40)}»`, CLAIMS.test(r));
}
console.log("\n── a truthful FUTURE-TENSE reply is NOT caught (the good style must survive) ──");
for (const r of ["أبشر، أدور لك شقة ٣ غرف للإيجار السنوي في الرياض",
                 "تمام، فهمت احتياجكم. عندك ميزانية تقريبية؟",
                 "أكيد، أقدر أساعدك نضيق الخيارات. كم غرفة تقريبًا تفضلون؟",
                 "Got it — searching now."]) {
  check(`allowed: «${r.slice(0, 42)}»`, !CLAIMS.test(r) && !WIDENS.test(r));
}
console.log("\n── a promise to WIDEN the search is caught ──");
for (const r of ["بدل ما أدور قصر راح أوسّع البحث",
                 "نوسع البحث ونشوف الخيارات الأقرب",
                 "توسيع البحث شوي عشان نلاقي خيارات",
                 "نخفف الشروط ونشوف الأقرب",
                 "I'll widen the search for you",
                 "let me broaden it a bit"]) {
  check(`widening promise: «${r.slice(0, 40)}»`, WIDENS.test(r));
}

console.log("\n── the reply may not claim an amenity the final query does not carry (owner 2026-08-31, gym class) ──");
// «أدور لك شقة... فيها نادي» while amenities carries no gym token is the exact reply/query drift class
// this file already pins for inventory claims and widening promises — generalized, not gym-specific:
// one regex per certified token. Extract the REAL map + function from the deployed source (not a
// hand copy) so a future edit to the regex content, not just its wiring, is caught here too.
const grabAmenityChecker = (): ((reply: string, amenities: string[]) => boolean) => {
  const mapM = edge.match(/const AMENITY_MENTION_RE: Record<string, RegExp> = (\{[\s\S]*?\n\});/);
  if (!mapM) throw new Error("AMENITY_MENTION_RE not found in the deployed source");
  const fnM = edge.match(/function replyClaimsUnlistedAmenity\(reply: string, amenities: string\[\]\): boolean \{([\s\S]*?)\n\}/);
  if (!fnM) throw new Error("replyClaimsUnlistedAmenity not found in the deployed source");
  // eslint-disable-next-line no-eval
  return eval(`(function(reply, amenities) {\n  const AMENITY_MENTION_RE = ${mapM[1].replace(/;$/, "")};\n${fnM[1]}\n})`);
};
const claimsUnlistedAmenity = grabAmenityChecker();

check("the owner's own example: reply claims a gym the query does not carry",
  claimsUnlistedAmenity("أبشر، أدور لك شقة فيها نادي وحمامين", []));
check("...but is CLEAN once gym is actually in the query",
  !claimsUnlistedAmenity("أبشر، أدور لك شقة فيها نادي وحمامين", ["gym"]));
check("English phrasing of the same claim is also caught",
  claimsUnlistedAmenity("Looking for an apartment with a gym for you", []));
check("a reply naming NO amenity at all is never flagged",
  !claimsUnlistedAmenity("تمام، أدور لك شقة ٣ غرف في الرياض", []));
check("a DIFFERENT already-certified amenity mentioned truthfully is not flagged",
  !claimsUnlistedAmenity("أدور لك شقة فيها مصعد وموقف", ["elevator", "parking"]));
check("claiming elevator while the query only carries parking is still caught (not just gym)",
  claimsUnlistedAmenity("أدور لك شقة فيها مصعد وموقف", ["parking"]));
check("a sibling rich token (pool) is covered generically, not just gym",
  claimsUnlistedAmenity("أبحث لك عن فيلا فيها مسبح", []) && !claimsUnlistedAmenity("أبحث لك عن فيلا فيها مسبح", ["pool"]));
check("groundReply neutralises the owner's exact reproduction case end-to-end",
  !CLAIMS.test("أبشر، أدور لك شقة فيها نادي وحمامين") && !WIDENS.test("أبشر، أدور لك شقة فيها نادي وحمامين")
  && claimsUnlistedAmenity("أبشر، أدور لك شقة فيها نادي وحمامين", []),
  "groundReply's neutral fallback only fires when SOME check trips; confirms the amenity check is the one catching this reply, not CLAIMS/WIDENS by coincidence");

console.log("\n── the guard is WIRED on every reply path ──");
check("groundReply() exists, now amenity-aware",
  /function groundReply\(reply: string, locale: string, amenities: string\[\] = \[\]\): string/.test(edge));
// M3 escaped the first version: the barrier proved the PATTERNS matched and the guard was WIRED, but
// never that groundReply actually ACTS. Turning its body into `return r;` left every check green.
check("groundReply actually neutralises — it is not a pass-through",
  edge.includes("if (!CLAIMS_INVENTORY.test(r) && !PROMISES_WIDENING.test(r) && !replyClaimsUnlistedAmenity(r, amenities)) return r;"),
  "without this early-return-ONLY-when-clean line the function returns every reply untouched");
check("it neutralises rather than surgically editing Arabic prose",
  /return locale === "en" \? "Got it — searching now\." : "تمام، أدوّر لك الحين\.";/.test(edge));
check("the LISTINGS reply is grounded, now with the amenities it will actually carry",
  /reply: groundReply\(replyOut, locale, outAmenities\),/.test(edge));
// Composed with oneQuestionOnly() since 2026-08-29 (one clarification question per turn). Still
// grounded — groundReply runs FIRST, so the claim/widening guard applies before any truncation.
// Assert the GROUNDING, not the punctuation that follows it. This pinned the exact `...) });` tail
// and went red the moment a clarification return gained a `query:` field (2026-08-30) — a change
// that strengthened the turn without touching the guard. The invariant is that a message reply
// passes through groundReply; what else the JSON carries is not this barrier's business.
// UPDATED (owner-approved unified-agent-search-authority consolidation, 2026-08-30): the empty-
// search clarification and the model's-own-question clarification used to be two separate `return
// json({ kind: "message", ... })` sites, each spelling out its own
// `reply: oneQuestionOnly(groundReply(...))`. decideAgentTurn() (supabase/functions/agent/decide.ts)
// is now the ONE place that decides a turn is a clarification, so both collapsed into a single
// return building a local `reply` const first — same grounding, one fewer path to keep in sync, not
// a weakening. The regex below tracks that real code shape rather than the pre-consolidation one.
// 2026-09-04: `noPlaceReply` joins ambiguityReply ahead of the model prose. Both are PLATFORM-built
// questions with no inventory claims in them, so neither needs grounding — what must stay true is
// that the MODEL's text is still the thing that gets grounded, and it is: the fallback arm is
// unchanged. A mutation removing groundReply from that arm still fails this check.
check("the MESSAGE reply is grounded, also amenity-aware",
  /const reply = ambiguityReply \?\? noPlaceReply \?\? oneQuestionOnly\(groundReply\(lead\(out\.reply\), locale, outAmenities\)\);/.test(edge));
const paths = (edge.match(/reply: groundReply\(|reply: oneQuestionOnly\(groundReply\(|const reply = ambiguityReply \?\? (?:noPlaceReply \?\? )?oneQuestionOnly\(groundReply\(/g) ?? []).length;
check(`every reply path goes through it (${paths} found)`, paths >= 2,
  "listings + the one unified clarification path (empty-search and the model's-own-question cases are now the SAME return)");
check("no reply path bypasses the guard",
  !/reply: replyOut,/.test(edge) && !/reply: lead\(out\.reply\) \}\)/.test(edge),
  "an ungrounded path would let the claim straight through");

console.log("\n── do not search too early ──");
// SUPERSEDED (owner-approved consolidation, 2026-08-30): the empty-search gate used to be a bare
// `nothingToSearchOn` boolean re-derived inline here. It is now hasEnoughToSearch() in
// supabase/functions/agent/decide.ts — the SAME test, extracted so decideAgentTurn() can also apply
// it to the FULL merged conversation state, not just this turn's raw fields (see decide.ts's own
// mutation-proven suite, scripts/verify-agent-decide-turn.ts, for the "type-only/city-only still
// searches" and "genuinely empty still asks" cases this section used to pin here). What THIS barrier
// still owns: that index.ts actually WIRES its resolved fields into the ladder instead of silently
// keeping its own second copy of the decision.
// The import list grew on 2026-09-04 (hasUsableLocation, for the no-place city question). Match the
// SYMBOL inside the decide.ts import rather than the exact list, so adding a second import from the
// same module is not a false failure — while still proving index.ts takes it from the single
// decision authority instead of keeping a private copy.
check("index.ts imports wantsGuidedInterview from ./decide.ts",
  /import \{[^}]*\bwantsGuidedInterview\b[^}]*\} from "\.\/decide\.ts";/.test(edge));
check("index.ts takes hasUsableLocation from the SAME single decision authority",
  /import \{[^}]*\bhasUsableLocation\b[^}]*\} from "\.\/decide\.ts";/.test(edge),
  'the no-place question must reuse the ladder\'s own predicate, never a second copy');
// EXTRACTED (round 2, "UNTESTED WIRING / FOOLABLE REGEX"): the establishedState-construction +
// decideAgentTurn() call site used to live inline in index.ts, guarded only by the source-regexes
// below — which round 1 proved a plausible mutation could pass. It is now buildTurnDecision() in
// ./turnWiring.ts, a plain function scripts/verify-agent-turn-wiring.ts imports and EXECUTES
// end-to-end. These checks stay as defense in depth (see the tightened priorAskAbout check below),
// not the primary guard.
check("index.ts imports the wiring function instead of re-deriving establishedState inline",
  /import \{ buildTurnDecision \} from "\.\/turnWiring\.ts";/.test(edge));
check("index.ts itself no longer calls decideAgentTurn() directly (single call site in turnWiring.ts)",
  !/decideAgentTurn\(\{/.test(edge),
  "prose mentions of decideAgentTurn() in comments are fine; an actual call site here would be the second copy this consolidation removed");
check("turnWiring.ts calls decideAgentTurn() exactly once, after resolving this turn's fields",
  (wiring.match(/const decision = decideAgentTurn\(\{/g) ?? []).length === 1);
check("establishedState is built from THIS turn's resolved fields, not the model's raw kind",
  /const establishedState: EstablishedState = \{/.test(wiring)
  && /location: location \|\|/.test(wiring),
  "the seven gate fields must come from the resolved location/type/price/detail/amenities/af/ask_about, OR'd with prevQuery");
// TIGHTENED (round 2, finding 5b): anchor the FULL right-hand-side expression, not just the callee
// prefix. Round 1 demonstrated a plausible "consistency fix" mutation that merges THIS turn's
// askAboutList into priorAskAbout (`Array.isArray(prevQuery?.askAbout) ? [...prevQuery!.askAbout as
// string[], ...askAboutList] : askAboutList`) — the OLD prefix-only regex
// `/priorAskAbout: Array\.isArray\(prevQuery\?\.askAbout\)/` still matches that mutated line (it's a
// literal substring of it), so the barrier stayed green while the mandatory case (c) regression came
// back. Anchoring the exact null-branch through the line's own trailing comma closes that hole.
// Proven live (round 2): applying that exact mutation to turnWiring.ts made
// scripts/verify-agent-turn-wiring.ts's case (c) fail while this loosened check would have stayed
// green — this anchored version now fails on the mutation too (checked by hand, not asserted here,
// since asserting "the wrong regex would have passed" would require shipping the wrong regex).
check("priorAskAbout reads ONLY prevQuery's survived value — the exact expression, not a mutable prefix",
  /priorAskAbout: Array\.isArray\(prevQuery\?\.askAbout\) \? prevQuery!\.askAbout as string\[\] : null,/.test(wiring),
  "a mutation merging this turn's askAboutList into priorAskAbout must fail this check");
check("a bare nothingToSearchOn re-derivation has NOT been reintroduced",
  !/const nothingToSearchOn =/.test(edge) && !/const nothingToSearchOn =/.test(wiring),
  "a second, local copy of the gate is exactly how the server, model and client end up with three contradicting budgets again");

console.log("\n── the model is told the rule, not just guarded ──");
check("told it cannot know results yet", /you write this reply BEFORE the search runs, so you cannot know/.test(edge));
check("told to adapt to brevity cues without claiming to read emotions",
  /Do not claim to read their emotions/.test(edge));

if (failed) {
  console.error(`\n✗ ${failed} check(s) FAILED — the reply can claim what the DB has not confirmed`);
  process.exit(1);
}
console.log("\nOK — replies never claim un-fetched inventory, never promise widening, never search empty");
