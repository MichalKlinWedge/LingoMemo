import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Body } from '@/components/ui';
import { color, size } from '@/constants/theme';
import { useSpeak } from '@/lib/speak';

import { SpeakButton } from './speak-button';
import { type ExerciseProps, list, str } from './types';

/**
 * Zadanie z wyborem: tłumaczenie z listy albo uzupełnianie luki w zdaniu. Odpowiedź leci
 * natychmiast po dotknięciu kafelka — dziecko nie ma potwierdzać wyboru drugim dotknięciem.
 *
 * Głośnik stoi OBOK kafelka, nie w środku: kafelek ma 72 px i cały jest celem dotyku, więc
 * drugi przycisk w jego środku kradłby trafienia.
 */
export function ChoiceExercise({
  exercise,
  locked,
  onAnswer,
  targetLang,
  result,
}: ExerciseProps & { targetLang: string; result: 'correct' | 'wrong' | null }) {
  const [picked, setPicked] = useState<string | null>(null);
  const { speak } = useSpeak(targetLang);
  const options = list(exercise.payload.options);
  const isBlank = exercise.type === 'fill_blank_choice';
  const sentence = str(exercise.payload.sentence);
  const [before, after] = isBlank ? sentence.split('{{blank}}') : ['', ''];

  const pick = (option: string) => {
    if (locked) return;
    setPicked(option);
    // Wybór sam się wymawia — ten sam dźwięk, co z głośnika obok. Dziecko i tak dotyka
    // kafelka, więc usłyszy słówko także wtedy, gdy po głośnik nigdy nie sięga. Opcje są tu
    // zawsze w języku uczonym (`fill_blank_choice` i `translate_ab`).
    speak(option);
    onAnswer({ choice: option });
  };

  return (
    <View style={styles.wrap}>
      {isBlank ? (
        <View style={styles.card}>
          <Text style={styles.sentence}>
            {before}
            <Text style={styles.blank}> {picked ?? '…'} </Text>
            {after}
          </Text>
          {str(exercise.payload.translation) !== '' && <Body muted>{str(exercise.payload.translation)}</Body>}
        </View>
      ) : (
        <Text style={styles.word}>{str(exercise.payload.prompt)}</Text>
      )}

      <View style={styles.options}>
        {options.map((option) => {
          const state = picked === option && result !== null ? result : null;
          return (
            <View key={option} style={styles.row}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: picked === option, disabled: locked && picked !== option }}
                disabled={locked && picked !== option}
                onPress={() => pick(option)}
                style={({ pressed }) => [
                  styles.tile,
                  picked === option && styles.tilePicked,
                  state === 'correct' && styles.tileCorrect,
                  state === 'wrong' && styles.tileWrong,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.tileText}>{option}</Text>
              </Pressable>
              <SpeakButton text={option} lang={targetLang} />
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: size.gap * 1.5 },
  card: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: size.radius,
    borderWidth: 1,
    gap: size.gap,
    padding: size.pad,
  },
  sentence: { color: color.text, fontSize: 24, lineHeight: 36, textAlign: 'center' },
  blank: { backgroundColor: color.brandLight, color: color.brandDark, fontWeight: '700' },
  word: { color: color.text, fontSize: size.prompt, fontWeight: '700', textAlign: 'center' },
  options: { gap: size.gap },
  row: { alignItems: 'center', flexDirection: 'row', gap: size.gap },
  tile: {
    alignItems: 'center',
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: size.radius,
    borderWidth: 2,
    flex: 1,
    justifyContent: 'center',
    minHeight: size.tapAnswer,
    paddingHorizontal: size.pad,
  },
  tilePicked: { borderColor: color.brand },
  tileCorrect: { backgroundColor: color.grassLight, borderColor: color.grass },
  tileWrong: { backgroundColor: color.coralLight, borderColor: color.coral },
  tileText: { color: color.text, fontSize: size.text, fontWeight: '700', textAlign: 'center' },
  pressed: { opacity: 0.8 },
});
