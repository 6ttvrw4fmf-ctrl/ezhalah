// dealapp bridge-expansion PHASE 2 — nomination script (offline, read-only).
// For each dealapp English district form not in bridge_en_district, romanize the listing's own
// city's catalog districts (the app's translitPlace) and compare CONSONANT SKELETONS — robust to
// Arabic-romanization variance (shamiah/shamiyah, worrod/worod). A form is NOMINATED only when
// exactly ONE catalog district in that city matches (format-independent proof); 0 or >1 → rejected.
// Output = a review table for the owner; nothing is written anywhere.
//   node --experimental-strip-types scripts/nominate-dealapp-districts.ts
import { readFileSync } from 'node:fs';
import { normEn, skel, JUNK } from './lib-dealapp-bridge.ts';
// Official KSA dataset (the same file the app's transliterator is built on): districts as
// [city_id, region_id, name_en, name_ar] — city ids match loc_catalog_city. Matching dealapp's
// English against these OFFICIAL English names beats letter transliteration.
const sa = JSON.parse(readFileSync(new URL('../src/data/sa-locations.json', import.meta.url), 'utf8'));

const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhbm5hcmJrd2N5bXJvdHp3ZGJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MDgxMDAsImV4cCI6MjA5NTk4NDEwMH0.Z-GhSpan6otYWkc8sU43Dw5PT5T_VBUMr0IDZShCQw0';
const BASE = 'https://aannarbkwcymrotzwdbo.supabase.co/rest/v1';

// Work-list: dealapp null-district rows whose norm_en_district(neighborhood) is absent from the
// bridge (exported 2026-07-26; count = current listing count).
const WORK: Array<{ city_id: number; en: string; n: number }> = [
  {city_id:6,en:'AL-SHAMIAH',n:95},{city_id:6,en:"Al Ju'ranah",n:90},{city_id:62,en:'PLAN 6',n:44},
  {city_id:6,en:'Al Mohammadiyyah',n:42},{city_id:62,en:'Al-dHRAFAH',n:37},{city_id:62,en:'ALSAFER',n:34},
  {city_id:62,en:'north of Ettadhamen',n:29},{city_id:6,en:'Alhoseniah',n:25},
  {city_id:1801,en:'Al Haylah Al Gharbi Dist.',n:24},{city_id:6,en:'Al Hajlah Dist.',n:24},
  {city_id:6,en:'Al Usaylah Dist.',n:22},{city_id:6,en:'Shaib Amir And Shaib Ali Dist.',n:21},
  {city_id:62,en:'al-worrod',n:19},{city_id:6,en:'Ray Zakhir Dist.',n:19},{city_id:500,en:'aljamiaah',n:18},
  {city_id:2467,en:'Al Dulaymiyah',n:17},{city_id:3666,en:'Klayah',n:16},{city_id:62,en:'al-waffa',n:13},
  {city_id:62,en:'Aseer industrial city',n:13},{city_id:3542,en:'Al Dahiya',n:12},
  {city_id:6,en:'Ash Shubaikah Dist.',n:12},{city_id:6,en:'Ash Shuhada Dist.',n:12},
  {city_id:62,en:'ALOMARAH',n:12},{city_id:62,en:'Wadi Ibn Hashbal',n:12},{city_id:294,en:'Rumah',n:11},
  {city_id:2167,en:'Abu Main Dist.',n:11},{city_id:3666,en:'Talah Dist.',n:11},
  {city_id:418,en:'Al-Musayfiya',n:11},{city_id:2467,en:'TYBAH',n:11},{city_id:3417,en:'Najran University',n:11},
  {city_id:6,en:'Sharai Al Mujahidin Dist.',n:10},{city_id:500,en:'aljabal',n:10},{city_id:62,en:'Kairouan',n:10},
  {city_id:500,en:'new taaheel',n:10},{city_id:360,en:'Mahd Al Thahab',n:9},{city_id:80,en:'Ar Riyadi Dist.',n:9},
  {city_id:62,en:'Al-GHARABAH Dist.',n:8},{city_id:3381,en:'Dhahran Al Janub',n:8},
  {city_id:2590,en:"Al Juaima'h",n:8},{city_id:6,en:'qishbah',n:8},{city_id:3542,en:'Alzohoor',n:8},
  {city_id:2213,en:'Ahwash Ad Daydeeb Dist.',n:8},{city_id:62,en:'tarah',n:8},
  {city_id:1801,en:'Al Haylah Ash Sharqi Dist.',n:7},{city_id:500,en:'DAWRIEAT',n:7},
  {city_id:6,en:'Al Haram Dist.',n:7},{city_id:3542,en:'Ar Rakubah Dist.',n:7},
  {city_id:2213,en:'Ivestment Subdivision Plan',n:7},{city_id:6,en:"Al Sharai' Ash Shamaliyyah",n:7},
  {city_id:62,en:'al-wissam',n:7},{city_id:2467,en:'Al Qurayn',n:6},{city_id:80,en:'An Nuqailiah Dist.',n:6},
  {city_id:377,en:'almethib',n:6},{city_id:500,en:'ushaiqer',n:6},{city_id:2467,en:'almajid',n:6},
  {city_id:3479,en:'Abu As Sala',n:6},{city_id:62,en:'14Th Brigade Housing',n:5},
  {city_id:1801,en:'Al Maqaiid Dist.',n:5},{city_id:3417,en:'Al Ghuwayla B',n:5},{city_id:3479,en:'Al Arjeen',n:5},
  {city_id:1801,en:'SIHAR aL ASIM',n:5},{city_id:62,en:'DORAT AL-KHAMES',n:5},{city_id:62,en:'Atood plan',n:5},
  {city_id:2467,en:'Thebea',n:4},{city_id:1801,en:'alhuddan',n:4},{city_id:6,en:'Ad Diyafah Dist.',n:4},
  {city_id:6,en:'Al Bibyan Dist.',n:4},{city_id:2167,en:'Ar Ruwaihah Dist.',n:4},
  {city_id:454,en:'Gharb An Nabiyah Dist.',n:4},{city_id:6,en:'Al Misfalah Dist.',n:4},
  {city_id:418,en:'ar-rawad',n:4},{city_id:3666,en:'Hareer Dist.',n:4},{city_id:62,en:'al-raqy',n:4},
  {city_id:418,en:'Al Idhaah Dist.',n:3},{city_id:3479,en:'Algayem',n:3},{city_id:377,en:'alnaeem',n:3},
  {city_id:377,en:'As Samad Dist.',n:3},{city_id:2800,en:'WESTREN ALJADAR',n:3},
  {city_id:3347,en:'Al Khalidiyyah',n:3},{city_id:3347,en:'Subdivision Plan B',n:3},
  {city_id:3479,en:'Al Dhabyah Dist.',n:2},{city_id:80,en:'Rabwat Al Hajeb Dist.',n:2},
  {city_id:80,en:'Al Kada Dist.',n:2},{city_id:62,en:'Yaara',n:2},{city_id:62,en:'Tayib Al Ism Dist.',n:2},
  {city_id:62,en:'shkar',n:2},{city_id:2213,en:'Al Mansuriyah Dist.',n:2},{city_id:2213,en:'Al Musaidiyah Dist.',n:2},
  {city_id:2800,en:'AL-AGHAR',n:2},{city_id:62,en:'alfajir plan',n:2},{city_id:3666,en:'Tanmiyah Dist.',n:2},
  {city_id:454,en:'An Nabiyah Dist.',n:2},{city_id:3479,en:'Al Muutarid Dist.',n:1},
  {city_id:3479,en:'Jukhairah Dist.',n:1},{city_id:62,en:'almaamorah',n:1},{city_id:6,en:'AL-SHAREIF SAUD',n:1},
  {city_id:6,en:'Al Qararah And An Naqa Dist.',n:1},{city_id:2213,en:'New Industrial Dist.',n:1},
  {city_id:418,en:'Al Jamieyah',n:1},{city_id:62,en:'industrial zone',n:1},
  {city_id:377,en:'As Silayyib Al Gharbi Dist.',n:1},
];




async function fetchAll(path: string): Promise<any[]> {
  const r = await fetch(`${BASE}/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

const cityIds = [...new Set(WORK.map((w) => w.city_id))];
// canonical attestation (per city) — tells us whether the Arabic also needs a phase-1-style catalog seed
const canon = await fetchAll(`loc_canonical_district?city_id=in.(${cityIds.join(',')})&select=city_id,district_norm&limit=10000`);
const canonSet = new Set(canon.map((d: any) => `${d.city_id}:${d.district_norm}`));
const cityName = new Map(sa.cities.map((c: any) => [c[0], c[3]]));

// city_id → Map<skeleton, {en,ar}[]> from the OFFICIAL dataset
const byCity = new Map<number, Map<string, { en: string; ar: string }[]>>();
for (const [cid, , en, ar] of sa.districts) {
  const k = skel(en);
  if (!k) continue;
  const m = byCity.get(cid) ?? new Map();
  const arr = m.get(k) ?? [];
  if (!arr.some((x: any) => x.ar === ar)) arr.push({ en, ar });
  m.set(k, arr);
  byCity.set(cid, m);
}

const nominated: any[] = [], noMatch: any[] = [], ambiguous: any[] = [], junk: any[] = [];
for (const w of WORK) {
  if (JUNK.test(w.en)) { junk.push(w); continue; }
  const hits = byCity.get(w.city_id)?.get(skel(w.en)) ?? [];
  if (hits.length === 1) {
    const h = hits[0];
    const method = normEn(w.en) === normEn(h.en) ? 'exact' : 'skeleton';
    // duplicate-name guard: how many OFFICIAL districts in this city share the normalized EN name?
    const cityDists = sa.districts.filter((d: any) => d[0] === w.city_id);
    const competing = cityDists.filter((d: any) => skel(d[2]) === skel(w.en)).length;
    nominated.push({ ...w, ar: h.ar, official_en: h.en, method, competing, city: cityName.get(w.city_id) });
  } else if (hits.length === 0) noMatch.push(w);
  else ambiguous.push({ ...w, hits: hits.map((h: any) => h.ar) });
}

const sum = (a: any[]) => a.reduce((s, x) => s + x.n, 0);
// ── Owner review table (complete, tiered) ──
console.log('REVIEW TABLE (city_id | city | source_en | official_en | ar | method | listings | competing | confidence)');
for (const x of nominated.sort((a: any, b: any) => (a.method === b.method ? b.n - a.n : a.method === 'exact' ? -1 : 1))) {
  const conf = x.method === 'exact'
    ? 'EN form == official dataset name (city-scoped, unique)'
    : 'consonant skeleton == exactly one official district in city';
  console.log(`${x.city_id} | ${x.city} | ${x.en} | ${x.official_en} | ${x.ar} | ${x.method} | ${x.n} | ${x.competing} | ${conf}`);
}
console.log('\nSQL VALUES (tier1 then tier2):');
for (const tier of ['exact', 'skeleton'])
  for (const x of nominated.filter((y: any) => y.method === tier))
    console.log(`    (${JSON.stringify(x.en).replace(/"/g, "'")}, '${x.city}', '${x.ar}'), -- ${tier} ${x.city_id} n=${x.n}`);
console.log('\nCatalog-attestation gaps (need phase-1-style seed):');
const { default: crypto } = await import('node:crypto');
// resolver key ≈ norm_district_tok; approximate check via canonical set fetched earlier is by district_norm,
// which we cannot recompute exactly in JS — emit the AR list for SQL-side attestation check instead.
console.log(JSON.stringify([...new Set(nominated.map((x: any) => x.ar))]));
console.log(`NOMINATED (exactly-one match): ${nominated.length} forms / ${sum(nominated)} listings`);
for (const x of nominated) console.log(`  ${x.city_id}\t${x.city}\t${x.en}  →  ${x.ar}  [${x.official_en}]  (${x.n})`);
console.log(`\nAMBIGUOUS (>1 match, rejected): ${ambiguous.length} forms / ${sum(ambiguous)} listings`);
for (const x of ambiguous) console.log(`  ${x.city_id}\t${x.en}  →  [${x.hits.join(' | ')}]  (${x.n})`);
console.log(`\nNO-MATCH (rejected): ${noMatch.length} forms / ${sum(noMatch)} listings`);
for (const x of noMatch) console.log(`  ${x.city_id}\t${x.en}  (${x.n})`);
console.log(`\nJUNK (plans/zones/institutions, never nominated): ${junk.length} forms / ${sum(junk)} listings`);
for (const x of junk) console.log(`  ${x.city_id}\t${x.en}  (${x.n})`);
