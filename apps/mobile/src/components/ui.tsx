import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, size } from '@/constants/theme';

/**
 * Odpowiedniki klas z `globals.css` (`.btn-primary`, `.btn-answer`, `.card`, `.field`, `.chip`,
 * `.msg-error`, `.msg-ok`). Komponent nie dobiera sobie własnych rozmiarów ani kolorów —
 * tak samo jak na webie.
 */

export function Screen({ children }: { children: ReactNode }) {
  // Zapas na dole wielkości paska nawigacji Androida: w trybie edge-to-edge pasek leży NA
  // treści, więc bez tego ostatni przycisk ekranu zostaje pod przyciskami systemu.
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.screenInner, { paddingBottom: 32 + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
    >
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

/**
 * Znacznik stanu. `label` zastępuje treść czytnikowi ekranu — tam, gdzie na ekranie stoi sama
 * ikona i liczba („⭐ 7091"), czytnik ma powiedzieć, czego ta liczba dotyczy. Na telefonie nie
 * ma dymka po najechaniu kursorem, więc to jedyne miejsce, w którym da się te słowa zapisać.
 *
 * Z `onPress` znacznik jest przejściem — tak samo jak w pasku na webie, gdzie każdy znacznik
 * jest odnośnikiem. Sam znacznik jest niższy niż próg palca (56 px), bo w rzędzie stoi ich
 * kilka; pole dotyku powiększa `hitSlop` do tego progu, zamiast rozpychać pasek.
 */
export function Chip({
  children,
  label,
  onPress,
}: {
  children: ReactNode;
  label?: string;
  onPress?: () => void;
}) {
  if (onPress === undefined) {
    return (
      <View style={styles.chip} accessible={label !== undefined} accessibilityLabel={label}>
        <Text style={styles.chipText}>{children}</Text>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={12}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, pressed === true && styles.chipPressed]}
    >
      <Text style={styles.chipText}>{children}</Text>
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  compact,
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'answer' | 'quiet' | 'danger';
  /** Przycisk w rzędzie ze znacznikami — patrz `buttonCompact`. */
  compact?: boolean;
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
        kind === 'danger' && styles.buttonDanger,
        compact === true && styles.buttonCompact,
        pressed && styles.buttonPressed,
        off && styles.buttonOff,
      ]}
    >
      {busy === true ? (
        <ActivityIndicator color={kind === 'primary' || kind === 'danger' ? '#ffffff' : color.brand} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            kind !== 'primary' && kind !== 'danger' && styles.buttonTextDark,
            compact === true && styles.buttonTextCompact,
          ]}
        >
          {label}
        </Text>
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
  screenInner: { gap: size.gap, padding: size.pad },
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
  // Wyściółka po bokach jest wąska przez pasek stanu: stoi w nim pięć znaczników w jednym
  // wierszu (punkty, seria, powtórki, podpowiedzi, klucze), a telefon w pionie ma 360 dp.
  // Przy 14 klucz przeskakiwał do drugiego wiersza już przy czterocyfrowych punktach, a tych
  // będą dziesiątki tysięcy. Przy 9, licząc z metryk Roboto, pięć znaczników schodzi do ~338 dp
  // i zostaje miejsce na punkty sześciocyfrowe (na szerszym telefonie — siedmiocyfrowe).
  chip: { alignSelf: 'flex-start', backgroundColor: color.brandLight, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6 },
  chipPressed: { opacity: 0.7 },
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
  // Czerwień znaczy „to przerywa” — na telefonie tylko wyjście z lekcji. Biały napis zostaje,
  // więc `buttonTextDark` tego rodzaju nie dotyczy.
  buttonDanger: { backgroundColor: color.coral },
  // Jedyne miejsce, gdzie schodzimy poniżej 56 px: przycisk stoi w rzędzie z paskiem postępu
  // i licznikiem zadań, a pełna wysokość rozpychała nagłówek lekcji — przy zadaniu z klawiaturą
  // brakuje wtedy miejsca na treść. 44 px to nadal próg trafienia palcem.
  buttonCompact: { minHeight: 44, paddingHorizontal: 14 },
  buttonPressed: { opacity: 0.8 },
  buttonOff: { opacity: 0.45 },
  buttonText: { color: '#ffffff', fontSize: size.text, fontWeight: '700', textAlign: 'center' },
  buttonTextDark: { color: color.text },
  buttonTextCompact: { fontSize: 17 },
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
