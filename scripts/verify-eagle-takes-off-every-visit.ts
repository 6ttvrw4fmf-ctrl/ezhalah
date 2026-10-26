// The falconer above the home title, and his falcon that takes off on EVERY open and refresh (owner 2026-10-26:
// «make it whenever the user refresh … make it fixed»). Replaces verify-eagle-takeoff-once-per-session.ts.
// Reads the real sources: the falcon plays on mount (never under reduced motion), unmounts after its flight,
// never loops; the falconer sits at ONE fixed spot above the title — not inline after the rotating words — guests only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TAKEOFF_MS } from '../src/lib/eagleTakeoff.ts';

const root = join(import.meta.dirname, '..');
let fail = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`  PASS  ${label}`); return; }
  fail++;
  console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const comp = read('src/components/HeroFalconer.tsx');
const home = read('src/app/index.tsx');
const svg = read('assets/images/falcon-takeoff.svg');

console.log('\nThe falconer sits above the title; his falcon takes off on every visit\n');

// ── the falcon ───────────────────────────────────────────────────────────────────────────────────────────────
const playsEveryMount = (c: string) => /useEffect\(\(\) => \{\n\s*if \(reduced\) return;\n\s*setTakeoff\(true\);\n\s*const id = setTimeout\(\(\) => setTakeoff\(false\), TAKEOFF_MS\);/.test(c)
  && !/takeEagleTakeoff|sessionStorage|localStorage/.test(c);
check('the falcon takes off on every open and refresh (no session or time gate)', playsEveryMount(comp));
check('…and never under reduced motion', /if \(reduced\) return;/.test(comp));
check('it is unmounted once its flight is over', /\{takeoff \? \(/.test(comp) && /setTakeoff\(false\), TAKEOFF_MS/.test(comp));
check('the unmount waits for the whole 2.8 s flight, within 3.2 s', TAKEOFF_MS >= 2800 && TAKEOFF_MS <= 3200);
const svgOk = (v: string) => !/infinite/.test(v) && (v.match(/2\.8s/g) ?? []).length >= 5 && /prefers-reduced-motion:reduce/.test(v);
check('the flight never loops, runs 2.8 s, and respects reduced motion', svgOk(svg));
check('the falcon is drawn a little larger, about its perch on his hand',
  /const FALCON_SCALE = 1\.2;/.test(comp) && /PERCH\.x \* k \+ \(CANVAS\.x - PERCH\.x\) \* k \* FALCON_SCALE/.test(comp));
check('the falconer drawing itself is never animated',
  /<XImage source=\{FALCONER\} contentFit="contain" accessible=\{false\} style=\{StyleSheet\.absoluteFill\} \/>/.test(comp));

// ── the falconer's fixed spot ────────────────────────────────────────────────────────────────────────────────
const fixedAbove = (h: string) => {
  const at = h.indexOf('testID="hero-falconer"');
  const title = h.indexOf('testID="hero-insight"');
  return at > 0 && title > at                                      // he comes BEFORE the title …
    && !/HERO_TAGLINE_KEYS\[heroTagline\]\)\}\s*\{authChecked/.test(h) // … not inline after its rotating words
    && /heroFalconerAbove: \{ alignSelf: 'center'/.test(h);          // … centred
};
check('the falconer sits at one fixed spot, centred above the title', fixedAbove(home));
check('…for guests only', /\{authChecked && !user \? \(\n\s*<View testID="hero-falconer"/.test(home));
check('…flipped in Arabic', /<HeroFalconer size=\{heroWide \? s\.heroFalconerWide : s\.heroFalconer\} flip=\{locale === 'ar'\} \/>/.test(home));

// ── mutation proofs ──────────────────────────────────────────────────────────────────────────────────────────
mustCatch('the falcon playing under reduced motion', !playsEveryMount(comp.replace('    if (reduced) return;\n', '')));
mustCatch('a once-per-session gate coming back', !playsEveryMount(comp.replace('if (reduced) return;', 'if (reduced || sessionStorage.getItem(\'x\')) return;')));
mustCatch('a looping flight', !svgOk(svg.replace('animation:path 2.8s', 'animation:path 2.8s infinite')));
mustCatch('the falconer moved back inline after the rotating title', !fixedAbove(home.replace(
  "{welcomeLine ?? t(HERO_TAGLINE_KEYS[heroTagline])}</RNAnimated.Text>",
  "{welcomeLine ?? t(HERO_TAGLINE_KEYS[heroTagline])}{authChecked && !user ? <View testID=\"hero-falconer\" /> : null}</RNAnimated.Text>")
  .replace('            {authChecked && !user ? (\n              <View testID="hero-falconer"', '            {false ? (\n              <View testID="x"')));
mustCatch('the falconer no longer centred', !fixedAbove(home.replace("heroFalconerAbove: { alignSelf: 'center'", "heroFalconerAbove: { alignSelf: 'flex-start'")));

if (fail) { console.error(`\n❌ ${fail} check(s) failed`); process.exit(1); }
console.log('\n✅ eagle-takes-off-every-visit: fixed above the title, the falcon flies on every open, never looping');
