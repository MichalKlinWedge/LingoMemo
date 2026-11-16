import * as Speech from 'expo-speech';
import { useEffect, useState } from 'react';

import { Body, Button, Card, Chip, Message, Screen, Title } from '@/components/ui';

/**
 * PoC-M2: czy telefon ma czym mówić.
 *
 * Na webie wymowa stoi na Web Speech API i to jest znana pułapka (`getVoices()` puste przy
 * pierwszym wywołaniu, część Androidów bez głosu `en-GB`). Tutaj sprawdzamy to, co obiecuje plan:
 * czy `getAvailableVoicesAsync()` pozwala **przed** pokazaniem zadania ze słuchu stwierdzić, że
 * głosu nie ma — bo wtedy zadanie trzeba pominąć bez zapisywania próby, a nie zapisać dziecku błąd.
 *
 * Trybu samolotowego nie da się sprawdzić z kodu: po naciśnięciu „Powiedz” przy wyłączonej sieci
 * słychać albo głos pobrany na telefon, albo ciszę. Dlatego ekran mówi, co zrobić ręcznie.
 */

type Voice = { identifier: string; name: string; language: string; quality: string };

const SAMPLE = [
  { label: 'angielski', text: 'dog', lang: 'en-GB' },
  { label: 'polski', text: 'pies', lang: 'pl-PL' },
];

async function readVoices(): Promise<Voice[]> {
  const list = await Speech.getAvailableVoicesAsync();
  return list.map((voice) => ({
    identifier: voice.identifier,
    name: voice.name,
    language: voice.language,
    quality: String(voice.quality),
  }));
}

export default function Mowa() {
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [fault, setFault] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void readVoices().then(
      (list) => {
        if (alive) setVoices(list);
      },
      (error: unknown) => {
        if (!alive) return;
        setFault(error instanceof Error ? error.message : 'Nie udało się odczytać listy głosów.');
        setVoices([]);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  const family = (lang: string): Voice[] =>
    (voices ?? []).filter((voice) =>
      voice.language.replace('_', '-').toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()),
    );

  const exact = (lang: string): boolean =>
    (voices ?? []).some((voice) => voice.language.replace('_', '-').toLowerCase() === lang.toLowerCase());

  const say = (text: string, language: string) => {
    setSaid(null);
    Speech.stop();
    Speech.speak(text, {
      language,
      onDone: () => setSaid(`skończone: ${text}`),
      onError: () => setSaid(`błąd przy: ${text}`),
    });
  };

  return (
    <Screen>
      {fault !== null && <Message kind="error" text={fault} />}

      <Card>
        <Title>Głosy w telefonie</Title>
        {voices === null ? (
          <Body muted>Czytam listę…</Body>
        ) : (
          <>
            <Body>Wszystkich głosów: {voices.length}</Body>
            {SAMPLE.map(({ label, lang }) => (
              <Body key={lang}>
                {label} ({lang}):{' '}
                {exact(lang)
                  ? 'jest dokładny'
                  : family(lang).length > 0
                    ? `tylko ogólny ${lang.slice(0, 2)}`
                    : 'BRAK'}
                {family(lang).length > 0 ? ` — ${family(lang).length} do wyboru` : ''}
              </Body>
            ))}
            <Body muted>
              Brak głosu to nie błąd dziecka: zadanie ze słuchu trzeba wtedy pominąć bez zapisywania
              próby (web robi to przez onSkip).
            </Body>
          </>
        )}
      </Card>

      <Card>
        <Title>Posłuchaj</Title>
        {SAMPLE.map(({ label, text, lang }) => (
          <Button key={lang} kind="answer" label={`${text} (${label})`} onPress={() => say(text, lang)} />
        ))}
        {said !== null && <Chip>{said}</Chip>}
        <Body muted>
          Pomiar ręczny: włącz tryb samolotowy i naciśnij jeszcze raz. Jeśli milczy, głos nie jest
          pobrany na telefon — trzeba go zainstalować w ustawieniach mowy Androida.
        </Body>
      </Card>

      <Card>
        <Title>Lista głosów</Title>
        {(voices ?? []).slice(0, 40).map((voice) => (
          <Body key={voice.identifier} muted>
            {voice.language} · {voice.name} · {voice.quality}
          </Body>
        ))}
        {voices !== null && voices.length > 40 && <Body muted>…i {voices.length - 40} dalszych</Body>}
      </Card>
    </Screen>
  );
}
