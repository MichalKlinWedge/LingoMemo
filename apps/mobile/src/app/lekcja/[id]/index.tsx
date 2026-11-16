import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { Body, Message, Screen } from '@/components/ui';
import { type LessonData, loadLesson } from '@/features/lesson/load';
import { LessonRunner } from '@/features/lesson/runner';
import { useSession } from '@/lib/session';

/** Liczba z adresu albo `undefined` — parametr może być tablicą albo śmieciem. */
const num = (value: string | string[] | undefined): number | undefined => {
  const first = Array.isArray(value) ? value[0] : value;
  const parsed = Number(first);
  return Number.isInteger(parsed) ? parsed : undefined;
};

/**
 * Lekcja: wczytanie danych, potem przebieg. Etap i poziom przychodzą z adresu (`?etap=`,
 * `?poziom=`) — tak samo jak na webie, więc kwadraciki z mapy prowadzą dokładnie tam, gdzie
 * dziecko dotknęło.
 */
export default function LessonScreen() {
  const { id, etap, poziom } = useLocalSearchParams<{ id: string; etap?: string; poziom?: string }>();
  const session = useSession();
  const userId = session?.user.id ?? null;
  /**
   * Wynik wczytania razem z tym, CZEGO dotyczy. Dzięki temu po zmianie etapu albo poziomu
   * poprzednia lekcja przestaje się liczyć bez zerowania stanu w efekcie (czego linter Reacta
   * nie puszcza, i słusznie: to kaskada renderów).
   */
  const [loaded, setLoaded] = useState<{ key: string; data?: LessonData; error?: string } | null>(null);

  const key = `${id}|${etap ?? ''}|${poziom ?? ''}`;

  useEffect(() => {
    if (userId === null) return;
    let alive = true;
    void loadLesson(id, userId, { stage: num(etap), level: num(poziom) }).then((result) => {
      if (!alive) return;
      setLoaded(result.ok ? { key, data: result.value } : { key, error: result.error });
    });
    return () => {
      alive = false;
    };
  }, [etap, id, key, poziom, userId]);

  const fresh = loaded?.key === key ? loaded : null;
  const data = fresh?.data ?? null;
  const error = fresh?.error ?? null;

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
        <Body muted>Wczytuję lekcję…</Body>
      </Screen>
    );
  }

  return (
    <LessonRunner
      // Przejście do następnego etapu to ten sam adres z innym parametrem, więc bez klucza
      // zostałby stan poprzedniego etapu (numer zadania, ekran podsumowania).
      key={`${data.level}-${data.stage}`}
      lessonId={id}
      courseSlug={data.courseSlug}
      exercises={data.exercises}
      sourceLang={data.sourceLang}
      targetLang={data.targetLang}
      badgeNames={data.badgeNames}
      stage={data.stage}
      stages={data.stages}
      level={data.level}
      hintsLeft={data.hintsLeft}
      unlockLeft={data.unlockLeft}
      autoNextMs={data.autoNextMs}
    />
  );
}
