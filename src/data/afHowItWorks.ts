// «كيف يشتغل دقّق مع الذكاء الاصطناعي؟» — the owner's text (2026-11-01), typed and approved line by line in chat.
// Opened from the short note on every Advanced Filter question card («الأرقام من كلام الإعلانات نفسها ·
// كيف يشتغل؟») in the same popup host as the Terms & Privacy reader — but at the QUESTION CARD's own
// width (owner 2026-11-02: «make it the same size»), white card, Ezhalah eagle, ✕ pinned top-right in
// both languages, NO emoji anywhere in this text (owner: «no emojis or anything») and NO Arabic
// diacritics (owner 2026-11-02: «تأكد أنه يكون من غير حركات»).
//
// Section 6 (owner 2026-11-02) explains Skip: every answer narrows the pool, so later questions that no
// longer narrow it meaningfully (MEANINGFUL_NARROWING_FRACTION in src/lib/advancedFilters.ts) are not
// asked; skipping keeps the pool wide, so more questions and options appear. The card repeats it in one
// line under the «تخطي» button.
//
// Shape: each entry is 'heading\n\nparagraph', like src/data/legal.ts, so the reader renders it the same way.
// The English is a section-for-section translation, not a second policy. Edit both together.
// Guard: scripts/verify-af-how-it-works-note.ts (six sections each, no emoji, no diacritics, both languages wired).

export const AF_HOW_IT_WORKS: { ar: string[]; en: string[] } = {
  ar: [
    '١. المصدر\n\nالخيارات والأرقام مستخرجة آليا من نصوص الإعلانات كما كتبها المعلنون على المنصات الخارجية. إزهله لا تضيف ولا تخمن.',
    '٢. الذكاء الاصطناعي\n\nيقرأ نص كل إعلان جديد يوميا ويحول كلام المعلن إلى خيارات: كتب «مصعد» تسجل ميزة مصعد. يقرأ ويصنف فقط؛ لا يضيف ولا يحذف ولا يقيم ولا يفضل إعلانا على آخر.',
    '٣. الرقم\n\nعدد الإعلانات في بحثك التي ذكرت الميزة صراحة، ويتغير مع تحديث الإعلانات. الإعلان الذي لم يذكر الميزة قد تكون عنده ولم يكتبها.',
    '٤. الحدود\n\nالقراءة الآلية قد تخطئ أو تفوت عبارة. إزهله لا تضمن اكتمال المعلومات أو دقتها أو حداثتها.',
    '٥. مسؤوليتك\n\nإزهله محرك بحث عقاري بالذكاء الاصطناعي، هدفه توصيلك للمعلن فقط. لا نملك أي عقار، ولا نتحقق من الإعلانات، ولا نأخذ أي مبلغ أو عمولة من أي صفقة. تأكد من الإعلان في موقعه الأصلي وتواصل مع المعلن مباشرة قبل أي قرار أو دفع. المعلومات تقدم «كما هي» للبحث فقط، وتسري الشروط والأحكام وسياسة الخصوصية.',
    '٦. التخطي\n\nكل إجابة تصغر النتائج، فتختفي الأسئلة التي ما عاد لها فرق. إذا ضغطت «تخطي» تبقى النتائج أوسع، فتظهر لك أسئلة وخيارات أكثر.',
  ],
  en: [
    '1. Source\n\nOptions and counts are extracted automatically from listing text as written by advertisers on external platforms. Ezhalah adds nothing and guesses nothing.',
    '2. The AI\n\nIt reads every new listing daily and turns the advertiser’s words into options: wrote “elevator”, the elevator feature is recorded. It only reads and classifies; it does not add, remove, assess, or favour one listing over another.',
    '3. The number\n\nHow many listings in your search explicitly mention the feature; it changes as listings update. A listing that did not mention a feature may still have it.',
    '4. Limits\n\nAutomated reading can misread or miss a phrase. Ezhalah does not warrant that the information is complete, accurate or current.',
    '5. Your responsibility\n\nEzhalah is an AI real-estate search engine whose only goal is to send you to the lister. We own no property, do not verify listings, and take no payment or commission from any deal. Check the listing on its original site and contact the lister directly before any decision or payment. Information is provided “as is” for search only; the Terms and Privacy Policy apply.',
    '6. Skipping\n\nEvery answer narrows the results, so questions that no longer make a difference disappear. If you press Skip, the results stay wider and you get more questions and options.',
  ],
};

export const getAfHowItWorks = (locale: 'ar' | 'en'): string[] => (locale === 'en' ? AF_HOW_IT_WORKS.en : AF_HOW_IT_WORKS.ar);
