// The three card-identity matchers — SourceBadge (logo), sourceHost ("takes you to"), sourceName
// ("hosted on" + Read Aloud) — lifted from the SHIPPED source and executed, never re-implemented.
//
// All three must be checked, not one. 2026-09-20: عقاريون's badge had the Arabic alias, sourceName
// and sourceHost did not, so 280 live cards showed عقاريون's logo beside «مستضاف على عقار» and
// sa.aqar.fm. The live barrier checked sourceHost only; nothing checked sourceName at all.
//
// SourceBadge returns JSX, which Node cannot strip, so each `<Image source={X_LOGO} …/>` becomes the
// string 'X_LOGO'. The if-chain that decides identity runs untouched.
import { join } from 'node:path';
import { liftSymbols } from './liftSymbols.ts';

export type Matcher = (source: string) => string;
export type Matchers = { name: Matcher; host: Matcher; badge: Matcher };
export const MATCHER_KEYS = ['name', 'host', 'badge'] as const;

export async function liftPlatformMatchers(root: string): Promise<Matchers> {
  const rc = await liftSymbols(join(root, 'src/components/ResultCard.tsx'), [
    { header: 'function sourceHost' },
    { header: 'function SourceBadge', rewrite: (c) => c.replace(/<Image source=\{([A-Z0-9_]+)\}[^>]*\/>/g, "'$1'") },
  ], ['sourceHost', 'SourceBadge']);
  const ld = await liftSymbols(join(root, 'src/lib/listingDisplay.ts'),
    [{ header: 'export function sourceName' }], ['sourceName']);
  const badge = rc.SourceBadge as (p: { source: string }) => string;
  return { name: ld.sourceName as Matcher, host: rc.sourceHost as Matcher, badge: (s) => badge({ source: s }) };
}

/** What each matcher returns when NO branch matches — measured, not hardcoded, so a renamed
 *  fallback cannot make "did not land on the fallback" pass vacuously. It is Aqar's identity. */
export function fallbacksOf(m: Matchers): Record<keyof Matchers, string> {
  const nothing = String.fromCharCode(0); // a string no branch token can be a substring of
  return { name: m.name(nothing), host: m.host(nothing), badge: m.badge(nothing) };
}
