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
        return (
          <View key={badge.code} style={[styles.badge, !earned && styles.locked]}>
            <Text style={styles.icon}>{earned ? (badge.icon ?? '🏅') : '🔒'}</Text>
            <View style={styles.text}>
              <Text style={styles.title}>{badge.title}</Text>
              {badge.description !== null && <Text style={styles.desc}>{badge.description}</Text>}
              {earned && badge.awardedAt !== null && (
                <Text style={styles.when}>zdobyta {new Date(badge.awardedAt).toLocaleDateString('pl-PL')}</Text>
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
  locked: { opacity: 0.55 },
  icon: { fontSize: 40 },
  text: { flex: 1, gap: 2 },
  title: { color: color.text, fontSize: 19, fontWeight: '700' },
  desc: { color: color.muted, fontSize: 16 },
  when: { color: color.muted, fontSize: 14 },
});
