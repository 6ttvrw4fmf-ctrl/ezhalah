// A short stay's distance to the Haram is shown honestly, and only where it is known (owner 2026-11-05: «Yes, build it»).
//
// src/lib/haramDistance.ts measures a straight line from the SOURCE's own pin (Gathern / Aqar Monthly
// additional_info.latitude / longitude) to Masjid al-Haram or al-Masjid an-Nabawi, shows it as «≈ … من الحرم», and
// shows nothing for a missing / 0-0 pin or a pin over 40 km from both. This EXECUTES the helper on known points, then
// checks the wiring: remote.ts fills `haram` only for stay-length sources, both card layouts render it, both locales
// carry the text. Mutation proofs at the bottom.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { haramDistance, haramDistanceText, haversineM, HARAMS, HARAM_MAX_M } from '../src/lib/haramDistance.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
};

console.log('A short stay shows how far it is from the Haram — honestly, and only where the pin is known');

// 1. the helper, executed
const kaaba = haramDistance(HARAMS.makkah.lat, HARAMS.makkah.lng);
check('the Kaaba itself is 0 m from the Haram (Makkah)', !!kaaba && kaaba.haram === 'makkah' && kaaba.meters === 0, JSON.stringify(kaaba));
const ajyad = haramDistance(21.4155, 39.8262);            // ~0.78 km due south
check('a pin ~780 m south reads Makkah, 750–800 m', !!ajyad && ajyad.haram === 'makkah' && ajyad.meters > 750 && ajyad.meters < 800, JSON.stringify(ajyad));
const quba = haramDistance('24.4393', '39.6172');          // Quba, ~3.2 km from the Prophet's Mosque; strings accepted
check('a Quba pin reads Madinah, 3.0–3.4 km', !!quba && quba.haram === 'madinah' && quba.meters > 3000 && quba.meters < 3400, JSON.stringify(quba));
check('a Riyadh pin is not near either Haram', haramDistance(24.7136, 46.6753) === null);
check('Jeddah (~70 km) is over the 40 km limit', haramDistance(21.5433, 39.1728) === null);
check('a 0 / 0 pin is no pin', haramDistance(0, 0) === null && haramDistance(21.42, 0) === null);
check('no pin / text pin is null', haramDistance(null, undefined) === null && haramDistance('x', 'y') === null);
check('haversine is symmetric and ~111 km per degree of latitude',
  Math.abs(haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) - 111_195) < 50 &&
  haversineM(HARAMS.makkah, HARAMS.madinah) === haversineM(HARAMS.madinah, HARAMS.makkah));
check('the limit is 40 km', HARAM_MAX_M === 40_000);

// 2. the words
check('650 m → «650 م» / «650 m»', haramDistanceText(663, 'ar') === '650 م' && haramDistanceText(663, 'en') === '650 m', haramDistanceText(663, 'ar'));
check('tiny distances never print «0 م»', haramDistanceText(10, 'ar') === '50 م');
check('1,234 m → «1.2 كم»', haramDistanceText(1234, 'ar') === '1.2 كم', haramDistanceText(1234, 'ar'));
check('12,600 m → «13 كم»', haramDistanceText(12_600, 'ar') === '13 كم', haramDistanceText(12_600, 'ar'));

// 3. the wiring
const remote = readFileSync(join(root, 'src/data/remote.ts'), 'utf8');
const wiredRemote = /const haram = rawInfo && isStayLengthPriced\(r\.source \?\? ''\) \? haramDistance\(rawInfo\.latitude, rawInfo\.longitude\) : null;/.test(remote);
check('remote.ts fills `haram` from the source pin, stay-length sources only', wiredRemote);
const cardSrc = readFileSync(join(root, 'src/components/ResultCard.tsx'), 'utf8');
const layouts = (cardSrc.match(/testID="card-haram-distance"/g) ?? []).length;
check('both card layouts render the Haram line', layouts === 2, `${layouts} layout(s)`);
const i18n = readFileSync(join(root, 'src/i18n.tsx'), 'utf8');
check('Arabic text for both mosques', i18n.includes("'≈ {d} from the Haram':") && i18n.includes('"≈ {d} from the Prophet\'s Mosque":'));

// 4. mutation proofs — each must turn a check above red
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
mustCatch('the source gate removed (every platform would get a distance)',
  !/isStayLengthPriced\(r\.source \?\? ''\) \? haramDistance/.test(remote.replace("isStayLengthPriced(r.source ?? '') ? haramDistance", 'true ? haramDistance')));
mustCatch('one layout losing the line', (cardSrc.replace('testID="card-haram-distance"', '').match(/testID="card-haram-distance"/g) ?? []).length !== 2);
mustCatch('a walking-time wording', !/≈ \{d\} from the Haram/.test(i18n.replace('≈ {d} from the Haram', '{d} walk to the Haram')));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ short stays show an honest distance to the Haram');
