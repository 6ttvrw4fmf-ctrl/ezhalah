// gathern Arabic-district catalog bridge — nomination script (offline, read-only).
// Work-list = the 2026-07-30 audit's 116 distinct (city_id, additional_info.district_ar) forms behind
// gathern's 721 null-district rows (city resolved, Arabic district present, catalog match missing).
// A form is NOMINATED only when the OFFICIAL sa-locations.json lists exactly ONE district of the SAME
// city with the same Arabic match-key (format-independent proof); 0 or >1 → rejected. City-name-in-
// district-slot forms are reported separately (bucket-B town rule — owner decision, never auto-seeded).
// Output = a review table + SQL VALUES; nothing is written anywhere.
//   node --experimental-strip-types scripts/nominate-gathern-districts.ts
import { readFileSync } from 'node:fs';
import { matchArInCity, matchKeyAr } from './lib-gathern-district-bridge.ts';

const sa = JSON.parse(readFileSync(new URL('../src/data/sa-locations.json', import.meta.url), 'utf8'));

// [city_id, exact gathern additional_info.district_ar spelling, listing count] — exported 2026-07-30.
const WORK: Array<[number, string, number]> = [
  [18, 'درب الحرمين', 45], [15, 'السودة', 41], [1542, 'بني سار', 31], [1549, 'طريق البحر', 31],
  [5, 'طريق الهدا', 30], [13, 'القرية الثانية', 30], [15, 'طريق الملك عبدالله', 29], [62, 'طريق الميه', 26],
  [1542, 'الاطاولة', 22], [17, 'مخطط 8', 22], [62, 'نعمان.', 18], [12, 'المبرز', 16], [3455, 'العطبة', 13],
  [15, 'طريق الميه', 13], [18, 'سندس', 12], [10, 'مطار حائل الاقليمي', 11], [1542, 'بلجرشي', 9],
  [3447, 'الدائر', 9], [1542, 'الاطاوله', 9], [1542, 'رغدان   الحبناء', 7], [1542, 'الحجرة', 7],
  [15, 'بالغليظ', 7], [199, 'مغيرا', 6], [1390, 'الفيصلي', 6], [15, 'تمنية', 6], [15, 'قرى ال عاصم', 6],
  [199, 'مخطط الميدان السكني', 6], [1542, 'المندق', 5], [10, 'الفجر', 5], [3447, 'الداير', 5],
  [1542, 'حي بني هريرة', 4], [199, 'الحجر', 4], [199, 'العذيب', 4], [199, 'قراقر', 4], [14, 'حمراء الأسد', 4],
  [15, 'الواديين', 4], [1542, 'القرى-القوارير', 4], [1423, 'الغالة', 4], [15, 'الفرعاء', 3], [15, 'السقا', 3],
  [62, 'طريق المطار', 3], [5, 'السيل الصغير', 3], [1609, 'ثريبان', 3], [2226, 'الامير عبدالاله أ', 3],
  [6, 'الزايدي التخصصي', 3], [5, 'الحلقه الغربيه/القيم', 3], [1531, 'المحمدية', 3], [1056, 'مخطط البريك', 3],
  [3, 'الدريهيمة', 3], [1351, 'مخطط الولامين', 3], [1542, 'حي قرن ظبي', 3], [1542, 'شهبه -  جدره', 3],
  [1, 'السهبان', 2], [3, 'العوالي (نمار)', 2], [5, 'طريق وادي وج', 2], [5, 'وادي الاقيلح', 2],
  [5, 'وادي ذي غزال /الشرا', 2], [12, 'الصالحيه طرف الخدود', 2], [15, 'ال السريع', 2], [15, 'عضاضة', 2],
  [65, 'النزهه', 2], [288, 'الثمد', 2], [323, 'حي الدقم', 2], [1053, 'الرايس', 2], [1531, 'العامر', 2],
  [1542, 'العقيق', 2], [2835, 'النصباء', 2], [3666, 'حي الواحة', 2], [113, 'الفاضلي الهدا', 1],
  [94, 'السعيرة', 1], [62, 'التحلية طريق المحالة', 1], [18, 'شاطئ البردايس', 1], [3652, 'الجروف', 1],
  [1531, 'الفيصليه', 1], [18, 'ذهبان', 1], [1531, 'حي البحري', 1], [1531, 'قرية الفرح', 1],
  [18, 'حراء الرئيسي', 1], [17, 'وادي جازان - الريان', 1], [15, 'مركز تمنية', 1], [3666, 'التاله قاردنز', 1],
  [15, 'مخطط الزايدي', 1], [1542, 'الكراء', 1], [15, 'قرية النجاد بالوادي الطالع قريبة من السودة', 1],
  [15, 'قرية العزيزه', 1], [1542, 'بني حسن-قرية ذيب', 1], [15, 'عبل / قرية ال عبيد', 1], [1542, 'بني سعد', 1],
  [15, 'حي سماء ابها', 1], [15, 'حي المسقي', 1], [15, 'حي المحارث', 1], [15, 'بني مازن', 1], [12, 'العمران', 1],
  [1549, 'مخطط الاشول', 1], [1576, 'نمرة', 1], [11, 'حاضرة', 1], [1625, 'حي مخطط الشاطئ', 1], [1801, 'ترقش', 1],
  [1940, 'جبه', 1], [6, 'محبس الجن', 1], [2819, 'العقيق', 1], [2819, 'جفن الجنوبي', 1], [3666, 'مارينا', 1],
  [2945, 'حي المهلل', 1], [3236, 'ناوان', 1], [3446, 'مروح والعدوين حتى الفرحه', 1], [5, 'مسره طريق الهدا', 1],
  [5, 'السيل الصغير ذوي حجي الشارع العام', 1], [113, 'عقرباء', 1], [233, 'حي الدخل المحدود', 1],
  [3, 'الغروب', 1], [3462, 'الخضراء', 1], [485, 'الفرع', 1], [777, 'المفرق', 1], [3479, 'المحلة', 1],
];

const cityName = new Map<number, string>(sa.cities.map((c: any) => [c[0], c[3]]));
// city-name-in-district-slot detector (bucket-B town rule): match-key equals ANY official city name.
const cityKeySet = new Set<string>(sa.cities.map((c: any) => matchKeyAr(c[3])));

const nominated: any[] = [], cityInSlot: any[] = [], noMatch: any[] = [];
for (const [city_id, ar, n] of WORK) {
  const hit = matchArInCity(sa.districts, city_id, ar);
  if (hit) { nominated.push({ city_id, ar, n, official: hit, city: cityName.get(city_id) }); continue; }
  if (cityKeySet.has(matchKeyAr(ar))) { cityInSlot.push({ city_id, ar, n, city: cityName.get(city_id) }); continue; }
  noMatch.push({ city_id, ar, n });
}

const sum = (a: any[]) => a.reduce((s, x) => s + x.n, 0);
console.log('NOMINATED (official-district-of-same-city, exactly one — seed EXACT gathern spelling):');
console.log('city_id | city | gathern spelling | official ar | listings');
for (const x of nominated.sort((a, b) => b.n - a.n))
  console.log(`${x.city_id} | ${x.city} | ${x.ar} | ${x.official} | ${x.n}`);
console.log(`  → ${nominated.length} forms / ${sum(nominated)} listings`);
console.log('\nSQL VALUES (city_id, exact gathern spelling):');
for (const x of nominated) console.log(`    (${x.city_id}, '${x.ar.replace(/'/g, "''")}'), -- official: ${x.official} n=${x.n}`);
console.log(`\nCITY-NAME-IN-DISTRICT-SLOT (bucket-B town rule — owner decision, NOT seeded): ${cityInSlot.length} forms / ${sum(cityInSlot)} listings`);
for (const x of cityInSlot) console.log(`  ${x.city_id}\t${x.city}\t«${x.ar}»  (${x.n})`);
console.log(`\nNO-MATCH (not an official district of that city — stays NULL, honest): ${noMatch.length} forms / ${sum(noMatch)} listings`);
for (const x of noMatch) console.log(`  ${x.city_id}\t«${x.ar}»  (${x.n})`);
