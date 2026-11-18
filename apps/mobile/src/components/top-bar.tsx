import { DAYS, plural, POINTS, UNLOCKS, WORDS } from '@lingomemo/core';
import { usePathname, useRouter } from 'expo-router';
import { type ImageSourcePropType, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';

import { Chip } from '@/components/ui';
import { color, size } from '@/constants/theme';
import { type BarData, loadBar } from '@/features/stats/load';
import { useSession } from '@/lib/session';

const IKONA = require('../../assets/ikona.png') as ImageSourcePropType;

/**
 * Wspólny pasek nad każdym ekranem — ten sam, co na webie
 * (`apps/web/src/components/top-bar.tsx`): sowa, imię, stan konta i zębatka.
 *
 * Dotąd stan konta stał kartą na ekranie kursów, czyli w treści: odjeżdżał przy przewijaniu
 * i znikał na każdym innym ekranie. Punkty zdobywa się w lekcji, a patrzy na nie wszędzie,
 * więc pasek należy do ramy aplikacji, nie do jednego ekranu.
 *
 * Nie pokazuje się na dwa sposoby: niezalogowanemu (ekran powitalny i logowanie — nie ma czego
 * pokazywać) i w trakcie lekcji. Lekcja ma własny pasek z krzyżykiem wyjścia i postępem, a przy
 * zadaniu z klawiaturą liczy się każdy wiersz wysokości.
 */
export function TopBar() {
  const session = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = session?.user.id ?? null;
  const [bar, setBar] = useState<BarData | null>(null);

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
  }, [userId, pathname]);

  if (session === null || session === undefined) return null;
  // Sama lekcja, czyli ekran z zadaniami — ale już nie plansza ze słówkami („…/nauka"), która
  // jest zwykłym ekranem do czytania i ma własną strzałkę powrotu.
  if (pathname.startsWith('/lekcja/') && !pathname.endsWith('/nauka')) return null;

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

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ustawienia"
          hitSlop={8}
          onPress={() => router.push('/ustawienia')}
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
          <Chip label={`${plural(bar.points, POINTS)} — zobacz nagrody`} onPress={() => router.push('/nagrody')}>
            ⭐ {bar.points}
          </Chip>
          <Chip
            label={`seria: ${plural(bar.streak, DAYS)} nauki pod rząd — zobacz postępy`}
            onPress={() => router.push('/statystyki')}
          >
            🔥 {bar.streak}
          </Chip>
          {bar.due > 0 && (
            <Chip
              label={`${plural(bar.due, WORDS)} do powtórki — zobacz postępy`}
              onPress={() => router.push('/statystyki')}
            >
              🔁 {bar.due}
            </Chip>
          )}
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
  // Zębatka: 44 px plus `hitSlop`, bo wymagane 56 rozepchnęłoby pasek nad każdym ekranem.
  gear: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  gearIcon: { fontSize: 24 },
  pressed: { opacity: 0.6 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
