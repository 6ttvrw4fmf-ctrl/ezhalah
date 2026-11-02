// Guest falconer: the SAME traced falconer as the sign-in story (plain, never bearded, no bulb), his eagle in his green
// (not gold), wearing a hood of HOOD colour. He leans in, the eagle bows, he takes the hood off with his teeth (the
// sign-in seating move played in reverse), tosses it — it tumbles down and out — and the eagle takes off.
// node scripts/build-guest-falconer.mjs <hoodFill> <hoodTrim> <out.svg>
import fs from 'fs';
const [, , FILL = '#8b2c3b', TRIM = '#f3e3c3', OUT = 'assets/images/falconer-guest.svg'] = process.argv;
let s = fs.readFileSync('assets/images/falconer-signin.svg', 'utf8');

// ── timeline (guest seconds) ──
const HOLD = 0.5;                 // still, hooded
const T_A = 2.80, T_B = 2.05;     // the sign-in window played backwards: 2.80 → 2.05 (bow, hood off to his mouth)
const REV = T_A - T_B;            // 0.75 s
const SWAP = HOLD + (T_A - 2.38); // the hood leaves the eagle's head (sign-in swap instant 2.38 s)
const RELEASE = HOLD + REV;       // 1.25 s: he lets go
const SETTLE = 0.45;              // head and eagle straighten
const FALL = 1.2;                 // the hood tumbles out
const FLY = RELEASE + 0.5;        // the eagle takes off
const FLIGHT = 2.2;
const T = FLY + FLIGHT + 0.1;     // total
const FPS = 40, N = Math.round(T * FPS) + 1;
const tau = (i) => (i / (N - 1)) * T;

// ── read the sign-in sampled tracks ──
const tracks = {};
for (const m of s.matchAll(/<animateTransform[^>]*>/g)) {
  const tag = m[0];
  const type = tag.match(/type="(\w+)"/)[1], begin = parseFloat(tag.match(/begin="([\d.]+)s"/)[1]), dur = parseFloat(tag.match(/dur="([\d.]+)s"/)[1]);
  const vals = tag.match(/values="([^"]*)"/)[1].split(';').map((v) => v.trim().split(/[\s,]+/).map(Number));
  const kt = (tag.match(/keyTimes="([^"]*)"/) ?? [])[1]?.split(';').map(Number) ?? null;
  const key = `${type}@${begin}/${dur}`;
  (tracks[key] ??= []).push({ tag, type, begin, dur, vals, kt });
}
const at = (tr, t) => { // value of a sign-in track at sign-in time t (linear between samples)
  const u = Math.min(1, Math.max(0, (t - tr.begin) / tr.dur));
  const kt = tr.kt ?? tr.vals.map((_, i) => i / (tr.vals.length - 1));
  let j = 0; while (j < kt.length - 2 && u > kt[j + 1]) j++;
  const f = kt[j + 1] === kt[j] ? 0 : (u - kt[j]) / (kt[j + 1] - kt[j]);
  return tr.vals[j].map((a, k) => a + (tr.vals[j + 1][k] - a) * Math.min(1, Math.max(0, f)));
};
const one = (key) => { const t = tracks[key]; if (!t) throw new Error('track ' + key + ' not in ' + Object.keys(tracks).join(' | ')); return t[0]; };
const headT = one('translate@0/6.09'), headR = one('rotate@0/6.09');
const bow = one('rotate@1.61/1.19');
const hoodT = one('translate@0/2.38'), hoodR = one('rotate@0/2.38'), hoodS = one('scale@0/2.38');
const ease = (x) => x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x);
// the sign-in time a guest moment replays (clamped to the window), then the settle back to neutral
const signinT = (g) => g <= HOLD ? T_A : g <= RELEASE ? T_A - (g - HOLD) : T_B;
const settle = (g) => 1 - ease((g - RELEASE) / SETTLE);   // 1 → 0 after the release
const track = (fn) => Array.from({ length: N }, (_, i) => fn(tau(i)).map((v) => +v.toFixed(2)).join(' ')).join(';');

const headTvals = track((g) => { const v = at(headT, signinT(g)); const k = g > RELEASE ? settle(g) : 1; return [v[0] * k, v[1] * k]; });
const headRvals = track((g) => { const v = at(headR, signinT(g)); const k = g > RELEASE ? settle(g) : 1; return [v[0] * k, 95, 118]; });
const bowVals = track((g) => { const v = at(bow, signinT(g)); const k = g > RELEASE ? settle(g) : 1; return [v[0] * k, 23, 44]; });
// the travelling hood: from the eagle's head back along the sign-in path to his mouth, then a toss and a fall
const p0 = at(hoodT, T_B), r0 = at(hoodR, T_B)[0], s0 = at(hoodS, T_B)[0];
const hoodTvals = track((g) => {
  if (g <= RELEASE) return at(hoodT, signinT(g));
  const t = Math.min(FALL, g - RELEASE);
  return [p0[0] - 30 * t, p0[1] - 22 * t + 0.5 * 260 * t * t];   // tossed out and up a little, then gravity
});
const hoodRvals = track((g) => g <= RELEASE ? [at(hoodR, signinT(g))[0]] : [r0 - 420 * Math.min(FALL, g - RELEASE)]);
const hoodSvals = track((g) => g <= RELEASE ? [at(hoodS, signinT(g))[0]] : [s0]);

// ── rewrite the SVG ──
const swapTag = (tag, values) => tag.replace(/values="[^"]*"/, `values="${values}"`).replace(/begin="[^"]*"/, 'begin="0s"').replace(/dur="[^"]*"/, `dur="${T.toFixed(3)}s"`)
  .replace(/\s*keyTimes="[^"]*"/, '').replace(/\s*keySplines="[^"]*"/, '').replace(/\s*calcMode="[^"]*"/, '');
s = s.replace(headT.tag, swapTag(headT.tag, headTvals)).replace(headR.tag, swapTag(headR.tag, headRvals)).replace(bow.tag, swapTag(bow.tag, bowVals));
s = s.replace(hoodT.tag, swapTag(hoodT.tag, hoodTvals)).replace(hoodR.tag, swapTag(hoodR.tag, hoodRvals)).replace(hoodS.tag, swapTag(hoodS.tag, hoodSvals));
// the arm dip and the eagle's landing sway are the arrival — the guest eagle is already perched
for (const key of ['rotate@0.994/0.42', 'rotate@0/2.695']) for (const tr of tracks[key] ?? []) s = s.replace(tr.tag, '');
// the beard, bisht, glow and bulb never come: drop every animation from 2.5 s on (they all start then), and the strap
s = s.replace(/<(animate|animateTransform|animateMotion|set)\b[^>]*begin="(\d+(?:\.\d+)?)s"[^>]*\/>/g, (m, _t, b) => (parseFloat(b) >= 2.5 ? '' : m));
s = s.replace(/<(animate|animateMotion)\b[^>]*begin="(\d+(?:\.\d+)?)s"[^>]*>[\s\S]*?<\/\1>/g, (m, _t, b) => (parseFloat(b) >= 2.5 ? '' : m));
// the strap from his chest: never shown
s = s.replace('<set attributeName="opacity" to="1" begin="1.596s" fill="freeze"/>', '');
// the hood ON the eagle: shown from the start, gone at the swap
s = s.replace('<g opacity="0"><set attributeName="opacity" to="1" begin="2.38s" fill="freeze"/>', `<g><set attributeName="opacity" to="0" begin="${SWAP.toFixed(3)}s" fill="freeze"/>`);
// the travelling hood: appears at the swap, fades at the end of its fall
s = s.replace(/<animate attributeName="opacity" from="0" to="1" begin="1\.512s" dur="0\.084s" fill="freeze"\/><animate attributeName="opacity" from="1" to="0" begin="2\.38s" dur="0\.007s" fill="freeze"\/>/,
  `<set attributeName="opacity" to="1" begin="${SWAP.toFixed(3)}s" fill="freeze"/><animate attributeName="opacity" from="1" to="0" begin="${(RELEASE + FALL - 0.25).toFixed(3)}s" dur="0.25s" fill="freeze"/>`);
// hood colours (both hoods)
s = s.split('fill="#2f7247" stroke="#01361c" stroke-width="2.4"').join(`fill="${FILL}" stroke="#01361c" stroke-width="2.4"`);
s = s.split('stroke="#d4a64a" stroke-width="2.2" stroke-linecap="round"/>').join(`stroke="${TRIM}" stroke-width="2.2" stroke-linecap="round"/>`);
s = s.replace(/<circle cx="34\.2" cy="50\.3" r="1\.8" fill="#d4a64a"/g, `<circle cx="34.2" cy="50.3" r="1.8" fill="${TRIM}"`);
// the eagle in his green, not gold; and the takeoff instead of the landing
s = s.replace('.l{fill:none;stroke:#c5952f;', '.l{fill:none;stroke:#01361c;');
const cut = s.indexOf('.head,.tail,.arm,.hand{animation-direction:reverse!important');
s = s.slice(0, cut) + `/* guest: the takeoff, once the hood is gone */\n.perch,.head,.flight,.tilt,.tail,.arm,.hand{animation-duration:${FLIGHT}s!important;animation-delay:${FLY.toFixed(3)}s!important;animation-fill-mode:both!important}\n.far .arm,.far .hand{animation-delay:${(FLY + 0.03).toFixed(3)}s!important}\n` + s.slice(s.indexOf('</style>'));
s = s.replace('<!-- The sign-in animation (owner 2026-10-26)', `<!-- THE GUEST FALCONER (owner 2026-10-28: «remove his mask, throw it down, let it seem it's falling, then fly … a different colour mask»), ${T.toFixed(1)} s, never loops. Built from the sign-in story below by scripts/build-guest-falconer.mjs. Original note: The sign-in animation (owner 2026-10-26)`);
fs.writeFileSync(OUT, s);
console.log(OUT, `T=${T.toFixed(2)}s swap=${SWAP.toFixed(2)} release=${RELEASE.toFixed(2)} fly=${FLY.toFixed(2)} bytes=${s.length}`);
