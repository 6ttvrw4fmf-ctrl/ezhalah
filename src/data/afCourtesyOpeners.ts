// The Advanced Filter's summary bubble opens with a Saudi courtesy + a request (owner 2026-10-10: «before
// this message we want to add لاهنت and others … with emojis and rotation, then I'm interested / I want /
// make sure»). The owner approved these 10 verbatim, then removed «الله يجزاك خير 🤲، طلّع لي» (2026-10-11);
// one is picked at random per round, never the same one twice in a row. English uses matching translated courtesies (owner 2026-10-14).
//
// Owner rule 2026-09-19: a comma comes only AFTER the emoji, never before it.
export type AfCourtesyOpener = { opener: string; emoji: string; ask: string };

export const AF_COURTESY_OPENERS: AfCourtesyOpener[] = [
  { opener: 'لاهنت', emoji: '🤍', ask: 'أبغى' },
  { opener: 'يعطيك العافية', emoji: '🌿', ask: 'أدوّر على' },
  { opener: 'مشكور', emoji: '🙏', ask: 'تأكد لي من' },
  { opener: 'لو سمحت', emoji: '😊', ask: 'ابحث لي عن' },
  { opener: 'ما قصرت', emoji: '✨', ask: 'يهمني' },
  { opener: 'ممكن', emoji: '🙂', ask: 'تشوف لي' },
  { opener: 'يا هلا', emoji: '👋', ask: 'أبي أشوف' },
  { opener: 'يا ليت', emoji: '🌟', ask: 'تدوّر لي على' },
  { opener: 'تسلم', emoji: '💚', ask: 'أبغى أتأكد من' },
];

export const AF_COURTESY_OPENERS_EN: AfCourtesyOpener[] = [
  { opener: 'Please', emoji: '🤍', ask: "I'd like" },
  { opener: 'Thanks', emoji: '🌿', ask: "I'm looking for" },
  { opener: 'Thank you', emoji: '🙏', ask: 'please check for' },
  { opener: 'Please', emoji: '😊', ask: 'find me' },
  { opener: 'Thanks', emoji: '✨', ask: "I'm interested in" },
  { opener: "If you don't mind", emoji: '🙂', ask: 'show me' },
  { opener: 'Hello', emoji: '👋', ask: "I'd like to see" },
  { opener: "I'd appreciate it", emoji: '🌟', ask: 'please look for' },
  { opener: 'Thank you', emoji: '💚', ask: "I'd like to confirm" },
];

let lastIndex = { ar: -1, en: -1 };

/** Prepended to each round's summary; rotation is independent per language. */
export function pickAfCourtesyOpening(random: () => number = Math.random, locale: 'ar' | 'en' = 'ar'): string {
  const list = locale === 'en' ? AF_COURTESY_OPENERS_EN : AF_COURTESY_OPENERS;
  const n = list.length;
  let i = Math.floor(random() * n);
  if (n > 1 && i === lastIndex[locale]) i = (i + 1) % n;
  lastIndex[locale] = i;
  const { opener, emoji, ask } = list[i];
  return `${opener} ${emoji}${locale === 'en' ? ',' : '،'} ${ask} `;
}
