// The top bar's language switch for a GUEST, between the sign-in pill and «مشاركة», on all three screens
// (Filter, الوسيط الذكي, خريطة) — owner 2026-10-31: «add language here also, between both of those buttons; if
// it's in Arabic the user can click English, and if he then logs in it's automatically in English; this
// just shows for a non-logged-in user; must be for all 3».
//
// Same switch as the sidebar's (Sidebar.tsx sidebar-language-toggle): setLocale() flips the UI only — chat
// history keeps its own language (CHAT LANGUAGE AND UI LANGUAGE ARE SEPARATE). The choice carries across
// sign-in by the existing rule in i18n.tsx (THE LANGUAGE SURVIVES THE SIGN-IN ROUND TRIP, guarded by
// scripts/verify-language-survives-sign-in.ts); once signed in it is saved to the account like any choice.
// A signed-in user has the sidebar / account menu for this, so the pill is for guests only — and, like the
// sign-in pill beside it, only where the sidebar is a drawer (not docked), which already carries the toggle.
// SMALL (owner: «make it so small, ENG»): a short pill, «ENG» in the Arabic UI and «عربي» in the English one — the
// language a tap switches TO, untranslated, so it is readable to the person who needs it. Its OWN colour (owner:
// «make the pill a unique colour»): a deep teal, used nowhere else in the top bar, so it is neither the plum
// sign-in pill nor the neutral share pill. Gold stays reserved for encouraged actions (palette.ts).
import { Pressable, StyleSheet, Text } from 'react-native';
import { radius } from '@/theme/tokens';
import { TAP44 } from '@/theme/palette';
import { useI18n } from '@/i18n';
import { useApp } from '@/store';
import { useDocked } from '@/components/Sidebar';

const TEAL = '#1E6F73';
const TEAL_HOVER = '#185B5E';

/** `inSidebar`: the docked sidebar's own copy, top-right of its brand row where «محادثة جديدة» sits for a signed-in
 *  user (owner 2026-10-31: «include here on top right, like new chat but instead this, only for a non-logged-in
 *  user»). There the docked guard does not apply — the sidebar IS the docked surface. */
export default function TopBarLanguage({ inSidebar = false }: { inSidebar?: boolean }) {
  const { locale, setLocale } = useI18n();
  const { user, authChecked } = useApp();
  const docked = useDocked();
  if (!authChecked || user || (docked && !inSidebar)) return null;
  const next = locale === 'ar' ? 'en' : 'ar';
  return (
    <Pressable
      testID="topbar-language-toggle"
      style={({ pressed, hovered }: any) => [s.pill, inSidebar && s.pillSidebar, hovered && s.pillHover, pressed && s.pillPressed]}
      onPress={() => setLocale(next)}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={next === 'en' ? 'English' : 'العربية'}
      // @ts-expect-error web-only DOM props on the RNW host node
      dataSet={{ ...TAP44 }}
    >
      <Text style={s.text}>{next === 'en' ? 'ENG' : 'عربي'}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  pill: { alignItems: 'center', justifyContent: 'center', backgroundColor: TEAL, borderWidth: 1, borderColor: TEAL, borderRadius: radius.pill, height: 30, paddingHorizontal: 11, marginRight: 8 },
  pillSidebar: { marginRight: 0, marginLeft: 'auto' },
  pillHover: { backgroundColor: TEAL_HOVER, borderColor: TEAL_HOVER },
  pillPressed: { opacity: 0.9 },
  text: { fontSize: 11.5, fontWeight: '800', color: '#fff', includeFontPadding: false },
});
