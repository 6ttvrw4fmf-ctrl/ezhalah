-- P2 (senior audit run #10, 2026-08-11), surfaced once the wasalt manufactured negatives were
-- cleared and the safety barrier could see past them.
--
-- NOTE ON OVERLAP, added when committing (the SQL below is verbatim as applied at 09:58:57Z):
-- PART 1's aldarim retraction raced PR #454, which applied 20260811075455 at 07:54Z and had already
-- NULLed the 12 null-source air_conditioner rows. Those UPDATEs were therefore no-ops for AC by the
-- time this ran; the kitchen/sanitation rows were still open and are cleared here. The
-- scrapers/aldarim/run.py tri-state `_flag()` this header refers to belongs to PR #454, not to this
-- branch — that file is deliberately untouched here to avoid a conflict. PART 2 is the piece nobody
-- else has, and it is what actually lets CI go green.
--
-- PART 1 — aldarim: a real, small fabrication.
-- scrapers/aldarim/run.py mapped four amenity flags with a bare bool(). aldarim publishes these as
-- explicit 0/1 and a 0 is a GENUINE "no" that must be preserved — has_electricity/has_water/
-- has_sewage all carry both values in production, so the flags are really read. But bool() also
-- turns the API's JSON null ("aldarim did not say") into a confident False. Measured against the
-- stored source_capture, which retains aldarim's full payload:
--     is_ac_installed       126 zero /  7 null (res)    34 zero /  5 null (com)
--     is_kitchen_installed          7 null (res)                 5 null (com)
--     has_sewage                    0 null (res)                 2 null (com)
-- So 12 AC rows, 12 kitchen rows and 2 sewage rows recorded a "no" aldarim never published.
-- NULL them; the scraper now uses a tri-state _flag() so they cannot come back.
update public.aldarim_residential_listings set air_conditioner = null
 where source_capture->'is_ac_installed' = 'null'::jsonb;
update public.aldarim_commercial_listings set air_conditioner = null
 where source_capture->'is_ac_installed' = 'null'::jsonb;
-- kitchen is only cleared where the flag was unknown AND the kitchens-count path did not prove one
-- (that widening is unchanged), i.e. exactly the rows the new code would leave as None.
update public.aldarim_residential_listings set kitchen = null
 where source_capture->'is_kitchen_installed' = 'null'::jsonb and kitchen is false;
update public.aldarim_commercial_listings set kitchen = null
 where source_capture->'is_kitchen_installed' = 'null'::jsonb and kitchen is false;
update public.aldarim_residential_listings set sanitation = null
 where source_capture->'has_sewage' = 'null'::jsonb;
update public.aldarim_commercial_listings set sanitation = null
 where source_capture->'has_sewage' = 'null'::jsonb;

-- PART 2 — the barrier cannot currently tell a SOURCE-PUBLISHED negative from a manufactured one.
-- detect_manufactured_negatives() flags any (platform, column) with false>0 and true=0. That
-- heuristic is right when nothing reads the attribute, but aldarim genuinely publishes
-- is_ac_installed = 0 on every listing that states it (126/126 residential, 34/34 commercial after
-- the repair above) — none of its stock has AC. Under the owner's SOURCE-IS-TRUTH rule that
-- negative must be PRESERVED, so the pair can never reach a `true` and the barrier would stay red
-- forever, blocking every merge in the repo, while the data is correct.
--
-- Same shape of fix, and the same discipline, as ops_price_eq_area_verified: a narrow per-pair
-- allowlist that requires written evidence. It does NOT weaken the barrier in general — any pair
-- not listed here still fires, including a new column on aldarim itself.
create table if not exists public.ops_source_published_negative (
  platform    text        not null,
  col         text        not null,
  evidence    text        not null,
  verified_at timestamptz not null default now(),
  primary key (platform, col)
);
comment on table public.ops_source_published_negative is
  'Per-(platform,column) exemptions from detect_manufactured_negatives(): the source itself '
  'publishes an explicit negative, so false-with-zero-true is source truth, not DEFAULT residue. '
  'Every row must carry evidence quoting the source field and its measured value distribution.';

insert into public.ops_source_published_negative (platform, col, evidence) values
 ('aldarim', 'air_conditioner',
  'aldarim publishes is_ac_installed as an explicit 0/1 flag and states it as literal 0 on every '
  'listing that carries a value: 126/126 residential and 34/34 commercial rows (stored '
  'source_capture, 2026-08-11). The 7+5 rows where it was JSON null are NULLed in this same '
  'migration and the scraper is tri-state, so no fabricated negative remains. Sibling flags '
  'has_electricity/has_water/has_sewage carry BOTH 0 and 1 on the same platform, proving the flag '
  'set is genuinely read rather than defaulted. Zero-true here is aldarim stock having no AC.')
on conflict (platform, col) do nothing;

create or replace function public.detect_manufactured_negatives()
 returns table(platform text, col text, n_false bigint)
 language plpgsql
as $function$
declare c text; p text; t text; v_true bigint; v_false bigint; tt bigint; ff bigint;
begin
  foreach c in array public.barrier_attribute_columns() loop
    for p in select distinct regexp_replace(table_name,'_(residential|commercial)_listings$','')
             from information_schema.tables
             where table_schema='public'
               and (table_name like '%\_residential\_listings' or table_name like '%\_commercial\_listings')
               and table_name not like '%backup%'
    loop
      v_true := 0; v_false := 0;
      for t in select table_name from information_schema.tables
               where table_schema='public'
                 and table_name in (p||'_residential_listings', p||'_commercial_listings')
      loop
        if not exists (select 1 from information_schema.columns ic
                       where ic.table_schema='public' and ic.table_name=t and ic.column_name=c) then continue; end if;
        execute format('select count(*) filter (where %I is true), count(*) filter (where %I is false) from public.%I', c, c, t)
          into tt, ff;
        v_true := v_true + coalesce(tt,0);
        v_false := v_false + coalesce(ff,0);
      end loop;
      -- A pair the source itself publishes as an explicit negative is not manufactured. The
      -- allowlist is per (platform, column) and evidence-bearing; everything else still fires.
      if v_true = 0 and v_false > 0
         and not exists (select 1 from public.ops_source_published_negative x
                          where x.platform = p and x.col = c) then
        platform := p; col := c; n_false := v_false; return next;
      end if;
    end loop;
  end loop;
end
$function$;
