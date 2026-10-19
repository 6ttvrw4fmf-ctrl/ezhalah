-- APPLIED 2026-10-18 23:22:27 UTC (owner session). Proven: a dead haraj key returned, a live one not, a malformed/hostile key ignored.
-- Owner 2026-10-18: a reopened history chat shows its cards as they were; a card whose listing was REMOVED at
-- its source since is shaded «انتهى الإعلان» (src/components/DeadCardShade.tsx), never hidden. The app sends
-- the cards' «source_table:id» keys; this answers which rows are now active = false. Only listing tables
-- (…_residential_listings / …_commercial_listings) are read, only the id + active flag, at most 600 keys.
create or replace function public.listing_keys_gone(p_keys text[])
returns text[]
language plpgsql stable security definer set search_path to 'public'
as $function$
declare t text; ids bigint[]; part text[]; out text[] := '{}';
begin
  if p_keys is null or cardinality(p_keys) = 0 then return out; end if;
  p_keys := p_keys[1:600];
  for t in select distinct split_part(k, ':', 1) from unnest(p_keys) k loop
    continue when t !~ '^[a-z0-9_]+_(residential|commercial)_listings$' or to_regclass('public.' || t) is null;
    select array_agg(split_part(k, ':', 2)::bigint) into ids
      from unnest(p_keys) k where split_part(k, ':', 1) = t and split_part(k, ':', 2) ~ '^[0-9]{1,18}$';
    continue when ids is null;
    begin
      execute format('select coalesce(array_agg(%L || '':'' || id::text), ''{}'') from public.%I where id = any($1) and active is false', t, t)
        into part using ids;
      out := out || part;
    exception when undefined_column then null;  -- a table without an active flag answers nothing
    end;
  end loop;
  return out;
end $function$;

revoke all on function public.listing_keys_gone(text[]) from public;
grant execute on function public.listing_keys_gone(text[]) to anon, authenticated;
