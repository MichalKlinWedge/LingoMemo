import { plural } from '@lingomemo/core';
import { StyleSheet, Text, View } from 'react-native';

import { color, size } from '@/constants/theme';
import type { DailyRow } from '@/features/stats/load';

/** Klocek z liczbą. Te same cztery na ekranie postępów co na webie. */
export function Tile({ value, label, icon }: { value: string | number; label: string; icon: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileIcon}>{icon}</Text>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

/** Siedem ostatnich dni, także tych bez nauki — przerwa w nauce też jest informacją. */
function lastSevenDays(): string[] {
  const days: string[] = [];
  const today = new Date();
  for (let back = 6; back >= 0; back -= 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - back);
    // Data z zegara telefonu, nie z UTC: nad ranem `toISOString` dawałby wczoraj.
    const month = String(day.getMonth() + 1).padStart(2, '0');
    const date = String(day.getDate()).padStart(2, '0');
    days.push(`${day.getFullYear()}-${month}-${date}`);
  }
  return days;
}

const WEEKDAY = ['N', 'P', 'W', 'Ś', 'C', 'P', 'S'];
const BAR_MAX = 112;

/**
 * Wykres tygodnia. Jedna seria, więc bez legendy, a liczba stoi tylko nad najlepszym dniem —
 * podpisywanie każdego słupka zamienia wykres w tabelę.
 */
export function WeekChart({ daily }: { daily: DailyRow[] }) {
  const days = lastSevenDays();
  const byDay = new Map(daily.filter((row) => row.day !== null).map((row) => [row.day, row]));
  const peak = Math.max(1, ...days.map((day) => byDay.get(day)?.answers ?? 0));
  const weekTotal = days.reduce((sum, day) => sum + (byDay.get(day)?.answers ?? 0), 0);

  return (
    <View style={styles.chart}>
      <View style={styles.chartHead}>
        <Text style={styles.chartTitle}>Ostatni tydzień</Text>
        <Text style={styles.chartTotal}>{plural(weekTotal, ['odpowiedź', 'odpowiedzi', 'odpowiedzi'])}</Text>
      </View>
      <View style={styles.bars}>
        {days.map((day) => {
          const answers = byDay.get(day)?.answers ?? 0;
          const height = answers === 0 ? 4 : Math.max(6, Math.round((answers / peak) * BAR_MAX));
          const date = new Date(`${day}T12:00:00`);
          const isPeak = answers === peak && answers > 0;
          return (
            <View key={day} style={styles.barCol}>
              <Text style={styles.barValue}>{isPeak ? answers : ''}</Text>
              <View style={styles.barSlot}>
                <View style={[styles.bar, { height, backgroundColor: answers === 0 ? color.line : color.brand }]} />
              </View>
              <Text style={styles.barDay}>{WEEKDAY[date.getDay()]}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** Celność w procentach. Bez odpowiedzi nie ma czego liczyć — wtedy kreska, nie „0%". */
export function accuracy(correct: number, total: number): string {
  return total === 0 ? '—' : `${Math.round((correct / total) * 100)}%`;
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: size.radius,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: size.gap,
  },
  tileIcon: { fontSize: 26 },
  tileValue: { color: color.text, fontSize: 28, fontWeight: '700' },
  tileLabel: { color: color.muted, fontSize: 15, textAlign: 'center' },
  chart: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: size.radius,
    borderWidth: 1,
    gap: size.gap,
    padding: size.pad,
  },
  chartHead: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between' },
  chartTitle: { color: color.text, fontSize: 20, fontWeight: '700' },
  chartTotal: { color: color.muted, fontSize: 15 },
  bars: { alignItems: 'flex-end', flexDirection: 'row', gap: 8 },
  barCol: { alignItems: 'center', flex: 1, gap: 2 },
  barValue: { color: color.text, fontSize: 13, fontWeight: '700', height: 18 },
  barSlot: { alignItems: 'flex-end', flexDirection: 'row', height: BAR_MAX, width: '100%' },
  bar: { borderTopLeftRadius: 4, borderTopRightRadius: 4, width: '100%' },
  barDay: { color: color.muted, fontSize: 13 },
});
