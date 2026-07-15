import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Reveal } from '@/components/ui';
import { LoadingDots } from '@/components/CardReveal';
import { useI18n } from '@/i18n';
import { grouped } from '@/data/search';
import type { AdvancedOption } from '@/data/advancedFilters';

// The reusable card shell — overlay + backdrop + bar + progress, shared by both the loading state
// and the resolved question state so the transition between the two (and between successive
// questions later, once more fields exist) never flashes a different container. Any FIELD-SPECIFIC
// content lives in the caller (agent.tsx's age-flow orchestration, via AdvancedQuestionConfig) — this
// file must stay generic across every future advanced question, per owner instruction.
function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <View style={s.overlay}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <Reveal style={s.card}>
        <View style={s.bar}>
          <View style={s.titleWrap}>
            <Ionicons name="sparkles" size={16} color="#2f7247" />
            <Text style={s.barTitle} numberOfLines={1}>{t('Ezhalah AI Agent')}</Text>
          </View>
          <Pressable onPress={onClose} style={s.xBtn} hitSlop={6}>
            <Ionicons name="close" size={18} color="#56635c" />
          </Pressable>
        </View>
        {children}
      </Reveal>
    </View>
  );
}

// Shown while the current question's live counts are being resolved (network round-trip). Reuses
// the same pulsing dots already used for «عرض المزيد» so the "smooth reveal/loading" requirement
// doesn't introduce a new animation primitive. Kept inside the same Shell so nothing visually jumps
// once the real card mounts.
export function AdvancedQuestionLoading({ onClose }: { onClose: () => void }) {
  return (
    <Shell onClose={onClose}>
      <View style={s.loadingBody}>
        <LoadingDots color="#2f7247" />
      </View>
    </Shell>
  );
}

export type AdvancedQuestionCardProps = {
  titleKey: string;
  options: AdvancedOption[]; // already filtered to count > 0 by the config's fetchOptions
  unknownCount: number;
  progressCur: number;
  progressTotal: number;
  onAnswer: (key: string) => void;
  onSkip: () => void;
  onSkipAll: () => void;
  onClose: () => void;
};

// Centered, single-question card: title, tappable options, an unknown-data disclosure caption, and a
// «تخطي» skip button. Purely presentational — every word and count it renders comes from the
// AdvancedQuestionConfig/engine, so this component never special-cases عمر العقار (or any other field)
// directly.
export default function AdvancedQuestionCard({
  titleKey, options, unknownCount, progressCur, progressTotal, onAnswer, onSkip, onSkipAll, onClose,
}: AdvancedQuestionCardProps) {
  const { t } = useI18n();
  return (
    <Shell onClose={onClose}>
      {progressTotal > 1 ? (
        <View style={s.progTrack}>
          <View style={[s.progFill, { width: `${(progressCur / progressTotal) * 100}%` }]} />
        </View>
      ) : null}
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <Text style={s.qt}>{t(titleKey)}</Text>
        <View style={s.list}>
          {options.map((o, i) => (
            <Pressable
              key={o.key}
              style={[s.opt, i === 0 && s.optFirst]}
              onPress={() => onAnswer(o.key)}
            >
              <Text style={s.lbl}>{o.label}</Text>
              <Ionicons name="chevron-forward" size={16} color="#9aa6a0" />
            </Pressable>
          ))}
        </View>
        {unknownCount > 0 ? (
          <Text style={s.note}>{t('Age unknown for {count} matching listings', { count: grouped(unknownCount) })}</Text>
        ) : null}
        <View style={s.foot}>
          <Pressable style={s.skipLink} onPress={onSkip}>
            <Text style={s.skipText}>{t('Skip')}</Text>
          </Pressable>
          {progressTotal > 1 ? (
            <Pressable style={s.skipAllLink} onPress={onSkipAll}>
              <Text style={s.skipAllText}>{t('Skip remaining questions and search now')}</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </Shell>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8,18,12,0.45)' },
  card: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '100%',
    backgroundColor: '#fbfbfa',
    borderRadius: 20,
    overflow: 'hidden',
    borderLeftWidth: 6,
    borderLeftColor: '#1d4a37',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 24 },
    elevation: 16,
  },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10 },
  titleWrap: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  barTitle: { fontSize: 14, fontWeight: '700', color: '#1d4a37' },
  xBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#f1f3f1', alignItems: 'center', justifyContent: 'center' },

  progTrack: { height: 3, backgroundColor: '#e9ece9', marginHorizontal: 16, marginBottom: 4, borderRadius: 3, overflow: 'hidden' },
  progFill: { height: '100%', backgroundColor: '#1d4a37', borderRadius: 3 },

  loadingBody: { paddingHorizontal: 16, paddingVertical: 36, alignItems: 'center', justifyContent: 'center' },

  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 18 },
  qt: { fontSize: 18, fontWeight: '700', color: '#15201b', lineHeight: 24, paddingHorizontal: 2, paddingTop: 6, paddingBottom: 12 },

  list: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e7ebe8', borderRadius: 14, overflow: 'hidden' },
  opt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 14, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: '#f0f2f0' },
  optFirst: { borderTopWidth: 0 },
  lbl: { fontSize: 14.5, fontWeight: '500', color: '#15201b' },

  note: { marginTop: 10, marginHorizontal: 2, fontSize: 12, color: '#6b7a72', lineHeight: 17 },

  foot: { marginTop: 16, gap: 10 },
  skipLink: { borderWidth: 1, borderColor: '#d6e8db', backgroundColor: '#eef6f0', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  skipText: { color: '#1d4a37', fontSize: 14, fontWeight: '700' },
  skipAllLink: { paddingVertical: 6, alignItems: 'center' },
  skipAllText: { color: '#7b8a82', fontSize: 12.5, fontWeight: '600' },
});
