// Navigation changes only the reveal position; it never starts a new rotated search.
export function agentResultRequest(text: string, shown: number, pageSize: number): number | null {
  const s = text.trim().replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[أإآ]/g, 'ا').toLowerCase().replace(/[.!؟?]+$/u, '').trim();
  const next = s.match(/^(?:(?:ورني|اعرض|ابي|show|display)\s+)?(?:another\s+)?(\d+)\s*(?:زيادة|زياده|اضافية|more|additional)(?:\s+(?:results|listings|عقار|عقارات|نتيجة|نتائج))?$/u)
    ?? s.match(/^another\s+(\d+)(?:\s+(?:results|listings))?$/u);
  if (next) return Math.min(500, shown + Number(next[1]));
  if (/^(?:كمل|ورني زيادة|ورني زياده|النتائج التالية|الصفحة التالية|next page|show more|more)$/u.test(s)) return Math.min(500, shown + pageSize);
  const page = s.match(/^(?:page|الصفحة|صفحة)\s+(\d+|الثانية|الثالثة|الرابعة|الخامسة)$/u);
  if (page) {
    const n = ({الثانية:2,الثالثة:3,الرابعة:4,الخامسة:5} as Record<string,number>)[page[1]] ?? Number(page[1]);
    return n >= 1 ? Math.min(500, n * pageSize) : null;
  }
  const total = s.match(/^(?:خلها|خليها|make it|show|display|ورني|اعرض)\s+(\d+)(?:\s+(?:results|listings|عقار|عقارات|نتيجة|نتائج))?$/u);
  return total && Number(total[1]) > 0 ? Math.min(500, Number(total[1])) : null;
}
