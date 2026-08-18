// PER-MESSAGE direction: which language dominates a string, by word count. Extracted from
// agent.tsx's msgRTL (2026-08 Read Aloud work) so the SAME detection drives both the bubble's
// RTL/LTR layout AND the read-aloud utterance's language — one definition, never two copies that
// could disagree about what language a message is in.
export const msgRTL = (s: string): boolean => {
  const words = (s || '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let ar = 0, en = 0;
  for (const w of words) { if (/[؀-ۿ]/.test(w)) ar++; else if (/[A-Za-z]/.test(w)) en++; }
  return ar > en;
};
