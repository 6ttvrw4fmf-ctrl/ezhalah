// TRIPWIRE: no text input may render below 16px on web — the iOS Safari focus-zoom trap.
//
// THE DEFECT THIS LOCKS OUT (found on the live site 2026-08-23). The two MANDATORY search fields —
// «في أي مدينة؟» (data-testid=city-input) and the district field (data-testid=district-input) — were
// styled `fontSize: 14`, while the four sibling inputs in the SAME card (area-min/max, price-min/max)
// and the chat composer were already 16. On iOS Safari, focusing an input whose computed font-size is
// under 16px makes the page zoom in — and because the served viewport meta is deliberately
// "width=device-width, initial-scale=1, shrink-to-fit=no" (no maximum-scale, no user-scalable=no, which
// is the accessible choice), Safari never zooms back out. The user was left stuck on a zoomed page at
// the very first step of the core search loop, and had to pinch out by hand.
//
// The same class was live on every other small input: the login sheet's «رقم الجوال» (15), the settings
// name + phone fields (15), the interview custom-answer field (14.5), the sidebar rename field (13.5),
// and both autoFocus'd invisible OTP inputs (no fontSize at all → react-native-web's 14px default; iOS
// zooms to the FOCUSED element regardless of whether it is visible).
//
// WHY A BARRIER AND NOT JUST THE FIX. This is a one-character regression: any future style tweak, any
// newly added <TextInput> that forgets the rule, silently reintroduces it — and it is invisible on
// desktop, which is where it gets reviewed. So this check is generic: it resolves EVERY <TextInput> in
// src/ to the StyleSheet entry that actually wins, and fails if the effective web font-size is < 16.
// It also pins the ACCESSIBLE half of the contract: the fix must never be "disable pinch-zoom".
//
// Hermetic source-parse — no browser, no network. Runs in `npm test`.
//   node --experimental-strip-types scripts/verify-input-font-no-ios-zoom.ts

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIN = 16; // iOS Safari's threshold. Below this it zooms on focus.

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failed++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// ── source discovery ────────────────────────────────────────────────────────────────────────────
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = join(dir, e.name);
  if (e.isDirectory()) return walk(p);
  return e.isFile() && p.endsWith('.tsx') ? [p] : [];
});
const files = walk(join(root, 'src')).sort();

// ── tiny brace-balancing readers (JSX props and object literals both need one) ───────────────────
const balanced = (src: string, open: number, o: string, c: string): string => {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) depth++;
    else if (src[i] === c) { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return '';
};

/** The web-effective fontSize declared by a StyleSheet entry body, or undefined if it declares none. */
const webFontSize = (body: string): number | undefined => {
  // `fontSize: Platform.OS === 'web' ? 16 : 14` / `fontSize: IS_WEB ? 16 : 14` → the web branch.
  const ternary = body.match(/fontSize:\s*(?:Platform\.OS\s*===\s*['"]web['"]|IS_WEB)\s*\?\s*([\d.]+)\s*:/);
  if (ternary) return Number(ternary[1]);
  const literal = body.match(/fontSize:\s*([\d.]+)/);
  return literal ? Number(literal[1]) : undefined;
};

/** Body of `NAME: { ... }` inside a file's StyleSheet.create block. */
const styleBody = (src: string, name: string): string | undefined => {
  const m = src.match(new RegExp(`^\\s*${name}:\\s*\\{`, 'm'));
  if (!m || m.index === undefined) return undefined;
  return balanced(src, src.indexOf('{', m.index), '{', '}');
};

// ── 1. every <TextInput> resolves to an effective web font >= 16 ─────────────────────────────────
let inputs = 0;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const rel = relative(root, file);
  // JSX elements only: `<TextInput ` / `<TextInput\n`. A bare `<TextInput>` is a TYPE position
  // (`useRef<TextInput>(null)`), not an element, and must not be counted.
  for (const el of src.matchAll(/<TextInput\s/g)) {
    const at = el.index!;
    const from = at + '<TextInput'.length;
    // The element's props: everything up to the first top-level `>` that is not inside a {...} prop.
    let depth = 0, end = from;
    for (; end < src.length; end++) {
      if (src[end] === '{') depth++;
      else if (src[end] === '}') depth--;
      else if (src[end] === '>' && depth === 0) break;
    }
    const props = src.slice(from, end);
    const styleAt = props.indexOf('style={');
    if (styleAt < 0) {
      // No style at all → react-native-web's 14px default. Same trap.
      inputs++;
      check(`${rel}: <TextInput> at char ${at} has a style`, false,
        'no style prop → react-native-web defaults to 14px, which zooms iOS on focus');
      continue;
    }
    const styleProp = balanced(props, props.indexOf('{', styleAt), '{', '}');
    inputs++;

    // Inline fontSize on the element would defeat this resolver — forbid it outright.
    if (/fontSize/.test(styleProp)) {
      check(`${rel}: <TextInput> at char ${at} keeps its fontSize in the StyleSheet`, false,
        `inline fontSize in the style prop — move it to the StyleSheet so this barrier can see it: ${styleProp.slice(0, 120)}`);
      continue;
    }

    // React Native style arrays: later entries win, so the LAST referenced style that declares a
    // fontSize is the one that actually renders.
    const names = [...styleProp.matchAll(/\bs\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    let winner: { name: string; size: number } | undefined;
    for (const name of names) {
      const body = styleBody(src, name);
      if (!body) continue;
      const size = webFontSize(body);
      if (size !== undefined) winner = { name, size };
    }
    check(`${rel}: <TextInput> style [${names.join(', ') || '?'}] renders >= ${MIN}px on web`,
      !!winner && winner.size >= MIN,
      winner
        ? `s.${winner.name} declares fontSize ${winner.size} on web — under ${MIN}px iOS Safari zooms on focus and never zooms back`
        : `no referenced style declares a fontSize → react-native-web's 14px default zooms iOS on focus`);
  }
}
check(`found every TextInput in src/ (${inputs} inputs scanned)`, inputs >= 12,
  `only ${inputs} <TextInput> elements parsed — the scanner is probably broken, not the app`);

// ── 2. the fix must stay the FONT, never a pinch-zoom lockout ────────────────────────────────────
// Setting maximum-scale=1 / user-scalable=no also stops the focus zoom, by taking pinch-zoom away from
// everyone. That is an accessibility regression, not a fix. The served meta must stay open.
const html = readFileSync(join(root, 'src/app/+html.tsx'), 'utf8');
const meta = html.match(/<meta\s+name="viewport"\s+content="([^"]*)"/)?.[1] ?? '';
check('+html.tsx: viewport meta found', meta.length > 0);
check('+html.tsx: pinch-zoom is NOT disabled (no maximum-scale / user-scalable=no)',
  !/maximum-scale/i.test(meta) && !/user-scalable\s*=\s*no/i.test(meta),
  `viewport = "${meta}" — suppressing zoom is not an acceptable way to hide a sub-16px input`);


// ── THE OTHER HALF OF THE FIX ────────────────────────────────────────────────────────────────────
// Raising a flex:1 <input> to 16px is only safe WITH `minWidth: 0`. WebKit gives an <input>
// `min-width: auto` — its intrinsic min-content width — so the bigger font makes the field refuse to
// shrink and it overflows its flex row instead (measured 7.8px past the login sheet). The first
// version of this barrier PASSED on exactly that broken state because it only read fontSize, so the
// two properties are now asserted TOGETHER. Brace-BALANCED scan on purpose: the real offenders
// (AuthModal.phoneInput, settings.phInput) carry a nested `{ outlineStyle }` spread, and a naive
// [^{}]* body regex skips exactly those.
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const head of src.matchAll(/(\w+):\s*\{/g)) {
    const open = (head.index ?? 0) + head[0].length - 1;
    let depth = 0, close = -1;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { close = i; break; } }
    }
    if (close < 0) continue;
    const body = src.slice(open + 1, close);
    if (!/flex:\s*1\b/.test(body)) continue;
    const fs = body.match(/fontSize:\s*([^,}]+)/);
    if (!fs || !/\b16\b/.test(fs[1])) continue;
    const line = src.slice(0, head.index ?? 0).split('\n').length;
    check(`${file.replace(root + '/', '')}:${line} ${head[1]} — flex:1 + 16px web font also pins minWidth: 0`,
      /minWidth:\s*0\b/.test(body),
      'without it WebKit min-width:auto makes the input overflow its flex row instead of shrinking');
  }
}

// ── 3. an entrance may not SCALE a container of TextInputs below 1 on web ────────────────────────
// Found live 2026-09-05 (owner screenshot: the support form zooming on focus). Every input was a
// compliant 16px — but the modal card entered at scale 0.94, and iOS Safari decides zoom-on-focus
// from the EFFECTIVE text size at focus time: 16 × 0.94 = 15.04px, under the threshold, for the
// whole entrance window. Users tap the field they opened the form to fill immediately — inside that
// window — and a page Safari zooms never zooms back on its own. The same shape sat on the Filter
// home card (0.965, replayed on EVERY return to the screen) and the auth popup (0.96). So the
// declared-font check in §1 is not sufficient: a transform can undo it. The rule: in any file that
// renders a <TextInput>, a scale entrance with a sub-1 bound must pin scale to 1 on web
// (`IS_WEB ? 1 : …` / `Platform.OS === 'web' ? 1 : …`). Files with no inputs (result cards, the
// read-aloud player) keep their scale-pop — nothing focusable lives inside them.
// Entrance-style scales only: [0.9x, 1]. Icon feedback (the category checkmark's 0.5→1 pop, card
// press pops) uses deeper or upward scales and never wraps an input — flagging those would kill
// legitimate micro-animation for no zoom benefit. A container entrance below 0.9 would look broken
// long before it zoomed anyone; the floor check below still notices if the known set shrinks.
const SUB1_SCALE = /\[\s*0?\.9\d*\s*,\s*1\s*\]/;           // [0.94, 1] positional or outputRange value
const WEB_PIN = /IS_WEB|Platform\.OS\s*===\s*['"]web['"]/; // any of this repo's web-flag idioms
/** The full `{ scale: … }` transform entry starting at `at` (brace-balanced). */
const scaleEntry = (src: string, at: number): string => balanced(src, src.lastIndexOf('{', at), '{', '}');
let scaleEntrances = 0;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  if (!/<TextInput\s/.test(src)) continue;
  const rel = relative(root, file);
  for (const m of src.matchAll(/\bscale:\s/g)) {
    const entry = scaleEntry(src, m.index!);
    if (!SUB1_SCALE.test(entry)) continue; // not a sub-1 entrance (static scale, or a >=1 pop)
    scaleEntrances++;
    const line = src.slice(0, m.index!).split('\n').length;
    check(`${rel}:${line} sub-1 scale entrance wrapping TextInputs is pinned to 1 on web`,
      WEB_PIN.test(entry),
      `${entry.slice(0, 140)} — at focus time this renders every input inside it below ${MIN}px effective, and iOS zooms`);
  }
}
// 2 today: the InfoModal card (0.94 — the support form) and the Filter-home card (0.965 — the
// city/district/budget/area inputs). The auth popup's 0.96 entrance is deliberately NOT counted:
// AuthModal renders no TextInput at all (Google/Apple only), so nothing focusable lives inside it
// and its scale-pop stays.
check(`found the known sub-1 scale entrances around inputs (${scaleEntrances} scanned)`, scaleEntrances >= 2,
  `only ${scaleEntrances} matched — if they were legitimately removed, lower this floor deliberately; if not, the scanner broke`);

// hermetic self-test: the scanner must be able to fail — feed it both shapes directly.
const GOOD = "{ scale: reduced || IS_WEB ? 1 : interpolate(progress.value, [0, 1], [0.94, 1]) }";
const BAD = "{ scale: interpolate(progress.value, [0, 1], [0.94, 1]) }";
check('(mutation) an unpinned sub-1 scale entrance is caught', SUB1_SCALE.test(BAD) && !WEB_PIN.test(BAD));
check('(mutation) a web-pinned entrance passes', SUB1_SCALE.test(GOOD) && WEB_PIN.test(GOOD));
check('(mutation) a static scale entry is not flagged', !SUB1_SCALE.test("{ scale: 1 }"));

console.log(failed === 0
  ? `\n✓ no input can trip the iOS Safari focus-zoom trap (${inputs} inputs, all >= ${MIN}px on web; ${scaleEntrances} scale entrances web-pinned)\n`
  : `\n✗ ${failed} check(s) FAILED — a sub-16px input would zoom iPhone users and strand them zoomed in\n`);
process.exit(failed === 0 ? 0 : 1);
