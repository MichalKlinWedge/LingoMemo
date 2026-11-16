import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Body, Button, Field } from '@/components/ui';
import { color, size } from '@/constants/theme';

import { SpeakButton } from './speak-button';
import { type ExerciseProps, str } from './types';

/**
 * Zadanie z pisaniem: tłumaczenie i odmiana. Porównania dokonuje baza — bez wielkości liter,
 * bez ogonków i z tolerancją jednej literówki — więc tu nie ma żadnej walidacji poza tym,
 * czy dziecko w ogóle coś napisało.
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
  const prompt = isInflection ? str(exercise.payload.base) : str(exercise.payload.prompt);

  const change = (text: string) => {
    setValue(text);
    onDraft?.(text.trim() !== '');
  };

  return (
    <View style={styles.wrap}>
      {isInflection && (
        <Body muted>{str(exercise.payload.instruction) || str(exercise.payload.formLabel)}</Body>
      )}
      <View style={styles.prompt}>
        <Text style={styles.word}>{prompt}</Text>
        <SpeakButton text={prompt} lang={promptLang} />
      </View>

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
});
