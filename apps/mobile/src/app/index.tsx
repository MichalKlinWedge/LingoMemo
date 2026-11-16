import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Body, Button, Card, Message, Screen, Title } from '@/components/ui';
import { color, size } from '@/constants/theme';
import { type Course, loadMyCourses } from '@/features/courses/load';
import { useSession } from '@/lib/session';
import { isConfigured, supabase } from '@/lib/supabase';

/** Twoje kursy. Punkty, seria i nagrody są Etapem M3 — tutaj jest droga do nauki. */
export default function Home() {
  const session = useSession();
  const userId = session?.user.id ?? null;
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Przy powrocie z lekcji lista wczytuje się na nowo — kurs mógł właśnie przybyć gwiazdek.
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

      <Diagnostics email={session.user.email ?? null} />
    </Screen>
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
      <Text style={styles.icon}>{course.icon ?? '📘'}</Text>
      <View style={styles.courseText}>
        <Text style={styles.courseTitle}>{course.title}</Text>
        {course.description !== null && <Text style={styles.courseDesc}>{course.description}</Text>}
      </View>
      <Text style={styles.arrow}>→</Text>
    </Pressable>
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

/**
 * Ekrany pomiarowe bramki M0 i wylogowanie. Stoją na dole i cicho: to narzędzia dla dorosłego,
 * a nie część nauki. Zniknie stąd, gdy pomiary z telefonu zostaną zapisane w DECYZJE.md.
 */
function Diagnostics({ email }: { email: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.tools}>
      <Pressable accessibilityRole="button" onPress={() => setOpen(!open)} style={styles.toolsHeader}>
        <Text style={styles.toolsText}>{open ? 'Ukryj narzędzia' : 'Narzędzia i konto'}</Text>
      </Pressable>
      {open && (
        <Card>
          <Body muted>Zalogowany: {email ?? '—'}</Body>
          <Button kind="quiet" label="PoC-M1 — zadanie z bazy" onPress={() => router.push('/zadanie')} />
          <Button kind="quiet" label="PoC-M2 — mowa" onPress={() => router.push('/mowa')} />
          <Button kind="quiet" label="PoC-M3 — przypomnienia" onPress={() => router.push('/powiadomienia')} />
          <Button kind="quiet" label="Wyloguj" onPress={() => void supabase.auth.signOut()} />
        </Card>
      )}
    </View>
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
  tools: { gap: size.gap, marginTop: 24 },
  toolsHeader: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  toolsText: { color: color.muted, fontSize: 16, textDecorationLine: 'underline' },
});
