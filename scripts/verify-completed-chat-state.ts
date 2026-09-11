// COMPLETED SEARCH — END THE CHAT CLEANLY (owner 2026-08-30; composer restored 2026-09-05). Auto-
// discovered barrier.
//
// When Advanced Filter has narrowed the search to its FINAL set (R11.1: honest total ≤
// INTERVIEW_STOP_AT) or no useful question remains (R11.2), the conversation is done. ORIGINALLY
// (2026-08-30) the composer was REPLACED by a separate "Search complete" card. Per owner request
// 2026-09-05, the composer keeps its normal look instead: the SAME box, made inert, with an
// explanatory placeholder; the mic disappears; the send arrow becomes a lock. There is no card and
// no in-composer "New Chat" button any more — the real "start over" action is the hamburger, top
// left. The transcript stays readable; Back / saved chats / persistence must reopen with the
// composer locked, never a live one.
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
// OWNER PRODUCT RULE 2026-09-04: ONLY the ≤ INTERVIEW_STOP_AT (50) final set completes the chat
// (R11.1). A set that is still ABOVE 50 with no truthful certified question left (the old R11.2)
// is SAID OUT LOUD and the genuine results stay on screen with the composer LIVE — the user may
// still refine by typing; the interview never invents a question, and never silently locks the
// chat on a big set. So exactly ONE completion site remains.
check(`setCompleted(true) appears exactly once (R11.1 — the ≤50 final set), found ${trueSites}`, trueSites === 1,
  "a second site means a count alone, a plain first search, or an exhausted-but-large set can lock the composer");
check("R11.1: the post-round honest total ≤ INTERVIEW_STOP_AT completes, inside finishGuided's onFetched",
  /onFetched: \(total\) => \{[\s\S]{0,900}?if \(searchIsFinishedAtThreshold\(total, INTERVIEW_STOP_AT\)\) setCompleted\(true\);/.test(agent));
check("R11.2 (revised 2026-09-04): a MEASURED 'no' after a committed AF round is SPOKEN, not a silent completion",
  /verdict === 'no' && afCarryRef\.current && !noMoreSaidRef\.current\[m\.id\]/.test(agent)
  && /No further truthful narrowing question exists for this scope/.test(agent)
  && !/if \(!ok && afCarryRef\.current\) setCompleted\(true\);/.test(agent));
check("...and that verdict path still records afCanNarrow first (the «تحديد أكثر» gate is untouched)",
  /setAfCanNarrow\(\(c\) => \(\{ \.\.\.c, \[m\.id\]: verdict === 'yes' \}\)\);/.test(agent));
check("the spoken line is said at most ONCE per results turn (noMoreSaidRef guard)",
  /noMoreSaidRef\.current\[m\.id\] = true;/.test(agent));

console.log("\n── the composer is the SAME box, made inert — not a separate card ──");
const compIdx = agent.indexOf("<View style={[s.composerWrap");
check("the composer block is unconditional — no ternary swaps in a different card for `completed`",
  compIdx > -1 && !/\{completed \? \(/.test(agent));
// 2026-09-11: ONE MAIN REQUEST + ONE FOLLOW-UP (src/lib/refinementFollowup.ts) added a SECOND,
// independent reason the same composer can go inert — `refinementComposerLocked`. Every one of these
// checks now asserts `completed` is STILL part of the condition (never replaced), not that it is the
// WHOLE condition — see verify-refinement-followup.ts for that flag's own dedicated coverage.
check("the input goes non-editable when completed", /editable=\{!completed && !refinementComposerLocked\}/.test(agent));
check("the input's value is cleared when completed (nothing typed can look sendable)",
  /value=\{completed \|\| refinementComposerLocked \? '' : typed\}/.test(agent));
check("the placeholder explains the closed state instead of inviting a message",
  /placeholder=\{completed \? t\('This chat is closed — tap ☰ at the top to start a new search'\)/.test(agent));
check("the mic disappears when completed (no dead mic control on a locked composer)",
  /isVoiceInputSupported\(\) && !completed && !refinementComposerLocked \?/.test(agent));
check("the send button is disabled once completed, regardless of typed text",
  /disabled=\{completed \|\| refinementComposerLocked \|\| !typed\.trim\(\)\}/.test(agent));
check("the send icon becomes a lock when completed, an arrow otherwise",
  /name=\{completed \|\| refinementComposerLocked \? 'lock-closed' : 'arrow-up'\}/.test(agent));
check("no separate replacement card, New Chat button, or their styles remain",
  !/completedWrap|completedBar|completedTxWrap|completedSub|newChatBtn|newChatTx/.test(agent));

console.log("\n── mutation proof — the barrier must actually catch a regression ──");
{
  // Simulate the OLD replacement-card shape reappearing: a ternary swaps in a different branch.
  // The real check's own condition, re-run against the mutant, must flip from PASS to FAIL.
  const isUnconditional = (src: string) => compIdx > -1 && !/\{completed \? \(/.test(src);
  const regressed = "{completed ? (<View />) : (" + agent;
  check("MUTATION: reintroducing a completed-ternary around the composer is caught",
    isUnconditional(agent) === true && isUnconditional(regressed) === false);
}
{
  // Simulate someone forgetting to disable the send button while locking the icon to a lock.
  const regressed = agent.replace("disabled={completed || refinementComposerLocked || !typed.trim()}", "disabled={!typed.trim()}");
  check("MUTATION: dropping `completed` from the send button's disabled condition is caught",
    !/disabled=\{completed \|\| refinementComposerLocked \|\| !typed\.trim\(\)\}/.test(regressed));
}

console.log("\n── Back / reopen / New Chat ──");
check("restore reinstates completed from the transcript", /setCompleted\(restored\.completed === true\);/.test(agent));
check("New Chat (fresh) clears it", /setCompleted\(false\);/.test(agent));
check("the capture persists it", /serializeChat\(\{ msgs: msgs as any, revealCount, afReceipt, guidedPills, completed, refinementLocked: refinementTurn === 'locked' \}\)/.test(agent));

console.log("\n── i18n contract ──");
check("the closed-composer placeholder has an Arabic entry",
  /'This chat is closed — tap ☰ at the top to start a new search': 'أُغلقت هذه المحادثة/.test(i18n));

if (failed) { console.error(`\n✗ ${failed} check(s) FAILED`); process.exit(1); }
console.log("\nOK — a completed search locks the SAME composer (inert input, no mic, lock icon), persists, and never resurrects a live one");
