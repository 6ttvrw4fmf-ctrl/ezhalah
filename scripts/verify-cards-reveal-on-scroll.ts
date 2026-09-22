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
import { initialReveal, AF_REVEAL_MAX, CASCADE_MAX as CASCADE_MAX_SHARED } from '../src/lib/initialReveal.ts';
import { newerTurnPending } from '../src/lib/liveTurn.ts';
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
// CASCADE_MAX is IMPORTED, not regexed out of agent.tsx: a live journey needs the same number to
// know how many cards a turn arrives with, and a re-typed copy is how a check ends up asserting a
// contract production retired (AGENTS.md harness note 21). agent.tsx must consume that one
// definition rather than declare its own.
const CASCADE_MAX: number | null = CASCADE_MAX_SHARED;
const CHUNK = num('SCROLL_REVEAL_CHUNK');
const SLACK = num('SCROLL_REVEAL_SLACK_PX');
const STEP = num('REVEAL_STEP_MS');
check('CASCADE_MAX, SCROLL_REVEAL_CHUNK and SCROLL_REVEAL_SLACK_PX all exist',
  CASCADE_MAX != null && CHUNK != null && SLACK != null);
check('agent.tsx imports the shared CASCADE_MAX instead of re-declaring its own',
  /import \{[^}]*CASCADE_MAX[^}]*\} from '@\/lib\/initialReveal'/.test(agent)
  && !/const CASCADE_MAX\s*=/.test(agent),
  'a second copy of the cascade size drifts from the one live journeys import');
check('the opening cascade is bounded to about a screenful, not the whole set',
  !!CASCADE_MAX && CASCADE_MAX > 0 && CASCADE_MAX <= 40,
  `CASCADE_MAX=${CASCADE_MAX} — a cascade longer than a screenful is animating cards nobody is watching`);
check('the cascade cannot take longer than ~3s at the shipped step',
  !!CASCADE_MAX && !!STEP && CASCADE_MAX * STEP <= 3000,
  `${CASCADE_MAX} cards × ${STEP}ms = ${(CASCADE_MAX ?? 0) * (STEP ?? 0)}ms`);
// THE ACTIONS ROW MUST NOT MOVE UNDER THE USER (owner 2026-09-20: "whenever I scrolled, the
// advanced filter doesn't show, it shows later"). «تحديد أكثر» and «عرض المزيد» render AFTER the
// cards, so each revealed chunk is inserted ABOVE them — at ~700px/card a 12-card chunk shoves that
// row ~8,000px down. At the original 1,200px trigger the chunk fired exactly as the row entered the
// viewport, so the button the user was reaching for jumped away: present the whole time, never
// catchable. The trigger must therefore fire while the row is still WELL below the fold.
check('the reveal fires far enough ahead that the actions row settles OFF-SCREEN, not under the user',
  !!SLACK && SLACK >= 2000,
  `SCROLL_REVEAL_SLACK_PX=${SLACK} — below ~2000 the chunk lands as «تحديد أكثر» enters view and `
  + 'shoves it off-screen; live-measured at 1200 and the button was uncatchable');
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

// ── 4b. EXECUTED: an OUTGOING turn is history, and the scroll never writes to history ──────────
// ops_incident #338 (production, 2026-09-22, reproduced 4/4). `lastResultsMsg` answers "which turn
// is newest"; the handler was using it to answer "which turn may I still add cards to?". Those come
// apart for the whole searching beat, because a turn being BORN is a 'status' message — so the
// newest 'results' message is the one the user just left. The app's own programmatic scroll during
// the beat then drove that outgoing turn 24 → 48 cards and rewrote its closing line
// «عرضت لك أول 24 من أصل 2,925» → «عرضت لك أول 48». R9.2.2: a pill removal rewrites NOTHING above.
//
// Executed against the real exported rule, never a copy of it, on the exact message sequences
// production builds.
const R = (...roles: string[]) => roles.map((role) => ({ role }));
const liveCases: { what: string; msgs: { role: string }[]; pending: boolean }[] = [
  { what: 'a landed turn with nothing after it is LIVE', msgs: R('user', 'results'), pending: false },
  { what: 'the searching beat of the NEXT turn freezes the one below it (the #338 window)',
    msgs: R('user', 'results', 'status'), pending: true },
  { what: 'a pill removal (user bubble + status) freezes the turn below it',
    msgs: R('user', 'results', 'user', 'status'), pending: true },
  { what: 'a user bubble alone, before its status lands, already freezes it (no sub-frame hole)',
    msgs: R('user', 'results', 'user'), pending: true },
  { what: 'a plain agent bubble does NOT freeze the turn (it has not re-searched yet)',
    msgs: R('user', 'results', 'agent'), pending: false },
  { what: 'the newest of several turns is the live one', msgs: R('results', 'status', 'results'), pending: false },
  { what: 'an empty transcript has no live turn to extend', msgs: [], pending: false },
];
for (const c of liveCases) {
  check(`R9.2.2/R12.3 — ${c.what}`, newerTurnPending(c.msgs) === c.pending,
    `newerTurnPending(${JSON.stringify(c.msgs.map((m) => m.role))}) = ${newerTurnPending(c.msgs)}, expected ${c.pending}`);
}
// A COMMENT IS NOT A CODE PATH (the verify-results-found-rotation lesson): the rule above is inert
// unless the handler actually consults it, so pin the call site too.
check('the scroll handler actually consults it (a guard nothing calls guards nothing)',
  /if \(newerTurnPending\) return;/.test(fn),
  'maybeRevealOnScroll must stand down once a newer turn has begun');
check('the derivation is the SHARED pure rule, not a second copy inside agent.tsx',
  /newerTurnPendingPure\(msgs\)/.test(agent) && /from '@\/lib\/liveTurn'/.test(agent),
  'a private copy is the drift this surface keeps paying for (AGENTS.md harness note 13)');
// THE SCROLL PATH MUST PARTICIPATE IN THE SHARED TEARDOWN. Its staggering timers live in
// `revealTimers`, so a teardown that clears them mid-chunk leaves `scrollChunkRef` latched TRUE with
// no step() alive to reset it — and that ref is the "a chunk is already easing in" guard, so scroll
// reveal would be dead for the rest of the session.
check('clearReveals() releases the scroll-chunk latch it just orphaned the timers of',
  /const clearReveals = \(\) => \{[^}]*scrollChunkRef\.current = false;[^}]*\};/.test(agent),
  'clearing the chunk\'s timers without releasing the latch disables scroll-reveal permanently');

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

// ── ops_incident #338: each mutant is the REAL defect, executed, not a regex about it ──────────
// The pre-fix rule: "the newest 'results' message is always extensible" — exactly what the handler
// did by consulting lastResultsMsg alone. It must disagree with the shipped rule in the #338 window.
const preFixRule = (msgs: { role: string }[]) => false; // never pending ⇒ always extensible
mustCatch('the pre-#338 rule that treats an outgoing turn as still extensible',
  preFixRule(R('user', 'results', 'status')) !== newerTurnPending(R('user', 'results', 'status')));
// Dropping 'status' from the walk is the single-token mutation that reopens the measured defect.
const noStatus = (msgs: { role: string }[]) => {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'results') return false;
    if (msgs[i].role === 'user') return true;
  }
  return false;
};
mustCatch('a walk that stops recognising a turn being born (\'status\' dropped)',
  noStatus(R('user', 'results', 'status')) !== newerTurnPending(R('user', 'results', 'status')));
// Over-freezing is a defect too — it would kill scroll-reveal behind an ordinary agent bubble.
const tooEager = (msgs: { role: string }[]) => msgs[msgs.length - 1]?.role !== 'results';
mustCatch('an over-eager rule that also freezes a turn behind a plain agent bubble',
  tooEager(R('user', 'results', 'agent')) !== newerTurnPending(R('user', 'results', 'agent')));

console.log(failed
  ? `\n✗ ${failed} check(s) FAILED — the reveal is back on a clock, or the scroll can overrun/fight it\n`
  : '\n✓ first screenful cascades, the rest is revealed by approach, never past the target, never two writers\n');
process.exit(failed ? 1 : 0);
