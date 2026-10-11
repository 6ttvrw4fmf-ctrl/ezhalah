// The Advanced Filter's summary bubble opens with a Saudi courtesy + a request (owner 2026-10-10: «before
// this message we want to add لاهنت and others … with emojis and rotation, then I'm interested / I want /
// make sure»). The owner approved these 10 verbatim, then removed «الله يجزاك خير 🤲، طلّع لي» (2026-10-11);
// one is picked at random per round, never the same one twice in a row. Arabic UI only — the English bubble stays as it is.
//
// Owner rule 2026-09-19: a comma comes only AFTER the emoji, never before it.
export type AfCourtesyOpener = { opener: string; emoji: string; ask: string };

export const AF_COURTESY_OPENERS: AfCourtesyOpener[] = [
  { opener: 'لاهنت', emoji: '🤍', ask: 'أبغى' },
  { opener: 'يعطيك العافية', emoji: '🌿', ask: 'أدوّر على' },
  { opener: 'الله يعافيك', emoji: '🙏', ask: 'تأكد لي من' },
  { opener: 'لو سمحت', emoji: '😊', ask: 'ابحث لي عن' },
  { opener: 'الله يسعدك', emoji: '✨', ask: 'يهمني' },
  { opener: 'ممكن', emoji: '🙂', ask: 'تشوف لي' },
  { opener: 'يا هلا', emoji: '👋', ask: 'أبي أشوف' },
  { opener: 'يا ليت', emoji: '🌟', ask: 'تدوّر لي على' },
  { opener: 'تسلم', emoji: '💚', ask: 'أبغى أتأكد من' },
];

let lastIndex = -1;

/** «لاهنت 🤍، أبغى » — prepended to the round's summary. `random` is injectable for the barrier. */
export function pickAfCourtesyOpening(random: () => number = Math.random): string {
  const n = AF_COURTESY_OPENERS.length;
  let i = Math.floor(random() * n);
  if (n > 1 && i === lastIndex) i = (i + 1) % n;
  lastIndex = i;
  const { opener, emoji, ask } = AF_COURTESY_OPENERS[i];
  return `${opener} ${emoji}، ${ask} `;
}
