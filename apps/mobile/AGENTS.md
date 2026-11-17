# apps/mobile — zasady pracy

Aplikacja Expo (React Native) dla ucznia. Android. Zakres i etapy: `docs/PLAN_MOBILE.md`
w katalogu głównym; reguły całego projektu: `CLAUDE.md`.

## Expo się zmienia — nie wierz pamięci modelu

Expo łamie API przy każdym wydaniu SDK. Zanim napiszesz cokolwiek, co dotyka API Expo, EAS
albo React Native:

1. sprawdź wersję `expo` w `package.json`;
2. otwórz dokumentację dla tej wersji: `https://docs.expo.dev/versions/v<major>.0.0/`;
3. w razie wątpliwości `https://docs.expo.dev/llms.txt` — spis dokumentów z poprawkami
   najczęstszych pomyłek modeli językowych. Nie odpowiadaj z pamięci.

## Polecenia

```bash
npx expo install <paczka>   # ZAWSZE zamiast npm install — dobiera wersję zgodną z SDK
npm run mobile              # z katalogu głównego: sync-env + expo start
npx expo-doctor             # diagnoza zależności i konfiguracji
npx expo install --fix      # naprawa niezgodnych wersji
npm run typecheck && npm run lint   # przed uznaniem zadania za zrobione
```

## Reguły

- **Katalogów `android/` i `ios/` nie ma i nie tworzymy ich ręcznie** (Continuous Native
  Generation). Zachowanie natywne konfiguruje się w `app.json` i wtyczkami.
- Expo Go nie wystarczy — potrzebny jest **development build** (`eas build --profile
  development`), bo aplikacja ma moduły natywne (powiadomienia, mowa, SQLite).
- Nawigacja przez **expo-router**: każdy plik w `src/app/` to ekran. Kod niebędący ekranem
  trzymamy poza `src/app/`.
- **Ocenia baza.** Telefon wysyła surową odpowiedź do `submit_attempt` i dostaje werdykt.
  Nigdy nie liczy wyniku, punktów ani terminu powtórki — tak samo jak web.
- **Tylko tryb ucznia.** Nie ma tu panelu administratora ani widoku rodzica; nie dokładamy ich
  nawet „na chwilę”.
- Klient Supabase **musi mieć limit czasu** (`src/lib/supabase.ts`): przy jednej kresce zasięgu
  `fetch` wisi minutami, a dziecko patrzy w „Sprawdzam…”.
- Rozmiary dotyku z `CLAUDE.md`: przycisk 56, kafel odpowiedzi 72, tekst 20. Kolory i wymiary
  w `src/constants/theme.ts`, nie wpisywane wprost w komponentach.
- Interfejs, komunikaty i komentarze po polsku; identyfikatory po angielsku.

## Projekt EAS

Projekt jest połączony z kontem właściciela: **@klin.michal/lingomemo**
(`extra.eas.projectId` i `updates.url` w `app.json`). **Jeden kanał Androida — `preview`** —
ten sam APK i ta sama poprawka OTA u właściciela i u dzieci:

```bash
npx eas-cli@latest build --platform android --profile development   # dev build (do pracy z expo start)
npm run apk           # APK dla wszystkich (profil „preview")
npm run ota           # aktualizacja JS na telefony — sprawdzona, bo idzie do dzieci od razu
```

**Dev build wczytuje kod z komputera**: po instalacji uruchamiamy `npm run mobile` w katalogu
głównym i telefon musi widzieć ten komputer (to samo Wi-Fi; inaczej `npx expo start --tunnel`).
Dlatego dev buildowi nie są potrzebne zmienne z chmury — `.env.local` czyta Metro na komputerze.

**APK „preview" to inna sprawa**: zmienne wchodzą do paczki przy budowaniu, a
`.env.local` nie jedzie do EAS (jest w `.gitignore`). Przed pierwszym takim buildem trzeba wpisać
je po stronie EAS, raz na środowisko:

```bash
npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value <adres>
npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <klucz>
```

Bez nich aplikacja wstanie i powie „Brak adresu bazy" — klucz publishable może być w APK,
dostępu pilnuje RLS.
