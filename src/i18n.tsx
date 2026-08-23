import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { I18nManager, Platform } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

// Arabic-first localization (PRD §13 decision). The app defaults to Arabic + RTL; an EN/AR toggle
// in Settings lets the user switch. We use an English-key dictionary: t('Search') looks up the
// Arabic string, falling back to the English key itself when no translation exists — so partial
// coverage degrades gracefully and we never invent opaque key names.
//
// A module-level `_locale` lets pure, non-React modules (search.ts, agent.ts) localize their
// generated strings without threading a locale argument through every call. The provider keeps it
// in sync with React state so screens re-render on a language switch.

export type Locale = 'ar' | 'en';

export const LOCALE_KEY = 'locale';

// Is there a signed-in Supabase session in localStorage? Default supabase-js persists it under a
// "sb-<ref>-auth-token" key. We only honor a SAVED language for signed-in users, so a guest is always
// Arabic-first at first paint — even if a stale language is still in storage from a past session.
function hasAuthSession(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  try {
    const ls = window.localStorage;
    if (!ls) return false;
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.includes('-auth-token')) {
        const v = ls.getItem(k);
        if (v && v.length > 2) return true;
      }
    }
  } catch {}
  return false;
}

// Read the saved language SYNCHRONOUSLY at module load (web) so the very first paint is already in
// the right language + direction. A SIGNED-IN user's saved language loads with no flash; a GUEST is
// ALWAYS Arabic-first (we ignore any leftover saved value), and a refresh/return keeps them Arabic.
// (user request.) The store re-confirms this once auth resolves and clears any stale value.
function readSavedLocale(): Locale {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      // Arabic-only product: the UI is always Arabic. Clear any legacy saved 'en' so it can't resurface.
      if (window.localStorage?.getItem(LOCALE_KEY) === 'en') window.localStorage.removeItem(LOCALE_KEY);
    } catch {}
  }
  return 'ar';
}

// Whether the active language is REMEMBERED across a refresh. Only signed-in users persist their
// language; a GUEST is always Arabic-first on a fresh load — typing English flips the UI live for the
// session, but a refresh/return resets to Arabic. The store toggles this on auth state. (user request.)
let _persistEnabled = false;

// Turn language persistence on/off and reconcile storage immediately (web): ON writes the current
// language so it survives a refresh; OFF clears it so the next load falls back to the Arabic default.
export function setLocalePersistence(on: boolean): void {
  _persistEnabled = on;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      if (on) window.localStorage?.setItem(LOCALE_KEY, _locale);
      else window.localStorage?.removeItem(LOCALE_KEY);
    } catch {}
  }
}

// Persist the active language immediately (web) — but ONLY when persistence is enabled (signed-in).
// For a guest this is a no-op, so their language choice never survives a refresh. (Native persistence
// is handled in the store via AsyncStorage, also auth-gated.)
export function persistLocale(l: Locale): void {
  if (!_persistEnabled) return;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try { window.localStorage?.setItem(LOCALE_KEY, l); } catch {}
  }
}

let _locale: Locale = readSavedLocale();
export const getLocale = (): Locale => _locale;
export const isRTLNow = (): boolean => _locale === 'ar';

// --- Arabic dictionary (English source string → Arabic) -------------------------------------
const AR: Record<string, string> = {
  // Generic chrome
  'EZHALAH': 'إزهله',
  'Ezhalah': 'إزهله',
  'New search': 'بحث جديد',
  'Ezhalah AI Agent': 'إزهله بالذكاء الصناعي',
  'Recent searches': 'عمليات البحث الأخيرة',
  'Clear': 'مسح',
  'Your searches will appear here.': 'ستظهر عمليات بحثك هنا.',
  'Settings': 'الإعدادات',
  'Sign in': 'تسجيل الدخول',
  'Save your searches': 'احفظ عمليات بحثك',
  'Filter': 'تصفية',
  // Top-nav ModeSwitch pill's AI tab — deliberately shorter than the full 'Ezhalah AI Agent' badge
  // title so the two-tab control stays compact. (top-nav redesign, 2026-07-24.)
  'Smart Assistant': 'الوكيل الذكي',

  // Home
  'Find your place': 'اعثر على مكانك',
  'One search across every major Saudi property platform.': 'بحث واحد عبر جميع منصات العقارات السعودية الكبرى.',
  // Note #1 — hero copy update. Arabic and English sides are the canonical wording the user supplied.
  'Looking for a property and want to see all available listings in one place? Ezhalah.': 'تدور على عقار وتبي تشوف كل المعروض في مكان واحد؟ إزهله',
  'Ezhalah An AI-powered platform that searches real estate listings across Saudi Arabia.': 'إزهله منصة متخصصة للبحث في منصات العقار الإلكترونية بالمملكة باستخدام الذكاء الاصطناعي',
  'Ezhalah, and may your luck be good.': 'إزهله وفالك طيب.',
  "Type anything. I'll search Aqar, Wasalt, Aldarim and more in seconds.": 'اكتب أي شيء. سأبحث في منصات عقار ووصلت والدريم والمزيد في ثواني.',
  "Tell me what you want and I'll find it": 'أخبرني بما تريد وسأجده لك',
  'Pick your details, leave it on us': 'اختر تفاصيلك واترك الباقي علينا',
  'Which city or neighborhood?': 'أي مدينة أو حي؟',
  'Start here': 'ابدأ من هنا',
  'Tap any of these to see real listings now': 'اضغط على أي منها لرؤية إعلانات حقيقية الآن',
  'Ezhalah — leave it on us.': 'Ezhalah — اتركها علينا.',
  'Max annual or monthly rent': 'الحد الأقصى للإيجار السنوي أو الشهري',
  'Max buy price or price per meter': 'الحد الأقصى لسعر الشراء أو سعر المتر',
  'Max monthly or annual rent': 'الحد الأقصى للإيجار الشهري أو السنوي',
  'Total price or price per m²': 'السعر الإجمالي أو سعر المتر',
  // Simplified Filter budget labels — no calculations, just a single yearly rent or purchase total. (user request.)
  'Yearly Rent Budget': 'الميزانية السنوية للإيجار',
  'Monthly Rent Budget': 'الميزانية الشهرية للإيجار',
  'Purchase Budget': 'ميزانية الشراء',
  'Monthly': 'شهري',
  'Yearly': 'سنوي',
  'Both': 'كلاهما',
  // Tiny info note shown under the Monthly/Yearly toggle so the user knows what each period means.
  // Period hints (reworded 2026-08-14, owner). The old copy asserted a CONTRACT LENGTH ("عقد من 1 إلى 11
  // شهراً" / "عقد لمدة 12 شهراً") that no source publishes and Ezhalah never captures — an invented claim
  // about the lease. What we actually know is the BASIS OF THE PRICE WE DISPLAY, so that is all we say.
  'Annual: 12-month lease, price/year.': 'سنوي: السعر المعروض سنوي.',
  // Owner 2026-08-18: the Monthly note says ONLY that prices are displayed per month — never any
  // claim about contract length (the old «من شهر إلى 11 شهر» wording is banned; a guard pins it out).
  'Monthly: the displayed price is the monthly price.': 'الأسعار معروضة بالشهر',
  'Yearly: the displayed price is the yearly price.': 'سنوي: السعر المعروض سنوي.',
  // Owner feedback (2026-08-22): trimmed — the old wording ("Both: we show monthly and yearly
  // together") re-explained what selecting both buttons already makes obvious. Kept only the one
  // fact worth surfacing: mixed results carry mixed price units.
  'Each listing shows its own price basis (monthly or yearly).':
    'كل إعلان يوضّح أساس سعره (شهري أو سنوي).',
  // Monthly Advanced Filter (2026-08-18)
  'What rating would you prefer?': 'كم التقييم اللي تفضله؟',
  '9.5+': '9.5+',
  '9.0+': '9.0+',
  '9.0+ with 10+ reviews': '9.0+ مع 10 تقييمات أو أكثر',
  'What kind of unit?': 'وش نوع الوحدة اللي تبغاها؟',
  'Studio unit': 'استديو',
  'Serviced apartment': 'شقة مخدومة',
  'Regular apartment': 'شقة عادية',
  'Family villa in North Riyadh': 'فيلا عائلية في شمال الرياض',
  'Apartment for rent in Khobar': 'شقة للإيجار في الخبر',
  'Commercial land in Jeddah': 'أرض تجارية في جدة',
  'What can I get for SAR 500,000?': 'ماذا يمكنني الحصول عليه مقابل 500,000 ريال؟',
  'I want a villa with a pool': 'أريد فيلا مع مسبح',
  'High-yield investment property': 'عقار استثماري بعائد مرتفع',
  'Ask in your words': 'اسأل بكلماتك',
  'City or neighborhood': 'المدينة أو الحي',
  'Category': 'الفئة',
  'Property type': 'نوع العقار',
  'Property group': 'مجموعة العقار',
  // Subcategory groups (2-macro filter)
  'Apartments & Co-living': 'الشقق والسكن المشترك',
  'Villas & Houses': 'الفلل والبيوت',
  'Vacation & Rural': 'الاستراحات والريف',
  'Residential Plots': 'الأراضي السكنية',
  'Retail & Workspace': 'التجزئة والمكاتب',
  'Industrial & Logistics': 'الصناعة واللوجستيات',
  // Owner's canonical group name (audit item 7a, 2026-07-27) — was «المباني والمرافق التجارية».
  'Commercial Buildings & Facilities': 'المباني والمرافق',
  'Commercial & Industrial Plots': 'الأراضي التجارية والصناعية',
  'Price': 'السعر',
  // Buy+Rent combined multi-select (owner feature 2026-08-20): the two independent price ranges
  // shown together when شراء+إيجار are both selected — never one shared/naive range.
  'Buy budget': 'ميزانية الشراء',
  'When you choose Buy and Rent together, each one has its own budget.':
    'سيتم عرض عقارات البيع والإيجار معًا، ولكل منهما ميزانية مستقلة.',
  'Rent budget (yearly basis)': 'ميزانية الإيجار (سنوياً)',
  ' /yr': ' / سنوياً',
  'Max price': 'السعر الأقصى',
  'Search': 'بحث',
  'Clear all': 'مسح الكل',

  // Deals + verbs
  'Rent': 'إيجار',
  'Buy': 'شراء',
  'to rent': 'للإيجار',
  'to buy': 'للبيع',
  // Rent verb with the payment period the user picked (Monthly / Yearly) so the summary sentence
  // reflects the toggle exactly — "أبحث عن شقة للإيجار الشهري في جدة". (owner UI request 2026-07-18.)
  'to rent monthly': 'للإيجار الشهري',
  'to rent yearly': 'للإيجار السنوي',
  'to rent monthly or yearly': 'للإيجار الشهري أو السنوي',
  'to rent or buy': 'للإيجار أو الشراء',
  'Rent or Buy': 'إيجار أو شراء',
  // District, and the "district، city" place phrase used when the user picked a district in the filter.
  'District': 'الحي',
  '{district}, {city}': '{district}، {city}',
  '{a}/year': '{a}/سنوياً',

  // Categories
  'Residential': 'سكني',
  'Commercial': 'تجاري',
  'property': 'عقار',
  'Property': 'عقار',

  // Property types
  'Apartment': 'شقة',
  'Villa': 'فيلا',
  'Floor': 'دور',
  'House': 'بيت',
  'Room': 'غرفة',
  'Building': 'عمارة',
  'Residential Land': 'أرض سكنية',
  'Rest House': 'استراحة',
  'Chalet': 'شاليه',
  'Office': 'مكتب',
  'Warehouse': 'مستودع',
  'Shop': 'محل',
  'Showroom': 'معرض',
  'Factory': 'مصنع',
  'Workshop': 'ورشة',
  'Commercial Land': 'أرض تجارية',
  'Industrial Land': 'أرض صناعية',
  'Farm': 'مزرعة',
  'Agriculture Plot': 'أرض زراعية',
  'Camp': 'مخيم',
  'Hotel': 'فندق',
  'Commercial Building': 'مبنى تجاري',
  'Residential Building': 'عمارة سكنية',
  'Specialized Facilities': 'منشآت متخصصة',
  'Staff Housing': 'سكن عمال',
  'Bank': 'بنك',
  'Telecom Tower': 'برج اتصالات',
  'Studio': 'استوديو',
  'Duplex': 'دوبلكس',
  'Palace': 'قصر',
  'Gas Station': 'محطة وقود',
  'Health Center': 'مركز صحي',
  'Kiosk': 'كشك',
  'Cinema': 'سينما',

  // Detail labels
  'Bedrooms': 'غرف النوم',
  'Size in meters': 'المساحة بالمتر',
  'Or type an exact size': 'أو اكتب مساحة محددة',
  'Or type a max': 'أو اكتب حداً أقصى',
  'Bedrooms?': 'كم غرفة نوم؟',
  'Size in meters?': 'المساحة بالمتر؟',

  // Cities
  'Riyadh': 'الرياض',
  'Jeddah': 'جدة',
  'Khobar': 'الخبر',
  'Dammam': 'الدمام',
  'Mecca': 'مكة',
  'Saudi Arabia': 'المملكة العربية السعودية',

  // Districts
  'Al Malqa District': 'حي الملقا',
  'Hittin District': 'حي حطين',
  'Al Narjis District': 'حي النرجس',
  'Al Olaya District': 'حي العليا',
  'Al Hamra District': 'حي الحمراء',
  'Al Rawdah District': 'حي الروضة',
  'Al Shati District': 'حي الشاطئ',
  'Al Aqrabiyah District': 'حي العقربية',
  'Corniche District': 'حي الكورنيش',
  'Al Faisaliyah District': 'حي الفيصلية',
  'Al Aziziyah District': 'حي العزيزية',

  // Districts as stored on listings (bare, no "District" suffix)
  'North Riyadh': 'شمال الرياض',
  'Al Malqa': 'الملقا',
  'Hittin': 'حطين',
  'Al Narjis': 'النرجس',
  'Al Yasmin': 'الياسمين',
  'Al Hamra': 'الحمراء',
  'Al Rawdah': 'الروضة',
  'Al Shati': 'الشاطئ',
  'Al Salamah': 'السلامة',
  'Al Naeem': 'النعيم',
  'Al Suwaidi': 'السويدي',
  'Al Olaya': 'العليا',
  'Al Aziziyah': 'العزيزية',
  'Al Shifa': 'الشفا',
  'Al Dar Al Baida': 'الدار البيضاء',
  'Al Aqrabiyah': 'العقربية',

  // Interview
  'Guided search': 'بحث موجّه',
  'Rent or buy?': 'إيجار أم شراء؟',
  'Which city?': 'أي مدينة؟',
  'Which district? (optional)': 'أي حي؟ (اختياري)',
  'Trending cities now': 'الأكثر رواجًا الآن',
  'Trending districts in': 'الأحياء الأكثر رواجًا في',
  'Optional': 'اختياري',
  'Select a city first': 'اختر المدينة أولاً',
  'Property category?': 'فئة العقار؟',
  'Property type?': 'نوع العقار؟',
  // Interview's group question (audit item 1) — same wording family as the Filter home's «مجموعة العقار».
  'Property group?': 'مجموعة العقار؟',
  // Period-flip price clear note (audit item 3): the unit of a typed price inverted, so keeping the
  // number would silently mean something else — cleared + explained instead.
  'Price limits were cleared because the price unit changed (monthly ↔ yearly) — please re-enter them.':
    'تم مسح حدود السعر لأن وحدة السعر تغيّرت (شهري ↔ سنوي) — الرجاء إدخالها من جديد.',
  // Same clear+explain precedent for the شراء/إيجار toggle (owner feature 2026-08-20).
  'Price limits were cleared because Buy/Rent changed which budget they meant — please re-enter them.':
    'تم مسح حدود السعر لأن التبديل بين الشراء والإيجار غيّر المقصود بالميزانية — الرجاء إدخالها من جديد.',
  "What's your max budget?": 'ما هو حدّك الأقصى للميزانية؟',
  "What's your rent budget?": 'ما هي ميزانية الإيجار لديك؟',
  'Skip — show me more options': 'تخطَّ — أرني المزيد من الخيارات',
  'Searching…': 'جارٍ البحث…',

  // Guided interview (modal)
  'Any': 'أي',
  'Which neighborhood?': 'أي حي؟',
  // District multi-select (owner copy, 2026-08-10)
  'You can pick more than one neighborhood': 'تقدر تختار أكثر من حي',
  '{n} neighborhoods': '{n} أحياء',
  'Rent or Buy?': 'إيجار أم شراء؟',
  'Price per m², total shown for a typical size. Or type any amount.':
    'سعر المتر المربع، مع الإجمالي لمساحة نموذجية. أو اكتب أي مبلغ.',
  'Monthly amount, annual shown too. Or type any amount.':
    'المبلغ الشهري، مع عرض السنوي أيضاً. أو اكتب أي مبلغ.',
  'How many bedrooms?': 'كم عدد غرف النوم؟',
  'Size?': 'المساحة؟',
  'Must-have amenities?': 'المرافق الأساسية المطلوبة؟',
  'Extra features the home includes (e.g. pool, gym, parking). Not sure? Pick “Doesn\'t matter.”':
    'مزايا إضافية يتضمنها المنزل (مثل مسبح، صالة رياضية، موقف). غير متأكد؟ اختر «لا يهم».',
  'Intended use?': 'الاستخدام المقصود؟',
  'What you\'ll use the space for. Not sure? Pick “Other.”':
    'الغرض الذي ستستخدم المساحة من أجله. غير متأكد؟ اختر «أخرى».',
  "Let's find your place, I'll ask a few quick questions.":
    'لنجد مكانك، سأطرح بعض الأسئلة السريعة.',
  "No problem, I'll keep that open.": 'لا مشكلة، سأترك ذلك مفتوحاً.',
  'Perfect.': 'ممتاز.',
  'Okay!': 'حسناً!',
  'Love it.': 'رائع.',
  'Got your budget noted.': 'سجّلت ميزانيتك.',
  'Got it.': 'تمام.',
  'Nice, {v} it is.': 'جميل، {v} إذاً.',
  '{v}, got it.': '{v}، تمام.',
  "I've got {got}.": 'سجّلت {got}.',
  'Just a few quick details now.': 'بقي بعض التفاصيل السريعة الآن.',
  'Just a few quick more now.': 'بقي القليل الآن.',
  'Something else': 'شيء آخر',
  'Enter your own amount': 'أدخل مبلغك الخاص',
  'Type your own answer': 'اكتب إجابتك',
  'Type any amount (e.g. 7500)': 'اكتب أي مبلغ (مثلاً 7500)',
  'Next': 'التالي',
  'Skip this question': 'تخطَّ هذا السؤال',
  '"{city}" isn\'t a city I recognize, I\'ll still search using your other answers.':
    '«{city}» ليست مدينة أعرفها، سأظل أبحث باستخدام إجاباتك الأخرى.',

  // Advanced-filter question engine («خلّنا نحدد الطلب أكثر») — عمر العقار is the first field built on
  // this reusable card; new fields add their own strings here, never touch this block's wording.
  'How old is the property?': 'كم عمر العقار تقريباً؟',
  'New construction': 'جديد',
  'Less than a year': 'أقل من سنة',
  '1–2 years': '١-٢ سنوات',
  '3–5 years': '٣-٥ سنوات',
  '6–9 years': '٦-٩ سنوات',
  '10+ years': '١٠ سنوات فأكثر',
  'Skip': 'تخطي',
  'Skip remaining questions and search now': 'تخطي الباقي وابحث الآن',
  'Age unknown for {count} matching listings': 'العمر غير معروف لـ {count} من العقارات المطابقة',
  // Annual-Rent apartment guided flow (2026-07-20): RNPL (installments) · amenities · min bathrooms.
  // Kitchen/Parking/Elevator + «استأجر الآن وادفع لاحقًا» reuse existing keys below; only the new
  // question titles, the Furnished chip, the bathroom ladder, and the live-count CTA are added here.
  // Ask-first installment question (owner 2026-08-15) — the opening question for Annual Rent →
  // Apartment when it clears the usefulness gates. «نعم» means ONLY: the source confirms this
  // listing supports the رايز/إيجاري instalment service. Unknown is never "no", and we never
  // invent a payment frequency (دفعتين/٤ دفعات/…) — no source publishes instalment counts.
  'Would you rather pay the rent in instalments?': 'تفضل تدفع الإيجار على دفعات؟',
  // Cohort expansion (owner 2026-08-15): street-width + direction questions, data-justified for
  // Residential Building (96-97% / 83-84% source coverage) and Apartment/Buy (direction 50%).
  'How wide should the street be?': 'كم عرض الشارع تفضل؟',
  '15 m or wider': '١٥ م فأكثر',
  '20 m or wider': '٢٠ م فأكثر',
  '25 m or wider': '٢٥ م فأكثر',
  '30 m or wider': '٣٠ م فأكثر',
  'Which direction do you prefer?': 'وش الاتجاه اللي تفضله؟',
  'North': 'شمال',
  'South': 'جنوب',
  'East': 'شرق',
  'West': 'غرب',
  'North-east': 'شمال شرق',
  'North-west': 'شمال غرب',
  'South-east': 'جنوب شرق',
  'South-west': 'جنوب غرب',
  'Do you prefer listings with installment options?': 'تفضّل عقارات تتيح التقسيط / الدفع لاحقًا؟',
  'Offers installments': 'يقبل التقسيط',
  'What amenities matter to you?': 'وش المميزات المهمة لك؟',
  'Do you prefer it furnished?': 'تفضلها مفروشة؟',
  'Unfurnished': 'غير مفروشة',
  'Driver room': 'غرفة سائق',
  'Car entrance': 'مدخل سيارة',
  'Sewage connection': 'صرف صحي',
  'Water supply': 'توفر الماء',
  // 'Furnished' key lives in the shared amenities block below (identical value 'مفروش') — not redeclared here.
  // The Advanced Filter's SCOPE steps (owner 2026-08-23) — asked before any certified question when
  // the user has chosen only a category (or only a group). The option LABELS reuse the group/type
  // keys the Filter home already ships, so the two surfaces can never drift apart.
  'Which kind of property are you looking for?': 'أي نوع من العقارات تبحث عنه؟',
  'Which property type?': 'أي نوع عقار تحديدًا؟',
  'How many bathrooms?': 'كم دورة مياه تفضل؟',
  'Any number': 'أي عدد',
  '1+': '+١',
  '2+': '+٢',
  '3+': '+٣',
  '4+': '+٤',
  'Show {count} apartments': 'عرض {count} شقة',
  'No preference': 'لا يهمني',
  // Advanced Filter Design Contract (2026-07-20): generic footer + subtitle shared by every question.
  'Show {count} results': 'عرض {count} نتيجة',
  'Show results': 'عرض النتائج',
  'Results update as you choose': 'تُحدَّث النتائج مع كل اختيار',
  // Card redesign (owner 2026-07-21): numeric question progress + remaining-count skip link, and the
  // RNPL question's pay-monthly-not-yearly subtitle (neutral, descriptive — never advice).
  'Question {cur} of {total}': 'السؤال {cur} من {total}',
  'Skip remaining ({count}) and search now': 'تخطي الباقي ({count}) وابحث الآن',
  'Rent now and pay monthly instead of one annual payment': 'استأجر الآن وادفع شهريًا بدلًا من دفعة سنوية واحدة',
  // Conversational interview refresh (owner 2026-08-16): opening state, live count chip, multi
  // continue CTA, availability line, mining transition, and the results summary + removable pills.
  '{count} results': '{count} نتيجة',
  'We found {count} properties': 'لقينا {count} عقار',
  'Let’s pin down what you’re looking for': 'خلّنا نحدد طلبك أكثر',
  'We’ll use what we know about these listings to get you closer to the right one': 'بنستخدم المعلومات المتوفرة عندنا عن هالعقارات عشان نقرّب لك الأنسب',
  'Let’s begin': 'يلا نبدأ',
  // 'Continue' reuses the existing auth-flow key ('متابعة') — not redeclared here.
  'Continue · {count} results': 'متابعة · {count} نتيجة',
  'Options reflect the information available for the current listings': 'الخيارات تعتمد على المعلومات المتوفرة للإعلانات الحالية',
  'Finding the closest match for you': 'ندور لك على الأقرب لطلبك',
  'Going through {count} properties to pull out the best fit': 'نراجع {count} عقار ونطلع لك الأنسب',
  'We found {count} properties closest to your request': 'لقينا {count} عقار أقرب لطلبك',
  'Based on: {labels}': 'بناءً على: {labels}',
  'Without: {label}': 'بدون: {label}',

  // Interview option labels
  'Pool': 'مسبح',
  'Parking': 'مواقف',
  'School': 'مدرسة',
  'Facilities': 'المرافق',
  'Service Facilities': 'مرافق خدمية',
  'Elevator': 'مصعد',
  'Air conditioning': 'تكييف',
  'Private entrance': 'مدخل خاص',
  'Gym': 'صالة رياضية',
  'Maid room': 'غرفة خادمة',
  "Doesn't matter": 'لا يهم',
  'Storage': 'تخزين',
  'Retail': 'بيع بالتجزئة',
  '1 bed': 'غرفة نوم واحدة',
  '2 beds': 'غرفتا نوم',
  '3 beds': '3 غرف نوم',
  '4 beds': '4 غرف نوم',
  '5+ beds': '5+ غرف نوم',

  // Interview cities + neighborhoods
  'Makkah': 'مكة',
  'Madina': 'المدينة',
  'Al Yasmeen': 'الياسمين',
  'Al Qirawan': 'القيروان',
  'Al Arid': 'العارض',
  'Al Nadhim': 'النظيم',
  'Al Rimal': 'الرمال',
  'Al Khaleej': 'الخليج',
  'Al Zahra': 'الزهراء',
  'Al Corniche': 'الكورنيش',
  'Al Balad': 'البلد',
  'Al Sharafiyah': 'الشرفية',
  'Al Andalus': 'الأندلس',
  'Al Nuzha': 'النزهة',
  'Al Faisaliyah': 'الفيصلية',
  'Al Iskan': 'الإسكان',
  'Al Muraikabat': 'المريكبات',
  'Al Zaher': 'الظاهر',
  'Ajyad': 'أجياد',
  'Al Adl': 'العدل',
  'Al Rusaifah': 'الرصيفة',
  'Al Shisha': 'الششة',
  'Al Kakiyah': 'الكعكية',
  'Al Haram': 'الحرم',
  'Quba': 'قباء',
  'Al Aqiq': 'العقيق',
  'Al Rawabi': 'الروابي',
  'Al Aqoul': 'العقول',

  // Guided interview → chat (user bubble + result subheading)
  "I'm looking for {what}{verb} {place}{size}{budget}{extras}.":
    'أبحث عن {what}{verb} {place}{size}{budget}{extras}.',
  'budget {b}': 'الميزانية {b}',
  'Here are {what} {place}{bits} that best match what you want.{note}':
    'إليك {what} {place}{bits} تطابق ما تبحث عنه تماماً.{note}',
  ' I broadened {fields} to show you more options.': ' وسّعت نطاق {fields} لعرض المزيد من الخيارات.',
  'the neighborhood': 'الحي',
  'the budget': 'الميزانية',
  'the size': 'المساحة',

  // Agent
  'Ask in your own words': 'اسأل بكلماتك الخاصة',
  'e.g. "3 bedroom villa to rent in Riyadh under 90,000" — I\'ll search every platform and show you the listings. You decide.':
    'مثال: «فيلا 3 غرف للإيجار في الرياض بأقل من 90,000» — سأبحث في كل المنصات وأعرض لك الإعلانات. والقرار لك.',
  'Searching listings…': 'جارٍ البحث في الإعلانات…',
  "Describe what you're looking for…": 'صف ما الذي تبحث عنه…',
  "Ezhalah displays listings from third-party platforms. We don't recommend, verify, or own any listing — the choice is yours.":
    'تعرض إزهله إعلانات من منصات خارجية. نحن لا نوصي بأي إعلان ولا نتحقق منه ولا نملكه — والقرار لك.',
  'Ezhalah! ': 'إزهله! ',
  'No exact matches — try broadening your search.': 'لا توجد نتائج مطابقة تماماً — حاول توسيع نطاق بحثك.',
  'No listings here right now': 'لا توجد إعلانات هنا حالياً',
  'ads': 'إعلان',
  // City/District dropdown zero-states (2026-08-14): the box used to render NOTHING while its pool
  // was loading, after a failed fetch, or on a no-match — indistinguishable silences (findings P1).
  'Loading…': 'جاري التحميل…',
  'Could not load the list — tap to retry': 'تعذر تحميل القائمة، اضغط للمحاولة مرة أخرى',
  'No matching city — pick from the list': 'لا توجد مدينة مطابقة — اختر من القائمة',
  'No districts available in this city right now': 'لا توجد أحياء متاحة حالياً في هذه المدينة',
  'No listings within that budget — there are matches above it. Want me to remove the budget?':
    'ما فيه إعلانات داخل ميزانيتك — لكن فيه خيارات فوقها. تبيني أشيل الميزانية؟',
  'No matches in that specific area — but I can find some elsewhere in the same city. Want me to widen the area?':
    'ما لقيت نتائج في الحي المحدد — لكن فيه خيارات في أحياء ثانية بنفس المدينة. تبيني أوسّع المنطقة؟',
  'No matches with that exact size/bedroom count — close options exist if I drop it. Want me to?':
    'ما لقيت نتائج بنفس عدد الغرف أو المساحة — لكن فيه خيارات قريبة لو أشيل الشرط. تبيني أسوي؟',
  'No matches for that property type here — other types are available. Want me to broaden the type?':
    'ما فيه إعلانات بنفس نوع العقار في المنطقة — لكن فيه أنواع ثانية متاحة. تبيني أوسّع النوع؟',
  'No matches in that city — but the same search has results elsewhere in Saudi Arabia. Want me to broaden it Kingdom-wide?':
    'ما فيه نتائج في هذي المدينة — لكن نفس البحث له نتائج في مدن ثانية بالمملكة. تبيني أوسّع البحث للسعودية كلها؟',
  'Nothing matches that exact combination right now. Want me to broaden the search and try again?':
    'ما فيه نتائج تطابق هذي المواصفات بالضبط حالياً. تبيني أوسّع البحث وأعيد المحاولة؟',
  'No listings in this location right now.': 'ما فيه إعلانات في هذا الموقع حالياً.',
  'Loading listing…': 'يجري تحميل الإعلان…',
  "Couldn't load the preview here.": 'تعذّر تحميل المعاينة هنا.',
  'Reload': 'إعادة تحميل',
  'Loading listings — please try again in a few seconds.':
    'يجري تحميل الإعلانات — حاول مرة ثانية بعد لحظات.',

  // Agent chat chrome
  'Ezhalah is searching…': 'إزهله يبحث…',
  'Ezhalah is thinking…': 'إزهله يفكر…',
  // Search-loading animation (platform-checking strip + filter status lines)
  'Ezhalah is searching the platforms…': 'إزهله يبحث في المنصات…',
  'Searching all platforms…': 'يتم البحث في جميع المنصات…',
  'Gathering the best properties…': 'نجمع أفضل العقارات…',
  'Checking the matching properties…': 'نفحص العقارات المناسبة…',
  'Matching the filters…': 'نطابق الفلاتر…',
  'Reviewing sites and prices…': 'نراجع المواقع والأسعار…',
  'Preparing the results…': 'نجهز النتائج…',
  'Matching the location…': 'نطابق الموقع…',
  'Applying the filters…': 'نطبق الفلاتر…',
  'Sorting results and mixing platforms…': 'نرتب النتائج وننوعها بين المنصات…',
  // Per-card feedback row (thumbs up/down + share)
  'Thanks for your feedback': 'شكراً على ملاحظتك',
  // Read Aloud (owner P0, 2026-08-18) — native/OS TTS only, $0, never a paid API.
  'Read aloud': 'استماع للرد',
  'Stop reading': 'إيقاف الاستماع',
  // Graceful failure (owner root-cause fix, 2026-08-22): shown ONLY when the device/browser has no
  // Arabic voice at all — never silently read Arabic text with a non-Arabic (usually English) voice.
  'Listening isn\'t available on this device': 'الاستماع غير متاح على هذا الجهاز',
  // Floating playback controller (owner 2026-08-22, ChatGPT-style pill — Arabic-branded, own layout).
  // Every accessibility label on the controller must be Arabic, no English leak ('Close' reuses the
  // existing app-wide key just below — same word, same meaning, one definition).
  'Pause reading': 'إيقاف مؤقت',
  'Resume reading': 'متابعة',
  'Back 15 seconds': 'رجوع ١٥ ثانية',
  'Forward 15 seconds': 'تقديم ١٥ ثانية',
  'Playback speed': 'سرعة القراءة',
  'Here is what I found:': 'هذا ما وجدته:',
  'Here is what matches what you want': 'هذا اللي يناسب طلبك',
  'I found a few properties based on your search.': 'وجدت بعض العقارات بناءً على طلبك.',
  'Looking for:': 'المطلوب:',
  'Click here to start': 'اضغط هنا للبدء',
  "Not sure what you're looking for?": 'مو متأكد وش تبحث عنه؟',
  'Tap one of the examples below and let Ezhalah start the search for you.': 'اضغط على أحد الأمثلة بالأسفل وخل إزهله تبدأ البحث لك.',
  "I've stopped the search. I showed you the available results so far. Is there anything else I can help you with today?": 'أوقفت البحث، وعرضت لك النتائج المتاحة حتى الآن. هل أقدر أساعدك بشي ثاني اليوم؟',
  "I've stopped the search. Is there anything else I can help you with today?": 'وقفت البحث. أقدر أساعدك بشي ثاني اليوم؟',
  'Precise': 'بحث دقيق',
  'Search Summary': 'ملخص البحث',
  'Property Type': 'نوع العقار',
  'Transaction Type': 'نوع العملية',
  'Platform': 'المنصة',
  'For Sale': 'للبيع',
  'City': 'المدينة',
  'Region': 'الإقليم',
  'Neighborhood': 'الحي',
  'Districts': 'الأحياء',
  'Nearby Districts': 'أحياء قريبة',
  'Nearby Cities': 'مدن قريبة',
  'Landmark': 'معلم',
  'You typed': 'كتبت',
  'Cities': 'المدن',
  'We found multiple locations matching "{name}". Showing the closest matches from our database.':
    'وجدنا عدة مواقع مطابقة لـ "{name}". نعرض لك أقرب النتائج من قاعدة بياناتنا.',
  'We couldn’t find listings in "{place}". Did you mean {alt}?':
    'ما لقينا إعلانات في "{place}". هل تقصد {alt}؟',
  // Region names as stored in the DB location_index — used by the Search Summary's Region line so an
  // Arabic user sees the region in Arabic (not the English DB key). (Riyadh/Makkah already translated.)
  'Eastern Province': 'المنطقة الشرقية',
  'Madinah': 'منطقة المدينة المنورة',
  'Qassim': 'منطقة القصيم',
  'Jazan': 'منطقة جازان',
  'Asir': 'منطقة عسير',
  'Hail': 'منطقة حائل',
  'Tabuk': 'منطقة تبوك',
  'Al Bahah': 'منطقة الباحة',
  'Northern Borders': 'منطقة الحدود الشمالية',
  'Najran': 'منطقة نجران',
  'Al Jawf': 'منطقة الجوف',
  'Budget': 'الميزانية',
  'Your budget': 'ميزانيتك',
  'Monthly Rent': 'الإيجار الشهري',
  'Annual Equivalent': 'المعادل السنوي',
  'Price Per m²': 'سعر المتر',
  // Unit suffix for the source-published «سعر المتر» rate. It is printed NEXT TO the number so the
  // card reads «سعر المتر 750 ريال/م²» — a per-square-metre RATE, never mistakable for a total.
  // (owner 2026-08-09: "display it clearly as ريال/م²".)
  'SAR/m²': 'ريال/م²',
  'Calculated Total': 'الإجمالي المحسوب',
  'Size': 'المساحة',
  '{n} beds': '{n} غرف',
  '{n} m²': '{n} م²',
  'Stop': 'إيقاف',
  // Voice-input composer (owner brief 2026-08-23) — Arabic accessibility labels + graceful errors.
  'Voice input': 'الإدخال الصوتي',
  'Cancel recording': 'إلغاء التسجيل',
  'Stop recording': 'إيقاف التسجيل',
  'Send': 'إرسال',
  'Voice input is not supported on this browser': 'الإدخال الصوتي غير مدعوم على هذا المتصفح',
  'Microphone access is needed for voice input. Enable it in your browser settings.': 'نحتاج إذن المايكروفون للإدخال الصوتي. فعّله من إعدادات المتصفح.',
  'Voice input is not available right now.': 'الإدخال الصوتي غير متاح حالياً.',
  'Ranked by most recent': 'مرتبة حسب الأحدث',
  'Ranked by closest match.': 'مرتبة حسب الأقرب لطلبك.',
  'Show more': 'عرض المزيد',
  'Show next': 'التالي',
  'more than {n}': 'أكثر من {n}',
  'I have more than that, but I showed you the first {n} listings out of {total}. Want me to show all results, or help you find more precise ones?': 'عندي نتائج أكثر من كذا، لكن عرضت لك أول {n} إعلانات من أصل {total} إعلان. تبي أعرض لك كل النتائج، أو أساعدك نلقى نتائج أدق؟',
  'Show all results': 'عرض جميع النتائج',
  'Load more': 'عرض المزيد',
  'Loading more…': 'جاري تحميل المزيد…',
  'We found {n} listings matching your search.': 'لقينا {n} إعلان يطابق طلبك.',
  'I showed you the first {n} listings. Want me to show more, or help you find more precise ones?': 'عرضت لك أول {n} إعلانات. تبي أعرض لك المزيد، أو أساعدك نلقى نتائج أدق؟',
  'I showed you all {n} matching listings. Want help finding more precise ones?': 'عرضت لك كل النتائج المطابقة ({n} إعلان). تبي أساعدك نلقى نتائج أدق؟',
  // ≤25-result variants (owner 2026-08-19, item 4): no "help me find more precise ones?" invitation
  // when the result set is already small enough that Advanced Filter has nothing useful left to offer.
  'I showed you the first {n} listings. Want me to show more?': 'عرضت لك أول {n} إعلانات. تبي أعرض لك المزيد؟',
  'I showed you all {n} matching listings.': 'عرضت لك كل النتائج المطابقة ({n} إعلان).',
  // CAPPED variants (owner 2026-08-20): when MORE than the browse cap actually match, the truth has two
  // numbers — the real match total AND the capped number shown. Never imply that only {shown} matched.
  'We found {total} listings matching your search, and showed you {shown}. Want help finding more precise ones?': 'لقينا {total} إعلان يطابق طلبك، وعرضنا لك {shown} منها. تبي أساعدك نلقى نتائج أدق؟',
  'We found {total} listings matching your search, and showed you {shown}.': 'لقينا {total} إعلان يطابق طلبك، وعرضنا لك {shown} منها.',
  'I can show you 100 listings at a time.': 'أقدر أعرض لك 100 إعلان في كل مرة.',
  'Let’s narrow it down': 'خلّنا نحدد الطلب أكثر',
  // Read Aloud closing note (owner request, 2026-08-23 — "read the note... and say the button
  // also"): spoken ONLY when the matching buttons are actually on screen (agent.tsx gates this the
  // same way), naming the exact same button label(s) so it can never mention an action that isn't
  // there to tap.
  'You can tap {a} or {b}.': 'تقدر تضغط على {a} أو {b}.',
  'You can tap {a}.': 'تقدر تضغط على {a}.',
  'Help me find more precise results': 'ساعدني ألقى نتائج أدق',
  'I can get you something more precise.': 'أقدر أجيب لك نتائج أدق.',
  // Composer placeholder (owner wording 2026-08-16) — names the domain and the country, in the
  // conversational register the rest of the agent speaks.
  "Type the property you're looking for in Saudi Arabia...": 'اكتب العقار اللي تبحث عنه في السعودية...',
  // Stable composer accessibility label (owner brief 2026-08-23 §11) — the ONE sentence a screen
  // reader hears for the AI input; the rotating examples are aria-hidden decoration.
  'Describe the property you are looking for': 'اكتب وصف العقار اللي تبحث عنه',
  'Want more accurate results?': 'تريد نتائج أدق؟',
  'I can ask you a few questions to find your perfect match.': 'يمكنني طرح بعض الأسئلة لإيجاد ما يناسبك تماماً.',
  'Ezhalah displays listings sourced from third party platforms. We do not recommend, verify or own any listing. The choice is yours.':
    'يعرض إزهله إعلانات من منصات خارجية. نحن لا نوصي بأي إعلان ولا نتحقق منه ولا نملكه. القرار لك.',
  'Ezhalah displays listings from third-party property platforms. We do not own, verify, or recommend any listing. Please review all details carefully before making a decision.':
    'تعرض إزهله إعلانات من منصات عقارية خارجية. نحن لا نملك أي إعلان ولا نتحقق منه ولا نوصي به. يرجى مراجعة كل التفاصيل بعناية قبل اتخاذ أي قرار.',
  'A villa big enough for the whole family in Riyadh': 'فيلا تكفي العائلة كلها في الرياض',
  'What can SAR 800,000 buy me in Jeddah?': 'وش ألقى بـ 800,000 ريال في جدة؟',
  'An office to launch my startup in Riyadh': 'مكتب أبدأ فيه مشروعي في الرياض',
  'Office space in Riyadh': 'مكتب في الرياض',
  'Shop for rent in Jeddah': 'محل للإيجار في جدة',
  'Floor for rent in Al Malqa, Riyadh': 'دور للإيجار في الملقا، الرياض',
  'A building in Makkah': 'عمارة في مكة',
  'Apartment near King Saud University': 'شقة قرب جامعة الملك سعود',
  'Villa with a pool in Al Narjis': 'فيلا فيها مسبح في حي النرجس',
  'Family apartment in Khobar under SAR 60,000/year': 'شقة عائلية في الخبر بأقل من 60,000 ريال بالسنة',
  'Commercial land in Jeddah under SAR 1 million': 'أرض تجارية في جدة بأقل من مليون ريال',
  'Student apartment near KFUPM': 'شقة طلابية قرب جامعة الملك فهد للبترول',
  'Luxury penthouse in Riyadh': 'بنتهاوس فاخر في الرياض',
  'Beachfront property in Al Khobar': 'عقار على البحر في الخبر',
  'Chalet for weekend escapes near Riyadh': 'شاليه لعطلة نهاية الأسبوع قرب الرياض',
  'Warehouse in Dammam Industrial City': 'مستودع في المدينة الصناعية بالدمام',
  'Apartment near KAFD': 'شقة قرب الحي المالي (كافد)',
  'Investment property with strong rental demand': 'عقار استثماري عليه طلب إيجار قوي',
  'Residential land in North Riyadh': 'أرض سكنية في شمال الرياض',
  'Villa near Boulevard Riyadh City': 'فيلا قرب بوليفارد رياض سيتي',
  'Apartment with sea view in Jeddah': 'شقة بإطلالة بحرية في جدة',
  'Farm for sale near Abha': 'مزرعة للبيع قرب أبها',
  'Shop in a busy commercial district': 'محل في حي تجاري حيوي',
  'Building for investment in Makkah': 'عمارة للاستثمار في مكة',
  'Here are spacious family villas in Riyadh to explore.': 'إليك فللاً عائلية واسعة في الرياض تستكشفها.',
  "Here's what around SAR 800,000 looks like in Jeddah.": 'إليك المتاح بحدود 800,000 ريال في جدة.',
  'Here are offices in Riyadh for a new business.': 'إليك مكاتب في الرياض تناسب مشروعاً جديداً.',

  // Agent replies
  "Tell me what you're looking for and I'll search for it.": 'أخبرني بما تبحث عنه وسأبحث عنه لك.',
  "I'm really sorry you're feeling this way, please reach out to someone you trust. I'm Ezhalah and I help with real estate in Saudi Arabia, what are you looking for?":
    'يؤسفني شعورك بهذا حقاً، أرجو أن تتواصل مع شخص تثق به. أنا إزهله وأساعدك في العقارات داخل المملكة العربية السعودية، ما الذي تبحث عنه؟',
  "I can only show you listings, I can't recommend or advise. But I can show you a mix of both options in one set if you'd like. Just tell me what you're after.":
    'يمكنني فقط عرض الإعلانات، لا أستطيع التوصية أو تقديم النصيحة. لكن يمكنني عرض مزيج من الخيارين في مجموعة واحدة إن رغبت. فقط أخبرني بما تريد.',
  'Here are some properties you might be interested in:': 'إليك بعض العقارات التي قد تهمك:',
  'Did you mean "{q}"?': 'هل تقصد «{q}»؟',
  "I can't recommend or rank options for you — the choice is yours. But tell me your situation (where, rent or buy, rough size or budget) and I'll lay out neutral listings whenever you say \"show me\".":
    'لا أستطيع التوصية أو ترتيب الخيارات لك، فالقرار قرارك. لكن أخبرني بوضعك (الموقع، إيجار أو شراء، المساحة أو الميزانية تقريباً) وسأعرض لك إعلانات محايدة متى ما قلت «اعرض لي».',
  "Happy to help you think it through. Tell me roughly what you need — where, rent or buy, and a size or budget — and whenever you're ready just say \"show me\" and I'll pull up listings.":
    'يسعدني مساعدتك على التفكير في الأمر. أخبرني تقريباً بما تحتاجه، الموقع، إيجار أو شراء، والمساحة أو الميزانية، ومتى ما كنت جاهزاً قل «اعرض لي» وسأعرض لك الإعلانات.',
  "Hey! I'm Ezhalah, your real estate assistant for Saudi Arabia. Tell me what you're looking for, to rent or buy, and I'll find it.":
    'مرحباً! أنا إزهله، مساعدك العقاري في المملكة العربية السعودية. أخبرني بما تبحث عنه، للإيجار أو للشراء، وسأجده لك.',
  "You're welcome! I'm Ezhalah, whenever you're ready, tell me what property you're after and I'll search for it.":
    'على الرحب والسعة! أنا إزهله، متى ما كنت جاهزاً، أخبرني بالعقار الذي تريده وسأبحث عنه.',
  "I'm Ezhalah, your real estate assistant for Saudi Arabia. Tell me what you're looking for and I'll find listings for you.":
    'أنا إزهله، مساعدك العقاري في المملكة العربية السعودية. أخبرني بما تبحث عنه وسأجد لك الإعلانات.',
  "I'm Ezhalah, I only help with real estate across Saudi Arabia. Tell me what you're looking for, or tap Filter at the top to search by details.":
    'أنا إزهله، أساعد فقط في العقارات داخل المملكة العربية السعودية. أخبرني بما تبحث عنه، أو اضغط «تصفية» في الأعلى للبحث بالتفاصيل.',

  // Search headings + notes
  'Ezhalah! Here are {what} listings {verb} in {place}.': '‏إزهله! إليك إعلانات {what} {verb} في {place}.',
  '{what} {verb} in {place}': '{what} {verb} في {place}',
  'Searching all of Saudi Arabia — add a city to narrow it down.': 'يشمل البحث كامل المملكة العربية السعودية — أضف مدينة لتضييق النطاق.',
  'Showing a mix of property types.': 'نعرض مزيجاً من أنواع العقارات.',
  'Showing listings whose details mention what you searched for — street and nearby info is published by only some platforms.':
    'نعرض الإعلانات التي تذكر ما بحثت عنه في تفاصيلها — معلومات الشارع والمواقع القريبة متوفرة لدى بعض المنصات فقط.',
  'Only some platforms provide street or nearby information, so showing listings from the same district instead.':
    'بعض المنصات فقط توفر معلومات الشارع أو المواقع القريبة، لذا نعرض إعلانات من نفس الحي بدلاً من ذلك.',
  'Price: {echo}': 'السعر: {echo}',
  'Nothing within your budget right now — showing the closest options above it.':
    'لا يوجد ضمن ميزانيتك حالياً — نعرض أقرب الخيارات الأعلى منها.',
  'No listings in that exact neighborhood — showing others in the same city.':
    'لا توجد إعلانات في هذا الحي بالتحديد — نعرض غيرها في نفس المدينة.',
  'No exact size match — showing the closest sizes available.':
    'لا يوجد بنفس المساحة بالضبط — نعرض أقرب المساحات المتاحة.',
  'Sorted by newest first.': 'مرتّبة من الأحدث.',
  'Sorted by oldest first.': 'مرتّبة من الأقدم.',
  'Sorted by price, lowest first.': 'مرتّبة بالسعر، من الأقل.',
  'Sorted by price, highest first.': 'مرتّبة بالسعر، من الأعلى.',
  'Sorted by area, smallest first.': 'مرتّبة بالمساحة، من الأصغر.',
  'Sorted by area, largest first.': 'مرتّبة بالمساحة، من الأكبر.',
  'Sorted by price per m², lowest first.': 'مرتّبة بسعر المتر، من الأقل.',
  'Sorted by price per m², highest first.': 'مرتّبة بسعر المتر، من الأعلى.',
  'Sorted by bedrooms, most first.': 'مرتّبة بعدد الغرف، من الأكثر.',

  // Filter search → chat (natural-language bubble + result subheading)
  "I'm looking for {what}{detail} {verb} in {place}{price}": 'ارحب إزهله 👋، أبحث عن {what}{detail} {verb} في {place}{price}',
  '{cat} property': 'عقار {cat}',
  'a property': 'عقار',
  '{cat} properties': 'عقارات {cat}',
  'properties': 'عقارات',
  ' around {n} m²': ' بمساحة حوالي {n} م²',
  ' around {n}': ' بمساحة حوالي {n}',
  'in {place}': 'في {place}',
  'across Saudi Arabia': 'في جميع أنحاء المملكة العربية السعودية',
  '{calc}Here are {what} {verb} {place} that match what you’re looking for.':
    '{calc}إليك {what} {verb} {place} تطابق ما تبحث عنه.',
  "I couldn't find anything at {amount}, but here are some similar to what you're looking for:":
    'لم أجد شيئاً بسعر {amount}، لكن إليك بعض الخيارات المشابهة لما تبحث عنه:',
  '{a}/month': '{a}/شهرياً',
  ' for {a}': ' بسعر {a}',
  // COMBINED شراء+إيجار states TWO labelled budgets (Buy side + Rent side) instead of one bare price,
  // so the bubble needs a "with …" carrier and an "and" that joins them. AR 'و' attaches with no
  // trailing space, so the joiner is ' و' and the carrier ' ب' + the label. (2026-08-23 combined-budget fix.)
  ' with {a}': ' ب{a}',
  ' and ': ' و',
  ' for {a}/month': ' بسعر {a}/شهرياً',
  "You entered {a}/month × 12 = {b}/year, so I'm searching up to {b}. ": 'أدخلت {a}/شهرياً × 12 = {b}/سنوياً، لذا أبحث حتى {b}. ',
  ' for up to {a}/year': ' بسعر حتى {a}/سنوياً',
  "I'm searching up to {a}/year. ": 'أبحث حتى {a}/سنوياً. ',
  ' at {a}/m²': ' بسعر {a}/م²',
  "You entered {a}/m² × {size} m² = {total}, so I'm searching up to {total}. ": 'أدخلت {a}/م² × {size} م² = {total}، لذا أبحث حتى {total}. ',
  "I'm searching at up to {a}/m². ": 'أبحث بسعر حتى {a}/م². ',
  "You entered {a}/m², so for each listing I do {a}/m² × its area and keep the ones within budget. ": 'أدخلت {a}/م²، لذا لكل عقار أحسب {a}/م² × مساحته وأبقي ما يدخل ضمن ميزانيتك. ',
  ' for up to {a}': ' بسعر حتى {a}',
  "I'm searching up to {a}. ": 'أبحث حتى {a}. ',

  // Price echoes
  "I couldn't find anything at that price — but here are some similar.": 'لم أجد شيئاً بهذا السعر — لكن إليك بعض الخيارات المشابهة.',
  '{a}/mo → {b}/yr': '{a}/شهرياً ← {b}/سنوياً',
  '{a}/yr': '{a}/سنوياً',
  '{a}/m² × {size} m² → {total}': '{a}/م² × {size} م² ← {total}',
  '{a}/m²': '{a}/م²',

  // Recency labels
  'today': 'اليوم',
  '2 days ago': 'قبل يومين',
  '2 months ago': 'قبل شهرين',
  '8 months ago': 'قبل 8 أشهر',
  '1 year ago': 'قبل سنة',
  'recently': 'مؤخراً',

  // Browser
  'Done': 'تم',
  'Listing not found.': 'لم يُعثر على الإعلان.',
  'Open in new tab': 'فتح في تبويب جديد',
  'For Rent': 'للإيجار',
  'For Buy': 'للبيع',
  'Area': 'المساحة',
  'Area (m²)': 'المساحة م²',
  'Enter area in m²': 'أدخل المساحة م²',
  'From': 'من',
  'To': 'إلى',
  'SAR currency': 'ريال',
  'No listings in that price range — there are matches outside it. Want me to remove the price filter?':
    'ما فيه إعلانات في نطاق السعر هذا — فيه نتائج خارجه. أزيل فلتر السعر؟',
  'Refine your search': 'خصص بحثك أكثر',
  'Select bedrooms and/or area, or leave both empty to see all options': 'اختر عدد غرف النوم و/أو المساحة، أو اتركها فاضية لعرض كل الخيارات',
  'Any count': 'أي عدد',
  'Beds': 'غرف',
  'Baths': 'حمامات',
  'Bed':  'غرفة',
  'Bath': 'حمام',
  // New rich card strings — locked by the user's design spec.
  'AQAR':                              'عقار',
  'Hosted on AQAR':                    'مستضاف على عقار',
  'Clicking this property will take you to sa.aqar.fm': 'الضغط على هذا الإعلان سيأخذك إلى sa.aqar.fm',
  // Source-aware variants — the brand name varies (AQAR/Wasalt), so the localized string carries
  // the {name} / {host} placeholder. The English value is the FALLBACK if a key is missing.
  'Hosted on {name}':                  'مستضاف على {name}',
  // Source BRAND names — must localize in Arabic too (rule: Arabic UI = everything Arabic except
  // numbers/domains). The card translates the source name through t() before display, so an Arabic
  // card reads "مستضاف على وصلت" not "Hosted on Wasalt". Applies to every source. ('AQAR' is already
  // defined above.)
  'Wasalt':                            'وصلت',
  'Aldarim Real Estate':              'الدريم العقارية',
  'Aqar Gate':                         'بوابة العقار',
  'Al Hoshan':                         'الحوشان العقارية',
  'Hajer Houses Real Estate':          'بيوت هجر العقارية',
  'Sanadak':                           'سندك',
  'No photo available':                'لا توجد صورة',
  'East Abha Real Estate':             'شرق أبها للخدمات العقارية',
  'Aqar City':                         'عقار ستي',
  'Raghdan Real Estate':               'رغدان للعقارات',
  'Eqar Tabuk':                        'عقار تبوك', // corrected 2026-07-15: was 'Candles'/'كاندلز عقار تبوك', an invented label with no basis on the real site (eaqartabuk.com self-brands as عقار تبوك)
  'Satel':                             'ساتل العقارية',
  'Sadin for Real Estate':             'مكتب سدين للعقارات',
  'TOOR':                              'منصة توور',
  'Mustaqarr Real Estate':             'مستقر للعقارات',
  'Ramz Al Qassim Real Estate Investment': 'رمز القصيم العقاري',
  'Fursa Ghyr Real Estate':            'فرصة غير للعقارات',
  'Jazan Watan':                       'جازان وطن',
  'Mizlaj Real Estate':                'مؤسسة مزلاج العقارية',
  'Muktamel':                          'مكتمل',
  'Nawait':                            'نويت', // corrected 2026-07-15: was 'Aqaratikom'/'عقاراتكم' — the scraper's target (aqaratikom.com → backend nawait.sa, see scrapers/aqaratikom/run.py) now self-brands as نويت/Nawait on its live site; internal name/table keys ('Aqaratikom') are unchanged, only this display label
  'Awal Real Estate':                  'أوال العقارية',
  'Awal United for Real Estate':       'أوال المتحدة العقارية', // official (their X @awaalun: «مؤسسة أوال المتحدة العقارية»)
  'Al Khaas':                          'الخاص للاستثمار العقاري',
  'Abeea Real Estate':                 'ابيعا العقارية',
  'Jurash Real Estate':                'جرش العقارية',
  'Al Nokhba':                         'النخبة العقارية',
  'Gathern':                           'جاذر إن', // official (App Store / Google Play / @gathernApp: «Gathern | جاذر إن»)
  'Deal':                              'ديل',
  'Deal App':                          'ديل',
  '24 Souq':                           'سوق العقار ٢٤',
  'Era Pulse':                         'نبض العصر',
  'Al Nowaisiry Real Estate':          'النويصري العقارية',
  '1 October Real Estate':             '1 أكتوبر العقارية',
  'Additional Information':            'معلومات إضافية',
  'See more':                          'عرض المزيد',
  'See less':                          'عرض أقل',
  'Clicking this property will take you to {host}': 'الضغط على هذا الإعلان سيأخذك إلى {host}',
  'for Rent':                          'للإيجار',
  'for Sale':                          'للبيع',
  'Added':                             'أضيف',
  'Rent now, pay later':               'استأجر الآن وادفع لاحقًا',
  'Over 12 months':                    'على 12 شهر',
  'from':                              'من',
  'month':                             'شهر',
  'Features':                          'المميزات',
  'View on AQAR':                      'عرض على عقار',
  'Open on AQAR':                      'افتح على عقار',
  'This listing is hosted on AQAR. Open it there to contact the advertiser.':
    'هذا الإعلان مستضاف على عقار. افتحه هناك للتواصل مع المعلن.',
  '+{n} More Features':                '{n}+ خاصيات إضافية',
  'Show fewer features':               'عرض أقل من الخاصيات',
  'No additional features listed':     'لا توجد خاصيات إضافية',
  // Feature labels in the right-side grid (Parking/Elevator/Kitchen already keyed above).
  'Maid Room':          'غرفة خادمة',
  'Master Bedrooms':    'غرف ماستر',
  'Halls / Majlis':     'صالات / مجالس',
  'Balcony / Terrace':  'بلكونة / تراس',
  'Laundry Room':       'غرفة غسيل',
  'Private Entrance':   'مدخل خاص',
  'Air Conditioning':   'مكيف',
  'Fiber Internet':     'ألياف بصرية',
  'Water Supply':       'توفر الماء',
  'Electricity':        'كهرباء',
  'Sanitation':         'صرف صحي',
  // "Additional Information" panel labels (Wasalt + Aqar Gate REGA fields). Labels localize; the
  // values are source data (REGA), shown as-is.
  'Property usage':                     'استخدام العقار',
  'Age':                                'عمر العقار',
  'Facade':                             'الواجهة',
  'Ad source':                          'مصدر الإعلان',
  'Plan number':                        'رقم المخطط',
  'Land number':                        'رقم القطعة',
  'Street width':                       'عرض الشارع',
  'Street':                             'الشارع',
  'Property services':                  'خدمات العقار',
  'Other obligations on the property':  'التزامات أخرى على العقار',
  'License Issuance Date':              'تاريخ إصدار الترخيص',
  'Postal Code':                        'الرمز البريدي',
  'Additional No.':                     'الرقم الإضافي',
  'Building No.':                       'رقم المبنى',
  'Water':                              'مياه',
  'Total Floors':                       'إجمالي الطوابق',
  'Property Floor':                     'الطابق',
  'Furniture':                          'الأثاث',
  'Number of Parkings':                 'عدد المواقف',
  'Building age (years)':               'عمر البناء (بالسنوات)',
  'Ad license number':                  'رقم رخصة الإعلان',
  // New-platform additional-info labels (Aqarcity/Eastabha/Sanadak/Raghdan/Eqar Tabuk/Satel/Sadin).
  'Amenities':                          'المرافق',
  'Furnishing':                         'التأثيث',
  'Kitchens':                           'المطابخ',
  'Majlis / Halls':                     'الصالات والمجالس',
  'Parking type':                       'نوع الموقف',
  'AC type':                            'نوع التكييف',
  'Kitchen':                            'المطبخ',
  'License status':                     'حالة الترخيص',
  'License expiry':                     'تاريخ انتهاء الترخيص',
  'FAL license':                        'رخصة فال',
  'Parcel number':                      'رقم القطعة',
  'Building code compliant':            'مطابق لكود البناء',
  'Warranties':                         'الضمانات',
  'Deed location':                      'موقع الصك',
  'Status':                             'الحالة',
  'Address':                            'العنوان',
  // Gathern Tier-1 additional-info labels (Gathern-only keys) + guest-rating review count.
  'Sub-type':                           'نوع الوحدة',
  'Furnished':                          'مفروش',
  'Discount':                           'الخصم',
  'Monthly before discount (SAR)':      'السعر الشهري قبل الخصم (ريال)',
  'Nightly rate (SAR)':                 'السعر الليلي (ريال)',
  'Suitable for':                       'مناسب لـ',
  'Guest capacity':                     'عدد الضيوف',
  'Check-in':                           'تسجيل الدخول',
  'Check-out':                          'تسجيل الخروج',
  'House rules':                        'شروط الحجز',
  '{n} reviews':                        '{n} تقييم',
  'Yes':                               'نعم',
  'bd': 'غرفة',
  'Type': 'النوع',
  'm²': 'م²',
  'Description': 'الوصف',
  'Call': 'اتصال',
  'WhatsApp': 'واتساب',
  'Telegram': 'تيليجرام',
  '{type} for {verb} in {district}': '{type} {verb} في {district}',
  '{type} available for {verb} in {district}, {city}. Spanning {area} m²{beds}, this property offers a prime location{road} with easy access to schools, mosques and main roads. Listed directly on {source}. Contact the advertiser for viewing and full details.':
    '{type} متاح {verb} في {district}، {city}. بمساحة {area} م²{beds}، يوفّر هذا العقار موقعاً مميزاً{road} مع سهولة الوصول إلى المدارس والمساجد والطرق الرئيسية. معروض مباشرة على {source}. تواصل مع المعلن للمعاينة والتفاصيل الكاملة.',
  ' with {n} bedrooms': ' مع {n} غرف نوم',
  ' with {n} bedroom': ' مع {n} غرفة نوم',
  ' on {road}': ' على {road}',
  'Reference: EZ-{ref} · Listed {listed} · via {source}': 'المرجع: EZ-{ref} · أُدرج {listed} · عبر {source}',
  'Listing provided by {source}. Ezhalah does not own or verify this listing — confirm all details directly with the source before any decision.':
    'هذا الإعلان مقدَّم من {source}. لا تملك إزهله هذا الإعلان ولا تتحقق منه — تأكد من كل التفاصيل مباشرة مع المصدر قبل أي قرار.',

  // Auth
  'Aqar, Wasalt, Aldarim and more — all in one search.': 'منصات عقار ووصلت والدريم والمزيد — في بحث واحد.',
  // Auth hero — new title + subtitle (user-supplied Arabic; English mirrors it without naming
  // platforms, per the platform-confidentiality rule). The title carries the brand "Ezhalah".
  'Looking for a property? Ezhalah.': 'تدور على عقار؟ إزهله.',
  'Sign in or create your account': 'سجّل الدخول أو أنشئ حسابك',
  'More than 25 Saudi property platforms — in one place.': 'أكثر من ٢٥ منصة عقارية سعودية — في مكان واحد.',
  'Ezhalah brings property listings from the various Saudi real-estate platforms together in one place.':
    'إزهله تجمع العقارات المعروضة من مختلف منصات العقار السعودية في مكان واحد.',
  'Continue with Google': 'المتابعة باستخدام Google',
  'Continue with Apple': 'المتابعة باستخدام Apple',
  'or': 'أو',
  'Saudi mobile numbers start with 5': 'أرقام الجوال السعودية تبدأ بالرقم 5',
  'Enter 9 digits': 'أدخل 9 أرقام',
  'Continue': 'متابعة',
  "By continuing you agree to Ezhalah's Terms & Privacy Policy.": 'بالمتابعة فإنك توافق على شروط إزهله وسياسة الخصوصية.',
  'Enter the code': 'أدخل الرمز',
  'We sent a 6-digit code on WhatsApp to': 'أرسلنا رمزاً مكوّناً من 6 أرقام عبر واتساب إلى',
  'Verifying…': 'جارٍ التحقق…',
  'Resend code on WhatsApp': 'إعادة إرسال الرمز عبر واتساب',
  'Phone number': 'رقم الجوال',
  '{country} numbers must start with {hint}': 'أرقام {country} يجب أن تبدأ بـ {hint}',
  'Enter {n} digits': 'أدخل {n} أرقام',
  // Country names + dial-prefix hints (phone picker)
  'United Arab Emirates': 'الإمارات العربية المتحدة',
  'Qatar': 'قطر',
  'Bahrain': 'البحرين',
  'Oman': 'عُمان',
  'Kuwait': 'الكويت',
  '50, 52, 54, 55, 56 or 58': '50 أو 52 أو 54 أو 55 أو 56 أو 58',
  '3, 5, 6 or 7': '3 أو 5 أو 6 أو 7',
  '3 or 6': '3 أو 6',
  '7 or 9': '7 أو 9',
  '5, 6 or 9': '5 أو 6 أو 9',
  // Google account chooser
  'Sign in with Google': 'تسجيل الدخول بحساب Google',
  'Choose an account': 'اختر حساباً',
  'to continue to': 'للمتابعة إلى',
  'Use another account': 'استخدام حساب آخر',
  'To continue, Google will share your name, email address, and profile picture with Ezhalah.':
    'للمتابعة، ستشارك Google اسمك وعنوان بريدك الإلكتروني وصورة ملفك الشخصي مع إزهله.',
  // Apple consent sheet
  'Sign in to': 'تسجيل الدخول إلى',
  'with your Apple Account': 'باستخدام حساب Apple الخاص بك',
  'Hide My Email': 'إخفاء بريدي الإلكتروني',
  'Share My Email': 'مشاركة بريدي الإلكتروني',
  "Ezhalah won't see your address": 'لن تطّلع إزهله على عنوانك',
  // Apple Face ID
  'Face ID': 'بصمة الوجه',
  'Confirm to sign in to Ezhalah': 'أكّد لتسجيل الدخول إلى إزهله',
  'Verified': 'تم التحقق',

  // Phone OTP errors (friendly, localized)
  'The code you entered is incorrect.': 'الرمز الذي أدخلته غير صحيح.',
  'This code has expired. Request a new one.': 'انتهت صلاحية هذا الرمز. اطلب رمزاً جديداً.',
  'Too many attempts. Please wait a moment and try again.': 'محاولات كثيرة. الرجاء الانتظار قليلاً ثم المحاولة مرة أخرى.',
  'Please enter a valid phone number.': 'الرجاء إدخال رقم هاتف صحيح.',
  'Phone sign-in isn’t available right now. Please try another method.': 'تسجيل الدخول عبر الهاتف غير متاح حالياً. جرّب طريقة أخرى.',
  'Network error. Check your connection and try again.': 'خطأ في الشبكة. تحقق من اتصالك ثم حاول مرة أخرى.',
  'Something went wrong. Please try again.': 'حدث خطأ ما. الرجاء المحاولة مرة أخرى.',

  // Settings
  'Account': 'الحساب',
  'Sign out': 'تسجيل الخروج',
  'Save searches and continue beyond your free search': 'احفظ عمليات بحثك وتابع بعد بحثك المجاني',
  'Language': 'اللغة',
  'How Ezhalah works': 'كيف تعمل إزهله',
  'A neutral search, nothing more': 'بحث محايد، لا أكثر',
  "Ezhalah unifies search across Saudi property platforms. We don't own, verify, or sell any listing, and we never take a commission on a deal.":
    'توحّد إزهله البحث عبر منصات العقارات السعودية. نحن لا نملك أي إعلان ولا نتحقق منه ولا نبيعه، ولا نأخذ أي عمولة على أي صفقة.',
  'The AI never recommends': 'الذكاء الاصطناعي لا يوصي أبداً',
  'The assistant only shows you listings that match what you asked for. It never says which is best and never gives buying or financial advice — the choice is always yours.':
    'يعرض المساعد فقط الإعلانات المطابقة لما طلبته. لا يقول أبداً أيها الأفضل ولا يقدّم نصيحة شرائية أو مالية — والقرار دائماً لك.',
  'No paid placement': 'لا توجد إعلانات مدفوعة',
  'Results are never sold. No listing is promoted or boosted for payment — ordering is based only on neutral signals.':
    'لا تُباع النتائج أبداً. لا يُروَّج لأي إعلان أو يُعزَّز مقابل المال — والترتيب يعتمد على إشارات محايدة فقط.',
  'Licensing & compliance': 'التراخيص والامتثال',
  'Your data (PDPL)': 'بياناتك (نظام حماية البيانات الشخصية)',
  "Ezhalah follows Saudi Arabia's Personal Data Protection Law. We don't sell your data. Your searches and account are kept until you delete your account, then permanently removed.":
    'تلتزم إزهله بنظام حماية البيانات الشخصية في المملكة. نحن لا نبيع بياناتك. تُحفظ عمليات بحثك وحسابك حتى تحذف حسابك، ثم تُزال نهائياً.',
  'Support': 'المساعدة/تواصل معنا',
  'Contact support': 'تواصل مع الدعم',
  'Terms of Service': 'شروط الخدمة',
  'Privacy Policy': 'سياسة الخصوصية',
  'Ezhalah v{version}': 'إزهله الإصدار {version}',

  // Drawer / sidebar
  'New Chat': 'محادثة جديدة',
  // Sidebar chat search (owner 2026-08-24): ChatGPT-style in-sidebar search, Arabic-first. The
  // empty state + hint are deliberately calm Saudi copy — never an English "No results".
  'Search chats': 'البحث في المحادثات',
  'Search your chats…': 'ابحث في محادثاتك…',
  'Close search': 'إغلاق البحث',
  'Type in Arabic to search your chats': 'اكتب بالعربي للبحث في محادثاتك',
  'No chat with that name': 'ما لقينا محادثة بهذا الاسم',
  'About Us': 'من نحن',
  'Sign up / Log in': 'إنشاء حساب / تسجيل الدخول',
  'Get more. Sign up free.': 'احصل على المزيد. سجل مجاناً.',
  'Sign up to keep searching': 'سجّل للاستمرار في البحث',
  'Get more with a free account': 'احصل على المزيد بحساب مجاني',
  'Sign up free to save your searches and favorites, and pick up right where you left off.':
    'سجّل مجاناً لحفظ عمليات بحثك ومفضّلاتك، وتابع من حيث توقفت.',
  'Not now': 'ليس الآن',
  'Starred': 'المميّزة بنجمة',
  'Recent': 'الأخيرة',
  'Today': 'اليوم',
  'Yesterday': 'أمس',
  'Last 7 Days': 'آخر 7 أيام',
  'Last 30 Days': 'آخر 30 يوماً',
  'Star': 'تمييز بنجمة',
  'Unstar': 'إزالة النجمة',
  'Delete': 'حذف',
  'Rename': 'إعادة تسمية',
  // Press-hold-drag reorder (owner 2026-08-24) — accessibility strings, Arabic-first.
  'Hold to reorder the conversation': 'اضغط مطولًا لإعادة ترتيب المحادثة',
  'Move conversation': 'نقل المحادثة',
  'Conversation order changed': 'تم تغيير ترتيب المحادثة',

  // Settings (account)
  'Display Name': 'الاسم المعروض',
  'Edit': 'تعديل',
  'Save': 'حفظ',
  'Phone Number': 'رقم الجوال',
  'Change': 'تغيير',
  'Apple Account': 'حساب Apple',
  'Google Account': 'حساب Google',
  "Can't be changed": 'لا يمكن تغييره',
  // Shown in the delete dialog when the SERVER delete failed — the account still exists, so the
  // copy must not imply anything was removed. (owner report 2026-08-17.)
  "Couldn't delete your account. Check your connection and try again.":
    'ما قدرنا نحذف حسابك. تأكد من اتصالك وحاول مرة ثانية.',
  "To change it, you'll have to delete this account and make a new one.":
    'لتغييره، عليك حذف هذا الحساب وإنشاء حساب جديد.',
  'Logged in device': 'الجهاز المسجَّل دخوله',
  'This device': 'هذا الجهاز',
  'Android / Chrome': 'أندرويد / كروم',
  'iPhone': 'آيفون',
  'Saved': 'تم الحفظ',
  'Name saved': 'تم حفظ الاسم',
  'Log out?': 'تسجيل الخروج؟',
  'Are you sure you want to log out?': 'هل أنت متأكد أنك تريد تسجيل الخروج؟',
  'Danger zone': 'منطقة الخطر',
  'Delete my account': 'حذف حسابي',
  'Log out': 'تسجيل الخروج',
  'Signing out…': 'جارٍ تسجيل الخروج…',
  'Deleting account…': 'جارٍ حذف الحساب…',
  'Apple sign-in isn’t available right now. Please try another method.': 'تسجيل الدخول عبر Apple غير متاح حالياً. جرّب طريقة أخرى.',
  'Change phone number': 'تغيير رقم الجوال',
  "Enter your new number, we'll send a verification code on WhatsApp.":
    'أدخل رقمك الجديد، وسنرسل لك رمز تحقق عبر واتساب.',
  'Send code': 'إرسال الرمز',
  'Cancel': 'إلغاء',
  'Back': 'رجوع',
  'Delete your account?': 'حذف حسابك؟',
  "This permanently removes your account, saved searches, and chat history. This can't be undone.":
    'يؤدي هذا إلى إزالة حسابك وعمليات بحثك المحفوظة وسجل المحادثات نهائياً. لا يمكن التراجع عن ذلك.',
  "Note: to change your {provider} account, you'll need to delete this account and sign up again with the new one.":
    'ملاحظة: لتغيير حساب {provider}، عليك حذف هذا الحساب وإنشاء حساب جديد بالحساب الآخر.',

  // About Us — the long-form «من نحن» copy below is the OWNER'S EXACT wording (2026-07-09); never
  // rewrite or shorten it (still referenced by src/app/about.tsx). The modal now uses the compact
  // 2026-08-23 redesign strings further down, approved by the owner's premium-redesign brief.
  'Close': 'إغلاق',
  'A Saudi property-search tool, powered by AI.': 'أداة بحث عقارية سعودية، مدعومة بالذكاء الاصطناعي.',
  'Ezhalah is your first destination for property search in Saudi Arabia, fully powered by AI.':
    'إزهله هي وجهتك الأولى للبحث عن عقار في المملكة العربية السعودية، مدعومة بالكامل بالذكاء الاصطناعي.',
  'Instead of browsing dozens of sites, we gather the properties listed on most licensed real-estate platforms in the Kingdom, plus the websites of licensed real-estate companies and offices, and show them in one organized, easy place.':
    'بدل التنقل بين عشرات المواقع، نجمع لك العقارات المدرجة من معظم المنصات العقارية المرخّصة في المملكة، إضافة إلى مواقع شركات ومكاتب عقارية مرخصة، ونعرضها في مكان واحد منظّم وسهل.',
  'Search smart, compare fast, and contact the listing source directly. All from one screen.':
    'ابحث بذكاء، قارن بسرعة، وتواصل مباشرة مع مصدر الإعلان. كل ذلك من شاشة واحدة.',
  'In short: Ezhalah is a search and aggregation tool — we do not own or sell properties, we connect you to them wherever they are.':
    'باختصار: إزهله أداة بحث وتجميع — لا نملك العقارات ولا نبيعها، بل نوصلك إليها أينما كانت.',
  'Listing licensing': 'ترخيص الإعلانات',
  "Every listing is published by its source platform and remains subject to that platform's licensing. Ezhalah does not issue or own advertisements.":
    'كل إعلان منشور من قِبل المنصة المصدر ويظل خاضعاً لترخيص تلك المنصة. إزهله لا تُصدر الإعلانات ولا تملكها.',
  'We collect only what the service needs, and we do not sell user data.':
    'نجمع فقط ما تحتاجه الخدمة، ولا نبيع بيانات المستخدمين.',
  'Ezhalah is a Saudi, AI-powered property search platform. We help people find properties faster by searching Aqar, Wasalt, Aldarim and more in one place, and help those platforms reach more users by driving traffic directly to their listings.':
    'إزهله منصة سعودية للبحث العقاري مدعومة بالذكاء الاصطناعي. نساعد الناس على إيجاد العقارات بشكل أسرع بالبحث في منصات عقار ووصلت والدريم في مكان واحد، ونساعد تلك المنصات على الوصول إلى مزيد من المستخدمين بتوجيه الزيارات مباشرة إلى إعلاناتها.',
  'Our role': 'دورنا',
  'We are a property search platform only. We do not own, list, sell or rent any property. We do not facilitate transactions or collect commission.':
    'نحن منصة بحث عقاري فقط. لا نملك أو ندرج أو نبيع أو نؤجّر أي عقار. ولا نسهّل أي معاملة ولا نأخذ أي عمولة.',
  'License': 'الترخيص',
  "Every listing shown on Ezhalah is published by the source platform it came from, and each advertisement remains subject to that platform's own licensing and regulatory obligations. Ezhalah does not issue, own or publish advertisements.":
    'كل إعلان يظهر في إزهله منشور من قِبل المنصة المصدر التي جاء منها، ويظل كل إعلان خاضعاً لترخيص تلك المنصة والتزاماتها النظامية. إزهله لا تُصدر الإعلانات ولا تملكها ولا تنشرها.',
  'Disclaimer': 'إخلاء المسؤولية',
  'All listings are sourced directly from third-party platforms. Ezhalah does not own or verify any listing. Always confirm details directly with the original platform before making any decision.':
    'جميع الإعلانات مصدرها منصات خارجية مباشرة. لا تملك إزهله أي إعلان ولا تتحقق منه. تأكّد دائماً من التفاصيل مباشرة مع المنصة الأصلية قبل اتخاذ أي قرار.',
  'Data & privacy': 'البيانات والخصوصية',

  // «من نحن» premium single-screen redesign (owner 2026-08-23): compact verb-led copy approved by
  // the owner's brief; the four legal facts survive verbatim-compact; NO Arabic dashes («—») in any
  // of these strings; the only number shown is derived from PLATFORM_META.length at compile time.
  'Smarter property search, bringing the Saudi market together in one place.':
    'بحث عقاري أذكى، يجمع السوق السعودي في مكان واحد.',
  'We gather': 'نجمع',
  'Property listings from the licensed platforms in the Kingdom, in one place.':
    'إعلانات العقارات من المنصات المرخّصة في المملكة، في مكان واحد.',
  '+{n} platforms': '+{n} منصة',
  'We organize': 'نرتب',
  'One organized screen that makes comparing fast and easy.':
    'شاشة واحدة منظّمة تسهّل عليك المقارنة بسرعة.',
  'We help': 'نساعد',
  'AI-powered search instead of browsing dozens of sites.':
    'بحث مدعوم بالذكاء الاصطناعي بدل التنقّل بين عشرات المواقع.',
  'We point you to the source': 'نوجّهك للمصدر',
  'We take you to the listing so you contact its original platform directly.':
    'نوصلك إلى الإعلان لتتواصل مباشرة مع منصته الأصلية.',
  'Ezhalah is a search platform only. We do not own, list, sell, or rent properties, and we run no transactions and take no commission.':
    'إزهله منصة بحث فقط. لا نملك العقارات ولا ندرجها ولا نبيعها ولا نؤجّرها، ولا نجري معاملات ولا نتقاضى عمولة.',
  'Every listing is published by its source platform and remains subject to its licensing. Ezhalah does not issue or own listings.':
    'كل إعلان منشور من منصته المصدر ويظل خاضعاً لترخيصها. إزهله لا تُصدر الإعلانات ولا تملكها.',
  'Listings come from external platforms and we do not verify them. Confirm the details with the original platform before any decision.':
    'الإعلانات من منصات خارجية ولا نتحقق منها. تأكّد من التفاصيل مع المنصة الأصلية قبل أي قرار.',

  // Support
  'Questions about your account, searches, or technical issues.':
    'أسئلة حول حسابك أو عمليات بحثك أو المشكلات التقنية.',
  'Business inquiries, partnerships, media requests, and general information.':
    'الاستفسارات التجارية والشراكات والطلبات الإعلامية والمعلومات العامة.',
  'Response Time': 'وقت الاستجابة',
  'Typical response time: {h}.': 'وقت الاستجابة المعتاد: {h}.',
  'Some inquiries may take up to {d}.': 'قد تستغرق بعض الاستفسارات حتى {d}.',
  '72 hours': '72 ساعة',
  '1 week': 'أسبوع واحد',

  // Share sheet
  'One place to explore all listings and more in seconds. Try now.':
    'مكان واحد لاستكشاف جميع الإعلانات والمزيد في ثواني. جرّب الآن.',
  'Copy Link': 'نسخ الرابط',
  'Copied!': 'تم النسخ!',
  'Messages': 'الرسائل',
  'Mail': 'البريد',
  'Notes': 'الملاحظات',
};

// Interpolate {placeholders}. Used by both en (key) and ar (translation) paths.
function fill(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  let out = template;
  for (const k of Object.keys(vars)) out = out.split('{' + k + '}').join(String(vars[k]));
  return out;
}

// Pure translate for an explicit locale — no dependence on module state. The React provider binds
// this to its `locale` state so screens re-render from a single source of truth (React state),
// while the module-level `t` below serves the non-React data layer.
export function translate(loc: Locale, en: string, vars?: Record<string, string | number>): string {
  const base = loc === 'ar' ? AR[en] ?? en : en;
  return fill(base, vars);
}

// Core translate: Arabic when active (falling back to the English key), English otherwise.
export function t(en: string, vars?: Record<string, string | number>): string {
  return translate(_locale, en, vars);
}

// Detect the script the user is writing in so the whole UI can follow their keyboard:
// any Arabic letter → 'ar', otherwise any Latin letter → 'en'. Returns null for
// digit-only/empty/symbol input so we don't flip the language on a lone number.
const _arScript = /[؀-ۿ]/;
const _latinScript = /[A-Za-z]/;
export function detectLocale(text: string): Locale | null {
  if (_arScript.test(text)) return 'ar';
  if (_latinScript.test(text)) return 'en';
  return null;
}

// Arabic-only INPUT guard: true when the user typed in English (Latin letters present, no Arabic).
// Digits (Western, Arabic-Indic, Persian) are stripped first so a number never counts as Latin —
// numbers stay 0-9 per the product rule. Used to REJECT English search input at the entry points,
// ABOVE the internal English↔Arabic mapping layer (which stays intact for matching the data).
export function isLatinOnlyInput(text: string): boolean {
  const stripped = (text || '').replace(/[0-9٠-٩۰-۹]/g, '');
  return _latinScript.test(stripped) && !_arScript.test(stripped);
}
export const ARABIC_ONLY_MSG = 'هذا التطبيق يدعم اللغة العربية فقط. الرجاء الكتابة بالعربية.';

// City-only Location field (owner spec 2026-07-17): shown when Search is pressed without a valid
// city picked from the list — the field never accepts free text or guesses a location, so this is
// the ONLY way to explain why the button didn't proceed. Direct constant, not routed through t(),
// same reasoning as ARABIC_ONLY_MSG above (this field has no English mode at all).
export const CITY_REQUIRED_MSG = 'الرجاء اختيار مدينة من القائمة.';

// District field, same rule as CITY_REQUIRED_MSG above but for an OPTIONAL field: the district text
// box is a search box over the catalog — only a TAPPED suggestion (a chip) is ever searched. Typed
// text that was never confirmed used to be dropped in silence: the field kept showing «النرجس»
// while the search ran over the whole city and said nothing about it (live 2026-08-23: dropdown
// advertised «حي النرجس · 1,699 إعلان», «بحث» landed on 36,908 city-wide, zero chips, zero warning).
// Visible UI state must equal the committed request state, so Search now stops and says which of the
// two honest outcomes the user has to choose: confirm the district, or clear the text and search the
// whole city. Direct constant, not routed through t(), same reasoning as ARABIC_ONLY_MSG above.
export const DISTRICT_UNCONFIRMED_MSG = 'الرجاء اختيار الحي من القائمة، أو مسح النص للبحث في المدينة كاملة.';

// Neutral, honest label for a listing whose city/district could not be resolved to a real place —
// NEVER invent a location, and NEVER show a raw scraper junk sentinel (e.g. the literal word
// "Other") in its place. Used by ResultCard.tsx and src/app/agent.tsx's results-summary text
// whenever city/district both come back empty after the JUNK_LOCATION_TOKENS guard in
// src/data/remote.ts. A direct constant (not routed through t()) so it renders identically
// regardless of locale — the app is Arabic-first (see ARABIC_ONLY_MSG above), and an invented
// English translation of "location unresolved" is exactly the kind of guess this string exists to
// avoid. (2026-07-10 location-data-quality audit.)
export const LOCATION_UNRESOLVED_AR = 'الموقع غير محدد';

// Same idea as LOCATION_UNRESOLVED_AR, for a listing's PROPERTY TYPE. normalizeType()
// (src/data/propertyTypes.ts) returns the designed sentinel clean type 'Unknown' whenever a raw
// scraped property_type isn't in the RAW_TO_CLEAN whitelist — 'Unknown' has no AR{} translation, so
// ResultCard.tsx's typeLabel used to silently render the literal English word "Unknown" on an
// Arabic-locale card (2026-07-13 sibling-leak audit). Never invent a specific type; state honestly
// that it's unspecified, same principle as LOCATION_UNRESOLVED_AR.
export const TYPE_UNRESOLVED_AR = 'نوع غير محدد';

// Same idea, for a Wasalt "Additional Information" row's LABEL (e.g. "Facade", "Ad source"). The
// deep-fetch backfill (scrapers/wasalt/run.py, WASALT_FETCH_DETAIL=1) stores Wasalt's own detail-
// page label text verbatim, with no dictionary-membership guard — unlike every OTHER additional-info
// source in this codebase, which only ever emits a small set of fixed, AR{}-translated literals. A
// label that doesn't happen to byte-match one of those literals would otherwise render in raw
// English next to its (already-guarded) value. (2026-07-13 sibling-leak audit.)
export const ATTRIBUTE_UNRESOLVED_AR = 'بيان غير محدد';

// A property type or category — Arabic translation, or lowercased English (matches the prior
// "here are villas" phrasing).
export function tWord(en: string): string {
  return _locale === 'ar' ? AR[en] ?? en : en.toLowerCase();
}

// A stored location string ("Riyadh, Al Malqa District") — translate each comma-separated part.
export function tPlace(s: string): string {
  if (!s) return s;
  return s
    .split(',')
    .map((p) => t(p.trim()))
    .join('، ');
}

// A bedrooms / size-band option ("Under 100 m²", "100–300 m²", "600+ m²"). Numbers + unit stay;
// only the words localize. Bedroom counts (plain digits) pass through untouched.
export function tDetailOption(opt: string): string {
  if (_locale !== 'ar') return opt;
  if (/^\d+\+?$/.test(opt)) return opt; // bedroom counts
  let s = opt.replace(/^Under\s*/, 'أقل من ');
  s = s.replace(/m²/g, 'م²');
  return s;
}

// A preset price-tab band ("Under SAR 75k", "SAR 75k–150k", "SAR 3M+"). Localize the words only —
// Western digits, "k"/"M" abbreviations, the en-dash and "+" all stay.
export function tPriceTab(opt: string): string {
  if (_locale !== 'ar') return opt;
  let s = opt.replace(/^Under\s*/, 'أقل من ');
  s = s.replace(/SAR/g, 'ر.س');
  return s;
}

// A guided-interview price band ("SAR 3,000 / month").
export function tPriceBand(opt: string): string {
  if (_locale !== 'ar') return opt;
  return opt.replace('SAR', 'ر.س').replace('/ month', '/ شهرياً');
}

// Guided-interview budget option. The bold amount ("SAR 3,500 / m²", "SAR 2,500 / mo") and the
// muted helper line ("≈ 875,000 total · 250 m²", "≈ 30,000 / year").
export function tBudgetMain(opt: string): string {
  if (_locale !== 'ar') return opt;
  return opt.replace('SAR', 'ر.س').replace('/ m²', '/ م²').replace('/ mo', '/شهرياً');
}
export function tBudgetSub(opt: string): string {
  if (_locale !== 'ar') return opt;
  return opt
    .replace('total', 'إجمالي')
    .replace('/ year', '/ سنوياً')
    .replace(/m²/g, 'م²');
}

// A pre-formatted listing price ("SAR 120,000/year", "SAR 2.9M"). Localize the currency and the
// period suffix; Western digits and the "M" magnitude stay as displayed across Saudi listings.
// `loc` defaults to the current app locale (every existing call site is unaffected) — an explicit
// override lets an Arabic-only surface (Read Aloud, owner 2026-08-19) format Arabic prices even
// while the visible UI locale is English, without touching the module-global _locale.
export function tPrice(price: string, loc: Locale = _locale): string {
  if (loc !== 'ar') return price;
  // RC-G (hardening 2026-07-13): finalize() emits 'Price on request' when a listing has no numeric
  // price (~2,600 live rows). tPrice localized the currency/period but NOT this phrase, so it leaked
  // the bare English string onto Arabic-only cards. Map it to the neutral Arabic equivalent here.
  if (price === 'Price on request') return 'السعر عند الطلب';
  return price
    .replace('SAR', 'ر.س')
    .replace('/year', '/سنوياً')
    .replace('/yr', '/سنوياً')   // finalize emits the abbreviated /yr — localize it too
    .replace('/month', '/شهرياً')
    .replace('/mo', '/شهرياً');  // monthly rentals show the per-month figure (user request)
}

export const sar = () => t('SAR');
// 'SAR' isn't in AR (it's a value, not chrome); give it directly.
AR['SAR'] = 'ر.س';
// NOTE (reconciliation 2026-07-13): the 'Unknown' property-type English leak is deliberately NOT
// fixed here — the concurrent branch fix/arabic-display-leaks-and-clear-all owns it with a more
// complete, more honest guard (TYPE_UNRESOLVED_AR='نوع غير محدد' + arabicOrPlaceholder() in
// ResultCard), which this batch defers to so the two don't duplicate or override each other.

// --- React provider ---------------------------------------------------------------------------
type I18nValue = { locale: Locale; isRTL: boolean; t: typeof t; setLocale: (l: Locale) => void };
const Ctx = createContext<I18nValue | null>(null);

function applyDirection(locale: Locale) {
  const rtl = locale === 'ar';
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    document.documentElement.lang = locale;
  } else {
    // Native: best-effort. A full flip requires an app reload, but new mounts pick this up.
    I18nManager.allowRTL(rtl);
    if (I18nManager.isRTL !== rtl) I18nManager.forceRTL(rtl);
  }
}

// Apply the Arabic-first default at module load so the very first paint is RTL on web.
applyDirection(_locale);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(_locale);

  // Mirror the React state into the module global *during render*, so any descendant that calls the
  // static `t()` (ResultCard, the data layer, etc.) reads the correct locale within this same commit.
  // React state is the single source of truth; `_locale` is just its synchronous shadow.
  _locale = locale;

  // Smooth the language switch. Flipping LTR↔RTL swaps every string and the layout
  // direction in one frame, which otherwise snaps harshly (especially mid-typing in
  // the city / chat fields). A brief opacity dip-and-restore crossfades the swap so it
  // glides. Skip the very first commit so the initial paint isn't faded in.
  const fade = useSharedValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    fade.value = withSequence(
      withTiming(0.45, { duration: 130, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 230, easing: Easing.bezier(0.22, 1, 0.36, 1) }),
    );
  }, [locale, fade]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  // Direction is a DOM/native side effect — keep it out of render.
  useEffect(() => {
    applyDirection(locale);
  }, [locale]);

  // Update the module shadow synchronously too, so a caller that switches the language and then
  // immediately runs the data layer in the same tick (e.g. the chat: detect the message's language
  // on Send, then call respond()) gets a reply in the NEW language — not the previous one. React
  // state stays the source of truth; this just removes the one-render lag for the static `t()`.
  const setLocale = useCallback((l: Locale) => {
    if (l !== 'ar') return; // Arabic-only product: the UI never switches to English
    _locale = l;
    persistLocale(l); // save synchronously (web) so a refresh keeps this language — guest or signed-in
    setLocaleState(l);
  }, []);

  // Bind `t` to the React state locale so consumers re-render purely from React state, not the
  // module global. (The module `t`/`_locale` shadow above still serves the data layer.)
  const boundT = useCallback(
    (en: string, vars?: Record<string, string | number>) => translate(locale, en, vars),
    [locale],
  );

  const value = useMemo<I18nValue>(
    () => ({ locale, isRTL: locale === 'ar', t: boundT, setLocale }),
    [locale, boundT, setLocale],
  );
  return (
    <Ctx.Provider value={value}>
      <Animated.View style={[{ flex: 1 }, fadeStyle]}>{children}</Animated.View>
    </Ctx.Provider>
  );
}

export function useI18n(): I18nValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n must be used within LocaleProvider');
  return v;
}
