import { voiceLanguages } from '@/lib/speak';
import { supabase } from '@/lib/supabase';

export type VoiceRow = { code: string; name: string; ok: boolean };

/**
 * Które języki ten telefon umie przeczytać. Odpowiedź na „dlaczego nic nie mówi” albo „dlaczego
 * czyta włoski po angielsku” — bez tego trzeba było zgadywać po zachowaniu zadań ze słuchu.
 *
 * Lista języków przychodzi z bazy (`languages`), a nie z kodu: kurs w nowym języku ma się tu
 * pojawić bez zmiany w aplikacji. Język bez `tts_lang` nie ma czym mówić z definicji, więc
 * zostaje na liście jako brakujący — tak samo wygląda to w zadaniach.
 */
export async function loadVoices(): Promise<VoiceRow[]> {
  const [{ data: languages }, tags] = await Promise.all([
    supabase.from('languages').select('code, name_pl, tts_lang').order('name_pl'),
    voiceLanguages(),
  ]);

  const have = new Set(tags);

  return (languages ?? []).map((row) => ({
    code: row.code,
    name: row.name_pl,
    ok: row.tts_lang !== null && have.has(row.tts_lang.slice(0, 2).toLowerCase()),
  }));
}
