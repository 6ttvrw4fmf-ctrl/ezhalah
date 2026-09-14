// CONVERSATION-SCOPED STATE IS NEVER INHERITED BY THE NEXT CONVERSATION (routine #8, 2026-09-14).
// Auto-discovered barrier (scripts/lib/testRegistry.ts — existence is the wiring).
//
// THE SEAM. The terminal-results rule (#4/#5 — `completed` locks the composer AND withholds the whole
// «عرض المزيد» row via resultsActionsRowVisible) composed with chat switching (#6 — the sidebar
// reopens a chat with router.replace({pathname:'/agent'}) while ALREADY on /agent: same route, same
// component instance, nothing remounted). Each side is correct alone. The defect exists only across
// the transition, which is why every check in verify-completed-chat-state.ts stayed green while it
// was live — that file round-trips a transcript, and this defect never touches one.
//
// WHAT WAS LIVE ON 2026-09-14 (found by re-attacking the CLASS behind ops_incident #211, not its
// instance). There were TWO hand-maintained copies of "what belongs to the conversation we are
// leaving" — `startFresh()` and the New Chat handler — and each omitted what the other remembered.
// Neither omission is visible to tsc: they are statements, not a type.
//   • startFresh forgot `completed`. A user who had just finished a search — and since the owner's
//     2026-09-14 two-tap/500-cap rule EVERY search now finishes — reopened a chat with no transcript
//     (a legacy entry, a locally-pruned one, a guest's) into a DEAD END: locked composer, no pager,
//     every remaining match unreachable. openSaved() re-sets the flag from a restored transcript,
//     which hid this for every chat that HAS one; its two fallbacks (openStatic, sendGreeting) never
//     touched it.
//   • startFresh also forgot `pendingScopeRef` / `pendingCityRef` / `lastQueryRef` — a half-asked
//     clarifying question and the accumulated filters of the chat being abandoned, which the NEXT
//     conversation's first send() then consumes as if they were its own.
//   • New Chat forgot `afCarryRef` — the Advanced-Filter answered set whose own comment in
//     startFresh explains exactly why inheriting it is a bug.
//
// THE FIX is one shared `resetConversationState()` both exits route through, so a field added later
// is cleared for BOTH by construction instead of by memory.
//
// EXECUTED, NEVER GREPPED. §A and §B lift the REAL declarations out of src/app/agent.tsx and RUN
// them against recording stubs, so the assertions are about the code that actually runs on the
// device. §C DISCOVERS hand-written resets by shape rather than pinning a list. §D runs the real
// quotableTotal/searchIsFinishedAtThreshold against the real truncation store.tsx produces. Every
// mutation re-introduces the defect in a real copy of agent.tsx and re-lifts it.

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { liftSymbols } from "./lib/liftSymbols.ts";
import { searchIsFinishedAtThreshold } from "../src/lib/afBrowsingGate.ts";
import { INTERVIEW_STOP_AT } from "../src/lib/afRanking.ts";

const AGENT = fileURLToPath(new URL("../src/app/agent.tsx", import.meta.url));
const SEARCH = fileURLToPath(new URL("../src/data/search.ts", import.meta.url));

// src/data/search.ts uses extension-less imports Node's ESM loader rejects, so `quotableTotal` is
// LIFTED rather than imported — the real function, not a copy (scripts/lib/liftSymbols.ts exists for
// exactly this). Its `hasClientOnlyNarrowing` branch is shimmed to false: §D's fixtures all carry a
// plain `query: {}`, so that branch is never exercised here and has its own barriers elsewhere. The
// branch this file depends on — `matchTotal ?? listings.length`, the one a truncated snapshot fools —
// is the real code.
const { quotableTotal } = await liftSymbols(
  SEARCH,
  [{ header: "export function quotableTotal(r: SearchResult): number | null {" }],
  ["quotableTotal"],
  "type SearchResult = any;\nconst hasClientOnlyNarrowing = (_q: unknown) => false;\n",
) as { quotableTotal: (r: unknown) => number | null };

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (!ok) failed++;
};
const mustCatch = (label: string, caught: boolean, detail = "") =>
  check(`MUTATION — ${label}`, caught, detail);

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE CONTRACT. Every field here belongs to ONE conversation and must not survive into the next.
// `read` pulls the observed value out of the probe the lifted code wrote into; `dirty` is a value
// that is unmistakably "the previous conversation's", so a field left untouched is visibly stale.
const CONVERSATION_SCOPED = [
  { name: "completed", why: "locks the composer AND withholds the «عرض المزيد» row" },
  { name: "msgs", why: "the previous conversation's bubbles" },
  { name: "busy", why: "a spinner owned by a search that is being abandoned" },
  { name: "stopped", why: "a Stop pressed in the previous conversation" },
  { name: "chatIdRef", why: "the previous conversation's sidebar identity" },
  { name: "afCarryRef", why: "the Advanced-Filter answered set (New Chat used to inherit it)" },
  { name: "pendingScopeRef", why: "a half-answered clarifying question the next send() would consume" },
  { name: "pendingCityRef", why: "the plain-city question's subject" },
  { name: "lastQueryRef", why: "the accumulated filters the previous conversation narrowed" },
] as const;

/** Stubs the lifted declarations close over. Everything is recorded; nothing carries logic. */
const PRELUDE = `
const probe: Record<string, unknown> = {};
const calls: string[] = [];
const rec = (k: string) => (v: unknown) => { probe[k] = typeof v === "function" ? "(updater)" : v; };
const setBusy = rec("busy");
const setStopped = rec("stopped");
const setMsgs = rec("msgs");
const setCompleted = rec("completed");
const setFilterOrigin = rec("filterOrigin");
const chatIdRef = { current: "PREVIOUS-CHAT" as unknown };
const afCarryRef = { current: { msgId: "m", facets: [1], asked: ["a"] } as unknown };
const pendingScopeRef = { current: "PREVIOUS-TWIN-QUESTION" as unknown };
const pendingCityRef = { current: "الرياض" as unknown };
const lastQueryRef = { current: { location: "جدة", priceMax: 1_000_000 } as unknown };
const runRef = { current: { cancelled: false } as { cancelled: boolean } | null };
const flushPendingCapture = () => { calls.push("flushPendingCapture"); };
const finalizeReveal = () => { calls.push("finalizeReveal"); };
`;

/** Lift resetConversationState + startFresh out of a (possibly mutated) copy of agent.tsx. */
const liftFrom = async (file: string) =>
  await liftSymbols(
    file,
    [
      { header: "  const resetConversationState = () => {", endsWith: /^  \};$/ },
      { header: "    const startFresh = () => {", endsWith: /^    \};$/ },
    ],
    ["resetConversationState", "startFresh", "probe", "calls",
     "chatIdRef", "afCarryRef", "pendingScopeRef", "pendingCityRef", "lastQueryRef", "runRef"],
    PRELUDE,
  ) as Record<string, any>;

/** What is STILL the previous conversation's after running `run` on a freshly-lifted module. */
const staleAfter = async (file: string, run: (m: Record<string, any>) => void): Promise<string[]> => {
  const m = await liftFrom(file);
  run(m);
  const stale: string[] = [];
  for (const f of CONVERSATION_SCOPED) {
    const got = f.name.endsWith("Ref") ? m[f.name].current : m.probe[f.name];
    const cleared =
      f.name === "msgs" ? Array.isArray(got) && got.length === 0
      : f.name === "completed" || f.name === "busy" || f.name === "stopped" ? got === false
      : got === null;
    if (!cleared) stale.push(`${f.name}=${JSON.stringify(got)}`);
  }
  return stale;
};

// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log("── §A: the ONE shared reset clears every conversation-scoped field ──");
{
  const stale = await staleAfter(AGENT, (m) => m.resetConversationState());
  check(`resetConversationState() leaves nothing of the previous conversation behind (${CONVERSATION_SCOPED.length} fields)`,
    stale.length === 0, `still stale: ${stale.join(", ")}`);
}

console.log("\n── §B: startFresh() — the path the defect lived on — performs that same full clear ──");
{
  // This is the real conversation exit: every sidebar reopen, every «بحث» hop, every `?seed=` link
  // calls it, and the component is NOT remounted across any of them.
  const m = await liftFrom(AGENT);
  m.startFresh();
  const stale: string[] = [];
  for (const f of CONVERSATION_SCOPED) {
    const got = f.name.endsWith("Ref") ? m[f.name].current : m.probe[f.name];
    const cleared =
      f.name === "msgs" ? Array.isArray(got) && got.length === 0
      : f.name === "completed" || f.name === "busy" || f.name === "stopped" ? got === false
      : got === null;
    if (!cleared) stale.push(`${f.name}=${JSON.stringify(got)} (${f.why})`);
  }
  check("startFresh() clears the whole conversation-scoped set",
    stale.length === 0, `inherited by the next conversation: ${stale.join(" | ")}`);
  check("...and still does its own lifecycle work (flush the leaving chat, stop its reveal, cancel its run)",
    m.calls.includes("flushPendingCapture") && m.calls.includes("finalizeReveal") && m.runRef.current?.cancelled === true,
    JSON.stringify({ calls: m.calls, cancelled: m.runRef.current?.cancelled }));
  check("...and leaves `filterOrigin` to its caller (screen-instance origin, not conversation state)",
    m.probe.filterOrigin === false);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// §C's PREDICATE, as a function so it can be mutation-proven against a deliberately broken source.
//
// A hand-written reset is the shape that produced BOTH halves of this defect, so find it by WHAT IT
// DOES — clear several conversation-scoped fields together — not by where it is. Two rules keep that
// precise:
//   • a clearing write preceded by a READ of the same ref is a CONSUME, not a reset (send() reads
//     askedTwin/askedCity and nulls the ref it just took the answer from). Legitimate, never flagged.
//   • a LONE clearing write is legitimate too and is not a reset — `stop` clears `msgs` and nothing
//     else, `sendFilter` nulls `lastQueryRef` alone (kept because
//     verify-filter-stop-cancels-and-restores.ts pins a 600-char sendFilter→makeRun proximity), and
//     openStatic writes `completed` from a derived expression rather than a bare `false`.
// What is NEVER legitimate outside the shared list is a RUN of them: two or more DISTINCT
// conversation-scoped fields cleared within a dozen lines is a second copy of the list, which is
// exactly the shape that let startFresh and New Chat drift apart. Stated as a tradeoff rather than
// hidden: a future single-field omission is out of this rule's reach — §A/§B EXECUTE the real
// functions and catch it there instead.
const CLEARS: { re: RegExp; field: string }[] = [
  { re: /setCompleted\(false\)/, field: "completed" },
  { re: /setMsgs\(\[\]\)/, field: "msgs" },
  { re: /chatIdRef\.current = null/, field: "chatIdRef" },
  { re: /afCarryRef\.current = null/, field: "afCarryRef" },
  { re: /pendingScopeRef\.current = null/, field: "pendingScopeRef" },
  { re: /pendingCityRef\.current = null/, field: "pendingCityRef" },
  { re: /lastQueryRef\.current = null/, field: "lastQueryRef" },
];
const RUN_LINES = 12;

/** Sites outside resetConversationState that clear ≥2 conversation-scoped fields together. */
function handWrittenResets(src: string): { found: string[]; loneWrites: number } {
  const lines = src.split("\n");
  const resetStart = lines.findIndex((l) => l.startsWith("  const resetConversationState = () => {"));
  if (resetStart < 0) return { found: ["resetConversationState() is GONE from agent.tsx — the shared list no longer exists"], loneWrites: 0 };
  let resetEnd = resetStart;
  while (resetEnd < lines.length && lines[resetEnd] !== "  };") resetEnd++;

  const clears: { line: number; field: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i >= resetStart && i <= resetEnd) continue;          // the shared list itself
    if (/^\s*\/\//.test(lines[i])) continue;                 // a comment is not a code path
    for (const c of CLEARS) {
      if (!c.re.test(lines[i])) continue;
      const ref = c.field.endsWith("Ref") ? c.field : "";
      const consumed = !!ref && lines.slice(Math.max(0, i - 2), i)
        .some((p) => p.includes(`${ref}.current`) && !p.includes("= null"));
      if (!consumed) clears.push({ line: i + 1, field: c.field });
    }
  }
  const found: string[] = [];
  for (let i = 0; i < clears.length; i++) {
    const run = clears.filter((c) => c.line >= clears[i].line && c.line < clears[i].line + RUN_LINES);
    const distinct = new Set(run.map((c) => c.field));
    if (distinct.size < 2) continue;
    let owner = "(top level)";
    for (let j = clears[i].line - 1; j >= 0; j--) { const mm = /^  (const \w+) =/.exec(lines[j]); if (mm) { owner = mm[1]; break; } }
    found.push(`agent.tsx:${clears[i].line} inside ${owner} clears ${[...distinct].join(" + ")} by hand — route it through resetConversationState()`);
    i += run.length - 1;
  }
  return { found, loneWrites: clears.length - found.length };
}

console.log("\n── §C: no exit path re-implements the list (DISCOVERED by shape, never a pinned list) ──");
{
  const src = readFileSync(AGENT, "utf8");
  const { found, loneWrites } = handWrittenResets(src);
  check(`every conversation-exit clears state through the ONE shared reset — no second hand-written list (${loneWrites} lone writes outside it, each legitimate)`,
    found.length === 0, found.join("\n      "));
  // And the two exits really CALL it, rather than merely having stopped clearing by hand.
  const callSites = (src.match(/^\s*resetConversationState\(\);$/gm) ?? []).length;
  check("both conversation exits call resetConversationState() (startFresh + the New Chat handler)",
    callSites === 2, `found ${callSites}`);
}

console.log("\n── §D: with no transcript to restore from, terminality is DERIVED — never inherited ──");
{
  // openSaved's fallbacks have no `completed` to restore, so they re-derive it from the results they
  // render. The guard that makes that honest is `matchTotal != null`: store.tsx's recordHistory
  // TRUNCATES a snapshot to SNAPSHOT_CAP=20 cards, and quotableTotal falls back to `listings.length`
  // when no total was recorded — so without the guard a 20-card slice of a 9,892-match search reads
  // as "≤50, finished" and locks the chat, the same dead end rebuilt out of its own fix.
  //
  // WHY THE GUARD IS ON THE TOTAL AND NOT ON `hasMore` — this barrier caught that first draft. The
  // truncation stamps `hasMore: true` on EVERY snapshot it shortens, including a genuinely ≤50 chat
  // that merely had more than 20 cards, so a `!hasMore` guard silently threw away the owner's
  // 2026-08-30 lock for the 21..50-match band. `matchTotal` survives the truncation (it rides the
  // `...result` spread), so the honest total is available whenever it was ever known. Real functions,
  // real truncation shape, real boundaries.
  const SNAPSHOT_CAP = 20;
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ source: "aqar", id: `L${i}` }));
  /** Exactly what store.tsx::recordHistory persists for a result of `total` matches. */
  const snapshotOf = (total: number, recordTotal = true) => {
    const result = {
      listings: rows(Math.min(total, 500)),
      ...(recordTotal ? { matchTotal: total } : {}),
      hasMore: total > 500, pageOffset: 0, query: {},
    } as { listings: unknown[]; matchTotal?: number; hasMore: boolean; pageOffset: number; query: unknown };
    return result.listings.length > SNAPSHOT_CAP
      ? { ...result, listings: result.listings.slice(0, SNAPSHOT_CAP), pageOffset: 0, hasMore: true }
      : result;
  };
  /** The predicate openStatic's snapshot branch uses, over the REAL helpers. */
  const terminal = (s: ReturnType<typeof snapshotOf>) =>
    s.matchTotal != null && searchIsFinishedAtThreshold(quotableTotal(s as never), INTERVIEW_STOP_AT);

  check("a genuinely small saved chat (12 matches, untruncated) reopens LOCKED — owner rule 2026-08-30 untouched",
    terminal(snapshotOf(12)) === true);
  check(`a ${SNAPSHOT_CAP + 1}-match saved chat — TRUNCATED, still ≤${INTERVIEW_STOP_AT} — reopens LOCKED (the band a \`!hasMore\` guard would have lost)`,
    terminal(snapshotOf(SNAPSHOT_CAP + 1)) === true);
  check(`a ${INTERVIEW_STOP_AT}-match saved chat (exactly the threshold) reopens LOCKED`,
    terminal(snapshotOf(INTERVIEW_STOP_AT)) === true);
  check(`one past the threshold (${INTERVIEW_STOP_AT + 1}) reopens BROWSABLE, not locked`,
    terminal(snapshotOf(INTERVIEW_STOP_AT + 1)) === false);
  for (const n of [340, 9_892, 37_495]) {
    const s = snapshotOf(n);
    check(`a ${n.toLocaleString("en-US")}-match saved chat is truncated to ${s.listings.length} cards and is NOT read as finished`,
      terminal(s) === false, JSON.stringify({ kept: s.listings.length, quotable: quotableTotal(s as never) }));
  }
  // A snapshot with no recorded total cannot PROVE terminality, so it must not claim it — the
  // unknown→NO direction this repo bans, applied to the composer lock.
  check("a snapshot that never recorded a total is never read as finished (unknown is not a No)",
    terminal(snapshotOf(9_892, false)) === false && terminal(snapshotOf(12, false)) === false);
}

console.log("\n── mutation proofs — each re-introduces the REAL defect in a real copy of agent.tsx ──");
/** Write a deliberately broken copy of agent.tsx and return its path. */
const mutantAgent = (from: string, to: string): string => {
  const src = readFileSync(AGENT, "utf8");
  if (!src.includes(from)) throw new Error(`mutation anchor missing in agent.tsx:\n${from}`);
  if (src.split(from).length !== 2) throw new Error(`mutation anchor is not unique in agent.tsx:\n${from}`);
  const out = join(mkdtempSync(join(tmpdir(), "ezhalah-conv-mut-")), "agent.tsx");
  writeFileSync(out, src.replace(from, to));
  return out;
};
{
  // THE DEFECT AS IT SHIPPED, half one: startFresh does not clear `completed`.
  const f = mutantAgent(
    "    setCompleted(false);      // terminality is per-conversation",
    "    // setCompleted(false);   // terminality is per-conversation",
  );
  const stale = await staleAfter(f, (m) => m.startFresh());
  mustCatch("M-completed — startFresh forgetting `completed` carries the previous chat's LOCK onto the next one",
    stale.some((s) => s.startsWith("completed=")), `stale: ${stale.join(", ")}`);
}
{
  // THE DEFECT AS IT SHIPPED, half two: a half-asked question and the accumulated filters of the
  // abandoned chat survive, and the next conversation's first send() consumes them as its own.
  const f = mutantAgent(
    "    pendingCityRef.current = null;  // …including the plain-city question's subject",
    "    // pendingCityRef.current = null;",
  );
  const stale = await staleAfter(f, (m) => m.startFresh());
  mustCatch("M-pending — a clarifying question left half-asked leaks into the next conversation",
    stale.some((s) => s.startsWith("pendingCityRef=")), `stale: ${stale.join(", ")}`);
}
{
  // The regression that removes the fix wholesale: startFresh stops routing through the shared list.
  const f = mutantAgent("      resetConversationState();\n      setFilterOrigin(false);", "      setMsgs([]);\n      setFilterOrigin(false);");
  const stale = await staleAfter(f, (m) => m.startFresh());
  mustCatch("M-unrouted — startFresh re-implementing its own reset leaves the conversation behind",
    stale.length >= 4, `stale: ${stale.join(", ")}`);
}
{
  // §C's own predicate, fed a source that contains exactly the shape it exists to find: a second
  // hand-written reset. Without this, §C would be a rule nobody has watched fire.
  const src = readFileSync(AGENT, "utf8");
  const injected = src.replace(
    "      resetConversationState();\n      setFilterOrigin(false);",
    "      setMsgs([]);\n      setCompleted(false);\n      chatIdRef.current = null;\n      afCarryRef.current = null;\n      setFilterOrigin(false);",
  );
  const { found } = handWrittenResets(injected);
  mustCatch("M-second-list — a hand-written reset re-appearing in a conversation exit is DISCOVERED, not waved through",
    found.length === 1 && found[0].includes("by hand"), JSON.stringify(found));
  // …and the rule does not fire on the tree as it stands, so the mutation above proves discrimination
  // rather than a predicate that flags everything.
  check("…and the same predicate reports the real tree clean (the mutation proves discrimination, not noise)",
    handWrittenResets(src).found.length === 0);
}
{
  // The guard that keeps §D honest, in BOTH directions.
  // (a) Drop `matchTotal != null` and a truncated 20-card buffer of a search whose total was never
  //     recorded reads as a finished ≤50 set — the dead end rebuilt out of its own fix.
  const noTotal = { listings: Array.from({ length: 20 }, (_, i) => ({ source: "aqar", id: `L${i}` })), hasMore: true, pageOffset: 0, query: {} };
  mustCatch("M-untotalled — without the `matchTotal != null` guard a 20-card slice reads as a finished ≤50 chat and locks it",
    searchIsFinishedAtThreshold(quotableTotal(noTotal as never), INTERVIEW_STOP_AT) === true,
    `quotableTotal=${quotableTotal(noTotal as never)}`);
  // (b) The guard this file REJECTED in review: `!hasMore` throws the owner's lock away for every
  //     ≤50 chat that merely had more than 20 cards, because truncation always stamps hasMore true.
  const small = { listings: Array.from({ length: 20 }, (_, i) => ({ source: "aqar", id: `L${i}` })), matchTotal: 34, hasMore: true, pageOffset: 0, query: {} };
  mustCatch("M-hasmore-guard — guarding on `!hasMore` instead would unlock a genuine 34-match chat (owner rule 2026-08-30)",
    (!small.hasMore && searchIsFinishedAtThreshold(quotableTotal(small as never), INTERVIEW_STOP_AT)) === false
    && (small.matchTotal != null && searchIsFinishedAtThreshold(quotableTotal(small as never), INTERVIEW_STOP_AT)) === true);
}

if (failed) { console.error(`\n✗ ${failed} check(s) FAILED`); process.exit(1); }
console.log("\nOK — conversation-scoped state is cleared through one shared list, and terminality is derived or restored, never inherited");
