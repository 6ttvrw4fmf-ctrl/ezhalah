// THE ADVANCED FILTER ROUND'S BEAT SHOWS EVERY PICK INSIDE ITS 5 SECONDS (owner 2026-10-11: «نبحث عن الفلل
// والبيوت» → «فيلا» → «عمر حتى ٥ سنوات» → «مصعد», one at a time). Found in the preview the same day: with
// the first pacing, 5 picks needed ~6.4 s, so the last one («مصعد») never appeared before the results.
// This executes the real pacing function against the real 5 s floor for 1..10 picks.
//   node --experimental-strip-types scripts/verify-af-round-beat-shows-every-pick.ts   (in `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
import { stripComments } from './lib/stripComments.ts';

const ROOT = join(import.meta.dirname, '..');
const FILE = join(ROOT, 'src/components/AfRoundLoader.tsx');
const AGENT = readFileSync(join(ROOT, 'src/app/agent.tsx'), 'utf8');
const BEAT_MS = Number((AGENT.match(/const AF_LOADER_MS = (\d+);/) ?? [])[1]);

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

type Timing = (n: number) => { wait: number; swap: number };
// The last pick lands at (n-1) × (wait + swap); it must land with at least 600 ms left to be read.
const lastLandsAt = (timing: Timing, n: number) => { const { wait, swap } = timing(n); return (n - 1) * (wait + swap); };
const problems = (step: Timing): string[] => {
  const out: string[] = [];
  for (let n = 1; n <= 10; n++) {
    const at = lastLandsAt(step, n);
    if (at > BEAT_MS - 600) out.push(`${n} picks: the last lands at ${at} ms of a ${BEAT_MS} ms beat`);
  }
  return out;
};

check('the beat is 5 s', BEAT_MS === 5000, `AF_LOADER_MS=${BEAT_MS}`);
const real = (await liftSymbols(FILE, [{ header: 'export function afPickTiming(' }], ['afPickTiming'])).afPickTiming as Timing;
check('every fade is visible (≥ 120 ms) and each pick holds (≥ 250 ms)', [2, 5, 10].every((n) => real(n).swap >= 120 && real(n).wait >= 250));
const p = problems(real);
check('every pick (1–10) lands with time to read it before the results', p.length === 0, p.join('\n      '));

const mustCatch = (what: string, caught: boolean) => {
  if (!caught) failed++;
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${what}`);
};
mustCatch('the first pacing (a fixed 380 ms fade on top — «مصعد» never showed)', problems((n) => ({ wait: n <= 1 ? 0 : Math.max(600, Math.min(1200, Math.floor(4500 / n))), swap: 380 })).length > 0);
mustCatch('a fixed 1 s per pick', problems(() => ({ wait: 1000, swap: 380 })).length > 0);

// THE LINE LOOKS AND MOVES LIKE THE SEARCH LINE ON TOP OF THE LOGO LOADER (owner 2026-10-11, pointing at «نفحص أكثر
// من 349,793 عقار…»: «keep it like this color and animation»). The picked option used to be the one dark-ink bold word
// against a muted lead (the "darker colour" he disliked), and the line did not pulse. Same type as SearchLoader's
// headline, every word one colour, and the same continuous pulse.
const AF_SRC = stripComments(readFileSync(FILE, 'utf8'));
const SL_SRC = stripComments(readFileSync(join(ROOT, 'src/components/SearchLoader.tsx'), 'utf8'));
const styleOf = (src: string, key: string) => (src.match(new RegExp(`${key}: \\{([^}]*)\\}`)) ?? [])[1] ?? '';
const prop = (css: string, name: string) => (css.match(new RegExp(`${name}: ([^,]+)`)) ?? [])[1]?.trim();
const likeTheTopLine = (af: string, sl: string): boolean => {
  const a = styleOf(af, 'line'), t = styleOf(sl, 'title');
  return ['fontSize', 'fontWeight', 'color'].every((n) => !!prop(t, n) && prop(a, n) === prop(t, n))
    && !/colors\.(ink|muted)/.test(af)                                  // no darker pick, no muted lead
    && /toValue: 0\.55, duration: 650/.test(af) && /toValue: 1, duration: 650/.test(af) && /opacity: pulse/.test(af);
};
check('the Advanced Filter line has the search line\'s type, one colour for every word, and its pulse', likeTheTopLine(AF_SRC, SL_SRC));
mustCatch('the dark-ink bold pick coming back', !likeTheTopLine(AF_SRC.replace('  line: {', '  pick: { color: colors.ink, fontWeight: \'600\' },\n  line: {'), SL_SRC));
mustCatch('a muted lead against the pick again', !likeTheTopLine(AF_SRC.replace('  line: {', '  lead: { color: colors.muted },\n  line: {'), SL_SRC));
mustCatch('the pulse being removed', !likeTheTopLine(AF_SRC.replace('opacity: pulse', 'opacity: 1'), SL_SRC));
mustCatch('a different weight from the search line', !likeTheTopLine(AF_SRC.replace("fontWeight: '600', color: colors.body", "fontWeight: '800', color: colors.body"), SL_SRC));

console.log(failed === 0 ? '\n✅ every Advanced Filter pick gets its turn inside the 5 s beat.\n' : `\n❌ ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
