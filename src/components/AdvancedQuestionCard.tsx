import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming, withSpring, Easing } from 'react-native-reanimated';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Reveal } from '@/components/ui';
import { LoadingDots } from '@/components/CardReveal';
import { useI18n } from '@/i18n';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { grouped } from '@/data/search';
import { colors, radius, space, font, cardShadow } from '@/theme/tokens';
import type { AdvancedOption } from '@/data/advancedFilters';

// THE ONE Advanced Filter card — governed by docs/ADVANCED_FILTER_DESIGN_CONTRACT.md. It owns 100% of
// the chrome/layout/progress/footer/spacing/typography/motion/skip/counts/interaction. A question
// supplies only title/description/options/selection; this component NEVER branches on a question id —
// only on `selection` (single = radio, one pick; multi = checkbox, many). Every question therefore
// looks and behaves identically: select rows, then confirm via the footer.
//
// UX refresh (owner 2026-08-16): the card should feel like a short smart conversation, not a form —
// one question, generous whitespace, soft rounded option rows with a gentle press-compression and a
// check that fades in, a live «N نتيجة» count that follows the narrowing, and a calm secondary
// «تخطي». All motion is decoration only (timings are short, reduced-motion collapses them) and no
// hand-off ever rides an animation callback — auto-advance stays a plain setTimeout.

// Second tap on the same option within this window = confirm + advance (owner 2026-08-22). Only the
// SECOND tap acts, so a single tap is never delayed waiting to see whether another one follows.
const DOUBLE_TAP_MS = 320;
const PRESS_IN = { duration: 90, easing: Easing.bezier(0.22, 1, 0.36, 1) };
const RELEASE = { damping: 18, stiffness: 260 };

// Shared overlay shell (top bar + backdrop), reused by the loading, intro and question states so the
// container never jumps between them. `countChip` is the live remaining-results pill — the narrowing
// number the user should always see (owner: the user must always understand how far it narrowed).
function Shell({ children, onClose, countChip }: { children: React.ReactNode; onClose: () => void; countChip?: number | null }) {
  const { t } = useI18n();
  return (
    // testIDs (2026-08-22): stable hooks so a production browser test can scope to THIS card. Arabic
    // label matching is unsafe here — «عرض المزيد» alone maps from THREE different English keys
    // (Load more / Show more / See more), and a global text match reads listing cards instead.
    <View style={s.overlay} testID="af-card">
      <Pressable style={s.backdrop} onPress={onClose} />
      <Reveal style={s.card}>
        <View style={s.bar}>
          <View style={s.titleWrap}>
            <Ionicons name="sparkles" size={16} color={colors.primary} />
            <Text style={s.barTitle} numberOfLines={1}>{t('Ezhalah AI Agent')}</Text>
          </View>
          <View style={s.barSide}>
            {countChip != null ? <View testID="af-count-chip"><AnimatedCount value={countChip} /></View> : null}
            <Pressable onPress={onClose} style={s.xBtn} hitSlop={6}>
              <Ionicons name="close" size={18} color={colors.muted} />
            </Pressable>
          </View>
        </View>
        {children}
      </Reveal>
    </View>
  );
}

// The live result-count pill: soft fade+settle whenever the number changes so the narrowing reads as
// motion, not a jarring swap. Reduced motion → static text.
function AnimatedCount({ value }: { value: number }) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const v = useSharedValue(1);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value && !reduced) {
      prev.current = value;
      v.value = 0;
      v.value = withTiming(1, { duration: 260, easing: Easing.bezier(0.22, 1, 0.36, 1) });
    } else {
      prev.current = value;
    }
  }, [value, reduced, v]);
  const a = useAnimatedStyle(() => ({ opacity: 0.4 + v.value * 0.6, transform: [{ translateY: (1 - v.value) * -4 }] }));
  return (
    <Reanimated.View style={[s.liveChip, a]}>
      <Text style={s.liveChipTx}>{t('{count} results', { count: grouped(value) })}</Text>
    </Reanimated.View>
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

// ── Opening state (owner 2026-08-16) ─────────────────────────────────────────────────────────────
// Shown automatically after an eligible Filter search lands with > 25 results: never a question, a
// calm invitation — «لقينا N عقار» → «خلّنا نحدد طلبك أكثر» → one soft line explaining we use the
// information available about these listings. Begin is opt-in; «عرض النتائج» leaves immediately
// (the results are already rendered behind the overlay). No technical language, ever.
export function AdvancedIntroCard({ total, onBegin, onShowResults, onClose }: {
  total: number | null; onBegin: () => void; onShowResults: () => void; onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Shell onClose={onClose}>
      <View style={s.introBody}>
        {total != null ? (
          <Text style={s.introCount}>{t('We found {count} properties', { count: grouped(total) })}</Text>
        ) : null}
        <Text style={s.introTitle}>{t('Let’s pin down what you’re looking for')}</Text>
        <Text style={s.introSupport}>{t('We’ll use what we know about these listings to get you closer to the right one')}</Text>
        <View style={s.introFoot}>
          <Tap onPress={onBegin} style={s.primaryBtn}>
            <Text style={s.primaryTxt}>{t('Let’s begin')}</Text>
          </Tap>
          <Pressable style={s.introLink} onPress={onShowResults} hitSlop={8}>
            <Text style={s.skipTxt}>{t('Show results')}</Text>
          </Pressable>
        </View>
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
  liveCount: (keys: string[]) => Promise<number | null>; // live count for a tentative selection
  initialKeys?: string[];               // answer to restore when the user came BACK to this question
  onConfirm: (keys: string[]) => void; // commit the selection (empty = no preference) and advance/search
  onSkip: () => void;                   // skip THIS question
  onBack: () => void;                   // one question back — from the first question, out of AF entirely
  onSkipAll: () => void;                // commit accumulated + search now
  onClose: () => void;                  // abandon
};

// Soft press-compression wrapper (same feel as ui.tsx's Tappable, local so the card owns its motion).
// `testID` is forwarded onto the inner Pressable (the node that actually handles the tap), not the
// animated wrapper — a test that queries the wrapper would find an element whose click does nothing.
// Tap silently DROPPED testID before, which is why af-confirm resolved to null in the first scoped
// production run (2026-08-22).
function Tap({ children, onPress, style, testID }: { children: React.ReactNode; onPress: () => void; style?: object | object[]; testID?: string }) {
  const press = useSharedValue(0);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: 1 - press.value * 0.03 }] }));
  return (
    <Reanimated.View style={[style as object, a]}>
      <Pressable
        testID={testID}
        onPress={onPress}
        onPressIn={() => { press.value = withTiming(1, PRESS_IN); }}
        onPressOut={() => { press.value = withSpring(0, RELEASE); }}
        style={s.tapInner}
      >
        {children}
      </Pressable>
    </Reanimated.View>
  );
}

// One row template — identical for single and multi. Soft rounded option row: label + trailing live
// count pill; a check indicator fades/scales in on selection and the row fills with the brand tint.
// Tap again deselects. The press itself compresses gently (micro-animation, decoration only).
function OptionRow({ option, selected, selection, first, onPress }: {
  option: AdvancedOption; selected: boolean; selection: 'single' | 'multi'; first: boolean; onPress: () => void;
}) {
  const reduced = useReducedMotion();
  const press = useSharedValue(0);
  const sel = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    sel.value = reduced ? (selected ? 1 : 0) : withTiming(selected ? 1 : 0, { duration: 180, easing: Easing.bezier(0.22, 1, 0.36, 1) });
  }, [selected, reduced, sel]);
  const rowA = useAnimatedStyle(() => ({ transform: [{ scale: 1 - press.value * 0.02 }] }));
  const checkA = useAnimatedStyle(() => ({ opacity: sel.value, transform: [{ scale: 0.6 + sel.value * 0.4 }] }));
  return (
    <Reanimated.View style={[s.row, first && s.rowFirst, selected && s.rowOn, rowA]}>
      <Pressable testID={`af-option-${option.key}`}
        style={s.rowPress}
        onPress={onPress}
        onPressIn={() => { press.value = withTiming(1, PRESS_IN); }}
        onPressOut={() => { press.value = withSpring(0, RELEASE); }}
      >
        <View style={s.rowLead}>
          <View style={s.checkSlot}>
            <Reanimated.View style={checkA}>
              <Ionicons name="checkmark-circle" size={21} color={colors.primary} />
            </Reanimated.View>
            {/* Empty affordance keeps the checkbox/radio distinction: multi = rounded square, single = circle. */}
            {!selected ? <View style={[s.checkRing, selection === 'multi' && s.checkRingSquare]} /> : null}
          </View>
          <Text style={[s.label, selected && s.labelOn]} numberOfLines={1}>{option.label}</Text>
        </View>
        <View style={s.countPill}>
          <Text style={s.countText}>{grouped(option.count)}</Text>
        </View>
      </Pressable>
    </Reanimated.View>
  );
}

export default function AdvancedQuestionCard({
  titleKey, descriptionKey, brandImage, selection, options, unknownCount: _unknownCount, progressCur, progressTotal,
  liveCount, initialKeys, onConfirm, onSkip, onBack, onSkipAll, onClose,
}: AdvancedQuestionCardProps) {
  const { t } = useI18n();
  const [sel, setSel] = useState<string[]>(initialKeys ?? []);
  const [count, setCount] = useState<number | null>(null);
  const reduced = useReducedMotion();

  // Question-transition: the body fades/rises in whenever the QUESTION changes (keyed on titleKey) —
  // no hard cuts between steps. Decoration only; reduced motion renders instantly.
  const enter = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    // Restore the answer recorded for THIS question (owner 2026-08-22: Back must bring the previous
    // selection back with the question, not an empty card). A never-answered question passes none.
    setSel(initialKeys ?? []);
    lastTapRef.current = null;
    enter.value = reduced ? 1 : 0;
    enter.value = withTiming(1, { duration: 240, easing: Easing.bezier(0.22, 1, 0.36, 1) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleKey]);
  const enterA = useAnimatedStyle(() => ({ opacity: enter.value, transform: [{ translateY: (1 - enter.value) * 8 }] }));

  // Animated progress fill — subtle, shared by every question so single/multi never differ.
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
  }, [sel.join(','), titleKey]);

  // Interaction contract (owner 2026-08-22, SUPERSEDES the 2026-08-11 auto-advance): a single tap
  // SELECTS ONLY — the user must be able to see what they picked and the recomputed count before
  // committing to it. A second tap on the SAME option within DOUBLE_TAP_MS confirms and advances
  // exactly one question; «متابعة» does the same deliberately.
  //
  // There is deliberately NO separate double-click/long-press handler: both taps run through this
  // ONE onPress path and only the second one calls onConfirm, so a double tap can never fire a
  // "select" handler and an "advance" handler as two competing paths and skip two questions. It
  // also means a single tap is never held back waiting to see whether a second one arrives — the
  // selection and its count land immediately, which is what makes this feel right on touch.
  const lastTapRef = useRef<{ key: string; at: number } | null>(null);
  const pick = (key: string) => {
    if (selection === 'multi') { // checkbox: toggle, several picks expected → only «متابعة» commits
      lastTapRef.current = null;
      setSel((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
      return;
    }
    const last = lastTapRef.current;
    const now = Date.now();
    // Decided off the tap LOG, never off `sel`: two clicks can land without a state flush between
    // them, and reading stale `sel` would silently turn a double tap back into a plain select.
    if (last && last.key === key && now - last.at <= DOUBLE_TAP_MS) {
      lastTapRef.current = null;
      setSel([key]);
      // The ONE commit path for a double tap: fires once, then returns — the same tap can never
      // fall through to the select branch below and advance a second question.
      onConfirm([key]);
      return;
    }
    lastTapRef.current = { key, at: now };
    setSel((cur) => (cur[0] === key ? [] : [key])); // radio: replace / slow tap-again clears
  };

  return (
    <Shell onClose={onClose} countChip={count}>
      {progressTotal > 1 ? (
        <View style={s.progRow}>
          <View style={s.progTrack}>
            <Animated.View style={[s.progFill, { width: fillWidth }]} />
          </View>
        </View>
      ) : null}
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <Reanimated.View style={enterA}>
          <Text style={s.qt} testID="af-question-title">{t(titleKey)}</Text>
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
          {/* One tiny availability line instead of database language (owner 2026-08-16): the numbers
              come from what we actually know about the current listings — say that plainly, once. */}
          <Text style={s.note}>{t('Options reflect the information available for the current listings')}</Text>
          <View style={s.foot}>
            <Tap style={s.primaryBtn} testID="af-confirm" onPress={() => onConfirm(sel)}>
              <Text style={s.primaryTxt}>
                {selection === 'multi'
                  ? (count != null ? t('Continue · {count} results', { count: grouped(count) }) : t('Continue'))
                  : (count != null ? t('Show {count} results', { count: grouped(count) }) : t('Show results'))}
              </Text>
            </Tap>
            <View style={s.footRow}>
              {/* «رجوع» is on EVERY question, including the first — from the first one it leaves the
                  interview entirely and hands the pre-AF controls back (owner 2026-08-22 §2). */}
              <Pressable style={s.skipLink} testID="af-back" onPress={onBack} hitSlop={8}>
                <Text style={s.backTxt}>{t('Back')}</Text>
              </Pressable>
              <Pressable style={s.skipLink} testID="af-skip" onPress={onSkip} hitSlop={8}>
                <Text style={s.skipTxt}>{t('Skip')}</Text>
              </Pressable>
              <Pressable style={s.skipLink} testID="af-skip-all" onPress={onSkipAll} hitSlop={8}>
                <Text style={s.skipAllTxt}>{t('Show results')}</Text>
              </Pressable>
            </View>
          </View>
        </Reanimated.View>
      </ScrollView>
    </Shell>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.screenSide },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.scrim },
  card: {
    width: '100%', maxWidth: 380, maxHeight: '100%', backgroundColor: colors.paper,
    borderRadius: radius.sheet, overflow: 'hidden', borderLeftWidth: 6, borderLeftColor: colors.dark, ...cardShadow,
  },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: space.card, paddingTop: space.card, paddingBottom: 10 },
  titleWrap: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  barTitle: { fontFamily: font.family.bold, fontSize: 14, color: colors.dark },
  barSide: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveChip: { backgroundColor: colors.tint, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  liveChipTx: { fontFamily: font.family.bold, fontSize: 12, color: colors.primary, fontVariant: ['tabular-nums'] },
  xBtn: { width: 30, height: 30, borderRadius: radius.pill, backgroundColor: colors.segTrack, alignItems: 'center', justifyContent: 'center' },

  progRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: space.card, marginBottom: 4 },
  progTrack: { flex: 1, height: 3, backgroundColor: colors.line, borderRadius: 3, overflow: 'hidden' },
  progFill: { height: '100%', backgroundColor: colors.dark, borderRadius: 3 },

  loadingBody: { paddingHorizontal: space.card, paddingVertical: 36, alignItems: 'center', justifyContent: 'center' },

  // Opening state — count first (the reward), then the invitation, then one soft supporting line.
  introBody: { paddingHorizontal: space.card, paddingTop: 22, paddingBottom: 20, alignItems: 'center' },
  introCount: { fontFamily: font.family.bold, fontSize: 26, color: colors.dark, fontVariant: ['tabular-nums'] },
  introTitle: { fontFamily: font.family.bold, fontSize: 17, color: colors.ink, marginTop: 10, textAlign: 'center' },
  introSupport: { fontFamily: font.family.regular, fontSize: 13, color: colors.muted, lineHeight: 20, marginTop: 8, textAlign: 'center', maxWidth: 300 },
  introFoot: { marginTop: 20, alignSelf: 'stretch', gap: 12, alignItems: 'center' },
  introLink: { paddingVertical: 4 },

  body: { paddingHorizontal: space.card, paddingTop: space.base, paddingBottom: 20 },
  qt: { fontFamily: font.family.bold, fontSize: 19, color: colors.ink, lineHeight: 27, paddingHorizontal: 2, paddingTop: 8 },
  desc: { fontFamily: font.family.regular, fontSize: 12.5, color: colors.muted, paddingHorizontal: 2, paddingTop: 5 },

  // Shared brand-image slot — one fixed position (under the subtitle, above the options) and one
  // style for ANY question that names a brandImage token. The PNG carries its own branding; the
  // strip is a neutral token-only frame.
  brandStrip: {
    marginTop: 10, alignItems: 'center', justifyContent: 'center', paddingVertical: 8,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.fieldLine, borderRadius: radius.field,
  },
  brandImg: { width: 150, height: 46 },

  // Options: soft rounded stand-alone rows with breathing room (no dense bordered table) — the
  // Claude-question feel. Selection fills the row with the brand tint + primary border.
  list: { marginTop: 14, gap: 8 },
  row: {
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.fieldLine,
    borderRadius: radius.field,
  },
  rowFirst: {},
  rowOn: { backgroundColor: colors.tint, borderColor: colors.primary },
  rowPress: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 14, paddingHorizontal: 14 },
  rowLead: { flexDirection: 'row', alignItems: 'center', gap: 11, flexShrink: 1 },
  checkSlot: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  checkRing: { position: 'absolute', width: 19, height: 19, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.pickLine },
  checkRingSquare: { borderRadius: 6 },
  label: { fontFamily: font.family.medium, fontSize: 15, color: colors.ink, flexShrink: 1 },
  labelOn: { fontFamily: font.family.bold, color: colors.dark },
  countPill: { backgroundColor: colors.tint, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 2, minWidth: 34, alignItems: 'center' },
  countText: { fontFamily: font.family.bold, fontSize: 12.5, color: colors.primary, fontVariant: ['tabular-nums'] },

  note: { marginTop: 12, marginHorizontal: 2, fontFamily: font.family.regular, fontSize: 11.5, color: colors.muted, lineHeight: 16 },

  foot: { marginTop: 18, gap: 10 },
  tapInner: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 13 },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: radius.chip, alignSelf: 'stretch' },
  primaryTxt: { fontFamily: font.family.bold, fontSize: 14.5, color: colors.surface },
  footRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 2 },
  skipLink: { paddingVertical: 4, flexShrink: 1 },
  skipTxt: { fontFamily: font.family.semibold, fontSize: 13.5, color: colors.dark },
  backTxt: { fontFamily: font.family.semibold, fontSize: 13.5, color: colors.muted },
  skipAllTxt: { fontFamily: font.family.medium, fontSize: 12.5, color: colors.muted },
});
