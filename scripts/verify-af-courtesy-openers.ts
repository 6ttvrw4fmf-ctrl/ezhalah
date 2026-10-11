// THE ADVANCED FILTER'S SUMMARY BUBBLE OPENS WITH A ROTATING SAUDI COURTESY (owner 2026-10-10: «before this
// message add لاهنت and others, with emojis and rotation, then I'm interested / I want / make sure» — the
// owner approved the 10 verbatim).
//
// What must hold: exactly the 10 approved openers, each «opener emoji، ask » (comma only AFTER the emoji —
// owner rule 2026-09-19), never the same one twice in a row, and agent.tsx prepends it to the round's
// summary in the Arabic UI only. Mutation proofs run the broken shapes through the same checks.
//   node --experimental-strip-types scripts/verify-af-courtesy-openers.ts   (in `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AF_COURTESY_OPENERS, pickAfCourtesyOpening } from '../src/data/afCourtesyOpeners.ts';

const ROOT = join(import.meta.dirname, '..');
const AGENT = readFileSync(join(ROOT, 'src/app/agent.tsx'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

const APPROVED = [
  'لاهنت 🤍، أبغى ', 'يعطيك العافية 🌿، أدوّر على ', 'الله يعافيك 🙏، تأكد لي من ', 'لو سمحت 😊، ابحث لي عن ',
  'الله يسعدك ✨، يهمني ', 'ممكن 🙂، تشوف لي ', 'يا هلا 👋، أبي أشوف ', 'الله يجزاك خير 🤲، طلّع لي ',
  'يا ليت 🌟، تدوّر لي على ', 'تسلم 💚، أبغى أتأكد من ',
];

const shapes = (list: typeof AF_COURTESY_OPENERS): string[] => {
  const out: string[] = [];
  const built = list.map(({ opener, emoji, ask }) => `${opener} ${emoji}، ${ask} `);
  if (JSON.stringify(built) !== JSON.stringify(APPROVED)) out.push(`openers ≠ the owner's approved 10: ${built.join(' | ')}`);
  for (const b of built) if (/،\s*\p{Extended_Pictographic}/u.test(b) || !/\p{Extended_Pictographic}️?، /u.test(b)) out.push(`comma not right after the emoji: «${b}»`);
  return out;
};
const real = shapes(AF_COURTESY_OPENERS);
check('exactly the 10 approved openers, each «opener emoji، ask »', real.length === 0, real.join('\n      '));

// Rotation: every pick is one of the 10, and a «random» that keeps returning the same index still never
// repeats the previous pick.
const stuck = () => 0.05;
const a = pickAfCourtesyOpening(stuck), b = pickAfCourtesyOpening(stuck), c = pickAfCourtesyOpening(stuck);
check('a pick is always one of the 10', [a, b, c].every((x) => APPROVED.includes(x)));
check('never the same opener twice in a row', a !== b && b !== c);
const seen = new Set<string>();
for (let i = 0; i < 400; i++) seen.add(pickAfCourtesyOpening());
check('all 10 appear over many rounds (real rotation)', seen.size === 10, `saw ${seen.size}`);

const wired = (src: string) =>
  /import \{ pickAfCourtesyOpening \} from '@\/data\/afCourtesyOpeners';/.test(src)
  && /const roundLabel = ageFlowLabelsRef\.current\.join\('، '\);\s*void runRefine\(q, '__guided__', '', locale === 'ar' && roundLabel \? pickAfCourtesyOpening\(\) \+ roundLabel : roundLabel, \{/.test(src);
check('the AF round\'s bubble = courtesy + summary, Arabic UI only', wired(AGENT));

// ── mutation proofs ──────────────────────────────────────────────────────────────────────────────
const mustCatch = (what: string, caught: boolean) => {
  if (!caught) failed++;
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${what}`);
};
mustCatch('a dropped opener', shapes(AF_COURTESY_OPENERS.slice(1)).length > 0);
mustCatch('a comma before the emoji', shapes(AF_COURTESY_OPENERS.map((o, i) => (i ? o : { ...o, opener: o.opener + '،' }))).length > 0);
mustCatch('the courtesy no longer prepended', !wired(AGENT.replace('pickAfCourtesyOpening() + roundLabel', 'roundLabel')));
mustCatch('the courtesy leaking into the English UI', !wired(AGENT.replace("locale === 'ar' && roundLabel ?", 'roundLabel ?')));

console.log(failed === 0 ? '\n✅ the Advanced Filter bubble opens with one of the 10 approved courtesies, rotating.\n' : `\n❌ ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
