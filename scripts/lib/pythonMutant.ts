// Execute a REAL python symbol, and the same symbol from a MUTATED copy of its module.
//
// Why this exists: the repo's strongest rule about barriers is that they must EXECUTE the code they
// protect, and its second strongest is never to test a re-implementation (AGENTS.md). For the
// TypeScript side `scripts/lib/liftSymbols.ts` does that job. The scrapers are Python, and several
// of the defects that reached production live there — so the same discipline needs the same tool.
//
// The mutant is compiled into a throwaway module namespace seeded from the REAL module's globals,
// so imports, constants and helpers resolve exactly as they do in production. `__file__` is carried
// over because scraper modules read it at import time.
import { execFileSync } from 'node:child_process';

const RUNNER = `
import json, sys, types
sys.path.insert(0, sys.argv[1])
import importlib
realmod = importlib.import_module(sys.argv[2])
payload = json.loads(sys.stdin.read())
mod = realmod
if payload.get('mutated_source'):
    mod = types.ModuleType('mutant')
    mod.__dict__.update({k: v for k, v in realmod.__dict__.items() if not k.startswith('__')})
    mod.__dict__['__file__'] = realmod.__file__
    mod.__dict__['__name__'] = 'mutant'
    exec(compile(payload['mutated_source'], 'mutant.py', 'exec'), mod.__dict__)
fn = getattr(mod, payload['fn'])
print(json.dumps([fn(*a) for a in payload['calls']], default=str))
`;

/** Call `fn(...args)` for each arg-tuple, against the real module or a mutated copy of its source. */
export function pyCall(
  root: string, module: string, fn: string, calls: unknown[][], mutatedSource?: string,
): unknown[] {
  return JSON.parse(execFileSync('python3', ['-c', RUNNER, root, module], {
    input: JSON.stringify({ fn, calls, mutated_source: mutatedSource ?? null }),
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  }));
}
