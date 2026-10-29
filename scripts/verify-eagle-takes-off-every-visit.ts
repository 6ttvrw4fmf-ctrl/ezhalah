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

console.log('\nThe falconer ends the Ezhalah line (one fixed spot); his falcon takes off on every visit\n');

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

// ── the falconer ends the Ezhalah line, ONE FIXED SPOT signed in or out (owner 2026-10-27: «I want them to always be
//     in the same position … without changing its location»; he moved with the headline's words when he ended it) ──
const SUB = "{t('Ezhalah An AI-powered platform that searches real estate listings across Saudi Arabia.')}{' '}<View testID=\"hero-falconer\"";
const atEnd = (h: string) => h.includes(SUB)                                        // right after the Ezhalah line's last word …
  && h.indexOf('testID="hero-falconer"') > h.indexOf('{withVisibleEmoji(welcomeLine ?? t(HERO_TAGLINE_KEYS[heroTagline]))}</RNAnimated.Text>') // … not in the changing headline
  && (h.match(/testID="hero-falconer"/g) ?? []).length === 1                         // … in one place only
  && h.includes("heroFalconerInline: { display: 'inline-flex', verticalAlign: 'middle'"); // … on the text line
check('the falconer stands at one fixed spot: the end of the Ezhalah line (same words for everyone), never in the headline', atEnd(home));
const small = (h: string) => { const m = h.match(/heroFalconer: \{ width: (\d+), height: (\d+) \}/); const w = h.match(/heroFalconerWide: \{ width: (\d+), height: (\d+) \}/);
  return !!m && !!w && +m[2] <= 50 && +w[2] <= 64 && +m[2] >= 34; };
check('…small', small(home));
// his box is there from the first frame; only what is inside waits for sign-in to be known, so the line never re-wraps
const heldBox = (h: string) => h.includes(SUB) && /<View testID="hero-falconer"[^>]*>\n\s*\{authChecked \? <HeroFalconer /.test(h);
check('…his box is held from the first frame, the drawing fills it once sign-in is known, for guests AND signed-in users', heldBox(home));
check('…flipped in Arabic, told who is signed in and when a welcome was taken, with no clouds over the words',
  home.includes("<HeroFalconer size={heroWide ? s.heroFalconerWide : s.heroFalconer} flip={locale === 'ar'} signedIn={!!user} celebrate={welcomeCelebrate} inline />")
  && comp.includes('{inline ? null : <CloudWisp variant={0}') && comp.includes('{inline ? null : (<>'));

// ── the signed-in falconer (owner-approved 2026-10-26): the story plays ONCE per sign-in welcome, then the still ──
const signin = read('assets/images/falconer-signin.svg');
const still = read('assets/images/falconer-final.svg');
const playGate = (c: string) => c.includes('const story = signedIn && !reduced && celebrate > 0;')
  && c.includes('const playing = story && celebrate !== done;')
  && /\) : story \? \(\n\s*<XImage testID="hero-falconer-signin" source=\{freshSource\(SIGNIN, celebrate\)/.test(c)
  && /<XImage testID="hero-falconer-final" source=\{SIGNED_IN_STILL\}/.test(c);
check('signed in: the animation plays only on a sign-in welcome and never under reduced motion; otherwise the still', playGate(comp));
// SMOOTH (owner 2026-10-27: «it doesn't look smooth»): the clock starts when the story's file is on screen, and after
// it he keeps its last frame (no swap to another file, which flashed blank while it loaded)
const smooth = (c: string) => c.includes('priority="high" onLoad={() => setLoadedFor(celebrate)}')
  && /if \(!playing \|\| loadedFor !== celebrate\) return;\n\s*const timers = \[\n\s*setTimeout\(\(\) => startNameParty\(reduced\), RAIN_AT_MS\)/.test(c)
  && /setTimeout\(\(\) => setLoadedFor\(celebrate\), LOAD_WAIT_MS\)/.test(c);
check('…its clock starts when it is on screen (loaded), with a fallback, and it keeps its last frame after (no blank swap)', smooth(comp) && playGate(comp));
// owner 2026-10-27: «the animation must be clear, first the animation … it finished, then the confetti … it feels slow»
// → the whole story fits in 5–7 s, its last motion ends by SIGNIN_SEQUENCE_MS, and the confetti starts only then.
const svgEnd = (v: string) => Math.max(0, ...[...v.matchAll(/<(?:animate|animateTransform|animateMotion|set)\b[^>]*>/g)].map((m) => {
  const b = Number((m[0].match(/\sbegin="(-?[\d.]+)s"/) ?? [])[1] ?? 0);
  const d = Number((m[0].match(/\sdur="(-?[\d.]+)s"/) ?? [])[1] ?? 0);
  return b + d;
}));
const timing = (c: string, v: string) => {
  const seq = Number((c.match(/export const SIGNIN_SEQUENCE_MS = (\d+);/) ?? [])[1]);
  return seq >= 5000 && seq <= 7000                                       // quick: 5–7 s
    && svgEnd(v) * 1000 <= seq + 100                                        // the story is over by then …
    && /export const RAIN_AT_MS = SIGNIN_SEQUENCE_MS;/.test(c)              // … and the confetti waits for it
    && c.includes('setTimeout(() => startNameParty(reduced), RAIN_AT_MS)') && c.includes('setTimeout(() => setDone(celebrate), SIGNIN_SEQUENCE_MS)');
};
check('…the story is quick (5–7 s), finishes, and only then the confetti starts and the still takes over', timing(comp, signin), `end=${svgEnd(signin)}s`);
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
mustCatch('the clock starting before the story is on screen', !smooth(comp.replace('if (!playing || loadedFor !== celebrate) return;', 'if (!playing) return;')));
mustCatch('a swap to the still file right after the story (blank flash)', !playGate(comp.replace(') : story ? (', ') : playing ? (')));
mustCatch('the confetti starting during the story (at the bulb)', !timing(comp.replace('export const RAIN_AT_MS = SIGNIN_SEQUENCE_MS;', 'export const RAIN_AT_MS = 5000;'), signin));
mustCatch('the old slow story (8.8 s)', !timing(comp.replace('export const SIGNIN_SEQUENCE_MS = 6200;', 'export const SIGNIN_SEQUENCE_MS = 8800;'), signin));
mustCatch('a story still moving after it is meant to be over', !timing(comp, signin.replace('begin="0s"', 'begin="3s"')));
mustCatch('a looping sign-in animation', !playsOnce(signin.replace('<animate ', '<animate repeatCount="indefinite" ')));
mustCatch('motion left in the settled still', !isStill(still.replace('</svg>', '<animate attributeName="opacity" values="0;1" dur="1s"/></svg>')));
mustCatch('the bulb drawn outside his head', !bulbInside(signin.replace(/<g clip-path="url\(#headInside\)">/g, '<g>')));
mustCatch('every play sharing one finished timeline', !fresh(comp.replace("play=${play}", '')));
mustCatch('a looping flight', !svgOk(svg.replace('animation:path 2.8s', 'animation:path 2.8s infinite')));
mustCatch('the falconer moved back into the changing headline', !atEnd(home.replace("{withVisibleEmoji(welcomeLine ?? t(HERO_TAGLINE_KEYS[heroTagline]))}</RNAnimated.Text>", "{withVisibleEmoji(welcomeLine ?? t(HERO_TAGLINE_KEYS[heroTagline]))}<View testID=\"hero-falconer\" /></RNAnimated.Text>")));
mustCatch('his box appearing only once sign-in is known (the line re-wraps)', !heldBox(home.replace(/<View testID="hero-falconer"([^>]*)>\n(\s*)\{authChecked \? <HeroFalconer /, '<View testID="hero-falconer"$1>\n$2{true ? <HeroFalconer ')));
mustCatch('the falconer as a block under the words (not on the text line)', !atEnd(home.replace("heroFalconerInline: { display: 'inline-flex'", "heroFalconerInline: { display: 'flex'")));
mustCatch('a big falconer again', !small(home.replace('heroFalconer: { width: 40, height: 46 }', 'heroFalconer: { width: 62, height: 72 }')));

if (fail) { console.error(`\n❌ ${fail} check(s) failed`); process.exit(1); }
console.log('\n✅ eagle-takes-off-every-visit: one fixed spot at the end of the Ezhalah line, the falcon flies on every open, never looping');
