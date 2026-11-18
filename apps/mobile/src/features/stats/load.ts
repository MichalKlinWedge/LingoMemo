import { dbErrorMessage } from '@lingomemo/core';

import { supabase } from '@/lib/supabase';

/**
 * Postępy ucznia i nagrody. Te same widoki co na webie (`v_my_stats`, `v_my_daily`,
 * `v_my_weak_words`, `v_my_courses`) — liczy je baza, telefon tylko pokazuje.
 *
 * Filtr `eq('user_id', …)` przy KAŻDYM widoku, mimo RLS: polityki puszczają rodzicowi także
 * wiersze jego dzieci, a administratorowi wszystkie. Bez filtru wykres tygodnia i „do
 * poćwiczenia" pokazywałyby cudzą naukę jako własną.
 */

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type MyStats = {
  total_points: number | null;
  streak_days: number | null;
  best_streak: number | null;
  lessons_done: number | null;
  words_seen: number | null;
  words_mastered: number | null;
  words_due: number | null;
  badges_earned: number | null;
  seconds_week: number | null;
  seconds_total: number | null;
  answers_total: number | null;
  answers_correct: number | null;
};

export type DailyRow = { day: string | null; answers: number | null; correct: number | null };

export type WeakWord = {
  concept_id: string | null;
  lapses: number | null;
  source_text: string | null;
  target_text: string | null;
};

export type CourseStat = {
  course_id: string | null;
  course_title: string | null;
  course_icon: string | null;
  course_target_lang: string | null;
  lessons_done: number | null;
  lessons_total: number | null;
  words_seen: number | null;
  seconds_total: number | null;
};

export type StatsData = {
  stats: MyStats | null;
  daily: DailyRow[];
  weak: WeakWord[];
  courses: CourseStat[];
};

export async function loadStats(userId: string): Promise<Result<StatsData>> {
  const [{ data: stats, error }, { data: daily }, { data: weak }, { data: courses }] = await Promise.all([
    supabase.from('v_my_stats').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('v_my_daily').select('day, answers, correct').eq('user_id', userId),
    supabase
      .from('v_my_weak_words')
      .select('concept_id, lapses, source_text, target_text')
      .eq('user_id', userId)
      .gt('lapses', 0)
      .order('lapses', { ascending: false })
      .limit(5),
    supabase.from('v_my_courses').select('*').eq('user_id', userId).order('course_title'),
  ]);

  if (error) return { ok: false, error: dbErrorMessage(error, 'Nie udało się wczytać postępów.') };

  return {
    ok: true,
    value: {
      stats: (stats as unknown as MyStats | null) ?? null,
      daily: (daily ?? []) as DailyRow[],
      weak: (weak ?? []) as WeakWord[],
      courses: (courses ?? []) as unknown as CourseStat[],
    },
  };
}

export type Badge = {
  code: string;
  title: string;
  description: string | null;
  icon: string | null;
  /** Kiedy zdobyta; `null` znaczy „jeszcze nie". */
  awardedAt: string | null;
  /** Ile dziecko ma i ile potrzeba — do paska postępu przy niezdobytej odznace. */
  value: number;
  target: number;
};

export async function loadBadges(userId: string): Promise<Result<{ badges: Badge[]; points: number }>> {
  const [{ data: all, error }, { data: mine }, { data: stats }, { data: progress }] = await Promise.all([
    supabase.from('badges').select('code, title, description, icon').eq('is_active', true).order('sort_order'),
    supabase.from('user_badges').select('badge_code, awarded_at').eq('user_id', userId),
    supabase.from('v_my_stats').select('total_points').eq('user_id', userId).maybeSingle(),
    // Ile brakuje do każdej odznaki. Liczy baza — progi siedzą w `badges.rule`, nie tutaj.
    supabase.rpc('my_badge_progress'),
  ]);

  if (error) return { ok: false, error: dbErrorMessage(error, 'Nie udało się wczytać odznak.') };

  const earned = new Map((mine ?? []).map((row) => [row.badge_code, row.awarded_at]));
  const postep = new Map((progress ?? []).map((row) => [row.code, row]));

  return {
    ok: true,
    value: {
      badges: (all ?? []).map((badge) => ({
        code: badge.code,
        title: badge.title,
        description: badge.description,
        icon: badge.icon,
        awardedAt: earned.get(badge.code) ?? null,
        value: postep.get(badge.code)?.value ?? 0,
        target: postep.get(badge.code)?.target ?? 0,
      })),
      points: stats?.total_points ?? 0,
    },
  };
}

/** Liczba zaległych słówek — treść przypomnienia o powtórkach. */
export async function dueWords(userId: string, today: string): Promise<number> {
  const { count } = await supabase
    .from('srs_state')
    .select('concept_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .lte('due_on', today);
  return count ?? 0;
}

export type BarData = { name: string; points: number; streak: number; due: number; unlocks: number };

/**
 * Pasek stanu: imię, punkty, seria, zaległe powtórki i punkty odblokowania. Wisi nad każdym
 * ekranem (`src/components/top-bar.tsx`), tak samo jak na webie
 * (`apps/web/src/components/top-bar.tsx`).
 *
 * Błędu nie zwracamy, tak samo jak pasek na webie: to ozdoba nad treścią, a nie treść. Przy
 * nieudanym odczycie zostają zera, a ekran kursów pokazuje się normalnie.
 */
export async function loadBar(userId: string): Promise<BarData> {
  const [{ data: profile }, { data: stats }, { data: unlock }] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', userId).maybeSingle(),
    supabase.from('v_my_stats').select('total_points, streak_days, words_due').eq('user_id', userId).maybeSingle(),
    supabase.rpc('unlock_status', { p_user: userId }),
  ]);

  return {
    name: profile?.display_name ?? 'uczniu',
    points: stats?.total_points ?? 0,
    streak: stats?.streak_days ?? 0,
    due: stats?.words_due ?? 0,
    unlocks: (unlock as { left?: number } | null)?.left ?? 0,
  };
}
