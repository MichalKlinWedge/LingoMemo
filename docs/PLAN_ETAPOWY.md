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

**Stan (2026-11-15):** zrobione i sprawdzone. `npm run check` przechodzi, lokalna baza wstaje,
strona startowa działa.

---

## Etap 1 — baza i uprawnienia

Migracje: rozszerzenia i schemat `app_private`, admin i `is_admin()`, treść (`languages`,
`courses`, `units`, `lessons`, `concepts`, `terms`, `term_forms`, `lesson_items`, `exercises`),
postępy (`profiles`, `enrollments`, `lesson_progress`, `lesson_sessions`, `attempts`, `srs_state`),
grywalizacja (`points_ledger`, `badges`, `user_badges`), FSRS-6 (`srs_params`, `fsrs_next_state`),
funkcje, RLS, Storage, seed.
Typy przez `npm run gen`, testy pgTAP z helperem `pg_temp.login()`.

**Kryterium odbioru:** `npm run test:db` zielone, w tym testy „uczeń nie czyta cudzych prób”,
„uczeń nie czyta `exercises`”, „uczeń nie dopisze sobie punktów”, „każda tabela w `public` ma RLS”
oraz 260 przypadków FSRS-6 zgodnych z implementacją referencyjną.

**Stan (2026-11-15):** zrobione. Osiem migracji, seed z kursem demonstracyjnym PL→EN
(2 działy, 6 lekcji, 24 słówka, 72 zadania), **41 testów pgTAP w trzech plikach — wszystkie
zielone**. FSRS-6 w plpgsql zgadza się z implementacją referencyjną na 260 przejściach stanu
i 15 interwałach. Typy wygenerowane do `packages/db`.

Dwie rzeczy znalezione przy uruchamianiu testów, obie poprawione w migracjach:
- administrator nie mógł czytać tabeli `exercises` — brakowało nadania SELECT; barierą dla
  ucznia jest polityka RLS (zapytanie zwraca pustkę), a nie brak nadania;
- „ostatnia odpowiedź na zadanie” była wybierana po `created_at`, a `now()` jest stałe w obrębie
  transakcji — przy dwóch odpowiedziach na to samo zadanie wybór bywał przypadkowy. Teraz
  decyduje identyfikator próby.

Lokalny Supabase chodzi na portach **54421–54429** zamiast domyślnych 54321–54329, bo domyślne
zajmuje inny projekt na tej maszynie.

---

## Etap 2 — zaproszenia i logowanie

`create_invite` / `invite_preview` / `accept_invite`, hook `before_user_created`, trigger
`create_profile`, strony `/login` i `/zaproszenie/[token]`, ograniczenie liczby prób,
`tools/seed-dev` nadający pierwszego administratora.

**Kryterium odbioru:** administrator generuje link, dziecko zakłada z niego konto i loguje się;
drugie użycie linku i link po terminie odrzucone tym samym komunikatem; rejestracja bez tokenu
odrzucona przez hook.

**Stan (2026-11-15):** zrobione i sprawdzone od końca do końca w przeglądarce oraz bezpośrednio
na API rejestracji. Bez tokenu: `403 — Konto zakłada się z linku z zaproszeniem.` Z ważnym
tokenem: konto powstaje, uczeń jest zapisany na kurs. Ten sam link drugi raz:
`403 — Zaproszenie jest nieprawidłowe lub wygasło.` 58 testów pgTAP (doszło 17 dla zaproszeń).

Trzy rzeczy wyszły dopiero przy uruchomieniu:
- `invite_preview` czytało `FOUND` po instrukcji `INSERT`, która je nadpisuje — każdy token
  wyglądał na ważny. Teraz wynik zapytania jest zapamiętywany w zmiennej.
- Hooka Auth nie wystarczy dopisać do `config.toml` i zrobić `db reset` — kontener Auth czyta
  konfigurację przy starcie, więc trzeba `npm run db:stop && npm run db:start`. Zanim to zrobiłem,
  rejestracja przechodziła bez żadnego tokenu.
- Token zaproszenia zostawał w metadanych konta: trigger go usuwał, ale Auth zapisuje wiersz
  użytkownika jeszcze raz po triggerze i nadpisuje zmianę. Czyści go teraz akcja `acceptInvite`.
  Test pgTAP sprawdzał wcześniej usuwanie w triggerze i przechodził — czyli sprawdzał zachowanie,
  którego w działającym systemie nie było. Zastąpiony asercją o tym, co trigger naprawdę robi.

---

## Etap 3 — silnik lekcji (MVP)

`start_lesson_session`, `submit_attempt`, `finish_lesson_session`, `get_lesson_exercises`;
cztery typy zadań (`translate_ab`, `translate_ba`, `fill_blank_choice`, `listening`);
wybór kursu → ekran kursu z działami i lekcjami → lekcja → podsumowanie; seed kursu PL→EN
(2 działy po 3 lekcje, ~40 słówek).

**Kryterium odbioru:** dziecko przechodzi lekcję demo od początku do końca, wynik jest w bazie,
następna lekcja odblokowana, a zablokowana widoczna, ale niedostępna.

**Stan (2026-11-15):** zrobione i przejrzane w przeglądarce od logowania po ekran podsumowania.
Lekcja demo (12 zadań, trzy typy) zaliczona z wynikiem 11/12 — dwie gwiazdki, +50 punktów,
odznaka „Pierwszy krok". Po powrocie na ekran kursu lekcja pierwsza jest zielona z gwiazdkami, druga
otwarta, trzecia nadal z kłódką.

Kryterium odbioru zostało zmienione: pierwotnie zamknięta lekcja miała być **niewidoczna**.
Przy pierwszym podejściu do ekranu kursu okazało się, że wtedy dziecko widzi jeden kafelek i pustkę,
co nie mówi mu nic o tym, co przed nim. Teraz zamknięte lekcje są widoczne z kłódką, a dostępu
pilnują `get_lesson_exercises` i `start_lesson_session` — obie odmawiają, co sprawdza pgTAP.

60 testów pgTAP. Doszły migracje `…_lesson_map.sql` (widok `v_my_lessons`) i poprawka
`vercel.json` — build na Vercelu padał, bo przy `NODE_ENV=production` npm pomija
`devDependencies`.

---

## Etap 4 — grywalizacja, powtórki, statystyki

`points_ledger` w użyciu, gwiazdki, seria dni, odznaki i ekran nagród, zapis stanu FSRS przy
każdej odpowiedzi, `get_review_set`, lekcja powtórkowa z działu, statystyki ucznia.

**Kryterium odbioru:** po ukończeniu lekcji punkty i gwiazdki zgadzają się z regułami,
a powtórka działu podaje dokładnie słówka zaległe i wcześniej pomylone.

**Stan (2026-11-15):** zrobione i sprawdzone w przeglądarce. Powtórka otwiera się po pierwszej
zaliczonej lekcji w dziale, zaczyna od słówka najbardziej zaległego i najczęściej mylonego,
przyjmuje odpowiedzi i przesuwa termin w FSRS. Ekran nagród pokazuje 8 odznak ze stanem zdobycia,
statystyki — punkty, serię, słówka umiane i zaległe, wykres tygodnia oraz listę słówek do
poćwiczenia. 70 testów pgTAP (doszło 10 dla powtórek).

Powtórka **nie ma własnych zadań** — bierze istniejące zadania dla słówek, które według FSRS
czekają. Dzięki temu zestaw jest inny dla każdego dziecka i każdego dnia, a silnik lekcji
pozostaje ten sam.

---

## Etap 5 — pozostałe typy zadań i dopracowanie interfejsu

`inflection`, `match_pairs`, `sentence_order`; maskotka, dźwięki, animacje, typografia, kontrast.

**Kryterium odbioru:** lekcja złożona z wszystkich siedmiu typów przechodzi bez błędów
na tablecie i na telefonie.

**Stan (2026-11-15):** zrobione. Lekcja „Zwierzęta domowe" ma teraz komplet siedmiu typów
(16 zadań) i przeszła w przeglądarce przy 375 px, 768 px i na szerokim ekranie — bez przewijania
w poziomie. Doszły: dopasowywanie par, rozsypanka słowna, dźwięk po odpowiedzi (z przełącznikiem
zapamiętywanym w przeglądarce) i animacje reakcji, wyciszone przy `prefers-reduced-motion`.

Dwie rzeczy poprawione po obejrzeniu na telefonie: w dopasowywaniu par głośniki zwężały prawą
kolumnę, więc przy wąskim ekranie znikają; przełącznik dźwięku i krzyżyk miały 34 px, czyli
poniżej progu, od którego dziecko trafia palcem — mają teraz 44 px.

**Dopisane później (2026-11-15):** ósmy typ — `listen_match`, czyli dopasowywanie ze słuchu
(głośniki po lewej, polskie słowa po prawej). Przy okazji łączenie w pary zaczyna dowolna
kolumna, a po błędzie widać komplet par. Szczegóły w `docs/DECYZJE.md`.

Wyszło też, że test lekcji nie znał nowych typów zadań (odpowiadał na nie jak na tekstowe),
a test powtórek filtrował zadania po losowanym typie — czyli potrafił paść bez żadnej zmiany
w kodzie. Oba poprawione; trzy przebiegi pod rząd zielone.

**Dopisane później (2026-11-15):** dziewiąty typ — `image_choice`, czyli wybór obrazka (słowo
u góry, od dwóch do czterech obrazków pod spodem). Pierwsze zadanie, które dziecko zrobi, nie
czytając po angielsku. Obrazki idą z bucketu `lesson-media` jako ścieżki, a nie adresy.
Szczegóły w `docs/DECYZJE.md`.

---

## Etap 6 — panel administratora

Import JSON z podglądem na sucho, CRUD kursów, działów, lekcji i słówek, wgrywanie obrazków
do Storage, lista uczniów z postępami, zarządzanie zaproszeniami, publikowanie treści.

**Kryterium odbioru:** nowa lekcja powstaje wyłącznie przez panel — od wklejenia JSON-a
do przejścia jej przez dziecko.

**Stan (2026-11-15):** zrobione i przejrzane w przeglądarce. Wklejony plik z lekcją „Owoce"
przeszedł podgląd na sucho, import, pojawił się na ekranie kursu jako nowy dział i dał się
przejść na trzy gwiazdki. Błędny plik pokazuje każdy problem ze ścieżką w pliku, np.
`exercises[0].payload.answer: poprawna odpowiedź musi być jedną z opcji`.

Powstały: panel (`/admin`), import z podglądem (`/admin/import`), lista uczniów
(`/admin/uczniowie`) i wgrywanie obrazków do Storage (`/admin/obrazki`). 96 testów pgTAP,
26 jednostkowych.

Czego **nie ma**: edycji pojedynczych pól przez formularze. Import jest idempotentny — poprawkę
wprowadza się przez ponowne wklejenie pliku — więc osobny CRUD byłby drugą drogą do tego samego
i drugim miejscem do utrzymania. Jeśli okaże się potrzebny, to osobny etap.

---

## Etapy w długiej lekcji (2026-11-15)

Lekcja z kilkunastoma nowymi słówkami to kilkadziesiąt zadań — za długo na jedno posiedzenie
ośmiolatka. Lekcja dzieli się teraz na **etapy po najwyżej 15 zadań**; zaliczenie lekcji to
zaliczenie wszystkich etapów. Podział liczy baza z liczby zadań, więc treść i format importu
zostają bez zmian, a lekcje mieszczące się w 15 zadaniach mają jeden etap i zachowują się
dokładnie jak dotąd. Szczegóły i odrzucone warianty w `docs/DECYZJE.md`.

---

## Aplikacja na telefon (2026-11-16)

Osobny plan w `docs/PLAN_MOBILE.md`: Android przez Expo, **tylko tryb ucznia** (bez panelu
administratora i bez widoku rodzica), etapy M0–M4 z bramką decyzyjną na początku. Web zostaje
miejscem, gdzie powstaje treść, zakłada się konta i rodzic patrzy na postępy dziecka.

---

## Poza planem

Generowanie lekcji przez Claude ze zdjęcia strony z książki. Format importu i model danych są
pod to przygotowane, więc dołożenie tego to jeden endpoint produkujący ten sam JSON.
