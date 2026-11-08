-- 🔧 2026-11-08: extra_attrs_tables_present() read only p_tables[1:300]. The searchable fleet passed 300 tables, so
-- every table after the 300th (alphabetically wadod … yameen, wasalt's 92,072 rows among them) silently read as
-- «no listing_extra_attrs branch» and loader-active-platforms-check.yml went red on a gap that does not exist.
-- A truncated read is not an empty answer: keep a bound for the public key, but REFUSE above it instead of dropping.
create or replace function public.extra_attrs_tables_present(p_tables text[])
 returns setof text
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if cardinality(p_tables) > 2000 then
    raise exception 'extra_attrs_tables_present: % tables asked, the bound is 2000 — refusing rather than answering for a truncated list', cardinality(p_tables)
      using errcode = 'program_limit_exceeded';
  end if;
  return query
    select t from unnest(p_tables) as t
     where exists (select 1 from public.listing_extra_attrs_mv m where m.source_table = t);
end
$function$;
