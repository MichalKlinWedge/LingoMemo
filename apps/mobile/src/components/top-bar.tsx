import { DAYS, HINTS, plural, POINTS, UNLOCKS, WORDS } from '@lingomemo/core';
import { usePathname, useRouter } from 'expo-router';
import * as Updates from 'expo-updates';
import { type ImageSourcePropType, AppState, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { Chip } from '@/components/ui';
import { color, size } from '@/constants/theme';
import { type BarData, barVersion, loadBar, subscribeBar } from '@/features/stats/load';
import { type NewVersion, applyNewVersion, checkRelease } from '@/features/update/check';
import { useSession } from '@/lib/session';

const IKONA = require('../../assets/ikona.png') as ImageSourcePropType;

/**
 * Wspólny pasek nad każdym ekranem — ten sam, co na webie
 * (`apps/web/src/components/top-bar.tsx`): sowa, imię, stan konta i zębatka. Obok zębatki staje
 * strzałka pobrania, gdy czeka nowa wersja aplikacji (`features/update/check.ts`) — na webie jej
 * nie ma, bo tam nowa wersja przychodzi sama przy odświeżeniu strony.
 *
 * Dotąd stan konta stał kartą na ekranie kursów, czyli w treści: odjeżdżał przy przewijaniu
 * i znikał na każdym innym ekranie. Punkty zdobywa się w lekcji, a patrzy na nie wszędzie,
 * więc pasek należy do ramy aplikacji, nie do jednego ekranu.
 *
 * Nie pokazuje się tylko niezalogowanemu — na ekranie powitalnym i przy logowaniu nie ma czego
 * pokazywać. W lekcji jest, choć lekcja ma już własny pasek z krzyżykiem wyjścia i postępem:
 * dziecko ma widzieć punkty tam, gdzie je zdobywa, a nie dopiero po wyjściu. Kosztuje to dwa
 * wiersze wysokości przy zadaniu z klawiaturą — o tyle krótsza jest wtedy treść zadania.
 */
export function TopBar() {
  const session = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = session?.user.id ?? null;
  const [bar, setBar] = useState<BarData | null>(null);
  // Numer wersji danych paska. Rośnie, gdy lekcja wyda podpowiedź albo zamknie etap — wtedy
  // liczby są już inne, a ekran się nie zmienił, więc sam adres by tego nie wychwycił.
  const wersja = useSyncExternalStore(subscribeBar, barVersion, barVersion);
  // Poprawka JS z kanału `preview`: `isUpdateAvailable` zapala się po sprawdzeniu przy
  // uruchomieniu (`checkAutomatically: ON_LOAD`), `isUpdatePending` gdy paczka jest już pobrana
  // i czeka na start aplikacji. Dla dziecka to jedno i to samo: jest nowa wersja.
  const { isUpdateAvailable, isUpdatePending } = Updates.useUpdates();
  const [release, setRelease] = useState<NewVersion | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [failed, setFailed] = useState(false);

  /**
   * Odczyt przy każdej zmianie ekranu: po lekcji punktów i zaległych jest już inaczej.
   *
   * Po adresie, a nie przez `useFocusEffect`: pasek wisi NAD stosem ekranów, więc z punktu
   * widzenia nawigacji nigdy nie traci ogniskowania i takie wywołanie zdarzyłoby się raz,
   * przy pierwszym uruchomieniu — liczby stałyby w miejscu do końca dnia.
   */
  useEffect(() => {
    if (userId === null) return;
    let alive = true;
    void loadBar(userId).then((data) => {
      if (alive) setBar(data);
    });
    return () => {
      alive = false;
    };
  }, [userId, pathname, wersja]);

  /** Nowy APK na GitHubie — raz na uruchomienie, bo pasek wisi nad wszystkimi ekranami. */
  useEffect(() => {
    let alive = true;
    void checkRelease().then((found) => {
      if (alive) setRelease(found);
    });

    // Powrót do aplikacji po przerwie. Paczkę JS sprawdza samo `expo-updates`, ale tylko przy
    // uruchomieniu, a tablet potrafi stać z aplikacją w tle całymi dniami.
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !Updates.isEnabled) return;
      void Updates.checkForUpdateAsync().catch(() => undefined);
    });

    return () => {
      alive = false;
      listener.remove();
    };
  }, []);

  if (session === null || session === undefined) return null;

  /**
   * Wejście w ekran poboczny (nagrody, postępy, ustawienia) z paska.
   *
   * Pasek wisi nad KAŻDYM ekranem, więc jego znaczniki i zębatkę da się dotknąć także na tych
   * ekranach. Zwykłe `push` dokładałoby wtedy ten sam ekran drugi raz na stos, a strzałka
   * powrotu wracała do jego kopii — dziecko naciskało „wstecz", nic się nie zmieniało i do
   * kursu nie było jak wrócić. Dlatego:
   *
   *   * ten sam ekran — nie robimy nic,
   *   * przesiadka między ekranami pobocznymi — `replace`, czyli stos nie rośnie,
   *   * wejście z kursu albo z lekcji — `push`, bo stamtąd powrót ma wrócić właśnie tam.
   *
   * Dzięki temu powrót z nagród i postępów prowadzi zawsze do kursu, z którego dziecko weszło,
   * niezależnie od tego, ile razy przeskakiwało między nimi paskiem.
   */
  /**
   * Jedna ikona na dwie drogi do nowej wersji. Pierwsza jest poprawka JS: przychodzi częściej,
   * pobiera się w sekundy i nie wymaga niczego od człowieka. Nowy APK pokazujemy tylko wtedy,
   * gdy poprawki nie ma.
   *
   * W lekcji ikony nie ma: włączenie nowej wersji startuje aplikację od nowa, czyli w połowie
   * etapu zabrałoby dziecku zadania, które właśnie robi.
   */
  const newVersion: NewVersion | null = isUpdateAvailable || isUpdatePending ? { kind: 'ota' } : release;
  const showUpdate = newVersion !== null && !pathname.startsWith('/lekcja/');

  const download = () => {
    if (newVersion === null || downloading) return;
    setFailed(false);
    setDownloading(true);
    void applyNewVersion(newVersion)
      .then(() => {
        // Przy poprawce JS aplikacja jest już w tym momencie przeładowana i tu nie dojdzie.
        setRelease(null);
        setDownloading(false);
      })
      .catch(() => {
        setDownloading(false);
        setFailed(true);
      });
  };

  const POBOCZNE: string[] = ['/nagrody', '/statystyki', '/ustawienia'];
  const otworz = (href: '/nagrody' | '/statystyki' | '/ustawienia') => {
    if (pathname === href) return;
    if (POBOCZNE.includes(pathname)) router.replace(href);
    else router.push(href);
  };

  return (
    <View style={[styles.bar, { paddingTop: insets.top + 8 }]}>
      <View style={styles.row}>
        {/* Sowa i imię prowadzą na ekran kursów — to jest „wyjście" z każdego miejsca
            aplikacji, tak samo jak kliknięcie imienia na webie. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Twoje kursy"
          onPress={() => router.navigate('/')}
          style={({ pressed }) => [styles.name, pressed && styles.pressed]}
        >
          <Image source={IKONA} style={styles.logo} />
          <Text style={styles.nameText} numberOfLines={1}>
            Cześć, {bar?.name ?? 'uczniu'}!
          </Text>
        </Pressable>

        {/* Strzałka w dół, nie druga zębatka: zębatka obok prowadzi do ustawień, a dwie takie
            same ikony w jednym pasku znaczyłyby dwie różne rzeczy. Strzałka mówi wprost, co się
            stanie po dotknięciu. */}
        {showUpdate && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              failed
                ? 'Nie udało się pobrać nowej wersji — dotknij, żeby spróbować jeszcze raz'
                : downloading
                  ? 'Pobieram nową wersję'
                  : newVersion?.kind === 'ota'
                    ? 'Nowa wersja gotowa — dotknij, żeby ją włączyć'
                    : 'Nowa wersja do pobrania — dotknij, żeby otworzyć plik'
            }
            hitSlop={8}
            onPress={download}
            style={({ pressed }) => [styles.gear, pressed && styles.pressed]}
          >
            <Text style={styles.gearIcon}>{failed ? '⚠️' : downloading ? '⏳' : '⬇️'}</Text>
          </Pressable>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ustawienia"
          hitSlop={8}
          onPress={() => otworz('/ustawienia')}
          style={({ pressed }) => [styles.gear, pressed && styles.pressed]}
        >
          <Text style={styles.gearIcon}>⚙️</Text>
        </Pressable>
      </View>

      {/* Sama ikona i liczba, tak jak w pasku na webie: cztery znaczniki z pełnym opisem
          zawijały się na drugi wiersz, a dziecko czyta z nich liczbę, nie zdanie. Słowa
          zostają w etykiecie dla czytnika ekranu. */}
      {bar !== null && (
        <View style={styles.stats}>
          {/* Każdy znacznik prowadzi tam, gdzie widać jego liczbę z bliska — dokładnie jak
              w pasku na webie. Dlatego pod kursami nie ma osobnych przycisków „Nagrody"
              i „Postępy": były drugim wejściem w to samo, a stały na samym dole ekranu. */}
          <Chip label={`${plural(bar.points, POINTS)} — zobacz nagrody`} onPress={() => otworz('/nagrody')}>
            ⭐ {bar.points}
          </Chip>
          <Chip
            label={`seria: ${plural(bar.streak, DAYS)} nauki pod rząd — zobacz postępy`}
            onPress={() => otworz('/statystyki')}
          >
            🔥 {bar.streak}
          </Chip>
          {bar.due > 0 && (
            <Chip
              label={`${plural(bar.due, WORDS)} do powtórki — zobacz postępy`}
              onPress={() => otworz('/statystyki')}
            >
              🔁 {bar.due}
            </Chip>
          )}
          {/* Podpowiedzi na dziś — również w lekcji, bo to tam dziecko po nie sięga. Liczba
              nadąża, bo lekcja woła `barChanged()` zaraz po wydaniu podpowiedzi.
              Zero pokazujemy, w odróżnieniu od punktów odblokowania: „💡 0" tłumaczy, czemu
              w lekcji nie ma już przycisku podpowiedzi. */}
          <Chip label={`podpowiedzi na dziś: ${plural(bar.hints, HINTS)}`}>💡 {bar.hints}</Chip>
          {/* Bez punktów znacznika nie ma: dziecko przed pierwszym poziomem trudnym nie ma
              o czym wiedzieć, a pasek ma zostać krótki. Wydaje się je na ekranie kursu,
              dotykając kłódki z kluczykiem. */}
          {bar.unlocks > 0 && <Chip label={plural(bar.unlocks, UNLOCKS)}>🔑 {bar.unlocks}</Chip>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: color.surface,
    borderBottomColor: color.line,
    borderBottomWidth: 1,
    gap: 8,
    paddingBottom: 10,
    paddingHorizontal: size.pad,
  },
  row: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  name: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 10, minHeight: 44 },
  logo: { height: 32, width: 32 },
  nameText: { color: color.text, flexShrink: 1, fontSize: 20, fontWeight: '700' },
  // Zębatka i strzałka pobrania: 44 px plus `hitSlop`, bo wymagane 56 rozepchnęłoby pasek nad
  // każdym ekranem.
  gear: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  gearIcon: { fontSize: 24 },
  pressed: { opacity: 0.6 },
  // Odstęp mniejszy niż między kartami: cztery przerwy po 8 px to pół znacznika szerokości,
  // a wiersz ma pomieścić wszystkie pięć. Zawijanie zostaje jako wyjście awaryjne — gdy liczby
  // kiedyś przerosną i to, lepiej drugi wiersz niż ucięty klucz.
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
