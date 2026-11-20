import * as Notifications from 'expo-notifications';
import { AndroidImportance, SchedulableTriggerInputTypes } from 'expo-notifications';
import { useEffect, useState } from 'react';

import { Body, Button, Card, Message, Screen, Title } from '@/components/ui';
import { localToday } from '@/lib/clock';
import { supabase } from '@/lib/supabase';

/**
 * PoC-M3: czy przypomnienie o powtórkach przyjdzie wtedy, kiedy ma przyjść.
 *
 * Dwie rzeczy, które w ExpeditionPlan okazały się krytyczne (P1.3 w `ANALIZA_TELEFON.md`):
 * bez uprawnienia `SCHEDULE_EXACT_ALARM` Android przesuwa powiadomienia, w trybie uśpienia nawet
 * o kilkanaście minut, a powiadomienia domyślnie wyłączone znaczą, że dziecko zostanie bez nich.
 *
 * „Dziś” liczymy z zegara telefonu, nie z UTC — w ExpeditionPlan (P2.6) `toISOString()` sprawiał,
 * że nad ranem „dziś” było wczoraj.
 */

const CHANNEL = 'powtorki';
const KIND = 'poc-m3';

type Status = {
  granted: boolean;
  /** Dokładne alarmy; na starszym Androidzie i na iOS ta zgoda nie istnieje i są domyślne. */
  exact: boolean;
  planned: string[];
  due: number;
};

async function readStatus(): Promise<Status> {
  const granted = (await Notifications.getPermissionsAsync()).granted;

  let exact = true;
  try {
    exact = (await Notifications.getExactAlarmPermissionsAsync()).granted;
  } catch {
    exact = true;
  }

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const planned = scheduled
    .filter((item) => item.content.data?.kind === KIND)
    .map((item) => `${item.content.title ?? '—'} · ${JSON.stringify(item.trigger)}`);

  const { count } = await supabase
    .from('srs_state')
    .select('concept_id', { count: 'exact', head: true })
    .lte('due_on', localToday());

  return { granted, exact, planned, due: count ?? 0 };
}

export default function Powiadomienia() {
  const [status, setStatus] = useState<Status | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    void readStatus().then(
      (next) => {
        if (alive) setStatus(next);
      },
      () => {
        if (alive) setNote('Nie udało się odczytać stanu powiadomień.');
      },
    );
    return () => {
      alive = false;
    };
  }, [tick]);

  const again = () => setTick((value) => value + 1);

  const ask = async () => {
    const permission = await Notifications.requestPermissionsAsync();
    if (permission.granted) {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: 'Powtórki',
        description: 'Przypomnienie, że czekają słówka do powtórzenia',
        importance: AndroidImportance.HIGH,
      });
    }
    setNote(permission.granted ? 'Zgoda na powiadomienia jest.' : 'Bez zgody nie przyjdzie nic.');
    again();
  };

  const askExact = async () => {
    try {
      const permission = await Notifications.requestExactAlarmPermissionsAsync();
      setNote(
        permission.granted
          ? 'Dokładne alarmy włączone.'
          : 'Android nie dał dokładnych alarmów — powiadomienia mogą się spóźniać.',
      );
    } catch {
      setNote('Ten telefon nie pyta o dokładne alarmy (starszy Android albo iOS).');
    }
    again();
  };

  const body = (): string => {
    const count = status?.due ?? 0;
    if (count === 0) return 'Nic nie czeka — ale lekcja zawsze się przyda.';
    return count === 1 ? '1 słówko czeka na powtórkę' : `${count} słówka czekają na powtórkę`;
  };

  const inAMinute = async () => {
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Lingo Memo', body: body(), data: { kind: KIND } },
      trigger: { type: SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 60, channelId: CHANNEL },
    });
    setNote('Zaplanowane za minutę. Zgaś ekran i policz, ile naprawdę minęło.');
    again();
  };

  const daily = async () => {
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Czas na powtórki', body: body(), data: { kind: KIND } },
      trigger: { type: SchedulableTriggerInputTypes.DAILY, hour: 17, minute: 0, channelId: CHANNEL },
    });
    setNote('Zaplanowane codziennie na 17:00. Pomiar: czy przyszło nazajutrz bez otwierania aplikacji.');
    again();
  };

  const clear = async () => {
    for (const item of await Notifications.getAllScheduledNotificationsAsync()) {
      if (item.content.data?.kind === KIND) await Notifications.cancelScheduledNotificationAsync(item.identifier);
    }
    setNote('Wyczyszczone.');
    again();
  };

  const granted = status?.granted === true;

  return (
    <Screen>
      {note !== null && <Message kind="ok" text={note} />}

      <Card>
        <Title>Zgody</Title>
        <Body>Powiadomienia: {status === null ? '…' : granted ? 'są' : 'BRAK'}</Body>
        <Body>
          Dokładne alarmy: {status === null ? '…' : status.exact ? 'są' : 'BRAK — Android będzie przesuwał'}
        </Body>
        {status !== null && !granted && <Button label="Poproś o zgodę" onPress={() => void ask()} />}
        {status !== null && !status.exact && (
          <Button kind="quiet" label="Dokładne alarmy" onPress={() => void askExact()} />
        )}
      </Card>

      <Card>
        <Title>Treść z bazy</Title>
        <Body>
          Zaległe słówka (stan na {localToday()}): {status === null ? '…' : status.due}
        </Body>
        <Body muted>
          Liczba z srs_state, bez filtra „słówko ma aktywne zadanie” — w produkcie liczy to
          review_gate. Tutaj chodzi tylko o to, czy treść powiadomienia da się złożyć z danych ucznia.
        </Body>
      </Card>

      <Card>
        <Title>Zaplanuj</Title>
        <Button label="Za minutę" disabled={!granted} onPress={() => void inAMinute()} />
        <Button label="Codziennie o 17:00" disabled={!granted} onPress={() => void daily()} />
        {(status?.planned.length ?? 0) > 0 && (
          <Button kind="quiet" label="Wyczyść zaplanowane" onPress={() => void clear()} />
        )}
      </Card>

      <Card>
        <Title>Zaplanowane ({status?.planned.length ?? 0})</Title>
        {status === null || status.planned.length === 0 ? (
          <Body muted>Nic nie czeka.</Body>
        ) : (
          status.planned.map((line) => (
            <Body key={line} muted>
              {line}
            </Body>
          ))
        )}
      </Card>
    </Screen>
  );
}
