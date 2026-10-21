// SECURITY PHASE 4.1 (owner-approved plan, 2026-10-21): hourly scrape alarm. Runs in .github/workflows/scrape-alarm.yml.
//
// Reads the past hour of API gateway logs (Supabase Management API, ClickHouse SQL), finds callers that pulled a
// bulk-download's worth of listing rows (scripts/lib/scrapeAlarm.ts), stores each one in ops_scrape_suspect
// (service_role only: the address never leaves the database) and raises a P2 alert per suspect carrying only country,
// city, network and device. Stamps ops_scrape_alarm_heartbeat on success; mon_detect_scrape_alarm_silent() alarms if
// that stamp goes stale.
//
// A FAILED LOG QUERY IS NOT "NOBODY IS SCRAPING" (AGENTS.md): any failure exits 1 without stamping the heartbeat.
import { CALLER_SQL, findSuspects, type CallerHour } from './lib/scrapeAlarm.ts';

const REF = 'aannarbkwcymrotzwdbo';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? '';
const URL_BASE = process.env.SUPABASE_URL || `https://${REF}.supabase.co`;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const die = (why: string): never => { console.error(`✗ scrape alarm could not run: ${why}`); process.exit(1); };
if (!TOKEN || !SERVICE) die('SUPABASE_ACCESS_TOKEN and SUPABASE_SERVICE_ROLE_KEY are required');

const end = new Date(); end.setUTCSeconds(0, 0);
const start = new Date(end.getTime() - 60 * 60 * 1000);
const q = new URLSearchParams({ sql: CALLER_SQL, iso_timestamp_start: start.toISOString(), iso_timestamp_end: end.toISOString() });
const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/analytics/endpoints/logs?${q}`, {
  headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(60_000),
}).catch((e) => die(`log query failed: ${(e as Error).message}`));
if (!res.ok) die(`log query http ${res.status}: ${(await res.text()).slice(0, 300)}`);
const body = await res.json().catch(() => die('log query returned no JSON')) as { result?: unknown; error?: unknown };
if (body.error || !Array.isArray(body.result)) die(`log query returned no rows array: ${JSON.stringify(body.error ?? body).slice(0, 300)}`);
const rows: CallerHour[] = (body.result as Record<string, unknown>[]).map((r) => ({
  ip: String(r.ip ?? ''), country: String(r.country ?? ''), city: String(r.city ?? ''), network: String(r.network ?? ''),
  user_agent: String(r.user_agent ?? ''), listing_rows: Number(r.listing_rows ?? 0), requests: Number(r.requests ?? 0),
  top_paths: Array.isArray(r.top_paths) ? (r.top_paths as string[]) : [],
}));
const knownIps = (process.env.SCRAPE_ALARM_KNOWN_IPS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const suspects = findSuspects(rows, knownIps);

const rest = (path: string, init: RequestInit) => fetch(`${URL_BASE}/rest/v1/${path}`, {
  ...init, signal: AbortSignal.timeout(30_000),
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' },
}).then(async (r) => { if (!r.ok) die(`${path} http ${r.status}: ${(await r.text()).slice(0, 200)}`); return r; });

for (const s of suspects) {
  await rest('ops_scrape_suspect', { method: 'POST', body: JSON.stringify({
    window_start: start.toISOString(), ip: s.ip, country: s.country, city: s.city, network: s.network,
    user_agent: s.user_agent, listing_rows: s.listing_rows, requests: s.requests, top_paths: s.top_paths }) });
  // The dedup key is a short hash, so the alert never carries the address itself.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s.ip));
  const tag = Array.from(new Uint8Array(digest)).slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
  await rest('rpc/mon_raise', { method: 'POST', body: JSON.stringify({
    p_sev: 'P2', p_kind: 'scrape_suspect', p_platform: 'all', p_dedup: `scrape_suspect:${tag}`,
    p_detail: {
      why: `One caller pulled ${s.listing_rows.toLocaleString('en')} listing rows in ${s.requests.toLocaleString('en')} requests in one hour `
        + '(bar: 50,000 rows or 6,000 requests). This measures volume, not intent: rule out our own robots first.',
      country: s.country, city: s.city, network: s.network, device: s.user_agent, top_paths: s.top_paths,
      window_start: start.toISOString(),
      lookup: `select * from ops_scrape_suspect where window_start = '${start.toISOString()}' order by listing_rows desc;`,
    } }) });
}
await rest('ops_scrape_alarm_heartbeat?id=eq.1', { method: 'PATCH', body: JSON.stringify({
  last_ok_at: new Date().toISOString(), callers_seen: rows.length, suspects: suspects.length, note: null }) });

console.log(`scrape alarm: ${rows.length} heavy-ish caller(s) in the hour, ${suspects.length} over the bar.`);
for (const s of suspects) console.log(`  ⚠ ${s.country} ${s.city} · ${s.network} · ${s.listing_rows} rows / ${s.requests} req`);
