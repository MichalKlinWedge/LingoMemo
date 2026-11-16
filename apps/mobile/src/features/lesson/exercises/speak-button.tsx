import { Pressable, StyleSheet, Text } from 'react-native';

import { color, size } from '@/constants/theme';
import { useSpeak } from '@/lib/speak';

/**
 * Głośnik przy słówku. Gdy telefon nie ma głosu dla tego języka, przycisku nie ma wcale —
 * lepiej tak, niż żeby dziecko dotykało i nic się nie działo.
 */
export function SpeakButton({
  text,
  lang,
  big = false,
  label = 'Posłuchaj',
}: {
  text: string;
  lang: string;
  big?: boolean;
  label?: string;
}) {
  const { speak, speaking, hasVoice } = useSpeak(lang);
  if (!hasVoice) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${text}`}
      onPress={() => speak(text)}
      style={({ pressed }) => [big ? styles.big : styles.round, pressed && styles.pressed]}
    >
      <Text style={big ? styles.bigText : styles.roundText}>
        {speaking ? '🔊' : '🔈'}
        {big ? ` ${label}` : ''}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  round: {
    alignItems: 'center',
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: 999,
    borderWidth: 2,
    height: size.tap,
    justifyContent: 'center',
    width: size.tap,
  },
  roundText: { fontSize: 24 },
  big: {
    alignItems: 'center',
    backgroundColor: color.brand,
    borderRadius: size.radius,
    justifyContent: 'center',
    minHeight: 80,
    paddingHorizontal: size.pad,
  },
  bigText: { color: '#ffffff', fontSize: 24, fontWeight: '700' },
  pressed: { opacity: 0.8 },
});
