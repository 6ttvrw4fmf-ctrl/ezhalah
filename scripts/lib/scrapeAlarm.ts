// SECURITY PHASE 4.1: the scrape alarm's decision, kept pure so verify-scrape-alarm.ts can execute it.
// One row per caller (address) for the past hour, aggregated from the API gateway logs by CALLER_SQL below.

export type CallerHour = {
  ip: string; country: string; city: string; network: string; user_agent: string;
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

// Front-door traffic (api/sb.ts, from Vercel on Amazon's network, x-client-info "ezhalah-front-door") is every visitor
// summed under a few server addresses, so it is NOT judged here: blocking those addresses would block everyone. The
// front door forwards each visitor's real address to robot_gate instead (20261021120255). STATED GAP until a per-visitor
// count exists for front-door traffic: a scraper using the front door is caught by BotID, not by this alarm.
// Rows per response come from content-range ("0-999/*" is 1000 rows). Listing paths only: the location catalogue
// (location_index_live, ~14k rows) is loaded whole by every visitor and is not inventory.
export const CALLER_SQL = `
select log_attributes['request.headers.cf_connecting_ip'] as ip,
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
  and not (log_attributes['request.headers.x_client_info'] like '%ezhalah-front-door%' and log_attributes['request.cf.asOrganization'] ilike '%amazon%')
group by ip
having listing_rows >= 5000 or requests >= 1000
order by listing_rows desc
limit 200`;
