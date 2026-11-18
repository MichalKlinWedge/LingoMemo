import { plural, POINTS } from '@lingomemo/core';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Body, Message, Screen } from '@/components/ui';
import { color, size } from '@/constants/theme';
import { type Badge, loadBadges } from '@/features/stats/load';
import { useSession } from '@/lib/session';

/** Nagrody: wszystkie odznaki, zdobyte w kolorach, pozostałe pod kłódką. */
export default function RewardsScreen() {
  const session = useSession();
  const userId = session?.user.id ?? null;
  const [data, setData] = useState<{ badges: Badge[]; points: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (userId === null) return;
      let alive = true;
      void loadBadges(userId).then((result) => {
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
    }, [userId]),
  );

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
        <Body muted>Wczytuję odznaki…</Body>
      </Screen>
    );
  }

  const got = data.badges.filter((badge) => badge.awardedAt !== null).length;

  return (
    <Screen>
      <Body muted>
        Masz {plural(data.points, POINTS)} i {got} z {data.badges.length} odznak.
      </Body>
      {data.badges.map((badge) => {
        const earned = badge.awardedAt !== null;
        const udzial = badge.target > 0 ? badge.value / badge.target : 0;
        return (
          <View key={badge.code} style={styles.badge}>
            {/* Przygaszona jest sama ikona, nie cały wiersz: opis i pasek mówią, co trzeba
                zrobić, żeby odznakę zdobyć, więc muszą zostać czytelne. */}
            <Text style={[styles.icon, !earned && styles.locked]}>{earned ? (badge.icon ?? '🏅') : '🔒'}</Text>
            <View style={styles.text}>
              <Text style={styles.title}>{badge.title}</Text>
              {badge.description !== null && <Text style={styles.desc}>{badge.description}</Text>}
              {earned && badge.awardedAt !== null && (
                <Text style={styles.when}>zdobyta {new Date(badge.awardedAt).toLocaleDateString('pl-PL')}</Text>
              )}
              {!earned && badge.target > 0 && (
                <>
                  <Text style={styles.when}>
                    {badge.value} z {badge.target}
                  </Text>
                  <View style={styles.bar}>
                    <View style={[styles.barFill, { width: `${Math.round(udzial * 100)}%` }]} />
                  </View>
                </>
              )}
            </View>
          </View>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: size.radius,
    borderWidth: 1,
    flexDirection: 'row',
    gap: size.gap,
    padding: size.pad,
  },
  // Niezdobytej odznaki nie ukrywamy — dziecko ma widzieć, co jest do zdobycia.
  locked: { opacity: 0.5 },
  icon: { fontSize: 40 },
  text: { flex: 1, gap: 2 },
  title: { color: color.text, fontSize: 19, fontWeight: '700' },
  desc: { color: color.muted, fontSize: 16 },
  when: { color: color.muted, fontSize: 14 },
  // Pasek postępu: „już blisko” widać szybciej z kreski niż z liczby.
  bar: { backgroundColor: color.line, borderRadius: 999, height: 8, marginTop: 2, overflow: 'hidden' },
  barFill: { backgroundColor: color.brand, borderRadius: 999, height: '100%' },
});
