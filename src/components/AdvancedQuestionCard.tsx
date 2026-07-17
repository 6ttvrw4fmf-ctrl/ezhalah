import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LoadingDots } from '@/components/CardReveal';
import { useI18n } from '@/i18n';
import { grouped } from '@/data/search';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { colors } from '@/theme/tokens';
import type { AdvancedOption } from '@/data/advancedFilters';
import LegacyCard, { AdvancedQuestionLoading as LegacyLoading } from '@/components/AdvancedQuestionCardLegacy';

// «المرشد» redesign (owner-approved 2026-07-17) — the advanced question is no longer a centered
// dialog: it rises as a calm bottom sheet from where the user just tapped «خلّنا نحدد الطلب أكثر»,
// keeps the results visible (dimmed) behind it, and leads with the one thing that builds trust —
// the LIVE MATCHING COUNT, which also rides the primary button. Motion is deliberately minimal
// (sheet rise, option stagger, count tween, selection beat) per the owner's "subtle, Claude-like,
// no flash" direction for a 35+ audience: large touch targets, one question at a time, obvious
// selected states. Presentation ONLY — props, handlers, and the question engine are unchanged.
//
// Instant rollback: flip SHEET_V2 to false to restore the pre-2026-07-17 centered card verbatim
// (kept in AdvancedQuestionCardLegacy.tsx).
const SHEET_V2 = true;

const SHEET_EASE = Easing.bezier(0.32, 0.72, 0, 1); // Apple-style panel ease — no bounce
const FADE_EASE = Easing.bezier(0.22, 0.61, 0.36, 1);

// Smoothly tweens a displayed integer toward `value` (600 ms ease-out cubic). Text-only JS tween —
// the value is small UI state, not a layout animation, so no Reanimated worklet is needed. Snaps
// instantly for reduced-motion users and always lands exactly on the final value.
function useCountTween(value: number, reduced: boolean): number {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  useEffect(() => {
    if (reduced || shownRef.current === value) {
      shownRef.current = value;
      setShown(value);
      return;
    }
    const from = shownRef.current;
    const t0 = Date.now();
    const ms = 600;
    let raf: ReturnType<typeof requestAnimationFrame> | null = null;
    const step = () => {
      const p = Math.min(1, (Date.now() - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(from + (value - from) * eased);
      shownRef.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { if (raf != null) cancelAnimationFrame(raf); };
  }, [value, reduced]);
  return shown;
}

// The shared sheet shell — backdrop + rising sheet + grabber + brand bar. Both the loading state
// and the question state render inside the SAME mounted shell, so the loading→question transition
// (and any future question→question step) never flashes a different container.
function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withTiming(1, { duration: reduced ? 0 : 520, easing: SHEET_EASE });
  }, [v, reduced]);
  const backdrop = useAnimatedStyle(() => ({ opacity: v.value * 0.28 }));
  const sheet = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - v.value) * 620 }] }));
  return (
    <View style={s.overlay} pointerEvents="box-none">
      <Animated.View style={[s.backdrop, backdrop]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('Skip')} />
      </Animated.View>
      <Animated.View style={[s.sheet, sheet]}>
        <View style={s.grabber} />
        <View style={s.bar}>
          <View style={s.titleWrap}>
            <Ionicons name="sparkles" size={15} color={colors.primary} />
            <Text style={s.barTitle} numberOfLines={1}>{t('Ezhalah AI Agent')}</Text>
          </View>
          <Pressable onPress={onClose} style={s.xBtn} hitSlop={8} accessibilityLabel={t('Skip')}>
            <Ionicons name="close" size={18} color="#56635c" />
          </Pressable>
        </View>
        {children}
      </Animated.View>
    </View>
  );
}

function SheetLoading({ onClose }: { onClose: () => void }) {
  return (
    <Shell onClose={onClose}>
      <View style={s.loadingBody}>
        <LoadingDots color={colors.primary} />
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

// One option row: large target (≥58px), label + quiet count, and a triple-coded selected state
// (border + tint fill + check circle) so the choice is unmistakable for older users. Rows settle
// in with a soft 55 ms stagger on mount.
function OptionRow({ option, index, selected, onPress, reduced }: {
  option: AdvancedOption; index: number; selected: boolean; onPress: () => void; reduced: boolean;
}) {
  const { t } = useI18n();
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withDelay(reduced ? 0 : 100 + index * 55,
      withTiming(1, { duration: reduced ? 0 : 350, easing: FADE_EASE }));
  }, [v, index, reduced]);
  const a = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ translateY: (1 - v.value) * 8 }] }));
  return (
    <Animated.View style={a}>
      <Pressable
        style={[s.opt, selected && s.optSel]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected }}
      >
        <View style={[s.ck, selected && s.ckSel]}>
          {selected ? <Ionicons name="checkmark" size={13} color="#fff" /> : null}
        </View>
        <Text style={s.lbl}>{option.label}</Text>
        <Text style={s.cnt}>{t('{count} listings', { count: grouped(option.count) })}</Text>
      </Pressable>
    </Animated.View>
  );
}

function SheetCard({
  titleKey, options, unknownCount, progressCur, progressTotal, onAnswer, onSkip, onSkipAll, onClose,
}: AdvancedQuestionCardProps) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const lockRef = useRef(false);

  // The honest number: everything this question's scope matches right now (bucketed + unknown).
  // It is the header AND the primary button — the user always knows exactly what «عرض النتائج»
  // will show. Selecting an option previews the narrowing before the flow hands off.
  const total = options.reduce((sum, o) => sum + o.count, 0) + unknownCount;
  const selectedCount = selectedKey != null ? options.find((o) => o.key === selectedKey)?.count ?? total : total;
  const shownCount = useCountTween(selectedCount, reduced);

  const pick = (key: string) => {
    if (lockRef.current) return;
    lockRef.current = true;
    setSelectedKey(key);
    // A short beat so the selected state (and the count narrowing) lands before the hand-off —
    // the answer itself is exactly the same onAnswer(key) the engine always received.
    setTimeout(() => onAnswer(key), reduced ? 0 : 550);
  };

  return (
    <Shell onClose={onClose}>
      <View style={s.liveRow}>
        <Text style={s.liveNum}>{grouped(shownCount)}</Text>
        <Text style={s.liveCap}>{t('listings match your search')}</Text>
        {progressTotal > 1 ? (
          <Text style={s.step}>{t('Question {cur} of {total}', { cur: grouped(progressCur), total: grouped(progressTotal) })}</Text>
        ) : null}
      </View>
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <Text style={s.qt}>{t(titleKey)}</Text>
        <View style={s.list}>
          {options.map((o, i) => (
            <OptionRow key={o.key} option={o} index={i} reduced={reduced}
              selected={selectedKey === o.key} onPress={() => pick(o.key)} />
          ))}
        </View>
        {unknownCount > 0 ? (
          <Text style={s.note}>{t('Age unknown for {count} matching listings', { count: grouped(unknownCount) })}</Text>
        ) : null}
      </ScrollView>
      <View style={s.foot}>
        <Pressable style={s.cta} onPress={onSkip} accessibilityRole="button">
          <Text style={s.ctaText}>{t('Show results ({count})', { count: grouped(shownCount) })}</Text>
        </Pressable>
        {progressTotal > 1 ? (
          <Pressable style={s.skipAllLink} onPress={onSkipAll}>
            <Text style={s.skipAllText}>{t('Skip remaining questions and search now')}</Text>
          </Pressable>
        ) : null}
      </View>
    </Shell>
  );
}

export function AdvancedQuestionLoading(props: { onClose: () => void }) {
  return SHEET_V2 ? <SheetLoading {...props} /> : <LegacyLoading {...props} />;
}

export default function AdvancedQuestionCard(props: AdvancedQuestionCardProps) {
  return SHEET_V2 ? <SheetCard {...props} /> : <LegacyCard {...props} />;
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#08120c' },
  sheet: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    maxHeight: '80%',
    backgroundColor: '#fdfdfc',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    paddingBottom: 16,
    shadowColor: '#08120c',
    shadowOpacity: 0.22,
    shadowRadius: 44,
    shadowOffset: { width: 0, height: -16 },
    elevation: 18,
  },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#dde3de', alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 6, paddingBottom: 4 },
  titleWrap: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  barTitle: { fontSize: 13, fontWeight: '700', color: colors.dark },
  xBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#f1f3f1', alignItems: 'center', justifyContent: 'center' },

  liveRow: {
    flexDirection: 'row', alignItems: 'baseline', gap: 7,
    paddingTop: 6, paddingBottom: 12, marginBottom: 4,
    borderBottomWidth: 1, borderBottomColor: '#eef1ee',
  },
  liveNum: { fontSize: 21, fontWeight: '800', color: colors.dark, fontVariant: ['tabular-nums'] },
  liveCap: { fontSize: 13, fontWeight: '600', color: '#5d6f65', flexShrink: 1 },
  step: { marginStart: 'auto', fontSize: 12, fontWeight: '700', color: colors.muted },

  loadingBody: { paddingVertical: 40, alignItems: 'center', justifyContent: 'center' },

  body: { paddingTop: 10, paddingBottom: 4 },
  qt: { fontSize: 19, fontWeight: '800', color: colors.ink, lineHeight: 27, paddingBottom: 13 },

  list: { gap: 9 },
  opt: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1.5, borderColor: '#e3e9e4', borderRadius: 14,
    minHeight: 58, paddingVertical: 10, paddingHorizontal: 14,
  },
  optSel: { borderColor: colors.dark, backgroundColor: colors.tint },
  ck: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#d5ddd7',
    alignItems: 'center', justifyContent: 'center',
  },
  ckSel: { backgroundColor: colors.dark, borderColor: colors.dark },
  lbl: { fontSize: 16, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  cnt: { marginStart: 'auto', fontSize: 12.5, fontWeight: '700', color: '#5d6f65', fontVariant: ['tabular-nums'] },

  note: { marginTop: 11, fontSize: 12, color: colors.muted, lineHeight: 17 },

  foot: { paddingTop: 12, gap: 8 },
  cta: {
    backgroundColor: colors.dark, borderRadius: 13, minHeight: 52,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaText: { color: '#fff', fontSize: 15.5, fontWeight: '800' },
  skipAllLink: { paddingVertical: 6, alignItems: 'center' },
  skipAllText: { color: colors.muted, fontSize: 12.5, fontWeight: '600' },
});
