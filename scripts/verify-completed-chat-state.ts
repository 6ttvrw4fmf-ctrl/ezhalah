// COMPLETED SEARCH — END THE CHAT CLEANLY (owner 2026-08-30). Auto-discovered barrier.
//
// When Advanced Filter has narrowed the search to its FINAL set (R11.1: honest total ≤
// INTERVIEW_STOP_AT) or no useful question remains (R11.2), the conversation is done: the composer
// (and the mic inside it) is replaced by «محادثة جديدة»; the transcript stays readable; Back / saved
// chats / persistence must reopen READ-ONLY, never resurrect a live composer.
//
// `completed` is set ONLY by the two canonical AF stop conditions. A plain first search with 20
// results and no AF round is not "finished" — pinned below by counting setCompleted(true) sites.
import { readFileSync } from "node:fs";
import { serializeChat, restoreChat } from "../src/lib/chatTranscript.ts";

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
};
const agent = readFileSync(new URL("../src/app/agent.tsx", import.meta.url), "utf8");
const i18n = readFileSync(new URL("../src/i18n.tsx", import.meta.url), "utf8");

console.log("── persistence: executed round-trip ──");
const base = { msgs: [{ id: "u1", role: "user", text: "شقق" }, { id: "r1", role: "results", text: "", result: { listings: [], matchTotal: 0 } }], revealCount: {}, afReceipt: {}, guidedPills: null };
const done = serializeChat({ ...base, completed: true } as any)!;
const open = serializeChat({ ...base, completed: false } as any)!;
const unset = serializeChat({ ...base } as any)!;
check("completed=true serializes to `completed: true`", done.completed === true);
check("completed=false serializes with NO key (older transcripts and the persistence barrier stay byte-identical)", !("completed" in open));
check("completed unset serializes with NO key", !("completed" in unset));
check("restore round-trips completed=true", restoreChat(JSON.parse(JSON.stringify(done)))?.completed === true);
check("restore of a transcript WITHOUT the key yields no completed (an old chat reopens live)", !("completed" in (restoreChat(JSON.parse(JSON.stringify(open))) ?? {})));
check("a forged non-boolean value is not honoured", !("completed" in (restoreChat({ ...JSON.parse(JSON.stringify(open)), completed: "yes" }) ?? {})));

console.log("\n── the ONLY two ways a chat completes are the canonical AF stop conditions ──");
const trueSites = (agent.match(/setCompleted\(true\)/g) ?? []).length;
check(`setCompleted(true) appears exactly twice (R11.1 + R11.2), found ${trueSites}`, trueSites === 2,
  "a third site means a count alone, or a plain first search, can lock the composer");
check("R11.1: the post-round honest total ≤ INTERVIEW_STOP_AT completes, inside finishGuided's onFetched",
  /onFetched: \(total\) => \{[\s\S]{0,300}?if \(total != null && total <= INTERVIEW_STOP_AT\) setCompleted\(true\);/.test(agent));
check("R11.2: the offer probe's `false` verdict completes ONLY after a committed AF round (afCarryRef)",
  /if \(!ok && afCarryRef\.current\) setCompleted\(true\);/.test(agent));
check("...and that verdict path still records afCanNarrow first (the «تحديد أكثر» gate is untouched)",
  /setAfCanNarrow\(\(c\) => \(\{ \.\.\.c, \[m\.id\]: ok \}\)\);\s*\n[^\n]*\n\s*if \(!ok && afCarryRef\.current\) setCompleted\(true\);/.test(agent));

console.log("\n── the composer is REPLACED, not merely hidden; the mic goes with it ──");
const wrapIdx = agent.indexOf("{completed ? (");
const compIdx = agent.indexOf("<View style={[s.composerWrap");
check("the composer block is inside the completed-false branch", wrapIdx > -1 && compIdx > wrapIdx && agent.indexOf(") : (", wrapIdx) < compIdx);
check("the mic lives inside the composer block, so a completed chat has no dead mic control",
  agent.indexOf('testID="voice-mic"') > compIdx);
check("the bar offers exactly one action — New Chat — via the store reset AND the Sidebar's own navigation",
  /onPress=\{\(\) => \{ newChat\(\); router\.replace\(\{ pathname: '\/', params: \{ fresh: String\(Date\.now\(\)\) \} \}\); \}\}/.test(agent));
check("newChat is taken from the store (no second reset implementation)", /hydrateTranscript, newChat \} = useApp\(\);/.test(agent));
check("the bar says the search is complete and points to a new chat",
  /t\('Search complete'\)/.test(agent) && /t\('Start a new chat to search again'\)/.test(agent) && /t\('New Chat'\)/.test(agent));

console.log("\n── Back / reopen / New Chat ──");
check("restore reinstates completed from the transcript", /setCompleted\(restored\.completed === true\);/.test(agent));
check("New Chat (fresh) clears it", /setCompleted\(false\);/.test(agent));
check("the capture persists it", /serializeChat\(\{ msgs: msgs as any, revealCount, afReceipt, guidedPills, completed \}\)/.test(agent));

console.log("\n── styling contract ──");
const styles = agent.slice(agent.indexOf("completedWrap:"), agent.indexOf("newChatTx:") + 120);
check("new styles use palette tokens only (no hex)", !/#[0-9a-fA-F]{6}/.test(styles));
check("both i18n keys have Arabic entries",
  /'Search complete': 'اكتمل البحث'/.test(i18n) && /'Start a new chat to search again': '/.test(i18n));

if (failed) { console.error(`\n✗ ${failed} check(s) FAILED`); process.exit(1); }
console.log("\nOK — a completed search ends the chat cleanly, persists, and never resurrects a live composer");
