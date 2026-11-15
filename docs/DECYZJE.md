# Decyzje

Co wybrano, dlaczego i co zostało odrzucone. Nowy wpis dopisywany jest z datą, stare nie są
usuwane — jeśli decyzja się zmienia, dopisujemy ją obok ze wskazaniem, co zastępuje.

## Stos i architektura (2026-11-15)

| Obszar | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Framework | Next.js 16 (App Router) + React 19 | sprawdzony układ z sąsiedniego projektu przenosi się 1:1, razem z `proxy.ts` i klientami Supabase | Next 15 z `middleware.ts` — działa, ale rozjeżdża się ze wzorcem |
| Backend | Supabase (Postgres, Auth, Storage, RLS) | uprawnienia w bazie zamiast w kodzie aplikacji, pliki z kontrolą dostępu, zero własnego serwera | Firebase (NoSQL utrudnia statystyki), własny backend (niepotrzebny przy tej skali) |
| Treść wielojęzyczna | `concepts` (znaczenie) + `terms` (słowo w języku) | dodanie kursu PL→DE to wiersze w `terms`, bez migracji | para `(słowo_pl, słowo_en)` w jednym wierszu — blokuje trzeci język |
| Zadania | jedna tabela + `type` + `payload jsonb` | siedem typów o różnym kształcie, jedno zapytanie na lekcję, jeden zestaw polityk; nowy typ to wartość w enumie | tabela na typ — `UNION ALL` przy każdym pobraniu lekcji i siedem kopii tych samych polityk |
| Ocena odpowiedzi | wyłącznie w Postgresie (`submit_attempt`) | jedna implementacja normalizacji; klucze odpowiedzi nie opuszczają bazy | ocena w kliencie (błąd psuje powtórki i statystyki nieodwracalnie) oraz ocena podwójna (dwie normalizacje się rozjeżdżają) |
| Rola admina | claim `app_metadata.is_admin` + tabela `app_private.admin_users` | zero zapytań do bazy w politykach; użytkownik nie nada sobie roli sam | `profiles.is_admin` — natychmiastowa eskalacja uprawnień |
| Rejestracja | hook Auth `before_user_created` sprawdza token zaproszenia | zero `service_role` w aplikacji webowej | Route Handler z `admin.createUser()` — szczelniejszy, ale wnosi klucz omijający RLS do aplikacji |
| Logowanie | email + hasło | dzieci nie obsłużą magic linku ani OAuth | Google OAuth, magic link |
| Dźwięk | Web Speech API, pole `audio_path` jako zapas | zero kosztów i infrastruktury na start | gotowe pliki MP3 od razu — koszt i praca przy każdej lekcji |
| Powtórki | FSRS-6 (21 wag), liczony w Postgresie | nowoczesny harmonogram powtórek: planuje termin z modelu pamięci (stabilność, trudność, retencja), a nie ze sztywnej drabinki interwałów | SM-2 i stałe interwały 1/3/7/16/35 dni — prostsze, ale wyraźnie gorzej dobierają termin |
| Tolerancja literówek | jeden znak różnicy przy słowie dłuższym niż 4 znaki (`near_miss`) | dziecko uczy się słówka, nie pisowni na maszynie | dokładne porównanie — zniechęca; progi procentowe — nieprzewidywalne |

## Pułapki, które są już obsłużone

Zebrane z wcześniejszego projektu na tym samym stosie — nie trzeba ich odkrywać drugi raz.

- **Next 16 + `cacheComponents`**: klient Supabase sprawdza ważność tokenu zegarem, więc
  `createClient()` na serwerze musi zaczynać się od `await connection()`.
- **Server Actions omijają matcher z `proxy.ts`** — autoryzacja musi być w każdej akcji osobno.
- **`auth.uid()` w polityce RLS liczy się dla każdego wiersza.** Owinięte w `(select ...)`
  liczy się raz; przy listingu to różnica rzędu stukrotnej.
- **Rekurencja w politykach** — polityka na tabeli nie może odpytywać tej samej tabeli wprost.
  Zawsze przez funkcję `stable security definer`.
- **Widok bez `security_invoker = on`** działa z uprawnieniami właściciela i omija RLS.
- **Tabela bez włączonego RLS** jest w Supabase czytelna dla każdego z kluczem publicznym —
  stąd asercja kontrolna na końcu pliku z politykami.
- **`getVoices()` zwraca pustą tablicę przy pierwszym wywołaniu** (trzeba `onvoiceschanged`),
  iOS wymaga gestu użytkownika, część Androidów nie ma głosu `en-GB`.
- **Region**: Vercel `fra1` i Supabase we Frankfurcie. Domyślny `iad1` dokłada ~200 ms do każdej
  sprawdzanej odpowiedzi — przy aplikacji dla dziecka to różnica między „natychmiast” a „zacina się”.
- **Supabase Free pauzuje projekt po 7 dniach bezczynności** — przy jednym dziecku to realne.
- **Migracja kasująca treść kasuje też historię.** `attempts.exercise_id` ma `on delete set null`
  i zamrożony `exercise_type`; zamiast `DELETE` używamy `is_active = false`.

## Zmiana: powtórki na FSRS-6 (2026-11-15)

Pierwotnie plan zakładał uproszczone SM-2 (binarna ocena, drabinka 1/3/7/16/35 dni). Zastąpione
przez **FSRS-6** — ten sam algorytm, którego używa dziś Anki. Powód: SM-2 planuje termin z historii
ocen, FSRS z modelu pamięci (stabilność `S`, trudność `D`, retrievability `R`), i w porównaniach
na dużych zbiorach powtórek trafia w termin istotnie lepiej. Przy nauce słówek to jest cała
wartość aplikacji, więc nie ma sensu oszczędzać akurat tutaj.

**Gdzie liczony.** W Postgresie, razem z oceną odpowiedzi i punktami — jedna transakcja, jedno
źródło prawdy. Wagi leżą w tabeli `srs_params`, więc da się je później dostroić bez migracji.

**Skąd oceny.** FSRS oczekuje oceny 1–4 (Again/Hard/Good/Easy), a dziecko nie ocenia własnej
pamięci. Wyprowadzamy ją z tego, co widać (`gradeFor` w `packages/core/src/srs.ts`):

| Ocena | Kiedy |
|---|---|
| 1 — Again | odpowiedź błędna |
| 2 — Hard | poprawna, ale z tolerowaną literówką albo po podpowiedzi |
| 3 — Good | poprawna |
| 4 — Easy | poprawna, zadanie na jedno dotknięcie, odpowiedź poniżej 4 s |

„Easy” nie jest przyznawane za szybkie pisanie z klawiatury — czas mówiłby wtedy o sprawności
palców dziecka, nie o pamięci.

**Jak sprawdzane.** `scripts/fsrs-fixtures.mjs` generuje z pakietu `ts-fsrs` (implementacja
referencyjna) 260 przejść stanu i 15 interwałów do `supabase/tests/_fsrs_cases.sql`; test pgTAP
porównuje je z tym, co liczy baza. Bez tego błąd we wzorze nie rzuciłby wyjątku — po prostu
po cichu psułby terminy powtórek. Stałe skopiowane do `packages/core` pilnuje test jednostkowy.

**Powtórki tego samego dnia** obsługuje FSRS-6 natywnie (`t = 0`, wzór short-term), więc kilka
podejść do tego samego słówka w jednej lekcji jest poprawnie uwzględnione.

## Pułapki znalezione przy Etapie 2 (2026-11-15)

- **`FOUND` w plpgsql obowiązuje tylko do następnej instrukcji.** `select ... into` ustawia je,
  ale każdy kolejny `insert` nadpisuje. Wynik zapytania trzeba zapamiętać w zmiennej, zanim
  zrobi się cokolwiek innego.
- **Kontener Auth czyta `config.toml` przy starcie.** Po dopisaniu hooka `db reset` nie wystarcza
  — potrzebny jest `npm run db:stop && npm run db:start`. Do czasu restartu rejestracja działa
  tak, jakby hooka nie było, czyli bez żadnej kontroli zaproszeń.
- **Auth nadpisuje metadane użytkownika po triggerach na `auth.users`.** Czego trigger nie zdąży
  zmienić w `raw_user_meta_data`, to i tak przepadnie — zmiany po rejestracji robi się
  z aplikacji przez `auth.updateUser`.
- **Argumenty opcjonalne RPC w typach generowanych z bazy są `| undefined`, nie `| null`.**
  Przekazanie `null` nie przechodzi kontroli typów.
- **Przekazanie argumentów przez zagnieżdżone skrypty npm wymaga `--` na końcu** skryptu
  nadrzędnego (`npm run seed --workspace tools/seed-dev --`), inaczej flagi po prostu znikają.
