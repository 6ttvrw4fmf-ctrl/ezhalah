-- Barrier: a source-published additional_info value shape the card renderer cannot display
-- (Search & Matching QA run, 2026-08-18).
--
-- WHAT HAPPENED. `additional_info` is a source-scraped JSON column. Its LEGACY array shape is stored
-- exactly as the platform published it, and Wasalt publishes NUMBERS for noOfParkings / noOfFloors /
-- floorNumber. buildAdditionalInfo() passed that array through untouched, so a number reached
-- ResultCard.arAttrValue(), whose first statement was `(value ?? '').trim()`. `(2).trim is not a
-- function` threw an uncaught TypeError, React unmounted the entire tree, and production served a
-- BLANK WHITE PAGE for any search whose rendered cards included one of those 2,977 rows (80 of them
-- with the numeric entry inside the first four, i.e. no extra click needed). Live-reproduced at
-- https://ezhalah-app.vercel.app: تجاري -> المباني والمرافق -> «مبنى تجاري» -> الرياض -> «بحث» returned
-- 40 real matches from this very RPC, fetched all 40 raw cards over HTTP 200, and then rendered a
-- document with one div and zero characters.
--
-- The code fix coerces with String() at the boundary AND at the renderer, and
-- scripts/verify-card-attr-value-coercion.ts (in `npm test`, CI-required on every PR) keeps it there.
-- Numbers are therefore fine now, and this detector deliberately does NOT alert on them.
--
-- WHAT THIS DETECTOR IS FOR is the half String() cannot fix: a value shaped as a JSON OBJECT or
-- ARRAY. String({}) renders the literal text "[object Object]" on a property card -- no crash, no
-- error, just a nonsense attribute the user sees and nobody is told about. Zero such rows exist
-- today across every listing table; this fires the moment a scraper starts producing one.
--
-- SOURCE TRUTH IS UNTOUCHED: the detector only reports. Whatever the platform published stays
-- exactly as captured; the decision about how to render a new shape is a code change, never a
-- rewrite of the datum.
create or replace function public.mon_card_attr_shape_barrier()
returns table(source_table text, n bigint, sample text)
language plpgsql security definer set search_path to 'public' as $function$
declare t text; q text;
begin
  for t in
    select c.table_name
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.column_name  = 'additional_info'
       and c.table_name like '%\_listings'
       and c.table_name not like '%backup%'
       and c.table_name not like 'ops\_%'
  loop
    q := format($f$
      select %L::text, count(*)::bigint, min(e::text)
        from %I r,
             lateral jsonb_array_elements(
               case when jsonb_typeof(r.additional_info) = 'array'
                    then r.additional_info else '[]'::jsonb end) e
       where r.active is true
         and jsonb_typeof(e->'value') in ('object','array')
      having count(*) > 0
    $f$, t, t);
    return query execute q;
  end loop;
end $function$;

-- Expensive (scans every listing table's JSON) -> the ~20h daily slot, same gate as the other
-- behavioural detectors. mon_detect_stalled_daily_detector() watches that gate, so a detector that
-- silently stops claiming its slot is itself reported.
create or replace function public.mon_detect_card_attr_value_shape()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; r record;
begin
  if not public.mon_claim_daily_slot('card_attr_value_shape') then return 0; end if;
  for r in select * from public.mon_card_attr_shape_barrier() loop
    n := n + public.mon_raise(
      'P2', 'card_attr_value_shape', split_part(r.source_table, '_', 1),
      'card_attr_value_shape:' || r.source_table,
      jsonb_build_object(
        'why', 'A served listing carries an additional_info value shaped as a JSON object/array. '
            || 'The card renders it through String(), which prints the literal "[object Object]" '
            || 'to the user. Numbers are NOT reported here - those render correctly since the '
            || '2026-08-18 coercion fix.',
        'table', r.source_table, 'rows', r.n, 'sample', r.sample,
        'adjudicate', 'Do NOT rewrite the source value. Decide how this shape should DISPLAY, add '
                   || 'the mapping in buildAdditionalInfo() (src/data/remote.ts) next to the '
                   || 'existing array/boolean branches, and extend '
                   || 'scripts/verify-card-attr-value-coercion.ts to cover it.'));
  end loop;
  update public.ops_detector_last_full_run set last_result = n
   where detector = 'card_attr_value_shape';
  return n;
end $function$;

-- Roster wiring by GUARDED NEEDLE-EDIT (read the LIVE body, splice one name in, re-execute), the
-- pattern scripts/verify-detector-roster-edits-are-guarded.ts requires: it never has to know what
-- else is in the array, so it cannot drop what it never read.
do $$
declare
  v_def text;
  anchor constant text := '    ''mon_detect_orphaned_detectors''';
  fn constant text := 'mon_detect_card_attr_value_shape';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;
  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing - refusing to guess at the array shape';
  end if;
  if position('''' || fn || '''' in v_def) = 0 then
    v_def := replace(v_def, anchor, '    ''' || fn || ''',' || E'\n' || anchor);
    execute v_def;
  end if;
end $$;
