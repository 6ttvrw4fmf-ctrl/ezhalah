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
check('the app uses the front door unless the kill switch EXPO_PUBLIC_FRONT_DOOR=0 is set', /export const FRONT_DOOR = process\.env\.EXPO_PUBLIC_FRONT_DOOR !== '0';/.test(client));
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

// 5. Cloudflare Turnstile (owner 2026-10-21): only our server can mint the one-hour human pass, and it cannot be
//    stretched, forged or reused under another key. EXECUTED against api/_humanPass.ts.
const hp = await import('../api/_humanPass.ts');
const now = 1_800_000_000;
const pass = await hp.mintHumanPass(now, 'k-secret');
const [exp, sig] = pass.split('.');
const flipped = `${exp}.${sig.slice(0, -1)}${sig.endsWith('0') ? '1' : '0'}`;
const passOk = (await hp.humanPassValid(pass, now + 10, 'k-secret'))
  && !(await hp.humanPassValid(pass, now + hp.HUMAN_PASS_SECONDS + 1, 'k-secret'))   // expired
  && !(await hp.humanPassValid(pass, now + 10, 'other-key'))                          // another key
  && !(await hp.humanPassValid(flipped, now + 10, 'k-secret'))                        // forged signature
  && !(await hp.humanPassValid(`${Number(exp) + 86_400}.${sig}`, now + 10, 'k-secret')) // stretched expiry
  && !(await hp.humanPassValid('', now, 'k-secret'));
check('the human pass is minted only by our key, expires in an hour and cannot be forged or stretched', passOk);
check('the pass cookie is read, never forwarded to the database', /humanPassValid\(readCookie\(request\.headers\.get\('cookie'\)/.test(proxy) && !/'cookie'/.test(passList));
check('Turnstile starts only with the front door, invisibly, with our site key',
  /if \(webFront\) \{[\s\S]{0,600}startTurnstile\(\);\s*\}/.test(client) && /render=explicit/.test(client) && /TURNSTILE_SITE_KEY = '0x4[A-Za-z0-9_-]+'/.test(client));
mustCatch('the cookie forwarded upstream', /'cookie'/.test(passList + ", 'cookie'"));
mustCatch('a pass accepted without checking the signature', await (async () => {
  const loose = async (v: string) => /^(\d+)\.[0-9a-f]{64}$/.test(v);   // what a signature-blind check would do
  return (await loose(flipped)) !== (await hp.humanPassValid(flipped, now + 10, 'k-secret'));
})());

// 6. ON for everyone (owner 2026-10-21): a reply is used only if OUR front door sent it. A build with no /sb route
//    (CI's local server, a preview) answers 404 without x-ezhalah-bot and must fall back to the direct call, or every
//    search there fails. EXECUTED.
const answered = (await liftSymbols(join(root, 'src/lib/supabase.ts'), [{ header: 'export function frontDoorAnswered(' }], ['frontDoorAnswered']))
  .frontDoorAnswered as (s: number, f: boolean) => boolean;
check('only our front door\'s own replies are used; a missing route or a gateway failure falls back to direct',
  answered(200, true) && answered(206, true) && answered(401, true) && !answered(404, false) && !answered(200, false)
  && !answered(502, true) && !answered(503, true) && !answered(504, true));
const blindCopy = join(mkdtempSync(join(tmpdir(), 'fd-')), 'supabase.ts');
writeFileSync(blindCopy, client.replace('return fromFrontDoor && status', 'return status'));
const blind = (await liftSymbols(blindCopy, [{ header: 'export function frontDoorAnswered(' }], ['frontDoorAnswered'])).frontDoorAnswered as (s: number, f: boolean) => boolean;
mustCatch('a 404 from a build with no front door treated as an answer', blind(404, false) === true);

// 7. The door and both guards run ONLY on the real site: Turnstile throws error 110200 on any other host, and that
//    uncaught error broke CI's built-app search journey on 2026-10-21. Local/CI/preview builds stay direct.
const hostMod = await liftSymbols(join(root, 'src/lib/supabase.ts'),
  [{ header: 'export const FRONT_DOOR_HOSTS', endsWith: /;$/ }, { header: 'export const FRONT_DOOR_DEPLOYMENT_HOST', endsWith: /;$/ },
    { header: 'export function frontDoorHost(', endsWith: /\}$/ }], ['frontDoorHost']);
const onHost = hostMod.frontDoorHost as (h: string) => boolean;
check('the front door runs on the real site only, never on localhost, CI or previews',
  onHost('ezhalah-app.vercel.app') && onHost('ezhalah.com') && onHost('www.ezhalah.com') && !onHost('evil-ezhalah.com') && !onHost('localhost') && !onHost('127.0.0.1') && onHost('ezhalah-a71gaft2d-enzalah.vercel.app') && onHost('ezhalah-app-git-fix-x-enzalah.vercel.app') && !onHost('ezhalah-a71gaft2d-evil.vercel.app') && !onHost('evil-ezhalah-a71gaft2d-enzalah.vercel.app') && !onHost('ezhalah-a71gaft2d-enzalah.vercel.app.evil.com')
  && /&& frontDoorHost\(window\.location\?\.hostname \?\? ''\);/.test(client));
check('a Turnstile failure can never become an uncaught page error', /'error-callback': \(\) => true/.test(client));
mustCatch('the host gate removed from the switch', !/&& frontDoorHost\(window\.location\?\.hostname \?\? ''\);/.test(client.replace("\n  && frontDoorHost(window.location?.hostname ?? '');", ';')));

// 8. The log labels name a coarse device class and country, never the address or the full user agent (2026-10-22:
//    needed to tell real visitors the guards mislabel from robots, before any guard may refuse anyone).
const lab = await liftSymbols(join(root, 'api/sb.ts'), [{ header: 'export function doorLabels(' }, { header: 'export function deviceClass(' }], ['doorLabels', 'deviceClass']);
const deviceClass = lab.deviceClass as (ua: string) => string;
const doorLabels = lab.doorLabels as (b: string, h: string, r: boolean, ua?: string, cc?: string) => string;
check('device classes: headless robots, iPhone, Android, desktop',
  deviceClass('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/151') === 'headless'
  && deviceClass('Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)') === 'iphone'
  && deviceClass('Mozilla/5.0 (Linux; Android 14; SM-S918B)') === 'android'
  && deviceClass('Mozilla/5.0 (Windows NT 10.0; Win64; x64)') === 'desktop'
  && deviceClass('curl/8.5.0') === 'other');
const sample = doorLabels('human', 'pass', false, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7) 70.162.170.16', 'SA');
check('the labels never carry the address or the raw user agent', sample === 'bot=human ts=pass robot=0 dev=iphone cc=SA'
  && doorLabels('bot', 'none', false, '', 'not-a-country') === 'bot=bot ts=none robot=0 dev=other cc=--', sample);
mustCatch('a label leaking the raw user agent', !/^bot=\S+ ts=\S+ robot=[01] dev=[a-z]+ cc=(?:[A-Z]{2}|--)$/.test(`${sample} ua=Mozilla/5.0`));

if (failed) { console.error(`\n❌ verify-front-door: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-front-door: the front door opens only onto /rest/v1 and trusts no caller\'s own claims.');
