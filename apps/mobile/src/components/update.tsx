import { checkForUpdateAsync, fetchUpdateAsync, isEnabled, reloadAsync, useUpdates } from 'expo-updates';
import { useState } from 'react';

import { Body, Button, Card, Message, Title } from '@/components/ui';

/**
 * Restart po pobraniu nowej wersji.
 *
 * Osobny komponent, bo ten przycisk jest potrzebny w dwóch miejscach: na karcie na ekranie kursów
 * (dla kogoś, kto nic nie sprawdzał) i od razu pod „Sprawdź aktualizację" (dla kogoś, kto właśnie
 * sprawdził). Odesłanie go na inny ekran było krokiem, którego nikt nie robił.
 *
 * Restartu nie robimy sami: aplikacja, która nagle startuje od nowa, wygląda na zepsutą.
 */
function RestartButton() {
  const [starting, setStarting] = useState(false);
  return (
    <Button
      label="Uruchom teraz"
      busy={starting}
      onPress={() => {
        setStarting(true);
        void reloadAsync().catch(() => setStarting(false));
      }}
    />
  );
}

/**
 * Nowa wersja aplikacji.
 *
 * Poprawki jadą na tablet przez OTA (EAS Update), a aplikacja sprawdza je sama przy starcie
 * (`updates.checkAutomatically: ON_LOAD` w `app.json`). Pobrana wersja wchodzi jednak do użycia
 * dopiero przy następnym uruchomieniu — bez tej karty trzeba było zamknąć aplikację z listy
 * ostatnich i otworzyć ją dwa razy, czego nikt nie zgadnie.
 *
 * Karta stoi tylko na ekranie kursów — nigdy w trakcie lekcji, gdzie restart zabrałby
 * niedokończone podejście.
 */
export function UpdateBanner() {
  const { isUpdatePending } = useUpdates();

  if (!isUpdatePending) return null;

  return (
    <Card>
      <Title>🔄 Nowa wersja gotowa</Title>
      <Body muted>Uruchom aplikację od nowa, żeby z niej korzystać. Punkty i postępy zostają.</Body>
      <RestartButton />
    </Card>
  );
}

/**
 * Która wersja tu właściwie chodzi — jeden wiersz w sekcji „Konto”.
 *
 * Bez tego odpowiedź na „tablet ma starą wersję” trzeba było zgadywać po tym, czego brakuje na
 * ekranie. Numer poprawki jest ten sam co na pulpicie EAS, a `kod z pliku APK` mówi wprost, że
 * urządzenie nie wzięło jeszcze żadnej aktualizacji — tak wygląda telefon zaraz po instalacji,
 * zanim raz się go nie zamknie i nie otworzy.
 */
export function UpdateInfo() {
  const { channel, createdAt, isEmbeddedLaunch, runtimeVersion, updateId } = useUpdates().currentlyRunning;
  const skad = isEmbeddedLaunch ? 'kod z pliku APK' : `poprawka ${updateId?.slice(0, 8) ?? '—'}`;
  const kiedy = createdAt === undefined ? '' : ` z ${createdAt.toLocaleString('pl-PL')}`;

  return (
    <Body muted>
      Wersja {runtimeVersion ?? '—'} · kanał {channel ?? 'brak'} · {skad}
      {kiedy}
    </Body>
  );
}

/**
 * Sprawdzenie aktualizacji na żądanie — dla dorosłego, w sekcji „Konto”. Przydaje się wtedy, gdy
 * poprawka wyszła przy włączonej aplikacji: sprawdzenie przy starcie już było i samo się nie
 * powtórzy, dopóki aplikacja nie wstanie od nowa.
 *
 * Pobrana wersja dostaje przycisk restartu tu, na miejscu: kto sprawdził aktualizację, ten chce ją
 * uruchomić teraz, a nie dowiadywać się, że przycisk czeka na innym ekranie.
 *
 * W wersji z Metro (dev build) `isEnabled` jest nieprawdą — OTA tam nie działa, bo kod
 * przychodzi wprost z komputera. Mówimy to wprost, zamiast pokazywać przycisk, który nic nie robi.
 */
export function UpdateCheck() {
  const { isUpdatePending, isChecking, isDownloading } = useUpdates();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isEnabled) {
    return <Body muted>Aktualizacje przychodzą tylko do wersji zainstalowanej z pliku APK.</Body>;
  }

  if (isUpdatePending) {
    return (
      <>
        <Body muted>Nowa wersja jest pobrana. Punkty i postępy zostają.</Body>
        <RestartButton />
      </>
    );
  }

  const check = async () => {
    setNote(null);
    setError(null);
    try {
      const found = await checkForUpdateAsync();
      if (!found.isAvailable) {
        setNote('Masz najnowszą wersję.');
        return;
      }
      // Pobranie przestawia `isUpdatePending`, więc przycisk „Uruchom teraz" pojawia się sam —
      // tutaj nie ma już czego dopisywać.
      await fetchUpdateAsync();
    } catch {
      setError('Nie udało się sprawdzić aktualizacji. Sprawdź internet.');
    }
  };

  return (
    <>
      <Button
        kind="quiet"
        label="Sprawdź aktualizację"
        busy={isChecking || isDownloading}
        onPress={() => void check()}
      />
      {note !== null && <Body muted>{note}</Body>}
      {error !== null && <Message kind="error" text={error} />}
    </>
  );
}
