import { Pressable, StyleSheet, Text } from 'react-native';

import { color, size } from '@/constants/theme';

/**
 * Kafelki wspólne dla dopasowywania par i dopasowywania ze słuchu: połączona para do rozłączenia
 * i kafelek do wybrania. Oba mają 72 px wysokości — tyle, co każdy kafelek odpowiedzi.
 *
 * Par nie kodujemy kolorami: przy ośmiu i tak byłyby nie do odróżnienia, a dziecko
 * z zaburzeniami widzenia barw zostałoby z niczym.
 */
export function JoinedPair({
  label,
  onPress,
  disabled,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, styles.joined, pressed && styles.pressed]}
    >
      <Text style={styles.text}>✓ {label}</Text>
    </Pressable>
  );
}

export function PickTile({
  label,
  picked,
  onPress,
  disabled,
  accessibilityLabel,
}: {
  label: string;
  picked: boolean;
  onPress: () => void;
  disabled: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: picked, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, picked && styles.picked, pressed && styles.pressed]}
    >
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: size.radius,
    borderWidth: 2,
    justifyContent: 'center',
    minHeight: size.tapAnswer,
    paddingHorizontal: size.gap,
  },
  joined: { backgroundColor: color.grassLight, borderColor: color.grass },
  picked: { backgroundColor: color.brandLight, borderColor: color.brand },
  pressed: { opacity: 0.8 },
  text: { color: color.text, fontSize: size.text, fontWeight: '700', textAlign: 'center' },
});
