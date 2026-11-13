// A CARD PHOTO IS SHRUNK, AND NEVER LOST (owner 2026-11-12: «I don't want it to feel slow … moving around»).
// EXECUTES the real cardPhotoCandidates() (src/lib/photoUrl.ts): a site photo is asked first through the resizer at
// CARD_PHOTO_PX wide and then as the site serves it — so the original is always the fallback, a resizer outage costs
// speed and never a photo. Aqar's own sized copies and same-origin /_img paths are untouched. Then the wiring: the card
// (ResultCard ListingPhoto) expands its photos through it on the web and keeps its «try the next one» step.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

const root = join(import.meta.dirname ?? '.', '..');
let failed = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const LIB = readFileSync(join(root, 'src/lib/photoUrl.ts'), 'utf8');
type Fn = (raw: string) => string[];
async function load(src: string): Promise<Fn> {
  const f = join(mkdtempSync(join(tmpdir(), 'ez-photo-')), 'photoUrl.ts'); writeFileSync(f, src);
  const m = await liftSymbols(f, [
    { header: 'export const CARD_PHOTO_PX', endsWith: /;$/ },
    { header: 'const RESIZER', endsWith: /;$/ },
    { header: 'export function cardPhotoCandidates' },
  ], ['cardPhotoCandidates']);
  return m.cardPhotoCandidates as Fn;
}
const BIG = 'https://www.nofodh.sa/listings/588198_6a46a598f2747/632.jpg';
async function problems(src: string): Promise<string[]> {
  const out: string[] = [];
  let f: Fn;
  try { f = await load(src); } catch (e) { return [`cannot load: ${(e as Error).message}`]; }
  const big = f(BIG);
  if (big.length !== 2) out.push('a site photo must have two candidates (shrunk, then original)');
  if (!/^https:\/\/wsrv\.nl\/\?url=/.test(big[0] ?? '') || !(big[0] ?? '').includes(encodeURIComponent(BIG))) out.push('the first candidate is not the resized photo');
  if (!/[?&]w=\d+/.test(big[0] ?? '') || !/[?&]we(&|$)/.test(big[0] ?? '')) out.push('the resized photo is not width-capped without enlargement');
  if (big[big.length - 1] !== BIG) out.push('the original photo is not the last fallback');
  const aqar = 'https://images.aqar.fm/webp/750x0/props/abc.jpg';
  if (JSON.stringify(f(aqar)) !== JSON.stringify([aqar])) out.push('Aqar sized copies must stay as they are');
  if (JSON.stringify(f('/_img/sadin/media/properties/1.png')) !== JSON.stringify(['/_img/sadin/media/properties/1.png'])) out.push('same-origin /_img paths must stay as they are');
  if (f('').length !== 0) out.push('an empty photo must give no candidate');
  return out;
}
const p = await problems(LIB);
check(`card photos: shrunk first, original as fallback${p.length ? ' → ' + p.join('; ') : ''}`, p.length === 0);
mustCatch('dropping the original fallback', (await problems(LIB.replace('&q=75`, raw];', '&q=75`];'))).length > 0);
mustCatch('enlarging small photos', (await problems(LIB.replace('&we&output', '&output'))).length > 0);
mustCatch('resizing Aqar copies again', (await problems(LIB.replace("if (/^https:\\/\\/images\\.aqar\\.fm\\/webp\\/\\d+x\\d+\\//.test(raw)) return [raw];", ''))).length > 0);

// Wiring: the card expands its photos through it (web only) and still falls to the next candidate on error.
const card = readFileSync(join(root, 'src/components/ResultCard.tsx'), 'utf8');
function wiring(src: string): string[] {
  const out: string[] = [];
  if (!src.includes("import { cardPhotoCandidates } from '@/lib/photoUrl';")) out.push('ResultCard does not import cardPhotoCandidates');
  if (!/const photos = IS_WEB \? sitePhotos\.flatMap\(cardPhotoCandidates\) : sitePhotos;/.test(src)) out.push('ListingPhoto does not expand photos through cardPhotoCandidates');
  if (!/onError=\{\(\) => setIdx\(\(i\) => i \+ 1\)\}/.test(src) || !/probe\.onerror = \(\) => \{ if \(!cancelled\) setIdx/.test(src)) out.push('ListingPhoto lost its «try the next photo» step — the original would never be reached');
  return out;
}
const w = wiring(card);
check(`the card uses it and keeps its fallback step${w.length ? ' → ' + w.join('; ') : ''}`, w.length === 0);
mustCatch('the card not using the shrunk photo', wiring(card.replace('sitePhotos.flatMap(cardPhotoCandidates)', 'sitePhotos')).length > 0);

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\ncard photos are shrunk, and the original is always the fallback');
