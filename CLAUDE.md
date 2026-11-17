# LingoMemo — zasady pracy

Aplikacja webowa do nauki słówek i prostych zwrotów, dla dzieci. Next.js na Vercel + Supabase.
Dostęp zamknięty: konto powstaje wyłącznie z linku z zaproszeniem wygenerowanego przez admina.

Plan etapowy i kryteria odbioru: `docs/PLAN_ETAPOWY.md`. Decyzje architektoniczne i ich
uzasadnienia: `docs/DECYZJE.md`. Zanim zmienisz coś w modelu danych albo w uprawnieniach,
przeczytaj odpowiedni wpis — każdy mówi też, co zostało odrzucone i dlaczego.

## Komendy

```
npm install              # zależności (npm workspaces, Node >= 22)
npm run db:start         # lokalna baza Supabase (wymaga uruchomionego Dockera)
npm run web:local        # aplikacja na lokalnej bazie, http://localhost:3000
npm run web              # aplikacja na bazie z chmury (wartości z .env.local)
npm run mobile           # aplikacja na telefon (Expo; wymaga dev buildu, nie Expo Go)
npm run check            # typecheck + lint + test + build — brama jakości, musi przechodzić
npm run gen              # typy TypeScript z lokalnej bazy -> packages/db
npm run gen:icons        # warianty ikony z apps/web/public/ikony/ikona.svg (PNG, favicon.ico)
npm run gen:og           # miniatura linku do komunikatora (wymaga internetu — font)
npm run gen:flags        # flagi dla telefonu z apps/web/public/flagi/*.svg (PNG)
npm run test:db          # testy uprawnień pgTAP na lokalnej bazie
npm run db:reset         # odtworzenie lokalnej bazy z migracji + seed
npm run db:push          # wypchnięcie migracji do projektu w chmurze
npm run seed:dev         # dane demo i nadanie pierwszego admina (tylko localhost)
```

Pojedynczy test: `npx vitest run src/__tests__/x.test.ts` wewnątrz pakietu.

## Reguły architektury

- **Ocena odpowiedzi, punkty i powtórki (FSRS-6) liczy baza**, nie przeglądarka. Klient wysyła surową
  odpowiedź do `submit_attempt` i dostaje werdykt. Nigdy nie wysyła wyniku ani liczby punktów.
- **Klucze odpowiedzi nie opuszczają bazy.** `exercises` nie ma polityki SELECT dla ucznia;
  treść zadania wydaje `get_lesson_exercises`, które wycina `accepted` / `answer` / `solution`.
- **Tabele postępu są dla ucznia tylko do odczytu.** Zapis wyłącznie przez funkcje
  `security definer`. Brak polityki INSERT/UPDATE to celowa decyzja, nie przeoczenie.
- **RLS na każdej tabeli od pierwszej migracji**, z testem pgTAP. Plik RLS kończy się asercją,
  która wywala migrację, jeśli jakakolwiek tabela w `public` została bez RLS.
- **`service_role` nie występuje w aplikacji webowej.** Tylko skrypty w `tools/`, i tylko po
  sprawdzeniu, że adres bazy jest localhostem. Zmienna nigdy z przedrostkiem `NEXT_PUBLIC_`.
- **Rola admina mieszka w `app_metadata`** (claim w JWT) i w `app_private.admin_users`.
  Nigdy w tabeli, którą użytkownik może zapisywać, i nigdy w `user_metadata`.
- **Każda funkcja `security definer`** ma `set search_path = ''` i pełne nazwy z schematem, oraz
  `revoke execute ... from anon, public`.
- **W politykach RLS `(select auth.uid())`**, nigdy gołe `auth.uid()` — podzapytanie liczy się raz.
- **Logika wspólna w `packages/core`** — czysty TypeScript, bez importów z Node, Next ani
  przeglądarki. Tam żyją typy zadań, etykiety i formatowanie; ocena odpowiedzi nie (jest w SQL).
- **Zod jest źródłem prawdy** dla danych formularzy i dla zawartości kolumn `jsonb`. Zawartość
  `jsonb` w camelCase, kolumny tabel w snake_case.
- **Import lekcji przez jedno RPC.** Server Action z trzydziestoma `insert()` nie jest transakcją
  i przy błędzie zostawia śmieci.
- **Harmonogram powtórek to FSRS-6**, zaimplementowany w plpgsql. Po zmianie wag albo wersji
  `ts-fsrs`: `node scripts/fsrs-fixtures.mjs` i `npm run test:db` — test pgTAP porównuje bazę
  z implementacją referencyjną. Wzorów nie przepisuj z dokumentacji, tylko z `ts-fsrs`.
- **Telefon to tylko tryb ucznia** (`apps/mobile`, Expo, Android): te same funkcje bazy co web,
  bez panelu administratora i bez widoku rodzica, a konto powstaje wyłącznie z linku otwartego
  w przeglądarce. Zakres i etapy: `docs/PLAN_MOBILE.md`; praca z Expo: `apps/mobile/AGENTS.md`.
- Po każdej migracji: `npm run gen` i `npm run test:db`.

## Konwencje

- **Język**: interfejs, komunikaty błędów, komentarze w kodzie i dokumenty po polsku;
  identyfikatory (nazwy zmiennych, funkcji, tabel, kolumn) po angielsku.
- **Końce linii**: nowe pliki LF (wymusza `.gitattributes`). Nigdy nie przepisuj końców linii
  istniejącego pliku — dwuwierszowa zmiana zamienia się wtedy w diff całego pliku.
- **Interfejs dla dziecka**: najmniejszy przycisk 56 px, kafel odpowiedzi 72 px, tekst 20 px.
  Gotowe klasy z `globals.css` (`.btn-primary`, `.btn-answer`, `.tile`, `.card`, `.field`,
  `.chip`, `.msg-error`, `.msg-ok`) — nie restyluj ich doraźnie w komponencie.
- **Wybór obrazka (`image_choice`) dostaje w treści cztery obrazki.** Siatka ma dwie kolumny,
  więc trzy zostawiają dziurę w drugim rzędzie, a strzał w ciemno trafia co trzeci raz zamiast
  co czwarty. Walidacja przepuszcza od dwóch do czterech (lekcja może nie mieć czym uzupełnić),
  ale generowana treść ma zawsze cztery.
- Jedna szerokość treści dla wszystkich stron — `<Shell>`. Strona nie dobiera sobie własnej.
- Nawigacja zawsze jako `<Link>`, nigdy `router.push` z `<button>`.
- Autoryzacja w **każdej** stronie i akcji przez `requireUser()` — Server Actions omijają matcher
  z `proxy.ts`, więc samo proxy niczego nie pilnuje.
- Błędy z bazy przepuszczaj przez `dbErrorMessage` / `dbLoadError`, nie pokazuj surowych.
- **Commity**: jedna linia po polsku, wzorzec `Obszar: co się zmieniło`, np.
  `Lekcje: zadanie ze słuchu`, `Baza: polityki RLS dla postępów`. Bez prefiksów `feat:`/`fix:`.
- **Brama jakości kończy się produkcyjnym buildem** (`check:build`), bo części błędów nie widzi ani
  typecheck, ani lint — najdotkliwszy to `export const` w pliku z `"use server"` (wolno tam
  eksportować wyłącznie funkcje asynchroniczne). Build dzieli katalog `.next` z serwerem
  deweloperskim, więc `npm run web:local` po `check` warto przeładować w przeglądarce.
- Przed uznaniem zadania za zrobione: `npm run check`, a po zmianach w bazie także `npm run test:db`.
