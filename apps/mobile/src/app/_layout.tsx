import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

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
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: color.background },
          headerTintColor: color.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: color.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Twoje kursy' }} />
        <Stack.Screen name="logowanie" options={{ title: 'Logowanie' }} />
        <Stack.Screen name="kurs/[slug]" options={{ title: 'Kurs' }} />
        {/* Lekcja ma własny pasek: krzyżyk wyjścia, postęp i liczniki. Drugi nagłówek nad nim
            zabierałby wysokość ekranu, której przy zadaniu z klawiaturą i tak brakuje. */}
        <Stack.Screen name="lekcja/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="zadanie" options={{ title: 'PoC-M1 — zadanie z bazy' }} />
        <Stack.Screen name="mowa" options={{ title: 'PoC-M2 — mowa' }} />
        <Stack.Screen name="powiadomienia" options={{ title: 'PoC-M3 — przypomnienia' }} />
      </Stack>
    </>
  );
}
