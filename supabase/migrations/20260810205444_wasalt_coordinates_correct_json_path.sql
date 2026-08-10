-- Wasalt coordinates: the path I used did not exist, so ~9,600 listings lost their exact location.
--
-- I guessed `ar_data->>'latitude'` / `ar_data->>'longitude'`. Neither key is present. Read off the
-- live payload this time rather than guessed twice:
--     ar_data -> 'location' ->> 'lat'
--     ar_data -> 'location' ->> 'lon'     <- 'lon', not 'lng'
-- Sample: {"lat":"24.66183556480049","lon":"46.53614048064761"} - Riyadh, plausible.
--
-- Stored as TEXT, so regex-guarded before casting and bounds-checked to Saudi Arabia
-- (lat 16..33, lon 34..56). A coordinate outside the country is a parse artefact rather than a Saudi
-- listing's position, so it becomes NULL - parser uncertainty resolves to NULL, never to a point in
-- the sea. This is a plausibility gate on OUR PARSE, not on a source-published value: the source text
-- is preserved untouched in ar_data either way.
--
-- Deliberately NOT mapped here: wasalt also publishes `isApproxLocation` (true on 266). "This pin is
-- approximate" is a DIFFERENT fact from the pin itself; folding it in would destroy the distinction,
-- and it is directly relevant to the proximity-verifiability contract. It needs its own column.
do $$
declare def text; n_lat int; n_lon int;
begin
  select pg_get_viewdef('public.listing_rich_attrs'::regclass, true) into def;

  def := regexp_replace(def,
    '\(w\.ar_data ->> ''latitude''::text\)',
    '((w.ar_data -> ''location''::text) ->> ''lat''::text)', 'g');
  def := regexp_replace(def,
    '\(w\.ar_data ->> ''longitude''::text\)',
    '((w.ar_data -> ''location''::text) ->> ''lon''::text)', 'g');

  n_lat := (select count(*) from regexp_matches(def, '->> ''lat''::text', 'g'));
  n_lon := (select count(*) from regexp_matches(def, '->> ''lon''::text', 'g'));
  if n_lat < 2 or n_lon < 2 then
    raise exception 'wasalt coordinate needles matched % lat / % lon - expected the guard and the value for each; view shape changed, refusing to guess again', n_lat, n_lon;
  end if;

  execute 'create or replace view public.listing_rich_attrs as ' || def;
end $$;
