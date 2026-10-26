// The eagle on the falconer's hand takes off «occasionally when users open a new Ezhalah session» and is «not
// replayed when users refresh the page» (owner 2026-10-26). EXECUTES src/lib/eagleTakeoff.ts against stub storages,
// and checks HeroFalconer plays it only through that decision, never under reduced motion, and never loops.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { takeEagleTakeoff, TAKEOFF_GAP_MS, TAKEOFF_MS } from '../src/lib/eagleTakeoff.ts';

const root = join(import.meta.dirname, '..');
let fail = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`  PASS  ${label}`); return; }
  fail++;
  console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };

console.log('\nThe eagle takes off once per new session, occasionally, never on a refresh\n');
const T0 = 1_000_000_000;
{
  const local = mem(), tab = mem();
  check('a first-ever session → the eagle takes off', takeEagleTakeoff(T0, tab, local) === true);
  check('a refresh (same session) → no replay', takeEagleTakeoff(T0 + 5_000, tab, local) === false);
  check('a new session soon after → not again (occasional)', takeEagleTakeoff(T0 + 60_000, mem(), local) === false);
  check('a new session after the gap → takes off again', takeEagleTakeoff(T0 + TAKEOFF_GAP_MS + 1, mem(), local) === true);
}
{
  const local = mem(), tab = mem();
  local.setItem('ez:eagleTakeoff:last:v1', String(T0));
  takeEagleTakeoff(T0 + 1_000, tab, local);
  check('a session that did not play is still marked, so a later refresh after the gap does not play either',
    takeEagleTakeoff(T0 + TAKEOFF_GAP_MS + 5, tab, local) === false);
}
check('no storage → never plays, never throws', takeEagleTakeoff(T0, null, null) === false);
check('the gap is hours, not seconds (occasional)', TAKEOFF_GAP_MS >= 60 * 60 * 1000);
check('the flight is unmounted after the 2.8 s animation, within 3.2 s', TAKEOFF_MS >= 2800 && TAKEOFF_MS <= 3200);

const comp = readFileSync(join(root, 'src/components/HeroFalconer.tsx'), 'utf8');
const svg = readFileSync(join(root, 'assets/images/falcon-takeoff.svg'), 'utf8');
const compOk = (c: string) => /if \(reduced \|\| !takeEagleTakeoff\(\)\) return;/.test(c)
  && /const id = setTimeout\(\(\) => setTakeoff\(false\), TAKEOFF_MS\);/.test(c)
  && /\{takeoff \? \(/.test(c);
const svgOk = (v: string) => !/infinite/.test(v) && (v.match(/2\.8s/g) ?? []).length >= 5 && /prefers-reduced-motion:reduce/.test(v);
check('HeroFalconer plays the eagle only through the session decision, and unmounts it after the flight', compOk(comp));
check('the eagle animation never loops, runs 2.8 s, and respects reduced motion', svgOk(svg));
check('the falconer drawing itself is not animated (no animation style on his image)',
  /<XImage source=\{FALCONER\} contentFit="contain" accessible=\{false\} style=\{StyleSheet\.absoluteFill\} \/>/.test(comp));

mustCatch('the eagle playing under reduced motion', !compOk(comp.replace('if (reduced || !takeEagleTakeoff()) return;', 'if (!takeEagleTakeoff()) return;')));
mustCatch('the eagle playing on every mount (no session decision)', !compOk(comp.replace('if (reduced || !takeEagleTakeoff()) return;', 'if (reduced) return;')));
mustCatch('a looping eagle', !svgOk(svg.replace('animation:path 2.8s', 'animation:path 2.8s infinite')));
{
  const local = mem();
  const forgetful = { getItem: () => null, setItem: () => {} }; // a "session" that never remembers → every refresh plays
  takeEagleTakeoff(T0, forgetful, local);
  mustCatch('a refresh replaying because the session mark is lost', takeEagleTakeoff(T0 + TAKEOFF_GAP_MS + 1, forgetful, local) === true);
}

if (fail) { console.error(`\n❌ ${fail} check(s) failed`); process.exit(1); }
console.log('\n✅ eagle-takeoff-once-per-session: new session only, occasional, never on refresh, never looping');
