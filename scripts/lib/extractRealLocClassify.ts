// Load the REAL locClassify()/locClassifyOnce() out of supabase/functions/agent/index.ts and make
// them callable under Node, with `fetch` left as a normal global so a test can mock it.
//
// WHY THIS EXISTS. The 2026-08-31 loc_classify incident shipped a fail-CLOSED rewrite (bounded
// AbortController timeout, one retry, a LOC_CLASSIFY_FAILED sentinel distinct from a normal `null`)
// specifically so a genuine RPC failure can never again be silently treated as "unambiguous". A
// barrier that re-typed this logic as a copy would drift the instant the real function changed and
// prove nothing about production — see scripts/lib/extractRealExtractPrice.ts, the established
// pattern this mirrors exactly, and [[feedback_never-test-a-copy-of-production-code]].
//
// The edge function calls Deno APIs (Deno.env.get) at module scope, so it cannot be imported
// directly under Node. We lift only the declarations locClassify closes over, substituting inert
// stand-ins for the two Deno-env consts it reads (SUPABASE_URL, SERVICE_KEY are just string values
// baked into the fetch call the test mocks — swapping them for literals changes no logic).
//
// Extraction is LINE-BASED on purpose, same reasoning as extractRealExtractPrice.ts: a brace/paren
// walker desyncs on regex literals whose `(`/`{` are data, not code. Every slice asserts where it
// ends, so a reformat of index.ts fails this loudly instead of silently extracting the wrong text.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Slice from the line starting with `header` through the first line matching `endsWith`. */
function slice(src: string, header: string, endsWith: RegExp): string {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => l.startsWith(header));
  if (start < 0) throw new Error(`extractRealLocClassify: no line starts with ${JSON.stringify(header)}`);
  for (let i = start; i < lines.length; i++) {
    if (endsWith.test(lines[i])) return lines.slice(start, i + 1).join("\n");
  }
  throw new Error(`extractRealLocClassify: no terminator ${endsWith} after ${header}`);
}

export type LocClassifyModule = {
  locClassify: (token: string) => Promise<Record<string, unknown> | null | symbol>;
  LOC_CLASSIFY_FAILED: symbol;
  LOC_CLASSIFY_TIMEOUT_MS: number;
};

export async function loadRealLocClassify(): Promise<LocClassifyModule> {
  const root = resolve(new URL("../..", import.meta.url).pathname);
  const src = readFileSync(join(root, "supabase/functions/agent/index.ts"), "utf8");
  const parts = [
    // Stand-ins for the two Deno-env consts locClassifyOnce reads — inert string values, not logic.
    'const SUPABASE_URL = "https://example.test";',
    'const SERVICE_KEY = "test-service-key";',
    slice(src, "const LOC_CLASSIFY_TIMEOUT_MS", /;\s*$/),
    slice(src, "const LOC_CLASSIFY_FAILED", /;\s*$/),
    slice(src, "async function locClassifyOnce(", /^\}$/),
    slice(src, "async function locClassify(", /^\}$/),
    "export { locClassify, LOC_CLASSIFY_FAILED, LOC_CLASSIFY_TIMEOUT_MS };",
  ];
  const dir = mkdtempSync(join(tmpdir(), "ezhalah-locclassify-"));
  const file = join(dir, "real.ts");
  writeFileSync(file, parts.join("\n\n"));
  const mod = await import(file);
  if (typeof mod.locClassify !== "function") {
    throw new Error("extractRealLocClassify: extraction produced no callable locClassify");
  }
  if (typeof mod.LOC_CLASSIFY_FAILED !== "symbol") {
    throw new Error("extractRealLocClassify: LOC_CLASSIFY_FAILED did not extract as a symbol");
  }
  return mod as LocClassifyModule;
}
