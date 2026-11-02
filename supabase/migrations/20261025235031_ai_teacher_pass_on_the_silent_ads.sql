-- AI TEACHER PASS ON THE SILENT ADS (owner 2026-10-26: «lets do the 10,000 ads … then we move on»).
--
-- 82,505 active ads have text the free word reader (word-checker-v1) read and found NOTHING in — no filter fact,
-- no history fact. Those are where the reader is most likely blind (a spelling it does not know, a site's own
-- phrasing). The paid teacher (scrapers/facts/extract.py, deepseek-chat, ≈ $0.0001/ad) reads 10,000 of them; what
-- it finds teaches the reader new words, exactly as the 10-24 test did. The sample is frozen here so the job
-- (PostgREST only, no SQL of its own) can pick from it by table, shuffled by a seed, and resume.
--
--   ops_text_facts_silent          the frozen set: one row per silent ad (source_table, listing_id), computed now
--   facts_silent_plan()            per-table counts, for the job's proportional plan
--   facts_silent_ids(table, n, seed) n ids of that table in md5(seed) order (a different seed = a different sample)
-- Service-role only. The set is a snapshot (computed_at); the nightly reader keeps reading these ads as before.

create table if not exists public.ops_text_facts_silent (
  source_table text   not null,
  listing_id   bigint not null,
  platform     text   not null,
  listing_key  text   not null,
  computed_at  timestamptz not null default now(),
  primary key (source_table, listing_id)
);
alter table public.ops_text_facts_silent enable row level security;
revoke all on table public.ops_text_facts_silent from public, anon, authenticated;
grant select on table public.ops_text_facts_silent to service_role;
comment on table public.ops_text_facts_silent is
  'Snapshot (2026-10-26) of active ads whose text the free word reader found nothing in: the AI teacher pass samples from here (scrapers/facts/extract.py --silent). Service-role only.';

insert into public.ops_text_facts_silent (source_table, listing_id, platform, listing_key)
select f.source_table, f.listing_id, f.platform, f.listing_key
  from public.listing_text_facts f
 where f.stale_at is null and f.facts = '{}'::jsonb
   and not exists (select 1 from public.listing_facts l
                    where l.platform = f.platform and l.listing_key = f.listing_key
                      and l.model = 'word-checker-v1' and l.fact <> '_none')
on conflict do nothing;

create or replace function public.facts_silent_plan()
returns table (source_table text, n bigint) language sql stable security definer set search_path to 'public' as $$
  select s.source_table, count(*) from public.ops_text_facts_silent s group by 1 order by 2 desc
$$;

create or replace function public.facts_silent_ids(p_table text, p_limit integer, p_seed text)
returns table (id bigint) language sql stable security definer set search_path to 'public' as $$
  select s.listing_id from public.ops_text_facts_silent s
   where s.source_table = p_table and p_limit between 1 and 5000
   order by md5(s.listing_id::text || coalesce(p_seed, '')) limit p_limit
$$;

revoke all on function public.facts_silent_plan(), public.facts_silent_ids(text, integer, text) from public, anon, authenticated;
grant execute on function public.facts_silent_plan(), public.facts_silent_ids(text, integer, text) to service_role;
