// The falconer above the home title, and his falcon that takes off on EVERY open and refresh (owner 2026-10-26:
// «make it whenever the user refresh … make it fixed»), and the signed-in falconer's once-per-sign-in story.
// Reads the real sources: guests see the hood come off and the falcon fly on every mount (never under reduced
// motion), never looping; the falconer sits at ONE fixed spot above the title — not inline after the rotating words — guests only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

console.log('\nThe falconer ends the Ezhalah line (one fixed spot); his falcon takes off on every visit\n');

// ── the guest falconer (owner 2026-10-29): the SAME traced falconer as the sign-in story; on EVERY open and refresh he
//     takes the RED hood off his eagle with his mouth, drops it, and the eagle flies. Reduced motion: the plain still. ──
const guest = read('assets/images/falconer-guest.svg');
const guestGate = (c: string) => /\{!signedIn \? \(\n\s*reduced \? \(\n\s*<XImage source=\{FALCONER\} contentFit="contain"[^>]*\/>\n\s*\) : \(\n\s*<XImage testID="hero-falconer-guest" source=\{freshSource\(GUEST, guestPlay\)/.test(c)
  && c.includes("const GUEST = require('../../assets/images/falconer-guest.svg');")
  && c.includes('const [guestPlay] = useState(() => ++guestPlays);')
  && !/takeEagleTakeoff|sessionStorage|localStorage/.test(c);
check('guests: the hood story plays on every open and refresh (fresh timeline per mount, no session gate), never under reduced motion', guestGate(comp));
check('…on the same canvas as the sign-in falconer, so he stands in the same spot', /testID="hero-falconer-guest"[^\n]*style=\{signinBox\}/.test(comp)
  && /viewBox="-140 -170 310 385"/.test(guest));
const guestEnd = (v: string) => Math.max(0, ...[...v.matchAll(/<(?:animate|animateTransform|animateMotion|set)\b[^>]*>/g)].map((m) =>
  Number((m[0].match(/\sbegin="(-?[\d.]+)s"/) ?? [])[1] ?? 0) + Number((m[0].match(/\sdur="(-?[\d.]+)s"/) ?? [])[1] ?? 0)));
const guestOk = (v: string) => !/infinite|indefinite/.test(v) && /<animate/.test(v)
  && guestEnd(v) >= 3 && guestEnd(v) <= 5                                          // quick: the hood + flight in 3–5 s
  && /fill="#8b2c3b" stroke="#01361c" stroke-width="2\.4"/.test(v)                    // the RED hood (not the gold/green one)
  && !/fill="#2f7247" stroke="#01361c" stroke-width="2\.4"/.test(v)
  && /\.l\{fill:none;stroke:#01361c;/.test(v)                                          // the eagle in green, not gold
  && /<set attributeName="opacity" to="0" begin="0\.920s" fill="freeze"\/>/.test(v)    // the hood leaves the eagle's head …
  && /animation-delay:1\.750s!important/.test(v);                                      // … then the eagle flies
check('the guest SVG: plays once in 3–5 s, red hood, green eagle, the hood comes off before the eagle flies', guestOk(guest), `end=${guestEnd(guest)}s`);
const noBeard = (v: string) => ![...v.matchAll(/<(?:animate|animateMotion|set)\b[^>]*begin="(\d+(?:\.\d+)?)s"/g)].some((m) => parseFloat(m[1]) >= 2.5);
check('…and the beard, bisht, glow and bulb never appear (nothing starts at 2.5 s or later)', noBeard(guest));
check('the plain still drawing is kept for reduced motion',
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
  && /\) : awaitingStory \? null : story \? \(\n\s*<XImage testID="hero-falconer-signin" source=\{freshSource\(SIGNIN, celebrate\)/.test(c)
  && /<XImage testID="hero-falconer-final" source=\{SIGNED_IN_STILL\}/.test(c);
check('signed in: the animation plays only on a sign-in welcome and never under reduced motion; otherwise the still', playGate(comp));
// owner 2026-10-28: «I don't like how the person shows first, then it happens» — while a sign-in is marked and its
// story has not started (at most STORY_WAIT_MS), the box stays empty: no finished still before the story
const noStillFirst = (c: string) => c.includes('const awaitingStory = signedIn && !reduced && celebrate === 0')
  && c.includes('Date.now() - mountedAt.current < STORY_WAIT_MS && hasJustSignedIn(Date.now());')
  && /const STORY_WAIT_MS = (\d+);/.test(c) && Number((c.match(/const STORY_WAIT_MS = (\d+);/) ?? [])[1]) <= 6000
  && c.includes(') : awaitingStory ? null : story ? (');
check('…and right after a sign-in no finished still shows before the story (an empty box for at most a few seconds)', noStillFirst(comp));
mustCatch('the still shown while the story is about to start', !noStillFirst(comp.replace(') : awaitingStory ? null : story ? (', ') : story ? (')));
mustCatch('an empty box that can wait forever', !noStillFirst(comp.replace(' && Date.now() - mountedAt.current < STORY_WAIT_MS', '')));
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
mustCatch('the guest story playing under reduced motion', !guestGate(comp.replace(/\n(\s*)reduced \? \(\n/, '\n$1false ? (\n')));
mustCatch('every guest visit sharing one finished timeline', !guestGate(comp.replace('freshSource(GUEST, guestPlay)', 'GUEST')));
mustCatch('a once-per-session gate coming back', !guestGate(comp + "\nsessionStorage.getItem('x');"));
mustCatch('the old gold/green hood on the guest', !guestOk(guest.split('fill="#8b2c3b" stroke="#01361c" stroke-width="2.4"').join('fill="#2f7247" stroke="#01361c" stroke-width="2.4"')));
mustCatch('the eagle flying before the hood is off', !guestOk(guest.replace('animation-delay:1.750s!important', 'animation-delay:0.200s!important')));
mustCatch('a looping guest story', !guestOk(guest.replace('<animate ', '<animate repeatCount="indefinite" ')));
mustCatch('the beard growing on the guest', !noBeard(guest.replace('</svg>', '<animate attributeName="opacity" values="0;1" begin="3.2s" dur="1s"/></svg>')));
mustCatch('the sign-in animation playing under reduced motion', !playGate(comp.replace('signedIn && !reduced && celebrate > 0', 'signedIn && celebrate > 0')));
mustCatch('the clock starting before the story is on screen', !smooth(comp.replace('if (!playing || loadedFor !== celebrate) return;', 'if (!playing) return;')));
mustCatch('a swap to the still file right after the story (blank flash)', !playGate(comp.replace(' : story ? (', ' : playing ? (')));
mustCatch('the confetti starting during the story (at the bulb)', !timing(comp.replace('export const RAIN_AT_MS = SIGNIN_SEQUENCE_MS;', 'export const RAIN_AT_MS = 5000;'), signin));
mustCatch('the old slow story (8.8 s)', !timing(comp.replace('export const SIGNIN_SEQUENCE_MS = 6200;', 'export const SIGNIN_SEQUENCE_MS = 8800;'), signin));
mustCatch('a story still moving after it is meant to be over', !timing(comp, signin.replace('begin="0s"', 'begin="3s"')));
mustCatch('a looping sign-in animation', !playsOnce(signin.replace('<animate ', '<animate repeatCount="indefinite" ')));
mustCatch('motion left in the settled still', !isStill(still.replace('</svg>', '<animate attributeName="opacity" values="0;1" dur="1s"/></svg>')));
mustCatch('the bulb drawn outside his head', !bulbInside(signin.replace(/<g clip-path="url\(#headInside\)">/g, '<g>')));
mustCatch('every play sharing one finished timeline', !fresh(comp.replace("play=${play}", '')));
mustCatch('the falconer moved back into the changing headline', !atEnd(home.replace("{withVisibleEmoji(welcomeLine ?? t(HERO_TAGLINE_KEYS[heroTagline]))}</RNAnimated.Text>", "{withVisibleEmoji(welcomeLine ?? t(HERO_TAGLINE_KEYS[heroTagline]))}<View testID=\"hero-falconer\" /></RNAnimated.Text>")));
mustCatch('his box appearing only once sign-in is known (the line re-wraps)', !heldBox(home.replace(/<View testID="hero-falconer"([^>]*)>\n(\s*)\{authChecked \? <HeroFalconer /, '<View testID="hero-falconer"$1>\n$2{true ? <HeroFalconer ')));
mustCatch('the falconer as a block under the words (not on the text line)', !atEnd(home.replace("heroFalconerInline: { display: 'inline-flex'", "heroFalconerInline: { display: 'flex'")));
mustCatch('a big falconer again', !small(home.replace('heroFalconer: { width: 40, height: 46 }', 'heroFalconer: { width: 62, height: 72 }')));

if (fail) { console.error(`\n❌ ${fail} check(s) failed`); process.exit(1); }
console.log('\n✅ eagle-takes-off-every-visit: one fixed spot at the end of the Ezhalah line, the falcon flies on every open, never looping');
