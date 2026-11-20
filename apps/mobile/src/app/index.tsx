import { plural, WORDS } from '@lingomemo/core';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Body, Button, Card, Message, Screen, Title } from '@/components/ui';
import { Flag } from '@/components/flag';
import { UpdateBanner } from '@/components/update';
import { color, size } from '@/constants/theme';
import { loadMyCourses, type MyCourse } from '@/features/courses/load';
import { refreshReminder } from '@/features/reminders/reminders';
import { useSession } from '@/lib/session';
import { isConfigured } from '@/lib/supabase';

/** Twoje kursy. Nagrody i postępy — ze znaczników nad nimi; konto i przypomnienia — pod zębatką. */
export default function Home() {
  const session = useSession();
  const userId = session?.user.id ?? null;
  const [courses, setCourses] = useState<MyCourse[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Przy powrocie z lekcji lista wczytuje się na nowo — kurs mógł właśnie przybyć gwiazdek.
  // Przy okazji odświeżamy treść przypomnienia: liczba zaległych słówek mogła się zmienić.
  useFocusEffect(
    useCallback(() => {
      if (userId === null) return;
      let alive = true;
      void loadMyCourses(userId).then((result) => {
        if (!alive) return;
        if (result.ok) {
          setCourses(result.value);
          setError(null);
        } else {
          setError(result.error);
        }
      });
      void refreshReminder(userId).catch(() => undefined);
      return () => {
        alive = false;
      };
    }, [userId]),
  );

  if (!isConfigured) {
    return (
      <Screen>
        <Message
          kind="error"
          text="Brak adresu bazy w aplikacji. W katalogu głównym: npm run mobile (przepisuje .env.local do apps/mobile)."
        />
      </Screen>
    );
  }

  if (session === undefined) {
    return (
      <Screen>
        <Body muted>Sprawdzam, kto jest zalogowany…</Body>
      </Screen>
    );
  }

  if (session === null) return <Welcome />;

  return (
    <Screen>
      <UpdateBanner />
      {error !== null && <Message kind="error" text={error} />}
      {courses === null && <Body muted>Wczytuję kursy…</Body>}
      {courses?.length === 0 && (
        <Card>
          <Title>Nie masz jeszcze kursu</Title>
          <Body muted>
            Kurs otwiera administrator. Gdy Cię dopisze, pojawi się tutaj — poproś go o to przez
            stronę Lingo Memo w przeglądarce.
          </Body>
        </Card>
      )}
      {courses?.map((course) => (
        <CourseCard key={course.id} course={course} />
      ))}
    </Screen>
  );
}

function CourseCard({ course }: { course: MyCourse }) {
  const router = useRouter();
  // Kurs zamknięty zaległymi powtórkami: cała karta w szarościach i kłódka zamiast strzałki.
  // Dotknięcie dalej działa — w kursie czeka test powtórkowy, czyli jedyne wyjście z blokady.
  const zamkniety = course.gate?.active === true;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        zamkniety ? `${course.title} — zamknięty do zdanego testu powtórkowego` : course.title
      }
      onPress={() => router.push(`/kurs/${course.slug}`)}
      style={({ pressed }) => [styles.course, zamkniety && styles.locked, pressed && styles.pressed]}
    >
      <Flag code={course.target_lang} fallback={course.icon} size={44} />
      <View style={styles.courseText}>
        <Text style={styles.courseTitle}>{course.title}</Text>
        {zamkniety ? (
          <Text style={styles.courseDesc}>
            🔁 Lekcje zamknięte — {plural(course.gate?.due ?? 0, WORDS)} do powtórzenia. Wejdź
            i zrób test powtórkowy.
          </Text>
        ) : (
          course.description !== null && <Text style={styles.courseDesc}>{course.description}</Text>
        )}
      </View>
      <Text style={zamkniety ? styles.lock : styles.arrow}>{zamkniety ? '🔒' : '→'}</Text>
    </Pressable>
  );
}

function Welcome() {
  const router = useRouter();
  return (
    <Screen>
      <Card>
        <Title>Lingo Memo</Title>
        <Body>Zaloguj się, żeby uczyć się słówek.</Body>
        <Button label="Zaloguj się" onPress={() => router.push('/logowanie')} />
        <Body muted>
          Konta nie zakłada się w aplikacji — nowe konto powstaje z linku z zaproszeniem otwartego
          w przeglądarce.
        </Body>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  course: {
    alignItems: 'center',
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: size.radius,
    borderWidth: 1,
    flexDirection: 'row',
    gap: size.gap,
    minHeight: 88,
    padding: size.pad,
  },
  pressed: { opacity: 0.85 },
  /**
   * Kurs zamknięty bramką powtórek. `filter` szarzeje wszystko, co w karcie jest kolorowe —
   * flagę (obrazek, więc własnym kolorem go nie przestawimy) i emoji. Androidowi starcza do
   * tego nowa architektura, czyli domyślna od Expo SDK 55; gdyby kiedyś jej nie było, filtr
   * nic nie robi, dlatego przygaszenie całej karty daje osobno `opacity`, a strzałkę w kolorze
   * marki zastępuje szara kłódka.
   */
  locked: { filter: [{ grayscale: 1 }], opacity: 0.75 },
  icon: { fontSize: 40 },
  courseText: { flex: 1, gap: 4 },
  courseTitle: { color: color.text, fontSize: 22, fontWeight: '700' },
  courseDesc: { color: color.muted, fontSize: 16 },
  arrow: { color: color.brand, fontSize: 28 },
  lock: { color: color.muted, fontSize: 28 },
});
