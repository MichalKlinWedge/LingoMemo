import { plural, WORDS } from '@lingomemo/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { canShowPictures, Picture } from '@/components/picture';
import { Body, Button, Message, Screen, Title } from '@/components/ui';
import { color, size } from '@/constants/theme';
import { type Board, type BoardWord, loadBoard } from '@/features/words/load';
import { mediaUrl } from '@/lib/media';
import { useSpeak } from '@/lib/speak';

/**
 * Plansza ze słówkami — tryb nauki przed lekcją. Dotknięcie karty czyta słowo, „Przeczytaj
 * wszystkie" idzie po kolei. Nic tu nie jest sprawdzane i nic nie wchodzi do powtórek.
 */
export default function BoardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [loaded, setLoaded] = useState<{ board?: Board; error?: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void loadBoard(id).then((result) => {
      if (!alive) return;
      setLoaded(result.ok ? { board: result.value } : { error: result.error });
    });
    return () => {
      alive = false;
    };
  }, [id]);

  if (loaded?.error !== undefined) {
    return (
      <Screen>
        <Message kind="error" text={loaded.error} />
      </Screen>
    );
  }

  if (loaded?.board === undefined) {
    return (
      <Screen>
        <Body muted>Wczytuję słówka…</Body>
      </Screen>
    );
  }

  const board = loaded.board;

  return (
    <Screen>
      <Title>🦉 {board.title}</Title>
      {board.words.length === 0 ? (
        <Body muted>
          {board.kind === 'review'
            ? 'Powtórka nie ma własnych słówek — składa się z tego, co już przerabiałeś w innych lekcjach.'
            : 'Ta lekcja nie ma jeszcze słówek do posłuchania.'}
        </Body>
      ) : (
        <>
          <Body muted>
            Dotknij słówka, żeby je usłyszeć. {plural(board.words.length, WORDS)} do nauczenia się przed lekcją.
          </Body>
          <WordBoard words={board.words} targetLang={board.targetLang} />
        </>
      )}
      <Button label="Zacznij lekcję" onPress={() => router.replace(`/lekcja/${id}`)} />
    </Screen>
  );
}

/**
 * Przerwa między słowami przy czytaniu po kolei. Bez niej jedno słowo wchodzi na drugie i dziecko
 * słyszy ciąg dźwięków, a nie listę; z dłuższą przerwą czekanie zaczyna nużyć.
 */
const GAP_MS = 700;

/**
 * Cała karta jest przyciskiem, nie głośnik w jej narożniku: dziecko dotyka tego, co widzi.
 * Hak `useSpeak` jest jeden na całą planszę, nie jeden na kartę.
 *
 * „Przeczytaj wszystkie" idzie słowo po słowie, bo syntezator nie mówi, ile wypowiedź potrwa,
 * a stała przerwa dla wszystkich albo ucinałaby dłuższe słowa, albo kazała czekać po krótkich.
 * Numer przebiegu w `runRef` pilnuje, żeby spóźnione wywołanie zwrotne nie ruszyło listy dalej
 * po przerwaniu czytania.
 */
function WordBoard({ words, targetLang }: { words: BoardWord[]; targetLang: string }) {
  const { speak, hasVoice } = useSpeak(targetLang);
  const [reading, setReading] = useState<number | null>(null);
  const runRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      runRef.current += 1;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const readFrom = (index: number, run: number) => {
    if (run !== runRef.current || index >= words.length) {
      if (run === runRef.current) setReading(null);
      return;
    }
    setReading(index);
    // Następne słowo startuje z wywołania zwrotnego poprzedniego: syntezator nie mówi z góry,
    // ile wypowiedź potrwa, a stała przerwa dla wszystkich słów albo ucinałaby dłuższe,
    // albo kazała czekać po krótkich.
    speak(words[index].target, () => {
      if (run !== runRef.current) return;
      timerRef.current = setTimeout(() => readFrom(index + 1, run), GAP_MS);
    });
  };

  const readAll = () => {
    runRef.current += 1;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    readFrom(0, runRef.current);
  };

  const stopAll = () => {
    runRef.current += 1;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setReading(null);
  };

  return (
    <View style={styles.wrap}>
      {hasVoice ? (
        reading === null ? (
          <Button kind="quiet" label="🔈 Przeczytaj wszystkie" onPress={readAll} />
        ) : (
          <Button kind="quiet" label="⏹ Zatrzymaj" onPress={stopAll} />
        )
      ) : (
        <Body muted>Ten telefon nie ma głosu dla tego języka — słówka zostają do czytania.</Body>
      )}

      <View style={styles.grid}>
        {words.map((word, index) => {
          const url = mediaUrl(word.imagePath);
          return (
            <Pressable
              key={word.conceptId}
              accessibilityRole="button"
              accessibilityLabel={`${word.target} — ${word.source}`}
              onPress={() => {
                stopAll();
                speak(word.target);
              }}
              style={({ pressed }) => [styles.card, reading === index && styles.cardReading, pressed && styles.pressed]}
            >
              {url !== null && canShowPictures ? (
                <Picture uri={url} style={styles.image} />
              ) : (
                <Text style={styles.emoji}>{word.emoji !== '' ? word.emoji : '🔈'}</Text>
              )}
              <Text style={styles.target}>{word.target}</Text>
              {word.ipa !== null && word.ipa !== '' && <Text style={styles.ipa}>[{word.ipa}]</Text>}
              <Text style={styles.source}>{word.source}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: size.gap },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: size.gap },
  card: {
    alignItems: 'center',
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: size.radius,
    borderWidth: 2,
    flexBasis: '47%',
    flexGrow: 1,
    gap: 2,
    minHeight: 150,
    paddingHorizontal: 8,
    paddingVertical: size.gap,
  },
  cardReading: { backgroundColor: color.brandLight, borderColor: color.brand },
  pressed: { opacity: 0.8 },
  image: { height: 64, width: '100%' },
  emoji: { fontSize: 44, lineHeight: 56 },
  target: { color: color.text, fontSize: size.text, fontWeight: '700', textAlign: 'center' },
  ipa: { color: color.muted, fontSize: 14 },
  source: { color: color.muted, fontSize: 16, textAlign: 'center' },
});
