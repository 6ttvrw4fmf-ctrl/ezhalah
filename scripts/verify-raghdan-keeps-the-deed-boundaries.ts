// RAGHDAN KEEPS THE DEED BOUNDARIES BOX («الحدود») WORD FOR WORD — and never a neighbour's name.
//
// Every raghdan ad copied from the REGA register shows a «الحدود» box: per side (الشمال / الجنوب / الشرق / الغرب)
// the deed's «النوع», «الطول» and «الوصف». Measured 2026-10-25 over all 401 live ads: 272 carry it (270 with all
// four sides) and scrapers/raghdan/run.py read none of it. It is now stored in additional_info.boundaries.
// PDPL: 3 of 1,082 «الوصف» cells are a neighbour's full name («<name> بن <name> <family>»), which the shared
// redactor does not catch; a cell with a patronymic is left out whole.
//
// This runs the REAL map_listing over the box from live ad https://raghdan.sa/ar/property/194723340572/ (verbatim,
// fetched 2026-10-25) and over the same box with a neighbour's name in one cell. Two mutations must go red: the
// reader removed (the box is dropped again) and the name guard removed (a person's name is stored).
//
//   node --experimental-strip-types scripts/verify-raghdan-keeps-the-deed-boundaries.ts
import { execFileSync } from 'node:child_process';

const PY = String.raw`
import json, sys, os
sys.path.insert(0, os.getcwd())
import scrapers.raghdan.run as R

BOX = '<h2 class="text-xl text-gray-600 dark:text-gray-400 font-bold mb-6">الحدود</h2><div class="grid grid-cols-1 md:grid-cols-2 gap-3"><div class="group bg-gray-200 dark:bg-gray-700 p-4 rounded-lg"><h3 class="font-bold text-gray-400 mb-3">الشمال</h3><div class="space-y-2"><div class="flex flex-col sm:flex-row sm:justify-between"><span class="text-gray-400">النوع<!-- -->:</span><span class="text-gray-800 dark:text-gray-400">:</span></div><div class="flex flex-col sm:flex-row sm:justify-between"><span class="text-gray-400">الطول<!-- -->:</span><span class="text-gray-800 dark:text-gray-400">تسعة  متر   و  أربعون  سنتيمتر</span></div><div class="flex flex-col sm:flex-row sm:justify-between"><span class="text-gray-400">الوصف<!-- -->:</span><span class="text-gray-800 dark:text-gray-400">إرتـداد وقطعـة 564</span></div></div></div><div class="group bg-gray-200 dark:bg-gray-700 p-4 rounded-lg"><h3 class="font-bold text-gray-400 mb-3">الجنوب</h3><div class="space-y-2"><div class="flex flex-col sm:flex-row sm:justify-between"><span class="text-gray-400">النوع<!-- -->:</span><span class="text-gray-800 dark:text-gray-400">:</span></div><div class="flex flex-col sm:flex-row sm:justify-between"><span class="text-gray-400">الطول<!-- -->:</span><span class="text-gray-800 dark:text-gray-400">4.20 + 1.40 + 1.40 + 1.60 + 1.40 + 3.00 + 2.40</span></div><div class="flex flex-col sm:flex-row sm:justify-between"><span class="text-gray-400">الوصف<!-- -->:</span><span class="text-gray-800 dark:text-gray-400">وحدة 3 / 1 والدرج وممر</span></div></div></div><div class="group bg-gray-200 dark:bg-gray-700 p-4 rounded-lg"><h3 class="font-bold text-gray-400 mb-3">الشرق</h3><div class="space-y-2"><div class="flex flex-col sm:flex-row sm:justify-between"><span class="text-gray-400">النوع<!-- -->:</span><span class="text-gray-800 dark:text-gray-400">:</span></div><div class="flex flex-col sm:flex-row sm:justify-between"><span class="text-gray-400">الطول<!-- -->:</span><span class="text-gray-800 dark:text-gray-400">إثني عشر   متر   و  ثمانون  سنتيمتر</span></div><div class="flex flex-col sm:flex-row sm:justify-between"><span class="text-gray-400">الوصف<!-- -->:</span><span class="text-gray-800 dark:text-gray-400">إرتـداد وقطعـة 561</span></div></div></div><div class="group bg-gray-200 dark:bg-gray-700 p-4 rounded-lg"><h3 class="font-bold text-gray-400 mb-3">الغرب</h3><div class="space-y-2"><div class="flex flex-col sm:flex-row sm:justify-between"><span class="text-gray-400">النوع<!-- -->:</span><span class="text-gray-800 dark:text-gray-400">:</span></div><div class="flex flex-col sm:flex-row sm:justify-between"><span class="text-gray-400">الطول<!-- -->:</span><span class="text-gray-800 dark:text-gray-400">عشرة   متر</span></div><div class="flex flex-col sm:flex-row sm:justify-between"><span class="text-gray-400">الوصف<!-- -->:</span><span class="text-gray-800 dark:text-gray-400">وحدة 1 / 1</span></div></div></div></div>'
LD = {"@type": "RealEstateListing", "name": "شقة للبيع", "description": "المساحة 111.92 م²، عدد الغرف 3، العمر: جديد",
      "offers": {"price": 620000, "businessFunction": "https://schema.org/Sell"}, "floorSize": {"value": 111.92},
      "address": {"addressLocality": "جدة", "addressRegion": "منطقة مكة المكرمة"}}
URL = "https://raghdan.sa/ar/property/194723340572/"
NAMED = BOX.replace("إرتـداد وقطعـة 561", "فلان بن فلان الفلاني")

def page(box):
    return '<script type="application/ld+json">' + json.dumps(LD, ensure_ascii=False) + '</script><div>' + box + '</div>'

def run(mod):
    real, _ = mod.map_listing(page(BOX), URL)
    named, _ = mod.map_listing(page(NAMED), URL)
    return {"real": real["additional_info"].get("boundaries"), "named": named["additional_info"].get("boundaries")}

src = open("scrapers/raghdan/run.py", encoding="utf-8").read()
def mutant(find, repl):
    if find not in src:
        print(json.dumps({"error": "mutation anchor not found: %r — the reader was reshaped; update this barrier" % find})); sys.exit(0)
    ns = {"__name__": "raghdan_mutant", "__file__": "scrapers/raghdan/run.py"}
    exec(compile(src.replace(find, repl, 1), "<mutant>", "exec"), ns)
    class M: pass
    m = M(); m.map_listing = ns["map_listing"]
    return run(m)

print(json.dumps({
    "fixed": run(R),
    "no_reader": mutant('"boundaries": _rendered_boundaries(body) or None,', ''),
    "no_name_guard": mutant(' and not _PATRONYMIC_RE.search(val)', ''),
}, ensure_ascii=False))
`;

const raw = execFileSync('python3', ['-c', PY], { encoding: 'utf8', cwd: process.cwd() });
const res = JSON.parse(raw.trim().split('\n').pop()!);
if (res.error) { console.error(`✗ ${res.error}`); process.exit(1); }

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};
type Box = Record<string, Record<string, string>> | null | undefined;
// The page's own words, side by side, exactly as ad 194723340572 shows them (whitespace runs collapsed).
const EXPECTED = {
  'الشمال': { 'الطول': 'تسعة متر و أربعون سنتيمتر', 'الوصف': 'إرتـداد وقطعـة 564' },
  'الجنوب': { 'الطول': '4.20 + 1.40 + 1.40 + 1.60 + 1.40 + 3.00 + 2.40', 'الوصف': 'وحدة 3 / 1 والدرج وممر' },
  'الشرق': { 'الطول': 'إثني عشر متر و ثمانون سنتيمتر', 'الوصف': 'إرتـداد وقطعـة 561' },
  'الغرب': { 'الطول': 'عشرة متر', 'الوصف': 'وحدة 1 / 1' },
};
const keepsTheBox = (b: Box) => JSON.stringify(b) === JSON.stringify(EXPECTED);
const keepsNoName = (b: Box) => !!b && !JSON.stringify(b).includes('بن فلان') && b['الشرق']?.['الطول'] === 'إثني عشر متر و ثمانون سنتيمتر';
const mustCatch = (label: string, caught: boolean) =>
  check(`(mutation) catches ${label}`, caught, 'the barrier passed the defect it exists to stop');

check('the live box is stored side by side, word for word (empty «:» type cells left out)', keepsTheBox(res.fixed.real), JSON.stringify(res.fixed.real));
check('a neighbour\'s name is never stored, the rest of that side is', keepsNoName(res.fixed.named), JSON.stringify(res.fixed.named));
mustCatch('the boundaries box dropped again', !keepsTheBox(res.no_reader.real));
mustCatch('a neighbour\'s full name stored', !keepsNoName(res.no_name_guard.named));

if (failed) { console.error(`\n✗ raghdan boundaries: ${failed} failure(s)`); process.exit(1); }
console.log('\n✓ raghdan keeps the deed boundaries word for word and no neighbour\'s name (both mutation-proven)');
