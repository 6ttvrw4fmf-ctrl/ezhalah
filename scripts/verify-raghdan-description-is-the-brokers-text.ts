// RAGHDAN'S `description` IS WHAT THE BROKER WROTE, NOT THE LINE THE SITE GENERATES.
//
// THE DEFECT (facts test 2026-10-24, docs/ops/reports/FACTS_EXTRACT_TEST_2026-10-24.md): 4 of 30 raghdan ads gave
// any fact against 85% fleet-wide. Every raghdan row stored the JSON-LD `description` — a line the site generates
// from its own fields («المساحة 224.08 م²، عدد الغرف 4، العمر: جديد») and never shows. The text the customer reads
// on the page is the broker's own block (ad 8dOoxQ below, re-read in a real browser 2026-10-25): street width,
// 4 bedrooms, 4 bathrooms, a diwaniya, a majlis, a kitchen, a garage. scrapers/raghdan/run.py read that block for
// amenities only and threw the words away.
//
// This runs the REAL map_listing over the live page's own broker <p> (verbatim) and asserts the stored description
// carries the broker's words, a page with no broker block keeps the JSON-LD line, and the broker's own name is
// never stored (PDPL). The mutation re-introduces the old line and must go red.
//
//   node --experimental-strip-types scripts/verify-raghdan-description-is-the-brokers-text.ts
import { execFileSync } from 'node:child_process';

const PY = String.raw`
import json, sys, os
sys.path.insert(0, os.getcwd())
import scrapers.raghdan.run as R

# Live ad https://raghdan.sa/ar/property/0eu5PuVIUV2gnt8dOoxQ/ (fetched 2026-10-25): the broker's <p> verbatim, and
# the JSON-LD fields map_listing reads (streetAddress left out: this scraper never stores it, PDPL).
BROKER_P = ('<p class="text-gray-600 dark:text-gray-400 font-medium leading-relaxed text-sm font-cairo" '
            'style="white-space:pre-wrap;text-align:justify">الخبر - حي الجسر (موقع مميز على شارع عرض 40 متر).  ━   '
            '📐 تفاصيل ومواصفات الشقة الأرضية:\nالمساحة الإجمالية: 224 متر مربع.\nغرف النوم: 4 غرف نوم (مقسمة إلى: '
            'غرفتين ماستر + غرفتين نوم أطفال).\nدورات المياه: 4 حمامات.\nالمجالس (مميزات حصرية): ديوانية + مجلس رجال.\n'
            'المرافق الأساسية: صالة معيشة + مطبخ + كراج سيارة مستقل.  ━   💰 السعر المطلوب:\n850,000 ريال (السعر شامل السعي).</p>')
LD = {"@type": "RealEstateListing", "name": "شقة للبيع في الجسر، الخبر",
      "description": "المساحة 224.08 م²، عدد الغرف 4، العمر: جديد",
      "offers": {"@type": "Offer", "price": 850000, "priceCurrency": "SAR", "businessFunction": "https://schema.org/Sell"},
      "floorSize": {"@type": "QuantitativeValue", "value": 224.08, "unitCode": "MTK"},
      "address": {"@type": "PostalAddress", "addressLocality": "الخبر", "addressRegion": "المنطقة الشرقية"},
      "broker": {"@type": "RealEstateAgent", "name": "مؤسسة مثال للتطوير العقاري"}}
URL = "https://raghdan.sa/ar/property/0eu5PuVIUV2gnt8dOoxQ/"

def page(extra):
    return '<script type="application/ld+json">' + json.dumps(LD, ensure_ascii=False) + '</script>' + extra

def run(mod):
    real, _ = mod.map_listing(page(BROKER_P), URL)
    rega, _ = mod.map_listing(page('<div>لا يوجد وصف</div>'), URL)
    signed, _ = mod.map_listing(page(BROKER_P.replace('</p>', '\n🏢 مؤسسة مثال للتطوير العقاري</p>')), URL)
    return {"real": real["description"], "ld_kept": real["additional_info"].get("ld_description"),
            "rega": rega["description"], "signed": signed["description"]}

out = {"fixed": run(R)}
# MUTATION: the pre-2026-10-25 line — description from the generated JSON-LD text.
src = open("scrapers/raghdan/run.py", encoding="utf-8").read()
anchor = "description = _redact(redact_pii("
if anchor not in src:
    print(json.dumps({"error": "mutation anchor not found: the description line was reshaped; update this barrier"})); sys.exit(0)
start = src.index(anchor); end = src.index("or _redact(description_raw)", start) + len("or _redact(description_raw)")
ns = {"__name__": "raghdan_mutant", "__file__": "scrapers/raghdan/run.py"}
exec(compile(src[:start] + "description = _redact(description_raw)" + src[end:], "<mutant>", "exec"), ns)
class M: pass
m = M(); m.map_listing = ns["map_listing"]
out["mutant"] = run(m)
print(json.dumps(out, ensure_ascii=False))
`;

const raw = execFileSync('python3', ['-c', PY], { encoding: 'utf8', cwd: process.cwd() });
const res = JSON.parse(raw.trim().split('\n').pop()!);
if (res.error) { console.error(`✗ ${res.error}`); process.exit(1); }

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};
// The invariant, as one predicate both the fixed and the mutant code are judged by.
const brokerWordsStored = (r: { real: string }) =>
  !!r.real && ['شارع عرض 40 متر', '4 حمامات', 'ديوانية + مجلس رجال', 'كراج سيارة مستقل'].every((w) => r.real.includes(w)) &&
  !r.real.includes('عدد الغرف 4، العمر');
const mustCatch = (label: string, caught: boolean) =>
  check(`(mutation) catches ${label}`, caught, 'the barrier passed the defect it exists to stop');

const f = res.fixed;
check('the live ad stores the broker\'s own text', brokerWordsStored(f), f.real);
check('the generated JSON-LD line is kept in additional_info.ld_description', f.ld_kept === 'المساحة 224.08 م²، عدد الغرف 4، العمر: جديد', f.ld_kept);
check('a page with no broker block keeps the JSON-LD line', f.rega === 'المساحة 224.08 م²، عدد الغرف 4، العمر: جديد', f.rega);
check('the broker\'s own name (the JSON-LD broker.name) is never stored', !!f.signed && !f.signed.includes('مؤسسة مثال') && f.signed.includes('4 حمامات'), f.signed);
mustCatch('description read from the generated JSON-LD line again', !brokerWordsStored(res.mutant));

if (failed) { console.error(`\n✗ raghdan description: ${failed} failure(s)`); process.exit(1); }
console.log('\n✓ raghdan stores what the broker wrote (old JSON-LD line mutation-proven caught)');
