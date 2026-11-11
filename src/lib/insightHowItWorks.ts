// The «كيف نحسبها؟» popup's words (owner-approved 2026-11-11, replacing the 2026-10-22 «كيف تشتغل؟» sheet), kept pure so
// tests can read them. The same title is the small underlined link under the home headline's market fact.
// Formal Arabic, no diacritics (owner: «keep it professional like» the «نماذج إزهله» card). {N} is the LIVE site count —
// the same number the share card and the welcome line show (src/data/siteCount.ts); while it is unknown the clause that
// carries it is left out, never a guessed number («وعددها {N}» keeps the Arabic correct for any N).
export type Rule = { title: string; body: string };
export type Copy = { title: string; falconer: string; story: (n: number | null) => string; rulesTitle: string; rules: Rule[]; close: string };

export const HOW_IT_WORKS: Record<'ar' | 'en', Copy> = {
  ar: {
    title: 'كيف نحسبها؟',
    falconer: 'من هو الصقار؟',
    story: (n) =>
      `الصقار يربي صقره ويعتني به ويحسن إطعامه. وصقارنا يجمع كل يوم الإعلانات من جميع المواقع العقارية في السعودية${n ? `، وعددها ${n}` : ''}، ويقدم هذه البيانات الثمينة لصقره شاهين، ليجيبك بدقة عند سؤاله. وشاهين نموذج ذكاء اصطناعي، وقد يخطئ أحيانا، لذا تحقق دائما من الإعلان الأصلي. ومن هذه البيانات نفسها تأتي هذه المعلومة: الأسعار، والإعلانات الجديدة، والتغيرات، للمساكن والأراضي والمحلات.`,
    rulesTitle: 'القواعد',
    rules: [
      { title: 'إعلانات حقيقية فقط', body: 'كل معلومة مصدرها إعلانات منشورة في هذه المواقع.' },
      { title: 'تاريخ الموقع نفسه', body: '«اليوم» و«هذا الأسبوع» و«جديد» تعني تاريخ نشر الإعلان في موقعه، لا تاريخ وصولنا إليه. والإعلان الذي لا يحمل تاريخا لا يحتسب.' },
      { title: 'أرقام دقيقة', body: 'الأسعار هي المطلوبة في الإعلانات، وليست أسعار صفقات منفذة. ونحتسب العقار المكرر في أكثر من موقع مرة واحدة، ونتحقق من كل رقم مرتين.' },
      { title: 'مخصصة لك', body: 'معلومة جديدة كل ساعة، غالبا عن المدينة والحي اللذين بحثت فيهما.' },
      { title: 'معلومة فقط', body: 'ليست نصيحة مالية أو استثمارية، ولا تقييما عقاريا. يرجى التحقق من التفاصيل مع المعلن قبل اتخاذ أي قرار.' },
    ],
    close: 'إغلاق',
  },
  en: {
    title: 'How we calculate it',
    falconer: 'Who is the falconer?',
    story: (n) =>
      `A falconer raises his falcon, cares for it and feeds it well. Every day our falconer collects the listings from every property website in Saudi Arabia${n ? `, and there are ${n} of them,` : ''} and gives this valuable data to his falcon Shaheen, so it answers you accurately when you ask. Shaheen is an AI model and can sometimes make mistakes, so always check the original listing. This fact comes from that same data: prices, new listings and changes, for homes, land and shops.`,
    rulesTitle: 'The rules',
    rules: [
      { title: 'Only real listings', body: 'Every fact comes from listings published on these sites.' },
      { title: "The site's own date", body: '"Today", "this week" and "new" mean the date the ad was posted on its site, not the date we reached it. An ad with no date isn\'t counted.' },
      { title: 'Accurate numbers', body: 'Prices are the asking prices in the ads, not completed sale prices. A property listed on more than one site is counted once, and we check every number twice.' },
      { title: 'Made for you', body: 'A new fact every hour, mostly about the city and district you searched.' },
      { title: 'Information only', body: 'Not financial or investment advice, and not a property valuation. Please check the details with the advertiser before making any decision.' },
    ],
    close: 'Close',
  },
};
