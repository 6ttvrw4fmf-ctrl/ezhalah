// The «كيف نحسبها؟» popup's eagle (owner 2026-11-11: «the eagle animation that we have … keep it slow, not fast like
// how we have it»). The SAME sign-in story as falconer-signin.svg — the gold eagle glides in and lands on his glove —
// with every time (CSS animation durations/delays and SMIL dur/begin) multiplied by SLOW, so it plays at the gentle
// pace the owner approved before the sign-in story was sped up. Pure re-timing: no path, colour or step changes.
// node scripts/build-howto-falconer.mjs [slow=2] [out=assets/images/falconer-howto.svg]
import fs from 'fs';
const [, , SLOW_ARG = '2', OUT = 'assets/images/falconer-howto.svg'] = process.argv;
const SLOW = Number(SLOW_ARG);
const scale = (txt) => txt.replace(/(-?\d*\.?\d+)s\b/g, (_, n) => `${+(Number(n) * SLOW).toFixed(4)}s`);
let s = fs.readFileSync('assets/images/falconer-signin.svg', 'utf8');
s = s.replace(/<style>([\s\S]*?)<\/style>/, (_, css) => `<style>${scale(css)}</style>`);
s = s.replace(/\b(dur|begin)="([^"]*)"/g, (_, k, v) => `${k}="${scale(v)}"`);
s = s.replace('<!-- The sign-in animation', `<!-- «كيف نحسبها؟» popup: the sign-in story played ${SLOW}x slower (scripts/build-howto-falconer.mjs). The sign-in animation`);
fs.writeFileSync(OUT, s);
console.log(`wrote ${OUT} (${SLOW}x slower)`);
