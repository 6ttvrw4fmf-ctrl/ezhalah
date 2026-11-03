-- 🔧 2026-11-02: ops_text_facts_status() answers in seconds again.
-- The rulebook promises «≈ 10 s, one call». Since the 11-01 reader-version bump re-read 438,779 ads, the two
-- counts that walk the whole overlay (ops_text_facts_vs_index = listing_text_facts × jsonb_each(facts) ⟕
-- search_listings_ar) take longer than the connector's 60 s: the call timed out 3× on 11-01 and 2× on 11-02, so the
-- morning check had no number at all. Those two counts move once a day (the reader runs 07:05 UTC, the detector
-- 11:52), so they are taken ONCE a day into a snapshot by pg_cron and the status function reads the snapshot and
-- says how old it is. Everything else in the function stays live. Nothing is hidden: a snapshot older than 36 h
-- reads as NULL with its age, never as a stale number presented as fresh. One small row a day is kept for good.
create table if not exists public.ops_text_facts_status_snapshot (
  as_of timestamptz primary key default now(),
  served_from_text bigint,
  street_width_text_rows bigint
);
comment on table public.ops_text_facts_status_snapshot is
  '🔧 2026-11-02: the two whole-overlay counts of ops_text_facts_status(), taken daily by cron job text-facts-status-snapshot.';

create or replace function public.text_facts_status_snapshot_take()
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform set_config('statement_timeout', '900000', true);
  insert into public.ops_text_facts_status_snapshot (as_of, served_from_text, street_width_text_rows)
  select now(),
         (select count(*) from public.ops_text_facts_vs_index v
           where v.stale_at is null and v.in_index and v.index_value is not distinct from v.text_value),
         (select count(*) from public.ops_text_facts_num_vs_index v
           where v.col = 'street_width_m' and v.stale_at is null and v.in_index);
end $$;

create or replace function public.ops_text_facts_status()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select jsonb_build_object(
    'switch', (select jsonb_build_object('on', k.enabled, 'changed_at', k.changed_at, 'reason', k.reason)
                 from public.ops_feature_flags k where k.name = 'af_text_facts_overlay'),
    'last_read_at', (select max(read_at) from public.listing_text_facts),
    'ads_read_last_36h', (select count(*) from public.listing_text_facts where read_at > now() - interval '36 hours'),
    'ads_read', (select count(*) from public.listing_text_facts),
    'ads_with_af_fact', (select count(*) from public.listing_text_facts where facts <> '{}'::jsonb),
    'stale_waiting_reread', (select count(*) from public.listing_text_facts where stale_at is not null),
    'conflicts', (select count(*) from public.ops_text_facts_conflicts),
    'street_width_text_rows', (select snap.street_width_text_rows from public.ops_text_facts_status_snapshot snap
                                where snap.as_of > now() - interval '36 hours' order by snap.as_of desc limit 1),
    'street_width_differs', (select count(*) from public.ops_text_facts_width_differs),
    'served_from_text', (select snap.served_from_text from public.ops_text_facts_status_snapshot snap
                          where snap.as_of > now() - interval '36 hours' order by snap.as_of desc limit 1),
    'snapshot_as_of', (select max(snap.as_of) from public.ops_text_facts_status_snapshot snap),
    'open_alerts', (select coalesce(jsonb_agg(a.dedup_key), '[]'::jsonb) from public.alert_event a
                     where a.dedup_key like 'text_facts_%' and a.resolved_at is null))
$function$;

-- daily, after the 07:05 reader and the hourly :22 sync, before the 11:52 detector
select cron.schedule('text-facts-status-snapshot', '40 10 * * *', $$select public.text_facts_status_snapshot_take()$$)
 where not exists (select 1 from cron.job where jobname = 'text-facts-status-snapshot');