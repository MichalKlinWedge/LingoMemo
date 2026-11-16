import { EXERCISE_LABEL, dbErrorMessage, type ExerciseType } from '@lingomemo/core';
import type { Json } from '@lingomemo/db';
import * as Crypto from 'expo-crypto';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Body, Button, Card, Chip, Field, Message, Screen, Title } from '@/components/ui';
import { stopwatch } from '@/lib/clock';
import { supabase } from '@/lib/supabase';

/**
 * PoC-M1: czy baza wpuszcza telefon i jak szybko odpowiada.
 *
 * Mierzymy to, co czuje dziecko: czas od dotknięcia „Sprawdź” do werdyktu. Próg z planu to 400 ms
 * — decyzja o regionie `dub1` mówi, że 200 ms to różnica między „natychmiast” i „zacina się”.
 * Oceny nie liczymy tutaj: wysyłamy surową odpowiedź do `submit_attempt` i pokazujemy, co wróciło.
 */

type Lesson = { id: string; title: string };

type Exercise = {
  id: string;
  type: string;
  sort_order: number;
  concept_id: string | null;
  points: number;
  payload: Record<string, Json>;
};

type Verdict = {
  correct: boolean;
  nearMiss: boolean;
  retry?: boolean;
  reason?: 'typo' | 'order';
  grade: number;
  points: number;
  correctAnswer: Json;
};

type Summary = { total: number; correct: number; score: number; stars: number; xp: number; lessonPassed: boolean };

type Run = {
  sessionId: string;
  items: Exercise[];
  skipped: number;
  index: number;
  /** Czas od dotknięcia lekcji do pokazania pierwszego zadania (sesja + pobranie zadań). */
  enterMs: number;
  /** Czasy odpowiedzi w milisekundach — materiał pomiarowy. */
  times: number[];
  verdict: Verdict | null;
  summary: Summary | null;
};

/** Typy zadań, które ten pomiar obsługuje. Reszta (pary, rozsypanka, obrazki) jest w Etapie M2. */
const TYPING = new Set(['translate_ab', 'translate_ba', 'inflection']);
const CHOICE = new Set(['fill_blank_choice']);

const str = (value: Json | undefined): string => (typeof value === 'string' ? value : '');
const options = (value: Json | undefined): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

/** Lekcje otwarte dla tego konta. Bez testów powtórkowych — ich zestaw zależy od zaległości. */
function readLessons() {
  return supabase
    .from('v_my_lessons')
    .select('id, title, sort_order, is_unlocked, kind')
    .eq('is_unlocked', true)
    .neq('kind', 'review')
    .order('sort_order')
    .limit(30);
}

export default function Zadanie() {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [text, setText] = useState('');
  /** Licznik przeładowań listy: zmiana wartości uruchamia efekt jeszcze raz. */
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    void readLessons().then(({ data, error: fault }) => {
      if (!alive) return;
      if (fault) {
        setError(dbErrorMessage(fault, 'Nie udało się wczytać lekcji.'));
        setLessons([]);
        return;
      }
      setLessons((data ?? []).map(({ id, title }) => ({ id, title })));
    });
    return () => {
      alive = false;
    };
  }, [tick]);

  const start = async (lesson: Lesson) => {
    setBusy(true);
    setError(null);
    const took = stopwatch();
    const { data: sessionId, error: startFault } = await supabase.rpc('start_lesson_session', {
      p_lesson: lesson.id,
      p_idempotency_key: Crypto.randomUUID(),
      p_stage: 1,
      p_level: 1,
      p_preview: false,
    });
    if (startFault) {
      setBusy(false);
      setError(dbErrorMessage(startFault, 'Nie udało się zacząć lekcji.'));
      return;
    }
    const { data: raw, error: listFault } = await supabase.rpc('get_lesson_exercises', {
      p_lesson: lesson.id,
      p_stage: 1,
      p_level: 1,
      p_preview: false,
    });
    const enterMs = took();
    setBusy(false);
    if (listFault) {
      setError(dbErrorMessage(listFault, 'Nie udało się pobrać zadań.'));
      return;
    }
    const all = (raw ?? []) as unknown as Exercise[];
    const items = all.filter((item) => TYPING.has(item.type) || CHOICE.has(item.type));
    if (items.length === 0) {
      setError('Ta lekcja nie ma zadań obsługiwanych w PoC (zostają pary, rozsypanka i obrazki).');
      return;
    }
    setText('');
    setRun({
      sessionId: sessionId as unknown as string,
      items,
      skipped: all.length - items.length,
      index: 0,
      enterMs,
      times: [],
      verdict: null,
      summary: null,
    });
  };

  const answer = async (payload: Record<string, Json>) => {
    if (run === null) return;
    const exercise = run.items[run.index];
    setBusy(true);
    const took = stopwatch();
    const { data, error: fault } = await supabase.rpc('submit_attempt', {
      p_session: run.sessionId,
      p_exercise: exercise.id,
      p_answer: payload as Json,
      p_hint_used: false,
    });
    const ms = took();
    setBusy(false);
    if (fault) {
      setError(dbErrorMessage(fault, 'Nie udało się sprawdzić odpowiedzi.'));
      return;
    }
    setRun({ ...run, verdict: data as unknown as Verdict, times: [...run.times, ms] });
  };

  const next = async () => {
    if (run === null) return;
    // Prośba o poprawienie literówki nie jest jeszcze oceną — zadanie zostaje to samo.
    if (run.verdict?.retry === true) {
      setRun({ ...run, verdict: null });
      return;
    }
    if (run.index + 1 < run.items.length) {
      setText('');
      setRun({ ...run, index: run.index + 1, verdict: null });
      return;
    }
    setBusy(true);
    const { data, error: fault } = await supabase.rpc('finish_lesson_session', { p_session: run.sessionId });
    setBusy(false);
    if (fault) {
      setError(dbErrorMessage(fault, 'Nie udało się zamknąć lekcji.'));
      return;
    }
    setRun({ ...run, verdict: null, summary: data as unknown as Summary });
  };

  if (run === null) {
    return (
      <Screen>
        {error !== null && <Message kind="error" text={error} />}
        <Card>
          <Title>Wybierz lekcję</Title>
          <Body muted>Lista z widoku v_my_lessons — tylko lekcje otwarte dla tego konta.</Body>
          {lessons === null && <Body muted>Wczytuję…</Body>}
          {lessons?.length === 0 && <Body>Brak otwartych lekcji na tym koncie.</Body>}
          {lessons?.map((lesson) => (
            <Button key={lesson.id} kind="answer" label={lesson.title} busy={busy} onPress={() => void start(lesson)} />
          ))}
        </Card>
      </Screen>
    );
  }

  if (run.summary !== null) {
    return (
      <Screen>
        <Card>
          <Title>Koniec etapu</Title>
          <Body>
            {run.summary.correct}/{run.summary.total} dobrze, {run.summary.stars} ★, +{run.summary.xp} pkt
            {run.summary.lessonPassed ? ', lekcja zaliczona' : ''}
          </Body>
        </Card>
        <Measurements run={run} />
        <Button
          label="Jeszcze raz"
          onPress={() => {
            setRun(null);
            setTick((value) => value + 1);
          }}
        />
      </Screen>
    );
  }

  const exercise = run.items[run.index];
  const label = EXERCISE_LABEL[exercise.type as ExerciseType] ?? exercise.type;
  const prompt = exercise.type === 'inflection' ? str(exercise.payload.base) : str(exercise.payload.prompt);
  const verdict = run.verdict;

  return (
    <Screen>
      {error !== null && <Message kind="error" text={error} />}
      <Card>
        <Chip>
          {label} · {run.index + 1} z {run.items.length}
        </Chip>

        {CHOICE.has(exercise.type) ? (
          <>
            <Body>{str(exercise.payload.sentence).replace('{{blank}}', ' ____ ')}</Body>
            <View style={{ gap: 12 }}>
              {options(exercise.payload.options).map((option) => (
                <Button
                  key={option}
                  kind="answer"
                  label={option}
                  disabled={verdict !== null}
                  busy={busy}
                  onPress={() => void answer({ choice: option })}
                />
              ))}
            </View>
          </>
        ) : (
          <>
            {str(exercise.payload.instruction) !== '' && <Body muted>{str(exercise.payload.instruction)}</Body>}
            <Title>{prompt}</Title>
            <Field
              value={text}
              onChangeText={setText}
              placeholder="Wpisz odpowiedź"
              autoCapitalize="none"
              autoCorrect={false}
              editable={verdict === null}
            />
            <Button
              label="Sprawdź"
              busy={busy}
              disabled={verdict !== null || text.trim() === ''}
              onPress={() => void answer({ text })}
            />
          </>
        )}

        {verdict !== null && (
          <Message
            kind={verdict.correct ? 'ok' : 'error'}
            text={
              verdict.retry === true
                ? verdict.reason === 'order'
                  ? 'Baza prosi o poprawkę: litery dobre, kolejność nie.'
                  : 'Baza prosi o poprawienie literówki.'
                : verdict.correct
                  ? `Dobrze${verdict.nearMiss ? ' (literówka wybaczona)' : ''}, +${verdict.points} pkt`
                  : `Źle. Poprawnie: ${JSON.stringify(verdict.correctAnswer)}`
            }
          />
        )}

        {verdict !== null && (
          <Button
            label={verdict.retry === true ? 'Popraw' : run.index + 1 < run.items.length ? 'Dalej' : 'Zakończ etap'}
            busy={busy}
            onPress={() => void next()}
          />
        )}
      </Card>

      <Measurements run={run} />
    </Screen>
  );
}

function Measurements({ run }: { run: Run }) {
  const { times, enterMs, skipped } = run;
  return (
    <Card>
      <Title>Pomiar</Title>
      <Body muted>Wejście w lekcję (sesja + zadania): {enterMs} ms</Body>
      {times.length === 0 ? (
        <Body muted>Pomiar zacznie się po pierwszej sprawdzonej odpowiedzi.</Body>
      ) : (
        <>
          <Body>
            Werdykt: mediana {median(times)} ms (min {Math.min(...times)}, max {Math.max(...times)}, n ={' '}
            {times.length})
          </Body>
          <Body muted>
            Próg z planu: mediana &lt; 400 ms{median(times) < 400 ? ' — spełniony' : ' — NIE spełniony'}
          </Body>
        </>
      )}
      {skipped > 0 && <Body muted>Pominięte zadania spoza PoC: {skipped}</Body>}
    </Card>
  );
}
