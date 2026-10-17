import { stripTypeScriptTypes } from 'node:module';
import { windowBetween } from './lib/sourceWindow.ts';
// FILTER RESULTS HAVE NO CHAT (owner, 2026-09-11; tightened 2026-09-12). Auto-discovered barrier.
//
// "when user uses the filter, gets the result the chat below doesn't exist, only exists with the AI
//  chat" — a search that arrived via Normal Filter's «بحث» (the `?filter=` route param) shows its
// results with NO free-text composer at all. A conversation that started IN the AI Agent itself (typed
// text, a seed chip, a plain New Chat) keeps its composer exactly as before. Refine chips are NOT
// part of this change (owner-confirmed scope) — only the typed-input row disappears; the always-on
// listings-source disclaimer (a legal notice, not "the chat") must still render either way.
//
// TIGHTENED AGAIN 2026-09-12 (owner: "REMOVE THIS IN THE FILTER SIMPLE" — screenshot of the small
// green Stop square lingering on Filter-origin results during the cascade reveal): the previous
// three-way branch (`filterOrigin && (busy || revealing)` → Stop alone) is gone. The gate is now a
// simple two-way branch: `!filterOrigin` → the real composer, unchanged; otherwise → nothing at all.
// A Filter-origin conversation never shows any composer/Stop UI, at any state — busy, revealing, or
// completed. The stop() function itself stays intact (verify-filter-stop-cancels-and-restores.ts
// still holds unchanged — it only asserts stop()'s behaviour when called, not that a button exists),
// so a Filter search cancelled by other means — route change via the top ☰ menu / تصفية tab /
// browser back / any effect cleanup — still aborts the network request and returns to the Filter
// screen with restored state. Trade-off owner-accepted 2026-09-12: no in-place cancel during a
// mid-flight Filter search.
//
// EARLIER HISTORY (kept for provenance): 2026-09-12 first tightening replaced a `|| busy ||
// revealing` composer widening with a `filterOrigin && (busy || revealing)` Stop-alone branch;
// this second tightening removes even that Stop-alone branch entirely.
//
//   node --experimental-strip-types scripts/verify-filter-results-no-composer.ts  (in `npm test`)
import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};
// verify-new-barriers-are-mutation-proven.ts scans for an executable call named mustCatch/mutation/
// mustFail/mutantCaught applying this barrier's OWN predicate to a deliberately broken input — a
// differently-named `check(...)` call, however mutation-shaped, does not count as PROOF to that meta-
// barrier. `caught` = true means the mutation WAS detected (the real check failed on it, as it should).
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const agent = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
// A COMMENT IS NOT A CODE PATH: strip comments before counting call sites, so this file's own prose
// (which necessarily names `setFilterOrigin` while explaining the design) can't inflate a count.
const decomment = (src: string) => src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
const code = decomment(agent);
// Owner clarification 2026-10-13: completed Filter searches expose the composer below the final note.
const gateExpression = code.match(/\{([^\n{}]+) \? \(\s*\n\s*<View style=\{\[s\.composer,/)![1];
const visible = new Function('filterOrigin', 'completed', `return ${gateExpression};`);
for (const filterOrigin of [true, false]) for (const completed of [true, false])
  check(`composer visibility filter=${filterOrigin} completed=${completed}`, visible(filterOrigin, completed) === (!filterOrigin || completed));

console.log('── the flag exists, defaults false, and is reset by startFresh like every other per-conversation flag ──');
check('filterOrigin state exists, default false', /const \[filterOrigin, setFilterOrigin\] = useState\(false\);/.test(code));
const startFreshFn = code.slice(code.indexOf('const startFresh = () => {'), code.indexOf('const startFresh = () => {') + code.slice(code.indexOf('const startFresh = () => {')).indexOf('\n    };'));
check("startFresh() resets it to false (so a later AI-chat search on the same screen gets its composer back)",
  /setFilterOrigin\(false\)/.test(startFreshFn));

console.log('\n── ONLY the `?filter=` arrival path ever sets it true ──');
const setTrueSites = (code.match(/setFilterOrigin\(true\)/g) ?? []).length;
check('exactly ONE call site sets filterOrigin true', setTrueSites === 1, `found ${setTrueSites}`);
check('that ONE call site sits in the `?filter=` branch, right after startFresh() and before sendFilter/openSaved run',
  /startFresh\(\);\s*\n\s*setFilterOrigin\(true\);[\s\S]{0,200}(?:sendFilter|openSaved)\(/.test(code));
check('the seed-chip path (a chip, NOT the Filter) never sets it true',
  !/lastSeedRef\.current = seed;[\s\S]{0,300}setFilterOrigin\(true\)/.test(code));

console.log('\n── JSX: two-way branch — real composer OR nothing — disclaimer never gated ──');
// Branch 1: the REAL composer (TextInput and all) renders ONLY on `!filterOrigin` — and, since
// 2026-10-05 (owner «Hide it completely»), only while the search was not finished; since 2026-10-13 (owner «remove the lock») a finished search keeps it too.
const COMPOSER_BRANCH = /\{!filterOrigin \|\| completed \? \(\s*\n\s*<View style=\{\[s\.composer, COMPOSER_EASE/;
check('the real composer is gated behind `!filterOrigin` (never a wider condition that could show it for a Filter search)',
  COMPOSER_BRANCH.test(code));
// Branch 2: filterOrigin → NOTHING. No Stop-alone branch, no composer pill, no TextInput anywhere
// reachable when filterOrigin is true. The gate goes straight from `!filterOrigin ? (...) : null}`
// with nothing in between.
const twoWayEnd = /\)\s*\n\s*\}\s*<\/View>\s*\n\s*<\/View>\s*\n\s*<Pressable/;  // sanity: outer composer wrap closes cleanly
// The branch must close with `) : null}` and MUST NOT open a `(busy || revealing) ?` sub-branch
// (the earlier Stop-alone tightening this second tightening removes).
// The branch's OWN closer sits at the gate's indentation; nested `) : null}` closers inside the box
// (voice overlay, stop/send) are deeper and must not be mistaken for it. Returns the index just past it.
const branchClose = (c: string): number => {
  const open = c.indexOf('{!filterOrigin || completed ? (');
  if (open < 0) return -1;
  const indent = c.slice(c.lastIndexOf('\n', open) + 1, open).match(/^ */)?.[0] ?? '';
  const at = c.indexOf(`\n${indent}) : null}`, open);
  return at < 0 ? -1 : at + `\n${indent}) : null}`.length;
};
const composerBranchStart = code.indexOf('{!filterOrigin || completed ? (');
// The branch's own closer (indent-aware): the mic's `) : null}` sits before Stop since 2026-10-10 and must
// not be mistaken for the end of the composer.
const nullCloseIdx = branchClose(code) >= 0 ? branchClose(code) - ') : null}'.length : -1;
const midBranch = composerBranchStart >= 0 && nullCloseIdx >= 0
  ? code.slice(composerBranchStart, nullCloseIdx + ') : null}'.length)
  : '';
check("the branch closes with `) : null}` (nothing renders when filterOrigin is true)",
  midBranch.endsWith(') : null}'));
check('there is NO `(busy || revealing) ?` sub-branch between the composer branch and its closing null',
  !/\) : \(busy \|\| revealing\) \? \(/.test(midBranch));
check('no Stop Pressable renders under a filterOrigin path (the Stop-alone regression this second tightening removes)',
  // Look at the code AFTER the AI-Agent composer branch's own closing `) : null}` — anything
  // between there and the disclaimer's `<Text style={s.disc}>` that mentions `onPress={stop}`
  // means a filterOrigin Stop branch has crept back in.
  (() => {
    const afterComposer = code.slice(nullCloseIdx + ') : null}'.length);
    const discIdx = afterComposer.indexOf('<Text style={s.disc}>');
    if (discIdx < 0) return false; // disclaimer must exist
    const between = afterComposer.slice(0, discIdx);
    return !/onPress=\{stop\}/.test(between);
  })());

console.log('\n── the composer that DOES exist for AI-Agent conversations still keeps Stop reachable mid-search ──');
// Inside the `!filterOrigin` composer branch, the pre-existing busy/revealing ternary (Stop OR
// mic+send, never both) must still be intact — this fix must not regress the AI-Agent path.
const composerBranchEnd = nullCloseIdx;
const composerBranch = composerBranchStart >= 0 && composerBranchEnd >= 0 ? code.slice(composerBranchStart, composerBranchEnd) : '';
check('the composer branch still has its own busy||revealing → Stop ternary (AI-Agent Stop unaffected)',
  /busy \|\| revealing \?/.test(composerBranch) && /onPress=\{stop\}/.test(composerBranch));

// The disclaimer must render at top-level of the composer wrap, not gated on any branch. After
// decomment(), JSX block comments collapse to `{}` so we allow arbitrary intermediate whitespace
// or empty jsx-expressions between the `) : null}` and the disclaimer. The owner-approved model
// row may also sit here, but ONLY under the same !filterOrigin gate; an ungated
// selector still fails. The legal disclaimer stays outside both gates.
const closeThenDisc = /\) : null\}(?:\s|\{\})*(?:\{!filterOrigin && <AgentModelSelector disabled=\{busy \|\| revealing \|\| voiceState !== 'idle'\} \/>\}(?:\s|\{\})*)?<Text style=\{s\.disc\}>/;
check("the disclaimer sits after the branch's closing `) : null}` (outside every branch)",
  closeThenDisc.test(code));

console.log('\n── mutation proof: this check actually fails on the regressions it exists to catch ──');
// The model selector lives INSIDE the composer box since 2026-10-09 (round 4) — i.e. inside the gated
// branch — and may render nowhere else, so it can never show on Filter-origin results. (Until round 4
// it sat between the branch and the disclaimer under its own copy of the gate; closeThenDisc above
// still tolerates that shape, this check forbids any copy OUTSIDE the branch.)
const selectorOnlyInsideBranch = (c: string) => {
  const open = c.indexOf('{!filterOrigin || completed ? (');
  const close = branchClose(c);
  const at = c.indexOf('<AgentModelSelector');
  return open >= 0 && close > open && at > open && at < close && c.indexOf('<AgentModelSelector', close) < 0;
};
check('the model selector renders only inside the gated composer branch (never on Filter-origin results)',
  selectorOnlyInsideBranch(code));
const selectorOutsideBranch = (() => {
  const c = decomment(agent);
  const close = branchClose(c);
  return c.slice(0, close) + '<AgentModelSelector disabled={false} />' + c.slice(close);
})();
mustCatch('an ungated model selector appearing on Filter-origin results',
  !selectorOnlyInsideBranch(selectorOutsideBranch));
// Mutation 1: someone "simplifies" the JSX by dropping the whole three-way branch, leaving the
// composer unconditional again (the ORIGINAL 09-11 bug this barrier prevents).
const mutatedNoGate = agent.replace(
  '{!filterOrigin || completed ? (\n            <View style={[s.composer, COMPOSER_EASE, composerFocused && s.composerFocused, modeSearched && s.composerNoModel]} ref={composerRef}>',
  '<View style={[s.composer, COMPOSER_EASE, composerFocused && s.composerFocused, modeSearched && s.composerNoModel]} ref={composerRef}>',
);
mustCatch('removing the branch (composer unconditional again)',
  !COMPOSER_BRANCH.test(decomment(mutatedNoGate)));
// Mutation 2 (the 09-12 SECOND-tightening regression this update exists to prevent): someone
// re-adds a `(busy || revealing) ?` Stop-alone branch under filterOrigin — the exact small green
// Stop square the owner sent a screenshot of and asked to remove ("REMOVE THIS IN THE FILTER
// SIMPLE"). Simulate by re-inserting the previous three-way branch shape and confirming the check
// catches it.
const mutatedStopBackForFilter = agent.replace(
  ') : null}\n            {/* FILTER-ORIGIN, STOP BUTTON REMOVED ENTIRELY',
  ') : (busy || revealing) ? (\n              <View style={{ flexDirection: \'row\', justifyContent: \'flex-end\' }}>\n                <Pressable onPress={stop} style={s.stopBtn}><Ionicons name="stop" size={15} color="#fff" /></Pressable>\n              </View>\n            ) : null}\n            {/* FILTER-ORIGIN, STOP BUTTON REMOVED ENTIRELY',
);
mustCatch('a Stop-alone branch creeping back into the filterOrigin path (the exact regression this second tightening removes)',
  mutatedStopBackForFilter !== agent && (() => {
    const c = decomment(mutatedStopBackForFilter);
    return /\{!filterOrigin \|\| completed \? \([\s\S]*?\) : \([\s\S]*?onPress=\{stop\}[\s\S]*?\) : null\}/.test(c);
  })());
// Mutation 3: the branch stays, but someone moves the disclaimer's closing marker so it lands
// INSIDE the branch, hiding the legal notice along with the composer on Filter-origin.
const mutatedDiscInside = agent.replace(
  ') : null}\n            {/* FILTER-ORIGIN, STOP BUTTON REMOVED ENTIRELY',
  ') : (\n            {/* FILTER-ORIGIN, STOP BUTTON REMOVED ENTIRELY',
);
mustCatch('pulling the disclaimer inside the branch (it would vanish on Filter-origin too)',
  mutatedDiscInside !== agent && !closeThenDisc.test(decomment(mutatedDiscInside)));

// THE AI-AGENT COMPOSER NEVER REARRANGES MID-SEARCH (owner 2026-10-10, screenshot: «allign it well … like
// chatgpt»). While Ezhalah searches, the «بحث» chip and the mic stay where they are and Send becomes Stop in
// its own slot, in Send's own circle — so nothing moves and «شاهين 2.2» stays under the mic. Measured on a
// local build at 1100 px: chip, text, mic, model label and the 38×38 button at identical pixels idle vs busy.
const steadyRow = (c: string) => {
  const open = c.indexOf('{!filterOrigin || completed ? (');
  const close = branchClose(c);
  const box = open >= 0 && close > open ? c.slice(open, close) : '';
  const chip = box.indexOf('testID="initial-chat-search"');
  const mic = box.indexOf('testID="voice-mic"');
  const ternary = box.indexOf('{busy || revealing ? (');
  const chipGate = box.slice(Math.max(0, chip - 200), chip);
  return chip > 0 && !/busy|revealing/.test(chipGate)            // the chip is never hidden by a running search
    && mic > 0 && ternary > mic                                   // the mic sits before (outside) the Send/Stop swap
    && /onPress=\{stop\}[\s\S]{0,260}?<View style=\{\[s\.sendBtn, s\.stopCircle\]\}>/.test(box.slice(ternary)); // Stop wears Send's circle
};
check('the AI-Agent composer keeps chip, mic and the Send/Stop slot in place while a search runs', steadyRow(code));
mustCatch('the «بحث» chip hidden again while a search runs', !steadyRow(code.replace('<Pressable\n                  testID="initial-chat-search"', '{!busy && !revealing && <Pressable\n                  testID="initial-chat-search"')));
mustCatch('a Stop button of its own size and shape (the row shifts)', !steadyRow(code.replace('<View style={[s.sendBtn, s.stopCircle]}>', '<View style={s.stopBtn}>')));


// Execute the real guarded send prefix: a typed follow-up must keep chat input for later questions.
const sendPrefix = windowBetween(code, 'const send = async (override?: string) => {', 'const selectedSourcesForTurn', 'src/app/agent.tsx');
async function sendsAsChat(prefix: string, typed: string, busy = false) {
  let origin = true;
  const send = new Function('typed', 'busy', 'setFilterOrigin', stripTypeScriptTypes(prefix + '\n};') + '\nreturn send;')(typed, busy, (value: boolean) => { origin = value; });
  await send();
  return origin;
}
check('typed follow-up leaves Filter mode so clarification retains its composer', await sendsAsChat(sendPrefix, 'Find apartments in Jeddah') === false);
check('empty or busy sends retain Filter mode', await sendsAsChat(sendPrefix, '') === true && await sendsAsChat(sendPrefix, 'Find apartments', true) === true);
mustCatch('typed follow-up retaining Filter origin (composer vanishes)', await sendsAsChat(sendPrefix.replace('setFilterOrigin(false);', ''), 'Find apartments') === true);
console.log(failed ? `\n${failed} FAILED` : '\nAll filter-results-no-composer checks passed');
process.exit(failed ? 1 : 0);
