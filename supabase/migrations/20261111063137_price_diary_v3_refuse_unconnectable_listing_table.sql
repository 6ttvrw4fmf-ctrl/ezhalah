-- PRICE DIARY v3 (2026-11-11, CodeRabbit follow-up on PR #11776): a new listing table that CANNOT be connected to the
-- diary is now REFUSED at CREATE TABLE, instead of being created without it. The born-attached hook used to swallow an
-- attach error, so a table missing a column the diary trigger reads (price_total, price_annual, active, id) could be
-- created and take writes before the hourly watcher noticed — and the price changes in between would be lost for good.
-- Now the error propagates: the migration that creates such a table fails loudly, before any ingestion.

create or replace function public.listing_price_diary_born_attached()
returns event_trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare r record;
begin
  for r in select k.relname from pg_event_trigger_ddl_commands() c
            join pg_class k on k.oid = c.objid
           where c.classid = 'pg_class'::regclass and k.relnamespace = 'public'::regnamespace
             and k.relkind = 'r' and k.relname ~ '_(residential|commercial)_listings$' loop
    if (select count(*) from pg_attribute a
         where a.attrelid = ('public.' || quote_ident(r.relname))::regclass and a.attnum > 0 and not a.attisdropped
           and a.attname in ('id', 'price_total', 'price_annual', 'active')) < 4 then
      raise exception 'listing table public.% cannot be connected to the price diary: it needs id, price_total, price_annual and active (owner rule 2026-11-11, docs/ARCHITECTURE.md §20)', r.relname;
    end if;
    perform public.listing_price_diary_attach(r.relname);
  end loop;
end $$;

comment on function public.listing_price_diary_born_attached() is
  'Event trigger on CREATE TABLE: connects every new _(residential|commercial)_listings table to the price diary before '
  'any write can reach it, and REFUSES the CREATE when it cannot (missing id / price_total / price_annual / active).';