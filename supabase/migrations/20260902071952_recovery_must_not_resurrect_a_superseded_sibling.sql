CREATE OR REPLACE FUNCTION public.auto_recover_false_inactive(recent_window interval DEFAULT '24:00:00'::interval)
 RETURNS TABLE(tbl text, recovered integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t text; n int; sib text; sib_clause text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$'
      and tablename not like 'deal\_%' and tablename not like 'muktamel\_%'
  loop
    -- A row retired by db.retire_superseded_siblings() is INDISTINGUISHABLE from a false
    -- inactivation under the predicate below. Supersession reasons from POSITIVE evidence (this ad
    -- was parsed and classified into the sibling table THIS run), so by design it never touches
    -- missing_count -- and the row it retires therefore carries missing_count = 0 with a fresh
    -- deactivated_at, which is this job's recovery predicate verbatim.
    -- Measured 2026-09-02: the 2026-09-01 18:50 sadin crawl correctly retired 5 commercial rows
    -- (SD3EMT6, SD4CKRN, SD6IWMD, SDHQUTA, SDM1HAV) superseded by their residential siblings, and
    -- this job resurrected all 5 at 05:20 the next morning. trg_set_deactivated_at then NULLed
    -- deactivated_at, erasing the evidence it had ever happened. Each ad rendered as TWO Normal
    -- Filter cards on ONE source URL until the next crawl killed it again: a daily oscillation,
    -- invisible in the data at rest.
    -- The ops_adjudicated_listing clause below cannot cover this. It only knows rows a human or a
    -- repair adjudicated -- never the ones the scraper's own supersession step retires.
    sib := case
             when t ~ '_residential_listings$'
               then regexp_replace(t, '_residential_listings$', '_commercial_listings')
             else regexp_replace(t, '_commercial_listings$', '_residential_listings')
           end;
    sib_clause := '';
    if to_regclass('public.' || quote_ident(sib)) is not null
       and exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = sib
                      and c.column_name = 'ad_number')
       and exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = t
                      and c.column_name = 'ad_number')
    then
      sib_clause := format(
        ' and not exists (select 1 from public.%I s where s.ad_number = t.ad_number and s.active) ',
        sib);
    end if;

    execute format($f$
      update public.%I t
         set active = true
       where t.active = false
         and coalesce(t.missing_count, 0) = 0
         -- WHEN THE MISTAKE HAPPENED, not when a crawler last passed by. The fallback covers a row
         -- deactivated without stamping deactivated_at: recovering a live listing is the safe
         -- direction, and the adjudication guard below is what makes it safe.
         and (t.deactivated_at >= now() - $1
              or (t.deactivated_at is null and t.last_seen_at >= now() - $1))
         -- An adjudicated row was never struck BECAUSE a decision was recorded about it. It looks
         -- identical to a wrongly-flipped row and must never be auto-reactivated (owner,
         -- 2026-08-30). mon_detect_adjudicated_reactivation() proves this clause still holds.
         and not exists (select 1 from public.ops_adjudicated_listing j
                          where j.tbl = %L and j.listing_id = t.id)
         -- SUPERSESSION GUARD (2026-09-02). Never resurrect a row whose sibling table already
         -- serves this same source ad: that is not a false inactivation, it is the cross-table
         -- decision the crawl made from the source page, and undoing it puts the ad back into the
         -- Normal Filter as a duplicate card. State-free and self-healing in both directions --
         -- when the sibling goes inactive the clause stops binding on its own.
         %s
    $f$, t, t, sib_clause) using recent_window;
    get diagnostics n = row_count;
    if n > 0 then tbl := t; recovered := n; return next; end if;
  end loop;
end
$function$;
