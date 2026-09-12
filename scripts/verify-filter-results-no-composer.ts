// FILTER RESULTS HAVE NO CHAT (owner, 2026-09-11; tightened 2026-09-12). Auto-discovered barrier.
//
// "when user uses the filter, gets the result the chat below doesn't exist, only exists with the AI
//  chat" — a search that arrived via Normal Filter's «بحث» (the `?filter=` route param) shows its
// results with NO free-text composer at all. A conversation that started IN the AI Agent itself (typed
// text, a seed chip, a plain New Chat) keeps its composer exactly as before. Refine chips are NOT
// part of this change (owner-confirmed scope) — only the typed-input row disappears; the always-on
// listings-source disclaimer (a legal notice, not "the chat") must still render either way.
//
// TIGHTENED 2026-09-12 (owner: "when the animation shows it still shows chat button ... remove
// that"): the first fix (`|| busy || revealing` widening the OLD `!filterOrigin` gate) kept Stop
// reachable during an in-flight Filter search, but did it by showing the FULL composer pill —
// TextInput, inviting placeholder, the works — with only Stop swapped in for send. That still read
// as an active chat mid-animation. The gate is now a three-way branch: `!filterOrigin` → the real
// composer, unchanged; `filterOrigin && (busy || revealing)` → Stop ALONE, undressed as a composer
// (verify-filter-stop-cancels-and-restores.ts still holds — Stop is reachable, just not wrapped in
// an input row); otherwise → nothing. A completed Filter-origin screen still shows no composer at
// all (unchanged from the 09-11 fix).
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

console.log('\n── JSX: three-way branch — real composer, Stop-alone, or nothing — disclaimer never gated ──');
// Branch 1: the REAL composer (TextInput and all) renders ONLY on `!filterOrigin`.
const COMPOSER_BRANCH = /\{!filterOrigin \? \(\s*\n\s*<View style=\{\[s\.composer, COMPOSER_EASE/;
check('the real composer is gated behind `!filterOrigin` (never a wider condition that could show it for a Filter search)',
  COMPOSER_BRANCH.test(code));
// Branch 2: filterOrigin && (busy||revealing) → Stop alone. Must contain a Pressable calling stop(),
// and must NOT contain a TextInput/composer pill anywhere in that branch — that is the exact
// regression this tightening exists to prevent (Stop dressed back up as a composer).
const stopBranchStart = code.indexOf(') : (busy || revealing) ? (');
const stopBranchEnd = stopBranchStart >= 0 ? code.indexOf(') : null}', stopBranchStart) : -1;
const stopBranch = stopBranchStart >= 0 && stopBranchEnd >= 0 ? code.slice(stopBranchStart, stopBranchEnd) : '';
check('a `(busy || revealing) ? (...) : null` branch exists right after the composer branch',
  stopBranch.length > 0);
check('that branch calls onPress={stop} (Stop is genuinely reachable, not just decorative)',
  /onPress=\{stop\}/.test(stopBranch));
check('that branch renders NO TextInput (Stop stands alone — not the composer with the button swapped)',
  !/<TextInput/.test(stopBranch));
check('that branch renders NO composer pill (`s.composer`) and NO inviting placeholder text',
  !/s\.composer\b/.test(stopBranch) && !/placeholder=/.test(stopBranch));

console.log('\n── the composer that DOES exist for AI-Agent conversations still keeps Stop reachable mid-search ──');
// Inside the `!filterOrigin` composer branch, the pre-existing busy/revealing ternary (Stop OR
// mic+send, never both) must still be intact — this fix must not regress the AI-Agent path.
const composerBranchStart = code.indexOf('{!filterOrigin ? (');
const composerBranchEnd = composerBranchStart >= 0 ? code.indexOf(') : (busy || revealing) ? (', composerBranchStart) : -1;
const composerBranch = composerBranchStart >= 0 && composerBranchEnd >= 0 ? code.slice(composerBranchStart, composerBranchEnd) : '';
check('the composer branch still has its own busy||revealing → Stop ternary (AI-Agent Stop unaffected)',
  /busy \|\| revealing \?/.test(composerBranch) && /onPress=\{stop\}/.test(composerBranch));

// The disclaimer must sit right after the LITERAL `) : null}` that closes the whole three-way
// branch, with nothing else between them. Direct adjacency (not a paren-balance heuristic), so it
// cannot be fooled by a mutation that moves the disclaimer earlier (inside a branch).
const closeThenDisc = /\) : null\}\s*\n\s*<Text style=\{s\.disc\}>/;
check("the disclaimer sits IMMEDIATELY after the branch's own closing `) : null}` (outside every branch)",
  closeThenDisc.test(code));

console.log('\n── mutation proof: this check actually fails on the regressions it exists to catch ──');
// Mutation 1: someone "simplifies" the JSX by dropping the whole three-way branch, leaving the
// composer unconditional again (the ORIGINAL 09-11 bug this barrier prevents).
const mutatedNoGate = agent.replace(
  '{!filterOrigin ? (\n            <View style={[s.composer, COMPOSER_EASE, composerFocused && s.composerFocused]}>',
  '<View style={[s.composer, COMPOSER_EASE, composerFocused && s.composerFocused]}>',
);
mustCatch('removing the branch (composer unconditional again)',
  !COMPOSER_BRANCH.test(decomment(mutatedNoGate)));
// Mutation 2 (the 09-11 regression, caught only by CI's browser smoke test at the time): someone
// narrows back to bare `!filterOrigin ? (...) : null`, DELETING the busy||revealing Stop branch
// entirely (not just relabelling its condition, which a static-text check can't "evaluate" —
// actually removing the branch body is what a real narrowing edit does) — Stop becomes unreachable
// mid-search for a Filter-origin conversation again.
// Sliced out of `agent` directly (not `code`/decommented) — decomment() deletes block-comment
// text entirely, shifting offsets, so a fragment sliced from `code` is not literally present in
// `agent` and `agent.replace(fragment, '')` would silently no-op (match nothing), making this
// mutation a false PASS instead of a caught regression.
const bareGateStart = agent.indexOf(') : (busy || revealing) ? (');
const bareGateEnd = bareGateStart >= 0 ? agent.indexOf(') : null}', bareGateStart) : -1;
const mutatedBareGate = bareGateStart >= 0 && bareGateEnd >= 0
  ? agent.slice(0, bareGateStart) + agent.slice(bareGateEnd)
  : agent;
mustCatch('narrowing away the busy||revealing Stop branch (Stop becomes unreachable mid-search)',
  mutatedBareGate !== agent && !decomment(mutatedBareGate).includes(') : (busy || revealing) ? ('));
// Mutation 3 (the 09-12 regression this tightening exists to prevent): someone "restores" the full
// composer pill inside the Stop-alone branch instead of leaving it undressed — the exact "chat
// button during the animation" bug the owner reported.
const mutatedComposerBackInStopBranch = agent.replace(
  '              <View style={{ flexDirection: \'row\', justifyContent: \'flex-end\' }}>\n                <Pressable\n                  onPress={stop}',
  '              <View style={[s.composer, COMPOSER_EASE]}>\n                <TextInput placeholder="typing" />\n                <Pressable\n                  onPress={stop}',
);
mustCatch('a TextInput/composer pill creeping back into the Stop-alone branch (the animation-time "chat button" regression)',
  mutatedComposerBackInStopBranch !== agent && (() => {
    const c = decomment(mutatedComposerBackInStopBranch);
    const s0 = c.indexOf(') : (busy || revealing) ? (');
    const s1 = s0 >= 0 ? c.indexOf(') : null}', s0) : -1;
    const branch = s0 >= 0 && s1 >= 0 ? c.slice(s0, s1) : '';
    return /<TextInput/.test(branch);
  })());
// Mutation 4: the branch stays, but someone moves the disclaimer's closing marker so it lands
// INSIDE the three-way branch, hiding the legal notice along with the composer on Filter-origin.
const mutatedDiscInside = agent.replace(
  ') : null}\n            <Text style={s.disc}>',
  ') : (\n            <Text style={s.disc}>',
);
mustCatch('pulling the disclaimer inside the branch (it would vanish on Filter-origin too)',
  mutatedDiscInside !== agent && !closeThenDisc.test(decomment(mutatedDiscInside)));

console.log(failed ? `\n${failed} FAILED` : '\nAll filter-results-no-composer checks passed');
process.exit(failed ? 1 : 0);
