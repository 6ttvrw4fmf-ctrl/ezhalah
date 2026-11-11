// «كيف نحسبها؟» — the popup a signed-in user sees after tapping the home headline's market fact, or the small link under it
// (owner 2026-11-11, replacing the 2026-10-22 «كيف تشتغل؟» sheet). Laid out like the «نماذج إزهله» card:
//   · the ✕ is ALWAYS on the physical right, in both languages (owner: «the x is always on the right, no matter what»);
//   · in the centre, our eagle glides in and lands on the falconer's glove — the sign-in story, played slowly
//     (assets/images/falconer-howto.svg, scripts/build-howto-falconer.mjs), replayed on every open;
//   · «صقارنا» with Shaheen's mark, the story, then the five rules;
//   · no «تمام» button: the ✕ or a tap anywhere outside the card closes it.
// The site count is the live one the share card and welcome line use (siteCount.ts); unknown → the clause is left out.
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image as XImage } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '@/theme/tokens';
import { HOW_IT_WORKS } from '@/lib/insightHowItWorks';
import { loadSiteCount, siteCountNow } from '@/data/siteCount';

const EAGLE = require('../../assets/images/falconer-howto.svg');
const SHAHEEN = require('../../assets/models/shaheen.png');
// a browser keeps ONE timeline per SVG URL, so every open gets its own URL and the eagle flies again
const freshSource = (src: unknown, play: number) => {
  const uri = typeof src === 'string' ? src : (src as { uri?: string } | null)?.uri;
  return uri ? { uri: `${uri}${uri.includes('?') ? '&' : '?'}play=${play}` } : src;
};

export function InsightHowItWorks({ visible, locale, onClose }: { visible: boolean; locale: 'ar' | 'en'; onClose: () => void }) {
  const c = HOW_IT_WORKS[locale];
  const rtl = locale === 'ar';
  const align = { textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' } as const;
  const row = { flexDirection: 'row' } as const; // the page's own direction puts the mark first: right in Arabic, left in English
  const [sites, setSites] = useState<number | null>(siteCountNow());
  const plays = useRef(0);
  const [play, setPlay] = useState(0);
  useEffect(() => {
    if (!visible) return;
    plays.current += 1;
    setPlay(plays.current);
    let alive = true;
    void loadSiteCount().then((n) => { if (alive && n !== null) setSites(n); });
    return () => { alive = false; };
  }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.screen}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={c.close} testID="insight-how-backdrop" />
        <View style={s.card} testID="insight-how-it-works">
          <Pressable style={s.close} onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={c.close} testID="insight-how-close">
            <Ionicons name="close" size={24} color={colors.ink} />
          </Pressable>
          <ScrollView contentContainerStyle={s.body}>
            <Text style={s.title} accessibilityRole="header">{c.title}</Text>
            <View style={s.eagleBox}>
              {/* mirrored in Arabic, as on the home page (HeroFalconer flip) */}
              {visible ? <XImage source={freshSource(EAGLE, play) as any} contentFit="contain" accessible={false} style={[s.eagle, rtl && s.flip]} testID="insight-how-eagle" /> : null}
            </View>
            <View style={[s.falconerRow, row]}>
              <XImage source={SHAHEEN} contentFit="contain" tintColor={colors.primary} accessible={false} style={s.mark} testID="insight-how-shaheen" />
              <Text style={[s.falconer, align]}>{c.falconer}</Text>
            </View>
            <Text style={[s.story, align]}>{c.story(sites)}</Text>
            <Text style={[s.rulesTitle, align]}>{c.rulesTitle}</Text>
            {c.rules.map((r, i) => (
              <Text key={r.title} style={[s.rule, align, i === c.rules.length - 1 && s.ruleLast]}>
                <Text style={s.ruleTitle}>{`${rtl ? String(i + 1).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]) : i + 1}. ${r.title}: `}</Text>
                {r.body}
              </Text>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { width: '100%', maxWidth: 460, maxHeight: '88%', backgroundColor: colors.surface, borderRadius: 20, overflow: 'hidden' },
  // physical right in BOTH languages — never flipped by RTL
  close: { position: 'absolute', top: 14, right: 14, zIndex: 2, padding: 2 },
  body: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 24 },
  title: { fontSize: 20, fontWeight: '700', color: colors.ink, textAlign: 'center', marginHorizontal: 30 },
  eagleBox: { alignItems: 'center', justifyContent: 'center', height: 200, marginTop: 4, marginBottom: 4 },
  eagle: { width: 161, height: 200 },
  flip: { transform: [{ scaleX: -1 }] },
  falconerRow: { alignItems: 'center', gap: 8, marginBottom: 6 },
  mark: { width: 34, height: 34 },
  falconer: { fontSize: 18, fontWeight: '700', color: colors.ink },
  story: { fontSize: 15, lineHeight: 26, color: colors.body, marginBottom: 16 },
  rulesTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, marginBottom: 6 },
  rule: { fontSize: 14, lineHeight: 24, color: colors.body, marginBottom: 8 },
  ruleLast: { color: colors.muted },
  ruleTitle: { fontWeight: '700', color: colors.ink },
});
