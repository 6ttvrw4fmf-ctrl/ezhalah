// Barrier: A TRANSFORM INSIDE animationKeyframes IS A CSS STRING, NEVER A REACT-NATIVE ARRAY.
//
// react-native-web (0.21) compiles `transform: [{ translateY: 10 }]` inside animationKeyframes to
// `transform:[object Object]` — an invalid declaration the browser silently drops. Nothing throws and
// the animation still "runs"; it just never moves. Measured 2026-10-10: the result cards' 10px rise
// (CardReveal.tsx `cardRise`) only faded, and the ad page's gold shine + tap ring never moved (#6694).
// A string — 'translateY(10px)' — compiles to a real transform. (Plain style transforms, outside
// keyframes, are fine: RNW stringifies those itself.)
//
// THREE HALVES:
//   1. every animationKeyframes under src/, read with the TypeScript AST (comments and strings can't
//      fool it): its value is an inline array literal, and every `transform` inside is a string;
//   2. the premise, on the INSTALLED react-native-web: a string transform keyframe compiles to a real
//      translateY — an upgrade that breaks strings too goes red here, not silently on the site;
//   3. production's own input: every self-contained keyframes block in src/ (CardReveal's cardRise
//      among them) is lifted from the real source and compiled through react-native-web's real
//      StyleSheet; each of its transform strings must reach the emitted @keyframes verbatim.
//
//   node --experimental-strip-types scripts/verify-keyframe-transforms-are-css-strings.ts   (in `npm test`)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const root = join(import.meta.dirname, '..');
const { StyleSheet } = createRequire(import.meta.url)('react-native-web');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${!ok && detail ? `\n    ${detail}` : ''}`);
  if (!ok) failed++;
};
const mustCatch = (label: string, caught: boolean) => check(`MUTATION — ${label} is caught`, caught);

type Block = { where: string; text: string; transforms: string[]; problems: string[] };
const nameOf = (n: ts.PropertyName) => (ts.isIdentifier(n) || ts.isStringLiteral(n) ? n.text : undefined);

export function keyframeBlocks(file: string, src: string): Block[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Block[] = [];
  const visit = (n: ts.Node) => {
    const kf = (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) && nameOf(n.name) === 'animationKeyframes';
    if (kf) {
      const where = `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
      const value = ts.isPropertyAssignment(n) ? n.initializer : n.name;
      const b: Block = { where, text: value.getText(sf), transforms: [], problems: [] };
      if (!ts.isArrayLiteralExpression(value)) b.problems.push(`animationKeyframes: ${b.text} — not an inline array, so nobody can read its transforms`);
      else {
        const inner = (m: ts.Node) => {
          if (ts.isSpreadAssignment(m)) b.problems.push(`${m.getText(sf)} — a spread inside keyframes can carry an unread transform`);
          if (ts.isShorthandPropertyAssignment(m) && m.name.text === 'transform') b.problems.push('{ transform } shorthand — not a CSS string');
          if (ts.isPropertyAssignment(m) && nameOf(m.name) === 'transform') {
            if (ts.isStringLiteralLike(m.initializer)) b.transforms.push(m.initializer.text);
            else if (!ts.isTemplateExpression(m.initializer)) b.problems.push(`transform: ${m.initializer.getText(sf)} — not a CSS string (RNW emits [object Object])`);
          }
          ts.forEachChild(m, inner);
        };
        inner(value);
      }
      out.push(b);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

// Compile through RNW's real StyleSheet.create and return the @keyframes rules it newly inserted.
const sheetLines = () => (StyleSheet.getSheet().textContent as string).split('\n');
const compile = (keyframes: unknown): string[] => {
  const before = new Set(sheetLines());
  StyleSheet.create({ x: { animationKeyframes: keyframes } });
  return sheetLines().filter((l) => l.startsWith('@keyframes') && !before.has(l));
};
// A block reaches the browser intact when it emitted a rule, no [object Object], and every transform
// string the source wrote appears verbatim in that rule.
const compilesIntact = (rules: string[], transforms: string[]) =>
  rules.length > 0 && rules.every((r) => !r.includes('[object Object]'))
  && transforms.every((t) => rules.some((r) => r.includes(`transform:${t};`)));
// Self-contained = a literal with no free identifiers (blocks built from imported colours are skipped
// here; half 1 still reads their transforms).
const evaluate = (text: string): unknown => { try { return new Function(`return (${text});`)(); } catch { return undefined; } };

// ── 1. every keyframes block in src/ ───────────────────────────────────────────────────────────────
const files = (readdirSync(join(root, 'src'), { recursive: true }) as string[]).filter((f) => /\.[jt]sx?$/.test(f));
const blocks = files.flatMap((f) => keyframeBlocks(`src/${f}`, readFileSync(join(root, 'src', f), 'utf8')));
const bad = blocks.filter((b) => b.problems.length);
// Floor: a walker that stops seeing a directory, or an AST reader that stops matching, must not read
// as "no problems". 2026-10-10: 5 blocks across CardReveal.tsx and ListingPreview.tsx.
const floorOk = (bs: Block[]) => bs.length >= 5
  && ['src/components/CardReveal.tsx', 'src/components/ListingPreview.tsx'].every((f) => bs.some((b) => b.where.startsWith(`${f}:`)));
check(`the scan reads every keyframes block in src/ (${blocks.length} in ${new Set(blocks.map((b) => b.where.split(':')[0])).size} files)`, floorOk(blocks));
check('every transform inside animationKeyframes is a CSS string', bad.length === 0,
  bad.flatMap((b) => b.problems.map((p) => `${b.where}  ${p}`)).join('\n    '));

// ── 2. the premise, on the installed react-native-web ──────────────────────────────────────────────
const premise = compile([{ from: { opacity: 0, transform: 'translateY(7px)' }, to: { opacity: 1, transform: 'translateY(0.5px)' } }]);
check('react-native-web compiles a string keyframe transform to a real translateY', compilesIntact(premise, ['translateY(7px)', 'translateY(0.5px)']), premise.join('\n    '));

// ── 3. production's own blocks, compiled ───────────────────────────────────────────────────────────
const closed = blocks.filter((b) => evaluate(b.text) !== undefined);
const rise = closed.find((b) => b.where.startsWith('src/components/CardReveal.tsx:') && b.transforms.includes('translateY(10px)'));
check("CardReveal's card rise is lifted from the real source (a self-contained block with translateY(10px))", !!rise);
for (const b of closed) {
  const rules = compile(evaluate(b.text));
  check(`${b.where} compiles intact through react-native-web${b.transforms.length ? ` (${b.transforms.join(' → ')})` : ''}`,
    compilesIntact(rules, b.transforms), rules.join('\n    ') || 'no @keyframes rule emitted');
}

// ── mutation proofs ────────────────────────────────────────────────────────────────────────────────
const REVEAL = 'src/components/CardReveal.tsx';
const revealSrc = readFileSync(join(root, REVEAL), 'utf8');
const ARRAY_RISE = "transform: [{ translateY: 10 }] }, to: { opacity: 1, transform: [{ translateY: 0 }] }";
const STRING_RISE = "transform: 'translateY(10px)' }, to: { opacity: 1, transform: 'translateY(0px)' }";
const flagged = (src: string) => keyframeBlocks(REVEAL, src).some((b) => b.problems.length > 0);
check('the mutants below edit the real CardReveal source (its string rise is present)', revealSrc.includes(STRING_RISE));
mustCatch("CardReveal's old transform array", flagged(revealSrc.replace(STRING_RISE, ARRAY_RISE)));
mustCatch('a transform held in a variable', flagged(revealSrc.replace("transform: 'translateY(10px)'", 'transform: RISE')));
mustCatch('keyframes declared out of line', flagged(revealSrc.replace(/animationKeyframes: \[\{ from[^\n]*\],/, 'animationKeyframes: RISE_KF,')));
mustCatch('a spread inside a keyframe', flagged(revealSrc.replace("from: { opacity: 0, transform: 'translateY(10px)' }", 'from: { opacity: 0, ...RISE }')));
mustCatch('a scan that stops seeing CardReveal.tsx', !floorOk(blocks.filter((b) => !b.where.startsWith(`${REVEAL}:`))));
// Half 3 on the bug itself: compiled through RNW, the old array rise loses its transform. If this one
// survives, react-native-web has started compiling arrays — the premise moved, revisit this barrier.
const arrayRules = compile(evaluate(rise ? rise.text.replace(STRING_RISE, ARRAY_RISE) : '[]'));
mustCatch('the old array rise compiled through react-native-web', !!rise && !compilesIntact(arrayRules, ['translateY(10px)', 'translateY(0px)']));

if (failed) { console.error(`\n❌ ${failed} check(s) failed — a keyframe transform that never reaches the browser.`); process.exit(1); }
console.log('\n✅ every keyframe transform in src/ is a CSS string, and react-native-web emits it as a real transform.');
