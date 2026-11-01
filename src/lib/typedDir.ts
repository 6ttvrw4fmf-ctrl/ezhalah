// TYPED TEXT SITS ON ITS OWN LANGUAGE'S SIDE (owner 2026-10-29: «when user types … in English it types it in the
// wrong side»). A field's side follows the interface language only while it is empty; once the user types, English
// starts at the left and Arabic at the right, whatever the interface language. Numbers alone keep the field's side.
const AR = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const LATIN = /[A-Za-z]/;

export const TYPED_LTR = { textAlign: 'left', writingDirection: 'ltr' } as const;
export const TYPED_RTL = { textAlign: 'right', writingDirection: 'rtl' } as const;

/** The side for what was typed: Arabic → right, English → left, nothing / numbers only → null (keep the field's own). */
export function typedDir(text: string | null | undefined): typeof TYPED_LTR | typeof TYPED_RTL | null {
  const s = text ?? '';
  if (AR.test(s)) return TYPED_RTL;
  if (LATIN.test(s)) return TYPED_LTR;
  return null;
}
