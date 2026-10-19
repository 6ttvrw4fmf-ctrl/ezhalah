// THE REAL LOCATION RESOLVER, RUNNABLE IN NODE. src/data/locations.ts imports the app's supabase
// client and i18n (React Native); this bundles it with esbuild, stubbing supabase to serve `rows` as
// the `location_index_live` table and i18n to its one constant, then loads the index. Used by the
// hermetic barrier (fixture rows) and the nightly sweep (production rows) — same code, two shelves.
import { build } from 'esbuild';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

export type IndexRow = { city: string; district: string | null; region: string | null; n: number };
export type Resolution = { kind: string; districts: string[]; city: string; cities: string[]; label: string; exact?: boolean };
export type Resolver = {
  resolveLocation: (s: string, locale: string) => Resolution;
  liveShelfCount: (lm: Resolution, districts?: string[]) => number | null;
};

export async function bundleResolver(srcRoot: string, rows: IndexRow[]): Promise<Resolver> {
  const stubs: Record<string, string> = {
    '@/lib/supabase': `const rows = ${JSON.stringify(rows)}; export const supabase = { from: () => ({ select: () => ({ abortSignal: async () => ({ data: rows, error: null }) }) }) };`,
    '@/i18n': `export const LOCATION_UNRESOLVED_AR = 'غير محدد';`,
  };
  const out = await build({
    stdin: { contents: `export { ensureLocationIndex, resolveLocation, liveShelfCount } from './data/locations.ts';`, resolveDir: join(srcRoot, 'src'), loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    plugins: [{
      name: 'stubs+alias',
      setup(b) {
        b.onResolve({ filter: /^@\// }, (a) => (a.path in stubs
          ? { path: a.path, namespace: 'stub' }
          : { path: join(srcRoot, 'src', a.path.slice(2)) + (/\.\w+$/.test(a.path) ? '' : '.ts') }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubs[a.path], loader: 'js' }));
      },
    }],
  });
  const file = join(mkdtempSync(join(tmpdir(), 'resolver-')), 'resolver.mjs');
  writeFileSync(file, out.outputFiles[0].text);
  const mod = await import(pathToFileURL(file).href);
  await mod.ensureLocationIndex();
  return mod as Resolver;
}
