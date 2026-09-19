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
//
// `kind` says WHERE the observed value is read from — a `setX` probe, a ref's `.current`, or (for a
// generation token) the ref's value compared against what it was BEFORE the reset ran. `cleared`
// is the per-field predicate. Both replaced a name-suffix heuristic (`endsWith("Ref") ? … : …`) that
// could only express "null or false or []" and would have silently mis-judged the two fields added
// on 2026-09-18 whose cleared value is neither (`askCountRef` → 0, `ageFlowTokenRef` → *incremented*).
const CONVERSATION_SCOPED = [
  { name: "completed", kind: "probe", cleared: (v: any) => v === false, why: "locks the composer AND withholds the «عرض المزيد» row" },
  { name: "msgs", kind: "probe", cleared: (v: any) => Array.isArray(v) && v.length === 0, why: "the previous conversation's bubbles" },
  { name: "busy", kind: "probe", cleared: (v: any) => v === false, why: "a spinner owned by a search that is being abandoned" },
  { name: "stopped", kind: "probe", cleared: (v: any) => v === false, why: "a Stop pressed in the previous conversation" },
  { name: "ageFlow", kind: "probe", cleared: (v: any) => v === null, why: "the guided AF card the abandoned conversation had open" },
  { name: "chatIdRef", kind: "ref", cleared: (v: any) => v === null, why: "the previous conversation's sidebar identity" },
  { name: "afCarryRef", kind: "ref", cleared: (v: any) => v === null, why: "the Advanced-Filter answered set (New Chat used to inherit it)" },
  { name: "pendingScopeRef", kind: "ref", cleared: (v: any) => v === null, why: "a half-answered clarifying question the next send() would consume" },
  { name: "pendingCityRef", kind: "ref", cleared: (v: any) => v === null, why: "the plain-city question's subject" },
  { name: "lastQueryRef", kind: "ref", cleared: (v: any) => v === null, why: "the accumulated filters the previous conversation narrowed" },
  // ── added 2026-09-18, ops_incident #319: the rest of what send() consumes, and the second token ──
  { name: "pendingRefineRef", kind: "ref", cleared: (v: any) => v === null,
    why: "a pending «نتائج أدق» question — send()'s REFINE INTERCEPT reads it BEFORE recordChatTurn and returns, so the next conversation's FIRST message is swallowed into the abandoned chat's query" },
  { name: "refineMsgIdRef", kind: "ref", cleared: (v: any) => v === null, why: "the results turn the abandoned refine round was building into" },
  { name: "saidRef", kind: "ref", cleared: (v: any) => Array.isArray(v) && v.length === 0,
    why: "everything the user said in the conversation being left, sent to the agent as `attemptTexts`" },
  { name: "askCountRef", kind: "ref", cleared: (v: any) => v === 0, why: "the abandoned conversation's question budget" },
  { name: "ageFlowTokenRef", kind: "token", cleared: (v: any, before: any) => v > before,
    why: "the guided/AF cancellation token — NOT bumped, an in-flight round from the abandoned chat keeps calling setCompleted / startAgeFlow / re-arming afCarryRef" },
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
const setAgeFlow = rec("ageFlow");
const chatIdRef = { current: "PREVIOUS-CHAT" as unknown };
const pendingRefineRef = { current: { q: { location: "جدة" }, dim: "budget" } as unknown };
const refineMsgIdRef = { current: "PREVIOUS-RESULTS-TURN" as unknown };
const saidRef = { current: ["شقة", "بالقرب من البحر"] as unknown };
const askCountRef = { current: 3 as unknown };
const ageFlowTokenRef = { current: 7 };
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
     "chatIdRef", "afCarryRef", "pendingScopeRef", "pendingCityRef", "lastQueryRef", "runRef",
     "pendingRefineRef", "refineMsgIdRef", "saidRef", "askCountRef", "ageFlowTokenRef"],
    PRELUDE,
  ) as Record<string, any>;

/** The observed value of one contract field on a lifted module. */
const observe = (m: Record<string, any>, f: (typeof CONVERSATION_SCOPED)[number]) =>
  f.kind === "probe" ? m.probe[f.name] : m[f.name].current;

/**
 * What is STILL the previous conversation's after running `run` on a freshly-lifted module.
 * Values are snapshotted BEFORE `run` so a generation token can be judged on whether it MOVED —
 * a token is cancelled by being incremented, never by being nulled.
 */
const staleAfter = async (file: string, run: (m: Record<string, any>) => void): Promise<string[]> => {
  const m = await liftFrom(file);
  const before = new Map(CONVERSATION_SCOPED.map((f) => [f.name, observe(m, f)]));
  run(m);
  const stale: string[] = [];
  for (const f of CONVERSATION_SCOPED) {
    const got = observe(m, f);
    if (!(f.cleared as (v: any, b: any) => boolean)(got, before.get(f.name))) {
      stale.push(`${f.name}=${JSON.stringify(got)}`);
    }
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
  const before = new Map(CONVERSATION_SCOPED.map((f) => [f.name, observe(m, f)]));
  m.startFresh();
  const stale: string[] = [];
  for (const f of CONVERSATION_SCOPED) {
    const got = observe(m, f);
    if (!(f.cleared as (v: any, b: any) => boolean)(got, before.get(f.name))) {
      stale.push(`${f.name}=${JSON.stringify(got)} (${f.why})`);
    }
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

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// §E — THE CLASS, CLOSED (routine #8, 2026-09-18, ops_incident #319).
//
// §A/§B execute the real reset, but only against the contract list above — and THAT LIST IS ITSELF
// HAND-MAINTAINED. That is the whole class: on 2026-09-12 the hand-written thing was a projection,
// on 2026-09-14 it was two reset functions, and consolidating them to one left a third hand-written
// enumeration doing the same job. A field added to agent.tsx tomorrow and not added here would sail
// through §A, §B and §C exactly as `pendingRefineRef` did for three months.
//
// So the contract stops being a list and becomes a DERIVATION from the code itself, in the safe
// direction — anything new is RED until it is either cleared or declared:
//
//   E1. Every `*Ref` that `send()` READS is conversation-scoped unless declared otherwise, because
//       send() is the first thing the next conversation does. A ref it consumes and the reset does
//       not clear is, by construction, the previous conversation speaking through the new one.
//   E2. Every generation token (`useRef(0)`) is a cancellation mechanism; conversation exit must
//       invalidate it or say why not. This is the half that made the state-clearing non-durable:
//       ageFlowTokenRef gated timers that re-armed `afCarryRef` AFTER the reset nulled it.
//
// Each exemption carries a reason, and the reason is an assertion this file also checks.
const TURN_SCOPED_EXEMPT: Record<string, string> = {
  runRef: "the in-flight turn itself — startFresh cancels it explicitly (runRef.current.cancelled = true); §B asserts that, so it is covered, not excused",
  pinModeRef: "presentational scroll anchoring only; send() OVERWRITES it unconditionally before any read, so nothing of the previous conversation can be observed through it",
};
const TOKEN_EXEMPT: Record<string, string> = {
  voiceStopGenRef: "mic-recording scoped, not conversation scoped: it is bumped by its own start/stop transitions and gates only the 'processing' beat of a recording the user is holding",
  askCountRef: "not a cancellation token despite its useRef(0) shape — it is a counter, and it is in the CONVERSATION_SCOPED contract above (cleared to 0)",
};

/** E1 + E2 over a source text, as a predicate so it can be mutation-proven. */
function uncoveredConversationState(src: string): string[] {
  const lines = src.split("\n");
  const body = (header: string): string => {
    const i = lines.findIndex((l) => l.startsWith(header));
    if (i < 0) throw new Error(`§E cannot find ${header.trim()} in agent.tsx`);
    const indent = header.match(/^\s*/)![0];
    let j = i + 1;
    while (j < lines.length && lines[j] !== `${indent}};`) j++;
    return lines.slice(i, j + 1).join("\n");
  };
  const sendBody = body("  const send = async (override?: string) => {");
  // Comments are stripped before asking whether the reset WRITES a field: this block is heavily
  // commented, and several comments name the very refs being checked (they explain what used to go
  // wrong with them). Without this, commenting a clear OUT would still read as writing it — which is
  // precisely the regression M-E1-unwritten reproduces, and it is how this check first passed vacuously.
  const resetBody = body("  const resetConversationState = () => {")
    .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  const contract = new Set(CONVERSATION_SCOPED.map((f) => f.name));
  const problems: string[] = [];

  // E1 — refs send() consumes.
  const consumed = [...new Set([...sendBody.matchAll(/\b(\w+Ref)\.current/g)].map((m) => m[1]))].sort();
  for (const r of consumed) {
    if (contract.has(r) || r in TURN_SCOPED_EXEMPT) continue;
    problems.push(
      `E1 ${r}: send() reads it, so the next conversation's FIRST message can see the previous one's value, ` +
      `but it is neither in resetConversationState()'s contract nor declared turn-scoped in TURN_SCOPED_EXEMPT ` +
      `(this is exactly how pendingRefineRef/saidRef/askCountRef survived the 2026-09-14 consolidation)`);
  }
  // …and a contract field is only really covered if the REAL reset touches it. §A executes that; this
  // catches the cheaper failure of adding a name here and nowhere else.
  for (const f of CONVERSATION_SCOPED) {
    if (f.kind === "probe") continue;
    if (!new RegExp(`\\b${f.name}\\.current\\s*(=|\\+\\+)`).test(resetBody)) {
      problems.push(`E1 ${f.name}: declared in this file's contract but resetConversationState() never writes it`);
    }
  }
  // E2 — generation tokens.
  for (const m of src.matchAll(/^\s*const (\w+) = useRef\(0\);/gm)) {
    const t = m[1];
    if (t in TOKEN_EXEMPT) continue;
    if (!new RegExp(`\\b${t}\\.current\\+\\+|\\b\\+\\+${t}\\.current`).test(resetBody)) {
      problems.push(
        `E2 ${t}: a generation token that conversation exit does not invalidate and TOKEN_EXEMPT does not declare — ` +
        `in-flight work from the ABANDONED conversation can still write into the new one`);
    }
  }
  // E3 — THE EXEMPTIONS THEMSELVES ARE CLAIMS, SO EXECUTE THEM. Without this, a future exemption
  // could retire a real ref from E1/E2 by asserting something false in a comment, and the comment
  // would read as coverage — the exact shape this repo names "a pointer reads as coverage"
  // (docs/ops/BARRIER_ENGINEER.md PART 1.11). `runRef`'s reason is discharged by §B, which watches
  // startFresh actually cancel it; `askCountRef`'s by §A/§B, which execute the contract it names.
  // The other two claim properties of the source, so they are checked here.
  const firstPinLine = sendBody.split("\n").find((l) => l.includes("pinModeRef.current") && !/^\s*\/\//.test(l));
  if (firstPinLine !== undefined && !/^\s*pinModeRef\.current\s*=[^=]/.test(firstPinLine)) {
    problems.push(
      `E3 pinModeRef: TURN_SCOPED_EXEMPT claims send() OVERWRITES it before any read, but send()'s first ` +
      `use of it is a READ (${firstPinLine.trim()}) — the exemption no longer holds and it must move into the contract`);
  }
  // voiceStopGenRef's exemption rests on it invalidating ITSELF at every transition of the recording
  // it belongs to. That is a shrink-only floor, not a proof: it says the self-invalidation has not
  // been REDUCED since the exemption was granted — 5 sites: mic start, stop, the X-wins path, cancel
  // and unmount. It deliberately claims no more than that. If a site disappears, the exemption has to
  // be re-argued rather than silently inherited.
  //
  // The 5 is MEASURED, not eyeballed. A first draft set it to 4 from reading the greps, and
  // M-E3-voice stayed green while the mutation it exists to catch went through — a floor above the
  // real count is a check that cannot fail.
  const VOICE_BUMP_FLOOR = 5;
  const voiceBumps = (src.match(/voiceStopGenRef\.current\+\+|\+\+voiceStopGenRef\.current/g) ?? []).length;
  if (voiceBumps < VOICE_BUMP_FLOOR) {
    problems.push(
      `E3 voiceStopGenRef: TOKEN_EXEMPT claims it is invalidated by its own recording transitions, but ` +
      `${voiceBumps} bump site(s) remain of the ${VOICE_BUMP_FLOOR} that justified the exemption — ` +
      `re-argue it or let conversation exit invalidate the token`);
  }
  return problems;
}

console.log("\n── §E: the contract is DERIVED from send() and from the token declarations, not listed ──");
{
  const src = readFileSync(AGENT, "utf8");
  const problems = uncoveredConversationState(src);
  check(`every ref send() consumes is cleared or declared, and every generation token is invalidated or declared (${Object.keys(TURN_SCOPED_EXEMPT).length} + ${Object.keys(TOKEN_EXEMPT).length} declared exemptions, each with a reason)`,
    problems.length === 0, problems.join("\n      "));
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

{
  // THE DEFECT AS IT SHIPPED (ops_incident #319, live on main until 2026-09-18): the reset never
  // cleared `pendingRefineRef`, so with a «نتائج أدق» question unanswered in the chat being left,
  // send()'s REFINE INTERCEPT swallowed the NEXT conversation's first message — before
  // recordChatTurn, so no sidebar entry was created either, and the agent was never called.
  const f = mutantAgent(
    "    pendingRefineRef.current = null; // a «نتائج أدق» question dies with the conversation that asked it",
    "    // pendingRefineRef.current = null;",
  );
  const stale = await staleAfter(f, (m) => m.startFresh());
  mustCatch("M-refine — a pending «نتائج أدق» question surviving the exit hijacks the next conversation's first message",
    stale.some((s) => s.startsWith("pendingRefineRef=")), `stale: ${stale.join(", ")}`);
}
{
  // The second half, and the reason clearing alone was never enough: the guided round's OWN token.
  // Un-bumped, timers from the abandoned conversation keep running — they call setCompleted(true)
  // and RE-ARM afCarryRef, undoing the reset a few lines after it ran.
  const f = mutantAgent(
    "    ageFlowTokenRef.current++;      // every in-flight guided continuation is now superseded",
    "    // ageFlowTokenRef.current++;",
  );
  const stale = await staleAfter(f, (m) => m.startFresh());
  mustCatch("M-token — an un-bumped guided token lets the abandoned conversation's in-flight round write into the new one",
    stale.some((s) => s.startsWith("ageFlowTokenRef=")), `stale: ${stale.join(", ")}`);
}
{
  // §E1 is the part that has to survive ME: a ref added to send() next month, by someone who never
  // reads this file, must be RED rather than silently uncovered. Fed a source where exactly that
  // happened.
  const src = readFileSync(AGENT, "utf8");
  const injected = src.replace(
    "  const send = async (override?: string) => {",
    "  const send = async (override?: string) => {\n    const _leak = someBrandNewRef.current;",
  );
  const problems = uncoveredConversationState(injected);
  mustCatch("M-E1-new-ref — a ref added to send() that the reset does not clear is DISCOVERED, not waved through",
    problems.some((p) => p.startsWith("E1 someBrandNewRef")), JSON.stringify(problems));
}
{
  // §E1's other direction: a name added to this file's contract with no matching write in the real
  // reset. Without this, the contract could be satisfied by editing the barrier alone.
  const src = readFileSync(AGENT, "utf8");
  const injected = src.replace(
    "    pendingRefineRef.current = null; // a «نتائج أدق» question dies with the conversation that asked it",
    "    // pendingRefineRef.current = null;",
  );
  const problems = uncoveredConversationState(injected);
  mustCatch("M-E1-unwritten — a contract field the real resetConversationState() never writes is reported",
    problems.some((p) => p.startsWith("E1 pendingRefineRef") && p.includes("never writes it")), JSON.stringify(problems));
}
{
  // §E2: a new cancellation token, the shape that made the state-clearing non-durable.
  const src = readFileSync(AGENT, "utf8");
  const injected = src.replace(
    "  const ageFlowTokenRef = useRef(0);",
    "  const ageFlowTokenRef = useRef(0);\n  const someNewFlowTokenRef = useRef(0);",
  );
  const problems = uncoveredConversationState(injected);
  mustCatch("M-E2-new-token — a new generation token nothing invalidates on conversation exit is DISCOVERED",
    problems.some((p) => p.startsWith("E2 someNewFlowTokenRef")), JSON.stringify(problems));

  // §E3 — the exemptions are claims, so the claims are executed. These two mutations are the reason
  // the sentence "each exemption's reason is an assertion this file also checks" is true rather than
  // decorative: break what an exemption asserts and the exemption stops being granted.
  // Mutated INSIDE send() specifically — `pinModeRef.current = 'bottom';` also appears in the
  // land-timer block far above it, and a whole-source replace hits that one instead, leaving send()
  // untouched and the mutation silently vacuous. (It did, on the first run of this proof.)
  const sendAt = src.indexOf("  const send = async (override?: string) => {");
  const pinAt = src.indexOf("    pinModeRef.current = 'bottom';", sendAt);
  const pinRead = src.slice(0, pinAt)
    + "    if (pinModeRef.current === 'top') toTop();"   // now send() READS it first
    + src.slice(pinAt + "    pinModeRef.current = 'bottom';".length);
  mustCatch("M-E3-pin — if send() ever READ pinModeRef before writing it, its exemption is withdrawn",
    uncoveredConversationState(pinRead).some((p) => p.startsWith("E3 pinModeRef")),
    JSON.stringify(uncoveredConversationState(pinRead)));

  const voiceStuck = src.replace(/voiceStopGenRef\.current\+\+/, "/* no bump */");
  mustCatch("M-E3-voice — if voiceStopGenRef's self-invalidation shrinks below the floor that justified its exemption, the exemption is withdrawn",
    uncoveredConversationState(voiceStuck).some((p) => p.startsWith("E3 voiceStopGenRef")),
    JSON.stringify(uncoveredConversationState(voiceStuck)));
  // …and the same predicate reports the real tree clean, so the three mutations above prove
  // discrimination rather than a rule that flags everything.
  check("…and §E reports the real tree clean (the mutations prove discrimination, not noise)",
    uncoveredConversationState(src).length === 0, uncoveredConversationState(src).join(" | "));
}

// §F — THE POPULATION OF CONVERSATION EXITS IS DISCOVERED, NEVER COUNTED
// (routine #8, 2026-09-19, ops_incident #341 — the §C follow-up, found by re-attacking §E's own fix.)
//
// §C closes with `callSites === 2`. That counts CALLS TO the shared reset, and the invariant this
// whole file exists for is "every conversation EXIT routes through it". The two propositions come
// apart in exactly the direction that matters: an exit that calls nothing leaves the count at 2, so
// that check stays green. §C's other half — handWrittenResets() — only fires on a RUN of >= 2
// distinct fields from CLEARS within RUN_LINES, so an exit that replaces the transcript and clears
// nothing else from that list is invisible to BOTH halves. It is silently counted as one of the
// "lone writes … each legitimate".
//
// That is the same shape as the three recurrences above, one level up: §E stopped the CONTRACT being
// a hand-written list, and left the POPULATION IT IS APPLIED TO a hand-written number. Measured on
// main at 91f9d6c it is not hypothetical — `stop()`'s filter-origin branch (agent.tsx:1257) replaces
// the transcript with `setMsgs([])` and routes through nothing, while its own comment claims the next
// bare /agent "greets fresh, exactly like any other new chat".
//
// So the population stops being a number and becomes a DERIVATION. A conversation exit is discovered
// BY SHAPE — a site that REPLACES the message list (`setMsgs(<value>)`) rather than appending to it
// (`setMsgs(updater)`) — and every one must be registered below with its kind. A site added tomorrow
// is RED until someone classifies it, which is the one thing `callSites === 2` could never do.
//
// `unadjudicated` is NOT a waiver. It records an exit whose need for the reset is a real open
// question (stop() navigates AWAY from /agent, so whether its refs survive depends on whether the
// screen unmounts — undetermined from a static read, and the honest state per §G.9). It is bounded
// by a SHRINK-ONLY ceiling, so the count can fall and never rise.
type ExitKind = "shared-reset" | "after-reset" | "unadjudicated";
const EXIT_REGISTRY: Record<string, { kind: ExitKind; why: string }> = {
  resetConversationState: {
    kind: "shared-reset",
    why: "the shared list itself — this IS the reset every other exit is required to route through",
  },
  openSaved: {
    kind: "after-reset",
    why: "a RESTORE, not an exit: it writes the transcript of the conversation being ENTERED, and is called only at agent.tsx:3079, immediately after startFresh() → resetConversationState() on the line above it",
  },
  openStatic: {
    kind: "after-reset",
    why: "openSaved's fallback (agent.tsx:2892) when there is no saved transcript to restore — same position downstream of startFresh() → resetConversationState(), and it DERIVES terminality rather than inheriting it",
  },
  stop: {
    kind: "unadjudicated",
    why: "ops_incident #341 — the filter-origin branch erases the transcript and router.replace('/')s away without routing through resetConversationState(). Whether the conversation-scoped refs survive depends on whether the agent screen unmounts on that navigation, which a static read cannot settle. Registered so it cannot be forgotten, NOT excused.",
  },
};
const UNADJUDICATED_CEILING = 1; // shrink-only — a new unadjudicated exit is RED

/** Every site that REPLACES the transcript, with the top-level declaration that owns it. */
function conversationExits(src: string): { line: number; owner: string }[] {
  const lines = src.split("\n");
  const out: { line: number; owner: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*\/\//.test(l)) continue;                 // a comment is not a code path
    if (!/setMsgs\(/.test(l)) continue;
    if (/setMsgs\(\s*\(/.test(l)) continue;           // setMsgs((m) => …) APPENDS — not an exit
    let owner = "(top level)";
    for (let j = i; j >= 0; j--) { const m = /^  (?:const|function) (\w+)\b/.exec(lines[j]); if (m) { owner = m[1]; break; } }
    out.push({ line: i + 1, owner });
  }
  return out;
}

/** §F's verdict over a source text, as a predicate so it can be mutation-proven. */
function unregisteredExits(src: string): string[] {
  const problems: string[] = [];
  const exits = conversationExits(src);
  if (exits.length === 0) problems.push("F0: no transcript-replacing site found at all — the discovery shape has stopped matching agent.tsx");
  const owners = [...new Set(exits.map((e) => e.owner))];
  for (const o of owners) {
    if (!EXIT_REGISTRY[o])
      problems.push(`F1 ${o}: replaces the transcript (a conversation exit by shape) but is not in EXIT_REGISTRY — classify it, and route it through resetConversationState() unless you can say why not`);
  }
  const unadjudicated = owners.filter((o) => EXIT_REGISTRY[o]?.kind === "unadjudicated");
  if (unadjudicated.length > UNADJUDICATED_CEILING)
    problems.push(`F2: ${unadjudicated.length} unadjudicated conversation exits (${unadjudicated.join(", ")}) against a shrink-only ceiling of ${UNADJUDICATED_CEILING}`);
  // F3 — the one registry claim that is cheaply EXECUTABLE: the `shared-reset` entry must really sit
  // inside resetConversationState()'s own body. If the reset stops replacing the transcript, every
  // "after-reset" justification below it is standing on nothing.
  const lines = src.split("\n");
  const s = lines.findIndex((l) => l.startsWith("  const resetConversationState = () => {"));
  let e = s;
  while (e < lines.length && lines[e] !== "  };") e++;
  const sharedInside = s >= 0 && exits.some((x) => x.owner === "resetConversationState" && x.line > s && x.line <= e + 1);
  if (!sharedInside)
    problems.push("F3 resetConversationState: registered as the shared-reset exit but its body no longer replaces the transcript — the 'after-reset' entries' justification is void");
  return problems;
}

console.log("\n── §F: the POPULATION of conversation exits is discovered by shape, never counted ──");
{
  const src = readFileSync(AGENT, "utf8");
  const exits = conversationExits(src);
  const owners = [...new Set(exits.map((e) => e.owner))];
  check(`every transcript-replacing site is a CLASSIFIED conversation exit (${exits.length} sites, ${owners.length} owners: ${owners.join(", ")})`,
    unregisteredExits(src).length === 0, unregisteredExits(src).join("\n      "));

  // M-F1 — a NEW exit that routes through nothing is exactly what `callSites === 2` could not see.
  // Injected as a sibling top-level declaration that wipes the transcript and calls nothing.
  const anchor = "  const resetConversationState = () => {";
  const injected = src.replace(anchor,
    "  const abandonConversation = () => {\n    setMsgs([]);\n  };\n" + anchor);
  mustCatch("M-F1-new-exit — a new conversation exit that replaces the transcript and routes through NOTHING is DISCOVERED",
    unregisteredExits(injected).some((p) => p.startsWith("F1 abandonConversation")),
    JSON.stringify(unregisteredExits(injected)));

  // M-F1b — and the SAME injection in appending form must NOT be flagged, so §F discriminates an
  // exit from an ordinary in-conversation append rather than flagging every setMsgs in the file.
  const appender = src.replace(anchor,
    "  const appendNotice = () => {\n    setMsgs((m) => [...m, { id: 'x' }]);\n  };\n" + anchor);
  check("…and the same site in APPENDING form (setMsgs(updater)) is NOT flagged — §F separates an exit from an append",
    unregisteredExits(appender).length === 0, unregisteredExits(appender).join(" | "));

  // M-F3 — if the shared reset stops wiping the transcript, every "after-reset" entry is unfounded
  // and §F must say so rather than keep granting them.
  const resetAt = src.indexOf(anchor);
  const wipeAt = src.indexOf("    setMsgs([]);", resetAt);
  const gutted = src.slice(0, wipeAt) + "    /* no wipe */" + src.slice(wipeAt + "    setMsgs([]);".length);
  mustCatch("M-F3-shared-reset-gutted — if resetConversationState() stops replacing the transcript, the after-reset justifications are withdrawn",
    unregisteredExits(gutted).some((p) => p.startsWith("F3 resetConversationState")),
    JSON.stringify(unregisteredExits(gutted)));

  // …and the predicate reports the real tree clean, so the mutations prove discrimination, not noise.
  check("…and §F reports the real tree clean (the mutations prove discrimination, not noise)",
    unregisteredExits(src).length === 0, unregisteredExits(src).join(" | "));
}

if (failed) { console.error(`\n✗ ${failed} check(s) FAILED`); process.exit(1); }
console.log("\nOK — conversation-scoped state is cleared through one shared list, and terminality is derived or restored, never inherited");
