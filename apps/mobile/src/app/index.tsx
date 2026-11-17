import { DAYS, plural, POINTS } from '@lingomemo/core';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Body, Button, Card, Chip, Message, Screen, Title } from '@/components/ui';
import { Flag } from '@/components/flag';
import { UpdateBanner } from '@/components/update';
import { color, size } from '@/constants/theme';
import { type Course, loadMyCourses } from '@/features/courses/load';
import { refreshReminder } from '@/features/reminders/reminders';
import { type BarData, loadBar } from '@/features/stats/load';
import { useSession } from '@/lib/session';
import { isConfigured } from '@/lib/supabase';

/** Twoje kursy, a pod nimi nagrody i postępy. Konto i przypomnienia — pod zębatką w nagłówku. */
export default function Home() {
  const session = useSession();
  const userId = session?.user.id ?? null;
  const [courses, setCourses] = useState<Course[] | null>(null);
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
      <Bar userId={session.user.id} />
      {error !== null && <Message kind="error" text={error} />}
      {courses === null && <Body muted>Wczytuję kursy…</Body>}
      {courses?.length === 0 && (
        <Card>
          <Title>Nie masz jeszcze kursu</Title>
          <Body muted>
            Kurs otwiera administrator. Gdy Cię dopisze, pojawi się tutaj — poproś go o to przez
            stronę LingoMemo w przeglądarce.
          </Body>
        </Card>
      )}
      {courses?.map((course) => (
        <CourseCard key={course.id} course={course} />
      ))}

      <Nav />
    </Screen>
  );
}

/**
 * Punkty, seria, zaległe powtórki i punkty odblokowania. Na webie stoją w pasku nad każdą stroną,
 * więc dziecko widzi je zawsze; na telefonie wspólnego nagłówka nie ma, więc stoją tutaj — a ten
 * ekran wczytuje się na nowo przy każdym pokazaniu, czyli i po każdej lekcji.
 *
 * Liczy je baza (`v_my_stats`, `unlock_status`), nie telefon.
 */
function Bar({ userId }: { userId: string }) {
  const [bar, setBar] = useState<BarData | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void loadBar(userId).then((data) => {
        if (alive) setBar(data);
      });
      return () => {
        alive = false;
      };
    }, [userId]),
  );

  if (bar === null) return null;

  return (
    <View style={styles.bar}>
      <Chip>⭐ {plural(bar.points, POINTS)}</Chip>
      <Chip>🔥 {plural(bar.streak, DAYS)}</Chip>
      {bar.due > 0 && <Chip>🔁 {bar.due} do powtórki</Chip>}
      {/* Bez punktów znacznika nie ma: dziecko przed pierwszym poziomem trudnym nie ma o czym
          wiedzieć, a pasek ma zostać krótki. Wydaje się je na ekranie kursu, dotykając kłódki
          z kluczykiem. */}
      {bar.unlocks > 0 && <Chip>🔑 {bar.unlocks} do odblokowania</Chip>}
    </View>
  );
}

function CourseCard({ course }: { course: Course }) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/kurs/${course.slug}`)}
      style={({ pressed }) => [styles.course, pressed && styles.pressed]}
    >
      <Flag code={course.target_lang} fallback={course.icon} size={44} />
      <View style={styles.courseText}>
        <Text style={styles.courseTitle}>{course.title}</Text>
        {course.description !== null && <Text style={styles.courseDesc}>{course.description}</Text>}
      </View>
      <Text style={styles.arrow}>→</Text>
    </Pressable>
  );
}

/** Nagrody i postępy — osobne ekrany, bo na kursach nie ma dla nich miejsca. */
function Nav() {
  const router = useRouter();
  return (
    <View style={styles.nav}>
      <View style={styles.navItem}>
        <Button kind="quiet" label="🏅 Nagrody" onPress={() => router.push('/nagrody')} />
      </View>
      <View style={styles.navItem}>
        <Button kind="quiet" label="📈 Postępy" onPress={() => router.push('/statystyki')} />
      </View>
    </View>
  );
}

function Welcome() {
  const router = useRouter();
  return (
    <Screen>
      <Card>
        <Title>LingoMemo</Title>
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
  icon: { fontSize: 40 },
  courseText: { flex: 1, gap: 4 },
  courseTitle: { color: color.text, fontSize: 22, fontWeight: '700' },
  courseDesc: { color: color.muted, fontSize: 16 },
  arrow: { color: color.brand, fontSize: 28 },
  bar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  nav: { flexDirection: 'row', gap: size.gap },
  navItem: { flex: 1 },
});
