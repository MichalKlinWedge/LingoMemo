import { HINTS, plural, UNLOCKS } from '@lingomemo/core';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, Card, Chip, Message, Title } from '@/components/ui';
import { color, size } from '@/constants/theme';
import {
  askHint,
  type Answer,
  type Exercise,
  finishLesson,
  sessionKey,
  startLesson,
  submitAnswer,
  type Summary,
  type Verdict,
} from '@/features/lesson/api';
import { ChoiceExercise } from '@/features/lesson/exercises/choice';
import { ImageChoiceExercise } from '@/features/lesson/exercises/image-choice';
import { ListenMatchExercise } from '@/features/lesson/exercises/listen-match';
import { ListeningExercise } from '@/features/lesson/exercises/listening';
import { MatchPairsExercise } from '@/features/lesson/exercises/match-pairs';
import { SentenceOrderExercise } from '@/features/lesson/exercises/sentence-order';
import { TypingExercise } from '@/features/lesson/exercises/typing';
import { stopwatch } from '@/lib/clock';

type Phase = 'answering' | 'checking' | 'feedback' | 'done';

/**
 * Powrót na ekran kursu — `dismissTo`, nie `replace`.
 *
 * Ekran kursu leży już na stosie (to z niego wchodzi się w lekcję), więc `replace` nie wracał
 * na niego, tylko dokładał jego drugi egzemplarz. Po kilku lekcjach systemowy przycisk Wstecz
 * przewijał kilka identycznych ekranów, zanim doszedł do listy kursów. `dismissTo` zdejmuje
 * ekrany aż do tego, który tam jest, a gdyby go nie było — na przykład po wejściu w lekcję
 * prosto z powiadomienia — zachowa się dokładnie jak `replace`.
 *
 * Ekran kursu wczytuje się na nowo przy każdym pokazaniu (`useFocusEffect`
 * w `app/kurs/[slug].tsx`), więc powrót na istniejący ekran nie pokazuje gwiazdek i zamków
 * sprzed lekcji.
 */
function backToCourse(router: ReturnType<typeof useRouter>, courseSlug: string) {
  router.dismissTo(`/kurs/${courseSlug}`);
}

/**
 * Przebieg lekcji na telefonie. Pilnuje tylko kolejności zadań i tego, co widać na ekranie —
 * o tym, czy odpowiedź jest poprawna i ile jest za nią punktów, decyduje wyłącznie baza.
 * Odpowiednik `apps/web/src/app/lekcja/[id]/lesson-runner.tsx`; reguły są te same, bo to te
 * same funkcje bazy.
 */
export function LessonRunner({
  lessonId,
  courseSlug,
  exercises,
  sourceLang,
  targetLang,
  badgeNames,
  stage,
  stages,
  level,
  hintsLeft,
  unlockLeft,
  autoNextMs,
}: {
  lessonId: string;
  courseSlug: string;
  exercises: Exercise[];
  /** Język dziecka. Po nim czytamy polecenie w `translate_ab` — tam słowo jest po polsku. */
  sourceLang: string;
  targetLang: string;
  badgeNames: Record<string, string>;
  stage: number;
  stages: number;
  /** 1 łatwy (lekcja z etapami), 2 średni, 3 trudny — krótkie wejście na ośmiu słówkach. */
  level: number;
  hintsLeft: number;
  /** Punkty odblokowania sprzed lekcji — po zamknięciu poznajemy po różnicy, czy przybył nowy. */
  unlockLeft: number;
  autoNextMs: number;
}) {
  const [index, setIndex] = useState(0);
  // Zadania, które wracają w tym podejściu: numery tych, na które odpowiedź była zła. Kolejka
  // etapu to lista zadań plus te numery, więc pozycje od 0 do `exercises.length - 1` to pierwsze
  // pokazanie zadania, a wszystko dalej to powtórka. Tak samo jak na webie — patrz
  // `apps/web/src/app/lekcja/[id]/lesson-runner.tsx`.
  const [repeats, setRepeats] = useState<number[]>([]);
  const [phase, setPhase] = useState<Phase>('answering');
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [hintsWon, setHintsWon] = useState(0);
  const [unlocks, setUnlocks] = useState(unlockLeft);
  const [unlocksWon, setUnlocksWon] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Zadanie, w którego polu dziecko już coś napisało. Trzymamy IDENTYFIKATOR, nie flagę: przy
  // przejściu dalej przestaje pasować do bieżącego zadania, więc nie trzeba go zerować.
  const [draftOf, setDraftOf] = useState<string | null>(null);
  const [hints, setHints] = useState(hintsLeft);
  const [swapped, setSwapped] = useState<Record<number, Exercise>>({});
  const [fixAsked, setFixAsked] = useState<string | null>(null);
  const [fixReason, setFixReason] = useState<'typo' | 'order'>('typo');
  /** Rośnie przy każdym dotknięciu ekranu — odkłada automatyczne przejście dalej. */
  const [nudge, setNudge] = useState(0);

  const insets = useSafeAreaInsets();
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const sessionRef = useRef<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const tookRef = useRef<(() => number) | null>(null);

  // Kolejka etapu: najpierw wszystkie zadania po kolei, potem te, które wróciły po błędzie.
  // Trzymamy numery, nie same zadania — podpowiedź podmienia zadanie na łatwiejsze tylko na tej
  // jednej pozycji, więc powtórka pokazuje je znowu w pełnej postaci.
  const queue = [...exercises.map((_, nr) => nr), ...repeats];
  const total = queue.length;
  const repeat = index >= exercises.length;
  const exercise = swapped[index] ?? exercises[queue[index]];
  const hinted = swapped[index] !== undefined;

  useEffect(() => {
    tookRef.current = stopwatch();
  }, [index]);

  // Po sprawdzeniu odpowiedzi zjeżdżamy na dół: informacja zwrotna i „Dalej" są w treści, więc
  // przy dłuższym zadaniu (pary, rozsypanka) mogłyby wypaść poza ekran.
  useEffect(() => {
    if (phase === 'feedback') scrollRef.current?.scrollToEnd({ animated: true });
  }, [phase]);

  /** Sesja zakładana przy pierwszej odpowiedzi albo przy pierwszej podpowiedzi — nie wcześniej. */
  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionRef.current !== null) return sessionRef.current;
    keyRef.current ??= sessionKey();
    const started = await startLesson(lessonId, keyRef.current, stage, level);
    if (!started.ok) {
      setError(started.error);
      return null;
    }
    sessionRef.current = started.value;
    return started.value;
  }, [lessonId, level, stage]);

  const handleAnswer = useCallback(
    async (answer: Answer) => {
      if (phase !== 'answering' || exercise === undefined) return;
      setPhase('checking');
      setError(null);

      const session = await ensureSession();
      if (session === null) {
        setPhase('answering');
        return;
      }

      const result = await submitAnswer(
        session,
        exercise.id,
        answer,
        tookRef.current?.() ?? null,
        // Zadanie wzięte z podpowiedzi liczy się dla harmonogramu powtórek jako trudniejsze:
        // słówko wróci szybciej niż po samodzielnej odpowiedzi.
        hinted,
      );
      if (!result.ok) {
        setError(result.error);
        setPhase('answering');
        return;
      }

      // Prośba o poprawkę, a nie werdykt: baza nic nie zapisała i czeka na drugie podejście.
      // Wracamy do pisania z tym, co dziecko wpisało — poprawia się literówkę, nie pisze od nowa.
      if (result.value.retry === true) {
        setFixAsked(exercise.id);
        setFixReason(result.value.reason === 'order' ? 'order' : 'typo');
        setPhase('answering');
        return;
      }

      // Źle zrobione zadanie wraca na koniec kolejki etapu — jeszcze raz, w tym samym podejściu,
      // zaraz po tym, jak dziecko zobaczyło poprawną odpowiedź. Pominięcie też jest błędem,
      // więc też wraca. Tylko raz (`index` z pierwszego pokazania): inaczej dziecko, które
      // czegoś nie umie, kręciłoby się na jednym zadaniu do końca etapu. Wynik na tym nie traci
      // — baza liczy każdą odpowiedź z osobna, więc powtórka dokłada zadanie do mianownika.
      if (!result.value.correct && !repeat) {
        setRepeats((prev) => [...prev, index]);
      }

      setFixAsked(null);
      setVerdict(result.value);
      setPhase('feedback');
    },
    [ensureSession, exercise, hinted, index, phase, repeat],
  );

  const takeHint = useCallback(async () => {
    if (phase !== 'answering' || exercise === undefined) return;
    setError(null);
    const session = await ensureSession();
    if (session === null) return;

    const result = await askHint(session, exercise.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSwapped((prev) => ({ ...prev, [index]: result.value.exercise }));
    setHints(result.value.hintsLeft);
    setDraftOf(null);
    tookRef.current = stopwatch();
  }, [ensureSession, exercise, index, phase]);

  const next = useCallback(async () => {
    setVerdict(null);
    // Powtórzone zadanie ma ten sam identyfikator co za pierwszym razem, więc ślad po wpisanej
    // wtedy odpowiedzi nie zniknąłby sam — a z nim chowałoby się wyjście „Nie wiem, pomiń".
    setDraftOf(null);
    if (index + 1 < total) {
      setIndex(index + 1);
      setPhase('answering');
      return;
    }
    setPhase('checking');
    if (sessionRef.current === null) {
      // Etap, w którym dziecko nie odpowiedziało ani razu (same zadania ze słuchu, a telefon
      // bez głosu). Nie ma sesji, więc nie ma też czego podsumować.
      setPhase('done');
      return;
    }
    const finished = await finishLesson(sessionRef.current);
    if (!finished.ok) {
      setError(finished.error);
      setPhase('feedback');
      return;
    }
    setSummary(finished.value.summary);
    setHintsWon(Math.max(finished.value.hintsLeft - hints, 0));
    setHints(finished.value.hintsLeft);
    setUnlocksWon(Math.max(finished.value.unlockLeft - unlocks, 0));
    setUnlocks(finished.value.unlockLeft);
    setPhase('done');
  }, [hints, index, total, unlocks]);

  if (phase === 'done' && summary !== null) {
    return (
      <SummaryScreen
        summary={summary}
        lessonId={lessonId}
        courseSlug={courseSlug}
        badgeNames={badgeNames}
        hintsWon={hintsWon}
        unlocksWon={unlocksWon}
      />
    );
  }

  if (phase === 'done' || exercise === undefined) {
    return (
      <Exit
        courseSlug={courseSlug}
        text={
          exercise === undefined
            ? 'Ta lekcja nie ma jeszcze żadnych zadań.'
            : 'Tego etapu nie da się zrobić bez głosu w telefonie. Nic nie policzyliśmy.'
        }
      />
    );
  }

  const locked = phase !== 'answering';
  const hasDraft = draftOf !== null && draftOf === exercise.id;
  // O tym, czy tłumaczenie jest wyborem z listy, decyduje payload, nie typ zadania: ten sam
  // `translate_ab` raz ma `options`, a raz nie. Baza przyjmuje oba warianty (`text`/`choice`).
  const options = exercise.payload.options;
  const hasOptions = Array.isArray(options) && options.length >= 2;

  return (
    <View
      style={styles.screen}
      // Dotknięcie ekranu odkłada automatyczne przejście dalej — dziecko, które słucha słówka
      // głośnikiem, nie ma stracić ekranu sprzed nosa. `false` znaczy „tylko podglądam”.
      onStartShouldSetResponderCapture={() => {
        setNudge((value) => value + 1);
        return false;
      }}
    >
      <Progress
        index={index}
        total={total}
        stage={stage}
        stages={stages}
        level={level}
        hints={hints}
        repeat={repeat}
        courseSlug={courseSlug}
      />

      <ScrollView
        ref={scrollRef}
        // Zapas na dole: pasek nawigacji Androida leży NA treści (edge-to-edge), więc bez
        // wysokości wcięcia ostatni przycisk zostaje pod przyciskami systemu.
        contentContainerStyle={[styles.body, { paddingBottom: 24 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        {exercise.type === 'listening' ? (
          <ListeningExercise
            key={`${index}-${exercise.id}`}
            exercise={exercise}
            locked={locked}
            onAnswer={(answer) => void handleAnswer(answer)}
            onSkip={() => void next()}
            onDraft={(has) => setDraftOf(has ? exercise.id : null)}
          />
        ) : exercise.type === 'listen_match' ? (
          <ListenMatchExercise
            key={`${index}-${exercise.id}`}
            exercise={exercise}
            locked={locked}
            onAnswer={(answer) => void handleAnswer(answer)}
            onSkip={() => void next()}
          />
        ) : exercise.type === 'match_pairs' ? (
          <MatchPairsExercise
            key={`${index}-${exercise.id}`}
            exercise={exercise}
            locked={locked}
            onAnswer={(answer) => void handleAnswer(answer)}
            onSkip={() => void next()}
          />
        ) : exercise.type === 'image_choice' ? (
          <ImageChoiceExercise
            key={`${index}-${exercise.id}`}
            exercise={exercise}
            locked={locked}
            onAnswer={(answer) => void handleAnswer(answer)}
            onSkip={() => void next()}
            targetLang={targetLang}
            result={phase === 'feedback' && verdict !== null ? (verdict.correct ? 'correct' : 'wrong') : null}
            correctAnswer={
              phase === 'feedback' && verdict !== null && typeof verdict.correctAnswer === 'string'
                ? verdict.correctAnswer
                : null
            }
          />
        ) : exercise.type === 'sentence_order' ? (
          <SentenceOrderExercise
            key={`${index}-${exercise.id}`}
            exercise={exercise}
            locked={locked}
            onAnswer={(answer) => void handleAnswer(answer)}
            onSkip={() => void next()}
          />
        ) : exercise.type === 'fill_blank_choice' || (exercise.type === 'translate_ab' && hasOptions) ? (
          <ChoiceExercise
            key={`${index}-${exercise.id}`}
            exercise={exercise}
            locked={locked}
            onAnswer={(answer) => void handleAnswer(answer)}
            onSkip={() => void next()}
            targetLang={targetLang}
            result={phase === 'feedback' && verdict !== null ? (verdict.correct ? 'correct' : 'wrong') : null}
          />
        ) : (
          <TypingExercise
            key={`${index}-${exercise.id}`}
            exercise={exercise}
            locked={locked}
            onAnswer={(answer) => void handleAnswer(answer)}
            onSkip={() => void next()}
            onDraft={(has) => setDraftOf(has ? exercise.id : null)}
            // W `translate_ab` słowo nad polem jest w języku dziecka, w pozostałych w uczonym —
            // głośnik czytający „czarny” po angielsku brzmi jak awaria.
            promptLang={exercise.type === 'translate_ab' ? sourceLang : targetLang}
          />
        )}

        {/* Bliska pomyłka w pisaniu: baza prosi o poprawkę zamiast oceniać. Komunikat nie mówi,
            co jest źle — wtedy poprawianie byłoby przepisywaniem. */}
        {fixAsked === exercise.id && phase === 'answering' && (
          <Message
            kind="error"
            text={
              fixReason === 'order'
                ? 'Prawie! Wszystkie słowa są dobre, tylko w innej kolejności — poukładaj je i wyślij jeszcze raz.'
                : 'Prawie! Zajrzyj w litery i popraw — sprawdzimy jeszcze raz.'
            }
          />
        )}

        {/* Podpowiedź: to samo słówko w łatwiejszej postaci. Znika po użyciu na tym zadaniu
            i wtedy, gdy na dziś nic nie zostało. */}
        {phase === 'answering' && hints > 0 && !hinted && (
          <Button kind="quiet" label={`💡 Podpowiedź (${hints})`} onPress={() => void takeHint()} />
        )}

        {/* Wyjście dla dziecka, które utknęło: idzie do bazy jako `{"skipped": true}`, czyli
            liczy się jak błąd. Znika, gdy w polu coś już jest — ten przycisk nie czyta pola. */}
        {phase === 'answering' && !hasDraft && (
          <Pressable
            accessibilityRole="button"
            onPress={() => void handleAnswer({ skipped: true })}
            style={styles.skip}
          >
            <Text style={styles.skipText}>Nie wiem, pomiń</Text>
          </Pressable>
        )}

        {error !== null && <Message kind="error" text={error} />}

        {/* Informacja zwrotna stoi W TREŚCI, zaraz pod zadaniem — tam, gdzie chwilę wcześniej
            było „Nie wiem, pomiń". Przyklejona do dołu ekranu wchodziła pod przyciski systemowe
            Androida (tryb edge-to-edge), więc „Dalej" dało się dotknąć tylko częściowo. */}
        {phase === 'feedback' && verdict !== null && (
          <Feedback
            verdict={verdict}
            onNext={() => void next()}
            autoNextMs={autoNextMs}
            nudge={nudge}
            last={index + 1 >= total}
            // Po ostatnim zadaniu etapu kończy się etap, nie lekcja.
            lastLabel={stages > 1 && stage < stages ? 'Zakończ etap' : 'Zakończ lekcję'}
            // Przy wyborze obrazka poprawną odpowiedzią jest ścieżka do pliku. Dziecku mówi ona
            // tyle co nic — właściwy obrazek podświetla się na kafelku.
            showAnswer={exercise.type !== 'image_choice'}
          />
        )}
      </ScrollView>
    </View>
  );
}

function Progress({
  index,
  total,
  stage,
  stages,
  level,
  hints,
  repeat,
  courseSlug,
}: {
  index: number;
  total: number;
  stage: number;
  stages: number;
  level: number;
  hints: number;
  /** Zadanie, które wróciło po błędzie — dziecko ma wiedzieć, że to drugie podejście. */
  repeat: boolean;
  courseSlug: string;
}) {
  const router = useRouter();
  return (
    <View style={styles.head}>
      <View style={styles.headRow}>
        {/* Wyjście jest napisem, nie krzyżykiem: dziecko w drugiej klasie czyta „Wyjdź", a ✕ musi
            sobie wytłumaczyć. Czerwień mówi, że to wyjście bez dokończenia etapu. */}
        <Button kind="danger" label="Wyjdź" onPress={() => backToCourse(router, courseSlug)} />
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${Math.round((index / total) * 100)}%` }]} />
        </View>
        <Text style={styles.counter}>
          {index + 1}/{total}
        </Text>
      </View>
      <View style={styles.chips}>
        {stages > 1 && (
          <Chip>
            Etap {stage}/{stages}
          </Chip>
        )}
        {level > 1 && <Chip>{level === 2 ? 'Poziom średni' : 'Poziom trudny'}</Chip>}
        {/* Bez tego napisu dziecko widzi tylko, że ekran pokazuje coś, co już było. */}
        {repeat && <Chip>🔁 Jeszcze raz</Chip>}
        <Chip>💡 {hints}</Chip>
      </View>
    </View>
  );
}

/**
 * Informacja zwrotna. Po dobrej odpowiedzi lekcja idzie dalej sama po czasie z ustawień
 * aplikacji — tylko po dobrej (przy błędnej dziecko musi zdążyć przeczytać, jak było poprawnie)
 * i tylko gdy jest następne zadanie (zakończenie etapu zapisuje wynik, więc ten przycisk
 * dziecko naciska samo).
 */
function Feedback({
  verdict,
  onNext,
  autoNextMs,
  nudge,
  last,
  lastLabel,
  showAnswer,
}: {
  verdict: Verdict;
  onNext: () => void;
  autoNextMs: number;
  nudge: number;
  last: boolean;
  lastLabel: string;
  showAnswer: boolean;
}) {
  const auto = verdict.correct && !last;
  const shown = showAnswer && typeof verdict.correctAnswer === 'string' ? verdict.correctAnswer : null;

  useEffect(() => {
    if (!auto) return;
    const timer = setTimeout(onNext, autoNextMs);
    return () => clearTimeout(timer);
    // `nudge` celowo w zależnościach: każde dotknięcie ekranu odmierza czas od nowa.
  }, [auto, autoNextMs, nudge, onNext]);

  return (
    <View style={[styles.feedback, verdict.correct ? styles.feedbackOk : styles.feedbackBad]}>
      <Text style={[styles.feedbackTitle, { color: verdict.correct ? '#0f5c37' : '#8f2420' }]}>
        {verdict.correct ? '🎉 ' : verdict.skipped === true ? '👀 ' : '💪 '}
        {verdict.correct
          ? verdict.nearMiss
            ? 'Prawie! Zaliczone'
            : 'Brawo!'
          : verdict.skipped === true
            ? 'Pominięte'
            : 'Nie tym razem'}
      </Text>
      {!verdict.correct && shown !== null && (
        <Text style={styles.feedbackLine}>
          Poprawnie: <Text style={styles.strong}>{shown}</Text>
        </Text>
      )}
      {verdict.correct && verdict.points > 0 && <Text style={styles.feedbackLine}>+{verdict.points} punktów</Text>}
      <Button label={last ? lastLabel : 'Dalej'} onPress={onNext} />
    </View>
  );
}

/**
 * Podsumowanie. Przy lekcji wieloetapowej mówi o ETAPIE, a puchar zostaje na koniec — inaczej
 * dziecko po pierwszym z trzech kawałków widziałoby „Lekcja zaliczona!” i nie miałoby powodu
 * wracać po resztę.
 */
function SummaryScreen({
  summary,
  lessonId,
  courseSlug,
  badgeNames,
  hintsWon,
  unlocksWon,
}: {
  summary: Summary;
  lessonId: string;
  courseSlug: string;
  badgeNames: Record<string, string>;
  hintsWon: number;
  /** Ile punktów odblokowania przybyło — jeden za zaliczony poziom trudny, zero poza nim. */
  unlocksWon: number;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const stars = '⭐'.repeat(summary.stars) + '☆'.repeat(3 - summary.stars);
  const split = summary.stages > 1;
  const nextStage = summary.passed && !summary.lessonPassed ? summary.stage + 1 : null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.summary, { paddingBottom: 32 + insets.bottom }]}
    >
      <Text style={styles.trophy}>{summary.lessonPassed ? '🏆' : summary.passed ? '🎯' : '🌱'}</Text>
      <Title>
        {summary.lessonPassed
          ? 'Lekcja zaliczona!'
          : summary.passed
            ? `Etap ${summary.stage} z ${summary.stages} zaliczony!`
            : 'Jeszcze trochę'}
      </Title>
      <Text style={styles.stars} accessibilityLabel={`${summary.stars} z 3 gwiazdek`}>
        {stars}
      </Text>
      <Body>
        Dobrze: {summary.correct} z {summary.total}
      </Body>
      {split && !summary.lessonPassed && (
        <Chip>
          Etapy za tobą: {summary.stagesDone} z {summary.stages}
        </Chip>
      )}
      {summary.xp > 0 && <Chip>+{summary.xp} punktów za {split ? 'etap' : 'lekcję'}</Chip>}
      {hintsWon > 0 && <Chip>💡 +{plural(hintsWon, HINTS)} na dziś</Chip>}
      {/* Punkt zostaje do wydania, więc mówimy wprost, na co: dziecko dopiero poznaje tę walutę. */}
      {unlocksWon > 0 && <Chip>🔑 +{plural(unlocksWon, UNLOCKS)} — otworzysz nim zamkniętą lekcję</Chip>}
      {summary.streak > 1 && <Chip>🔥 {summary.streak} dni z rzędu</Chip>}
      {summary.badges.length > 0 && (
        <Message
          kind="ok"
          text={`${summary.badges.length === 1 ? 'Nowa odznaka!' : 'Nowe odznaki!'} ${summary.badges
            .map((code) => badgeNames[code] ?? code)
            .join(', ')}`}
        />
      )}
      <View style={styles.summaryButtons}>
        {nextStage !== null && (
          <Button
            label="Następny etap"
            onPress={() => router.replace(`/lekcja/${lessonId}?etap=${nextStage}`)}
          />
        )}
        <Button
          kind={nextStage === null ? 'primary' : 'quiet'}
          label="Wróć do kursu"
          onPress={() => backToCourse(router, courseSlug)}
        />
      </View>
    </ScrollView>
  );
}

function Exit({ courseSlug, text }: { courseSlug: string; text: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.summary, { paddingBottom: 32 + insets.bottom }]}
    >
      <Card>
        <Body>{text}</Body>
        <Button label="Wróć do kursu" onPress={() => backToCourse(router, courseSlug)} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.background, flex: 1 },
  head: { gap: size.gap, paddingHorizontal: size.pad, paddingTop: size.gap },
  headRow: { alignItems: 'center', flexDirection: 'row', gap: size.gap },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bar: { backgroundColor: color.line, borderRadius: 999, flex: 1, height: 16, overflow: 'hidden' },
  barFill: { backgroundColor: color.grass, borderRadius: 999, height: '100%' },
  counter: { color: color.muted, fontSize: 16, fontWeight: '700' },
  body: { gap: size.gap * 1.5, padding: size.pad, paddingBottom: 40 },
  skip: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  skipText: { color: color.muted, fontSize: 17, textDecorationLine: 'underline' },
  feedback: { borderRadius: size.radius, borderWidth: 2, gap: size.gap, padding: size.pad },
  feedbackOk: { backgroundColor: color.grassLight, borderColor: color.grass },
  feedbackBad: { backgroundColor: color.coralLight, borderColor: color.coral },
  feedbackTitle: { fontSize: 24, fontWeight: '700' },
  feedbackLine: { color: color.text, fontSize: size.text },
  strong: { fontWeight: '700' },
  summary: { alignItems: 'center', gap: size.gap, padding: size.pad, paddingTop: 32 },
  trophy: { fontSize: 72 },
  stars: { fontSize: 36, letterSpacing: 6 },
  summaryButtons: { alignSelf: 'stretch', gap: size.gap, marginTop: size.gap },
});
