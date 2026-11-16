import { useRouter } from 'expo-router';
import { useState } from 'react';

import { Body, Button, Card, Field, Message, Screen, Title } from '@/components/ui';
import { supabase } from '@/lib/supabase';

/**
 * Logowanie e-mailem i hasłem — jedyna droga do konta na telefonie. Konta nie zakładamy:
 * powstaje wyłącznie z linku z zaproszeniem otwartego w przeglądarce (hook `before_user_created`).
 */
export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    const { error: fault } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (fault) {
      // Supabase odpowiada po angielsku; dla nas liczą się dwa przypadki: złe dane i brak sieci.
      setError(
        /invalid login credentials/i.test(fault.message)
          ? 'Nie ten e-mail albo nie to hasło.'
          : /network|fetch|aborted/i.test(fault.message)
            ? 'Brak połączenia z serwerem. Sprawdź internet.'
            : fault.message,
      );
      return;
    }
    router.replace('/');
  };

  return (
    <Screen>
      <Card>
        <Title>Zaloguj się</Title>
        <Field
          value={email}
          onChangeText={setEmail}
          placeholder="E-mail"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        <Field
          value={password}
          onChangeText={setPassword}
          placeholder="Hasło"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          textContentType="password"
        />
        {error !== null && <Message kind="error" text={error} />}
        <Button
          label="Wejdź"
          busy={busy}
          disabled={email.trim() === '' || password === ''}
          onPress={() => void signIn()}
        />
        <Body muted>
          Konta nie zakłada się w aplikacji. Nowe konto powstaje z linku z zaproszeniem otwartego
          w przeglądarce.
        </Body>
      </Card>
    </Screen>
  );
}
