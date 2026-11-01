-- AN AD THE AI READ IS READ, WHICHEVER MODEL READ IT (owner 2026-10-28: «let's try using mistral small … for the ones we
-- didn't check»). The AI-reader pickers and its lesson view keyed "read by the AI" on model like 'deepseek%'. A row
-- written by any other model (mistralai/…, google/…, qwen/… through the OpenRouter reader key) would leave its ad
-- "unread": the next backlog run would pay for it again, and its finds would never reach ops_ai_facts_reader_gaps.
-- The free word reader is the only non-AI writer of listing_facts (model 'word-checker-v1'), so "the AI read it" is
-- now model NOT LIKE 'word-checker%'. ai_spend_gate and the agent detectors also mention deepseek and are untouched:
-- they watch the user-facing chat, not this reader.

do $patch$
declare d text; k int;
  old_s constant text := 'l.model like ''deepseek%%''';
  new_s constant text := 'l.model not like ''word-checker%%''';
begin
  select pg_get_functiondef('public.facts_ai_todo_ids(text,integer,text,text)'::regprocedure) into d;
  if position(new_s in d) > 0 then
    raise notice 'facts_ai_todo_ids already counts any AI model';
  else
    k := (length(d) - length(replace(d, old_s, ''))) / length(old_s);
    if k <> 1 then raise exception 'facts_ai_todo_ids: anchor found % times, want 1', k; end if;
    execute replace(d, old_s, new_s);
  end if;
end $patch$;

create or replace view public.ops_ai_facts_reader_gaps as
select a.fact,
       count(*)                                      as ai_rows,
       count(*) filter (where a.value_bool)          as ai_yes,
       (array_agg(a.quote order by a.extracted_at desc))[1:8] as sample_quotes
  from public.listing_facts a
 where a.model not like 'word-checker%' and a.fact <> '_none' and a.fact not like 'other:%'
   and a.extracted_at >= now() - interval '30 days'
   and not exists (select 1 from public.listing_facts r
                    where r.model = 'word-checker-v1' and r.platform = a.platform and r.listing_key = a.listing_key and r.fact = a.fact)
 group by a.fact order by 2 desc;
revoke all on table public.ops_ai_facts_reader_gaps from public, anon, authenticated;
grant select on table public.ops_ai_facts_reader_gaps to service_role;
