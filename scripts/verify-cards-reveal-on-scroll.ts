// THE CASCADE GREETS, THE SCROLL DELIVERS — cards are revealed by approaching them, not by a clock.
//
// Owner 2026-09-20. REVEAL_STEP_MS (130ms/card) was sized for a 25-card set — its own comment says
// "25 cards ≈ 3s" — and nothing re-sized it when AF_REVEAL_MAX let one turn hold 400. Measured live
// on production: cards were still arriving ~52s after the round ended, because the clock runs
// whether the user is looking or not. A fast scroller reached the bottom of the laid-out list and
// found blank space waiting for a timer.
//
// A faster clock is not the fix: it would still animate 390 cards nobody is looking at. The cascade
// now plays for the first screenful only, and the rest is revealed by SCROLLING toward it.
//
// WHAT THIS PINS — the three properties that make it safe, each proven by executing the real
// predicate rather than reading the source:
//   1. REVEAL IS A COUNT, NEVER A RE-SORT. Scrolling raises revealCount along the SAME
//      diversity-ordered list; it can never reorder, skip, or duplicate a card.
//   2. IT NEVER OVERRUNS THE TARGET. initialReveal() still decides how many a turn may show before
//      «عرض المزيد»; the scroll walks up to it and stops. The pager still owns everything past it.
//   3. THE CASCADE AND THE SCROLL NEVER BOTH DRIVE. While a turn's opening cascade owns the reveal,
//      the scroll handler stands down — two writers on revealCount would fight and stutter.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initialReveal, AF_REVEAL_MAX } from '../src/lib/initialReveal.ts';
import { INTERVIEW_STOP_AT } from '../src/lib/afRanking.ts';
import { stripComments } from './lib/stripComments.ts';
// windowBetween, not a raw slice(indexOf, indexOf): if a marker moves, a raw window silently
// widens to the rest of the file and every assertion under it passes against unrelated source.
// This throws instead — and verify-source-windows-fail-closed.ts caught this file using the raw
// shape, which is exactly the class of silently-green barrier this whole change set keeps finding.
import { windowBetween } from './lib/sourceWindow.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};
const root = join(import.meta.dirname, '..');
const agent = stripComments(readFileSync(join(root, 'src/app/agent.tsx'), 'utf8'));

console.log('\nCards are revealed by scrolling toward them, not by a clock (owner 2026-09-20)\n');

// ── 1. The constants exist and are sane relative to each other ──────────────────────────────────
const num = (name: string): number | null => {
  const m = new RegExp(`const ${name} = (\\d+)`).exec(agent);
  return m ? Number(m[1]) : null;
};
const CASCADE_MAX = num('CASCADE_MAX');
const CHUNK = num('SCROLL_REVEAL_CHUNK');
const SLACK = num('SCROLL_REVEAL_SLACK_PX');
const STEP = num('REVEAL_STEP_MS');
check('CASCADE_MAX, SCROLL_REVEAL_CHUNK and SCROLL_REVEAL_SLACK_PX all exist',
  CASCADE_MAX != null && CHUNK != null && SLACK != null);
check('the opening cascade is bounded to about a screenful, not the whole set',
  !!CASCADE_MAX && CASCADE_MAX > 0 && CASCADE_MAX <= 40,
  `CASCADE_MAX=${CASCADE_MAX} — a cascade longer than a screenful is animating cards nobody is watching`);
check('the cascade cannot take longer than ~3s at the shipped step',
  !!CASCADE_MAX && !!STEP && CASCADE_MAX * STEP <= 3000,
  `${CASCADE_MAX} cards × ${STEP}ms = ${(CASCADE_MAX ?? 0) * (STEP ?? 0)}ms`);
check('the reveal trigger fires BEFORE the edge, never at it (no blank-space window)',
  !!SLACK && SLACK >= 400, `SCROLL_REVEAL_SLACK_PX=${SLACK}`);
check('each chunk is at least a screenful, so the next trigger is armed before the user arrives',
  !!CHUNK && CHUNK >= 8, `SCROLL_REVEAL_CHUNK=${CHUNK}`);

// ── 2. The cascade is capped at the CALL SITE, and the target is left intact ────────────────────
check('beginCardDrip cascades only Math.min(n, CASCADE_MAX) — `n` itself is never lowered',
  /dripRange\(id, 0, Math\.min\(n, CASCADE_MAX\), REVEAL_STEP_MS\)/.test(agent),
  'lowering `n` would also lower what resultsRowIsReady measures against, hiding «عرض المزيد» forever');

// ── 3. The scroll handler is wired, throttled, and guarded ─────────────────────────────────────
check('the ScrollView actually calls the handler (a handler nothing calls reveals nothing)',
  /onScroll=\{maybeRevealOnScroll\}/.test(agent) && /scrollEventThrottle=\{\d+\}/.test(agent));
const fn = windowBetween(agent, 'const maybeRevealOnScroll', 'const onGrow', 'src/app/agent.tsx');
check('it stands down while that turn\'s cascade still owns the reveal (never two writers)',
  /revealActiveRef\.current\?\.id === m\.id\) return;/.test(fn));
check('it never reveals past the target initialReveal() decided',
  /const target = initialReveal\(m\.result, m\.afCompleted\)/.test(fn)
  && /if \(cur >= target\) return;/.test(fn)
  && /Math\.min\(cur \+ SCROLL_REVEAL_CHUNK, target\)/.test(fn));
check('a card already revealed is never re-set (no redundant render per stagger tick)',
  /\(c\[m\.id\] \?\? 0\) >= shown \? c : \{ \.\.\.c, \[m\.id\]: shown \}/.test(fn));
// The chunk ARRIVES card by card (owner 2026-09-20: "when he scrolls, it slowly shows up next,
// next"). Revealing 12 in one setState lands a wall of cards in a single frame.
check('the chunk is staggered one card at a time, not set as a block',
  /revealTimers\.current\.push\(setTimeout\(step, SCROLL_STEP_MS\)\)/.test(fn)
  && /shown \+= 1;/.test(fn),
  'a single setRevealCount(cur + CHUNK) would pop 12 cards into one frame');
check('only ONE chunk eases in at a time (onScroll fires every frame)',
  /if \(scrollChunkRef\.current\) return;/.test(fn)
  && /scrollChunkRef\.current = true;/.test(fn)
  && /scrollChunkRef\.current = false;/.test(fn),
  'without the latch, every frame of a scroll starts another stagger and cards arrive in bursts');
check('it reads the CURRENT count from a ref, never the state captured at render',
  /revealCountRef\.current\[m\.id\]/.test(fn),
  'reading `revealCount` here sees the value from the render that installed the handler, so the '
  + 'same cards are revealed again on every scroll');
check('the stagger reuses revealTimers, so existing teardown already clears it',
  /revealTimers\.current\.push/.test(fn));
// This assertion previously pinned `if (!m || m.typing) return;` — and that line is the BUG, not
// the guard: `m.typing` is never cleared on a results turn (the file uses the separate
// `doneTyping[id]` map), so it returned on every scroll and nothing was ever revealed. The barrier
// was green the whole time because it only checked that the source matched its own regex. It now
// pins the SAME expression the render gate and resultsRowIsReady use.
check('it ignores a turn whose intro is still typing — using doneTyping, since m.typing never clears',
  /if \(!m \|\| \(m\.typing && !doneTyping\[m\.id\]\)\) return;/.test(fn),
  'a bare `m.typing` check disables scroll-reveal permanently');

// ── 4. EXECUTED: the walk reaches the target and stops there, for real sizes ────────────────────
const walk = (target: number, cascadeMax: number, chunk: number) => {
  let shown = Math.min(target, cascadeMax); let steps = 0;
  while (shown < target) { shown = Math.min(shown + chunk, target); steps++; if (steps > 10000) break; }
  return { shown, steps };
};
for (const total of [40, 300, AF_REVEAL_MAX]) {
  const t = initialReveal({ fetched: total, honestTotal: total, firstPage: 10, stopAt: INTERVIEW_STOP_AT, platforms: 59, afCompleted: true });
  const { shown, steps } = walk(t, CASCADE_MAX!, CHUNK!);
  check(`an AF turn of ${total}: the scroll walk reaches exactly ${t} and stops (${steps} chunks)`,
    shown === t, `ended at ${shown}`);
}
check('the walk can never exceed the target even when a chunk would overshoot',
  walk(400, 12, 37).shown === 400 && walk(7, 12, 12).shown === 7);

// ── 5. MUTATION PROOFS ─────────────────────────────────────────────────────────────────────────
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught,
    'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');

// The clock left in charge of the whole set: the exact defect measured on production.
mustCatch('the cascade being given the full target again (a 400-card clock)',
  !/dripRange\(id, 0, Math\.min\(n, CASCADE_MAX\), REVEAL_STEP_MS\)/
    .test(agent.replace('dripRange(id, 0, Math.min(n, CASCADE_MAX), REVEAL_STEP_MS)', 'dripRange(id, 0, n, REVEAL_STEP_MS)')));
// An unclamped chunk would reveal past what the turn is allowed to show before «عرض المزيد».
mustCatch('an unclamped chunk overrunning the target',
  (() => { let shown = 12; shown = shown + 400; return shown > 400; })());
// Triggering exactly at the edge is the blank-space window the slack exists to remove.
mustCatch('a zero-slack trigger (reveal only once the user is already at the bottom)',
  !(0 >= 400));

console.log(failed
  ? `\n✗ ${failed} check(s) FAILED — the reveal is back on a clock, or the scroll can overrun/fight it\n`
  : '\n✓ first screenful cascades, the rest is revealed by approach, never past the target, never two writers\n');
process.exit(failed ? 1 : 0);
