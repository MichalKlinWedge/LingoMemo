import { DAYS, formatDuration, plural, POINTS, spellDuration, WORDS } from '@lingomemo/core';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Body, Card, Message, Screen, Title } from '@/components/ui';
import { accuracy, Tile, WeekChart } from '@/components/stats-widgets';
import { color, size } from '@/constants/theme';
import { loadStats, type StatsData } from '@/features/stats/load';
import { useSession } from '@/lib/session';

/** Twoje postępy — te same liczby, które o tym dziecku pokazuje web. */
export default function StatsScreen() {
  const session = useSession();
  const userId = session?.user.id ?? null;
  const [data, setData] = useState<StatsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (userId === null) return;
      let alive = true;
      void loadStats(userId).then((result) => {
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
        <Body muted>Liczę…</Body>
      </Screen>
    );
  }

  const stats = data.stats;
  const streak = stats?.streak_days ?? 0;

  return (
    <Screen>
      <View style={styles.tiles}>
        <Tile icon="⭐" value={stats?.total_points ?? 0} label="punktów" />
        <Tile icon="🔥" value={streak} label={plural(streak, DAYS).split(' ')[1] ?? 'dni'} />
        <Tile icon="🧠" value={stats?.words_mastered ?? 0} label="umianych słówek" />
        <Tile icon="🔁" value={stats?.words_due ?? 0} label="do powtórki" />
      </View>

      <View style={styles.tiles}>
        <Tile icon="📘" value={stats?.lessons_done ?? 0} label="zaliczonych lekcji" />
        <Tile icon="🗣️" value={stats?.words_seen ?? 0} label="poznanych słówek" />
        <Tile icon="⏱️" value={formatDuration(stats?.seconds_week ?? 0)} label="nauki w tym tygodniu" />
        <Tile
          icon="🎯"
          value={accuracy(stats?.answers_correct ?? 0, stats?.answers_total ?? 0)}
          label="trafionych odpowiedzi"
        />
      </View>

      <WeekChart daily={data.daily} />

      {data.courses.length > 0 && (
        <>
          <Title>Twoje kursy</Title>
          {data.courses.map((course) => (
            <Card key={course.course_id ?? course.course_title}>
              <Text style={styles.courseTitle}>
                {course.course_icon ?? '📘'} {course.course_title}
              </Text>
              <Body muted>
                lekcje: {course.lessons_done ?? 0} z {course.lessons_total ?? 0} ·{' '}
                {plural(course.words_seen ?? 0, WORDS)} · ⏱️ {formatDuration(course.seconds_total ?? 0)}
              </Body>
            </Card>
          ))}
        </>
      )}

      <Title>Do poćwiczenia</Title>
      {data.weak.length === 0 ? (
        <Body muted>Na razie nic się nie myli. {plural(stats?.words_seen ?? 0, WORDS)} za tobą.</Body>
      ) : (
        data.weak.map((word) => (
          <Card key={word.concept_id ?? word.source_text}>
            <Body>
              {word.source_text} — {word.target_text}
            </Body>
            <Body muted>{plural(word.lapses ?? 0, ['pomyłka', 'pomyłki', 'pomyłek'])}</Body>
          </Card>
        ))
      )}

      <Body muted>
        Zdobytych odznak: {stats?.badges_earned ?? 0} · najdłuższa seria: {plural(stats?.best_streak ?? 0, DAYS)} ·{' '}
        {plural(stats?.total_points ?? 0, POINTS)} · czas nauki od początku:{' '}
        {spellDuration(stats?.seconds_total ?? 0)}
      </Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: size.gap },
  courseTitle: { color: color.text, fontSize: 19, fontWeight: '700' },
});
