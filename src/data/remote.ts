import { supabase } from '@/lib/supabase';
import type { Listing } from './listings';

// Fetches the listing catalog from Supabase. Returns null when the backend is unconfigured or
// errors, so callers fall back to bundled mock data and the app never hard-fails.
export async function fetchListings(): Promise<Listing[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('listings')
    .select('id, type, deal, city, district, road, price, area, beds, source, listed, photo')
    .order('id', { ascending: true });
  if (error || !data) return null;
  return data as Listing[];
}
