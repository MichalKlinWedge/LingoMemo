import { useEffect, useState } from 'react';

import { Body } from '@/components/ui';
import { type VoiceRow, loadVoices } from '@/features/voices/load';

/**
 * Jakimi językami ten telefon umie mówić — jeden wiersz w sekcji „Konto”.
 *
 * Stoi tam, a nie na wierzchu: to odpowiedź dla dorosłego na „zadania ze słuchu są pomijane”
 * albo „włoski czyta po angielsku”. Dziecku nic nie mówi, a głosy pobiera się w ustawieniach
 * systemu, nie w aplikacji.
 */
export function VoiceList() {
  const [rows, setRows] = useState<VoiceRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    void loadVoices().then((loaded) => {
      if (alive) setRows(loaded);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (rows === null || rows.length === 0) return null;

  const missing = rows.filter((row) => !row.ok);

  return (
    <>
      <Body muted>
        Głosy: {rows.map((row) => `${row.name} ${row.ok ? '✓' : '✗'}`).join(' · ')}
      </Body>
      {missing.length > 0 ? (
        <Body muted>
          Brakujące pobierz w ustawieniach Androida: Dostępność → Zamiana tekstu na mowę → silnik
          Google → Zainstaluj dane głosowe. Bez głosu zadanie ze słuchu jest pomijane i nie liczy
          się jako błąd.
        </Body>
      ) : (
        <Body muted>
          Głos z tej listy może i tak zamilknąć, gdy system zapowiada język, którego danych nie
          pobrał — wtedy aplikacja chowa głośnik, zamiast czytać obcym akcentem.
        </Body>
      )}
    </>
  );
}
