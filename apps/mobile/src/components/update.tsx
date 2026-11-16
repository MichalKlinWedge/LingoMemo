import { checkForUpdateAsync, fetchUpdateAsync, isEnabled, reloadAsync, useUpdates } from 'expo-updates';
import { useState } from 'react';

import { Body, Button, Card, Message, Title } from '@/components/ui';

/**
 * Nowa wersja aplikacji.
 *
 * Poprawki jadą na tablet przez OTA (EAS Update), a aplikacja sprawdza je sama przy starcie
 * (`updates.checkAutomatically: ON_LOAD` w `app.json`). Pobrana wersja wchodzi jednak do użycia
 * dopiero przy następnym uruchomieniu — bez tej karty trzeba było zamknąć aplikację z listy
 * ostatnich i otworzyć ją dwa razy, czego nikt nie zgadnie.
 *
 * Restartu nie robimy sami: aplikacja, która nagle startuje od nowa, wygląda na zepsutą. Dlatego
 * jest przycisk, i tylko na ekranie kursów — nigdy w trakcie lekcji, gdzie restart zabrałby
 * niedokończone podejście.
 */
export function UpdateBanner() {
  const { isUpdatePending } = useUpdates();
  const [starting, setStarting] = useState(false);

  if (!isUpdatePending) return null;

  return (
    <Card>
      <Title>🔄 Nowa wersja gotowa</Title>
      <Body muted>Uruchom aplikację od nowa, żeby z niej korzystać. Punkty i postępy zostają.</Body>
      <Button
        label="Uruchom teraz"
        busy={starting}
        onPress={() => {
          setStarting(true);
          void reloadAsync().catch(() => setStarting(false));
        }}
      />
    </Card>
  );
}

/**
 * Sprawdzenie aktualizacji na żądanie — dla dorosłego, w sekcji „Konto”. Przydaje się wtedy, gdy
 * poprawka wyszła przy włączonej aplikacji: sprawdzenie przy starcie już było i samo się nie
 * powtórzy, dopóki aplikacja nie wstanie od nowa.
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
    return <Body muted>Nowa wersja jest pobrana — uruchom ją przyciskiem na górze ekranu kursów.</Body>;
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
      // Pobranie przestawia `isUpdatePending`, więc karta z przyciskiem „Uruchom teraz" pojawia
      // się sama — tutaj nie ma już czego dopisywać.
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
