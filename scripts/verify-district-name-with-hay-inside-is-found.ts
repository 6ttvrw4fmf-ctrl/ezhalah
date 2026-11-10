// A district whose NAME contains the letters «حي» is still found as typed (🔧 2026-11-10; district-name-sweep red
// since 11-07, 647 lost listings, 335 of them one name).
//
// normDist() strips every «حي» (the district marker) from a name, so «حي البحيرات» probes as «البرات» and the live
// lookup's whole-word match finds none of its Arabic rows — only the English twin rows the catalog bridge adds for
// Jeddah («Al-Buhayrat»). The multi-city branch then saw ONE city, and the 327 Mecca ads under «حي البحيرات» were
// sent to Jeddah; «حي الفحياء» (Al Majmaah) and «اليحيى» (Hofuf) were lost outright. EXECUTES the real resolver
// (bundled from src with a fixture index, the same shelf the nightly sweep uses) and a mutant with the fix removed.
//   node --experimental-strip-types scripts/verify-district-name-with-hay-inside-is-found.ts   (discovered by `npm test`)
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleResolver } from './lib/bundleResolver.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean, detail = '') => check(`(mutation) catches ${label}`, caught, detail);

// The production index rows of 2026-11-10 14:02 UTC for the twin name, plus controls.
const rows = [
  { city: 'Mecca', district: 'حي البحيرات', region: 'Makkah', n: 207 },
  { city: 'Jeddah', district: 'حي البحيرات', region: 'Makkah', n: 56 },
  { city: 'Jeddah', district: 'البحيرات', region: null, n: 55 },
  { city: 'Jeddah', district: 'Al-Buhayrat', region: null, n: 44 },
  { city: 'Mecca', district: 'البحيرات', region: 'Makkah', n: 40 },
  { city: 'Mecca', district: 'البحيرات', region: null, n: 33 },
  { city: 'Jeddah', district: 'البحيرات', region: 'Makkah', n: 11 },
  { city: 'Jeddah', district: 'Al-Buhayrat', region: 'Makkah', n: 9 },
  { city: 'Al Majmaah', district: 'حي الفحياء', region: 'Riyadh', n: 11 },
  { city: 'Hofuf', district: 'اليحيى', region: 'Eastern Province', n: 14 },
  { city: 'Riyadh', district: 'حي الملقا', region: 'Riyadh', n: 900 },
  { city: 'Jeddah', district: 'حي الروضة', region: 'Makkah', n: 800 },
  { city: 'Riyadh', district: 'حي الروضة', region: 'Riyadh', n: 700 },
];
type Res = { kind: string; city: string; districts: string[]; cities: string[]; ambiguous?: boolean; label: string };
const ask = (r: Awaited<ReturnType<typeof bundleResolver>>, q: string) => r.resolveLocation(q, 'ar') as Res;

const real = await bundleResolver(root, rows as any);
{
  const b = ask(real, 'حي البحيرات');
  check('«حي البحيرات» typed alone is the twin it is: AMBIGUOUS across Mecca and Jeddah', b.kind === 'district' && b.ambiguous === true && b.cities.includes('Mecca') && b.cities.includes('Jeddah'), JSON.stringify(b));
  check('…and its own Arabic spelling is among the districts searched (the sweep\'s own test)', b.districts.includes('حي البحيرات'), JSON.stringify(b.districts));
  const b2 = ask(real, 'البحيرات');
  check('«البحيرات» without «حي» answers the same twin', b2.ambiguous === true && b2.cities.includes('Mecca'), JSON.stringify(b2));
  const f = ask(real, 'حي الفحياء');
  check('«حي الفحياء» (Al Majmaah, «حي» inside the word) is found in its own city', f.kind === 'district' && f.city === 'Al Majmaah' && f.districts.includes('حي الفحياء'), JSON.stringify(f));
  const y = ask(real, 'حي اليحيى');
  check('«اليحيى» (Hofuf, «يحي» inside the word) is found in its own city', y.kind === 'district' && y.city === 'Hofuf' && y.districts.includes('اليحيى'), JSON.stringify(y));
  const bj = ask(real, 'حي البحيرات، جدة');
  check('a city the user names still scopes the twin («حي البحيرات، جدة» → Jeddah only)', bj.kind === 'district' && bj.city === 'Jeddah' && !bj.ambiguous, JSON.stringify(bj));
  const r1 = ask(real, 'حي الروضة');
  check('control: an ordinary twin («حي الروضة») is unchanged (ambiguous Jeddah/Riyadh)', r1.ambiguous === true && r1.cities.length === 2, JSON.stringify(r1));
  const m = ask(real, 'حي الملقا');
  check('control: a single-city district («حي الملقا») is unchanged', m.kind === 'district' && m.city === 'Riyadh' && !m.ambiguous, JSON.stringify(m));
  // WITH AN EXPLICIT CITY (CodeRabbit on #11683): the exact name is compared AFTER the city is cut out of the probe.
  // KNOWN GAP, dated 2026-11-10 (backlog 1729, 🔬 lane): the ARABIC city form «حي الفحياء، المجمعة» still resolves to
  // nothing — «المجمعة» alone is an AMBIGUOUS catalog city (three same-name rows in three regions) and the phrase dies
  // before this lookup; the English form below and «اليحيى، الهفوف» are fixed by the city-cut exact name.
  const fm = ask(real, 'حي الفحياء، Al Majmaah');
  check('«حي الفحياء، Al Majmaah» (explicit city, «حي» inside the word) is Al Majmaah\'s district, spelled as the index has it', fm.kind === 'district' && fm.city === 'Al Majmaah' && fm.districts.includes('حي الفحياء'), JSON.stringify(fm));
  // (Not asserted: «اليحيى، الهفوف». The live index labels the city «Hofuf» while the catalog says «Al Hafuf», so NO
  // Hofuf district is found with an explicit city today — a city-alias gap older than this PR, also in backlog 1729.)
  const fr = ask(real, 'حي الفحياء، الرياض');
  check('a named city SCOPES the city-cut exact name: «حي الفحياء، الرياض» never answers Al Majmaah\'s district (EXACT LOCATION ONLY)', !(fr.kind === 'district' && fr.city === 'Al Majmaah'), JSON.stringify(fr));
  const rj = ask(real, 'حي الروضة، جدة');
  check('control: «حي الروضة، جدة» stays Jeddah only (the named city scopes the twin)', rj.kind === 'district' && rj.city === 'Jeddah' && !rj.ambiguous, JSON.stringify(rj));
}

// Mutation: the pre-11-10 lookup (no exact-name union) executed on the same shelf sends the twin to Jeddah alone.
{
  const dir = mkdtempSync(join(tmpdir(), 'ezhalah-hay-inside-'));
  try {
    cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true });
    const f = join(dir, 'src/data/locations.ts');
    const src = readFileSync(f, 'utf8');
    const cut = src.replace(/\n  for \(const d of namedExactly\(\)\) \{\n[\s\S]*?\n  \}\n  out\.sort\(\(a, b\) => b\.n - a\.n\);/, '\n  out.sort((a, b) => b.n - a.n);');
    check('(mutation setup) the exact-name union is present in src and the mutant removes it', cut !== src);
    // Second mutant: the exact name compared on the WHOLE phrase only (the pre-fix namedExactly) — an explicit city
    // plus a «حي»-inside name must then be lost again.
    const rawOnly = src.replace("const cut = cityKey && probe !== normDist(raw) ? liveNamedExactlyKey(probe).filter(inNamedCity) : [];", 'const cut: LiveDistrict[] = [];');
    check('(mutation setup) the city-cut exact name is present in src and the mutant removes it', rawOnly !== src);
    const dir2 = mkdtempSync(join(tmpdir(), 'resolver-mutant2-'));
    cpSync(join(root, 'src'), join(dir2, 'src'), { recursive: true });
    writeFileSync(join(dir2, 'src/data/locations.ts'), rawOnly);
    const mutant2 = await bundleResolver(dir2, rows as any);
    const f2 = ask(mutant2, 'حي الفحياء، Al Majmaah');
    mustCatch('an exact name compared on the whole phrase only: «حي الفحياء، Al Majmaah» is lost again', !(f2.kind === 'district' && f2.city === 'Al Majmaah'), JSON.stringify(f2));
    rmSync(dir2, { recursive: true, force: true });
    // Third mutant: the city-cut rows no longer scoped to the named city — «حي الفحياء، الرياض» must then answer Al Majmaah.
    const unscoped = src.replace("liveNamedExactlyKey(probe).filter(inNamedCity) : [];", 'liveNamedExactlyKey(probe) : [];');
    check('(mutation setup) the city scope on the cut rows is present in src and the mutant removes it', unscoped !== src);
    const dir3 = mkdtempSync(join(tmpdir(), 'resolver-mutant3-'));
    cpSync(join(root, 'src'), join(dir3, 'src'), { recursive: true });
    writeFileSync(join(dir3, 'src/data/locations.ts'), unscoped);
    const mutant3 = await bundleResolver(dir3, rows as any);
    const f3 = ask(mutant3, 'حي الفحياء، الرياض');
    mustCatch('city-cut exact names not scoped to the named city: «حي الفحياء، الرياض» answers Al Majmaah', f3.kind === 'district' && f3.city === 'Al Majmaah', JSON.stringify(f3));
    rmSync(dir3, { recursive: true, force: true });
    writeFileSync(f, cut);
    const mutant = await bundleResolver(dir, rows as any);
    const b = ask(mutant, 'حي البحيرات');
    mustCatch('the resolver without the union: it answers Jeddah alone and drops the 327 Mecca ads', !(b.ambiguous === true && b.cities.includes('Mecca')), JSON.stringify(b));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

if (failed) { console.error(`\n❌ verify-district-name-with-hay-inside-is-found: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-district-name-with-hay-inside-is-found: a district named with «حي» inside the word is found as typed, twins included.');
