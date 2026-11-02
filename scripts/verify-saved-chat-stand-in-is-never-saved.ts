// A SAVED CHAT'S STAND-IN IS NEVER SAVED OVER THE CHAT (owner 2026-10-23).
//
// The owner's report: «when i click on the side» a saved Hofuf search showed only «… I'm looking for
// residential property to buy in Hofuf» and no results, every time, while the server still held the
// whole conversation (user + results, 31 cards).
//
// Root cause: openSaved() (src/app/agent.tsx) paints a STAND-IN while it downloads a chat this device
// does not hold — just the user's question, a snapshot, or a stale local copy — so the screen is never
// blank. The capture effect saves whatever is on screen 600 ms after it changes. On a slow phone the
// download took longer than that, so the stand-in («question only») was saved as the chat's transcript,
// locally and to the server queue. From then on the local copy was "fresh", openSaved never asked the
// server again, and the chat opened with only the question, forever.
//
// The rule this pins: while openSaved() is downloading chat X, nothing is captured for X. The guard is
// raised BEFORE any stand-in paints and lowered only AFTER the download settles; the capture effect
// refuses that id while it is raised.
//
//   node --experimental-strip-types scripts/verify-saved-chat-stand-in-is-never-saved.ts   (runs by existence)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/[^\n'"`]*$/gm, '');
const real = strip(readFileSync(join(root, 'src', 'app', 'agent.tsx'), 'utf8'));

type Verdict = { ok: boolean; why: string }[];

function judge(src: string): Verdict {
  const out: Verdict = [];
  const add = (ok: boolean, why: string) => out.push({ ok, why });

  add(/const hydratingIdRef = useRef<string \| null>\(null\);/.test(src), 'the download guard exists (hydratingIdRef)');

  // Capture effect: the early return for the downloading id sits BEFORE serialize/stash/save.
  const cap = src.match(/useEffect\(\(\) => \{\s*const id = chatIdRef\.current;[\s\S]*?\}, \[busy, msgs, revealCount, afReceipt, guidedPills, completed, afCanNarrow\]\);/)?.[0] ?? '';
  add(cap.length > 0, 'the capture effect is found');
  const guardAt = cap.indexOf('if (hydratingIdRef.current === id) return;');
  const stashAt = cap.indexOf('pendingCaptureRef.current = {');
  const saveAt = cap.indexOf('saveTranscript(');
  add(guardAt >= 0 && stashAt > guardAt && saveAt > guardAt, 'the capture effect refuses the downloading chat before it stages or saves anything');

  // openSaved: the guard goes up before the first stand-in paint and comes down only after the await.
  const open = src.match(/const openSaved = async \([\s\S]*?\n  const openStatic = async/)?.[0] ?? '';
  add(open.length > 0, 'openSaved is found');
  const block = open.match(/if \(!t && entryId\) \{[\s\S]*?\n    \}\n/)?.[0] ?? '';
  add(block.length > 0, 'the download block in openSaved is found');
  const raise = block.indexOf('hydratingIdRef.current = entryId;');
  const paints = ['setMsgs(', 'openStatic(', 'restoreChat('].map((k) => block.indexOf(k)).filter((i) => i >= 0);
  add(raise >= 0 && paints.length > 0 && paints.every((i) => i > raise), 'the guard is raised before ANY stand-in is painted');
  const awaitAt = block.indexOf('await hydrateTranscript(entryId)');
  const lower = block.indexOf('if (hydratingIdRef.current === entryId) hydratingIdRef.current = null;');
  add(awaitAt >= 0 && lower > awaitAt, 'the guard is lowered only after the download settles (and only by its own open)');
  add((open.match(/hydratingIdRef\.current = null/g) ?? []).length === 1 && (src.match(/hydratingIdRef\.current = entryId/g) ?? []).length === 1,
    'exactly one raise and one lower — no other path can drop the guard early');
  return out;
}

let failed = 0;
console.log('\nSaved-chat stand-in is never saved over the chat\n');
for (const r of judge(real)) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.why}`);
  if (!r.ok) failed++;
}

console.log('\n  mutation proof — each defect must turn the check RED\n');
const mut = (from: string | RegExp, to: string) => {
  const next = real.replace(from, to);
  if (next === real) throw new Error(`mutation anchor missing: ${from}`);
  return next;
};
const mutants: [string, string][] = [
  ['the capture effect saving the stand-in (guard removed)', mut('if (hydratingIdRef.current === id) return;', '')],
  ['the guard raised only AFTER the stand-in paints', mut(/hydratingIdRef\.current = entryId;\s*/, '').replace('t = await hydrateTranscript(entryId)', 'hydratingIdRef.current = entryId; t = await hydrateTranscript(entryId)')],
  ['the guard lowered before the download settles', mut('if (hydratingIdRef.current === entryId) hydratingIdRef.current = null;', '').replace('hydratingIdRef.current = entryId;', 'hydratingIdRef.current = entryId; hydratingIdRef.current = null;')],
  ['the guard never raised at all', mut(/hydratingIdRef\.current = entryId;/, '')],
];
let blind = 0;
const mustCatch = (label: string, caught: boolean) => {
  console.log(`  ${caught ? 'PASS  catches' : 'FAIL  BLIND to'}: ${label}`);
  if (!caught) blind++;
};
for (const [label, src] of mutants) mustCatch(label, judge(src).some((r) => !r.ok));

if (blind) { console.error(`\n✗ ${blind} mutation(s) not caught\n`); process.exit(1); }
if (failed) { console.error(`\n✗ ${failed} check(s) FAILED — a half-loaded saved chat can be saved over the real one\n`); process.exit(1); }
console.log('\n✓ a saved chat being downloaded is never saved from its stand-in\n');
