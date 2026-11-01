// Today's insight facts + sentence shapes for the home headline (lib/insightWelcome.ts), in ONE bounded read.
// A failed or timed-out read is null — never an empty pack that would read as «no facts today»; the caller
// then simply prepares nothing and the headline keeps its fallback (A FAILED FETCH IS NOT AN EMPTY ANSWER).
import { supabase } from '@/lib/supabase';
import { boundedRpc } from '@/data/boundedRpc';
import type { InsightPack } from '@/lib/insightWelcome';

export async function fetchWelcomeInsights(city: string | null | undefined, district: string | null | undefined): Promise<InsightPack | null> {
  if (!supabase) return null;
  const { data, error } = await boundedRpc<unknown>(supabase.rpc('welcome_insights_pick', { p_city: city || null, p_district: district || null }));
  if (error || !data || typeof data !== 'object') return null;
  const d = data as Partial<InsightPack>;
  if (!Array.isArray(d.templates) || !Array.isArray(d.insights) || !d.templates.length || !d.insights.length) return null;
  return { day: d.day ?? null, templates: d.templates, insights: d.insights };
}
