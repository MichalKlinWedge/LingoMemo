import Constants from 'expo-constants';
import { useRouter } from 'expo-router';

import { Body, Button, Card, Message, Screen, Title } from '@/components/ui';
import { useSession } from '@/lib/session';
import { isConfigured, supabase } from '@/lib/supabase';

/**
 * Bramka decyzyjna M0 (`docs/PLAN_MOBILE.md`): trzy pomiary, każdy na osobnym ekranie. To nie jest
 * jeszcze aplikacja dla dziecka — to telefon, na którym sprawdzamy, czy baza, mowa i przypomnienia
 * zachowują się tak, jak założył plan.
 */
export default function Home() {
  const router = useRouter();
  const session = useSession();

  return (
    <Screen>
      {!isConfigured && (
        <Message
          kind="error"
          text="Brak adresu bazy w aplikacji. W katalogu głównym: npm run mobile (przepisuje .env.local do apps/mobile)."
        />
      )}

      <Card>
        <Title>Bramka M0</Title>
        <Body muted>
          Wersja {Constants.expoConfig?.version ?? '?'}. Każdy pomiar ma swój próg w planie; wynik
          wpisujemy do docs/DECYZJE.md.
        </Body>
        {session === undefined ? (
          <Body muted>Sprawdzam sesję…</Body>
        ) : session === null ? (
          <>
            <Body>Nie jesteś zalogowany.</Body>
            <Button label="Zaloguj się" onPress={() => router.push('/logowanie')} />
          </>
        ) : (
          <>
            <Body>Zalogowany: {session.user.email ?? '—'}</Body>
            <Button kind="quiet" label="Wyloguj" onPress={() => void supabase.auth.signOut()} />
          </>
        )}
      </Card>

      <Card>
        <Title>Pomiary</Title>
        <Button label="PoC-M1 — zadanie z bazy" onPress={() => router.push('/zadanie')} />
        <Button label="PoC-M2 — mowa" onPress={() => router.push('/mowa')} />
        <Button label="PoC-M3 — przypomnienia" onPress={() => router.push('/powiadomienia')} />
      </Card>

      <Card>
        <Title>Czego tu nie ma</Title>
        <Body muted>
          Panelu administratora ani widoku rodzica — telefon jest tylko do nauki. Konto zakłada się
          z linku z zaproszeniem w przeglądarce; aplikacja wyłącznie loguje.
        </Body>
      </Card>
    </Screen>
  );
}
