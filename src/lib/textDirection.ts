// PER-MESSAGE direction follows the first Arabic or Latin letter, not word counts.
// Arabic place names inside an English sentence must not flip its paragraph direction.
// Extracted from
// agent.tsx's msgRTL (2026-08 Read Aloud work) so the SAME detection drives both the bubble's
// RTL/LTR layout AND the read-aloud utterance's language — one definition, never two copies that
// could disagree about what language a message is in.
export const msgRTL = (s: string): boolean => {
  const firstLetter = [...(s || '')].find(char =>
    /\p{L}/u.test(char) && /[\p{Script=Arabic}\p{Script=Latin}]/u.test(char));
  return firstLetter != null && /\p{Script=Arabic}/u.test(firstLetter);
};
