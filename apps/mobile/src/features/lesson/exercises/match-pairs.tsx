import { StyleSheet, View } from 'react-native';

import { Body } from '@/components/ui';
import { size } from '@/constants/theme';

import { JoinedPair, PickTile } from './matching';
import { type ExerciseProps, list, str } from './types';
import { useMatching } from './use-matching';

/**
 * Dopasowywanie par: dwie kolumny słów, po polsku i w języku kursu. Dziecko dotyka kafelka po
 * jednej stronie i odpowiednika po drugiej — para znika z kolumn i ląduje na liście połączonych.
 * Zaczyna dowolna kolumna, bo nie ma powodu narzucać kierunku.
 *
 * Głośników przy prawej kolumnie nie ma — tak samo jak na webie przy wąskim ekranie: zabierałyby
 * tyle miejsca, że kolumna byłaby wyraźnie węższa od lewej. Słowa słychać w innych zadaniach.
 */
export function MatchPairsExercise({ exercise, locked, onAnswer }: ExerciseProps) {
  const left = list(exercise.payload.pairsLeft);
  const right = list(exercise.payload.pairsRight);

  const { pairs, used, pick, undo, isPicked } = useMatching(left.length, (done) => onAnswer({ pairs: done }));

  return (
    <View style={styles.wrap}>
      <Body muted>{str(exercise.payload.instruction) || 'Połącz słówka w pary'}</Body>

      {pairs.length > 0 && (
        <View style={styles.list}>
          {pairs.map((pair) => (
            <JoinedPair
              key={pair.a}
              label={`${pair.a} — ${pair.b}`}
              disabled={locked}
              onPress={() => undo(pair)}
              accessibilityLabel={`Rozłącz parę ${pair.a} — ${pair.b}`}
            />
          ))}
        </View>
      )}

      <View style={styles.columns}>
        <View style={styles.column}>
          {left
            .filter((item) => !used.a.has(item))
            .map((item) => (
              <PickTile
                key={item}
                label={item}
                picked={isPicked('a', item)}
                disabled={locked}
                onPress={() => pick('a', item)}
              />
            ))}
        </View>
        <View style={styles.column}>
          {right
            .filter((item) => !used.b.has(item))
            .map((item) => (
              <PickTile
                key={item}
                label={item}
                picked={isPicked('b', item)}
                disabled={locked}
                onPress={() => pick('b', item)}
              />
            ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: size.gap * 1.5 },
  list: { gap: 8 },
  columns: { flexDirection: 'row', gap: size.gap },
  column: { flex: 1, gap: size.gap },
});
