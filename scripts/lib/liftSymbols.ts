// Lift real top-level declarations out of a source file and make them executable under Node.
//
// WHY. Several modules that barriers need to TEST cannot be imported directly: src/data/search.ts
// uses extension-less imports Node's ESM loader rejects, and supabase/functions/agent/index.ts calls
// Deno APIs at module scope. The alternative — keeping a hand-copied duplicate in the barrier — is a
// test that passes while production breaks (that exact failure happened on 2026-08-29 with
// extractPrice; see feedback_never-test-a-copy-of-production-code). Lifting the REAL source removes
// the drift class.
//
// LINE-BASED ON PURPOSE. A brace/paren walker desynchronises on these files: regex literals are full
// of (, [ and { that are DATA, not code (`[^\d]{0,16}?`, `(?![a-z])`). Every slice asserts it ended
// where expected, so a reformat fails loudly here instead of silently lifting the wrong text.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A declaration to lift: the line it starts on, and the line that ends it. */
export type Symbol = { header: string; endsWith?: RegExp };

function slice(src: string, header: string, endsWith: RegExp): string {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => l.startsWith(header));
  if (start < 0) throw new Error(`liftSymbols: no line starts with ${JSON.stringify(header)}`);
  for (let i = start; i < lines.length; i++) {
    if (endsWith.test(lines[i])) return lines.slice(start, i + 1).join("\n");
  }
  throw new Error(`liftSymbols: no terminator ${endsWith} after ${JSON.stringify(header)}`);
}

/**
 * Build a throwaway module from real declarations and import it.
 * `prelude` supplies types or tiny shims the lifted code closes over but that carry no logic.
 */
export async function liftSymbols(
  file: string, symbols: Symbol[], exportNames: string[], prelude = "",
): Promise<Record<string, unknown>> {
  const src = readFileSync(file, "utf8");
  const parts = [prelude];
  for (const s of symbols) {
    // Terminators are COLUMN-0 only. An earlier version accepted any line ending in `;`, which
    // stopped a multi-line arrow at its first body statement and produced unbalanced braces — the
    // lifted module then failed to parse, which at least failed loudly rather than lifting something
    // subtly wrong. A function ends at `}` in column 0; a const/arrow at `};` in column 0.
    const end = s.endsWith ?? (/^(export )?function /.test(s.header) ? /^\}$/ : /^\};$/);
    // Drop a leading `export` from the lifted declaration: we re-export explicitly at the bottom, and
    // keeping both is a duplicate-export syntax error.
    parts.push(slice(src, s.header, end).replace(/^export /, ""));
  }
  parts.push(`export { ${exportNames.join(", ")} };`);
  const dir = mkdtempSync(join(tmpdir(), "ezhalah-lift-"));
  // .mts, not .ts: the temp dir has no package.json, so Node would infer CommonJS for a bare .ts and
  // reject the `export` statements in the lifted declarations. The .mts extension is unambiguous ESM.
  const out = join(dir, "lifted.mts");
  writeFileSync(out, parts.join("\n\n"));
  const mod = await import(out);
  for (const n of exportNames) {
    if (mod[n] === undefined) throw new Error(`liftSymbols: ${n} was not produced by the lift`);
  }
  return mod as Record<string, unknown>;
}
