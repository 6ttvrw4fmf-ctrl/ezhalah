CREATE OR REPLACE FUNCTION public.mon_run_all_detectors()
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  fns text[] := array[
    'mon_detect_oracle_chain_never_observed',
    'mon_detect_liveness_job_silent',
    'mon_detect_loc_rel_cycle_budget',
    'mon_detect_liveness_rotation_stranded',
    'mon_detect_age_producer_view_drift',
    'mon_detect_rent_period_inferred_when_source_silent',
    'mon_detect_enumeration_incomplete',
    'mon_detect_autoresolve_kind_unregistered',
    'mon_detect_dealapp_deactivation_on_unreliable_fetch',
    'mon_detect_served_price_never_rechecked', 'mon_detect_price_source_evidence_stale', 'mon_detect_price_borrowed_from_chrome', 'mon_detect_property_age_beyond_ceiling',
    'mon_detect_prune_kill_without_source_verdict',
    'mon_detect_wasalt_dead_but_active',
    'mon_detect_prune_verdict_unevidenced',
    'mon_detect_proxy_block_spike',
    'mon_detect_rows_collapse',
    'mon_detect_silent_partial_success',
    'mon_detect_run_duration_explosion',
    'mon_detect_run_killed_by_timeout',
    'mon_detect_proxy_contention',
    'mon_detect_inactivation_during_degraded_source',
    'mon_detect_deletion_on_inconclusive_evidence','mon_detect_cleanup_run_unrecorded',
    'mon_detect_discarded_location_resolution',
    'mon_detect_phasea_offregion_pick',
    'mon_detect_unwatched_derived_store',
    'mon_detect_district_contradicts_source',
    'mon_detect_phasea_snapshot_stale_vs_source',
    'mon_detect_af_source_mapping_integrity',
    'mon_detect_af_count_surfaces_carry_af',
    'mon_detect_af_rebuild_would_revert',
    'mon_detect_af_clause_surface_untemplated',
    'mon_detect_af_coverage_cliff',
    'mon_detect_af_view_coverage_gap',
    'mon_detect_af_option_count_truth',
    'mon_detect_af_chip_vs_db_truth',
    'mon_detect_af_mapping_unplumbed',
    'mon_detect_age_resolver_platform_gap',
    'mon_detect_age_gap_alert_on_decided_source',
    'mon_detect_v2_discards_captured_attrs',
    'mon_detect_fabricated_unpublished_amenity',
    'mon_detect_city_identity_contract',
    'mon_detect_published_amenity_capture_collapse', 'mon_detect_detail_capture_collapse', 'mon_detect_liveness_oracle_untrustworthy',
    'mon_detect_silent_scraper_death',
    'mon_detect_gathern_liveness_evidence_gap', 'mon_detect_gathern_city_coverage_gap',
    'mon_detect_unattributable_platform_runs',
    'mon_detect_zero_new_stall', 'mon_detect_source_retraction_flap',
    'mon_detect_stale_active_fraction', 'mon_detect_agent_health',
    'mon_detect_ai_cost_health',
    'mon_detect_agent_calls_per_message',
    'mon_detect_ai_telemetry_health',
    'mon_detect_ai_budget_burn',
    'mon_detect_transcript_integrity', 'mon_detect_stale_no_remediation_path',
    'mon_detect_volume_drop',
    'mon_detect_cron_health', 'mon_detect_cron_grace_below_cadence',
    'mon_detect_registry_verdict_guard',
    'mon_detect_alert_reaffirmation',
    'mon_detect_cron_attendance_denominator',
    'mon_detect_stale_refresh',
    'mon_detect_legacy_alert_tables',
    'mon_detect_field_integrity',
    'mon_detect_search_index_freshness',
    'mon_detect_quarantine_growth',
    'mon_detect_registry_orphans',
    'mon_detect_rls_reachability',
    'mon_detect_mass_inactivation',
    'mon_detect_english_district_leak',
    'mon_detect_impossible_price_size',
    'mon_detect_unverified_inactivation', 'mon_detect_adjudicated_reactivation',
    'mon_detect_deletion_spike',
    'mon_detect_buy_token_price_suppression',
    'mon_detect_price_source_mismatch',
    'mon_detect_dangling_scrape_run',
    'mon_detect_cron_minute_collision',
    'mon_detect_alert_delivery',
    'mon_detect_outbound_http_failures',
    'mon_detect_gh_dispatch_silently_skipped',
    'mon_detect_alert_dispatch_silent',
    'mon_detect_p0_delivery_sla',
    'mon_detect_unacknowledged_p0',
    'mon_detect_sql_mirror_drift',
    'mon_detect_zero_price_served',
    'mon_detect_deploy_lock_misuse',
    'mon_detect_orphaned_search_row',
    'mon_detect_filter_barrier_leaks',
    'mon_detect_price_eq_area_or_ppm',
    'mon_detect_loc_rel_capacity_risk', 'mon_detect_loc_rel_table_never_completes',
    'mon_detect_dealapp_shard_coverage',
    'mon_detect_searchability_collapse',
    'mon_detect_stalled_daily_detector',
    'mon_detect_rent_period_both_branch',
    'mon_detect_duplex_reachability','mon_detect_rent_period_unreachable','mon_detect_sync_pass_left_rows_unindexed',
    'mon_detect_location_predicate_drift',
    'mon_detect_manufactured_rent_period',
    'mon_detect_price_size_contamination',
    'mon_detect_unsortable_served_listing',
    'mon_detect_url_collisions_res_vs_com',
    'mon_detect_trending_district_dead_end',
    'mon_detect_period_branch_contradiction',
    'mon_detect_rent_period_source_mismatch',
    'mon_detect_duplicate_google_identity',
    'mon_detect_region_label_as_city',
    'mon_detect_aqarmonthly_district_city_suffix',
    'mon_detect_gathern_rating_source_truth',
    'mon_detect_monthly_af_exactness',
    'mon_detect_wasalt_annualisation_fabricated',
    'mon_detect_source_limited_contradicted',
    'mon_detect_search_performance_regression',
    'mon_detect_commercial_coverage_blind_spot',
    'mon_detect_rent_period_contradicts_capture',
    'mon_detect_served_after_source_confirmed_gone',
    'mon_detect_search_index_diverges_from_sync_source',
    'mon_detect_priceless_rent_with_labelled_source_price',
    'mon_detect_rent_period_contradicts_probe',
    'mon_detect_source_proven_period_unreachable',
    'mon_detect_filter_default_suppresses_inventory',
    'mon_detect_unresolvable_detector',
    'mon_detect_stuck_open_alert',
    'mon_detect_routine_sentry_silent',
    'mon_detect_routine_slug_divergence',
        'mon_detect_repair_guarantee_stale', 'mon_detect_wasalt_meter_parse_gap',
    'mon_detect_liveness_cap_degraded',
    'mon_detect_summary_only_capture',
    'mon_detect_district_bridge_leak',
    'mon_detect_scraper_failure_step_change',
    'mon_detect_card_attr_value_shape',
    'mon_detect_search_scope_unreachable_inventory',
    'mon_detect_buy_rent_combined_exactness',
    'mon_detect_trending_combined_null_safety',
    'mon_detect_price_eq_area_waiver_stale',
    'mon_detect_unresolvable_alert_kinds',
    'mon_detect_resolver_recognition_gap',
    'mon_detect_res_com_collision_repair_regression',
    'mon_detect_platform_monitoring_scope_gap',
    'mon_detect_search_latency_degraded',
    'mon_detect_unreachable_listing_table',
    'mon_detect_unreachable_listing_table_is_blind',
    'mon_detect_orphaned_detectors', 'mon_detect_cron_scheduler_frozen', 'mon_detect_searchability_verdict_ordering',
    'mon_detect_orphan_detector_is_blind',
    'mon_detect_detector_cannot_raise',
    -- the mirror image of the line above (ops_incident #25): that one asks whether a detector can
    -- speak, this one asks whether a declared kind has anything that speaks it.
    'mon_detect_declared_kind_without_emitter',
    'mon_detect_migration_content_parity_stale', 'mon_detect_index_label_unrepairable', 'mon_detect_qa_oracle_combined_scope', 'mon_detect_qa_adjudicator_zero_contract', 'mon_detect_card_label_contract',
    'mon_detect_district_canon_stale',
    'mon_detect_district_token_stranded', 'mon_detect_ranking_diversity_contract', 'mon_detect_city_label_is_admin_region', 'mon_detect_af_tri_state_violations', 'mon_detect_age_open_bucket_stored_as_precise', 'mon_detect_legacy_branch_region_scope', 'mon_detect_unlocated_search_contract', 'mon_detect_rent_period_contract', 'mon_detect_city_resolution_ignores_region', 'mon_detect_district_only_city_inference', 'mon_detect_unprobed_source_waiver', 'mon_detect_english_overlay_stranded_city', 'mon_detect_run_log_timestamps_inverted',
    'mon_detect_detector_sweep_budget',
    'mon_detect_price_blanked_without_authority',
    'mon_detect_aqar_deep_fill_health',
    'mon_detect_cron_ordering_contract', 'mon_detect_located_row_unreachable',
    'mon_detect_unannualised_rent_cohort',
    'mon_detect_placeholder_price_stored', 'mon_detect_deleted_but_source_live',
    'mon_detect_alert_subject_fk',
    'mon_detect_alert_subject_fk_is_blind', 'mon_detect_cleanup_evidence_gap', 'mon_detect_unledgered_hard_delete', 'mon_detect_card_link_identity', 'mon_detect_photo_sync_stale', 'mon_detect_liveness_coverage_ramp', 'mon_detect_liveness_verification_sla', 'mon_detect_ungated_expensive_detector', 'mon_detect_dlr_lookup_equivalence',
    'mon_detect_stalled_incident',
    'mon_detect_alert_queue_unworked',
    -- routine #11 ♻️ listing lifecycle (incident #25): detect-only, never write to a listing
    'mon_detect_inactive_still_searchable',
    'mon_detect_lifecycle_leak_detector_is_blind',
    'mon_detect_inactive_still_counted',
    'mon_detect_unknown_treated_as_dead',
    'mon_detect_deletion_clock_without_evidence',
    -- routine #11 ♻️ listing lifecycle (incident #25), the remaining four kinds. Detect-only:
    -- not one of these writes to a listing, a location table or an index.
    'mon_detect_false_resurrection',
    'mon_detect_orphan_after_delete', 'mon_detect_deletion_log_without_delete', 'mon_detect_propagation_order_inverted',
    'mon_detect_lifecycle_duplicate_stale_copy',
    'mon_detect_deletion_clock_stalled',
    'mon_detect_area_contradicts_capture',
    'mon_detect_amaall_native_location_regressed',
    'mon_detect_service_facility_types_regressed',
    'mon_detect_aqarmonthly_district_suffix_repair_regressed',
    'mon_detect_district_catalog_pollution',
    'mon_detect_remal_native_location_regressed',
    'mon_detect_district_identity_split',
    'mon_detect_amlakalahsa_direction_ppm_regressed',
    'mon_detect_amlakalahsa_description_regressed',
    'mon_detect_aqar_ppm_prefilter_lossless',
    'mon_detect_amlakalahsa_soum_price_regressed',
    'mon_detect_amlakalahsa_jafr_dahiya_merge_regressed',
    'mon_detect_amlakalahsa_district_match_disarmed',
    'mon_detect_cron_timeout_headroom',
    'mon_detect_amlakalahsa_district_consolidation_regressed',
    'mon_detect_rakez_off_plan_resurrection',
    'mon_detect_dead_qa_oracle_wrapper',
    'mon_detect_akariyoun_open_bound_age_reappears',
    'mon_detect_akariyoun_street_width_is_form_chrome',
    'mon_detect_detector_dark', 'mon_detect_aqar_area_truncation_residue', 'mon_detect_city_duplicate_orphaned_districts'
  ];
  fn text; raised int; result jsonb := '{}'::jsonb; failed text[] := '{}';
  v_started  timestamptz := clock_timestamp();
  v_t0       timestamptz;
  v_ms       numeric;
  v_budget_s numeric;
  v_soft_s   numeric;
  v_skipped  text[] := '{}';
  v_elapsed  numeric;
  v_cost      jsonb   := '{}'::jsonb;
  v_pred_ms   numeric;
  v_reserve_s numeric := 90;
begin
  v_budget_s := coalesce(
    (select nullif(substring(command from 'statement_timeout\s+to\s+''(\d+)s'''), '')::numeric
       from cron.job where jobname = 'mon-detectors-and-dispatch'), 900);
  v_soft_s := 0.75 * v_budget_s;

  select coalesce(jsonb_object_agg(detector, greatest(p90, coalesce(recent_max, 0))), '{}'::jsonb)
    into v_cost
    from (select detector,
                 percentile_disc(0.9) within group (order by elapsed_ms) as p90,
                 max(elapsed_ms) filter (where rn <= 3) as recent_max
            from (select detector, elapsed_ms,
                         row_number() over (partition by detector
                                                order by swept_at desc) as rn
                    from public.ops_detector_timing
                   where swept_at > now() - interval '7 days'
                     and not skipped
                     and coalesce(crashed, false) = false) q
           group by detector) s;

  -- ANTI-STARVATION (routine #7, 2026-09-18). The skip below is a SUFFIX of this array: when the
  -- budget binds, every detector from that point to the END does not run. Array position was
  -- therefore a permanent priority and the newest detector was always first to go dark. Ordering
  -- least-recently-RUN first makes the skip ROTATE, so a detector starved this sweep leads the
  -- next one. Same detectors skipped, same count, same P1 -- just never the same tail twice.
  select array_agg(u.fn order by l.last_ran nulls first, u.ord)
    into fns
    from unnest(fns) with ordinality as u(fn, ord)
    left join (select detector, max(swept_at) as last_ran
                 from public.ops_detector_timing
                where not skipped and coalesce(crashed, false) = false
                group by detector) l on l.detector = u.fn;

  foreach fn in array fns loop
    v_pred_ms := coalesce((v_cost ->> fn)::numeric, 0);
    if extract(epoch from clock_timestamp() - v_started) > v_soft_s
       or (v_pred_ms > 0
           and extract(epoch from clock_timestamp() - v_started) + v_pred_ms / 1000.0
               > v_budget_s - v_reserve_s) then
      v_skipped := v_skipped || fn;
      insert into public.ops_detector_timing (detector, elapsed_ms, raised, skipped)
        values (fn, 0, null, true);
      continue;
    end if;
    begin
      v_t0 := clock_timestamp();
      execute format('select public.%I()', fn) into raised;
      v_ms := extract(epoch from clock_timestamp() - v_t0) * 1000;
      insert into public.ops_detector_timing (detector, elapsed_ms, raised)
        values (fn, v_ms, raised);
      result := result || jsonb_build_object(replace(fn, 'mon_detect_', ''), raised);
    exception when others then
      failed := failed || fn;
      begin
        insert into public.ops_detector_timing (detector, elapsed_ms, crashed)
          values (fn, extract(epoch from clock_timestamp() - v_t0) * 1000, true);
      exception when others then null;
      end;
      result := result || jsonb_build_object(replace(fn, 'mon_detect_', ''), 'ERROR: ' || sqlerrm);
      begin
        perform public.mon_raise('P1', 'detector_crash', 'all',
          'detector_crash:' || fn || ':' || current_date,
          jsonb_build_object('detector', fn, 'sqlstate', sqlstate, 'error', sqlerrm));
      exception when others then
        null;
      end;
    end;
  end loop;

  v_elapsed := extract(epoch from clock_timestamp() - v_started);

  if array_length(v_skipped, 1) > 0 then
    perform public.mon_raise('P1', 'detector_sweep_budget', 'monitoring',
      'detector_sweep_soft_deadline',
      jsonb_build_object(
        'skipped_count', array_length(v_skipped, 1),
        'skipped', to_jsonb(v_skipped),
        'elapsed_s', round(v_elapsed),
        'soft_deadline_s', v_soft_s,
        'declared_budget_s', v_budget_s,
        'why', 'the sweep ran out of its soft budget and these detectors did not run at '
            || 'all this half-hour. They are NOT green - they are unmeasured. The sweep '
            || 'stopped deliberately so the alerts it had already raised could COMMIT and '
            || 'mon_dispatch_alerts could still run, instead of the whole transaction '
            || 'being rolled back by statement_timeout.',
        'action', 'attribute with: select detector, round(avg(elapsed_ms)) ms, count(*) '
            || 'from ops_detector_timing where swept_at > now() - interval ''24 hours'' '
            || 'and not skipped group by 1 order by 2 desc limit 10;'));
  else
    perform public.mon_resolve_key('detector_sweep_budget', 'detector_sweep_soft_deadline');
  end if;

  delete from public.ops_detector_timing where swept_at < now() - interval '14 days';
  return result || jsonb_build_object('ran_at', now(), 'failed', to_jsonb(failed),
    'open_alerts', (select coalesce(jsonb_object_agg(severity, c), '{}'::jsonb)
                      from (select severity, count(*) c from public.alert_event
                             where resolved_at is null group by severity) s));
end $function$
