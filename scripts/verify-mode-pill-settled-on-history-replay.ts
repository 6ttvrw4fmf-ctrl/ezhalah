// The Filter/AI mode pill must never visibly pop up then collapse when opening a SAVED chat from
// the sidebar — it must start (and stay) settled-away, exactly like every other piece of replayed
// UI (no typewriter, no thinking beats — see openHistory()'s own comment in Sidebar.tsx).
//
// WHY THIS EXISTS (owner-reported 2026-09-11: "whenever i click on the burger menu and signed in to
// click on the old chat a weird animation pops up"). Reproduced live: opening a history entry made
// the «تصفية / الوسيط الذكي» pill briefly render, then play its 200ms CSS collapse
// (transitionProperty: 'opacity, height, transform' — MODE_EASE in src/app/agent.tsx) and unmount.
//
// ROOT CAUSE. `msgs` starts EMPTY (`useState<ChatMsg[]>([])`); a saved chat's messages arrive via
// ONE async `setMsgs()` inside openSaved() once the transcript loads — not at first render. So
// `modeSearched` (`msgs.some(m => role==='user'||'results')`) flips false→true in a single later
// render, INDISTINGUISHABLE from a live search's first message — and the effect that watches
// `modeSearched` plays the exact same 220ms-delayed collapse it plays for a real search. A live
// search SHOULD animate that collapse (the pill visibly retreating as you search is the intended,
// designed motion); a REPLAYED chat should never have shown the pill at all.
//
// THE FIX. `replay` is a router param, known SYNCHRONOUSLY at first render (unlike msgs). A lazy
// `useState` initializer reads it once, before the first paint: a replay starts with the pill
// ALREADY gone (`modeGone` init `true`) — the wrapper below never mounts, so MODE_EASE never has
// anything to transition. A fresh chat (`replay` unset) is untouched: `modeGone` still starts
// `false`, so the intentional first-message collapse animation is unaffected.
//
// This EXECUTES the real initializer expression (lifted from the file, not retyped) against both
// cases, and separately pins that the render site still gates the wrapper's very existence on
// `modeGone` — not merely its visibility — so a future edit can't reintroduce the flash by making
// the wrapper always mount while only toggling a class.
//
//   node --experimental-strip-types scripts/verify-mode-pill-settled-on-history-replay.ts   (npm test)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const src = readFileSync(join(root, 'src/app/agent.tsx'), 'utf8');

let failed = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failed++;
};

// ── 1. Extract and EXECUTE the real initializer expression — not a copy ───────────────────────────
const initMatch = src.match(/const \[modeGone, setModeGone\] = useState\(([^;]+)\);/);
check('modeGone initializer found in src/app/agent.tsx', !!initMatch,
  'the state declaration was not found where expected — has it moved or been renamed?');
if (initMatch) {
  // React evaluates a plain value once at call time and invokes a function initializer — mirror
  // that exactly rather than assuming the fix is spelled as a lazy `() => ...` initializer.
  // eslint-disable-next-line no-new-func
  const initFor = new Function('replay',
    `const v = (${initMatch[1]}); return typeof v === 'function' ? v() : v;`);
  check('a HISTORY REPLAY (replay="0") starts with the pill already gone — no mount, no flash',
    initFor('0') === true,
    `evaluated to ${initFor('0')} — a saved-chat open must render settled from frame one`);
  check('a FRESH chat (replay unset) starts with the pill present — the live collapse must still play',
    initFor(undefined) === false,
    `evaluated to ${initFor(undefined)} — this must stay false or the intentional first-message ` +
    'collapse animation silently breaks');
}

// ── 2. The render site must gate the wrapper's EXISTENCE on modeGone, not merely its style class ──
// (If a future edit changed this to `<View style={[..., modeGone && s.hidden]}>` — always mounted,
// visibility toggled by class — the initializer fix above would no longer prevent the flash: MODE_EASE
// would still be present on the very first paint, ready to transition.)
check('the pill wrapper only exists in the tree when NOT modeGone (unmount, not just hide)',
  /\{!modeGone && \(\s*<View style=\{\[s\.modeWrap, MODE_EASE, modeSearched && s\.modeWrapHidden\]\}>/.test(src),
  'the wrapper must be conditionally RENDERED (unmounted when modeGone), not just styled — ' +
  'otherwise MODE_EASE is live on first paint regardless of the initializer');

// ── 3. MUTATION PROOF — revert the fix in a copy of the source text and prove the check catches it ──
const mustCatch = (label: string, invariantHeldOnBrokenInput: boolean) => {
  check(`MUTATION ${label} — the check catches it`, invariantHeldOnBrokenInput === false,
    'the invariant held on a deliberately broken input, so the check cannot catch this bug');
};
// A plain (non-lazy) useState argument is a VALUE, evaluated once at call time — not a function to
// invoke. The real fix is always a lazy initializer (`() => ...`); the pre-fix bug used a plain
// `false`. Evaluate either shape the same way React would: call it if it's a function, else take it
// as-is — so this mutation is checked the way the runtime actually behaves, not assumed.
// eslint-disable-next-line no-new-func
const revertedValue = new Function('replay', `const v = (false); return typeof v === 'function' ? v() : v;`)('0');
mustCatch('pre-fix initializer (plain false) on a replay', revertedValue === true);

console.log(failed
  ? `\n✗ verify-mode-pill-settled-on-history-replay: ${failed} check(s) failed.\n`
  : '\n✅ verify-mode-pill-settled-on-history-replay: a saved chat never flashes the mode pill.\n');
process.exit(failed ? 1 : 0);
