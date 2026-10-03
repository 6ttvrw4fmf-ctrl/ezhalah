-- Two things the ♻️ Lifecycle Engineer found on 2026-10-03 and could not apply itself (rule 9;
-- follow-up row 106), applied by the owner's session the same day.
--
-- 1. dead-visible-score.yml never ran. Its GitHub `schedule:` did not fire (merged 01:05 UTC, nothing
--    by 14:05), like every other lifecycle job here: they only start when a pg_cron row dispatches
--    them. 09:05 UTC is the time the workflow file already names.
--
-- 2. 54 listing tables (27 platforms) had neither trg_set_deactivated_at nor trg_archive_hard_delete.
--    A hide on them carried deactivated_at NULL (1,016 rows measured), which made it invisible to the
--    monitors, to automatic recovery and to the 30-day deletion clock, and a delete on them left no
--    archive copy. Same trigger definitions every other listing table already has. No row is
--    rewritten here: backfilling the existing NULL dates is a separate data decision.

select cron.schedule('gh-dead-visible-score', '5 9 * * *',
  $$select public.trigger_gh_workflow('dead-visible-score.yml')$$);

do $d$
declare r record;
begin
  set local lock_timeout = '5s';
  for r in
    select c.oid, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname ~ '_(residential|commercial)_listings$'
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'deactivated_at' and not a.attisdropped)
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'active' and not a.attisdropped)
  loop
    if not exists (select 1 from pg_trigger g where g.tgrelid = r.oid and g.tgname = 'trg_set_deactivated_at') then
      execute format('create trigger trg_set_deactivated_at before update on public.%I for each row when (old.active is distinct from new.active) execute function set_deactivated_at()', r.relname);
    end if;
    if not exists (select 1 from pg_trigger g where g.tgrelid = r.oid and g.tgname = 'trg_archive_hard_delete') then
      execute format('create trigger trg_archive_hard_delete after delete on public.%I for each row execute function tg_archive_hard_deleted_listing()', r.relname);
    end if;
  end loop;
end $d$;
