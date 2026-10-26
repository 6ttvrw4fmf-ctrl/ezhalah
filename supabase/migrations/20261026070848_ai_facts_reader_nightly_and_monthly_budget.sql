-- THE AI READS EVERY NEW AD (owner 2026-10-26: «let's start … the max budget for the AI backend is 30 dollars monthly …
-- start now with the more listings»). The paid teacher (scrapers/facts/extract.py → facts-extract edge function →
-- deepseek-chat) runs NIGHTLY over the ads that arrived since its last read, and ONCE over the existing backlog, under a
-- hard monthly cap the database enforces on both sides of the paid call. Nothing it writes is served to users
-- directly: the free word reader stays the only writer of Advanced Filter values (Rule B); the AI's facts are the saved
-- context (listing_facts, every fact with the seller's quote) and the teacher that shows the reader new words
-- (ops_ai_facts_reader_gaps, read by Quality & Repair).
--
--   ai_facts_budget            ONE row: the monthly cap (30 USD) and the switch
--   facts_ai_budget(estimate)  {allow, cap, spent_month, remaining} — spent = listing_facts_runs this calendar month
--                              (the cost log every facts run writes; NOT ai_usage, which is the live product's breaker)
--   facts_ai_plan(mode)        per-table counts for the job's proportional plan: 'new' = first seen ≤ 3 days,
--                              'backlog' = every active ad (the picker below skips the ones already read)
--   facts_ai_todo_ids(...)     n ids of one table the AI has never read (no deepseek row for the ad), seeded order
--   ops_ai_facts_reader_gaps   the teacher's lesson: AI facts (last 30 days) the reader did not produce on the same ad
--   cron gh-facts-ai-new       07:40 UTC, after the reader's 07:05 — dispatches facts-extract.yml (defaults = new mode)
-- Service-role only.

create table if not exists public.ai_facts_budget (
  id            boolean primary key default true check (id),
  enabled       boolean     not null default true,
  month_usd_cap numeric     not null check (month_usd_cap > 0),
  note          text        not null,
  changed_at    timestamptz not null default now()
);
alter table public.ai_facts_budget enable row level security;
revoke all on table public.ai_facts_budget from public, anon, authenticated;
grant select on table public.ai_facts_budget to service_role;
insert into public.ai_facts_budget (id, enabled, month_usd_cap, note)
values (true, true, 30, 'Owner 2026-10-26: the AI facts reader (new ads nightly + the backlog) may spend at most 30 USD per calendar month')
on conflict (id) do nothing;

create or replace function public.facts_ai_budget(p_estimate_usd numeric default 0)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with b as (select * from public.ai_facts_budget where id),
       s as (select coalesce(sum(usd), 0)::numeric as spent from public.listing_facts_runs where at >= date_trunc('month', now()))
  select jsonb_build_object(
    'allow', coalesce((select enabled from b), false) and (select spent from s) + coalesce(p_estimate_usd, 0) <= coalesce((select month_usd_cap from b), 0),
    'enabled', coalesce((select enabled from b), false),
    'cap', (select month_usd_cap from b),
    'spent_month', round((select spent from s), 4),
    'remaining', round(coalesce((select month_usd_cap from b), 0) - (select spent from s), 4),
    'month', to_char(date_trunc('month', now()), 'YYYY-MM'))
$$;

create or replace function public.facts_ai_plan(p_mode text)
returns table (source_table text, n bigint) language sql stable security definer set search_path to 'public' as $$
  select s.source_table, count(*)
    from public.search_listings_ar s
   where case p_mode when 'new' then s.first_seen_at >= now() - interval '3 days'
                     when 'backlog' then true
                     else false end
   group by 1 order by 2 desc
$$;

create or replace function public.facts_ai_todo_ids(p_table text, p_limit integer, p_mode text, p_seed text)
returns table (id bigint) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if p_table is null or p_table !~ '^[a-z0-9_]+_listings$' or to_regclass('public.' || p_table) is null
     or p_limit not between 1 and 5000 or p_mode not in ('new', 'backlog') then
    return;
  end if;
  return query execute format($q$
    select x.id::bigint
      from public.%1$I x
      join public.search_listings_ar s on s.source_table = %2$L and s.listing_id = x.id
     where x.active and x.ad_number is not null
       and (%3$L <> 'new' or s.first_seen_at >= now() - interval '3 days')
       and not exists (select 1 from public.listing_facts l
                        where l.platform = %4$L and l.listing_key = x.ad_number::text and l.model like 'deepseek%%')
     order by md5(x.id::text || %5$L) limit %6$s
  $q$, p_table, p_table, p_mode, regexp_replace(p_table, '_(residential|commercial)_listings$', ''), coalesce(p_seed, ''), p_limit);
end $$;

-- The lesson for the reader: what the AI found on an ad where the free reader wrote nothing for that fact.
create or replace view public.ops_ai_facts_reader_gaps as
select a.fact,
       count(*)                                      as ai_rows,
       count(*) filter (where a.value_bool)          as ai_yes,
       (array_agg(a.quote order by a.extracted_at desc))[1:8] as sample_quotes
  from public.listing_facts a
 where a.model like 'deepseek%' and a.fact <> '_none' and a.fact not like 'other:%'
   and a.extracted_at >= now() - interval '30 days'
   and not exists (select 1 from public.listing_facts r
                    where r.model = 'word-checker-v1' and r.platform = a.platform and r.listing_key = a.listing_key and r.fact = a.fact)
 group by a.fact order by 2 desc;
revoke all on table public.ops_ai_facts_reader_gaps from public, anon, authenticated;
grant select on table public.ops_ai_facts_reader_gaps to service_role;

revoke all on function public.facts_ai_budget(numeric), public.facts_ai_plan(text), public.facts_ai_todo_ids(text, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.facts_ai_budget(numeric), public.facts_ai_plan(text), public.facts_ai_todo_ids(text, integer, text, text)
  to service_role;

-- Nightly, after the free reader (07:05): the AI reads what arrived since its last read. The workflow's defaults ARE
-- the nightly run (mode new, run id derived from the date, 1.5 USD cap per run; the monthly cap gates every call).
select cron.schedule('gh-facts-ai-new', '40 7 * * *', $$select public.trigger_gh_workflow('facts-extract.yml')$$);

-- Proven at apply time: the cap gates, the pickers answer, the month is this month.
do $$
declare b jsonb := public.facts_ai_budget(0);
begin
  if (b ->> 'cap')::numeric <> 30 or (b ->> 'month') <> to_char(now(), 'YYYY-MM') then
    raise exception 'facts_ai_budget misreads the cap or the month: %', b;
  end if;
  if (public.facts_ai_budget(1000000) ->> 'allow')::boolean then
    raise exception 'facts_ai_budget allows a spend past the cap';
  end if;
  if (select count(*) from public.facts_ai_plan('new')) = 0 or (select count(*) from public.facts_ai_plan('backlog')) = 0 then
    raise exception 'facts_ai_plan returns no tables';
  end if;
  if (select count(*) from public.facts_ai_todo_ids('aqar_residential_listings', 5, 'backlog', 'x')) <> 5 then
    raise exception 'facts_ai_todo_ids(backlog) did not return 5 unread aqar ids';
  end if;
  if (select count(*) from public.facts_ai_todo_ids('aqar_residential_listings', 5, 'nonsense', 'x')) <> 0 then
    raise exception 'facts_ai_todo_ids accepts an unknown mode';
  end if;
end $$;
