// SECURITY PHASE 4.1: the scrape alarm's decision, kept pure so verify-scrape-alarm.ts can execute it.
import { createHmac } from 'node:crypto';
// One row per caller (address) for the past hour, aggregated from the API gateway logs by CALLER_SQL below.

export type CallerHour = {
  ip: string; hour: string; country: string; city: string; network: string; user_agent: string;
  listing_rows: number; requests: number; top_paths: string[];
};

// OWNER DECISION 2026-10-21: block automatically for 24 h at 100,000 rows an hour, lower it later. Measured 24 h to
// 2026-10-21 on listing paths: the busiest real visitor pulled 8,009 rows in an hour (each search loads ~1,000 rows),
// our own Claude cloud sessions (Google Cloud) ~27,000. The owner asked about 5,000 and 10,000; both would block real
// searchers today. Lower this only after searches load small batches (docs/ops/SCRAPE_GUARD.md).
export const ROWS_PER_HOUR = 100_000;
export const REQUESTS_PER_HOUR = 6_000;

// GitHub-hosted runners (our CI, on Microsoft's network) are excluded. This is a STATED GAP, not a claim: a scraper on
// Azure is invisible to this alarm until our CI moves to our own server (docs/ops/OWN_SERVER_RUNNERS.md), at which
// point this exclusion goes. Anthropic = our Claude sessions.
export const OWN_NETWORKS = [/microsoft/i, /anthropic/i];

// knownIps: the owner's own machines (repo variable SCRAPE_ALARM_KNOWN_IPS, comma-separated). Measured 2026-10-21 03:00
// UTC: the only non-CI caller over the bar was the owner's home connection running our local robots (385,616 rows).
export function findSuspects(rows: CallerHour[], knownIps: string[] = []): CallerHour[] {
  return rows
    .filter((r) => r.ip && !knownIps.includes(r.ip) && !OWN_NETWORKS.some((re) => re.test(r.network ?? '')))
    .filter((r) => r.listing_rows >= ROWS_PER_HOUR || r.requests >= REQUESTS_PER_HOUR)
    .sort((a, b) => b.listing_rows - a.listing_rows);
}

// Front-door traffic (api/sb.ts, from Vercel's few server addresses) is judged PER VISITOR (2026-10-27): the door stamps
// «vid=<16 hex>», a scrambled code of the visitor's address (HMAC with the front-door secret, never the address), and the
// caller key becomes 'vid:<code>'. A block on 'vid:<code>' reaches that visitor through robot_gate
// (guard.visitor_code). The LAST vid= / robot= in x-client-info is the door's own (it appends after the client's), so a
// client cannot frame another code or pass as our robot. Front-door rows with no code (an older door) or robot=1 (our
// own browser robots) are not judged.
// ONE ROW PER CALLER PER HOUR, over every hour since the last successful run (2026-10-23: GitHub runs this "hourly"
// schedule only every 3-5 hours, so a one-hour window left gaps a copier could use). The bar stays per hour.
// Rows per response come from content-range ("0-999/*" is 1000 rows). Listing paths only: the location catalogue
// (location_index_live, ~14k rows) is loaded whole by every visitor and is not inventory.
export const CALLER_SQL = `
select if(log_attributes['request.headers.x_client_info'] like '%ezhalah-front-door%',
    concat('vid:', arrayElement(extractAll(log_attributes['request.headers.x_client_info'], 'vid=([0-9a-f]{16})'), -1)),
    log_attributes['request.headers.cf_connecting_ip']) as ip,
  toStartOfHour(timestamp) as hour,
  any(log_attributes['request.cf.country']) as country,
  any(log_attributes['request.cf.city']) as city,
  any(log_attributes['request.cf.asOrganization']) as network,
  any(substring(log_attributes['request.headers.user_agent'], 1, 120)) as user_agent,
  sum(if(log_attributes['response.headers.content_range'] like '%-%',
    toInt64OrZero(extract(log_attributes['response.headers.content_range'], '^[0-9]+-([0-9]+)'))
    - toInt64OrZero(extract(log_attributes['response.headers.content_range'], '^([0-9]+)-')) + 1, 0)) as listing_rows,
  count() as requests,
  topK(3)(splitByChar('?', log_attributes['request.path'])[1]) as top_paths
from logs
where source = 'edge_logs'
  and (log_attributes['request.path'] like '/rest/v1/%listings%' or log_attributes['request.path'] like '/rest/v1/rpc/location_search%')
  and not (log_attributes['request.headers.x_client_info'] like '%ezhalah-front-door%'
    and (arrayElement(extractAll(log_attributes['request.headers.x_client_info'], 'vid=([0-9a-f]{16})'), -1) = ''
      or arrayElement(extractAll(log_attributes['request.headers.x_client_info'], 'robot=([01])'), -1) = '1'))
group by ip, hour
having listing_rows >= 5000 or requests >= 1000
order by listing_rows desc
limit 200`;

/** A front-door visitor's caller key: 'vid:' + the first 16 hex of HMAC-SHA256(secret, address) — byte-identical to
 *  api/sb.ts visitorCode() and guard.visitor_code(). '' without both. */
export function visitorKey(ip: string, secret: string): string {
  return ip && secret ? `vid:${createHmac('sha256', secret).update(ip).digest('hex').slice(0, 16)}` : '';
}
/** Known callers: each address, plus its front-door code when the secret is present. */
export function knownCallerKeys(ips: string[], secret: string): string[] {
  const clean = ips.map((s) => s.trim()).filter(Boolean);
  return [...clean, ...clean.map((ip) => visitorKey(ip, secret)).filter(Boolean)];
}

/** Where a run's window starts: the hour of the last successful run, between 1 and 24 hours back (the log API's limit).
 *  An unreadable last run means the full 24 hours, never a smaller window. */
export function catchUpStart(lastOk: Date | null, end: Date): Date {
  const maxBack = end.getTime() - 24 * 3600 * 1000 + 60 * 1000;
  const minBack = end.getTime() - 3600 * 1000;
  const from = lastOk && !Number.isNaN(lastOk.getTime()) ? Math.floor(lastOk.getTime() / 3600_000) * 3600_000 : maxBack;
  return new Date(Math.min(minBack, Math.max(maxBack, from)));
}

/** The log row's hour («2026-10-23 03:00:00») as ISO, or the run's start if it cannot be read. */
export function hourIso(hour: string, fallback: Date): string {
  const d = new Date(`${hour.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? fallback.toISOString() : d.toISOString();
}
