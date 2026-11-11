// THE FILTER'S REAL REQUEST BUILDERS, RUNNABLE IN NODE. src/data/remote.ts imports the app's supabase client, i18n
// and the error reporter (React Native); this bundles it with esbuild, stubbing those three, so a barrier can EXECUTE
// mapTypeScope() and the map's pinFilterOf() exactly as the browser runs them.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

export type MapScope = { types: string[] | null; tables: string[] | null; tables2: string[] | null; types2: string[] | null; macro: 'Residential' | 'Commercial' | null };
export type MapScopeModule = {
  mapTypeScope: (category: 'Residential' | 'Commercial', types: string[]) => MapScope;
  pinFilterOf: (f: unknown, typeAr: unknown, members: unknown, deals: readonly string[], scopeOf: unknown) => Record<string, unknown>;
  rpcArgs: (box: unknown, cell: number, f: unknown, limit?: number) => Record<string, unknown>;
  bedsOffered: (f: { category: string | null; groups: string[] }) => boolean;
  typeArForTypes: (types: string[]) => string[] | null;
  groupMembers: (group: string) => string[];
  rpcAllNarrowingParams?: (q: unknown) => Record<string, unknown>;
  mapFilterSearchQuery?: (f: unknown, deals: readonly string[]) => Record<string, unknown> | null;
  noPinArgs?: (box: unknown, f: unknown, limit?: number) => Record<string, unknown>;
};

export async function bundleMapScope(srcRoot: string): Promise<MapScopeModule> {
  // i18n: every name the real file exports, as a pass-through (the scope builders read no translated text).
  const names = [...new Set([...readFileSync(join(srcRoot, 'src/i18n.tsx'), 'utf8').matchAll(/^export (?:const|function|let) (\w+)/gm)].map((x) => x[1]))];
  const i18nStub = names.map((n) => (/_AR$/.test(n) ? `export const ${n} = 'غير محدد';` : `export const ${n} = (a) => a;`)).join('\n');
  const stubs: Record<string, string> = {
    '@/lib/supabase': `export const supabase = { from: () => ({}), rpc: async () => ({ data: null, error: null }) };`,
    '@/i18n': i18nStub,
    '@/lib/observability': `export const reportMessage = () => {}; export const reportError = () => {};`,
  };
  const out = await build({
    stdin: {
      contents: `export { mapTypeScope, rpcAllNarrowingParams, mapFilterSearchQuery } from './data/remote.ts'; export { noPinArgs } from './lib/mapNoPin.ts'; export { pinFilterOf, bedsOffered } from './lib/mapFilter.ts'; export { rpcArgs } from './lib/mapPins.ts'; export { typeArForTypes, groupMembers, groupsFor } from './data/propertyTypes.ts';`,
      resolveDir: join(srcRoot, 'src'), loader: 'ts',
    },
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    loader: { '.json': 'json' },
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
  const file = join(mkdtempSync(join(tmpdir(), 'mapscope-')), 'mapscope.mjs');
  writeFileSync(file, out.outputFiles[0].text);
  return (await import(pathToFileURL(file).href)) as MapScopeModule;
}
