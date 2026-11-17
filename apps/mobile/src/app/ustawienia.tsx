import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { Body, Button, Card, Message, Screen, Title } from '@/components/ui';
import { UpdateCheck, UpdateInfo } from '@/components/update';
import { VoiceList } from '@/components/voices';
import { color } from '@/constants/theme';
import {
  disableReminders,
  enableReminders,
  exactAlarms,
  HOURS,
  reminderHour,
  remindersOn,
  requestExactAlarms,
  setReminderHour,
} from '@/features/reminders/reminders';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

/**
 * Ustawienia spod zębatki: kto jest zalogowany, wersja aplikacji ze sprawdzeniem aktualizacji,
 * przypomnienie o powtórkach i wyjście z konta.
 *
 * Wszystko to stało wcześniej na ekranie kursów — przypomnienie kartą pośrodku, reszta pod
 * rozwijanym napisem „Konto" na samym dole. Ekran kursów ma pokazywać kursy, a rzeczy, które
 * dorosły ustawia raz, mają jedno miejsce.
 */
export default function Settings() {
  const session = useSession();

  if (session === undefined) {
    return (
      <Screen>
        <Body muted>Sprawdzam, kto jest zalogowany…</Body>
      </Screen>
    );
  }

  if (session === null) {
    return (
      <Screen>
        <Card>
          <Title>Nie jesteś zalogowany</Title>
          <Body muted>Zaloguj się na ekranie startowym, żeby zobaczyć ustawienia konta.</Body>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Card>
        <Title>Konto</Title>
        <Body>{session.user.email ?? '—'}</Body>
      </Card>

      <Card>
        <Title>Wersja aplikacji</Title>
        <UpdateInfo />
        <UpdateCheck />
      </Card>

      <Reminders userId={session.user.id} />

      <Card>
        <Title>Mowa</Title>
        <Body muted>Zadania ze słuchu czyta głos zainstalowany w telefonie.</Body>
        <VoiceList />
      </Card>

      <DevTools />

      <SignOut />
    </Screen>
  );
}

/**
 * Przypomnienie o powtórkach: jeden przełącznik i godzina. Domyślnie wyłączone przypomnienie to
 * przypomnienie, którego nikt nie włączy (lekcja P1.3 z ExpeditionPlan) — dlatego jest tu
 * pierwszą rzeczą z przełącznikiem, a nie pozycją w ustawieniach systemowych Androida.
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

/**
 * Ekrany pomiarowe bramki M0 (PoC-M1/M2/M3) — tylko w dev buildzie z Metro. APK dziecka to ta
 * sama paczka kodu co telefon właściciela, więc bez tego warunku dziecko dostaje w ustawieniach
 * trzy drogi do narzędzi, które nie są nauką.
 */
function DevTools() {
  const router = useRouter();
  if (!__DEV__) return null;
  return (
    <Card>
      <Title>Narzędzia pomiarowe</Title>
      <Button kind="quiet" label="PoC-M1 — zadanie z bazy" onPress={() => router.push('/zadanie')} />
      <Button kind="quiet" label="PoC-M2 — mowa" onPress={() => router.push('/mowa')} />
      <Button kind="quiet" label="PoC-M3 — przypomnienia" onPress={() => router.push('/powiadomienia')} />
    </Card>
  );
}

/**
 * Wyjście z konta. Po wylogowaniu wracamy na ekran startowy zamiast zostawiać otwarte ustawienia
 * konta, którego już nie ma.
 */
function SignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      kind="quiet"
      label="Wyloguj"
      busy={busy}
      onPress={() => {
        setBusy(true);
        void supabase.auth.signOut().finally(() => {
          setBusy(false);
          router.replace('/');
        });
      }}
    />
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.85 },
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
});
