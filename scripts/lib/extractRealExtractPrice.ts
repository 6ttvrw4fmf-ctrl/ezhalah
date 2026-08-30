// Load the REAL extractPrice() out of supabase/functions/agent/index.ts and make it callable.
//
// WHY THIS EXISTS. verify-agent-price-range-ceiling.ts used to keep a VERBATIM COPY of extractPrice
// and test the copy. That is a test that can pass while production is broken — and on 2026-08-29 it
// did exactly that: the copy went stale the instant the real function changed. A copy-based green
// tells you nothing about deployed behaviour. Extracting the live source removes the whole drift
// class: the barrier now fails if the REAL function breaks, and cannot pass on a duplicate.
//
// The edge function calls Deno APIs at module scope, so it cannot be imported directly under Node.
// We lift only the declarations extractPrice closes over.
//
// Extraction is LINE-BASED on purpose. A brace/paren walker desynchronises on this file: the
// declarations are full of regex literals whose (, [ and { are DATA, not code (`[^\d]{0,16}?`,
// `(?![a-z])`). Line-based slicing needs only the repo's existing formatting, and every slice is
// asserted to end where expected — so a reformat fails loudly here instead of silently extracting
// the wrong text.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Slice from the line starting with `header` through the first line matching `endsWith`. */
function slice(src: string, header: string, endsWith: RegExp): string {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => l.startsWith(header));
  if (start < 0) throw new Error(`extractRealExtractPrice: no line starts with ${JSON.stringify(header)}`);
  for (let i = start; i < lines.length; i++) {
    if (i > start || endsWith.test(lines[i])) {
      if (endsWith.test(lines[i])) return lines.slice(start, i + 1).join("\n");
    }
  }
  throw new Error(`extractRealExtractPrice: no terminator ${endsWith} after ${header}`);
}

export async function loadRealExtractPrice(): Promise<(s: string) => string> {
  const root = resolve(new URL("../..", import.meta.url).pathname);
  const src = readFileSync(join(root, "supabase/functions/agent/index.ts"), "utf8");
  const postModel = join(root, "supabase/functions/agent/postModel.ts");
  const parts = [
    `import { toWesternDigits, arabicWordAmounts } from ${JSON.stringify(postModel)};`,
    slice(src, "const CURRENCY_RATES", /^\};$|^\] as const;$|^\];$/),
    slice(src, "const AR_CURRENCY", /^\];$/),
    slice(src, "const RANGE_RE", /;\s*$/),
    slice(src, "function extractPrice(", /^\}$/),
    "export { extractPrice };",
  ];
  const dir = mkdtempSync(join(tmpdir(), "ezhalah-extractprice-"));
  const file = join(dir, "real.ts");
  writeFileSync(file, parts.join("\n\n"));
  const mod = await import(file);
  if (typeof mod.extractPrice !== "function") {
    throw new Error("extractRealExtractPrice: extraction produced no callable extractPrice");
  }
  return mod.extractPrice as (s: string) => string;
}
