import { useApp } from '@/store';
import { persistDisplayName, persistNameSpellings } from '@/lib/auth';
import { buildSyncedName, scriptOf, initialsOf } from '@/lib/nameSync';

// THE ONE WAY a typed name is saved. The pencil rename (AccountMenu), «وش نناديك؟» (NamePrompt) and
// Apple's first-authorization name (AuthModal) all call this, so a name is persisted, transliterated
// and guarded identically wherever it comes from (owner 2026-10-23). The body is the rename's own,
// moved here unchanged; scripts/verify-synced-name-writes-carry-their-name.ts executes it.
export function useSaveName(): (v: string) => void {
  const { updateUser, applySyncedName } = useApp();
  const persistName = (v: string) => {
    const sc = scriptOf(v);
    const immediate = sc === 'ar' ? { name: v, nameAr: v } : { name: v, nameEn: v };
    updateUser({ ...immediate, initials: initialsOf(v) });
    // Refresh-proof (owner 2026-08-29): the store patch above is in-memory only — the auth
    // backend's user_metadata is what mapSupabaseUser rebuilds from on the next load.
    persistDisplayName(v);
    // applySyncedName, NOT updateUser: this is a network round trip, so renaming twice in quick
    // succession leaves two continuations in flight and the slower one lands last. An unguarded
    // updateUser here reverted the name AND the avatar initial to a value the user had already
    // replaced (routine #8, 2026-09-24 — the #319/#599/#648 stale-continuation class). The store's
    // applySyncedName drops a patch whose `name` is no longer the current one.
    // …and both spellings are stored with the name (persistNameSpellings), so a refresh paints them at once.
    buildSyncedName(v).then((synced) => { applySyncedName({ ...synced, initials: initialsOf(v) }); persistNameSpellings(synced); });
  };
  return persistName;
}
