// Load the REAL alreadyRestates()/RESTATE_OPENER_* out of src/data/agent.ts and make it callable
// under Node, mirroring scripts/lib/extractRealLocClassify.ts / extractRealExtractPrice.ts — a
// hand-copied duplicate would drift the instant the real regex changed and prove nothing about
// production (see [[feedback_never-test-a-copy-of-production-code]]).
//
// src/data/agent.ts transitively imports '@/i18n' (a .tsx file — JSX, unimportable under plain
// Node type-stripping) and 'react-native'/expo modules via its other imports, so it cannot be
// imported directly. alreadyRestates() itself has zero dependencies (pure regex over a string), so
// this lifts just that declaration — no stand-ins needed, unlike locClassify's Deno-env consts.
//
// Extraction is LINE-BASED on purpose: a brace/paren walker desyncs on regex literals whose `(`/`{`
// are data, not code (both RESTATE_OPENER_* regexes contain literal parens and brackets).
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function slice(src: string, header: string, endsWith: RegExp): string {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => l.startsWith(header));
  if (start < 0) throw new Error(`extractRealAgentRestate: no line starts with ${JSON.stringify(header)}`);
  for (let i = start; i < lines.length; i++) {
    if (endsWith.test(lines[i])) return lines.slice(start, i + 1).join('\n');
  }
  throw new Error(`extractRealAgentRestate: no terminator ${endsWith} after ${header}`);
}

export type AgentRestateModule = { alreadyRestates: (reply: string) => boolean };

export async function loadRealAlreadyRestates(): Promise<AgentRestateModule> {
  const root = resolve(new URL('../..', import.meta.url).pathname);
  const src = readFileSync(join(root, 'src/data/agent.ts'), 'utf8');
  const parts = [
    slice(src, 'const RESTATE_OPENER_AR', /;\s*$/),
    slice(src, 'const RESTATE_OPENER_EN', /;\s*$/),
    slice(src, 'function alreadyRestates(', /^\}$/),
    'export { alreadyRestates };',
  ];
  const dir = mkdtempSync(join(tmpdir(), 'ezhalah-restate-'));
  const file = join(dir, 'real.ts');
  writeFileSync(file, parts.join('\n\n'));
  const mod = await import(file);
  if (typeof mod.alreadyRestates !== 'function') {
    throw new Error('extractRealAgentRestate: extraction produced no callable alreadyRestates');
  }
  return mod as AgentRestateModule;
}

/** The exact call-site line in respond() that must gate withRestate() on this real function. */
export function callSiteWiresAlreadyRestates(agentTsSrc: string): boolean {
  return /if\s*\(\s*backend\.kind === 'listings' && !loggedIn && !alreadyRestates\(backend\.reply\)\s*\)\s*\{\s*\n\s*backend\.reply = withRestate\(v, backend\.reply\);/.test(
    agentTsSrc,
  );
}
