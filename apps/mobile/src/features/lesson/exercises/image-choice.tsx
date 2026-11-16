import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { color, size } from '@/constants/theme';
import { mediaUrl } from '@/lib/media';

import { SpeakButton } from './speak-button';
import { type ExerciseProps, list, str } from './types';

/**
 * Wybór obrazka: słowo u góry, pod nim obrazki do dotknięcia. Jedyne zadanie, które dziecko
 * zrobi, zanim nauczy się czytać w obcym języku — odpowiedzią jest obrazek, nie napis.
 *
 * Siatka ma dwie kolumny, a generowana treść zawsze cztery obrazki. Obrazki opisujemy numerem
 * („Obrazek 2”), nie nazwą pliku: nazwa zwykle zdradza odpowiedź, a czytnik ekranu przeczytałby
 * ją dziecku na głos.
 *
 * Zwykły `Image` z React Native, nie `expo-image`: nowy moduł natywny wymagałby przebudowania
 * aplikacji na telefonie, a pamięć podręczna przyda się dopiero przy nauce bez sieci.
 */
export function ImageChoiceExercise({
  exercise,
  locked,
  onAnswer,
  targetLang,
  result,
  correctAnswer,
}: ExerciseProps & {
  targetLang: string;
  result: 'correct' | 'wrong' | null;
  /** Ścieżka właściwego obrazka — przychodzi z bazy dopiero po błędnej odpowiedzi. */
  correctAnswer: string | null;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  // Ścieżki obrazków, których nie udało się wczytać. Pusty kafelek wygląda jak dziura w układzie:
  // dziecko dotyka nicości, a administrator nie wie, że czegoś brakuje.
  const [broken, setBroken] = useState<string[]>([]);
  const options = list(exercise.payload.options);
  const speak = str(exercise.payload.speak);
  const lang = str(exercise.payload.lang) || targetLang;

  const pick = (option: string) => {
    if (locked) return;
    setPicked(option);
    onAnswer({ choice: option });
  };

  const stateOf = (option: string): 'correct' | 'wrong' | null => {
    if (result === null) return null;
    if (option === correctAnswer) return 'correct';
    if (option === picked) return result;
    return null;
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.promptRow}>
        <Text style={styles.prompt}>{str(exercise.payload.prompt)}</Text>
        {speak !== '' && <SpeakButton text={speak} lang={lang} />}
      </View>

      <View style={styles.grid}>
        {options.map((option, index) => {
          const state = stateOf(option);
          const url = mediaUrl(option);
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityLabel={`Obrazek ${index + 1}`}
              accessibilityState={{ selected: picked === option, disabled: locked && picked !== option }}
              disabled={locked && picked !== option}
              onPress={() => pick(option)}
              style={({ pressed }) => [
                styles.cell,
                picked === option && styles.cellPicked,
                state === 'correct' && styles.cellCorrect,
                state === 'wrong' && styles.cellWrong,
                pressed && styles.pressed,
              ]}
            >
              {broken.includes(option) || url === null ? (
                <View style={styles.missing}>
                  <Text style={styles.missingIcon}>🖼</Text>
                  <Text style={styles.missingText}>brak pliku</Text>
                </View>
              ) : (
                <Image
                  source={{ uri: url }}
                  style={styles.image}
                  resizeMode="contain"
                  onError={() => setBroken((was) => (was.includes(option) ? was : [...was, option]))}
                />
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: size.gap * 1.5 },
  promptRow: { alignItems: 'center', flexDirection: 'row', gap: size.gap, justifyContent: 'center' },
  prompt: { color: color.text, fontSize: size.prompt, fontWeight: '700', textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: size.gap },
  cell: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: size.radius,
    borderWidth: 2,
    flexBasis: '47%',
    flexGrow: 1,
    padding: 10,
  },
  cellPicked: { borderColor: color.brand },
  cellCorrect: { backgroundColor: color.grassLight, borderColor: color.grass },
  cellWrong: { backgroundColor: color.coralLight, borderColor: color.coral },
  pressed: { opacity: 0.8 },
  image: { aspectRatio: 1, width: '100%' },
  missing: {
    alignItems: 'center',
    aspectRatio: 1,
    backgroundColor: color.background,
    borderRadius: 12,
    gap: 4,
    justifyContent: 'center',
    width: '100%',
  },
  missingIcon: { fontSize: 32 },
  missingText: { color: color.muted, fontSize: 13 },
});
