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
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeChat, restoreChat, persistedOnly, TRANSCRIPT_LISTING_CAP, TRANSCRIPT_FIRST_PAGE, type PersistedChat } from "../src/lib/chatTranscript.ts";
import { resultCounts } from "../src/data/resultCount.ts";
import { resultsActionsRowVisible } from "../src/lib/afBrowsingGate.ts";

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
};
/**
 * A MUTATION PROOF: this barrier's own predicate, applied to a deliberately broken REAL module,
 * asserting it really comes back RED. `caught` must be computed — a literal `true` is the shape
 * scripts/verify-new-barriers-are-mutation-proven.ts exists to refuse.
 */
const mustCatch = (label: string, caught: boolean, detail = "") => check(`MUTATION — ${label}`, caught, detail);
const agent = readFileSync(new URL("../src/app/agent.tsx", import.meta.url), "utf8");
const i18n = readFileSync(new URL("../src/i18n.tsx", import.meta.url), "utf8");
// A COMMENT IS NOT A CODE PATH: the site-count check below must count CALLS, not a prose mention of
// `setCompleted(true)` in an explanatory comment (this file's own comments name the literal call,
// and so does the 2026-09-11 comment at playListings' new call site — unstripped, either is exactly
// the trap this rule exists to catch).
const decomment = (src: string) =>
  src.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
const agentCode = decomment(agent);

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

console.log("\n── the ONLY two ways a chat completes are the ≤ 50 threshold or an explicit show-all ──");
// OWNER PRODUCT RULE 2026-09-04, GENERALIZED 2026-09-11: the ≤ INTERVIEW_STOP_AT (50) honest total
// completes the chat (R11.1) — an AF round landing there, but also a plain Filter search or a typed
// AI-Agent message that already lands at <= 50 (the shared playListings renderer all three flow
// through) — OR the user's own explicit «عرض المزيد» show-all-and-finish choice (Task 4), which
// finishes at ANY total because it is a deliberate click, not a guess. A set that is still ABOVE 50
// with no truthful certified question left (the old R11.2) is SAID OUT LOUD and the composer stays
// LIVE — the interview never invents a question, and never silently locks the chat on a big set. So
// every completion site must be one of exactly these TWO named gates; the count itself is no longer
// pinned to 1 now that more than one entry point legitimately reaches it.
const trueSites = (agentCode.match(/setCompleted\(true\)/g) ?? []).length;
const gatedSites = (agentCode.match(/if \((?:searchIsFinishedAtThreshold\(.*?\)|userChoseShowAllAndFinish)\)\s*setCompleted\(true\);/g) ?? []).length;
check(`every setCompleted(true) site is gated by the ≤50 threshold or the explicit show-all choice (found ${trueSites}, ${gatedSites} gated)`,
  trueSites >= 1 && trueSites === gatedSites,
  "an ungated site means a count alone, a no-more-questions verdict, or anything else can lock the composer");
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
check("the input goes non-editable when completed", /editable=\{!completed\}/.test(agent));
check("the input's value is cleared when completed (nothing typed can look sendable)",
  /value=\{completed \? '' : typed\}/.test(agent));
check("the placeholder explains the closed state instead of inviting a message",
  /placeholder=\{completed \? t\('This chat is closed — tap ☰ at the top to start a new search'\)/.test(agent));
check("the mic disappears when completed (no dead mic control on a locked composer)",
  /isVoiceInputSupported\(\) && !completed \?/.test(agent));
check("the send button is disabled once completed, regardless of typed text",
  /disabled=\{completed \|\| !typed\.trim\(\)\}/.test(agent));
check("the send icon becomes a lock when completed, an arrow otherwise",
  /name=\{completed \? 'lock-closed' : 'arrow-up'\}/.test(agent));
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
  const regressed = agent.replace("disabled={completed || !typed.trim()}", "disabled={!typed.trim()}");
  check("MUTATION: dropping `completed` from the send button's disabled condition is caught",
    !/disabled=\{completed \|\| !typed\.trim\(\)\}/.test(regressed));
}

console.log("\n── Back / reopen / New Chat ──");
check("restore reinstates completed from the transcript", /setCompleted\(restored\.completed === true\);/.test(agent));
check("New Chat (fresh) clears it", /setCompleted\(false\);/.test(agent));
check("the capture persists it", /serializeChat\(\{ msgs: msgs as any, revealCount, afReceipt, guidedPills, completed \}\)/.test(agent));

console.log("\n── i18n contract ──");
check("the closed-composer placeholder has an Arabic entry",
  /'This chat is closed — tap ☰ at the top to start a new search': 'أُغلقت هذه المحادثة/.test(i18n));

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// §TERMINALITY — `completed` IS A CLAIM ABOUT LISTINGS THE TRANSCRIPT TRUNCATES (routine #8,
// 2026-09-12). THE SEAM: this file's own subject (the terminal-chat rule, #4/#5) composed with
// src/lib/chatTranscript.ts's size bound (#6). Each side is correct alone; the defect exists only
// across the transition, which is why every check above stayed green while it was live — the
// round-trip cases at the top of this file all use `listings: []`, a turn that can never truncate.
//
// TWO DEFECTS, ONE MECHANISM: the transcript layer treated `completed` as an ordinary optional
// field — carried where it had been falsified (a truncated last turn), and dropped where it was
// true (store.tsx's hand-written re-projection on the server-hydration path).
//
// EXECUTED, NEVER GREPPED: the real serializeChat/restoreChat/persistedOnly run against the real
// resultCounts + resultsActionsRowVisible gates, and every mutation below IMPORTS A MUTATED COPY OF
// THE REAL MODULE rather than asserting about its text.
console.log("\n── §TERMINALITY: a reopened chat never withholds BOTH the pager and the composer while matches remain ──");

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ source: "aqar", id: `L${i}` }));
/** A finished chat: `n` matches, all revealed, optionally preceded by a larger earlier turn. */
const finishedChat = (n: number, earlierBigTurn = false) => ({
  msgs: [
    { id: "u1", role: "user", text: "شقق للإيجار في الرياض" },
    ...(earlierBigTurn
      ? [{ id: "old", role: "results", result: { listings: rows(900), pageOffset: 500, hasMore: true, matchTotal: 9000, query: {} } }]
      : []),
    { id: "mid", role: "results", result: { listings: rows(n), pageOffset: 0, hasMore: false, matchTotal: n, query: {} } },
  ],
  revealCount: { ...(earlierBigTurn ? { old: 100 } : {}), mid: n },
  afReceipt: {}, guidedPills: null, completed: true,
});

/**
 * Reopen a chat through the REAL round trip and ask the REAL gates what the user is left with.
 * `deadEnd` is the defect: matches remain off screen, «عرض المزيد» is withheld by `completed`, and
 * the composer is locked by the same flag — no route to them from that chat.
 */
const reopen = (
  live: ReturnType<typeof finishedChat>,
  ser: typeof serializeChat = serializeChat,
  res: typeof restoreChat = restoreChat,
) => {
  const back = res(ser(live as never) as never);
  if (!back) throw new Error("serialize/restore returned null for a real conversation");
  const turn = back.msgs.filter((m) => m.role === "results").at(-1) as never as
    { id: string; result: { listings: unknown[]; matchTotal: number; hasMore?: boolean } };
  const shown = back.revealCount[turn.id] ?? TRANSCRIPT_FIRST_PAGE;
  const rc = resultCounts({ trueTotal: turn.result.matchTotal, shown, fetched: turn.result.listings.length, serverMore: !!turn.result.hasMore });
  const completed = back.completed === true;
  const pager = resultsActionsRowVisible({ hasMore: rc.hasMore, canNarrowFurther: false, afPhase: null, chatCompleted: completed });
  return { shown, total: turn.result.matchTotal, completed, pager, deadEnd: rc.hasMore && !pager && completed };
};

// The boundary is exact and both sides are load-bearing: at or under the cap nothing is truncated,
// so the terminal claim still holds and the lock is right; one row past it the claim is false.
const atCap = reopen(finishedChat(TRANSCRIPT_LISTING_CAP));
check(`a finished chat at the cap (${TRANSCRIPT_LISTING_CAP} matches) keeps its lock — nothing was truncated, so nothing is out of reach`,
  atCap.completed === true && atCap.pager === false && atCap.deadEnd === false,
  JSON.stringify(atCap));
const pastCap = reopen(finishedChat(TRANSCRIPT_LISTING_CAP + 1));
check(`one row past the cap (${TRANSCRIPT_LISTING_CAP + 1}) is NOT terminal on reopen — the claim "every match is already revealed" is false once a row is dropped`,
  pastCap.deadEnd === false && pastCap.pager === true,
  JSON.stringify(pastCap));
for (const n of [100, 1_200, 2_060]) {
  const r = reopen(finishedChat(n));
  check(`a ${n.toLocaleString("en-US")}-match search browsed to its end reopens browsable, not stranded (${r.shown} on screen, pager=${r.pager})`,
    r.deadEnd === false && r.pager === true, JSON.stringify(r));
}
// The AF completions (R11.1/R11.2) are ≤ INTERVIEW_STOP_AT rows and so can never truncate — their
// lock is owner rule 2026-08-30 and must survive untouched, INCLUDING inside a chat whose earlier,
// larger turn was truncated. Only the LAST results turn may decide terminality.
const afSmall = reopen(finishedChat(20));
check("an AF-completed chat (20 rows, ≤ INTERVIEW_STOP_AT) still reopens LOCKED — owner rule 2026-08-30 untouched",
  afSmall.completed === true && afSmall.pager === false && afSmall.deadEnd === false, JSON.stringify(afSmall));
const afAfterBigTurn = reopen(finishedChat(20, true));
check("...and still locked when an EARLIER turn in the same chat was truncated — only the LAST results turn decides",
  afAfterBigTurn.completed === true && afAfterBigTurn.pager === false, JSON.stringify(afAfterBigTurn));

console.log("\n── §PROJECTION: a restored transcript handed back to storage loses nothing ──");
// store.tsx's hydrateTranscript (the server-copy path — every chat older than
// LOCAL_TRANSCRIPT_ENTRIES, and every chat opened on a second device) must not rebuild the
// transcript field by field. `completed?: true` is OPTIONAL, so tsc cannot catch an omission.
const restoredAll = restoreChat(serializeChat(finishedChat(20) as never) as never)!;
const projected = persistedOnly(restoredAll);
const lost = Object.keys(restoredAll).filter((k) => k !== "doneTyping" && !(k in projected));
check("every field of a restored transcript survives the projection — enumerated at run time, never a written list",
  lost.length === 0, `lost: ${JSON.stringify(lost)}`);
check("`completed` in particular survives (the field that was silently dropped)", projected.completed === true);
check("the render-only `doneTyping` is the ONE thing stripped", !("doneTyping" in projected));
check("a re-restore of the projection still reopens the chat LOCKED",
  restoreChat(JSON.parse(JSON.stringify(projected)))?.completed === true);
// The class, enumerated over the tree rather than pinned to the one line that had the defect: a
// PersistedChat assembled by hand anywhere outside its own module is the shape that lost the field.
{
  const handRolled: string[] = [];
  for (const f of readdirSync(SRC_DIR, { recursive: true, encoding: "utf8" })) {
    if (!/\.tsx?$/.test(f) || f.endsWith("lib/chatTranscript.ts")) continue;
    const src = decomment(readFileSync(join(SRC_DIR, f), "utf8"));
    if (/\{\s*v:\s*1\s*,[\s\S]{0,120}?msgs\s*:/.test(src)) handRolled.push(f);
  }
  check("no module outside chatTranscript.ts assembles a PersistedChat by hand",
    handRolled.length === 0, `hand-rolled in: ${handRolled.join(", ")}`);
  check("store.tsx's server-hydration path routes through persistedOnly()",
    /return persistedOnly\(valid\);/.test(decomment(readFileSync(join(SRC_DIR, "store.tsx"), "utf8"))));
}

console.log("\n── §TERMINALITY/§PROJECTION mutation proofs — each re-introduces the real defect in a real module copy ──");
/** Import a deliberately broken copy of the REAL module and return its exports. */
const mutantModule = async (from: string, to: string) => {
  const file = join(SRC_DIR, "lib/chatTranscript.ts");
  const src = readFileSync(file, "utf8");
  if (!src.includes(from)) throw new Error(`mutation anchor missing in chatTranscript.ts:\n${from}`);
  const out = join(mkdtempSync(join(tmpdir(), "ezhalah-completed-mut-")), "chatTranscript.mts");
  writeFileSync(out, src.replace(from, to));
  return await import(out) as { serializeChat: typeof serializeChat; restoreChat: typeof restoreChat; persistedOnly: typeof persistedOnly };
};
{
  // THE DEFECT AS IT SHIPPED: carry `completed` across truncation.
  const m = await mutantModule(
    "...(live.completed && !lastResultsTruncated ? { completed: true as const } : {}),",
    "...(live.completed ? { completed: true as const } : {}),",
  );
  const r = reopen(finishedChat(1_200), m.serializeChat, m.restoreChat);
  mustCatch("M-carry — carrying `completed` across truncation strands the user (1,140 of 1,200 unreachable)",
    r.deadEnd === true, JSON.stringify(r));
}
{
  // The "LAST results turn" precision is load-bearing, not incidental: widening it to ANY turn
  // silently unlocks an AF-completed chat, breaking owner rule 2026-08-30 in the other direction.
  const m = await mutantModule(
    "lastResultsTruncated = keep < r.listings.length;",
    "lastResultsTruncated = lastResultsTruncated || keep < r.listings.length;",
  );
  const r = reopen(finishedChat(20, true), m.serializeChat, m.restoreChat);
  mustCatch("M-any-turn — deciding terminality from ANY turn unlocks an AF-completed chat",
    r.completed === false, JSON.stringify(r));
}
{
  // THE OTHER DEFECT AS IT SHIPPED: the hand-written field list in store.tsx's projection.
  const m = await mutantModule(
    "const { doneTyping: _doneTyping, ...persisted } = restored;\n  return persisted;",
    "return { v: 1, msgs: restored.msgs, revealCount: restored.revealCount, afReceipt: restored.afReceipt, guidedPills: restored.guidedPills } as PersistedChat;",
  );
  const dropped = m.persistedOnly(restoredAll);
  mustCatch("M-projection — re-listing the fields to keep drops `completed`, reopening a finished chat with a LIVE composer",
    dropped.completed !== true, JSON.stringify(Object.keys(dropped)));
}

if (failed) { console.error(`\n✗ ${failed} check(s) FAILED`); process.exit(1); }
console.log("\nOK — a completed search locks the SAME composer (inert input, no mic, lock icon), persists, and never resurrects a live one");
