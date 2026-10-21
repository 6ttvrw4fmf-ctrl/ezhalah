// SECURITY PHASE 4.3 (2026-10-21): the front door (api/sb.ts) only ever opens onto /rest/v1, never trusts a caller's
// own claim about who they are, and the app routes through it only when switched on.
//
// EXECUTES the pure pieces (safeRestPath, visitorIp from api/sb.ts; frontDoorUrl from src/lib/supabase.ts) and reads
// the wiring (vercel.json rewrite, the forwarded-header list, the off-by-default switch). Mutations prove each check bites.
//   node --experimental-strip-types scripts/verify-front-door.ts   (discovered by `npm test`)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { liftSymbols } from './lib/liftSymbols.ts';

const root = join(import.meta.dirname, '..');
// Lifted, not imported: api/sb.ts pulls in botid/server and src/lib/supabase.ts the whole client.
const liftFrom = async (file: string) => liftSymbols(file, [{ header: 'export function safeRestPath(' }, { header: 'export function visitorIp(' }], ['safeRestPath', 'visitorIp']);
const sb = await liftFrom(join(root, 'api/sb.ts'));
const safeRestPath = sb.safeRestPath as (p: string | null) => string | null;
const visitorIp = sb.visitorIp as (h: Headers) => string;
const frontDoorUrl = (await liftSymbols(join(root, 'src/lib/supabase.ts'), [{ header: 'export function frontDoorUrl(' }], ['frontDoorUrl'])).frontDoorUrl as (t: string, b: string | undefined) => string | null;
const proxy = readFileSync(join(root, 'api/sb.ts'), 'utf8');
const client = readFileSync(join(root, 'src/lib/supabase.ts'), 'utf8');
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as { rewrites?: { source: string; destination: string }[] };
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

// 1. The path can only name a table or an rpc: nothing climbs out to auth, storage or another host.
const ok = ['search_listings_ar', 'rpc/location_search_candidates_ar', 'user_chats'];
const bad = ['', '../auth/v1/user', 'rpc/../../auth', 'a/b/c', 'search_listings_ar?x=1', '%2e%2e', null, 'x'.repeat(201)];
check('the front door opens only onto a table or rpc', ok.every((p) => safeRestPath(p) === p) && bad.every((p) => safeRestPath(p as string) === null),
  bad.filter((p) => safeRestPath(p as string) !== null).join(', '));

// 2. The visitor address is the one Vercel measured, and junk is dropped.
check('the visitor address comes from Vercel\'s own headers and junk is dropped',
  visitorIp(new Headers({ 'x-real-ip': '1.2.3.4' })) === '1.2.3.4'
  && visitorIp(new Headers({ 'x-forwarded-for': '5.6.7.8, 10.0.0.1' })) === '5.6.7.8'
  && visitorIp(new Headers({ 'x-real-ip': "1.2.3.4'; drop" })) === '');

// 3. A caller can never smuggle its own handshake or address through the door.
const passList = (/const PASS_REQUEST = \[([^\]]*)\]/.exec(proxy)?.[1] ?? '');
const noSmuggle = (s: string) => !/x-ezhalah-gate|x-ezhalah-client-ip|cf-connecting-ip|x-forwarded-for/i.test(s);
check('callers\' own x-ezhalah-gate / client-ip / forwarded headers are never passed on', passList.length > 0 && noSmuggle(passList));
check('the handshake is sent only with the server\'s secret', /if \(GATE && ip\) \{ headers\.set\('x-ezhalah-gate', GATE\)/.test(proxy));

// 4. Only REST calls are rerouted, and only when switched on.
const base = 'https://x.supabase.co';
check('only /rest/v1 calls go through the front door; auth and functions stay direct',
  frontDoorUrl(`${base}/rest/v1/search_listings_ar?select=a`, base) === '/sb/rest/v1/search_listings_ar?select=a'
  && frontDoorUrl(`${base}/auth/v1/token`, base) === null && frontDoorUrl(`${base}/functions/v1/agent`, base) === null);
check('the app uses the front door only when EXPO_PUBLIC_FRONT_DOOR is "1"', /export const FRONT_DOOR = process\.env\.EXPO_PUBLIC_FRONT_DOOR === '1';/.test(client));
const rw = (v: typeof vercel) => (v.rewrites ?? []).some((r) => r.source === '/sb/rest/v1/:ezsbpath*' && r.destination === '/api/sb?__p=:ezsbpath*');
check('vercel.json routes /sb/rest/v1/* to the front door', rw(vercel));
const dropsRewriteParams = (s: string) => /searchParams\.delete\('__p'\);\s*url\.searchParams\.delete\('ezsbpath'\);/.test(s);
check('the rewrite\'s own query parameters are dropped before forwarding (else PostgREST reads them as filters)', dropsRewriteParams(proxy));
mustCatch('the rewrite capture forwarded as a filter (PGRST100, seen live 2026-10-21)', !dropsRewriteParams(proxy.replace("url.searchParams.delete('ezsbpath');", '')));

const tmp = join(mkdtempSync(join(tmpdir(), 'fd-')), 'sb.ts');
writeFileSync(tmp, proxy.replace(String.raw`/^(rpc\/)?[A-Za-z0-9_]+$/`, '/^.+$/'));
const loose = (await liftFrom(tmp)).safeRestPath as (p: string | null) => string | null;
mustCatch('a path rule loose enough to climb to auth', loose('../auth/v1/user') !== null);
mustCatch('the proxy forwarding a caller-supplied handshake', !noSmuggle(passList + ", 'x-ezhalah-gate'"));
mustCatch('the rewrite removed', !rw({ rewrites: (vercel.rewrites ?? []).filter((r) => r.source !== '/sb/rest/v1/:ezsbpath*') }));

if (failed) { console.error(`\n❌ verify-front-door: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-front-door: the front door opens only onto /rest/v1 and trusts no caller\'s own claims.');
