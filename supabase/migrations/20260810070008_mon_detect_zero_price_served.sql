-- A SEARCHABLE listing whose price is exactly 0 (2026-08-10 senior audit, run #8).
--
-- 0 is not a magnitude, it is the ABSENCE of a price wearing a number's clothes. The standing owner
-- rule protects a source-PUBLISHED price at any magnitude — it does not ask us to serve a zero as
-- though the seller were giving the property away.
--
-- Live impact when this was written: 3 ramzalqasim land plots in عنيزة carry price_total = 0 and are
-- production_ready, so `Buy in عنيزة sorted by price ascending` returns them ABOVE all 1,451 real
-- listings. Their own source_capture holds no price anywhere in the ad text, and 0 of 188
-- ramzalqasim rows have a NULL price — the platform always sends a `price` key and sends 0 when
-- there is none, so the pipeline cannot currently tell "free" from "not stated".
--
-- This detector does NOT repair anything. Whether those rows should become NULL is an owner
-- decision (it changes what users see, and proving what the source displays needs a live fetch this
-- environment cannot make). The detector exists so the class is VISIBLE rather than silent, and so
-- growth is caught the same hour instead of by the next audit.
create or replace function public.mon_detect_zero_price_served()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_cnt bigint; v_platforms text; v_open boolean; n int := 0;
begin
  select count(*), coalesce(string_agg(distinct platform, ',' order by platform), '')
    into v_cnt, v_platforms
    from public.search_listings_ar
   where production_ready
     and (price_total = 0 or price_annual = 0);

  v_open := exists (select 1 from public.alert_event
                    where dedup_key = 'zero_price_served' and resolved_at is null);

  if v_cnt = 0 then
    if v_open then perform public.mon_resolve('zero_price_served', 'search_index'); end if;
  elsif not v_open then
    n := n + public.mon_raise('P2', 'zero_price_served', 'search_index', 'zero_price_served',
      jsonb_build_object(
        'count', v_cnt,
        'platforms', v_platforms,
        'why', 'a SEARCHABLE listing carries a price of exactly 0 — almost always the source''s '
               '"no price / السوم" sentinel stored as if it were a real number. It sorts above every '
               'genuine listing on price-ascending and matches every price-max filter. Do NOT bulk-null '
               'these: confirm against the live source page first (honest NULL beats a guess, but a '
               'genuinely published 0 would still be preserved).'));
  end if;
  return n;
end $function$;

-- Wire it into the runner. Needle-edit the array rather than rewriting the body, so a concurrent
-- change to any other detector in the list cannot be clobbered by this migration.
do $wire$
declare src text; newsrc text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then
    raise exception 'mon_run_all_detectors not found — refusing to guess';
  end if;

  if position('mon_detect_zero_price_served' in src) > 0 then
    raise notice 'already wired; nothing to do';
    return;
  end if;

  -- Anchor on the orphan detector, which must stay LAST so it sees every other entry.
  if position('''mon_detect_orphaned_detectors''' in src) = 0 then
    raise exception 'anchor ''mon_detect_orphaned_detectors'' missing — runner shape changed, refusing to edit blindly';
  end if;

  newsrc := replace(src,
    '    ''mon_detect_orphaned_detectors''',
    '    ''mon_detect_zero_price_served'',' || chr(10) || '    ''mon_detect_orphaned_detectors''');

  if newsrc = src then
    raise exception 'needle-edit produced no change — refusing to proceed';
  end if;

  execute newsrc;
end $wire$;
