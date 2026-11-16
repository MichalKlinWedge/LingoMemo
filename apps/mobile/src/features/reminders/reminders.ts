import * as Notifications from 'expo-notifications';
import { AndroidImportance, SchedulableTriggerInputTypes } from 'expo-notifications';

import { dueWords } from '@/features/stats/load';
import { localToday } from '@/lib/clock';

/**
 * Codzienne przypomnienie o powtórkach. Jedno powiadomienie lokalne dziennie, o godzinie
 * z ustawień, z liczbą zaległych słówek w treści.
 *
 * Dwie rzeczy, które w ExpeditionPlan okazały się krytyczne (P1.3 w `ANALIZA_TELEFON.md`):
 * bez uprawnienia `SCHEDULE_EXACT_ALARM` Android przesuwa powiadomienia (w uśpieniu nawet
 * o kilkanaście minut), a przypomnienia domyślnie wyłączone znaczą, że dziecko zostanie bez nich
 * — dlatego o włączenie pytamy na ekranie kursów, a nie chowamy w ustawieniach systemowych.
 *
 * Treść powstaje w chwili planowania, a powtarzający się wyzwalacz dzienny nie umie jej odświeżać
 * sam. Dlatego `refreshReminder()` planuje je od nowa przy każdym wejściu na ekran kursów i po
 * zaliczonej lekcji — czyli dokładnie wtedy, gdy liczba zaległych mogła się zmienić. Przeliczanie
 * raz na dobę przy zamkniętej aplikacji wymagałoby zadania w tle, czyli nowego APK (Etap M4).
 */

const CHANNEL = 'powtorki';
const KIND = 'powtorki';
const KEY_ON = 'lingomemo.reminders.on';
const KEY_HOUR = 'lingomemo.reminders.hour';

/** Godziny do wyboru. Po szkole i przed kolacją — przed 15:00 dziecka nie ma, po 20:00 już śpi. */
export const HOURS = [15, 16, 17, 18, 19, 20];

const DEFAULT_HOUR = 17;

/**
 * Magazyn na ustawienia to `localStorage` z expo-sqlite (instaluje go `lib/supabase`). Czytamy
 * przez try/catch, bo przy pierwszym uruchomieniu i po wyczyszczeniu danych odczyt może rzucić.
 */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Brak magazynu znaczy tylko tyle, że ustawienie nie przeżyje restartu.
  }
}

export const remindersOn = (): boolean => read(KEY_ON) === '1';

export const reminderHour = (): number => {
  const value = Number(read(KEY_HOUR));
  return HOURS.includes(value) ? value : DEFAULT_HOUR;
};

/** Dokładne alarmy; na starszym Androidzie i na iOS ta zgoda nie istnieje i są domyślne. */
export async function exactAlarms(): Promise<boolean> {
  try {
    return (await Notifications.getExactAlarmPermissionsAsync()).granted;
  } catch {
    return true;
  }
}

/** Ekran systemowy „Alarmy i przypomnienia”. Po zgodzie planujemy przypomnienie od nowa. */
export async function requestExactAlarms(userId: string): Promise<boolean> {
  try {
    const granted = (await Notifications.requestExactAlarmPermissionsAsync()).granted;
    if (granted) await refreshReminder(userId);
    return granted;
  } catch {
    return false;
  }
}

async function clear(): Promise<void> {
  for (const item of await Notifications.getAllScheduledNotificationsAsync()) {
    if (item.content.data?.kind === KIND) await Notifications.cancelScheduledNotificationAsync(item.identifier);
  }
}

function body(due: number): string {
  if (due === 0) return 'Nic nie czeka — ale jedna lekcja zawsze się przyda.';
  return due === 1 ? '1 słówko czeka na powtórkę' : `${due} słówka czekają na powtórkę`;
}

/** Zaplanowanie od nowa: najpierw sprzątamy swoje, potem jedno powiadomienie dzienne. */
async function schedule(userId: string): Promise<void> {
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Powtórki',
    description: 'Przypomnienie, że czekają słówka do powtórzenia',
    importance: AndroidImportance.HIGH,
  });
  await clear();
  const due = await dueWords(userId, localToday());
  await Notifications.scheduleNotificationAsync({
    content: { title: 'Czas na powtórki', body: body(due), data: { kind: KIND } },
    trigger: {
      type: SchedulableTriggerInputTypes.DAILY,
      hour: reminderHour(),
      minute: 0,
      channelId: CHANNEL,
    },
  });
}

export async function enableReminders(userId: string, hour?: number): Promise<{ on: boolean; exact: boolean }> {
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return { on: false, exact: false };
  if (hour !== undefined && HOURS.includes(hour)) write(KEY_HOUR, String(hour));
  write(KEY_ON, '1');
  await schedule(userId);
  return { on: true, exact: await exactAlarms() };
}

export async function disableReminders(): Promise<void> {
  write(KEY_ON, null);
  await clear();
}

/** Godzina z ustawień. Zmiana planuje przypomnienie od nowa, jeśli jest włączone. */
export async function setReminderHour(userId: string, hour: number): Promise<void> {
  if (!HOURS.includes(hour)) return;
  write(KEY_HOUR, String(hour));
  if (remindersOn()) await schedule(userId);
}

/** Odświeżenie treści (liczby zaległych). Wyłączone przypomnienia nic nie robią. */
export async function refreshReminder(userId: string): Promise<void> {
  if (!remindersOn()) return;
  if (!(await Notifications.getPermissionsAsync()).granted) return;
  await schedule(userId);
}
