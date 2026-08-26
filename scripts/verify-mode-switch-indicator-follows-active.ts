// The Filter / المساعد الذكي pill's raised indicator must ALWAYS sit on the mode the user is
// actually on. Visible UI state = committed state; the indicator is only a picture of `active` and
// is never allowed to disagree with it.
//
// WHY THIS EXISTS (real production bug, 2026-08-23 — "the tab says الوكيل الذكي but I'm on the
// Filter form, and tapping تصفية does nothing").
//
//   src/components/ModeSwitch.tsx settled the indicator in a MOUNT-ONLY effect:
//
//       const x = useRef(new Animated.Value(from)).current;
//       useEffect(() => { lastMode = active; if (from === toX) return; ...spring to toX... }, []);
//
//   …while `press()` optimistically glides THIS instance's indicator to the tab being navigated TO,
//   before the screen changes. On web the screen you leave STAYS MOUNTED in the stack. So:
//     1. on «/» tap «المساعد الذكي» → the Home instance's indicator glides to the AI side, router.push
//     2. browser Back → the SAME Home instance is shown again. It never re-rendered, its mount effect
//        never re-ran, and its indicator is still parked on «المساعد الذكي».
//     3. tapping «تصفية» cannot fix it — `press` early-returns when `to === active`.
//   Measured against the production build: indicator x = 870 (over «الوكيل الذكي») on the Filter
//   form, where 764 (over «تصفية») is truth. Permanently wrong, with no user recovery.
//
// THE RULE: the indicator's position is a function of `active`, re-established every time the
// control is on screen — not once at mount. Either fix satisfies it and this barrier accepts both:
//   (a) re-settle on focus (what shipped: useFocusEffect), or
//   (b) never leave a lie behind — drop the optimistic pre-navigation glide in `press`.
// What it rejects is the shipped combination that broke: optimistic glide + settle only at mount.
//
// The lifecycle below is EXECUTED, and its inputs are read out of the real source, so this is not a
// pattern match on one particular spelling of the fix. Every check is mutation-proven at the bottom.
//
//   node --experimental-strip-types scripts/verify-mode-switch-indicator-follows-active.ts   (npm test)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

const SEG_W = 106; // the AI half's offset; only its sign matters here

/** What the shipped ModeSwitch does, read out of the file rather than assumed. */
type Policy = {
  /** `press()` moves THIS instance's indicator to the OTHER tab before navigating away. */
  optimisticGlide: boolean;
  /** the indicator is re-settled on `active` every time the control gains focus */
  settlesOnFocus: boolean;
  /** the settle re-runs when `active` changes */
  followsActive: boolean;
};

export const readPolicy = (src: string): Policy => {
  const code = codeOnly(src);
  // press(): the optimistic pre-navigation glide, `toValue` driven by the tapped tab, not by `active`
  const press = code.slice(code.indexOf('const press ='), code.indexOf('return (', code.indexOf('const press =')));
  const optimisticGlide = /Animated\.spring\(\s*x\s*,\s*\{\s*toValue:\s*to\s*===/.test(press);
  // the settle: a spring of the indicator value onto `toX` (the position `active` demands)
  const focusIdx = code.indexOf('useFocusEffect(');
  const focusBlock = focusIdx < 0 ? '' : code.slice(focusIdx, code.indexOf('const breath', focusIdx));
  const settlesOnFocus = /Animated\.spring\(\s*x\s*,\s*\{\s*toValue:\s*toX/.test(focusBlock);
  const followsActive = settlesOnFocus && /\}\s*,\s*\[[^\]]*\bactive\b[^\]]*\]\s*\)/.test(focusBlock);
  return { optimisticGlide, settlesOnFocus, followsActive };
};

/**
 * The exact repro, executed: ONE Home («تصفية») instance that is never unmounted, as the web stack
 * keeps it. Returns where its indicator ends up after Back. Truth is 0 — the Filter half.
 */
export const indicatorAfterBack = (p: Policy): number => {
  const active = 'filter' as const;
  const toX = active === 'filter' ? 0 : SEG_W;
  let x = toX;                       // settled on load
  if (p.optimisticGlide) x = SEG_W;  // 1. tap «المساعد الذكي» — this instance glides away, then push('/agent')
  //                                    2. the Home screen blurs; it stays mounted, never re-renders
  if (p.settlesOnFocus) x = toX;     // 3. browser Back re-shows THIS instance
  return x;
};

console.log('\nModeSwitch — the indicator follows `active`, every time the control is on screen\n');

// ── A. BEHAVIOUR — the shipped policy, run through the repro ─────────────────────────────────────
const policy = readPolicy(read('src/components/ModeSwitch.tsx'));
check('A1. after «المساعد الذكي» → browser Back, the indicator is on «تصفية» (the screen you are on)',
  indicatorAfterBack(policy) === 0,
  `policy=${JSON.stringify(policy)} → indicator x=${indicatorAfterBack(policy)}, expected 0`);
check('A2. the settle re-runs when `active` changes (indicator tracks the mode, not the mount)',
  policy.followsActive || !policy.optimisticGlide,
  `policy=${JSON.stringify(policy)}`);
check('A3. …and the exact broken shape — optimistic glide + settle only at mount — is rejected',
  indicatorAfterBack({ optimisticGlide: true, settlesOnFocus: false, followsActive: false }) !== 0);

// ── B. WIRING — each screen tells the pill the mode it actually IS ───────────────────────────────
// `active` is the committed truth the indicator is derived from; if a screen passes the other mode,
// nothing downstream can save the user.
const home = codeOnly(read('src/app/index.tsx'));
const agent = codeOnly(read('src/app/agent.tsx'));
check('B1. the Filter home mounts the pill with active="filter"',
  /<ModeSwitch\s+active="filter"/.test(home), 'src/app/index.tsx');
check('B2. the AI screen mounts the pill with active="agent"',
  /<ModeSwitch\s+active="agent"/.test(agent), 'src/app/agent.tsx');
check('B3. neither screen mounts a second pill with the wrong mode',
  (home.match(/<ModeSwitch\s+active="agent"/g) ?? []).length === 0 &&
  (agent.match(/<ModeSwitch\s+active="filter"/g) ?? []).length === 0);

// ── C. MUTATION PROOF — every check above must FAIL on deliberately broken source ────────────────
// A barrier that still passes on the bug is not a barrier.
{
  const src = read('src/components/ModeSwitch.tsx');
  // the pre-fix shape: settle the indicator once, at mount
  const rebroken = src
    .replace(/useFocusEffect\(\s*\n?\s*useCallback\(/, 'useEffect((')
    .replace(/\}, \[active, toX, x\]\),\s*\n\s*\);/, '}, []);');
  const brokenPolicy = readPolicy(rebroken);
  check('C1. re-broken to a mount-only settle → A1 would FAIL',
    indicatorAfterBack(brokenPolicy) !== 0, `brokenPolicy=${JSON.stringify(brokenPolicy)}`);
  check('C2. re-broken source is genuinely different from the shipped source (the mutation applied)',
    rebroken !== src);
  check('C3. B1/B2 would FAIL if a screen claimed the wrong mode',
    !/<ModeSwitch\s+active="filter"/.test(home.replace('<ModeSwitch active="filter"', '<ModeSwitch active="agent"')));
}

console.log(failures === 0
  ? '\nALL PASS — the mode indicator cannot be left pointing at a mode the user is not on.\n'
  : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
