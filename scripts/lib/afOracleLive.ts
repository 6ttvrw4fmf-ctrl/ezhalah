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
