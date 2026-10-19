// EVERY MESSAGE EZHALAH SENDS ENDS WITH AN EMOJI AND NEVER CONTAINS A DASH (owner 2026-10-11).
//
// Owner: «never let the AI send this mark (—), no matter what; every message must have an emoji; and not be the same
// message, so it is not a chatbot that gives the same answers». The model and the code-written texts are TOLD this, but a
// told rule is a rule that fails one answer in a hundred, so this is the last gate every chat message passes through:
//   • noDashes():    «—» and «–» never appear (a range «100–300» is spelled «100 إلى 300» / «100 to 300»; a dash between
//                    words becomes a comma; a dash before punctuation, an emoji or the end is dropped). Even a hyphen INSIDE a
//                    word becomes a space («4-bedroom» → «4 bedroom»): the owner said «never this mark, no matter what».
//   • ensureEmoji(): a message that does not already end with an emoji gets one («📍» after a question, «🏡» otherwise).
// Pure and dependency-free. Mirrored literally in supabase/functions/agent/botMessage.ts (Deno cannot import from src/);
// scripts/verify-bot-messages-have-emoji-no-dash-and-vary.ts fails if the copies drift apart.
const EMOJI_END = /\p{Extended_Pictographic}️?\s*$/u;

export function noDashes(text: string): string {
  const src = String(text ?? '');
  const ar = /[؀-ۿ]/.test(src);
  const comma = ar ? '،' : ',';
  return src
    .replace(/(\d)\s*[–—-]\s*(?=\d)/g, `$1 ${ar ? 'إلى' : 'to'} `)                       // 100–300
    .replace(/^[\s–—-]+/, '')                                                              // leading dash
    .replace(/(\n)[ \t]*[–—-][ \t]+/g, '$1')                                               // dash that starts a line
    .replace(/[ \t]*[–—][ \t]*(?=\p{Extended_Pictographic})/gu, ' ')                      // dash right before an emoji
    .replace(/[ \t]*[–—][ \t]*(?=[,،.!?؟:؛\n]|$)/g, '')                                   // dash before punctuation / the end
    .replace(/[ \t]+[–—-][ \t]+/g, `${comma} `)                                            // dash between words
    .replace(/[–—]/g, `${comma} `)                                                         // any dash that is left
    .replace(/[-‐-―−]/g, ' ')                                                    // a hyphen inside a word, or a minus: a space
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,،.!?؟])/g, '$1');
}

export function ensureEmoji(text: string): string {
  const s = String(text ?? '').trim();
  if (!s || EMOJI_END.test(s)) return s;
  // an emoji that sits in the MIDDLE («… 🏡 (150 م²)») moves to the end: one emoji, and it is the last thing in the message
  const inside = /\p{Extended_Pictographic}\uFE0F?/u.exec(s);
  const body = inside ? s.replace(/\s*\p{Extended_Pictographic}\uFE0F?/gu, '').replace(/[ \t]{2,}/g, ' ').trim() : s;
  const question = /[؟?]\s*$/.test(body);
  return `${body.replace(/[.،,]+\s*$/, '')} ${inside ? inside[0] : question ? '📍' : '🏡'}`;
}

/** The last gate for any text Ezhalah says in the chat. Idempotent. */
export const botMessage = (text: string): string => {
  const out = ensureEmoji(noDashes(text));
  return out || (String(text ?? '').trim() ? '🏡' : ''); // a message that was only dashes is never sent empty
};
