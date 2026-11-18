import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';

import { TopBar } from '@/components/top-bar';
import { color } from '@/constants/theme';

// Powiadomienie ma być widoczne także wtedy, gdy aplikacja jest otwarta — inaczej pomiar
// PoC-M3 („czy w ogóle przyszło") nic nie mówi, póki telefon leży na ekranie aplikacji.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function Layout() {
  return (
    <View style={{ backgroundColor: color.background, flex: 1 }}>
      <StatusBar style="dark" />
      {/* Pasek stoi NAD stosem ekranów, a nie w nagłówku któregoś z nich: tylko wtedy jest
          widoczny cały czas i nie odjeżdża przy przewijaniu — tak samo jak na webie. Sam
          decyduje, kiedy się nie pokazywać (niezalogowany, lekcja). */}
      <TopBar />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: color.background },
          headerTintColor: color.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: color.background },
        }}
      >
        {/* Ekran kursów nie ma własnego nagłówka: „Twoje kursy" zastąpiły sowa i imię w pasku,
            a drugi wiersz z tym samym znaczeniem tylko zabierałby wysokość. Pozostałe ekrany
            nagłówek zachowują — jako tytuł strony, a gdzieniegdzie też jako drogę wstecz. */}
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="logowanie" options={{ title: 'Logowanie' }} />
        <Stack.Screen name="ustawienia" options={{ title: 'Ustawienia' }} />
        {/* Ekran kursu też nie ma nagłówka: tytuł kursu stoi w jego treści, z flagą, a wiersz
            ze słowem „Kurs" powtarzał tylko to, co dziecko ma pod spodem. Droga wstecz zostaje
            — sowa w pasku wraca na listę kursów, a Android ma swój gest powrotu. */}
        <Stack.Screen name="kurs/[slug]" options={{ headerShown: false }} />
        {/* Lekcja ma własny pasek: krzyżyk wyjścia, postęp i liczniki. Drugi nagłówek nad nim
            zabierałby wysokość ekranu, której przy zadaniu z klawiaturą i tak brakuje. */}
        <Stack.Screen name="lekcja/[id]/index" options={{ headerShown: false }} />
        <Stack.Screen name="lekcja/[id]/nauka" options={{ title: 'Słówka lekcji' }} />
        {/* Nagrody i postępy bez strzałki powrotu: ten wiersz jest TYTUŁEM strony, a nie drogą
            wstecz. Strzałka obok napisu kazała czytać „Nagrody" jako miejsce, do którego się
            wraca — a wchodzi się tu znacznikiem z paska, który stoi dwa centymetry wyżej i tam
            też prowadzi z powrotem (sowa wraca na listę kursów). Android ma do tego swój gest
            i przycisk wstecz, więc nic nie ginie. */}
        <Stack.Screen name="nagrody" options={{ title: 'Nagrody', headerBackVisible: false }} />
        <Stack.Screen
          name="statystyki"
          options={{ title: 'Twoje postępy', headerBackVisible: false }}
        />
        <Stack.Screen name="zadanie" options={{ title: 'PoC-M1 — zadanie z bazy' }} />
        <Stack.Screen name="mowa" options={{ title: 'PoC-M2 — mowa' }} />
        <Stack.Screen name="powiadomienia" options={{ title: 'PoC-M3 — przypomnienia' }} />
      </Stack>
    </View>
  );
}
