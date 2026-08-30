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

console.log("\n── the guard is WIRED on every reply path ──");
check("groundReply() exists", /function groundReply\(reply: string, locale: string\): string/.test(edge));
// M3 escaped the first version: the barrier proved the PATTERNS matched and the guard was WIRED, but
// never that groundReply actually ACTS. Turning its body into `return r;` left every check green.
check("groundReply actually neutralises — it is not a pass-through",
  edge.includes("if (!CLAIMS_INVENTORY.test(r) && !PROMISES_WIDENING.test(r)) return r;"),
  "without this early-return-ONLY-when-clean line the function returns every reply untouched");
check("it neutralises rather than surgically editing Arabic prose",
  /return locale === "en" \? "Got it — searching now\." : "تمام، أدوّر لك الحين\.";/.test(edge));
check("the LISTINGS reply is grounded", /reply: groundReply\(replyOut, locale\),/.test(edge));
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
check("the MESSAGE reply is grounded",
  /const reply = ambiguityReply \?\? oneQuestionOnly\(groundReply\(lead\(out\.reply\), locale\)\);/.test(edge));
const paths = (edge.match(/reply: groundReply\(|reply: oneQuestionOnly\(groundReply\(|const reply = ambiguityReply \?\? oneQuestionOnly\(groundReply\(/g) ?? []).length;
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
check("index.ts imports the single decision authority from ./decide.ts",
  /import \{ decideAgentTurn, wantsGuidedInterview, type EstablishedState \} from "\.\/decide\.ts";/.test(edge));
check("index.ts calls decideAgentTurn() exactly once, after resolving this turn's fields",
  (edge.match(/const decision = decideAgentTurn\(\{/g) ?? []).length === 1);
check("establishedState is built from THIS turn's resolved fields, not the model's raw kind",
  /const establishedState: EstablishedState = \{/.test(edge)
  && /location: location \|\|/.test(edge) && /priorAskAbout: Array\.isArray\(prevQuery\?\.askAbout\)/.test(edge),
  "the seven gate fields must come from the resolved location/type/price/detail/amenities/af/ask_about, OR'd with prevQuery");
check("a bare nothingToSearchOn re-derivation has NOT been reintroduced",
  !/const nothingToSearchOn =/.test(edge),
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
