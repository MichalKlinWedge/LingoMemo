import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useSession } from '@/lib/session';

/**
 * Zębatka w prawym górnym rogu ekranu kursów — wejście do ustawień konta.
 *
 * Wcześniej to samo kryło się pod napisem „Konto" na samym dole listy kursów: trzeba było
 * przewinąć wszystkie kursy i wiedzieć, że ten napis w ogóle się rozwija. Zębatka w nagłówku
 * jest tam, gdzie dorosły jej szuka.
 *
 * Niezalogowanemu nie pokazujemy nic — ekran kursów jest wtedy powitaniem z prośbą o zalogowanie
 * i w ustawieniach nie ma czego ustawiać.
 */
export function SettingsButton() {
  const router = useRouter();
  const session = useSession();

  if (session === null || session === undefined) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Ustawienia"
      // Nagłówek ma 56 px wysokości, więc sam przycisk nie zmieści się w wymaganych 56 —
      // `hitSlop` dokłada brakujące piksele poza obrysem, czyli tam, gdzie i tak nic nie stoi.
      hitSlop={8}
      onPress={() => router.push('/ustawienia')}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Text style={styles.icon}>⚙️</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  icon: { fontSize: 24 },
  pressed: { opacity: 0.6 },
});
