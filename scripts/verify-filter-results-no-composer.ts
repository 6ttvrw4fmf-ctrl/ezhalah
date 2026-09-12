// FILTER RESULTS HAVE NO CHAT (owner, 2026-09-11). Auto-discovered barrier.
//
// "when user uses the filter, gets the result the chat below doesn't exist, only exists with the AI
//  chat" — a search that arrived via Normal Filter's «بحث» (the `?filter=` route param) shows its
// results with NO free-text composer at all. A conversation that started IN the AI Agent itself (typed
// text, a seed chip, a plain New Chat) keeps its composer exactly as before. Refine chips are NOT
// part of this change (owner-confirmed scope) — only the typed-input row disappears; the always-on
// listings-source disclaimer (a legal notice, not "the chat") must still render either way.
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

console.log('\n── JSX: the composer is gated, the disclaimer never is ──');
check('composerWrap exists and the gate immediately precedes the composer View',
  /\{!filterOrigin && \(\s*\n\s*<View style=\{\[s\.composer, COMPOSER_EASE/.test(code));
// The disclaimer must sit right after the LITERAL `)}` that closes THIS conditional, with nothing
// else between them — i.e. `</View>\n            )}\n            <Text style={s.disc}>` verbatim.
// This is a direct adjacency check (not a paren-balance heuristic), so it cannot be fooled by a
// mutation that moves the disclaimer earlier (inside the gate) or leaves stray nesting behind.
const closeThenDisc = /<\/View>\s*\n\s*\)\}\s*\n\s*<Text style=\{s\.disc\}>/;
check("the disclaimer sits IMMEDIATELY after the gate's own closing `)}` (outside it, not nested deeper)",
  closeThenDisc.test(code));

console.log('\n── mutation proof: this check actually fails on the regressions it exists to catch ──');
// Mutation 1: someone "simplifies" the JSX by dropping the `{!filterOrigin && ( ... )}` wrapper
// entirely, leaving the composer unconditional again (the ORIGINAL bug this barrier prevents).
const mutatedNoGate = agent.replace(
  '{!filterOrigin && (\n            <View style={[s.composer, COMPOSER_EASE, composerFocused && s.composerFocused]}>',
  '<View style={[s.composer, COMPOSER_EASE, composerFocused && s.composerFocused]}>',
);
mustCatch('removing the gate (composer unconditional again)',
  !/\{!filterOrigin && \(\s*\n\s*<View style=\{\[s\.composer, COMPOSER_EASE/.test(decomment(mutatedNoGate)));
// Mutation 2: the gate stays, but someone moves the disclaimer's closing `)}` to AFTER the
// disclaimer instead of before it — i.e. accidentally pulls the disclaimer INSIDE the gated block,
// hiding the legal notice along with the composer on Filter-origin screens.
const mutatedDiscInside = agent.replace(
  "            </View>\n            )}\n            <Text style={s.disc}>",
  "            </View>\n            <Text style={s.disc}>",
).replace(
  "            </Text>\n          </View>\n        </View>\n      </KeyboardAvoidingView>",
  "            </Text>\n            )}\n          </View>\n        </View>\n      </KeyboardAvoidingView>",
);
mustCatch('pulling the disclaimer inside the gate (it would vanish on Filter-origin too)',
  mutatedDiscInside !== agent && !closeThenDisc.test(decomment(mutatedDiscInside)));

console.log(failed ? `\n${failed} FAILED` : '\nAll filter-results-no-composer checks passed');
process.exit(failed ? 1 : 0);
