import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Body, Button, Field, Message } from '@/components/ui';
import { size } from '@/constants/theme';
import { useSpeak } from '@/lib/speak';

import { SpeakButton } from './speak-button';
import { type ExerciseProps, str } from './types';

/**
 * Zadanie ze słuchu. Słowa nie widać — dziecko ma je usłyszeć i zapisać.
 *
 * Mówimy sami zaraz po wejściu na zadanie, ale duży przycisk „Posłuchaj jeszcze raz” jest
 * podstawą, a nie dodatkiem: dziecko słucha po kilka razy.
 *
 * Nagrania z pola `audio_path` telefon na razie nie odtwarza (to byłby `expo-audio`); seed
 * i panel liczą na syntezator, a pole jest zapasem. Bez głosu zadanie jest pomijane bez
 * zapisania próby — tak samo jak na webie.
 */
export function ListeningExercise({ exercise, locked, onAnswer, onSkip, onDraft }: ExerciseProps) {
  const [value, setValue] = useState('');
  const text = str(exercise.payload.speak);
  const lang = str(exercise.payload.lang) || 'en-GB';
  const { speak, hasVoice, voicesLoaded } = useSpeak(lang);

  useEffect(() => {
    if (!voicesLoaded || !hasVoice) return;
    // Chwila zwłoki: ekran zadania ma się najpierw pojawić, a potem odezwać.
    const timer = setTimeout(() => speak(text), 250);
    return () => clearTimeout(timer);
  }, [hasVoice, speak, text, voicesLoaded]);

  const change = (next: string) => {
    setValue(next);
    onDraft?.(next.trim() !== '');
  };

  if (voicesLoaded && !hasVoice) {
    return (
      <View style={styles.wrap}>
        <Message
          kind="error"
          text={
            'Ten telefon nie ma głosu dla tego języka, więc pomijamy zadanie ze słuchu. ' +
            'Nie liczy się ani na plus, ani na minus. Głos dodaje się w ustawieniach mowy Androida.'
          }
        />
        <Button kind="quiet" label="Dalej" onPress={onSkip} />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Body muted>Posłuchaj i napisz, co słyszysz.</Body>
      <SpeakButton text={text} lang={lang} big label="Posłuchaj jeszcze raz" />

      <Field
        value={value}
        onChangeText={change}
        editable={!locked}
        placeholder="Co usłyszałeś?"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        returnKeyType="done"
        onSubmitEditing={() => {
          if (!locked && value.trim() !== '') onAnswer({ text: value });
        }}
      />

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
});
