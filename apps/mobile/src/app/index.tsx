import { DAYS, plural, POINTS } from '@lingomemo/core';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { Body, Button, Card, Chip, Message, Screen, Title } from '@/components/ui';
import { Flag } from '@/components/flag';
import { UpdateBanner, UpdateCheck, UpdateInfo } from '@/components/update';
import { VoiceList } from '@/components/voices';
import { color, size } from '@/constants/theme';
import { type Course, loadMyCourses } from '@/features/courses/load';
import {
  disableReminders,
  enableReminders,
  exactAlarms,
  HOURS,
  reminderHour,
  remindersOn,
  refreshReminder,
  requestExactAlarms,
  setReminderHour,
} from '@/features/reminders/reminders';
import { type BarData, loadBar } from '@/features/stats/load';
import { useSession } from '@/lib/session';
import { isConfigured, supabase } from '@/lib/supabase';

/** Twoje kursy, a pod nimi nagrody, postępy i przypomnienia o powtórkach. */
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
      <Reminders userId={session.user.id} />
      <Account email={session.user.email ?? null} />
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

/**
 * Przypomnienie o powtórkach: jeden przełącznik i godzina. Stoi na ekranie kursów, a nie
 * w ustawieniach systemowych, bo wyłączone domyślnie przypomnienie to przypomnienie, którego
 * nikt nie włączy (lekcja P1.3 z ExpeditionPlan).
 */
function Reminders({ userId }: { userId: string }) {
  const [on, setOn] = useState(remindersOn());
  const [hour, setHour] = useState(reminderHour());
  const [exact, setExact] = useState<boolean | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void exactAlarms().then((granted) => {
      if (alive) setExact(granted);
    });
    return () => {
      alive = false;
    };
  }, [on]);

  const toggle = async (next: boolean) => {
    if (!next) {
      await disableReminders();
      setOn(false);
      setNote(null);
      return;
    }
    const result = await enableReminders(userId, hour);
    setOn(result.on);
    setNote(
      result.on
        ? null
        : 'Android nie dał zgody na powiadomienia — można ją włączyć w ustawieniach aplikacji.',
    );
  };

  return (
    <Card>
      <Title>Przypomnienie o powtórkach</Title>
      <View style={styles.switchRow}>
        <Body>{on ? `Codziennie o ${hour}:00` : 'Wyłączone'}</Body>
        <Switch
          value={on}
          onValueChange={(next) => void toggle(next)}
          accessibilityLabel="Codzienne przypomnienie o powtórkach"
          trackColor={{ true: color.brand, false: color.line }}
        />
      </View>
      {on && (
        <View style={styles.hours}>
          {HOURS.map((option) => (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: option === hour }}
              onPress={() => {
                setHour(option);
                void setReminderHour(userId, option);
              }}
              style={({ pressed }) => [
                styles.hour,
                option === hour && styles.hourPicked,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.hourText, option === hour && styles.hourTextPicked]}>{option}:00</Text>
            </Pressable>
          ))}
        </View>
      )}
      {on && exact === false && (
        <>
          <Body muted>
            Android bez zgody na dokładne alarmy może przesunąć przypomnienie nawet o kilkanaście
            minut.
          </Body>
          <Button
            kind="quiet"
            label="Włącz dokładne alarmy"
            onPress={() => void requestExactAlarms(userId).then((granted) => setExact(granted))}
          />
        </>
      )}
      {note !== null && <Message kind="error" text={note} />}
    </Card>
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
 * Konto: kto jest zalogowany i wylogowanie. Stoi na dole i cicho, bo dziecko zagląda tu raz.
 *
 * Ekrany pomiarowe bramki M0 (PoC-M1/M2/M3) są schowane za `__DEV__`, czyli widać je wyłącznie
 * w dev buildzie z Metro. APK dziecka to ta sama paczka kodu co telefon właściciela, więc bez
 * tego warunku dziecko dostawało na ekranie kursów trzy drogi do narzędzi, które nie są nauką.
 */
function Account({ email }: { email: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.tools}>
      <Pressable accessibilityRole="button" onPress={() => setOpen(!open)} style={styles.toolsHeader}>
        <Text style={styles.toolsText}>{open ? 'Ukryj' : 'Konto'}</Text>
      </Pressable>
      {open && (
        <Card>
          <Body muted>Zalogowany: {email ?? '—'}</Body>
          <UpdateInfo />
          <UpdateCheck />
          <VoiceList />
          {__DEV__ && (
            <>
              <Button kind="quiet" label="PoC-M1 — zadanie z bazy" onPress={() => router.push('/zadanie')} />
              <Button kind="quiet" label="PoC-M2 — mowa" onPress={() => router.push('/mowa')} />
              <Button kind="quiet" label="PoC-M3 — przypomnienia" onPress={() => router.push('/powiadomienia')} />
            </>
          )}
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
  bar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  nav: { flexDirection: 'row', gap: size.gap },
  navItem: { flex: 1 },
  switchRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  hours: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  hour: {
    alignItems: 'center',
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: 999,
    borderWidth: 2,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  hourPicked: { backgroundColor: color.brandLight, borderColor: color.brand },
  hourText: { color: color.text, fontSize: 16, fontWeight: '700' },
  hourTextPicked: { color: color.brandDark },
  tools: { gap: size.gap, marginTop: 24 },
  toolsHeader: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  toolsText: { color: color.muted, fontSize: 16, textDecorationLine: 'underline' },
});
