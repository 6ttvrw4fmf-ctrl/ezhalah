// Arabic free text → English for the English UI (owner 2026-10-29: «everything must be translated to English»).
// Cards print source sentences such as the deed location — «حي البوادى بمدينة جدة مساحة الوحدة من الأرض 61.19 متر
// وتختص من المنافع والأجزاء المشتركة بمساحة 29.68 متر» — which used to come out letter by letter («Al Jnadryh
// Bmdynh Al Ryad Msahh…»). Deed text is formulaic, so: whole phrases first, then common words, then every run of
// remaining Arabic is read as a place name (translitPlace). Free and instant; display only — the stored text is the
// source's and is never changed. Whatever the source wrote, no Arabic letter reaches an English card.
import { translitPlace } from './translitPlace';

const AR_LETTER = /[؀-ۿ]/;
const NUM = '(\\d+(?:[.,]\\d+)?)';
const END = '(?=$|[\\s.،,/:()\\-])';
const START = '(?<=^|[\\s.،,/:()\\-])';
const w = (words: string) => new RegExp(`${START}(?:${words})${END}`, 'g');

// Ordered: longer phrases before the words inside them.
const PHRASES: [RegExp, string][] = [
  [new RegExp(`مساحة الوحدة من ال[أا]رض\\s*${NUM}\\s*(?:متر مربع|مترا?|م2|م²|م)?`, 'g'), ' · unit land area $1 m² '],
  [new RegExp(`و?تختص من المنافع والأجزاء المشتركة بمساحة\\s*${NUM}\\s*(?:متر مربع|مترا?|م2|م²|م)?`, 'g'), ', plus $1 m² of shared areas '],
  [new RegExp(`بمساحة\\s*${NUM}\\s*(?:متر مربع|مترا?|م2|م²|م)?`, 'g'), ' with an area of $1 m² '],
  [new RegExp(`مساحة\\s*${NUM}\\s*(?:متر مربع|مترا?|م2|م²|م)?`, 'g'), ' area $1 m² '],
  [new RegExp(`${NUM}\\s*(?:متر مربع|مترا?|م2|م²)${END}`, 'g'), '$1 m²'],
  [new RegExp(`${NUM}\\s*كم${END}`, 'g'), '$1 km'],
  [w('قطعة رقم|بقطعة رقم'), ' plot no. '],
  [w('مخطط رقم|المخطط رقم'), ' plan no. '],
  [w('بمدينة|في مدينة|فى مدينة|لمدينة'), ', '],
  [w('بمحافظة|في محافظة|فى محافظة|لمحافظة|محافظة'), ', '],
  [w('بمنطقة|في منطقة|فى منطقة'), ', '],
  [w('الواقع في|الواقعة في|الواقعه في|الواقع فى|الواقعة فى|الواقع على|الواقعة على'), ' located in '],
  [w('مساحة الوحدة'), ' unit area '],
];
const WORDS: Record<string, string> = {
  حي: '', حى: '', من: 'of', في: 'in', فى: 'in', على: 'on', و: 'and', رقم: 'no.', قطعة: 'plot', بقطعة: 'plot',
  القطعة: 'plot', مخطط: 'plan', المخطط: 'plan', الأرض: 'land', الارض: 'land', الوحدة: 'unit', مساحة: 'area',
  متر: 'm', مترا: 'm', الدور: 'floor', دور: 'floor', الشقة: 'apartment', العقار: 'property', كامل: 'entire',
  السكنية: 'residential', السكنى: 'residential', بدون: 'without', المجاورة: 'adjacent', الزراعية: 'agricultural',
  الزراعى: 'agricultural', المعدل: 'amended', البلك: 'block', الجزء: 'part', بنسبة: 'at a share of', الفرع: 'branch',
  فرعي: 'branch', خارج: 'outside', حدود: 'limits', الموصوفة: 'described', المسماه: '', المسمى: '', الواقع: 'located',
  الواقعة: 'located', الواقعه: 'located', التابع: 'belonging to', بارتفاع: 'at a height of', العقارية: 'real estate',
  الهوية: 'ID', الاولى: 'first', الأول: 'first', الثانى: 'second', الثاني: 'second', الثالث: 'third',
  الرابع: 'fourth', المشتركة: 'shared', المنافع: 'facilities', والأجزاء: 'and parts', وتختص: 'and includes',
  بمساحة: 'with an area of', مدينة: 'city', منطقة: 'area', ش: 'St.', ق: 'plot', م: 'm', بها: 'with', ها: '', ال: '', نعم: 'Yes', لا: 'No', يوجد: 'available',
  لايوجد: 'none', 'لا يوجد': 'none',
};

// A code — plan, plot, block numbers such as «7489/ق/ب» or «2566/أ» — keeps its shape: each lone letter becomes
// its Latin letter (abjad order for أ ب ج د ه, sound otherwise), never a word («ق» is not «plot» here).
const CODE_LETTER: Record<string, string> = {
  ا: 'A', أ: 'A', إ: 'A', آ: 'A', ب: 'B', ج: 'C', د: 'D', ه: 'E', ة: 'E', و: 'W', ز: 'Z', ح: 'H', ط: 'T', ي: 'Y',
  ى: 'Y', ك: 'K', ل: 'L', م: 'M', ن: 'N', س: 'S', ع: 'A', ف: 'F', ص: 'S', ق: 'Q', ر: 'R', ش: 'SH', ت: 'T',
  ث: 'TH', خ: 'KH', ذ: 'DH', ض: 'D', ظ: 'Z', غ: 'GH',
};
const CODE = /^(?=.*\d)[\d\s/\\\-.,()#ـ]*(?:[ء-ي](?![ء-ي])[\d\s/\\\-.,()#ـ]*)+$/;

export function freeTextEn(raw: string): string {
  if (!raw || !AR_LETTER.test(raw)) return raw;
  if (CODE.test(raw.trim())) return raw.trim().replace(/[ء-ي]/g, (c) => CODE_LETTER[c] ?? c);
  let s = ` ${String(raw).replace(/\s+/g, ' ')} `;
  for (const [re, en] of PHRASES) s = s.replace(re, en);
  // Word by word: known words become English; runs of unknown Arabic words are read together as one place name.
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (!run.length) return;
    const trailing = run[run.length - 1] === ' ';
    out.push(translitPlace(run.join('').trim()));
    if (trailing) out.push(' ');
    run = [];
  };
  // a dot or dash between digits belongs to the number («61.19», «2566-3»)
  for (const tok of s.split(/(\s+|[،,/:()]|(?<!\d)\.|\.(?!\d)|(?<!\d)-|-(?!\d))/)) {
    if (!tok) continue;
    if (/^\s+$/.test(tok)) { (run.length ? run : out).push(' '); continue; }
    if (!AR_LETTER.test(tok)) { flush(); out.push(tok === '،' ? ',' : tok); continue; }
    const bare = tok.replace(/[ًٌٍَُِّْـ]/g, '');
    if (bare in WORDS) { flush(); out.push(WORDS[bare]); continue; }
    run.push(bare);
  }
  flush();
  return tidy(out.join(''));
}

function tidy(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.:)])/g, '$1').replace(/([(])\s+/g, '$1')
    .replace(/,\s*,+/g, ',').replace(/\s*·\s*/g, ' · ').replace(/(?:\s·)+/g, ' ·').replace(/,\s*·/g, ' ·').replace(/·\s*,/g, '·')
    .replace(/^\s*[,·.]\s*/, '').replace(/\s*[,·.]\s*$/, '')
    .replace(/\s+/g, ' ').trim()
    .replace(/· ([a-z])/g, (_, c) => `· ${c.toUpperCase()}`)
    .replace(/^./, (c) => c.toUpperCase());
}
