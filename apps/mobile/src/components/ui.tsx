import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { color, size } from '@/constants/theme';

/**
 * Odpowiedniki klas z `globals.css` (`.btn-primary`, `.btn-answer`, `.card`, `.field`, `.chip`,
 * `.msg-error`, `.msg-ok`). Komponent nie dobiera sobie własnych rozmiarów ani kolorów —
 * tak samo jak na webie.
 */

export function Screen({ children }: { children: ReactNode }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenInner} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted === true && styles.bodyMuted]}>{children}</Text>;
}

export function Chip({ children }: { children: ReactNode }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{children}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'answer' | 'quiet';
  disabled?: boolean;
  busy?: boolean;
}) {
  const off = disabled === true || busy === true;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        kind === 'answer' && styles.buttonAnswer,
        kind === 'quiet' && styles.buttonQuiet,
        pressed && styles.buttonPressed,
        off && styles.buttonOff,
      ]}
    >
      {busy === true ? (
        <ActivityIndicator color={kind === 'primary' ? '#ffffff' : color.brand} />
      ) : (
        <Text style={[styles.buttonText, kind !== 'primary' && styles.buttonTextDark]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Field(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput {...props} style={[styles.field, props.style]} placeholderTextColor={color.muted} />;
}

export function Message({ text, kind }: { text: string; kind: 'error' | 'ok' }) {
  return (
    <View style={[styles.message, kind === 'ok' ? styles.messageOk : styles.messageError]}>
      <Text style={styles.messageText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.background, flex: 1 },
  screenInner: { gap: size.gap, padding: size.pad, paddingBottom: 48 },
  card: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: size.radius,
    borderWidth: 1,
    gap: size.gap,
    padding: size.pad,
  },
  title: { color: color.text, fontSize: 24, fontWeight: '700' },
  body: { color: color.text, fontSize: size.text, lineHeight: 28 },
  bodyMuted: { color: color.muted, fontSize: 16, lineHeight: 24 },
  chip: { alignSelf: 'flex-start', backgroundColor: color.brandLight, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  chipText: { color: color.brandDark, fontSize: 15, fontWeight: '700' },
  button: {
    alignItems: 'center',
    backgroundColor: color.brand,
    borderRadius: size.radius,
    justifyContent: 'center',
    minHeight: size.tap,
    paddingHorizontal: size.pad,
  },
  buttonAnswer: { backgroundColor: color.surface, borderColor: color.line, borderWidth: 2, minHeight: size.tapAnswer },
  buttonQuiet: { backgroundColor: color.brandLight },
  buttonPressed: { opacity: 0.8 },
  buttonOff: { opacity: 0.45 },
  buttonText: { color: '#ffffff', fontSize: size.text, fontWeight: '700', textAlign: 'center' },
  buttonTextDark: { color: color.text },
  field: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: size.radius,
    borderWidth: 2,
    color: color.text,
    fontSize: 22,
    minHeight: size.tapAnswer,
    paddingHorizontal: size.pad,
    textAlign: 'center',
  },
  message: { borderRadius: size.radius, padding: size.pad },
  messageError: { backgroundColor: color.coralLight },
  messageOk: { backgroundColor: color.grassLight },
  messageText: { color: color.text, fontSize: 17, lineHeight: 24 },
});
