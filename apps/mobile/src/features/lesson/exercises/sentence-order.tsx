import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { color, size } from '@/constants/theme';

import { type ExerciseProps, list, str } from './types';

/** Klocek ze słowem. Osobno, żeby słowo w zdaniu i w rozsypance wyglądało tak samo. */
function Token({
  word,
  onPress,
  disabled,
  dimmed = false,
}: {
  word: string;
  onPress: () => void;
  disabled: boolean;
  dimmed?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.token, dimmed && styles.tokenDimmed, pressed && styles.pressed]}
    >
      <Text style={styles.tokenText}>{word}</Text>
    </Pressable>
  );
}

/**
 * Rozsypanka słowna. Dotknięcie klocka przenosi go do zdania, dotknięcie w zdaniu — z powrotem
 * do puli. Bez przeciągania: dla dziecka przeciąganie jest trudniejsze niż dotknięcie.
 *
 * Te same słowa mogą wystąpić dwa razy („the cat and the dog”), więc klocki rozróżniamy po
 * pozycji w puli, a nie po treści. Część klocków bywa zbędna — w łatwym wariancie zdania do puli
 * dochodzą słowa niepasujące, żeby wybór wymagał przeczytania zdania, a nie zużycia wszystkiego.
 */
export function SentenceOrderExercise({ exercise, locked, onAnswer }: ExerciseProps) {
  const tokens = list(exercise.payload.tokens);
  const [order, setOrder] = useState<number[]>([]);

  const used = new Set(order);
  // W łatwym wariancie wśród klocków są słowa niepasujące, więc zdanie jest gotowe wtedy, gdy
  // dziecko tak uzna — nie wtedy, gdy zużyje wszystkie klocki.
  const complete = order.length >= 2;

  return (
    <View style={styles.wrap}>
      <Text style={styles.prompt}>{str(exercise.payload.prompt) || 'Ułóż zdanie'}</Text>

      {/* Linia zdania — widoczna także pusta, żeby było wiadomo, gdzie lądują słowa. */}
      <View style={styles.line} accessibilityLabel="Twoje zdanie">
        {order.length === 0 && <Text style={styles.hint}>Dotknij słów po kolei…</Text>}
        {order.map((tokenIndex, position) => (
          <Token
            key={`${tokenIndex}-${position}`}
            word={tokens[tokenIndex] ?? ''}
            disabled={locked}
            onPress={() => {
              if (!locked) setOrder(order.filter((_, at) => at !== position));
            }}
          />
        ))}
      </View>

      <View style={styles.pool} accessibilityLabel="Słowa do wyboru">
        {tokens.map((word, index) =>
          used.has(index) ? null : (
            <Token
              key={index}
              word={word}
              dimmed
              disabled={locked}
              onPress={() => {
                if (!locked) setOrder([...order, index]);
              }}
            />
          ),
        )}
      </View>

      <Button
        label="Sprawdź"
        disabled={locked || !complete}
        onPress={() => onAnswer({ tokens: order.map((index) => tokens[index] ?? '') })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: size.gap * 1.5 },
  prompt: { color: color.text, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  line: {
    alignItems: 'center',
    borderColor: color.line,
    borderRadius: size.radius,
    borderStyle: 'dashed',
    borderWidth: 2,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    minHeight: 84,
    padding: size.gap,
  },
  hint: { color: color.muted, fontSize: 17, paddingHorizontal: 8 },
  pool: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  token: {
    alignItems: 'center',
    backgroundColor: color.brandLight,
    borderBottomWidth: 4,
    borderColor: color.brand,
    borderRadius: size.radius,
    borderWidth: 2,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: size.pad,
  },
  tokenDimmed: { backgroundColor: color.surface, borderColor: color.line },
  tokenText: { color: color.text, fontSize: size.text, fontWeight: '700' },
  pressed: { opacity: 0.8 },
});
