// THE PRODUCT'S OWN ARABIC STRINGS, as one definition two barriers share.
//
// Extracted from verify-e2e-targets-still-exist-in-the-product.ts (routine #6, 2026-09-26) when a
// second barrier needed the same corpus. A hand-copied second reader is the drift class this repo
// has already paid for once (feedback_never-test-a-copy-of-production-code), and the two questions
// asked of this corpus are exact mirror images, so they must not be allowed to disagree about what
// the product says:
//
//   · verify-e2e-targets-still-exist-in-the-product.ts — does every string the harness CLICKS still
//     exist in the product? (a target that has been renamed away)
//   · verify-screen-identity-is-an-element-not-a-substring.ts — is a string the harness MATCHES ON
//     also carried by a LONGER word the product renders? (a substring that cannot discriminate)
//
// LITERALS, NOT RAW TEXT, and comments excluded — that choice is load-bearing and belongs to the
// first barrier's own history: four `src/` comments still mention the old agent-tab label, so a
// corpus built from raw file text would have stayed green through the whole PART 9.5 defect.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Any character in the Arabic block. */
export const ARABIC = /[؀-ۿ]/;

/** Arabic LETTERS only — no punctuation, no guillemets, no digits. What makes a WORD longer. */
export const ARABIC_LETTER = /[ء-غف-يٱ-ۓ]/;

export function walk(dir: string, exts: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.test(p)) out.push(p);
  }
  return out;
}

const LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;

export const isCommentLine = (line: string) => {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
};

export function productStringCorpus(srcDir: string): Set<string> {
  const corpus = new Set<string>();
  for (const file of walk(srcDir, /\.(ts|tsx)$/)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (isCommentLine(line)) continue;
      let m: RegExpExecArray | null;
      LITERAL.lastIndex = 0;
      while ((m = LITERAL.exec(line))) {
        const v = m[1] ?? m[2] ?? m[3];
        if (v && ARABIC.test(v)) corpus.add(v);
      }
    }
  }
  return corpus;
}

/**
 * Every strictly-longer Arabic WORD in the corpus that carries `token` inside it.
 *
 * This is the whole judgement, and it is deliberately about WORDS rather than about strings. «بحث»
 * occurs inside the sentence «ابدأ بحث جديد» as its own word — that is the SAME control label, not an
 * ambiguity. It also occurs inside «أبحث», «البحث», «للبحث» and «بحثك», which are different words the
 * product renders on a different screen — and those are what make `innerText.includes('بحث')` unable
 * to tell the Filter home from the agent greeting.
 *
 * So a hit requires an Arabic LETTER immediately on one side of the token: a word boundary made of
 * space, punctuation or a guillemet is not ambiguity. Empty result ⇒ the substring test is safe.
 */
export function ambiguousCarriers(token: string, corpus: Iterable<string>): string[] {
  const out = new Set<string>();
  if (!token || !ARABIC_LETTER.test(token)) return [];
  for (const s of corpus) {
    let i = s.indexOf(token);
    while (i >= 0) {
      const before = i > 0 ? s[i - 1] : '';
      const after = i + token.length < s.length ? s[i + token.length] : '';
      const extended = (before && ARABIC_LETTER.test(before)) || (after && ARABIC_LETTER.test(after));
      if (extended) {
        // Report the whole surrounding word, which is what a reader needs to see.
        let a = i, b = i + token.length;
        while (a > 0 && ARABIC_LETTER.test(s[a - 1])) a--;
        while (b < s.length && ARABIC_LETTER.test(s[b])) b++;
        out.add(s.slice(a, b));
      }
      i = s.indexOf(token, i + 1);
    }
  }
  return [...out].sort();
}
