// The falconer above the home title, and his falcon that takes off on EVERY open and refresh (owner 2026-10-26:
// «make it whenever the user refresh … make it fixed»), and the signed-in falconer's once-per-sign-in story.
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
// (a signed-in user's falcon is already on his hand, so the guest take-off is skipped for them — `|| signedIn`)
const playsEveryMount = (c: string) => /useEffect\(\(\) => \{\n\s*if \(reduced \|\| signedIn\) return;\n\s*setTakeoff\(true\);\n\s*const id = setTimeout\(\(\) => setTakeoff\(false\), TAKEOFF_MS\);/.test(c)
  && !/takeEagleTakeoff|sessionStorage|localStorage/.test(c);
check('the falcon takes off on every open and refresh (no session or time gate)', playsEveryMount(comp));
check('…and never under reduced motion', /if \(reduced \|\| signedIn\) return;/.test(comp));
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
check('…once auth is known, for guests AND signed-in users (who get the sign-in falconer)', /\{authChecked \? \(\n\s*<View testID="hero-falconer"/.test(home));
check('…flipped in Arabic, told who is signed in and when a welcome was taken',
  /<HeroFalconer size=\{heroWide \? s\.heroFalconerWide : s\.heroFalconer\} flip=\{locale === 'ar'\} signedIn=\{!!user\} celebrate=\{welcomeCelebrate\} \/>/.test(home));

// ── the signed-in falconer (owner-approved 2026-10-26): the story plays ONCE per sign-in welcome, then the still ──
const signin = read('assets/images/falconer-signin.svg');
const still = read('assets/images/falconer-final.svg');
const playGate = (c: string) => /const playing = signedIn && !reduced && celebrate > 0 && celebrate !== done;/.test(c)
  && /\) : playing \? \(\n\s*<XImage testID="hero-falconer-signin" source=\{freshSource\(SIGNIN, celebrate\)/.test(c)
  && /<XImage testID="hero-falconer-final" source=\{SIGNED_IN_STILL\}/.test(c);
check('signed in: the animation plays only on a sign-in welcome and never under reduced motion; otherwise the still', playGate(comp));
const timing = (c: string) => {
  const seq = Number((c.match(/export const SIGNIN_SEQUENCE_MS = (\d+);/) ?? [])[1]);
  const rain = Number((c.match(/export const RAIN_AT_MS = (\d+);/) ?? [])[1]);
  return seq >= 6000 && seq <= 10000 && rain > 0 && rain < seq
    && /setTimeout\(\(\) => startNameParty\(reduced\), RAIN_AT_MS\)/.test(c) && /setTimeout\(\(\) => setDone\(celebrate\), SIGNIN_SEQUENCE_MS\)/.test(c);
};
check('…the green rain celebration starts with the idea, inside the sequence, and the still takes over at its end', timing(comp));
const playsOnce = (v: string) => !/infinite|indefinite/.test(v) && /<animate/.test(v);
check('the sign-in animation plays once (nothing loops)', playsOnce(signin));
const isStill = (v: string) => !/<animate|<set |animation:|@keyframes/.test(v);
check('the settled falconer is a true still (no motion at all)', isStill(still));
const bulbInside = (v: string) => /<g clip-path="url\(#headInside\)">/.test(v) && /<clipPath id="headInside">/.test(v);
check('…and the bulb sits INSIDE his head, clipped to it, in both', bulbInside(signin) && bulbInside(still));
const fresh = (c: string) => /\$\{uri\}\$\{uri\.includes\('\?'\) \? '&' : '\?'\}play=\$\{play\}/.test(c);
check('a second sign-in in the same tab gets a fresh animation timeline', fresh(comp));

// ── mutation proofs ──────────────────────────────────────────────────────────────────────────────────────────
mustCatch('the falcon playing under reduced motion', !playsEveryMount(comp.replace('    if (reduced || signedIn) return;\n', '')));
mustCatch('a once-per-session gate coming back', !playsEveryMount(comp.replace('if (reduced || signedIn) return;', 'if (reduced || signedIn || sessionStorage.getItem(\'x\')) return;')));
mustCatch('the sign-in animation playing under reduced motion', !playGate(comp.replace('signedIn && !reduced && celebrate > 0', 'signedIn && celebrate > 0')));
mustCatch('the rain starting after the sequence has ended', !timing(comp.replace('export const RAIN_AT_MS = 7400;', 'export const RAIN_AT_MS = 9900;')));
mustCatch('a looping sign-in animation', !playsOnce(signin.replace('<animate ', '<animate repeatCount="indefinite" ')));
mustCatch('motion left in the settled still', !isStill(still.replace('</svg>', '<animate attributeName="opacity" values="0;1" dur="1s"/></svg>')));
mustCatch('the bulb drawn outside his head', !bulbInside(signin.replace(/<g clip-path="url\(#headInside\)">/g, '<g>')));
mustCatch('every play sharing one finished timeline', !fresh(comp.replace("play=${play}", '')));
mustCatch('a looping flight', !svgOk(svg.replace('animation:path 2.8s', 'animation:path 2.8s infinite')));
mustCatch('the falconer moved back inline after the rotating title', !fixedAbove(home.replace(
  "{welcomeLine ?? t(HERO_TAGLINE_KEYS[heroTagline])}</RNAnimated.Text>",
  "{welcomeLine ?? t(HERO_TAGLINE_KEYS[heroTagline])}{authChecked ? <View testID=\"hero-falconer\" /> : null}</RNAnimated.Text>")
  .replace('            {authChecked ? (\n              <View testID="hero-falconer"', '            {false ? (\n              <View testID="x"')));
mustCatch('the falconer no longer centred', !fixedAbove(home.replace("heroFalconerAbove: { alignSelf: 'center'", "heroFalconerAbove: { alignSelf: 'flex-start'")));

if (fail) { console.error(`\n❌ ${fail} check(s) failed`); process.exit(1); }
console.log('\n✅ eagle-takes-off-every-visit: fixed above the title, the falcon flies on every open, never looping');
