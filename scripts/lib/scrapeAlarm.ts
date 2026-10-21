// SECURITY PHASE 4.1: the scrape alarm's decision, kept pure so verify-scrape-alarm.ts can execute it.
// One row per caller (address) for the past hour, aggregated from the API gateway logs by CALLER_SQL below.

export type CallerHour = {
  ip: string; country: string; city: string; network: string; user_agent: string;
  listing_rows: number; requests: number; top_paths: string[];
};

// Measured 24 h to 2026-10-21 on listing paths: real browsers peak in the hundreds of rows an hour; our own Claude
// cloud sessions (Google Cloud) ~27,000. The bar sits clear of both. A full-catalogue copy is several hundred
// thousand rows, so a scraper that wants the inventory in under a day crosses it.
export const ROWS_PER_HOUR = 50_000;
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
group by ip
having listing_rows >= 5000 or requests >= 1000
order by listing_rows desc
limit 200`;
