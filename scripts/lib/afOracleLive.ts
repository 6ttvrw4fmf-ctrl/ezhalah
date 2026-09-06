// The ONE live read the independent oracle needs for directions — kept out of afOracleFilter.ts so
// that module stays pure (no I/O) and mutation-provable in `npm test`.
//
// WHY A LIVE READ. The clause compares norm_direction_ar() on both sides; the index stores «شمال
// شرقي» beside «شمال شرق». The oracle refuses to reproduce norm_direction_ar() (it would then depend
// on our own SQL), so it needs the OBSERVED spellings instead, mapped by Arabic morphology alone
// (directionVariantsFrom). Two cheap requests give exactly that, plus a refusal guard:
//   1. which of the 16 candidate spellings (8 keys × {plain, +ي}) actually occur;
//   2. whether ANY other non-null spelling occurs — if so, the domain has a ninth bucket nobody has
//      classified, and the honest answer is `null` (refuse) rather than a map that undercounts.
import { CANONICAL_DIRECTIONS, directionVariantsFrom } from './afOracleFilter.ts';

export async function loadDirectionVariants(
  rest: string,
  headers: Record<string, string>,
  table = 'search_listings_ar',
): Promise<{ map: Record<string, string[]> | null; observed: string[]; strangers: number }> {
  const candidates = CANONICAL_DIRECTIONS.flatMap((k) => [k, `${k}ي`]);
  const enc = (s: string) => encodeURIComponent(`"${s}"`);
  const count = async (qs: string): Promise<number> => {
    const r = await fetch(`${rest}/rest/v1/${table}?select=listing_id&${qs}`,
      { headers: { ...headers, Prefer: 'count=exact', Range: '0-0' } });
    if (!r.ok) throw new Error(`direction probe REST ${r.status}`);
    const cr = r.headers.get('content-range') || '';
    return cr.includes('/') ? Number(cr.split('/')[1]) : NaN;
  };
  const observed: string[] = [];
  for (const c of candidates) if ((await count(`direction_ar=eq.${encodeURIComponent(c)}`)) > 0) observed.push(c);
  const strangers = await count(`direction_ar=not.is.null&direction_ar=not.in.(${candidates.map(enc).join(',')})`);
  const map = strangers === 0 ? directionVariantsFrom(observed) : null;
  return { map, observed, strangers };
}

/**
 * The reference read the oracle needs for p_cities: requested city name → the catalogue city_ids
 * production resolves it to.
 *
 * WHY IT EXISTS (routine #9 red team, 2026-09-06). The live clause matches a city three ways —
 * `normalize_ar(s.city_ar) = any(city_tokens)` OR `s.city_id = any(city_ids)` OR
 * `s.match_city_ids && city_ids` — where city_ids is `loc_catalog_city.city_norm` UNION
 * `loc_catalog_city_alias.alias_norm`. The oracle used to emit only the label arm, which undercounts
 * every aliased city (measured: 6,021 rows across the الهفوف/الاحساء twin pair) while silently
 * agreeing with production on every un-aliased one.
 *
 * normalize_ar() is deliberately NOT reproduced here — that would make the "independent" oracle
 * depend on a guess about our own SQL, the one thing this module must never do. Instead the
 * requested LABEL is looked up in the catalogue to obtain its stored `city_norm`, and that value —
 * the server's own normalisation, read rather than recomputed — drives both id lookups.
 *
 * A name the catalogue does not carry verbatim is simply absent from the map, and buildOracleQS then
 * REFUSES the request (`unhandled`) rather than emitting the label arm alone.
 */
export async function loadCityScope(
  rest: string,
  headers: Record<string, string>,
  names: readonly string[],
): Promise<Record<string, number[]>> {
  const out: Record<string, number[]> = {};
  const get = async (path: string) => {
    const r = await fetch(`${rest}/rest/v1/${path}`, { headers });
    if (!r.ok) throw new Error(`city scope probe REST ${r.status} on ${path}`);
    return r.json() as Promise<Array<Record<string, unknown>>>;
  };
  for (const name of new Set(names)) {
    const norms = await get(`loc_catalog_city?select=city_norm&city_ar=eq.${encodeURIComponent(name)}`);
    if (!norms.length) continue;                       // not catalogued → left out, so the caller refuses
    const ids = new Set<number>();
    for (const n of new Set(norms.map((x) => String(x.city_norm)))) {
      const q = encodeURIComponent(n);
      for (const r of await get(`loc_catalog_city?select=city_id&city_norm=eq.${q}`)) ids.add(Number(r.city_id));
      for (const r of await get(`loc_catalog_city_alias?select=city_id&alias_norm=eq.${q}`)) ids.add(Number(r.city_id));
    }
    out[name] = [...ids].sort((a, b) => a - b);
  }
  return out;
}
