import 'react-native-url-polyfill/auto';
// Magazyn sesji: `localStorage` z expo-sqlite. SecureStore ma limit 2 KB na wartość, a token
// sesji Supabase bywa dłuższy — sesja ginęłaby po restarcie aplikacji.
import 'expo-sqlite/localStorage/install';

import type { Database } from '@lingomemo/db';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

/**
 * Klient Supabase w aplikacji. Klucz publishable może leżeć w APK — dostępu do danych pilnuje
 * RLS, a ocena odpowiedzi i tak dzieje się w bazie.
 *
 * Zmienne pisze `node scripts/sync-env.mjs` z głównego `.env.local` do `apps/mobile/.env.local`.
 * Telefon zawsze idzie do projektu w chmurze: adresu `127.0.0.1` komputera i tak nie zobaczy.
 */
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isConfigured = url !== '' && key !== '';

/**
 * Limit czasu zapytania. Klient Supabase swojego nie ma, a przy jednej kresce zasięgu `fetch`
 * potrafi wisieć minutami — dziecko patrzy wtedy w „Sprawdzam…" i nie wie, czy coś się dzieje.
 * Lepszy błąd po 15 s niż ekran bez końca. (Lekcja P1.1 z ExpeditionPlan.)
 */
const TIMEOUT_MS = 15_000;

const timedFetch: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const outer = init?.signal;
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', () => controller.abort());
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

export const supabase = createClient<Database>(isConfigured ? url : 'http://localhost', isConfigured ? key : 'brak', {
  auth: {
    storage: localStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Logowanie jest e-mailem i hasłem (decyzja: dzieci nie obsłużą magic linku), więc nie ma
    // czego wyłapywać z adresu powrotnego.
    detectSessionInUrl: false,
  },
  global: { fetch: timedFetch },
});

// Odświeżanie tokenu tylko wtedy, gdy aplikacja jest na pierwszym planie (zalecenie Supabase
// dla React Native — w tle i tak nie ma komu odebrać nowego tokenu).
AppState.addEventListener('change', (state) => {
  if (state === 'active') void supabase.auth.startAutoRefresh();
  else void supabase.auth.stopAutoRefresh();
});
