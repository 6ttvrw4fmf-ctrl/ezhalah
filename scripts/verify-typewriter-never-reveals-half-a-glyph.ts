// THE TYPEWRITER MUST NEVER PUT HALF A GLYPH ON SCREEN.
//
// ops_incident #347, measured on production 2026-09-19 by routine #9. `Typer` in src/app/agent.tsx
// revealed `text.slice(0, n)` with `n` counted in UTF-16 CODE UNITS. A non-BMP emoji is two code
// units, so the frame at n = length-1 renders a LONE HIGH SURROGATE — the ▯ replacement box. Twenty
// of the forty Results-Found templates the app ships end in exactly such an emoji.
//
// That frame is supposed to last one 24 ms tick. It does not always. Measured live on
// ezhalah-app.vercel.app in three independent runs, with the harness silent for 90 seconds so it
// could not be starving what it measured, after the second «عرض المزيد» press (500 cards):
//
//     "لقينا لك 72,470 نتيجة تطابق بحثك \ud83c"       34 of 35 code units — frozen
//     "لقينا 72,470 نتيجة تطابق اللي بحثت عنه \ud83d"   40 of 41 code units — frozen
//
// A real user was left looking at a broken box on the sentence quoting their result count, and the
// pool-derived parser in e2e/lib/resultsSentence.mjs correctly read null from it — which is the
// unattributed "headline 21,384 -> null" of ops_incident #331.
//
// WHY THIS CHECK IS SHAPED THE WAY IT IS. AGENTS.md and PRODUCTION_RED_TEAM_ENGINEER.md PART 3.3 name
// the four ways a barrier goes green over a live defect, and this file is deliberately none of them:
//
//   · it does not assert source text — no `includes('revealPrefix')`, no regex over agent.tsx. A
//     refactor that keeps the string and restores the code-unit slice must go RED;
//   · it does not supply its own input — the corpus is the app's OWN shipped pool, read from
//     src/data/resultsFoundRotation.ts through the same extractor the live harness uses;
//   · it does not test a copy — it imports and EXECUTES the real src/lib/typedReveal.ts, and it
//     LIFTS the real `Typer`/`BrandReveal` render expressions out of src/app/agent.tsx to prove the
//     shipped components are the ones wired to it;
//   · it is mutation-proven — §G.9(4). The defect is re-introduced (a code-unit slice) and the
//     predicate is watched to go RED for that reason, then restored and watched to go GREEN, so a
//     vacuously-red predicate fails here too.
//
// SCOPE, stated so nobody reads more into a green than it carries: this proves no FRAME contains
// half a glyph. It does NOT prove the reveal ever finishes — the freeze itself is a separate,
// still-open defect (ops_incident #347), and a frozen-but-well-formed sentence passes this check.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { glyphsOf, revealPrefix, glyphCount, truncateGlyphs, hasLoneSurrogate } from '../src/lib/typedReveal.ts';
import { shippedTemplates } from '../e2e/lib/resultsSentence.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENT = join(ROOT, 'src', 'app', 'agent.tsx');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
  if (!ok) failures++;
};

// ── 1. THE CORPUS IS WHAT THE APP SHIPS, not a list invented here ────────────────────────────────
const templates = shippedTemplates().map((t: { template: string }) => t.template);
check('the shipped Results-Found pool was read (corpus is the app\'s own, not this file\'s)',
  templates.length >= 40, `${templates.length} template(s)`);

// The corpus must actually CONTAIN the hazard, or every assertion below is vacuous.
const nonBmp = templates.filter((t) => [...t].some((c) => (c.codePointAt(0) ?? 0) > 0xffff));
check('the corpus contains templates with non-BMP characters (the hazard is really present)',
  nonBmp.length >= 10, `${nonBmp.length} of ${templates.length} carry a surrogate pair`);

// Real rendered sentences, not raw templates: {count}/{name} are substituted the way the app does.
const rendered = templates.map((t) => t.split('{count}').join('72,470').split('{name}').join('يوسف'));
// Plus the strings actually observed frozen on production, and the other typed surfaces' shapes.
const corpus = [
  ...rendered,
  'وصلت لآخر «عرض المزيد» — هذي آخر 500 إعلان أقدر أعرضها لك 🎉',
  'إزهله! 🏡 لقينا لك نتائج',          // BrandReveal shape: brand prefix + body
  '👨‍👩‍👧‍👦 ZWJ family sequence',        // ZWJ: code points alone would split this
  'variation selector 🏘️ inside',      // U+1F3D8 U+FE0F — a shipped template really uses this
  'مرحبا',                              // pure BMP — the reveal must still work normally
  '',                                   // empty — must not throw
];

// ── 2. THE PREDICATE, EXECUTED AT EVERY FRAME OF EVERY STRING ────────────────────────────────────
/** Every prefix the animation can render, for every n from 0 past the end. */
function framesOf(text: string, slice: (t: string, n: number) => string): string[] {
  const out: string[] = [];
  for (let n = 0; n <= glyphCount(text) + 2; n++) out.push(slice(text, n));
  return out;
}

function brokenFrames(text: string, slice: (t: string, n: number) => string): { n: number; frame: string }[] {
  return framesOf(text, slice)
    .map((frame, n) => ({ n, frame }))
    .filter(({ frame }) => hasLoneSurrogate(frame));
}

const allBroken = corpus.flatMap((t) => brokenFrames(t, revealPrefix).map((b) => ({ text: t, ...b })));
check('NO frame of any shipped sentence contains half a glyph',
  allBroken.length === 0,
  allBroken.length
    ? `${allBroken.length} broken frame(s), e.g. n=${allBroken[0].n} of ${JSON.stringify(allBroken[0].text.slice(0, 40))} -> ${JSON.stringify(allBroken[0].frame.slice(-8))}`
    : `${corpus.length} strings x every frame, all well-formed`);

// A reveal that never shows a broken frame by showing NOTHING is not a reveal. Prove it advances and
// lands on the original string byte-for-byte — re-joining segments must not alter the finished text.
const lossy = corpus.filter((t) => revealPrefix(t, glyphCount(t)) !== t);
check('the completed reveal equals the ORIGINAL string, byte for byte',
  lossy.length === 0, lossy.length ? `${lossy.length} altered, e.g. ${JSON.stringify(lossy[0])}` : `${corpus.length} strings round-trip exactly`);

const notAdvancing = rendered.filter((t) => {
  const seen = new Set(framesOf(t, revealPrefix));
  return seen.size < Math.min(5, glyphCount(t));
});
check('the reveal genuinely ADVANCES (distinct frames), not a no-op that is trivially well-formed',
  notAdvancing.length === 0, notAdvancing.length ? `${notAdvancing.length} string(s) produced too few distinct frames` : 'every template produces a growing sequence of frames');

check('revealPrefix clamps out-of-range n instead of throwing or truncating mid-glyph',
  revealPrefix('a🎉', 99) === 'a🎉' && revealPrefix('a🎉', 0) === '' && revealPrefix('a🎉', -1) === '',
  `n=99 -> ${JSON.stringify(revealPrefix('a🎉', 99))}, n=0 -> ${JSON.stringify(revealPrefix('a🎉', 0))}`);

// ZWJ + variation selectors need GRAPHEME segmentation, not merely code points.
const family = '👨‍👩‍👧‍👦';
check('a ZWJ emoji sequence is ONE reveal step (grapheme segmentation, not code points)',
  glyphCount(family) === 1, `glyphCount(${family}) = ${glyphCount(family)} (code points would be ${[...family].length})`);
check('a variation-selector emoji is ONE reveal step',
  glyphCount('🏘️') === 1, `glyphCount = ${glyphCount('🏘️')} (code points would be ${[...'🏘️'].length})`);

// ── 3. THE SHIPPED COMPONENTS ARE WIRED TO IT ────────────────────────────────────────────────────
// Not a text tripwire for its own sake: this reads the REAL render expressions out of agent.tsx and
// asserts they do not slice the raw string. A file that went back to `text.slice(0, n)` fails here
// even if src/lib/typedReveal.ts is still perfect — which is exactly the regression to catch, since
// every assertion above would stay green through it.
const agentSrc = readFileSync(AGENT, 'utf8');
const typerBody = agentSrc.slice(agentSrc.indexOf('function Typer('), agentSrc.indexOf('function BrandReveal('));
const brandBody = agentSrc.slice(agentSrc.indexOf('function BrandReveal('), agentSrc.indexOf('function BrandReveal(') + 1400);
// Every detail string below must READ TRUE IN BOTH STATES — it is printed on PASS as well as FAIL.
// A green line whose own evidence says "no call found" is worse than no evidence: this repo has
// already shipped one (run 33168150595, «PASS … the restored card never rendered»).
for (const [name, body] of [['Typer', typerBody], ['BrandReveal', brandBody]] as const) {
  const viaHelper = /revealPrefix\s*\(/.test(body);
  check(`${name} reveals through the glyph-safe helper`, viaHelper,
    viaHelper ? 'revealPrefix( is called in the shipped component' : 'NO revealPrefix( call in the shipped component — it is not wired to the fix');
  // The specific defect: a raw code-unit slice of the text being revealed.
  const rawSlice = /\b(?:text|full)\s*\.slice\s*\(\s*0\s*,\s*n\s*\)/.test(body);
  check(`${name} does NOT slice the raw string by code unit`, !rawSlice,
    rawSlice ? 'found `.slice(0, n)` on the revealed string — the ops_incident #347 defect' : 'no raw `.slice(0, n)` on the revealed string');
  const glyphTotal = /glyphCount\s*\(/.test(body);
  check(`${name} counts its total in glyphs`, glyphTotal,
    glyphTotal ? 'glyphCount( supplies the reveal total' : 'no glyphCount( — the total is still a code-unit .length');
}

// ── 3b. THE SIBLINGS — the same mechanism in its TRUNCATION form (§G.9(2)) ───────────────────────
// The reveal is not the only place this codebase cut a string by code unit. Two more display or
// PERSIST the result, and both were found by hunting the mechanism rather than the symptom:
//   · src/data/remote.ts   — source free-text attributes shown on the property card
//   · src/store.tsx        — a user's own chat rename, pushed to the server
// A truncation boundary inside a surrogate pair leaves the same ▯ box, permanently.
const hazards = [
  'قوانين المنزل: ممنوع التدخين داخل الشقة 🚭 والالتزام بالهدوء بعد الساعة العاشرة مساءً 🌙 ويمنع اصطحاب الحيوانات 🐾 نرجو الالتزام بالتعليمات كاملة شكراً لتعاونكم معنا دائماً 🙏',
  'a'.repeat(119) + '🎉',          // the pair sits EXACTLY on a 120-unit boundary
  'b'.repeat(116) + '🎉 tail',      // the pair sits exactly on the 117-unit ellipsis boundary
  ...rendered,
];
for (const max of [120, 117, 40, 8, 2, 1]) {
  const bad = hazards.filter((t) => hasLoneSurrogate(truncateGlyphs(t, max)));
  check(`truncateGlyphs(max=${max}) never leaves half a glyph`, bad.length === 0,
    bad.length ? `${bad.length} truncation(s) ended mid-pair, e.g. ${JSON.stringify(truncateGlyphs(bad[0], max).slice(-6))}`
               : `${hazards.length} hazardous strings, all truncated cleanly`);
  const over = hazards.filter((t) => glyphCount(truncateGlyphs(t, max)) > max);
  check(`truncateGlyphs(max=${max}) respects the caller's budget`, over.length === 0,
    over.length ? `${over.length} result(s) exceeded ${max} glyphs` : `every result is <= ${max} glyphs`);
}
check('truncateGlyphs returns a short string byte for byte (no gratuitous ellipsis)',
  truncateGlyphs('مرحبا 🎉', 50) === 'مرحبا 🎉' && truncateGlyphs('', 10) === '',
  `got ${JSON.stringify(truncateGlyphs('مرحبا 🎉', 50))}`);
check('truncateGlyphs with an empty ellipsis is a pure cap (the chat-rename shape)',
  truncateGlyphs('x'.repeat(130) + '🎉', 120, '') === 'x'.repeat(120)
  && !hasLoneSurrogate(truncateGlyphs('x'.repeat(119) + '🎉', 120, '')),
  'a bare cap must still not split a pair');

// The siblings must be WIRED to it — a helper nothing calls protects nothing.
for (const [file, rel] of [['src/data/remote.ts', 'remote.ts'], ['src/store.tsx', 'store.tsx']] as const) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const wired = /truncateGlyphs\s*\(/.test(src);
  check(`${rel} truncates user-visible text through truncateGlyphs`, wired,
    wired ? 'truncateGlyphs( is called' : 'NO truncateGlyphs( call — this site still cuts by code unit');
  // The exact retired expressions, so a revert is caught by shape and not merely by absence.
  const retired = /\.slice\(0,\s*117\)\s*\+\s*'…'/.test(src) || /\.trim\(\)\.slice\(0,\s*120\)/.test(src);
  check(`${rel} does not carry the retired code-unit truncation`, !retired,
    retired ? 'the pre-#347 `.slice(0, 117) + \'…\'` / `.trim().slice(0, 120)` shape is back' : 'the retired shape is absent');
}

// ── 4. MUTATION PROOF — re-introduce the defect and WATCH the predicate go red (§G.9(4)) ─────────
// A barrier nobody has seen fail is a comment that runs. `mustCatch` applies THIS barrier's own
// predicate (hasLoneSurrogate over every frame a reveal produces) to the defect it replaced, and to
// the shapes a half-fix would take, and requires it to reject every one — while still accepting the
// real implementation, so a vacuously-red predicate fails here too.
const mustCatch = (label: string, caught: boolean) => {
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) ${label}`);
  if (!caught) failures++;
};

/** Does `slice` ever put half a glyph on screen, across the whole shipped corpus? */
const splitsAGlyph = (slice: (t: string, n: number) => string) =>
  corpus.some((t) => brokenFrames(t, slice).length > 0);

mustCatch('THE INCIDENT: reveal by UTF-16 code unit — `text.slice(0, n)`',
  splitsAGlyph((t, n) => t.slice(0, n)));
mustCatch('a half-fix that clamps n but still slices code units',
  splitsAGlyph((t, n) => t.slice(0, Math.min(n, t.length))));
mustCatch('the real glyph-safe reveal is NOT flagged (the predicate is not vacuously red)',
  !splitsAGlyph(revealPrefix));
mustCatch('nor is a code-point reveal, which also never splits a surrogate pair',
  !splitsAGlyph((t, n) => [...t].slice(0, n).join('')));

// The TRUNCATION form (§G.9(2) — the same mechanism at its sibling call sites).
const truncSplits = (f: (t: string) => string) => hazards.some((t) => hasLoneSurrogate(f(t)));
mustCatch("THE SIBLING: remote.ts's retired `v.slice(0, 117) + '…'`",
  truncSplits((t) => (t.length > 120 ? t.slice(0, 117) + '\u2026' : t)));
mustCatch("THE SIBLING: store.tsx's retired `.trim().slice(0, 120)`",
  truncSplits((t) => t.trim().slice(0, 120)));
mustCatch('the real truncateGlyphs is NOT flagged (not vacuously red)',
  !truncSplits((t) => truncateGlyphs(t, 120)));

// The instrument itself — prove it fires and stays quiet, or every result above is unfounded.
mustCatch('the detector fires on a lone HIGH surrogate', hasLoneSurrogate('\u0628\u062d\u062b\u0643 \ud83c'));
mustCatch('the detector fires on a lone LOW surrogate', hasLoneSurrogate('\udd0d \u0628\u062d\u062b\u0643'));
mustCatch('the detector stays quiet on a well-formed pair', !hasLoneSurrogate('\u0628\u062d\u062b\u0643 \ud83c\udf89'));
mustCatch('the detector stays quiet on plain BMP text', !hasLoneSurrogate('\u0628\u062d\u062b\u0643 \u0646\u062a\u064a\u062c\u0629'));

// glyphsOf must never emit a lone surrogate as a segment, whatever the input.
const segBroken = corpus.flatMap((t) => glyphsOf(t)).filter(hasLoneSurrogate);
check('glyphsOf never emits a segment that is half a pair', segBroken.length === 0,
  segBroken.length ? `${segBroken.length} broken segment(s)` : 'every segment is well-formed');

console.log(failures === 0
  ? '\n✓ the typewriter cannot put half a glyph on screen (ops_incident #347)'
  : `\n✗ ${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
