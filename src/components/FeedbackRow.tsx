// ChatGPT-style feedback row — thumbs up / down (mutually exclusive; highlighted when active) +
// share. POSITION (owner 2026-07-09): rendered ONCE per results response, directly BELOW the
// «عرضت لك أول N إعلانات. تبي أعرض لك المزيد…» message — NOT under each property card (it originally
// shipped per-card; owner moved it). The «شكراً على ملاحظتك» confirmation is NOT rendered here — it
// fires the `onFeedback` callback and the HOST shows a ChatGPT-style toast at the top of the chat
// (owner 2026-07-09: toast above the conversation, not next to the buttons). Feedback is stored
// LOCALLY only (lib/listingFeedback, keyed by the results-message id → rates the RESPONSE, not one
// listing). UI-only: no search/cards/ranking.
import { useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '@/theme/tokens';
import { useI18n } from '@/i18n';
import { getListingFeedback, setListingFeedback, type FeedbackRating } from '@/lib/listingFeedback';

export default function FeedbackRow({
  feedbackKey, shareUrl, onFeedback,
}: {
  feedbackKey: string;
  shareUrl?: string;
  onFeedback?: () => void; // fired when a rating is SET (not cleared) — host shows the thanks toast
}) {
  const { t, isRTL } = useI18n();
  const [rating, setRating] = useState<FeedbackRating | null>(() => getListingFeedback(feedbackKey));
  const [copied, setCopied] = useState(false);

  // Only one of up/down active; clicking the active one clears it (ChatGPT feel). The thanks toast
  // fires only when a rating is SET (not when cleared). Side effects run OUTSIDE any state updater
  // (never during render) to avoid React's "cannot update a component while rendering" warning.
  const vote = (r: FeedbackRating) => {
    const next: FeedbackRating | null = rating === r ? null : r;
    setRating(next);
    setListingFeedback(feedbackKey, next);
    if (next) onFeedback?.();
  };

  // Normal share/copy flow: OS share sheet where available, else copy the link (the share icon
  // briefly becomes a check). Never throws to the user (cancel = no-op).
  const onShare = async () => {
    const url = shareUrl || 'https://ezhalah-app.vercel.app';
    try {
      if (Platform.OS === 'web') {
        const nav: any = typeof navigator !== 'undefined' ? navigator : null;
        if (nav?.share) { await nav.share({ url }); return; }
        await Clipboard.setStringAsync(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      } else {
        await Share.share({ message: url, url });
      }
    } catch { /* user cancelled or share unavailable — no-op */ }
  };

  return (
    <View style={[fb.container, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
      <View style={[fb.row, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
        <FbButton icon={rating === 'up' ? 'thumbs-up' : 'thumbs-up-outline'} active={rating === 'up'} onPress={() => vote('up')} label={t('Helpful')} />
        <FbButton icon={rating === 'down' ? 'thumbs-down' : 'thumbs-down-outline'} active={rating === 'down'} onPress={() => vote('down')} label={t('Not helpful')} />
        <FbButton icon={copied ? 'checkmark' : 'share-outline'} active={copied} onPress={onShare} label={t('Share')} />
      </View>
    </View>
  );
}

function FbButton({ icon, active, onPress, label }: { icon: any; active: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ hovered, pressed }: any) => [fb.btn, (hovered || pressed) && fb.btnHover, active && fb.btnActive]}
    >
      <Ionicons name={icon} size={16} color={active ? colors.primary : colors.muted} />
    </Pressable>
  );
}

const fb = StyleSheet.create({
  // Thin row below the more-results message.
  container: { width: '100%', paddingHorizontal: 4, paddingTop: 6 },
  row: { alignItems: 'center', gap: 2 },
  // Small icon button (~30px target). Active = light green wash + accent icon (set inline).
  btn: { padding: 7, borderRadius: 9, ...(Platform.OS === 'web' ? { cursor: 'pointer' as any } : {}) },
  btnHover: { backgroundColor: '#f1f4f1' },
  btnActive: { backgroundColor: colors.tint },
});
