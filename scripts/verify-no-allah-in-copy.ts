// THE WORD «الله» IS NOT IN ANYTHING EZHALAH SAYS (owner 2026-10-24: «الله is still spelled wrong, remove it, remove the word God»).
//
// The word kept rendering badly in the bubbles users read first («حياك الله {الاسم}»), and the owner asked for it gone. This EXECUTES every list of
// our own wording that used it (Filter greetings, Advanced Filter openers, sign-in welcome lines, the home greeting, the chit-chat and sad replies,
// the DB greeting rows) and asserts none contains it, then runs the last gate over free text («حياك الله», «الله يعطيك العافية», «إن شاء الله»,
// "thank God") and over names that contain it («عبدالله», «ضيف الله», «عبد الله»), which must stay as they are.
// Detection patterns (what the USER may type: «هلا والله», «في أمان الله») are input, not output, and are deliberately left alone.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AF_COURTESY_OPENERS } from '../src/data/afCourtesyOpeners.ts';
import { __testing as greet } from '../src/data/filterGreetingRotation.ts';
import { GREET_LINES } from '../src/lib/filterWelcome.ts';
import { GREETINGS } from '../src/lib/insightWelcome.ts';
import * as q from '../src/data/questionExamples.ts';
import * as edgeQ from '../supabase/functions/agent/questionExamples.ts';
import { SITUATION_POOLS } from '../supabase/functions/agent/situations.ts';
import { noAllah, botMessage } from '../src/lib/botMessage.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`  ${ok ? '✓' : '❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
console.log('\nThe word «الله» is not in anything Ezhalah says\n');

const ALLAH = /الله/;
const offenders = (texts: string[]) => texts.filter((t) => ALLAH.test(t));

// ── 1. every list of our own wording ─────────────────────────────────────────────────────────────────────────────
const copy: Record<string, string[]> = {
  'Filter greetings (baked)': greet.BAKED.map((g: { greeting: string }) => g.greeting),
  'AF openers': AF_COURTESY_OPENERS.map((o) => o.opener),
  'sign-in welcome lines': GREET_LINES.map((l) => l.ar),
  'home greeting': GREETINGS.map((g) => g.ar),
  'thanks / hello / salam / bye (app)': [q.THANKS_AR, q.HELLO_AR, q.SALAM_AR, q.BYE_AR].flat(),
  'thanks / hello / salam / bye (edge)': [edgeQ.THANKS_AR, edgeQ.HELLO_AR, edgeQ.SALAM_AR, edgeQ.BYE_AR].flat(),
  'situation replies': Object.values(SITUATION_POOLS).flatMap((p) => [...p.ar, ...p.en]),
};
for (const [name, texts] of Object.entries(copy)) {
  const bad = offenders(texts);
  check(`${name}: ${texts.length} lines, none contains «الله»`, texts.length > 0 && bad.length === 0, bad.join(' | '));
}
mustCatch('a greeting that brings the word back', offenders([...copy['Filter greetings (baked)'], 'حياك الله']).length > 0);

// ── 2. the DB greeting rows (they override the app list once loaded) ─────────────────────────────────────────────
const migDir = join(ROOT, 'supabase/migrations');
const newest = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort().reverse()
  .find((f) => /delete from public\.ui_filter_greetings where lang = 'ar';/.test(readFileSync(join(migDir, f), 'utf8')))!;
const rows = [...readFileSync(join(migDir, newest), 'utf8').matchAll(/\n {2}\('ar', \d+, '([^']+)'/g)].map((m) => m[1]);
check(`the newest greeting migration (${newest}) seeds 11 rows and none contains «الله»`, rows.length === 11 && offenders(rows).length === 0, rows.join(' | '));
mustCatch('a DB row that brings the word back', offenders([...rows, 'الله يحييك']).length > 0);

// ── 3. the last gate (free text from the AI) ─────────────────────────────────────────────────────────────────────
const GATE: Array<[string, string]> = [
  ['حياك الله، أنا حاضر لو احتجت شي 🏡', 'حياك، أنا حاضر لو احتجت شي 🏡'],
  ['الله يعطيك العافية، أدور لك الحين 🏡', 'يعطيك العافية، أدور لك الحين 🏡'],
  ['أبشر ان شاء الله نبحث لك 🏡', 'أبشر نبحث لك 🏡'],
  ['هلا والله، وش تبي؟ 📍', 'هلا، وش تبي؟ 📍'],
  ['جزاك الله خير، تحت أمرك 🤍', 'جزاك خير، تحت أمرك 🤍'],
  ['وعليكم السلام ورحمة الله وبركاته، ارحب فيك 🏡', 'وعليكم السلام، ارحب فيك 🏡'],
  ['Thank God, searching now 🏡', 'searching now 🏡'],
];
check('the last gate rewrites the idioms («حياك الله», «الله يعطيك العافية», «إن شاء الله», …) and "thank God"', GATE.every(([i, o]) => botMessage(i) === o),
  GATE.filter(([i, o]) => botMessage(i) !== o).map(([i]) => `${i} → ${botMessage(i)}`).join(' | '));
mustCatch('the gate being skipped (the text going out as written)', !GATE.every(([i, o]) => ((t: string) => t)(i) === o));
const NAMES = ['أدور لك في حي الملك عبدالله 🏡', 'حي ضيف الله في جدة 🏡', 'مدينة الملك عبد الله الاقتصادية 🏡', 'شقة في الرياض 🏡'];
check('names that contain the word (عبدالله, ضيف الله, عبد الله) and ordinary replies pass through untouched', NAMES.every((n) => botMessage(n) === n), NAMES.filter((n) => botMessage(n) !== n).join(' | '));
check('the gate is idempotent', GATE.every(([i]) => botMessage(botMessage(i)) === botMessage(i)));

// ── 4. wiring: the gate is in the last step of both copies, and the model is told ────────────────────────────────
const gateWired = (src: string) => /const out = ensureEmoji\(noDashes\(noAllah\(text\)\)\);/.test(src);
const appGate = readFileSync(join(ROOT, 'src/lib/botMessage.ts'), 'utf8'), edgeGate = readFileSync(join(ROOT, 'supabase/functions/agent/botMessage.ts'), 'utf8');
check('botMessage() runs noAllah() in the app and in the edge function', gateWired(appGate) && gateWired(edgeGate));
mustCatch('botMessage() dropping noAllah()', !gateWired(appGate.replace('noAllah(text)', 'text')));
check('the two copies of the gate are byte-identical', appGate === edgeGate);
const edge = readFileSync(join(ROOT, 'supabase/functions/agent/index.ts'), 'utf8');
const told = (src: string) => /Never write the word «الله»[^`]*never write "God"/.test(src);
check('the model\'s reply rules say never to write «الله» or "God"', told(edge));
mustCatch('the model rule being removed', !told(edge.replace('Never write the word «الله»', 'Write freely')));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ the word «الله» is not in anything Ezhalah says');
