import type { Json } from '@lingomemo/db';
import { StyleSheet, View } from 'react-native';

import { Body, Button, Message } from '@/components/ui';
import { size } from '@/constants/theme';
import { useSpeak } from '@/lib/speak';

import { JoinedPair, PickTile } from './matching';
import { type ExerciseProps, list, str } from './types';
import { useMatching } from './use-matching';

type AudioItem = { text: string; audioPath: string | null };

/** Kafelki do odsłuchania. Tekst jedzie do klienta, bo bez słowa nie ma czym mówić. */
const audioItems = (value: Json | undefined): AudioItem[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
        const text = typeof item.text === 'string' ? item.text : '';
        if (text === '') return [];
        return [{ text, audioPath: typeof item.audioPath === 'string' ? item.audioPath : null }];
      })
    : [];

/**
 * Dopasowywanie ze słuchu: po lewej głośniki, po prawej słowa po polsku. Dziecko słucha słowa
 * w języku kursu i szuka jego znaczenia — albo odwrotnie, bo zaczyna dowolna kolumna.
 *
 * Kafelki ze słuchem pokazują NUMER, nie tekst. Gdyby pokazywały napis, zadanie przestałoby być
 * ze słuchu — dałoby się je zrobić, nie włączając dźwięku ani razu. Z tego samego powodu numer
 * zostaje na liście połączonych par.
 */
export function ListenMatchExercise({ exercise, locked, onAnswer, onSkip }: ExerciseProps) {
  const audio = audioItems(exercise.payload.audio);
  const words = list(exercise.payload.words);
  const lang = str(exercise.payload.lang) || 'en-GB';
  const { speak, hasVoice, voicesLoaded } = useSpeak(lang);

  const { pairs, used, pick, undo, isPicked } = useMatching(audio.length, (done) => onAnswer({ pairs: done }));

  const numberOf = (text: string) => audio.findIndex((item) => item.text === text) + 1;

  const tap = (item: AudioItem) => {
    if (locked) return;
    // Dotknięcie zawsze odtwarza — także ponowne, bo dziecko zwykle chce usłyszeć jeszcze raz.
    speak(item.text);
    if (!isPicked('b', item.text)) pick('b', item.text);
  };

  // Bez głosu zadania ze słuchu nie da się zrobić uczciwie — mówimy to wprost i przechodzimy
  // dalej BEZ odpowiedzi. Puste pary poszłyby do bazy jako błąd.
  if (voicesLoaded && !hasVoice) {
    return (
      <View style={styles.wrap}>
        <Message
          kind="error"
          text={
            'Ten telefon nie ma głosu dla tego języka, więc pomijamy zadanie ze słuchu. ' +
            'Nie liczy się ani na plus, ani na minus.'
          }
        />
        <Button kind="quiet" label="Dalej" onPress={onSkip} />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Body muted>{str(exercise.payload.instruction) || 'Posłuchaj i dopasuj polskie słowo'}</Body>

      {pairs.length > 0 && (
        <View style={styles.list}>
          {pairs.map((pair) => (
            <JoinedPair
              key={pair.a}
              label={`🔈 ${numberOf(pair.b)} — ${pair.a}`}
              disabled={locked}
              onPress={() => undo(pair)}
              accessibilityLabel={`Rozłącz parę: nagranie ${numberOf(pair.b)} — ${pair.a}`}
            />
          ))}
        </View>
      )}

      <View style={styles.columns}>
        <View style={styles.column}>
          {audio
            .filter((item) => !used.b.has(item.text))
            .map((item) => (
              <PickTile
                key={item.text}
                label={`🔈 ${numberOf(item.text)}`}
                picked={isPicked('b', item.text)}
                disabled={locked}
                onPress={() => tap(item)}
                accessibilityLabel={`Posłuchaj nagrania ${numberOf(item.text)}`}
              />
            ))}
        </View>
        <View style={styles.column}>
          {words
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
