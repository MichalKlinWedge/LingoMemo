# Plan etapowy

Każdy etap ma jedno **kryterium odbioru** — zdanie sprawdzalne na działającej aplikacji.
Daty nie są obietnicą; obietnicą jest kryterium. Pod każdym etapem dopisywany jest akapit
**Stan (data)** z tym, co realnie powstało i czego nie ma.

---

## Etap 0 — szkielet

Monorepo npm workspaces, `apps/web` (Next 16, Tailwind v4, motyw dla dzieci),
`packages/core`, `packages/db`, konfiguracja Supabase CLI, `scripts/sync-env.mjs`, dokumentacja.

**Kryterium odbioru:** `npm run check` przechodzi, `npm run db:start` wstaje,
`npm run web:local` pokazuje stronę startową.

**Stan (2026-11-15):** zrobione poza uruchomieniem lokalnej bazy — Docker Desktop nie był
włączony w trakcie pracy, więc `npm run db:start` nie zostało sprawdzone. `npm run check`
przechodzi (typecheck, lint, 8 testów).

---

## Etap 1 — baza i uprawnienia

Migracje: rozszerzenia i schemat `app_private`, admin i `is_admin()`, treść (`languages`,
`courses`, `units`, `lessons`, `concepts`, `terms`, `term_forms`, `lesson_items`, `exercises`),
postępy (`profiles`, `enrollments`, `lesson_progress`, `lesson_sessions`, `attempts`, `srs_state`),
grywalizacja (`points_ledger`, `badges`, `user_badges`), funkcje, RLS, Storage, seed.
Typy przez `npm run gen`, testy pgTAP z helperem `pg_temp.login()`.

**Kryterium odbioru:** `npm run test:db` zielone, w tym testy „uczeń nie czyta cudzych prób”,
„uczeń nie czyta `exercises`”, „uczeń nie dopisze sobie punktów”, „każda tabela w `public` ma RLS”.

---

## Etap 2 — zaproszenia i logowanie

`create_invite` / `invite_preview` / `accept_invite`, hook `before_user_created`, trigger
`create_profile`, strony `/login` i `/zaproszenie/[token]`, ograniczenie liczby prób,
`tools/seed-dev` nadający pierwszego administratora.

**Kryterium odbioru:** administrator generuje link, dziecko zakłada z niego konto i loguje się;
drugie użycie linku i link po terminie odrzucone tym samym komunikatem; rejestracja bez tokenu
odrzucona przez hook.

---

## Etap 3 — silnik lekcji (MVP)

`start_lesson_session`, `submit_attempt`, `finish_lesson_session`, `get_lesson_exercises`;
cztery typy zadań (`translate_ab`, `translate_ba`, `fill_blank_choice`, `listening`);
wybór kursu → mapa działów → mapa lekcji → lekcja → podsumowanie; seed kursu PL→EN
(2 działy po 3 lekcje, ~40 słówek).

**Kryterium odbioru:** dziecko przechodzi lekcję demo od początku do końca, wynik jest w bazie,
następna lekcja odblokowana, a zablokowana nie jest widoczna.

---

## Etap 4 — grywalizacja, powtórki, statystyki

`points_ledger` w użyciu, gwiazdki, seria dni, odznaki i ekran nagród, `srs_apply`,
`get_review_set`, lekcja powtórkowa z działu, statystyki ucznia.

**Kryterium odbioru:** po ukończeniu lekcji punkty i gwiazdki zgadzają się z regułami,
a powtórka działu podaje dokładnie słówka zaległe i wcześniej pomylone.

---

## Etap 5 — pozostałe typy zadań i dopracowanie interfejsu

`inflection`, `match_pairs`, `sentence_order`; maskotka, dźwięki, animacje, typografia, kontrast.

**Kryterium odbioru:** lekcja złożona z wszystkich siedmiu typów przechodzi bez błędów
na tablecie i na telefonie.

---

## Etap 6 — panel administratora

Import JSON z podglądem na sucho, CRUD kursów, działów, lekcji i słówek, wgrywanie obrazków
do Storage, lista uczniów z postępami, zarządzanie zaproszeniami, publikowanie treści.

**Kryterium odbioru:** nowa lekcja powstaje wyłącznie przez panel — od wklejenia JSON-a
do przejścia jej przez dziecko.

---

## Poza planem

Generowanie lekcji przez Claude ze zdjęcia strony z książki. Format importu i model danych są
pod to przygotowane, więc dołożenie tego to jeden endpoint produkujący ten sam JSON.
