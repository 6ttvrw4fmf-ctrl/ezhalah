-- Roster entry for mon_detect_wasalt_annualisation_fabricated, added in the same session as the
-- detector itself (AGENTS.md: a detector nothing reaches is decoration, and
-- mon_detect_orphaned_detectors() fires on it). Needle-edit so the rest of the roster body — which
-- several concurrent sessions also touch — is preserved byte-for-byte rather than rebuilt.
do $$
declare src text; newsrc text;
begin
  select prosrc into src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then
    raise exception 'mon_run_all_detectors not found';
  end if;

  if position('mon_detect_wasalt_annualisation_fabricated' in src) > 0 then
    raise notice 'already on the roster — no-op';
    return;
  end if;

  -- Anchor on the existing rent-period detector so the new one sits beside its sibling.
  if position('''mon_detect_rent_period_source_mismatch''' in src) = 0 then
    raise exception 'anchor mon_detect_rent_period_source_mismatch missing from roster';
  end if;

  newsrc := replace(src,
    '''mon_detect_rent_period_source_mismatch''',
    '''mon_detect_rent_period_source_mismatch'',' || chr(10) ||
    '    ''mon_detect_wasalt_annualisation_fabricated''');

  execute format(
    'create or replace function public.mon_run_all_detectors() returns jsonb '
    'language plpgsql security definer set search_path to ''public'' as %L', newsrc);
end $$;