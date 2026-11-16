import { LESSONS, plural, UNLOCKS, WORDS } from '@lingomemo/core';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Body, Button, Card, Chip, Message, Screen, Title } from '@/components/ui';
import { color, level as levelColor, size } from '@/constants/theme';
import { type CourseMap, type Lesson, loadCourseMap, unlockLesson } from '@/features/courses/load';
import { useSession } from '@/lib/session';

/**
 * Mapa kursu: działy, a w nich kafelki lekcji z gwiazdkami, kwadracikami etapów i wejściami
 * na poziom średni i trudny. Co jest otwarte, mówi baza (`v_my_lessons.is_unlocked`) — ekran
 * tylko nazywa to, co z niej wyszło, tak samo jak strona na webie.
 */
export default function CourseScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const session = useSession();
  const userId = session?.user.id ?? null;
  const [map, setMap] = useState<CourseMap | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Wczytanie mapy. Ta sama funkcja obsługuje wejście na ekran (po lekcji zmieniają się gwiazdki
   * i zamki) oraz powrót z okna odblokowania — wydany punkt zamienia kłódkę na kafelek do kliknięcia.
   */
  const load = useCallback(() => {
    if (userId === null) return;
    let alive = true;
    void loadCourseMap(slug, userId).then((result) => {
      if (!alive) return;
      if (result.ok) {
        setMap(result.value);
        setError(null);
      } else {
        setError(result.error);
      }
    });
    return () => {
      alive = false;
    };
  }, [slug, userId]);

  useFocusEffect(load);

  if (error !== null) {
    return (
      <Screen>
        <Message kind="error" text={error} />
      </Screen>
    );
  }

  if (map === null) {
    return (
      <Screen>
        <Body muted>Wczytuję mapę…</Body>
      </Screen>
    );
  }

  const byUnit = (unitId: string) => map.lessons.filter((lesson) => lesson.unit_id === unitId);

  return (
    <Screen>
      <Title>
        {map.course.icon ?? '📘'} {map.course.title}
      </Title>
      <Body muted>Ukończone: {plural(map.done, LESSONS)}</Body>

      {/* Stan konta punktów odblokowania. Bez tego dziecko nie wie, że kłódka z kluczykiem jest
          dla niego — punkt zdobyło kilka lekcji wcześniej, na poziomie trudnym. */}
      {map.unlockLeft > 0 && (
        <Chip>🔑 {plural(map.unlockLeft, UNLOCKS)} — dotknij kłódki z kluczykiem</Chip>
      )}

      {/* Zamknięty kurs: jedno wejście, od razu na wierzchu. Kafelków lekcji nie ukrywamy —
          dziecko ma widzieć, co się otworzy, gdy zda test. */}
      {map.gate?.active === true && map.gate.lessonId !== null && <GateCard gate={map.gate} />}

      {map.units.map((unit) => {
        const lessons = byUnit(unit.id);
        // Dział zamknięty w całości, czyli czekający na test poprzedniego działu. Poznajemy go
        // po tym, że ani jedna jego lekcja nie jest otwarta — reguła siedzi w bazie.
        const unitLocked = lessons.length > 0 && lessons.every((lesson) => lesson.is_unlocked !== true);

        return (
          <View key={unit.id} style={styles.unit}>
            <Text style={styles.unitTitle}>
              {unitLocked ? '🔒 ' : unit.icon !== null ? `${unit.icon} ` : ''}
              {unit.title}
            </Text>
            {unitLocked && (
              <Body muted>
                {map.gate?.active === true
                  ? 'Ten dział otworzy się po zdanym teście powtórkowym.'
                  : 'Ten dział otworzy się po zdanym teście poprzedniego działu.'}
              </Body>
            )}
            <View style={styles.tiles}>
              {lessons.map((lesson) => (
                <LessonTile
                  key={lesson.id}
                  lesson={lesson}
                  map={map}
                  unitLocked={unitLocked}
                  onUnlocked={load}
                />
              ))}
            </View>
          </View>
        );
      })}
    </Screen>
  );
}

function GateCard({ gate }: { gate: NonNullable<CourseMap['gate']> }) {
  const router = useRouter();
  return (
    <Card>
      <Title>🔁 Test powtórkowy</Title>
      <Body>
        {gate.triedToday
          ? `Ten test jeszcze nie jest zdany — spróbuj jeszcze raz. ${plural(gate.due, WORDS)} czeka na powtórzenie.`
          : `Uzbierało się ${plural(gate.due, WORDS)} do powtórzenia, więc lekcje chwilę poczekają. Przypomnij sobie te słówka, a potem uczysz się dalej.`}
      </Body>
      <Button label="Zrób test powtórkowy" onPress={() => router.push(`/lekcja/${gate.lessonId}`)} />
    </Card>
  );
}

/**
 * Kafelek lekcji. Dziecko dotyka obrazka, żeby „robić tę lekcję dalej”, a nie żeby wybierać
 * poziom — więc po zaliczeniu łatwego kafelek otwiera średni, potem trudny. Kwadraciki zostają
 * do wybierania wprost, także do powtarzania zrobionych.
 */
function LessonTile({
  lesson,
  map,
  unitLocked,
  onUnlocked,
}: {
  lesson: Lesson;
  map: CourseMap;
  /** Dział czekający na test poprzedniego — wtedy powodem zamka nie jest poprzednia lekcja. */
  unitLocked: boolean;
  onUnlocked: () => void;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const state = lesson.status === 'completed' ? 'done' : lesson.is_unlocked === true ? 'available' : 'locked';

  // Kłódka do otwarcia punktem — ale tylko wtedy, gdy punkt jest. Bez punktu zostaje zwykły
  // zamek, którego powód mówi, skąd punkt wziąć; klikalna kłódka bez pokrycia obiecywałaby coś,
  // czego baza nie da. O tym, czy tę lekcję wolno kupić, decyduje `can_unlock_lesson`.
  const unlockable = state === 'locked' && lesson.is_unlockable === true && map.unlockLeft > 0;

  const harder = map.levels.filter(
    (row) => row.lesson_id === lesson.id && (row.level ?? 1) > 1 && (row.exercise_count ?? 0) > 0,
  );

  const stages = lesson.stage_count ?? 1;
  // Zaliczona lekcja ma z definicji wszystkie etapy za sobą — licznik dotyczy bieżącego podejścia.
  const stagesDone = state === 'done' ? stages : (lesson.stages_done ?? 0);
  const stageStars = map.stageStars[lesson.id] ?? {};

  const open = () => {
    if (state === 'locked') {
      // Dziecko dotyka kłódki tam, gdzie i tak dotykało, licząc, że lekcja się otworzy —
      // a dopiero potem dostaje pytanie.
      if (unlockable) setAsking(true);
      return;
    }
    if (state !== 'done') {
      router.push(`/lekcja/${lesson.id}`);
      return;
    }
    const next = harder.find((row) => row.is_unlocked === true && row.status !== 'completed');
    router.push(next ? `/lekcja/${lesson.id}?poziom=${next.level}` : `/lekcja/${lesson.id}`);
  };

  // Zamek bez powodu to dla dziecka ślepa ściana — powód mówimy pod kafelkiem. Powody są cztery
  // i każdy prowadzi gdzie indziej: do testu powtórkowego, do poprzedniego działu, do reszty
  // lekcji w tym dziale albo do lekcji obok. Bramka powtórek zamyka cały kurs, więc stoi przed
  // pozostałymi. Piąte wyjście — punkt odblokowania — dopisujemy tylko tam, gdzie jest do wzięcia.
  const why =
    map.gate?.active === true
      ? 'Najpierw zdaj test powtórkowy'
      : unitLocked
        ? 'Najpierw zdaj test poprzedniego działu'
        : lesson.kind === 'test'
          ? 'Najpierw skończ wszystkie lekcje działu'
          : lesson.is_unlockable === true
            ? 'Najpierw skończ poprzednią lekcję albo zdobądź punkt odblokowania na poziomie trudnym'
            : 'Najpierw skończ poprzednią lekcję';

  return (
    <View style={styles.box}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${lesson.title}${
          unlockable ? ' — otwórz za punkt odblokowania' : state === 'locked' ? ' — zamknięta' : ''
        }`}
        accessibilityState={{ disabled: state === 'locked' && !unlockable }}
        disabled={state === 'locked' && !unlockable}
        onPress={open}
        style={({ pressed }) => [
          styles.tile,
          state === 'done' && styles.tileDone,
          state === 'locked' && styles.tileLocked,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.tileIcon}>{state === 'locked' ? '🔒' : (lesson.icon ?? '📘')}</Text>
        {unlockable && <Text style={styles.tileKey}>🔑</Text>}
        {state === 'done' && <Text style={styles.tileStars}>{'⭐'.repeat(lesson.stars ?? 0)}</Text>}
      </Pressable>

      <Text style={styles.boxTitle}>{lesson.title}</Text>
      <View style={styles.meta}>
        <Text style={styles.words} accessibilityLabel={plural(lesson.word_count ?? 0, WORDS)}>
          {lesson.word_count ?? 0}
        </Text>
        {/* Sowa prowadzi na planszę ze słówkami: dziecko najpierw ich słucha, potem wchodzi
            w lekcję. Przy zamkniętej lekcji sowy nie ma, bo polityki bazy i tak nie wydadzą jej
            słówek, a przy powtórce — bo powtórka nie ma własnych słówek. */}
        {state !== 'locked' && lesson.kind !== 'review' && (lesson.word_count ?? 0) > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${lesson.title} — posłuchaj słówek`}
            hitSlop={10}
            onPress={() => router.push(`/lekcja/${lesson.id}/nauka`)}
            style={({ pressed }) => [styles.owl, pressed && styles.pressed]}
          >
            <Text style={styles.owlText}>🦉</Text>
          </Pressable>
        )}
      </View>
      {state === 'locked' && <Text style={styles.why}>{why}</Text>}

      <View style={styles.marks}>
        {Array.from({ length: stages }, (_, i) => i + 1).map((nr) => (
          <Mark
            key={`stage-${nr}`}
            stars={stageStars[nr] ?? 0}
            fill={nr <= stagesDone ? color.grass : null}
            border={color.grass}
            locked={state === 'locked'}
            label={
              stages === 1
                ? `${lesson.title} — poziom łatwy`
                : `${lesson.title} — etap ${nr} z ${stages}`
            }
            onPress={() => router.push(`/lekcja/${lesson.id}?etap=${nr}`)}
          />
        ))}
        {harder.map((row) => {
          const nr = row.level ?? 2;
          const paint = levelColor[Math.min(Math.max(nr, 1), 3) - 1];
          return (
            <Mark
              key={`level-${nr}`}
              stars={row.stars ?? 0}
              fill={row.status === 'completed' ? paint : row.status === 'in_progress' ? `${paint}80` : null}
              border={paint}
              locked={row.is_unlocked !== true}
              label={`${lesson.title} — poziom ${nr === 2 ? 'średni' : 'trudny'}`}
              onPress={() => router.push(`/lekcja/${lesson.id}?poziom=${nr}`)}
            />
          );
        })}
      </View>

      {asking && (
        <UnlockDialog
          lesson={lesson}
          left={map.unlockLeft}
          onClose={() => setAsking(false)}
          onDone={() => {
            setAsking(false);
            onUnlocked();
          }}
        />
      )}
    </View>
  );
}

/**
 * Pytanie przed wydaniem punktu odblokowania. Jest konieczne: punkt zdobywa się na poziomie
 * trudnym, więc wydanie go przez pomyłkę to kilkanaście zadań do powtórzenia.
 *
 * Po otwarciu lekcji pytanie jest nieprawdą — punkt już poszedł — więc okno zamienia się
 * w potwierdzenie ze stanem konta, a jego zamknięcie wczytuje mapę na nowo.
 */
function UnlockDialog({
  lesson,
  left,
  onClose,
  onDone,
}: {
  lesson: Lesson;
  /** Ile punktów dziecko ma teraz. Zero tu nie trafia: wtedy kłódka zostaje nieklikalna. */
  left: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Ile punktów zostało po otwarciu. Dopóki `null`, lekcja jest jeszcze zamknięta. */
  const [opened, setOpened] = useState<number | null>(null);

  const buy = async () => {
    setBusy(true);
    setError(null);
    const result = await unlockLesson(lesson.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpened(result.value.left);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={opened === null ? onClose : onDone}>
      <View style={styles.backdrop}>
        <View style={styles.dialog}>
          <Title>{opened === null ? 'Otworzyć tę lekcję?' : 'Lekcja otwarta!'}</Title>
          {opened === null ? (
            <>
              <Body>
                <Text style={styles.dialogName}>{lesson.title}</Text> otworzy się za jeden punkt
                odblokowania. Masz {plural(left, UNLOCKS)}.
              </Body>
              <Body muted>Punkt zdobywasz za zrobienie lekcji na poziomie trudnym.</Body>
            </>
          ) : (
            <Body>Zostało Ci {plural(opened, UNLOCKS)}.</Body>
          )}
          {error !== null && <Message kind="error" text={error} />}
          {opened === null ? (
            <>
              <Button label="Tak, otwórz" busy={busy} onPress={() => void buy()} />
              <Button kind="quiet" label="Nie teraz" onPress={onClose} />
            </>
          ) : (
            <Button label="Zamknij" onPress={onDone} />
          )}
        </View>
      </View>
    </Modal>
  );
}

/**
 * Kwadracik etapu albo poziomu z gwiazdkami nad nim. Sam kwadracik jest mały, bo w rzędzie stoi
 * ich kilka — dlatego pole dotyku powiększa `hitSlop` do progu, od którego dziecko trafia palcem.
 */
function Mark({
  stars,
  fill,
  border,
  locked,
  label,
  onPress,
}: {
  stars: number;
  fill: string | null;
  border: string;
  locked: boolean;
  label: string;
  onPress: () => void;
}) {
  const box = (
    <>
      <Text style={styles.markStars}>{'★'.repeat(Math.min(Math.max(stars, 0), 3))}</Text>
      <View
        style={[
          styles.mark,
          { borderColor: locked ? color.line : border },
          fill !== null && { backgroundColor: fill },
        ]}
      />
    </>
  );

  if (locked) {
    return (
      <View style={styles.markCol} accessible accessibilityLabel={`${label} — zamknięty`}>
        {box}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={12}
      onPress={onPress}
      style={({ pressed }) => [styles.markCol, pressed && styles.pressed]}
    >
      {box}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  unit: { gap: size.gap },
  unitTitle: { color: color.text, fontSize: 22, fontWeight: '700' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: size.gap },
  box: {
    alignItems: 'center',
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: size.radius,
    borderWidth: 1,
    gap: 6,
    padding: size.gap,
    width: 160,
  },
  tile: {
    alignItems: 'center',
    backgroundColor: color.brandLight,
    borderColor: color.brand,
    borderRadius: size.radius,
    borderWidth: 2,
    height: 96,
    justifyContent: 'center',
    width: 96,
  },
  tileDone: { backgroundColor: color.grassLight, borderColor: color.grass },
  tileLocked: { backgroundColor: color.background, borderColor: color.line },
  pressed: { opacity: 0.8 },
  tileIcon: { fontSize: 40 },
  tileKey: { fontSize: 16 },
  tileStars: { fontSize: 14 },
  boxTitle: { color: color.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  meta: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  words: { color: color.muted, fontSize: 15, fontWeight: '700' },
  owl: {
    alignItems: 'center',
    backgroundColor: color.brandLight,
    borderRadius: 999,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  owlText: { fontSize: 18 },
  why: { color: color.muted, fontSize: 13, textAlign: 'center' },
  marks: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 2 },
  markCol: { alignItems: 'center', gap: 2 },
  markStars: { color: color.sun, fontSize: 9, height: 11 },
  mark: { borderRadius: 4, borderWidth: 2, height: 18, width: 18 },
  backdrop: {
    alignItems: 'center',
    backgroundColor: '#00000080',
    flex: 1,
    justifyContent: 'center',
    padding: size.pad,
  },
  dialog: {
    backgroundColor: color.surface,
    borderRadius: size.radius,
    gap: size.gap,
    maxWidth: 420,
    padding: size.pad,
    width: '100%',
  },
  dialogName: { fontWeight: '700' },
});
