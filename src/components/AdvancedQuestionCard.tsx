import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Reveal } from '@/components/ui';
import { LoadingDots } from '@/components/CardReveal';
import { useI18n } from '@/i18n';
import { grouped } from '@/data/search';
import { colors, radius, space, font, cardShadow } from '@/theme/tokens';
import type { AdvancedOption } from '@/data/advancedFilters';

// THE ONE Advanced Filter card — governed by docs/ADVANCED_FILTER_DESIGN_CONTRACT.md. It owns 100% of
// the chrome/layout/progress/footer/spacing/typography/motion/skip/counts/interaction. A question
// supplies only title/description/options/selection; this component NEVER branches on a question id —
// only on `selection` (single = radio, one pick; multi = checkbox, many). Every question therefore
// looks and behaves identically: select rows, then confirm via the footer «Show {N}».

// Shared overlay shell (top bar + backdrop), reused by the loading state and the question state so the
// container never jumps between them.
function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <View style={s.overlay}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <Reveal style={s.card}>
        <View style={s.bar}>
          <View style={s.titleWrap}>
            <Ionicons name="sparkles" size={16} color={colors.primary} />
            <Text style={s.barTitle} numberOfLines={1}>{t('Ezhalah AI Agent')}</Text>
          </View>
          <Pressable onPress={onClose} style={s.xBtn} hitSlop={6}>
            <Ionicons name="close" size={18} color={colors.muted} />
          </Pressable>
        </View>
        {children}
      </Reveal>
    </View>
  );
}

export function AdvancedQuestionLoading({ onClose }: { onClose: () => void }) {
  return (
    <Shell onClose={onClose}>
      <View style={s.loadingBody}>
        <LoadingDots color={colors.primary} />
      </View>
    </Shell>
  );
}

// Card-owned brand-asset registry — a question names an asset by TOKEN (its brandImage config field);
// the card alone maps token → image and owns the one shared slot + styling it renders in. RN requires
// static require() calls, which is also why the mapping must live here and not in question config.
const BRAND_IMAGES: Record<string, ReturnType<typeof require>> = {
  'ejari-rnpl': require('../../assets/images/ejari-rnpl.png'),
};

export type AdvancedQuestionCardProps = {
  titleKey: string;
  descriptionKey?: string;
  brandImage?: string;            // asset token resolved via the card's own BRAND_IMAGES registry
  selection: 'single' | 'multi';
  options: AdvancedOption[];      // already pre-filtered to the meaningful-option floor by the config
  unknownCount: number;
  progressCur: number;           // 1-based ordinal among the questions that will actually show
  progressTotal: number;         // count of ELIGIBLE questions for this scope (not the static array)
  liveCount: (keys: string[]) => Promise<number | null>; // footer «Show {N}» for a tentative selection
  onConfirm: (keys: string[]) => void; // commit the selection (empty = no preference) and advance/search
  onSkip: () => void;                   // skip THIS question
  onSkipAll: () => void;                // commit accumulated + search now
  onClose: () => void;                  // abandon
};

// One row template — identical for single and multi. Leading indicator (radio vs checkbox) + label +
// trailing live count pill. Selected rows share one highlight.
function OptionRow({ option, selected, selection, first, onPress }: {
  option: AdvancedOption; selected: boolean; selection: 'single' | 'multi'; first: boolean; onPress: () => void;
}) {
  const icon = selection === 'multi'
    ? (selected ? 'checkbox' : 'square-outline')
    : (selected ? 'radio-button-on' : 'radio-button-off');
  return (
    <Pressable style={[s.row, first && s.rowFirst, selected && s.rowOn]} onPress={onPress}>
      <View style={s.rowLead}>
        <Ionicons name={icon} size={20} color={selected ? colors.primary : colors.pickLine} />
        <Text style={[s.label, selected && s.labelOn]} numberOfLines={1}>{option.label}</Text>
      </View>
      <View style={s.countPill}>
        <Text style={s.countText}>{grouped(option.count)}</Text>
      </View>
    </Pressable>
  );
}

export default function AdvancedQuestionCard({
  titleKey, descriptionKey, brandImage, selection, options, unknownCount, progressCur, progressTotal,
  liveCount, onConfirm, onSkip, onSkipAll, onClose,
}: AdvancedQuestionCardProps) {
  const { t } = useI18n();
  const [sel, setSel] = useState<string[]>([]);
  const [count, setCount] = useState<number | null>(null);

  // Animated progress fill — the ONLY motion, shared by every question so single/multi never differ.
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: progressTotal > 0 ? progressCur / progressTotal : 0,
      duration: 280, useNativeDriver: false,
    }).start();
  }, [progressCur, progressTotal, progress]);
  const fillWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  // Live footer count for the current tentative selection (empty = the scope total). Holds the last
  // good number on a failed/racey fetch rather than flashing a wrong one.
  useEffect(() => {
    let alive = true;
    liveCount(sel).then((n) => { if (alive && n != null) setCount(n); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.join(',')]);

  const pick = (key: string) => setSel((cur) => {
    if (selection === 'single') return cur[0] === key ? [] : [key]; // radio: replace / tap-again clears
    return cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]; // checkbox: toggle
  });

  return (
    <Shell onClose={onClose}>
      {progressTotal > 1 ? (
        <View style={s.progRow}>
          <View style={s.progTrack}>
            <Animated.View style={[s.progFill, { width: fillWidth }]} />
          </View>
          <Text style={s.progNum}>
            {t('Question {cur} of {total}', { cur: progressCur, total: progressTotal })}
          </Text>
        </View>
      ) : null}
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <Text style={s.qt}>{t(titleKey)}</Text>
        {descriptionKey ? <Text style={s.desc}>{t(descriptionKey)}</Text> : null}
        {brandImage && BRAND_IMAGES[brandImage] ? (
          <View style={s.brandStrip}>
            <Image source={BRAND_IMAGES[brandImage]} style={s.brandImg} contentFit="contain" />
          </View>
        ) : null}
        <View style={s.list}>
          {options.map((o, i) => (
            <OptionRow key={o.key} option={o} selected={sel.includes(o.key)} selection={selection}
              first={i === 0} onPress={() => pick(o.key)} />
          ))}
        </View>
        {unknownCount > 0 ? (
          <Text style={s.note}>{t('Age unknown for {count} matching listings', { count: grouped(unknownCount) })}</Text>
        ) : null}
        <View style={s.foot}>
          <Pressable style={s.primaryBtn} onPress={() => onConfirm(sel)}>
            <Text style={s.primaryTxt}>
              {count != null ? t('Show {count} results', { count: grouped(count) }) : t('Show results')}
            </Text>
          </Pressable>
          <View style={s.footRow}>
            <Pressable style={s.skipLink} onPress={onSkip} hitSlop={8}>
              <Text style={s.skipTxt}>{t('Skip')}</Text>
            </Pressable>
            {progressTotal > 1 ? (
              <Pressable style={s.skipLink} onPress={onSkipAll} hitSlop={8}>
                <Text style={s.skipAllTxt}>
                  {progressTotal - progressCur > 0
                    ? t('Skip remaining ({count}) and search now', { count: progressTotal - progressCur })
                    : t('Skip remaining questions and search now')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </Shell>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.screenSide },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.scrim },
  card: {
    width: '100%', maxWidth: 360, maxHeight: '100%', backgroundColor: colors.paper,
    borderRadius: radius.sheet, overflow: 'hidden', borderLeftWidth: 6, borderLeftColor: colors.dark, ...cardShadow,
  },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: space.card, paddingTop: space.card, paddingBottom: 10 },
  titleWrap: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  barTitle: { fontFamily: font.family.bold, fontSize: 14, color: colors.dark },
  xBtn: { width: 30, height: 30, borderRadius: radius.pill, backgroundColor: colors.segTrack, alignItems: 'center', justifyContent: 'center' },

  progRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: space.card, marginBottom: 4 },
  progTrack: { flex: 1, height: 3, backgroundColor: colors.line, borderRadius: 3, overflow: 'hidden' },
  progFill: { height: '100%', backgroundColor: colors.dark, borderRadius: 3 },
  progNum: { fontFamily: font.family.semibold, fontSize: 11.5, color: colors.muted, fontVariant: ['tabular-nums'] },

  loadingBody: { paddingHorizontal: space.card, paddingVertical: 36, alignItems: 'center', justifyContent: 'center' },

  body: { paddingHorizontal: space.card, paddingTop: space.base, paddingBottom: 18 },
  qt: { fontFamily: font.family.bold, fontSize: 18, color: colors.ink, lineHeight: 24, paddingHorizontal: 2, paddingTop: 6 },
  desc: { fontFamily: font.family.regular, fontSize: 12.5, color: colors.muted, paddingHorizontal: 2, paddingTop: 4 },

  // Shared brand-image slot — one fixed position (under the subtitle, above the options) and one
  // style for ANY question that names a brandImage token. The PNG carries its own branding; the
  // strip is a neutral token-only frame.
  brandStrip: {
    marginTop: 10, alignItems: 'center', justifyContent: 'center', paddingVertical: 8,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.fieldLine, borderRadius: radius.field,
  },
  brandImg: { width: 150, height: 46 },

  list: { marginTop: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.fieldLine, borderRadius: radius.field, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 13, paddingHorizontal: 13, borderTopWidth: 1, borderTopColor: colors.line },
  rowFirst: { borderTopWidth: 0 },
  rowOn: { backgroundColor: colors.tint },
  rowLead: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  label: { fontFamily: font.family.medium, fontSize: 14.5, color: colors.ink, flexShrink: 1 },
  labelOn: { fontFamily: font.family.bold, color: colors.dark },
  countPill: { backgroundColor: colors.tint, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 2, minWidth: 34, alignItems: 'center' },
  countText: { fontFamily: font.family.bold, fontSize: 12.5, color: colors.primary, fontVariant: ['tabular-nums'] },

  note: { marginTop: 10, marginHorizontal: 2, fontFamily: font.family.regular, fontSize: 12, color: colors.muted, lineHeight: 17 },

  foot: { marginTop: 16, gap: 10 },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: radius.chip, paddingVertical: 13, alignItems: 'center' },
  primaryTxt: { fontFamily: font.family.bold, fontSize: 14.5, color: colors.surface },
  footRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 2 },
  skipLink: { paddingVertical: 4, flexShrink: 1 },
  skipTxt: { fontFamily: font.family.semibold, fontSize: 13.5, color: colors.dark },
  skipAllTxt: { fontFamily: font.family.medium, fontSize: 12.5, color: colors.muted },
});
