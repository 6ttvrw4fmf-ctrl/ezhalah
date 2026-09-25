// AN OWNERSHIP PROBE MUST READ THE PAINTED STACK, NOT THE TOP HIT (PART 5 shape 13, ops_incident #262).
//
// THE RULE, AND WHY ONE BARRIER OVER ONE JOURNEY WAS NOT ENOUGH.
// `docs/ops/JOURNEY_PERSISTENCE_ENGINEER.md` PART 5 shape 13 states it plainly — «Judge with
// `elementsFromPoint`, never `elementFromPoint`» — and records the measurement behind it: a control
// scrolled out of view still has a rect, that rect can lie under a sheet, and the singular form then
// reports a perfectly healthy build as «20 controls blocked». It was enforced by exactly one check,
// `verify-onetap-attribution-does-not-misblame.ts`, deliberately SCOPED TO ONE JOURNEY'S BODY by
// name, with a comment excusing the rest of the file. Two other probes asked the same question with
// the forbidden form for as long as they had existed, and nothing in the repo could see them. That
// is the shape AGENTS.md calls «a pointer reads as coverage»: the rule was written down, one
// instance was pinned, and the class drifted.
//
// WHAT IT COST, MEASURED. `tap-targets-meet-44:mobile375` filed «تصفية» rect [82,269,106,36] and
// «الوسيط الذكي» [188,269,106,36] as blocked by a `<div 375x272 at 0,286 z=38 pos=fixed>` on
// 2026-09-14, 2026-09-15 and 2026-09-20, 1/2 each time. Reproduced deterministically on production
// on 2026-09-21, 2/2 fresh contexts, 375x812, by injecting the One Tap band so the consent card
// lifts to 286-558 and the app root reserves the combined 526 px:
//
//   elementFromPoint(135, 287)  → <div 375x272 at 0,286 z=38 pos=fixed>      ⇒ filed as a DEFECT
//   elementsFromPoint(135, 287) → [card, root, root] — the tab is ABSENT      ⇒ not painted there
//
// The app content box is 812 − 526 = 286 px; the tabs' lower half lies past it. They are CLIPPED by
// a reservation doing exactly its job, and reachable by scrolling — `scrollIntoViewIfNeeded` returns
// immediately with 17 px of the label visible. Three runs of a P2 were spent on a product that was
// behaving correctly, and the fix that was being contemplated would have changed the inset geometry
// on top of two unverified ones.
//
// WHAT THIS BARRIER DOES, IN TWO HALVES.
//  §1 DISCOVERY BY SHAPE. Every `.elementFromPoint(` in the e2e suites is found by scanning, never
//     from a list anyone has to remember to extend, and must carry a registered reason. The registry
//     is a SHRINK-ONLY ceiling, so a probe added tomorrow is RED until someone states why the
//     singular form is the right question there.
//  §2 EXECUTION. §1 alone is a source-TEXT tripwire, and PART 9.5 is explicit that those pass for
//     the entire time a defect is live. So the REAL probe body is lifted out of `run.mjs` and RUN
//     against a stub DOM: a clipped control must produce no finding, a genuinely covered one must
//     still produce one, and a neighbour capture must still be a capture.
//
// Run: node --experimental-strip-types scripts/verify-ownership-probes-use-the-painted-stack.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';
import { classifyTapOwnership } from '../e2e/journeys/harness.mjs';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (m: string, cond: boolean) => {
  if (cond) console.log(`  ok  ${m}`);
  else { console.error(`  FAIL  ${m}`); failed++; }
};
/** An EXECUTABLE proof: the barrier's own predicate, applied to a deliberately broken input. */
const mustCatch = (what: string, caught: boolean) => check(`(mutation) catches ${what}`, caught);

// ═══ §1 · every singular hit test in the e2e suites is discovered and must be justified ═════════
//
// THE ONLY LEGITIMATE USE, and the reason this is a registry rather than a ban: «what will my click
// actually hit» is a question about the TOP of the stack by definition, and the singular form is the
// right tool for it. «Does this control own its own area» is a question about the whole stack. The
// registry records which question each site is asking.
const ALLOWED: Record<string, { count: number; reason: string }> = {
  'e2e/journeys/harness.mjs': {
    count: 1,
    reason: 'closeMobileSidebar: a PRE-CLICK test asking whether the backdrop is the topmost element '
      + 'before clicking it, so that a click never lands on a sidebar row instead. The topmost element '
      + 'is precisely what it needs, and it renders no verdict about any control owning its area.',
  },
};
// SHRINK-ONLY. Raising this is a deliberate, reviewed edit that must come with a registry reason.
const SINGULAR_HIT_TEST_CEILING = 1;

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(mjs|js|ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
};

console.log('§1 every singular elementFromPoint in e2e/ is discovered by shape and justified');
{
  // Comment lines are excluded from the corpus on purpose. Both repaired probes, and the two
  // barriers over them, explain the rule in prose that names the forbidden call — a corpus built
  // from raw file text would flag every explanation as a violation and push the next author to
  // delete the explanation rather than the call. (Same reasoning as
  // verify-e2e-targets-still-exist-in-the-product.ts, which excludes comments for the mirror image
  // of this reason.)
  const codeOnly = (src: string) => src.split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

  const found: Record<string, number> = {};
  for (const file of walk(join(ROOT, 'e2e'))) {
    const rel = relative(ROOT, file);
    const hits = (codeOnly(readFileSync(file, 'utf8')).match(/\.elementFromPoint\s*\(/g) || []).length;
    if (hits) found[rel] = hits;
  }

  const total = Object.values(found).reduce((a, b) => a + b, 0);
  console.log(`  discovered: ${total} singular hit test(s) across ${Object.keys(found).length} file(s)`);
  for (const [f, n] of Object.entries(found)) console.log(`    ${f}: ${n}`);

  for (const [file, n] of Object.entries(found)) {
    const reg = ALLOWED[file];
    check(`${file} — its ${n} singular hit test(s) are registered with a reason`,
      !!reg && reg.count >= n);
    if (reg && reg.count < n) {
      console.error(`        registered for ${reg.count}, found ${n}: a NEW singular hit test was added here`);
    }
  }
  check(`the singular-hit-test count is at or below its shrink-only ceiling (${total} <= ${SINGULAR_HIT_TEST_CEILING})`,
    total <= SINGULAR_HIT_TEST_CEILING);
  // A registry entry that no longer matches anything is stale, and a stale ratchet reads better than
  // reality — the same failure `verify-every-rpc-call-is-bounded.ts` turns RED for.
  for (const file of Object.keys(ALLOWED)) {
    check(`the registry entry for ${file} still describes a real call site (not stale)`, !!found[file]);
  }

  // ── §1b · CALLING THE PLURAL FORM IS NOT ASKING THE PLURAL QUESTION ───────────────────────────
  // routine #6, 2026-09-25. §1 above discovers by CALL SHAPE, matching `.elementFromPoint(`. That
  // leaves the same question askable in a spelling it cannot see: take the PLURAL stack, then read
  // only `stack[0]` — which is, by definition, exactly what the singular form returns.
  //
  // MEASURED, not hypothetical. `onetap-clear-of-controls` did this, in the very function whose
  // comment claims «`elementsFromPoint` (PLURAL), not `elementFromPoint`» as a virtue:
  //     const stack = document.elementsFromPoint(cx, cy);
  //     const t = stack[0] || null;
  //     isSelf: !!t && (t === el || t.contains(el) || el.contains(t))
  // so a control CLIPPED out of the app's shortened content box — absent from the painted stack
  // entirely, which is ops_incident #377's whole finding — was indistinguishable from one genuinely
  // covered, and the journey filed «an overlay is covering «بحث»» 2/2 on the 2026-09-25 production
  // sweep. §1 stayed green throughout. The PART 1.11 shape, one level down: a pointer reads as
  // coverage.
  //
  // WHAT IS ASSERTED, and why it is not a ban on `[0]`. Reading the top of the stack to NAME what is
  // there is a description, and a good failure message needs it — three sites in this repo do
  // exactly that and are right to. The invariant is not "never index 0"; it is that a probe deciding
  // ownership must compute MEMBERSHIP OVER THE WHOLE STACK. So this requires, per call site, that
  // the stack the call returns is interrogated with findIndex/some/includes/indexOf — the only forms
  // that can answer "is the control in here at all". A site that binds the stack and never asks is
  // the violation, and that is precisely what the defect looked like.
  //
  // PER CALL SITE, never per file: run.mjs holds six of these, and a per-file check would let one
  // bad site hide behind five good ones — the neighbourhood flaw AGENTS.md names for the RPC
  // ratchet, where proximity stood in for a per-call fact.
  console.log('§1b every elementsFromPoint site asks MEMBERSHIP over the stack, not just its top');
  {
    const MEMBERSHIP = /\.(findIndex|some|includes|indexOf)\s*\(/;
    let sites = 0, bad = 0;
    for (const file of walk(join(ROOT, 'e2e'))) {
      const rel = relative(ROOT, file);
      const src = codeOnly(readFileSync(file, 'utf8'));
      const re = /\bconst\s+(\w+)\s*=\s*[^;\n]*\.elementsFromPoint\s*\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        sites++;
        const name = m[1];
        // The window after the binding, bounded so this stays a statement about THIS site.
        const after = src.slice(m.index, m.index + 900);
        const asksMembership = new RegExp(`\\b${name}\\s*${MEMBERSHIP.source}`).test(after)
          // A for/of scan over the whole stack answers the same question.
          || new RegExp(`for\\s*\\((?:const|let)\\s+\\w+\\s+of\\s+${name}\\b`).test(after);
        if (!asksMembership) {
          bad++;
          console.error(`        ${rel}: the stack bound as «${name}» is never interrogated for membership `
            + `— reading only its top is the singular question in plural clothing`);
        }
      }
    }
    console.log(`  discovered: ${sites} elementsFromPoint site(s)`);
    check('every elementsFromPoint site was actually FOUND (a discovery that finds nothing cannot fail)',
      sites > 0);
    check(`every elementsFromPoint site asks membership over the whole stack (${sites - bad}/${sites})`,
      bad === 0);
  }

  // The two repaired probes, asserted positively: they must ASK with the plural form.
  const runner = readFileSync(join(ROOT, 'e2e/journeys/run.mjs'), 'utf8');
  const guardian = readFileSync(join(ROOT, 'e2e/guardian/journeys.mjs'), 'utf8');
  check('tap-targets-meet-44 reads the painted stack and asks whether IT is painted there',
    /const stack = document\.elementsFromPoint\(x, y\)/.test(runner)
      && /stack\.some\(\(n\) => n === e \|\| e\.contains\(n\)\)/.test(runner));
  // PAINT IS ASKED ABOUT `e`, OWNERSHIP ABOUT `outer(top)` — never collapsed into one index. See
  // scenario E: collapsing them silences the nested-control finding.
  check('the ownership question is still the untouched outer(top) === e test',
    /const o = hit \? outer\(hit\) : null;\s*\n\s*if \(o === e\) continue;/.test(runner));
  check('the guardian CTA-coverage oracle reads the painted stack, and answers UNKNOWN when unpainted',
    /document\.elementsFromPoint\(r\.x \+ r\.width \/ 2/.test(guardian)
      && /if \(!stack\.length \|\| self < 0\) ctaCovered = null;/.test(guardian));
}

// ═══ §2 · the REAL probe body, executed against a stub DOM ══════════════════════════════════════
console.log('\n§2 the real tap-targets-meet-44 probe, lifted from run.mjs and executed');

/**
 * Lift the journey's own READ string out of the source, so this proves the SHIPPED probe.
 *
 * `transform` re-breaks that real source IN MEMORY for the mutation proofs in §2b. Nothing on disk
 * is touched — a mutant that cannot be left behind cannot be committed by a concurrent session,
 * which matters in this shared working directory.
 */
function liftRead(transform?: (s: string) => string): string {
  const raw = readFileSync(join(ROOT, 'e2e/journeys/run.mjs'), 'utf8');
  const src = transform ? transform(raw) : raw;
  if (transform && src === raw) throw new Error('the mutation anchor missed — nothing changed');
  const start = src.indexOf("JOURNEYS['tap-targets-meet-44']");
  if (start < 0) throw new Error('tap-targets-meet-44 not found — the probe could not be lifted');
  const readAt = src.indexOf('const READ = `', start);
  if (readAt < 0) throw new Error('the READ template was not found inside tap-targets-meet-44');
  const open = src.indexOf('`', readAt);
  const close = src.indexOf('`;', open + 1);
  if (close < 0) throw new Error('the READ template is unterminated');
  return src.slice(open + 1, close);
}

type StubEl = {
  tagName: string; id: string; className: string; nodeType: number;
  dataset: Record<string, string>; innerText: string; parentElement: StubEl | null;
  _rect: { x: number; y: number; width: number; height: number };
  _css: Record<string, string>; _attrs: Record<string, string>;
  getBoundingClientRect(): Record<string, number>;
  getAttribute(n: string): string | null;
};

const mkEl = (o: Partial<StubEl> & {
  rect?: { x: number; y: number; width: number; height: number };
  css?: Record<string, string>; attrs?: Record<string, string>; parent?: StubEl | null;
}): StubEl => {
  const rect = o.rect ?? { x: 0, y: 0, width: 0, height: 0 };
  const el: StubEl = {
    tagName: (o.tagName ?? 'DIV').toUpperCase(),
    id: o.id ?? '', className: o.className ?? '', nodeType: 1,
    dataset: o.dataset ?? {}, innerText: o.innerText ?? '',
    parentElement: (o.parent ?? null) as StubEl | null,
    _rect: rect,
    _css: { cursor: 'auto', visibility: 'visible', display: 'block', pointerEvents: 'auto',
            zIndex: 'auto', position: 'static', ...(o.css ?? {}) },
    _attrs: o.attrs ?? {},
    getBoundingClientRect: () => ({
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height,
    }),
    getAttribute: (n: string) => (n in (o.attrs ?? {}) ? (o.attrs as Record<string, string>)[n] : null),
    // The probe asks `e.contains(n)` — paint is a question about `e` AND ITS OWN SUBTREE, so the
    // stub must answer it the way a DOM does rather than by identity alone.
    contains(n: StubEl | null) {
      for (let x = n; x; x = x.parentElement) if (x === this) return true;
      return false;
    },
  } as StubEl & { contains(n: StubEl | null): boolean };
  return el;
};

/**
 * Run the lifted probe against a stub document.
 * `stackAt(x, y)` is the painted stack the browser would return at that point — the ONE thing the
 * scenarios below vary.
 */
function runProbe(opts: {
  control: StubEl; root: StubEl; body: StubEl;
  stackAt: (x: number, y: number) => StubEl[];
  /** Re-break the real run.mjs source in memory — used only by the §2b mutation proofs. */
  transform?: (s: string) => string;
}) {
  const READ = liftRead(opts.transform);
  const doc = {
    body: opts.body,
    documentElement: { scrollWidth: 375, clientWidth: 375 },
    querySelectorAll: (sel: string) => (sel === '[data-tap44="1"]' ? [opts.control] : []),
    elementsFromPoint: (x: number, y: number) => opts.stackAt(x, y),
    // `elementFromPoint` IS provided, and returns the top of the same stack, exactly as a browser
    // would. Omitting it was the first version of this stub and it was the weaker one: a probe that
    // regressed to the singular form would then THROW, and a crash is not behavioural evidence — the
    // rule verify-journey-tap-ownership-discriminator.ts states in its own mutation runner. With it
    // present, the old code RUNS and produces its wrong verdict, so the mutation is killed by what
    // the probe ANSWERS rather than by it falling over.
    elementFromPoint: (x: number, y: number) => opts.stackAt(x, y)[0] ?? null,
  };
  const getComputedStyle = (el: StubEl, pseudo?: string) => (pseudo === '::after'
    ? { position: 'absolute', width: '44px', height: '44px' }
    : el._css);
  const fn = new Function('document', 'window', 'getComputedStyle', 'innerWidth', 'innerHeight',
    'scrollX', 'scrollY', `return ${READ}`);
  return fn(doc, { visualViewport: null }, getComputedStyle, 375, 812, 0, 0);
}

// The measured geometry: «تصفية» at [82,269,106,36] in a 375x812 viewport, consent card 0,286,375,272.
const CTRL_RECT = { x: 82, y: 269, width: 106, height: 36 };
const scene = () => {
  const body = mkEl({ tagName: 'BODY' });
  const root = mkEl({ tagName: 'DIV', rect: { x: 0, y: 0, width: 375, height: 812 }, parent: body });
  const control = mkEl({
    tagName: 'DIV', className: 'css-g5y9jx', rect: CTRL_RECT, parent: root,
    css: { cursor: 'pointer' }, attrs: { 'aria-label': 'تصفية', 'data-tap44': '1' },
  });
  const card = mkEl({
    tagName: 'DIV', className: 'css-g5y9jx', rect: { x: 0, y: 286, width: 375, height: 272 },
    parent: root, css: { position: 'fixed', zIndex: '38', pointerEvents: 'auto' },
  });
  return { body, root, control, card };
};

{
  // A · THE MEASURED CASE. The control is painted only above y=286; below that the card is painted
  // and the control is absent from the stack. No finding may come out of this.
  const s = scene();
  const out = runProbe({
    control: s.control, root: s.root, body: s.body,
    stackAt: (_x, y) => (y >= 286 ? [s.card, s.root] : [s.control, s.root]),
  });
  const c = out.ctrls[0];
  const { stolen, blind, clipped } = classifyTapOwnership(c.stolen);
  check('A · a control clipped below the reserved band produces NO capture and NO blind finding',
    Object.keys(stolen).length === 0 && Object.keys(blind).length === 0);
  check('A · the clipped points are COUNTED, not dropped — 4 of the 5 probed points lie past the clip',
    Object.keys(clipped).length === 4);
  check('A · the point still inside the painted area is owned, and never reaches the classifier',
    !('top' in clipped) && !('top' in stolen) && !('top' in blind));
}
{
  // B · THE DIRECTION THAT MUST NOT BE WEAKENED. Same geometry, but the control IS painted under
  // the card — a real cover-up. Every point must still be a finding.
  const s = scene();
  const out = runProbe({
    control: s.control, root: s.root, body: s.body,
    stackAt: () => [s.card, s.control, s.root],
  });
  const c = out.ctrls[0];
  const { stolen, blind, clipped } = classifyTapOwnership(c.stolen);
  check('B · a control genuinely PAINTED under an overlay is still a finding at all five points',
    Object.keys(blind).length === 5 && Object.keys(clipped).length === 0 && Object.keys(stolen).length === 0);
  check('B · the finding still names the overlay, its box and its z-index',
    blind.centre.includes('z=38') && blind.centre.includes('0,286'));
}
{
  // C · the journey's ORIGINAL finding — a neighbouring control capturing the press — is untouched.
  const s = scene();
  const neighbour = mkEl({
    tagName: 'DIV', rect: { x: 60, y: 260, width: 200, height: 60 }, parent: s.root,
    css: { cursor: 'pointer' }, attrs: { 'aria-label': 'sidebar-toggle' },
  });
  const out = runProbe({
    control: s.control, root: s.root, body: s.body,
    stackAt: () => [neighbour, s.control, s.root],
  });
  const c = out.ctrls[0];
  const { stolen, clipped } = classifyTapOwnership(c.stolen);
  check('C · a neighbouring control capturing the point is still a capture, named by that control',
    stolen.centre === 'sidebar-toggle' && Object.keys(clipped).length === 0);
}
{
  // D · an EMPTY stack is the #120 WebKit shape and must stay blind — the probe reports
  // `paintedHere: null` there precisely so this cannot be folded into the clipped bucket.
  const s = scene();
  const out = runProbe({ control: s.control, root: s.root, body: s.body, stackAt: () => [] });
  const c = out.ctrls[0];
  const { blind, clipped } = classifyTapOwnership(c.stolen);
  check('D · an EMPTY painted stack is blind at all five points, never clipped (#120 stays visible)',
    Object.keys(blind).length === 5 && Object.keys(clipped).length === 0);
}

{
  // E · THE REGRESSION THIS SPLIT EXISTS TO PREVENT. `e` is NESTED inside a larger control, which is
  // the «a control no longer owns its own visual area» finding the journey was built for. A first
  // version of the repair asked paint and ownership with one index — `findIndex(n => outer(n) === e)`
  // — and `outer()` walks to the OUTERMOST control, so it never returns a NESTED `e`: the index came
  // back -1 and this finding would have been silenced as «clipped». Paint is asked about `e` and its
  // own subtree; ownership stays the untouched `outer(top) === e` test.
  const s = scene();
  const wrapper = mkEl({
    tagName: 'DIV', rect: { x: 60, y: 260, width: 200, height: 60 }, parent: s.root,
    css: { cursor: 'pointer' }, attrs: { 'aria-label': 'mode-switch-track' },
  });
  s.control.parentElement = wrapper;
  const inner = mkEl({ tagName: 'SPAN', rect: CTRL_RECT, parent: s.control });
  const out = runProbe({
    control: s.control, root: s.root, body: s.body,
    stackAt: () => [inner, s.control, wrapper, s.root],
  });
  const c = out.ctrls[0];
  const { stolen, clipped, blind } = classifyTapOwnership(c.stolen);
  check('E · a control NESTED inside a larger control is still a capture — never silenced as clipped',
    stolen.centre === 'mode-switch-track' && Object.keys(clipped).length === 0
      && Object.keys(blind).length === 0);
  check('E · the nested control is correctly measured as PAINTED (its own descendant is on top)',
    c.stolen.centre.paintedHere === true);
}

// ═══ §2b · MUTATIONS — the real run.mjs source, re-broken in memory and re-executed ════════════
//
// The scenarios above assert the probe is right today. These assert this barrier would NOTICE if it
// stopped being right — the distinction `verify-new-barriers-are-mutation-proven.ts` exists to
// enforce, and the one a green check cannot make about itself. Each mutant rewrites the REAL
// `run.mjs` text in memory (never on disk — a mutant that cannot be left behind cannot be committed
// by a concurrent session in this shared working directory) and runs the result.
console.log('\n§2b mutations — the real probe, deliberately re-broken');
{
  const s = scene();
  const clippedStack = (_x: number, y: number) => (y >= 286 ? [s.card, s.root] : [s.control, s.root]);
  const findings = (r: { stolen: Record<string, unknown> }) => {
    const { stolen, blind } = classifyTapOwnership(r.stolen);
    return Object.keys(stolen).length + Object.keys(blind).length;
  };

  // M1 — THE DEFECT ITSELF: go back to the singular top-hit. The clipped tab is filed again, which
  // is the «تصفية» / «الوسيط الذكي» half of ops_incident #262, filed three times.
  {
    const out = runProbe({
      control: s.control, root: s.root, body: s.body, stackAt: clippedStack,
      transform: (src) => src.replace(
        'const paintedHere = stack.length === 0 ? null : stack.some((n) => n === e || e.contains(n));',
        'const paintedHere = stack.length === 0 ? null : true;'),
    });
    mustCatch('reverting to the singular top-hit verdict, so a clipped control is filed as covered (#262)',
      findings(out.ctrls[0]) === 4);
  }

  // M2 — THE QUIET DIRECTION: assume nothing is ever painted, which would excuse EVERY point on
  // every control as «clipped» and turn this journey into a check that cannot fail.
  {
    const covered = scene();
    const out = runProbe({
      control: covered.control, root: covered.root, body: covered.body,
      stackAt: () => [covered.card, covered.control, covered.root],
      transform: (src) => src.replace(
        'const paintedHere = stack.length === 0 ? null : stack.some((n) => n === e || e.contains(n));',
        'const paintedHere = stack.length === 0 ? null : false;'),
    });
    mustCatch('excusing every point as clipped, which would retire the cover-up finding entirely',
      findings(out.ctrls[0]) === 0);
  }

  // M3 — collapsing paint into the OWNERSHIP index. `outer()` walks to the outermost control, so it
  // never returns a NESTED `e`: scenario E's real capture would be silenced as «clipped».
  {
    const n = scene();
    const wrapper = mkEl({
      tagName: 'DIV', rect: { x: 60, y: 260, width: 200, height: 60 }, parent: n.root,
      css: { cursor: 'pointer' }, attrs: { 'aria-label': 'mode-switch-track' },
    });
    n.control.parentElement = wrapper;
    const inner = mkEl({ tagName: 'SPAN', rect: CTRL_RECT, parent: n.control });
    const out = runProbe({
      control: n.control, root: n.root, body: n.body,
      stackAt: () => [inner, n.control, wrapper, n.root],
      transform: (src) => src.replace(
        'stack.some((n) => n === e || e.contains(n))',
        'stack.findIndex((n) => outer(n) === e) >= 0'),
    });
    const { stolen, clipped } = classifyTapOwnership(out.ctrls[0].stolen);
    mustCatch('collapsing paint into the ownership index, silencing a NESTED control\'s real capture',
      Object.keys(stolen).length === 0 && Object.keys(clipped).length > 0);
  }

  // M4 — the DISCOVERY half, proven on its own predicate: an unregistered singular call site must be
  // rejected. Applied to a synthetic corpus so the proof does not depend on the repo's real counts.
  {
    const verdict = (found: Record<string, number>, allowed: Record<string, { count: number }>, ceiling: number) => {
      const total = Object.values(found).reduce((a, b) => a + b, 0);
      const unregistered = Object.entries(found).filter(([f, n]) => !allowed[f] || allowed[f].count < n);
      return { ok: unregistered.length === 0 && total <= ceiling, unregistered: unregistered.map(([f]) => f) };
    };
    mustCatch('a NEW unregistered singular hit test in a fresh e2e file',
      !verdict({ 'e2e/journeys/harness.mjs': 1, 'e2e/journeys/newprobe.mjs': 1 }, ALLOWED, SINGULAR_HIT_TEST_CEILING).ok);
    mustCatch('a SECOND singular hit test sneaking into an already-registered file',
      !verdict({ 'e2e/journeys/harness.mjs': 2 }, ALLOWED, SINGULAR_HIT_TEST_CEILING).ok);
    check('…while the repo\'s real, registered state still passes that same predicate',
      verdict({ 'e2e/journeys/harness.mjs': 1 }, ALLOWED, SINGULAR_HIT_TEST_CEILING).ok);
  }

  // M5 — the lift itself must fail LOUDLY rather than silently proving nothing. A barrier whose
  // fixture quietly becomes empty is the «tidy skip» of PART 9.5.
  {
    let threw = false;
    try { liftRead((src) => src.replace("JOURNEYS['tap-targets-meet-44']", "JOURNEYS['renamed-away']")); }
    catch { threw = true; }
    mustCatch('the probe being renamed out from under this barrier (the lift fails closed, never green)', threw);
  }
}

console.log('\n§3 wiring');
check('this barrier runs in npm test', npmTestRuns(ROOT, 'verify-ownership-probes-use-the-painted-stack'));

if (failed) {
  console.error(`\nverify-ownership-probes-use-the-painted-stack: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nverify-ownership-probes-use-the-painted-stack: an ownership verdict reads the whole stack.');
