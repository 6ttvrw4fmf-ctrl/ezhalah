// THE ADVANCED FILTER'S SUMMARY BUBBLE OPENS WITH A ROTATING SAUDI COURTESY (owner 2026-10-10: «before this
// message add لاهنت and others, with emojis and rotation, then I'm interested / I want / make sure» — the
// owner approved the 10 verbatim).
//
// What must hold: exactly the 9 approved Arabic openers, each «opener emoji، ask » (comma only AFTER the emoji —
// owner rule 2026-09-19), never the same one twice in a row, and agent.tsx prepends it to the round's
// summary in the selected language. Mutation proofs run the broken shapes through the same checks.
//   node --experimental-strip-types scripts/verify-af-courtesy-openers.ts   (in `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { AF_COURTESY_OPENERS, AF_COURTESY_OPENERS_EN, pickAfCourtesyOpening } from '../src/data/afCourtesyOpeners.ts';

const ROOT = join(import.meta.dirname, '..');
const OPENERS_SOURCE = readFileSync(join(ROOT, 'src/data/afCourtesyOpeners.ts'), 'utf8');
const AGENT = readFileSync(join(ROOT, 'src/app/agent.tsx'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

const APPROVED = [
  'لاهنت 🤍، أبغى ', 'يعطيك العافية 🌿، أدوّر على ', 'مشكور 🙏، تأكد لي من ', 'لو سمحت 😊، ابحث لي عن ',
  'ما قصرت ✨، يهمني ', 'ممكن 🙂، تشوف لي ', 'يا هلا 👋، أبي أشوف ',
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
check('exactly the 9 approved openers (owner 10-11 removed «الله يجزاك خير»), each «opener emoji، ask »', real.length === 0, real.join('\n      '));

// Rotation: every pick is one of the 9, and a «random» that keeps returning the same index still never
// repeats the previous pick.
const stuck = () => 0.05;
const a = pickAfCourtesyOpening(stuck), b = pickAfCourtesyOpening(stuck), c = pickAfCourtesyOpening(stuck);
check('a pick is always one of the 9', [a, b, c].every((x) => APPROVED.includes(x)));
check('never the same opener twice in a row', a !== b && b !== c);
const seen = new Set<string>();
for (let i = 0; i < 400; i++) seen.add(pickAfCourtesyOpening());
check('all 9 appear over many rounds (real rotation)', seen.size === 9, `saw ${seen.size}`);

const wired = (src: string) =>
  /import \{ pickAfCourtesyOpening \} from '@\/data\/afCourtesyOpeners';/.test(src)
  && /const roundLabel = ageFlowLabelsRef\.current\.join\(locale === 'ar' \? '، ' : ', '\);\s*void runRefine\(q, '__guided__', '', roundLabel \? pickAfCourtesyOpening\(Math\.random, locale\) \+ roundLabel : roundLabel, \{/.test(src);
check('the AF round\'s bubble = localized courtesy + summary', wired(AGENT));

// ── mutation proofs ──────────────────────────────────────────────────────────────────────────────
const mustCatch = (what: string, caught: boolean) => {
  if (!caught) failed++;
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${what}`);
};
mustCatch('a dropped opener', shapes(AF_COURTESY_OPENERS.slice(1)).length > 0);
mustCatch('a comma before the emoji', shapes(AF_COURTESY_OPENERS.map((o, i) => (i ? o : { ...o, opener: o.opener + '،' }))).length > 0);
mustCatch('the courtesy no longer prepended', !wired(AGENT.replace('pickAfCourtesyOpening(Math.random, locale) + roundLabel', 'roundLabel')));
mustCatch('the locale omitted from the courtesy call', !wired(AGENT.replace('Math.random, locale', 'Math.random')));

type Picker = typeof pickAfCourtesyOpening;
function localized(pick: Picker): boolean {
  let previous = '';
  for (let i = 0; i < 12; i++) {
    const en = pick(stuck, 'en');
    if (/[ء-ي]/.test(en) || !/\p{Extended_Pictographic}️?, /u.test(en) || en === previous) return false;
    previous = en;
    if (!APPROVED.includes(pick(stuck, 'ar'))) return false;
  }
  return true;
}
check('nine English translations preserve the Arabic emojis', AF_COURTESY_OPENERS_EN.length === 9 && AF_COURTESY_OPENERS_EN.every((item, i) => item.emoji === AF_COURTESY_OPENERS[i].emoji));
check('English courtesies rotate without repeats, with emoji then English comma; Arabic stays approved', localized(pickAfCourtesyOpening));
const allEnglish = new Set<string>();
for (let i = 0; i < 9; i++) allEnglish.add(pickAfCourtesyOpening(() => (i + 0.2) / 9, 'en'));
check('every translated English courtesy is reachable', allEnglish.size === 9);
function makePicker(source: string): Picker {
  return new Function(stripTypeScriptTypes(source.replace(/^export /gm, '')) + '\nreturn pickAfCourtesyOpening;')();
}
const rawArabic = OPENERS_SOURCE.replace("locale === 'en' ? AF_COURTESY_OPENERS_EN : AF_COURTESY_OPENERS", 'AF_COURTESY_OPENERS');
const noRotation = OPENERS_SOURCE.replace('i === lastIndex[locale]', 'false');
check('both mutations changed the actual picker source', rawArabic !== OPENERS_SOURCE && noRotation !== OPENERS_SOURCE);
mustCatch('English falling back to Arabic courtesy text', !localized(makePicker(rawArabic)));
mustCatch('adjacent courtesy repetition returning', !localized(makePicker(noRotation)));

console.log(failed === 0 ? '\n✅ the Advanced Filter bubble opens with one of the 9 approved courtesies, rotating.\n' : `\n❌ ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
