// LOCAL-ONLY listing feedback (thumbs up / down per listing). No backend yet — this just remembers
// the user's choice on-device so the highlight survives re-render / navigation / reload. Swap the
// read/write here for an API call once a feedback table exists (see the recommendation in chat).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export type FeedbackRating = 'up' | 'down';

const KEY = 'ezhalah:listingFeedback';
// In-memory cache = source of truth during a session; storage is the durable mirror.
let cache: Record<string, FeedbackRating> = {};

// Hydrate: web reads localStorage SYNCHRONOUSLY at module load so a saved highlight shows on first
// paint; native hydrates AsyncStorage asynchronously (highlight appears once it resolves).
(function hydrate() {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(KEY);
      if (raw) cache = JSON.parse(raw) || {};
    } else {
      AsyncStorage.getItem(KEY)
        .then((raw) => { if (raw) { try { cache = JSON.parse(raw) || {}; } catch { /* ignore */ } } })
        .catch(() => {});
    }
  } catch { /* ignore */ }
})();

export function getListingFeedback(id: string): FeedbackRating | null {
  return (id && cache[id]) || null;
}

export function setListingFeedback(id: string, rating: FeedbackRating | null): void {
  if (!id) return;
  if (rating) cache[id] = rating;
  else delete cache[id];
  const json = JSON.stringify(cache);
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') localStorage.setItem(KEY, json);
  } catch { /* ignore */ }
  AsyncStorage.setItem(KEY, json).catch(() => {});
}
