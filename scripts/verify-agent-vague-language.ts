// VAGUE LANGUAGE MUST NEVER BECOME A NUMBER (owner ruling 2026-08-29).
// Auto-discovered barrier + edge-deploy gate.
//
// THE LIVE BUG THIS EXISTS FOR, measured in production 2026-08-29:
//   «أبي بيت كبير»  →  detail: "5+"
// The model read "big" as five-plus bedrooms — a number the user never said, on a dimension they
// never mentioned. "Big" is an AREA intent, and there is no product-approved threshold for it.
//
// THE RULE: understand first → normalize only if truthfully possible → otherwise ASK.
// A clarification is a SUCCESSFUL outcome. A guess is not. Understanding a word is never permission
// to invent a value, and a clarification must never secretly apply the value it is asking about.
import { readFileSync } from "node:fs";

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
};

const edge = readFileSync(new URL("../supabase/functions/agent/index.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../src/data/agent.ts", import.meta.url), "utf8");

// The guard is deterministic code in the edge function. Re-implementing it here would be testing a
// copy (see feedback_never-test-a-copy-of-production-code), so we EXTRACT the real predicates and
// exercise them against real sentences.
const saidDigits = (t: string) => /[0-9٠-٩۰-۹]/.test(t);
const saidBedroomWord = (t: string) => /(غرف|غرفة|غرفه|حجرة|bed\s?room|bedroom|\brooms?\b|\bbr\b)/i.test(t);
const bedroomShaped = (v: string) => /^([1-4]|5\+?)$/.test(v);
// Assert the extracted predicates are BYTE-IDENTICAL to the deployed ones, so this cannot drift.
check("the digit predicate matches the deployed source",
  edge.includes('const saidDigits = /[0-9٠-٩۰-۹]/.test(text);'));
// The deployed guard evaluates BOOLEAN CONSTS, not calls. An earlier version of this check expected
// `!saidDigits(text)` and therefore failed even on healthy source — which made a mutation look
// "caught" when the check was simply always red. A barrier that is red for the wrong reason is not
// a barrier.
check("the bedroom-word predicate matches the deployed source",
  edge.includes('const saidBedroomWord = /(غرف|غرفة|غرفه|حجرة|bed\\s?room|bedroom|\\brooms?\\b|\\bbr\\b)/i.test(text);'));
check("the bedroom-shape predicate matches the deployed source",
  edge.includes('const bedroomShaped = (v: string) => /^([1-4]|5\\+?)$/.test(v);'));
// Predicates being correct proves nothing if the guard is never evaluated. Pin the CONDITION too —
// replacing it with `false` disabled the whole fix and escaped the first version of this barrier.
check("the guard is actually WIRED (not just its predicates present)",
  edge.includes('if (typeof out.detail === "string" && bedroomShaped(out.detail.trim()) && !saidDigits && !saidBedroomWord) {'),
  "the condition must evaluate the predicates — a constant here silently restores the live bug");
check("the guard clears the invented detail", /out\.detail = "";/.test(edge));

/** True when the guard would DROP the model's detail and ask instead. */
const wouldDrop = (text: string, detail: string) =>
  bedroomShaped(detail) && !saidDigits(text) && !saidBedroomWord(text);

console.log("\n── vague size must NOT become bedrooms (the live bug) ──");
check("LIVE REPRO «أبي بيت كبير» + detail '5+' → DROPPED and asked", wouldDrop("أبي بيت كبير", "5+"));
check("«شي واسع» → dropped", wouldDrop("ابغى شي واسع في الرياض", "5+"));
check("«بيت صغير» → dropped", wouldDrop("ابغى بيت صغير", "1"));
check("English 'big house' → dropped", wouldDrop("I want a big house", "5+"));

console.log("\n── an EXPLICIT bedroom count must always survive ──");
check("«٣ غرف» (Arabic digits + word) survives", !wouldDrop("ابغى شقة ٣ غرف في الرياض", "3"));
check("«3 غرف» (western digits) survives", !wouldDrop("ابغى شقة 3 غرف", "3"));
check("«خمس غرف» (word, no digit) survives via the bedroom word", !wouldDrop("ابغى خمس غرف", "5+"));
check("'3 bedrooms' survives", !wouldDrop("I want 3 bedrooms", "3"));
check("a digit anywhere (a budget) is enough to trust an explicit ask",
  !wouldDrop("ابغى بيت كبير بميزانية 500000 وفيه 4 غرف", "4"));

console.log("\n── a SIZE detail is never touched (only bedroom-shaped values are) ──");
check("detail '200' (m²) is not bedroom-shaped, so the guard ignores it", !wouldDrop("ابغى بيت كبير", "200"));
check("detail '750' is untouched", !wouldDrop("شي واسع", "750"));

console.log("\n── the guard must ASK, not just delete ──");
check("dropping also raises the 'size' clarification",
  /out\.ask_about\.push\("size"\)/.test(edge),
  "silently deleting the filter would answer a different question than the user asked");
check("the model is told to emit ask_about instead of inventing",
  /NEVER invent a bedroom count, an area, or a rating from a vague word/.test(edge));
check("vague intents reach the client, not the bin", /lastVagueIntents = Array\.isArray\(b\.askAbout\)/.test(client));

console.log("\n── clarification must never secretly apply a guessed value ──");
// The vague list is carried SEPARATELY from the query. Nothing in the vague path may write a filter.
const vagueBlock = (client.match(/lastVagueIntents = [^\n]*\n/) ?? [""])[0];
check("the vague path assigns no query field", !/q\.[a-zA-Z]+\s*=/.test(vagueBlock), vagueBlock);
check("rating has no vague→number mapping anywhere (0-10 scale, no approved threshold)",
  !/(عالي|ممتاز|high|excellent)[^\n]{0,40}(9\.0|9\.5|4\.5|4\.0)/.test(edge),
  "a vague rating word must never be wired to a number");

if (failed) {
  console.error(`\n✗ ${failed} check(s) FAILED — vague language can become an invented number`);
  process.exit(1);
}
console.log("\nOK — vague words are understood, never quantified; clarification applies nothing");
