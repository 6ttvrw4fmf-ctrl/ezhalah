// ── The AF deep-search transition contract (owner redesign, 2026-08-31) ──────────────────────────
//
// After the Advanced Filter interview submits, the owner retired the white success dialog and its
// «لقينا N عقار أقرب لطلبك» beat, and the platform-pill roster must not read through the overlay.
// What ships instead: a full-bleed themed surface whose headline is the DYNAMIC «إزهله يدقّق في …»
// sentence woven from the user's OWN committed selections, the honest from-count as the only number,
// the criteria as chips, a card-pipeline animation — and a DIRECT hand-off to the results.
//
// This barrier EXECUTES the pure sentence builder (src/lib/afDeepSearchCopy.ts) under Node — the
// repo rule since the 2026-08-29 comment-blindness incidents: run the real code, don't grep for its
// shape — and pins the structural halves (no success copy, opaque backdrop, orchestrator latches)
// that cannot be executed headlessly.
//
//   node --experimental-strip-types scripts/verify-af-deep-search-transition.ts   (auto-discovered by npm test)

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deepSearchLine, typePluralAr, MAX_QUOTED } from '../src/lib/afDeepSearchCopy.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

console.log('\n── A. the sentence builder, EXECUTED ──');

const two = deepSearchLine('Apartment', ['تقييم 9.0+', '10 تقييمات أو أكثر']);
check('the owner\'s example composes exactly as specified (type plural + quoted labels + close)',
  two === 'إزهله يدقّق في الشقق بـ«تقييم 9.0+» و«10 تقييمات أو أكثر» للعثور على الأقرب لطلبك…', two);

check('an unresolved type says «العقارات» — generic and truthful, never a guessed plural',
  deepSearchLine(null, ['مفروشة']) === 'إزهله يدقّق في العقارات بـ«مفروشة» للعثور على الأقرب لطلبك…');
check('an unknown type key also falls back (never leaks the English key into the Arabic sentence)',
  !deepSearchLine('Castle', ['أي']).includes('Castle') && deepSearchLine('Castle', []).includes('العقارات'));
check('no selections → the no-facet sentence, no dangling «بـ»',
  deepSearchLine('Villa', []) === 'إزهله يدقّق في الفلل المطابقة لطلبك…');
check('blank labels are ignored, not quoted as empty «»',
  deepSearchLine('Villa', ['  ', '']) === 'إزهله يدقّق في الفلل المطابقة لطلبك…'
  && !deepSearchLine('Villa', [' ', 'جديد']).includes('««'));

const five = deepSearchLine('Apartment', ['أ', 'ب', 'ج', 'د', 'هـ']);
check(`more than ${MAX_QUOTED} labels → first ${MAX_QUOTED} quoted + honest «وغيرها», never silent truncation`,
  five.includes('«أ»') && five.includes('«ج»') && !five.includes('«د»') && five.includes('وغيرها'));
check('exactly at the cap there is no «وغيرها» (nothing was left out)',
  !deepSearchLine('Apartment', ['أ', 'ب', 'ج']).includes('وغيرها'));

check('every clean type in the hierarchy has a curated Arabic plural (no silent fallback for real types)',
  ['Apartment', 'Floor', 'Studio', 'Room', 'Residential Building', 'Villa', 'Duplex', 'Rest House',
   'Chalet', 'Camp', 'Farm', 'Agriculture Plot', 'Residential Land', 'Office', 'Shop', 'Showroom',
   'Warehouse', 'Workshop', 'Factory', 'Commercial Building', 'Hotel', 'Gas Station', 'Staff Housing',
   'Commercial Land', 'Industrial Land'].every((k) => typePluralAr(k) !== 'العقارات'));

console.log('\n── B. the retired success beat stays retired ──');

const mining = readFileSync(join(root, 'src/components/MiningTransition.tsx'), 'utf8');
check('the «We found {count} properties closest to your request» claim is GONE from the transition',
  !mining.includes('We found {count} properties closest to your request'));
check('the transition renders the dynamic sentence through the ONE executed builder',
  /deepSearchLine\(/.test(mining) && /from '@\/lib\/afDeepSearchCopy'/.test(mining));
check('no platform logos/pills reach the transition (no loaderPlatforms import, no Image pills)',
  !/loaderPlatforms|PlatformPill|pillLogo/.test(mining));
check('the backdrop is the near-opaque THEME surface (covers the searching turn behind it)',
  /backgroundColor: colors\.paper, opacity: 0\.9[5-9]/.test(mining));
check('reduced motion renders the static composition (no moving cards)',
  /useReducedMotion/.test(mining) && /!reduced \?/.test(mining));

console.log('\n── C. the orchestrator hand-off (direct, latch-driven) ──');

const agent = readFileSync(join(root, 'src/app/agent.tsx'), 'utf8');
check('the mining state carries the committed labels + resolved type for the sentence',
  /phase: 'mining'; from: number \| null; to: number \| null; labels: string\[\]; type: string \| null/.test(agent)
  && /<MiningTransition from=\{ageFlow\.from\} to=\{ageFlow\.to\} type=\{ageFlow\.type\} labels=\{ageFlow\.labels\}/.test(agent));
check('dismissal is a plain setTimeout latch with the 15s failsafe (never an animation callback)',
  /timers\.push\(setTimeout\(\(\) => \{ if \(stillMining\(\)\) setAgeFlow\(\(f\) => \(f\?\.phase === 'mining' \? null : f\)\); \}, 15000\)\)/.test(agent));
check('the hand-off is DIRECT: the overlay dismisses on a short seal (wait + 450), no reading pause',
  /wait \+ 450/.test(agent));

console.log(failures === 0
  ? '\n✓ deep-search transition: the user\'s own selections, one honest number, no success beat\n'
  : `\n✗ ${failures} check(s) FAILED — the AF hand-off could drift back to the retired popup\n`);
process.exit(failures === 0 ? 0 : 1);
