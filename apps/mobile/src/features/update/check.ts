// Ten sam magazyn, w którym siedzi sesja Supabase. Import tutaj, a nie „bo `lib/supabase.ts`
// i tak go robi": ten moduł ma działać niezależnie od kolejności importów.
import 'expo-sqlite/localStorage/install';

import * as Linking from 'expo-linking';
import * as Updates from 'expo-updates';

/**
 * Nowa wersja aplikacji. Jedna ikona w pasku, a pod nią dwie zupełnie różne rzeczy:
 *
 *   * `ota`  — nowa paczka JS z kanału `preview`. Tak jedzie większość zmian: poprawki ekranów,
 *              nowe rodzaje zadań, teksty. Pobranie trwa sekundy, a potem aplikacja startuje
 *              od nowa z nową paczką.
 *   * `apk`  — nowy plik instalacyjny wystawiony jako release na GitHubie. Potrzebny tylko wtedy,
 *              gdy zmieni się część natywna (nowy moduł, uprawnienie, ikona). Pobranie otwiera
 *              przeglądarkę, instalację klika już człowiek.
 */
export type NewVersion = { kind: 'ota' } | { kind: 'apk'; tag: string; url: string };

/** Publiczne API GitHuba, bez tokenu — jedno zapytanie na uruchomienie aplikacji. */
const RELEASE_URL = 'https://api.github.com/repos/MichalKlinWedge/LingoMemo/releases/latest';

/**
 * Znacznik releasu, o którym dziecko już wie. Magazyn to `localStorage` z `expo-sqlite`, ten sam,
 * w którym siedzi sesja Supabase (`lib/supabase.ts`).
 */
const SEEN_KEY = 'lingomemo.release-seen';

let pending: Promise<NewVersion | null> | null = null;

/**
 * Czy na GitHubie jest release, o którym jeszcze nie wiemy.
 *
 * Czemu „o którym nie wiemy", a nie „nowszy od zainstalowanego": numeru zainstalowanej paczki
 * (`versionCode`) nie ma skąd przeczytać. `expo-constants` oddaje na Androidzie pustą mapę,
 * a `expo-application` to moduł natywny — trzeba by wydać nowy APK, żeby aplikacja umiała
 * powiedzieć, że jest nowy APK. Zamiast tego zapamiętujemy znacznik releasu przy pierwszym
 * uruchomieniu i przy każdym dotknięciu ikony, więc ikona pokazuje się raz na nowy release.
 *
 * Wynik jest zapamiętany na czas działania aplikacji: pasek wisi nad wszystkimi ekranami
 * i pyta przy każdym wejściu, a GitHub liczy zapytania (60 na godzinę z jednego adresu).
 */
export function checkRelease(): Promise<NewVersion | null> {
  pending ??= fetchRelease();
  return pending;
}

async function fetchRelease(): Promise<NewVersion | null> {
  try {
    const answer = await fetch(RELEASE_URL, { headers: { accept: 'application/vnd.github+json' } });
    if (!answer.ok) return null;

    const json = (await answer.json()) as {
      tag_name?: string;
      assets?: { name?: string; browser_download_url?: string }[];
    };
    const tag = json.tag_name ?? '';
    const url = (json.assets ?? []).find((asset) => (asset.name ?? '').endsWith('.apk'))?.browser_download_url;
    if (tag === '' || url === undefined) return null;

    const seen = localStorage.getItem(SEEN_KEY);
    // Pierwsze uruchomienie: zapamiętujemy, co stoi na GitHubie, i nie zawracamy głowy. Paczka
    // na telefonie jest wtedy świeżo zainstalowana, a gdyby nie była — i tak nie mamy czego
    // porównać (patrz wyżej).
    if (seen === null) {
      localStorage.setItem(SEEN_KEY, tag);
      return null;
    }
    if (seen === tag) return null;

    return { kind: 'apk', tag, url };
  } catch {
    // Brak sieci albo limit zapytań GitHuba. Ikona się wtedy nie pokaże i tyle — nie ma o czym
    // pisać dziecku komunikatu.
    return null;
  }
}

/** Nowe sprawdzenie releasu przy następnym pytaniu — po dotknięciu ikony nie ma już czego pokazywać. */
export function forgetRelease(): void {
  pending = Promise.resolve(null);
}

/**
 * Pobranie nowej wersji.
 *
 * Przy `ota` aplikacja startuje od nowa, więc nic po tym wywołaniu się nie wykona. Przy `apk`
 * otwiera się przeglądarka z plikiem, a znacznik releasu idzie do pamięci — ikona nie wraca,
 * dopóki na GitHubie nie pojawi się następny.
 */
export async function applyNewVersion(version: NewVersion): Promise<void> {
  if (version.kind === 'ota') {
    // Bezpieczne także wtedy, gdy paczka jest już pobrana (automatyczne sprawdzenie przy
    // uruchomieniu, `checkAutomatically: ON_LOAD`) — wtedy nie ma czego pobierać.
    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync();
    return;
  }

  localStorage.setItem(SEEN_KEY, version.tag);
  forgetRelease();
  await Linking.openURL(version.url);
}
