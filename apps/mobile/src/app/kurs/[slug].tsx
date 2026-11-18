import { LESSONS, plural, UNLOCKS, WORDS } from '@lingomemo/core';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Flag } from '@/components/flag';
import { Body, Button, Card, Chip, Message, Screen, Title } from '@/components/ui';
import { color, level as levelColor, size } from '@/constants/theme';
import { type CourseData, type Lesson, loadCourse, unlockLesson } from '@/features/courses/load';
import { useSession } from '@/lib/session';

/**
 * Ekran kursu: działy, a w nich kafelki lekcji z gwiazdkami, kwadracikami etapów i wejściami
 * na poziom średni i trudny. Co jest otwarte, mówi baza (`v_my_lessons.is_unlocked`) — ekran
 * tylko nazywa to, co z niej wyszło, tak samo jak strona na webie.
 */
export default function CourseScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const session = useSession();
  const userId = session?.user.id ?? null;
  const [data, setData] = useState<CourseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  /**
   * Czy ekran już sam się ustawił na kolejnym dziale. Raz na wejście: bez tego każdy ponowny
   * pomiar wysokości (obrót tabletu, dorysowana kłódka po wydanym punkcie) odrzucałby dziecko
   * z powrotem na górę działu, nawet gdy właśnie przewinęło ekran ręką.
   */
  const ustawiony = useRef(false);
  /** Zmierzone położenie każdego działu w treści przewijanej: identyfikator działu -> `y`. */
  const yDzialu = useRef(new Map<string, number>());
  /** Wysokość całej treści — zero znaczy „native jeszcze nie wie, jak wysoki jest ekran". */
  const wysokoscTresci = useRef(0);

  /**
   * Wczytanie kursu. Ta sama funkcja obsługuje wejście na ekran (po lekcji zmieniają się gwiazdki
   * i zamki) oraz powrót z okna odblokowania — wydany punkt zamienia kłódkę na kafelek do kliknięcia.
   */
  const load = useCallback(() => {
    if (userId === null) return;
    ustawiony.current = false;
    yDzialu.current.clear();
    wysokoscTresci.current = 0;
    let alive = true;
    void loadCourse(slug, userId).then((result) => {
      if (!alive) return;
      if (result.ok) {
        setData(result.value);
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

  if (data === null) {
    return (
      <Screen>
        <Body muted>Wczytuję kurs…</Body>
      </Screen>
    );
  }

  const byUnit = (unitId: string) => data.lessons.filter((lesson) => lesson.unit_id === unitId);

  /**
   * Czy dział jest zaliczony, czyli ma zdany test działu. Tą samą rzeczą baza otwiera następny
   * dział (`is_unit_unlocked`), więc ekran nie wymyśla własnej definicji „zrobionego".
   */
  const unitPassed = (unitId: string) =>
    data.lessons.some(
      (lesson) => lesson.unit_id === unitId && lesson.kind === 'test' && lesson.status === 'completed',
    );

  /**
   * Dział, na którym ekran ma się otworzyć: pierwszy niezaliczony — dokładnie jak na webie
   * (`apps/web/src/app/kurs/[slug]/page.tsx`).
   *
   * Zaliczone działy zostają na widoku, bo dziecko ma do czego wracać i czym się chwalić — ale
   * po kilku zdanych testach to, co jest do zrobienia dziś, leży kilka ekranów niżej, a na
   * tablecie przewija się to palcem za każdym wejściem.
   *
   * Dwa wyjątki: pierwszy dział niezaliczony (albo wszystkie zaliczone) — nie ma po co skakać;
   * oraz stojąca bramka powtórek — wtedy na górze stoi karta testu powtórkowego, a działy
   * niżej są i tak zamknięte.
   */
  const kolejny = data.units.findIndex((unit) => !unitPassed(unit.id));
  const doUstawienia =
    data.gate?.active === true || kolejny <= 0 ? null : data.units[kolejny].id;

  /**
   * Przewinięcie na ten dział — wołane z dwu stron, bo potrzebuje dwu różnych pomiarów i żaden
   * nie wystarcza sam:
   *
   *   * `onLayout` działu daje jego `y` w treści,
   *   * `onContentSizeChange` mówi, że native zna już całą wysokość treści.
   *
   * Drugie jest tu sednem poprawki: `scrollTo` poza znaną natywnie wysokość jest **obcinane
   * do końca treści**, a przy wejściu na ekran ta wysokość to jeszcze zero. Wywołanie
   * z samego `onLayout` trafiało więc w zero i ekran zostawał na górze — na webie tego nie ma,
   * bo tam przewija się całe okno, które zna swoją wysokość od początku. Kolejność obu
   * pomiarów nie jest obiecana, dlatego próbujemy po każdym, a jedno `ustawiony` pilnuje,
   * żeby skok wyszedł raz.
   */
  const ustawNaDziale = () => {
    if (ustawiony.current || doUstawienia === null || wysokoscTresci.current === 0) return;
    const y = yDzialu.current.get(doUstawienia);
    if (y === undefined) return;
    ustawiony.current = true;
    scroll.current?.scrollTo({ y: Math.max(y - size.gap, 0), animated: false });
  };

  return (
    <Screen
      scrollRef={scroll}
      onContentSizeChange={(_width, height) => {
        wysokoscTresci.current = height;
        ustawNaDziale();
      }}
    >
      {/* Flaga obok tytułu, a nie w nim: obrazek wewnątrz <Text> Android rysuje po swojemu. */}
      <View style={styles.courseHead}>
        <Flag code={data.course.target_lang} fallback={data.course.icon} size={36} />
        <Title>{data.course.title}</Title>
      </View>
      <Body muted>Ukończone: {plural(data.done, LESSONS)}</Body>

      {/* Zaległe powtórki tego kursu, póki bramka jeszcze nie stoi. Pasek na ekranie kursów
          sumuje wszystkie kursy, a blokada liczy każdy kurs osobno — stąd własny licznik.
          Wejście jest tu dobrowolne: dziecko z długą kolejką zbija ją od razu, zamiast czekać,
          aż jutro zamknie mu lekcje. Przy stojącej bramce mówi to już karta bramki. */}
      {data.gate !== null && !data.gate.active && data.gate.testOpen && data.gate.lessonId !== null && (
        <ReviewCard gate={data.gate} />
      )}

      {/* Krótka kolejka: sam licznik, bez wejścia. Test z dwóch zadań nie jest wart otwierania,
          więc karta z przyciskiem zamienia się w zdanie, które mówi, kiedy wróci. */}
      {data.gate !== null && !data.gate.active && !data.gate.testOpen && data.gate.due > 0 && (
        <Chip>
          🔁 {plural(data.gate.due, WORDS)} do powtórzenia — test otworzy się przy{' '}
          {data.gate.testFrom}
        </Chip>
      )}

      {/* Stanu konta punktów odblokowania tu NIE ma: stoi znacznikiem „🔑" w pasku nad każdym
          ekranem, tak samo jak na webie. Dwa razy to samo na jednym ekranie, a pasek i tak
          jest wyżej. Czego szukać, mówi kłódka z kluczykiem na kafelku. */}

      {/* Zamknięty kurs: jedno wejście, od razu na wierzchu. Kafelków lekcji nie ukrywamy —
          dziecko ma widzieć, co się otworzy, gdy zda test. */}
      {data.gate?.active === true && data.gate.lessonId !== null && <GateCard gate={data.gate} />}

      {data.units.map((unit) => {
        const lessons = byUnit(unit.id);
        // Dział zamknięty w całości, czyli czekający na test poprzedniego działu. Poznajemy go
        // po tym, że ani jedna jego lekcja nie jest otwarta — reguła siedzi w bazie.
        const unitLocked = lessons.length > 0 && lessons.every((lesson) => lesson.is_unlocked !== true);

        return (
          <View
            key={unit.id}
            style={styles.unit}
            /* Położenie działu znamy dopiero po rozmierzeniu kafelków — stąd `onLayout`,
               a nie wyliczanie czegokolwiek z góry. Samo przewinięcie robi `ustawNaDziale`,
               bo czeka jeszcze na wysokość treści. */
            onLayout={(event) => {
              yDzialu.current.set(unit.id, event.nativeEvent.layout.y);
              ustawNaDziale();
            }}
          >
            <Text style={styles.unitTitle}>
              {unitLocked ? '🔒 ' : unit.icon !== null ? `${unit.icon} ` : ''}
              {unit.title}
            </Text>
            {unitLocked && (
              <Body muted>
                {data.gate?.active === true
                  ? 'Ten dział otworzy się po zdanym teście powtórkowym.'
                  : 'Ten dział otworzy się po zdanym teście poprzedniego działu.'}
              </Body>
            )}
            <View style={styles.tiles}>
              {lessons.map((lesson) => (
                <LessonTile
                  key={lesson.id}
                  lesson={lesson}
                  data={data}
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

/**
 * Powtórki bez przymusu: kolejka jest, ale jeszcze nie zamknęła lekcji. Przycisk prowadzi
 * w ten sam test co karta bramki — baza trzyma go otwartym, dopóki jest co powtarzać.
 */
function ReviewCard({ gate }: { gate: NonNullable<CourseData['gate']> }) {
  const router = useRouter();
  return (
    <Card>
      <Title>🔁 Powtórki</Title>
      <Body>
        {plural(gate.due, WORDS)} czeka na powtórzenie. Przy {gate.limit} lekcje poczekają, aż
        zrobisz test.
      </Body>
      <Button kind="quiet" label="Powtórz teraz" onPress={() => router.push(`/lekcja/${gate.lessonId}`)} />
    </Card>
  );
}

function GateCard({ gate }: { gate: NonNullable<CourseData['gate']> }) {
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
  data,
  unitLocked,
  onUnlocked,
}: {
  lesson: Lesson;
  data: CourseData;
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
  const unlockable = state === 'locked' && lesson.is_unlockable === true && data.unlockLeft > 0;

  const harder = data.levels.filter(
    (row) => row.lesson_id === lesson.id && (row.level ?? 1) > 1 && (row.exercise_count ?? 0) > 0,
  );

  // Zamknięta lekcja szarzeje w całości, nie samym kafelkiem: gwiazdki, liczba słówek
  // i kwadraciki etapów zostawały w kolorze, więc przy stojącej bramce powtórek (zamknięty cały
  // kurs) ekran dalej wyglądał na otwarty. Kłódki do otwarcia punktem to nie dotyczy — lekcja
  // jest w zasięgu, a szary mówiłby, że nie.
  //
  // Pytamy o `is_unlocked`, nie o `state`: ZALICZONA lekcja w zamkniętym dziale ma stan „done",
  // więc po samym stanie zostawała kolorowa i rząd zamkniętych lekcji dalej wyglądał na otwarty.
  // Zamek dotyczy jej tak samo jak reszty: bramka nie wpuszcza nawet z powrotem.
  const gray = lesson.is_unlocked !== true && !unlockable;

  const stages = lesson.stage_count ?? 1;
  // Zaliczona lekcja ma z definicji wszystkie etapy za sobą — licznik dotyczy bieżącego podejścia.
  const stagesDone = state === 'done' ? stages : (lesson.stages_done ?? 0);
  const stageStars = data.stageStars[lesson.id] ?? {};

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
    data.gate?.active === true
      ? 'Najpierw zdaj test powtórkowy'
      : unitLocked
        ? 'Najpierw zdaj test poprzedniego działu'
        : lesson.kind === 'test' || lesson.kind === 'review'
          ? 'Najpierw skończ wszystkie lekcje działu'
          : lesson.is_unlockable === true
            ? 'Najpierw skończ poprzednią lekcję albo zdobądź punkt odblokowania na poziomie trudnym'
            : 'Najpierw skończ poprzednią lekcję';

  return (
    <View style={[styles.box, gray && styles.boxLocked]}>
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
            state={nr <= stagesDone ? 'done' : 'new'}
            paint={gray ? color.muted : color.grass}
            kind="stage"
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
          // Zamknięta lekcja szarzeje razem ze swoimi poziomami: reguła „zamknięty poziom
          // blednie w swoim kolorze" jest po to, żeby dziecko widziało, co się po przejściu
          // łatwego otworzy — a w zamkniętej lekcji nie otworzy się nic.
          const paint = gray ? color.muted : levelColor[Math.min(Math.max(nr, 1), 3) - 1];
          return (
            <Mark
              key={`level-${nr}`}
              stars={row.stars ?? 0}
              state={levelState(row.status, row.stars ?? 0)}
              paint={paint}
              kind="level"
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
          left={data.unlockLeft}
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
 * w potwierdzenie ze stanem konta, a jego zamknięcie wczytuje ekran na nowo.
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

type MarkState = 'new' | 'tried' | 'done';

/**
 * Stan wejścia na poziom średni albo trudny — ta sama reguła, co na webie (`kurs/[slug]/page.tsx`).
 *
 * Trzy stany, nie dwa: zaczęte bez zaliczenia to kwadracik z kropką, a nie zamalowany. Zrobione
 * wymaga gwiazdki, nie samego statusu — wiersze sprzed `…_level_chain.sql` mogły dostać
 * „completed" przy obniżonym progu lekcji i zerze gwiazdek, a zamalowany kwadracik przy
 * zamkniętym następnym poziomie byłby sprzecznością na jednym ekranie.
 */
function levelState(status: string | null, stars: number): MarkState {
  if (status === 'completed' && stars >= 1) return 'done';
  if (status === 'completed' || status === 'in_progress') return 'tried';
  return 'new';
}

/**
 * Kwadracik etapu albo poziomu z gwiazdkami nad nim. Sam kwadracik jest mały, bo w rzędzie stoi
 * ich kilka — dlatego pole dotyku powiększa `hitSlop` do progu, od którego dziecko trafia palcem.
 *
 * Zaczęte, a niezaliczone rysujemy kropką w środku, tak jak web. Wcześniej było to wypełnienie
 * z przezroczystością (`${paint}80`) i przy osiemnastu pikselach czytało się jak kwadracik
 * zamalowany — czyli jak zaliczony poziom, którym nie był.
 *
 * Zamknięty kwadracik ZOSTAJE w kolorze swojego poziomu — blednie, ale się nie szarzeje, bo
 * szary nie mówi, co się po przejściu łatwego otworzy. Bledną przy tym tylko poziomy; zamknięte
 * etapy zostają w pełnym kolorze, dokładnie jak na webie (`.level-box[data-locked]` ma `opacity`,
 * `.stage` nie ma go wcale).
 *
 * Wyjątek: w zamkniętej LEKCJI szarzeje całe pudełko, więc kolor dostaje szary i tutaj (`paint`
 * z `LessonTile`). Nie otworzy się tam nic, dopóki lekcja jest zamknięta, więc nie ma czego
 * zapowiadać kolorem.
 */
function Mark({
  stars,
  state,
  paint,
  kind,
  locked,
  label,
  onPress,
}: {
  stars: number;
  state: MarkState;
  paint: string;
  kind: 'stage' | 'level';
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
          { borderColor: paint },
          state === 'done' && { backgroundColor: paint },
          locked && kind === 'level' && styles.markLocked,
        ]}
      >
        {state === 'tried' && <View style={[styles.markDot, { backgroundColor: paint }]} />}
      </View>
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
      accessibilityLabel={
        state === 'tried' ? `${label} — zaczęty, jeszcze nie zaliczony` : state === 'done' ? `${label} — zrobiony` : label
      }
      hitSlop={12}
      onPress={onPress}
      style={({ pressed }) => [styles.markCol, pressed && styles.pressed]}
    >
      {box}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  courseHead: { alignItems: 'center', flexDirection: 'row', gap: size.gap },
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
  /**
   * Zamknięta lekcja w odcieniach szarości. `filter` szarzeje też emoji i gwiazdki, których
   * kolorów nie przestawimy z kodu. Androidowi starcza do tego nowa architektura, czyli
   * domyślna od Expo SDK 55; gdyby jej kiedyś nie było, filtr nic nie zrobi — dlatego
   * kwadraciki dostają szary kolor wprost, a całość przygasza `opacity`.
   */
  boxLocked: { filter: [{ grayscale: 1 }], opacity: 0.8 },
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
  mark: { alignItems: 'center', borderRadius: 4, borderWidth: 2, height: 18, justifyContent: 'center', width: 18 },
  // Kropka „byłem tu, nie zaliczyłem": ten sam udział w kwadraciku, co promień 28% na webie.
  markDot: { borderRadius: 5, height: 10, width: 10 },
  markLocked: { opacity: 0.35 },
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
