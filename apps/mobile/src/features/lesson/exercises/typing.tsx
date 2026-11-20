import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Body, Button, Field } from '@/components/ui';
import { color, size } from '@/constants/theme';
import { useSpeak } from '@/lib/speak';

import { SpeakButton } from './speak-button';
import { type ExerciseProps, str } from './types';

/**
 * Zadanie z pisaniem: tłumaczenie, odmiana i zdanie z luką do uzupełnienia. Porównania dokonuje
 * baza — bez wielkości liter, bez ogonków i z tolerancją jednej literówki — więc tu nie ma żadnej
 * walidacji poza tym, czy dziecko w ogóle coś napisało.
 */
export function TypingExercise({
  exercise,
  locked,
  onAnswer,
  onDraft,
  promptLang,
}: ExerciseProps & { promptLang: string }) {
  const [value, setValue] = useState('');
  const isInflection = exercise.type === 'inflection';
  const isBlank = exercise.type === 'fill_blank_typing';
  const prompt = isInflection ? str(exercise.payload.base) : str(exercise.payload.prompt);
  // Zdanie z luką. Ta sama treść, co w wersji z kafelkami (`choice.tsx`), tylko bez listy.
  const [before, after] = isBlank ? str(exercise.payload.sentence).split('{{blank}}') : ['', ''];

  // Tłumaczenie NA polski: nad polem stoi słowo w języku kursu, więc czytamy je samo, zaraz po
  // wejściu — tak samo jak w zadaniu ze słuchu. W drugą stronę (`translate_ab`) tego nie robimy:
  // tam słowo jest po polsku, a głośnik czytający dziecku „czarny" po polsku niczego nie uczy.
  const samoCzyta = exercise.type === 'translate_ba';
  const { speak, hasVoice, voicesLoaded } = useSpeak(promptLang);

  /**
   * Zależnością jest `exercise.id`, nie każdy render: po odpowiedzi zadanie zostaje na ekranie
   * z werdyktem, a drugie czytanie w środku sprawdzania brzmiałoby jak usterka. Czekamy na listę
   * głosów i dokładamy tę samą ćwierć sekundy co zadanie ze słuchu — ekran ma się najpierw
   * pojawić, a potem odezwać. Bez głosu dla tego języka nie próbujemy wcale; zostaje głośnik
   * przy słowie, który sam się wtedy nie pokazuje.
   */
  useEffect(() => {
    if (!samoCzyta || !voicesLoaded || !hasVoice || prompt.trim() === '') return;
    const timer = setTimeout(() => speak(prompt), 250);
    return () => clearTimeout(timer);
  }, [exercise.id, samoCzyta, voicesLoaded, hasVoice, speak, prompt]);

  const change = (text: string) => {
    setValue(text);
    onDraft?.(text.trim() !== '');
  };

  return (
    <View style={styles.wrap}>
      {isInflection && (
        <Body muted>{str(exercise.payload.instruction) || str(exercise.payload.formLabel)}</Body>
      )}
      {isBlank ? (
        // Luka pokazuje to, co dziecko właśnie wpisuje: zdanie składa się na oczach, więc widać,
        // czy brzmi sensownie — a o to w tym zadaniu chodzi.
        <View style={styles.card}>
          <Text style={styles.sentence}>
            {before}
            <Text style={styles.blank}> {value.trim() === '' ? '…' : value} </Text>
            {after}
          </Text>
          {/* Polskie zdanie pod luką, drobnym drukiem — tak samo jak w wersji z kafelkami.
              Nie jest podpowiedzią do usunięcia, a warunkiem odpowiadalności: bez niego i bez
              listy dziecko nie ma po czym pojąć, którego słowa brakuje. Napisać i tak musi je
              z pamięci, w języku kursu. */}
          {str(exercise.payload.translation) !== '' && (
            <Body muted>{str(exercise.payload.translation)}</Body>
          )}
        </View>
      ) : (
        <View style={styles.prompt}>
          <Text style={styles.word}>{prompt}</Text>
          <SpeakButton text={prompt} lang={promptLang} />
        </View>
      )}

      <Field
        value={value}
        onChangeText={change}
        editable={!locked}
        placeholder="Wpisz odpowiedź"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        returnKeyType="done"
        onSubmitEditing={() => {
          if (!locked && value.trim() !== '') onAnswer({ text: value });
        }}
      />

      {/* Dziecko, które szuka „ż” na klawiaturze, przestaje myśleć o słówku. Baza i tak
          porównuje bez ogonków i bez wielkich liter — warto, żeby o tym wiedziało. */}
      <Body muted>Możesz pisać bez ogonków — „zazolc” liczy się tak samo jak „zażółć”.</Body>

      <Button
        label="Sprawdź"
        disabled={locked || value.trim() === ''}
        onPress={() => onAnswer({ text: value })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: size.gap * 1.5 },
  prompt: { alignItems: 'center', flexDirection: 'row', gap: size.gap, justifyContent: 'center' },
  word: { color: color.text, fontSize: size.prompt, fontWeight: '700', textAlign: 'center' },
  // Zdanie z luką — te same wymiary co w wersji z kafelkami, żeby podpowiedź (ta sama luka,
  // tylko z listą) nie przestawiała ekranu dziecku pod palcem.
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
});
