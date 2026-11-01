// The «كيف تشتغل؟» sheet's words (owner-approved 2026-10-22), kept pure so tests can read them.
export type Section = { icon: string; title: string; body: string };
export type Copy = { title: string; sections: Section[]; note: string; ok: string };

export const HOW_IT_WORKS: Record<'ar' | 'en', Copy> = {
  ar: {
    title: 'كيف تشتغل؟',
    sections: [
      { icon: '📊', title: 'من وين الرقم؟', body: 'نحسبه كل ليلة من الإعلانات المعروضة على المواقع العقارية في إزهله.' },
      { icon: '🔁', title: 'الإعلانات المكررة', body: 'نفس العقار ممكن يكون معروض في أكثر من موقع (مثلاً عقار ووصلت وحراج). إذا الإعلان نفس الحي، نفس النوع، نفس السعر، ونفس المساحة، نحسبه مرة وحدة بس، في الأعداد وفي الأسعار.' },
      { icon: '💰', title: 'الأسعار', body: 'الأسعار هي الأسعار المعروضة في الإعلانات (الرقم اللي في المنتصف)، وليست أسعار صفقات منفذة.' },
      { icon: '✅', title: 'نتحقق مرتين', body: 'كل رقم نحسبه مرتين ونطابقه مع الفلتر قبل ما نعرضه.' },
      { icon: '🕐', title: 'تتغير كل ساعة', body: 'كل ساعة تطلع لك معلومة جديدة، وأغلبها عن المدينة اللي تبحث فيها.' },
    ],
    note: '⚠️ معلومة فقط، وليست نصيحة استثمارية.',
    ok: 'تمام',
  },
  en: {
    title: 'How it works',
    sections: [
      { icon: '📊', title: 'Where the number comes from', body: 'We calculate it every night from the listings on the real-estate sites in Ezhalah.' },
      { icon: '🔁', title: 'Duplicate listings', body: 'The same property can be listed on more than one site (e.g. Aqar, Wasalt and Haraj). If a listing has the same district, type, price and area, we count it only once, in counts and in prices.' },
      { icon: '💰', title: 'Prices', body: 'Prices are asking prices in the listings (the middle figure), not completed sale prices.' },
      { icon: '✅', title: 'Checked twice', body: 'Every number is calculated twice and matched against the Filter before it is shown.' },
      { icon: '🕐', title: 'Changes every hour', body: 'A new fact every hour, mostly about the city you search in.' },
    ],
    note: '⚠️ Information only, not investment advice.',
    ok: 'OK',
  },
};
