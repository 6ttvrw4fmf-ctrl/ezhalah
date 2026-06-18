// Show a user's display name in Arabic script when the app is in Arabic (user request:
// "if it's Yusuf translate it to Arabic"). Names aren't really "translated" — they're
// transliterated. We do it in two layers:
//   1) a dictionary of common Arabic first names in their natural spelling (Yusuf → يوسف),
//      so frequent names look exactly right rather than phonetically mangled;
//   2) a phonetic Latin→Arabic fallback for anything not in the dictionary, so a surname
//      like "Nash" still renders in Arabic instead of staying Latin.
// The email/Gmail address is never passed through this — only the display name.

// Common Arabic given names → natural Arabic spelling. Keys are lowercased, hamza/space-free.
const NAME_MAP: Record<string, string> = {
  yusuf: 'يوسف', yousef: 'يوسف', yousuf: 'يوسف', youssef: 'يوسف', yusef: 'يوسف',
  mohammed: 'محمد', mohamed: 'محمد', muhammad: 'محمد', mohammad: 'محمد', mohd: 'محمد',
  ahmed: 'أحمد', ahmad: 'أحمد', ali: 'علي', omar: 'عمر', umar: 'عمر',
  khalid: 'خالد', khaled: 'خالد', abdullah: 'عبدالله', abdulaziz: 'عبدالعزيز',
  abdulrahman: 'عبدالرحمن', abdelrahman: 'عبدالرحمن', saud: 'سعود', faisal: 'فيصل',
  fahad: 'فهد', fahd: 'فهد', turki: 'تركي', nawaf: 'نواف', bandar: 'بندر',
  sultan: 'سلطان', majed: 'ماجد', majid: 'ماجد', tariq: 'طارق', tarek: 'طارق',
  hassan: 'حسن', hussain: 'حسين', hussein: 'حسين', ibrahim: 'إبراهيم', ismail: 'إسماعيل',
  yaqoub: 'يعقوب', yaqub: 'يعقوب', mahmoud: 'محمود', mahmood: 'محمود', mustafa: 'مصطفى',
  saleh: 'صالح', salman: 'سلمان', nasser: 'ناصر', naser: 'ناصر', rashed: 'راشد', rashid: 'راشد',
  ziad: 'زياد', zaid: 'زيد', zayd: 'زيد', anas: 'أنس', osama: 'أسامة', usama: 'أسامة',
  hamza: 'حمزة', adel: 'عادل', adil: 'عادل', waleed: 'وليد', walid: 'وليد', riyad: 'رياض',
  sami: 'سامي', samir: 'سمير', amir: 'أمير', ameer: 'أمير', bader: 'بدر', badr: 'بدر',
  // Female
  fatima: 'فاطمة', fatimah: 'فاطمة', sara: 'سارة', sarah: 'سارة', noura: 'نورة', nora: 'نورة',
  noor: 'نور', nour: 'نور', huda: 'هدى', hind: 'هند', reem: 'ريم', rim: 'ريم', dana: 'دانة',
  lina: 'لينا', lana: 'لانا', maha: 'مها', mona: 'منى', muna: 'منى', amal: 'أمل',
  aisha: 'عائشة', ayesha: 'عائشة', mariam: 'مريم', maryam: 'مريم', layla: 'ليلى', laila: 'ليلى',
  jana: 'جنى', joud: 'جود', shaden: 'شادن', ghada: 'غادة', salma: 'سلمى', rana: 'رنا',
  haya: 'هيا', wafa: 'وفاء', abeer: 'عبير', asma: 'أسماء', dalal: 'دلال', latifa: 'لطيفة',
  // Common surnames / particles
  nash: 'ناش', al: 'آل',
};

// Ordered so multi-letter clusters match before single letters.
const DIGRAPHS: Array<[RegExp, string]> = [
  [/sh/g, 'ش'], [/kh/g, 'خ'], [/th/g, 'ث'], [/dh/g, 'ذ'], [/gh/g, 'غ'],
  [/ph/g, 'ف'], [/ch/g, 'تش'], [/ck/g, 'ك'], [/oo/g, 'و'], [/ou/g, 'و'],
  [/ee/g, 'ي'], [/ai/g, 'اي'], [/ay/g, 'اي'], [/aa/g, 'ا'],
];
const SINGLES: Record<string, string> = {
  a: 'ا', b: 'ب', c: 'ك', d: 'د', e: 'ي', f: 'ف', g: 'ج', h: 'ه', i: 'ي',
  j: 'ج', k: 'ك', l: 'ل', m: 'م', n: 'ن', o: 'و', p: 'ب', q: 'ق', r: 'ر',
  s: 'س', t: 'ت', u: 'و', v: 'ف', w: 'و', x: 'كس', y: 'ي', z: 'ز',
};

function transliterateWord(word: string): string {
  const key = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!key) return word;
  if (NAME_MAP[key]) return NAME_MAP[key];
  if (!/[a-z]/i.test(word)) return word; // already Arabic / non-Latin — leave it
  let s = key;
  for (const [re, rep] of DIGRAPHS) s = s.replace(re, rep);
  let out = '';
  for (const ch of s) out += SINGLES[ch] ?? ch;
  return out || word;
}

// Public: render the name for display. Only transliterate when the UI is Arabic (isRTL); otherwise
// return the name unchanged. Each whitespace-separated part is handled independently.
export function displayName(name: string | undefined | null, isRTL: boolean): string {
  const n = (name ?? '').trim();
  if (!n || !isRTL) return n;
  return n.split(/\s+/).map(transliterateWord).join(' ');
}
