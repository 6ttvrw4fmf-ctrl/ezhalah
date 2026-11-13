// The «كيف نحسبها؟» popup's words (owner-approved text 2026-11-11; title back to «كيف نحسبها؟» by the owner 2026-11-12), kept pure so
// tests can read them. The same title is the small underlined link under the home headline's market fact.
// Formal Arabic, no diacritics (owner: «keep it professional like» the «نماذج إزهله» card). {N} is the LIVE site count —
// the same number the share card and the welcome line show (src/data/siteCount.ts); while it is unknown the clause that
// carries it is left out, never a guessed number. sitesAr() picks the Arabic counted form for any N (3–10 مواقع, 11–99 موقعا, …).
export type Rule = { title: string; body: string };
export type Copy = { title: string; falconer: string; story: (n: number | null) => string; rulesTitle: string; rules: Rule[]; close: string };

// Arabic counted noun after a number: 3–10 take «مواقع», 11–99 take «موقعا», and 1, 2 or a round hundred take «موقع»
// (the last two digits decide, so 105 → مواقع, 149 → موقعا, 200 → موقع).
export function sitesAr(n: number): string {
  const r = n % 100;
  if (r >= 3 && r <= 10) return `${n} مواقع عقارية`;
  if (r >= 11) return `${n} موقعا عقاريا`;
  return `${n} موقع عقاري`;
}

export const HOW_IT_WORKS: Record<'ar' | 'en', Copy> = {
  ar: {
    title: 'كيف نحسبها؟',
    falconer: 'من صقار إزهله؟',
    story: (n) =>
      `كل صقر بارع يحتاج صقارا خبيرا يجهزه للميدان. صقار إزهله يجوب ${n ? sitesAr(n) : 'المواقع العقارية'} في السعودية ليجمع لك الإعلانات من مصادرها، ويغذي بها «شاهين»، نموذج الذكاء الاصطناعي في إزهله، ليختصر عليك البحث الطويل بإجابات محدثة من إعلانات حقيقية.`,
    rulesTitle: 'القواعد',
    rules: [
      { title: 'إعلانات من مصادرها الأصلية', body: 'كل معلومة نعرضها مأخوذة من إعلان منشور في أحد هذه المواقع.' },
      { title: 'التاريخ حسب الموقع نفسه', body: '«اليوم» و«هذا الأسبوع» و«جديد» تعني تاريخ نشر الإعلان في موقعه، لا تاريخ وصوله إلينا، والإعلان الذي لا يحمل تاريخا ولا مدة نشر لا يدخل في هذه الفترات.' },
      { title: 'أرقام دقيقة', body: 'الأسعار هي الأسعار المطلوبة في الإعلانات، وليست أسعار صفقات منفذة، والعقار المعروض في أكثر من موقع نحسبه مرة واحدة.' },
      { title: 'محتوى مخصص لك', body: 'تظهر معلومات جديدة كل ساعة، وغالبا عن المدينة والحي اللذين تبحث فيهما.' },
      { title: 'معلومات عقارية فقط', body: 'شاهين نموذج ذكاء اصطناعي وقد يخطئ، فتحقق من تفاصيل الإعلان مع المعلن قبل اتخاذ أي قرار. ما نقدمه ليس نصيحة مالية أو استثمارية ولا تقييما عقاريا.' },
    ],
    close: 'إغلاق',
  },
  en: {
    title: 'How do we calculate it?',
    falconer: "Who is Ezhalah's falconer?",
    story: (n) =>
      `Every skilled falcon needs an expert falconer to ready it for the field. Ezhalah's falconer roams ${n ? `${n} real estate websites` : 'the real estate websites'} across Saudi Arabia, gathering listings straight from their sources and feeding them to Shaheen, Ezhalah's AI model. Shaheen saves you the long search, with up-to-date answers drawn from real listings.`,
    rulesTitle: 'The rules',
    rules: [
      { title: 'Listings from their original sources', body: 'Every piece of information we show comes from a listing published on one of these websites.' },
      { title: 'Dates follow the website itself', body: '"Today", "This week" and "New" mean the date the listing was posted on its website, not the date it reached us. A listing that shows neither a date nor how long ago it was posted is not counted in these periods.' },
      { title: 'Exact figures', body: 'Prices are the asking prices in the listings, not prices from completed deals. A property listed on more than one website is counted once.' },
      { title: 'Tailored to you', body: 'New insights appear every hour, mostly about the city and district you are searching in.' },
      { title: 'Real estate information only', body: "Shaheen is an AI model and can make mistakes, so check the listing's details with the advertiser before making any decision. What we provide is not financial or investment advice, and it is not a property valuation." },
    ],
    close: 'Close',
  },
};
