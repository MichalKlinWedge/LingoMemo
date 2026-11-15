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
- **Region**: projekt Supabase stoi w `eu-west-1` (Irlandia), więc Vercel ma `dub1` (Dublin),
  a nie `fra1` — ustawione w `vercel.json`. Domyślny `iad1` dokłada ~200 ms do każdej sprawdzanej
  odpowiedzi; przy aplikacji dla dziecka to różnica między „natychmiast” a „zacina się”.
  Region bazy sprawdza się przez `npm run supabase -- projects list`, a nie zgaduje.
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

## Pułapki znalezione przy Etapie 3 (2026-11-15)

- **Vercel buduje z `NODE_ENV=production`, a wtedy npm pomija `devDependencies`.** W nich
  siedziały `tailwindcss`, `@tailwindcss/turbopack` i `typescript`, więc `next build` padał —
  mimo że lokalnie, i nawet w czystym klonie z `npm ci`, przechodził bez zarzutu. Stąd
  `installCommand: "npm install --include=dev"` w `vercel.json`. Odtworzenie błędu lokalnie:
  `NODE_ENV=production npm install` w świeżym klonie.
- **Zamknięte lekcje muszą być widoczne.** Pierwotna polityka RLS ukrywała je całkowicie, przez
  co mapa kursu pokazywałaby jedną lekcję i pustkę. Tytuł lekcji nie jest tajemnicą — tajemnicą
  są zadania, a tych pilnują osobne mechanizmy. Patrz migracja `…_lesson_map.sql`.
- **W React nie wolno wołać `Date.now()` ani dotykać refów w trakcie renderu** (linter Next to
  wyłapuje). Klucz idempotencji sesji nadajemy więc przy pierwszej odpowiedzi, czyli w obsłudze
  zdarzenia, a nie przy renderowaniu komponentu.
- **PostgREST nie zgadnie relacji, gdy są dwie.** `lessons` wskazuje na `units` kluczem
  `unit_id` i `review_scope_unit_id`, więc zagnieżdżony select wymaga podpowiedzi:
  `units!unit_id(...)`.
- **Przycisk w przycisku to nieprawidłowy HTML.** Głośnik przy odpowiedzi stoi obok kafelka,
  nie w środku.

## Powtórki działu (2026-11-15)

| Obszar | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Zadania w powtórce | istniejące zadania słówek wybranych przez FSRS | zestaw inny dla każdego dziecka i każdego dnia, bez duplikowania treści; silnik lekcji bez zmian | generowanie zadań w locie (nie mają wiersza w `exercises`, więc nie da się do nich przypiąć próby) oraz osobna lekcja z ręcznie dobranymi zadaniami (natychmiast rozjeżdża się z postępami) |
| Kolejność | najpierw zaległe, potem najczęściej mylone, reszta losowo | dziecko najpierw nadrabia, a dopiero potem utrwala | sama kolejność z FSRS — przy równych terminach dawałaby zawsze ten sam zestaw |
| Otwarcie powtórki | po pierwszej zaliczonej lekcji w dziale | wcześniej nie ma czego powtarzać | po ukończeniu całego działu — powtórka przydaje się właśnie po drodze |

### Pułapki znalezione przy Etapie 4

- **`create or replace view` nie zmieni typu kolumny.** `count(*)` daje `bigint`; zamiana na
  `integer` wymaga `drop view` i utworzenia od nowa.
- **Wysokość w procentach wewnątrz kontenera flex bywa nieokreślona** — słupki wykresu po prostu
  znikają. Wysokości wykresu liczymy w pikselach.
- **Funkcja `security definer` z parametrem użytkownika jest testowalna, ta z `auth.uid()` — nie.**
  `pick_review_exercises(lesson, user)` przyjmuje użytkownika jawnie, dzięki czemu test pgTAP
  może przygotować dane jako `postgres`, zanim przełączy się na rolę ucznia.

## Nowe typy zadań (2026-11-15)

| Obszar | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Dopasowywanie par | dotknięcie po lewej, potem po prawej; para znika z kolumn i ląduje na liście połączonych | widać postęp, da się cofnąć pomyłkę, działa palcem i klawiaturą | kodowanie par kolorami (przy ośmiu parach nie do odróżnienia, a dziecko z zaburzeniami widzenia barw zostaje z niczym) oraz rysowanie linii między kolumnami |
| Rozsypanka słowna | dotknięcie klocka przenosi go do zdania i z powrotem | na tablecie przeciąganie jest dla dziecka trudniejsze niż dotknięcie | przeciąganie (drag & drop) — gorzej działa palcem i nie działa klawiaturą |
| Klocki w rozsypance | rozróżniane po pozycji, nie po treści | te same słowa mogą wystąpić dwa razy („the cat and the dog”) | klucz z treści słowa — przy powtórzeniu klocki znikałyby parami |
| Dźwięk reakcji | generowany przez Web Audio | zero plików do pobrania i utrzymania, działa offline | nagrania mp3 — kolejne zasoby do wersjonowania |

### Pułapki znalezione przy Etapie 5

- **`setState` w efekcie wywołuje kaskadę renderów** i linter Next to zgłasza. Ustawienie
  czytane z `localStorage` bierzemy przez `useSyncExternalStore`, który ma też osobny wynik dla
  serwera, więc nic nie mignie przy hydratacji.
- **Test filtrujący po losowanym typie zadania jest testem losowym.** Test powtórek wybierał
  zadanie `translate_ba`, a typ jest losowany — padał mniej więcej raz na kilka uruchomień.
  Po dołożeniu nowych typów częściej. Teraz bierze pierwsze z brzegu i układa odpowiedź pasującą
  do jego typu.
- **Dodanie nowego typu zadania wymaga ruszenia testu lekcji**, bo ten przechodzi całą lekcję
  i musi umieć odpowiedzieć na każdy typ. To dobra wiadomość: test od razu pokazał brak.

## Panel administratora (2026-11-15)

| Obszar | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Wprowadzanie treści | import JSON, idempotentny po kluczach naturalnych | poprawka to ponowne wklejenie pliku; plik da się napisać ręcznie albo wygenerować poza aplikacją | formularze CRUD na każde pole — druga droga do tego samego i drugie miejsce do utrzymania |
| Zapis importu | jedno wywołanie `admin_import_lesson` | Server Action z trzydziestoma `insert()` nie jest transakcją i przy błędzie zostawia połowę lekcji | zapis z aplikacji krok po kroku |
| Podgląd na sucho | walidacja zod + odczyt, bez zapisu | administrator widzi, czy lekcja powstanie, czy zostanie nadpisana, zanim cokolwiek ruszy | import z cofnięciem — nie da się wycofać transakcji z wnętrza funkcji |
| Zapis słowa przy imporcie | wymieniany w całości | inaczej poprawiona literówka zostaje w bazie jako „synonim" i nadal jest uznawana za poprawną odpowiedź | dopisywanie brakujących |
| Koncepty przy imporcie | nigdy nie kasowane | wiszą na nich stan powtórek i historia prób | wymiana razem z zadaniami |
| Obrazki | bucket `lesson-media`, odczyt publiczny, zapis tylko dla admina | obrazek jabłka nie jest tajemnicą, a publiczny odczyt pozwala użyć zwykłego `<img>` bez podpisywanych adresów, które wygasają | bucket prywatny z podpisywaniem każdego adresu |
| Wgrywanie plików | prosto z przeglądarki do Storage | omija limit wielkości żądania w Server Action | przesyłanie przez serwer aplikacji |

## Konta i hasła w panelu (2026-11-15)

| Obszar | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Zmiana cudzego hasła | funkcja `set_user_password` w bazie, `security definer`, skrót bcrypt prosto do `auth.users` | aplikacja webowa zostaje bez klucza `service_role`, a ten omija RLS całkowicie — jeden wyciek zmiennej środowiskowej odsłania całą bazę | `auth.admin.updateUserById` z Admin API (wymaga `service_role` w aplikacji) oraz link resetujący wysyłany mailem (dziecko nie ma własnej skrzynki) |
| Format skrótu | `crypt(hasło, gen_salt('bf', 10))` z pgcrypto | GoTrue trzyma hasła jako bcrypt `$2a$10$…` i czyta je bez żadnej zmiany po stronie Auth | argon2 (GoTrue go zapisze, ale pgcrypto nie umie go wyprodukować) |
| Po zmianie hasła | kasowanie wierszy z `auth.sessions` dla tego konta | kto znał stare hasło i ma otwartą kartę, traci dostęp — inaczej zmiana hasła niczego nie załatwia | zostawienie sesji (hasło zmienia się właśnie dlatego, że ktoś niepowołany mógł je poznać) |
| Ślad po zmianie | `app_private.password_resets`: komu, kto, kiedy | panel pokazuje datę ostatniej zmiany, a przy dwóch administratorach widać, kto ruszał konto | kolumna w `profiles` (uczeń może czytać swój profil, a to nie jego sprawa) |
| Hasło w formularzu | pole widoczne, nie zakryte kropkami, z przyciskiem „Wymyśl hasło" | administrator musi je przeczytać dziecku, a z bazy nie odzyska go nigdy | pole typu `password` z powtórzeniem (dorosły wpisuje hasło, którego nie widzi, i dyktuje je z pamięci) |

### Pułapki znalezione przy kontach

- **GoTrue nie znosi `NULL` w kolumnach tokenów `auth.users`** (`confirmation_token` i pokrewne).
  Konto wstawione ręcznie do bazy z `NULL` wywala logowanie błędem „Database error querying
  schema"; konta z rejestracji mają tam pusty napis. Dotyczy tylko danych testowych wstawianych
  z palca — `set_user_password` tych kolumn nie dotyka.
- **Test pgTAP musi wrócić do roli bazy przed odczytem `auth.users`.** Claimy do `set_config`
  czyta się z tej tabeli, a rola `authenticated` jej nie widzi — bez `reset role` test pada
  na „permission denied for table users", nie na sprawdzanej regule.

## Zmiana hasła przez administratora (2026-11-15)

| Obszar | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Kto zapisuje hasło | funkcja w bazie, `security definer` | Admin API Supabase wymagałoby klucza `service_role` w aplikacji webowej, a ten omija RLS całkowicie | `auth.admin.updateUserById` z aplikacji |
| Format skrótu | `crypt(..., gen_salt('bf', 10))` z pgcrypto | daje `$2a$10$…`, czyli dokładnie to, co czyta GoTrue — sprawdzone logowaniem, nie samym formatem | — |
| Potwierdzenie | **brak** — wystarczy rola administratora | decyzja właściciela aplikacji: dodatkowe pole kosztuje przy każdym użyciu, a chroni tylko przed cudzą ręką przy odblokowanym urządzeniu administratora; przy domowej aplikacji dla dwójki dorosłych to się nie zwraca | potwierdzanie własnym hasłem (było przez jedną migrację, zdjęte w `…_password_no_reauth.sql`) |
| Unieważnianie dostępu | kasowanie tokenów odświeżania **i** sesji, osobno | `refresh_tokens.session_id` jest kolumną opcjonalną, więc kaskada z `auth.sessions` nie jest gwarancją — to założenie o cudzym schemacie | poleganie na kaskadzie |
| Generator haseł | dwa słowa z listy 64 plus liczba dwucyfrowa | 64 × 64 × 90 = 368 640 kombinacji, krótkie do podyktowania i wpisania; lista ma 64 pozycje, bo 2^32 dzieli się przez 64 bez reszty i reszta z dzielenia nie faworyzuje żadnego słowa | trzy słowa (dłuższe do wpisania przez dziecko przy tej samej sile) |

Pierwsza wersja miała w komentarzu „ponad milion kombinacji" przy 16 słowach — faktycznie było ich
23 040, czyli ~43 razy mniej. Liczba w komentarzu, której nikt nie przelicza, jest gorsza niż jej brak.

## Pułapka: seed a migracja z tym samym kursem (2026-11-15)

Migracja `…_starter_course.sql` zakłada wiersz kursu `pl-en-starter`, żeby w chmurze było dokąd
importować lekcje. `seed.sql` zaczynał się od „jeśli kurs istnieje — wyjdź", więc od tej migracji
**nigdy nie wchodził**: lokalna baza miała kurs i zero działów, lekcji i słówek, a trzy pliki
testów pgTAP przestały przechodzić.

Warunek w seedzie sprawdza teraz TREŚĆ (czy istnieje dział tego kursu), a nie sam kurs. Przy
okazji druga pułapka: aliasu w zapytaniu nie wolno nazwać tak jak zmiennej rekordowej z `declare`
— plpgsql rozwiąże go jako zmienną i przerwie z „record is not assigned yet".

## Panel treści (2026-11-15)

| Obszar | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Zapis kursów, działów i lekcji | zwykłe zapytania pod politykami `*_admin` | polityki istnieją od pierwszej migracji i sprawdzają rolę przy każdym wierszu; funkcja nic by tu nie dołożyła poza kodem do utrzymania | osobne RPC na każdą operację |
| Dodanie słówka | funkcja `admin_add_word`, `security definer` | pojęcie, dwa terminy, pozycja w lekcji i trzy zadania to pięć tabel — albo wchodzi wszystko, albo nic | pięć `insert()` z Server Action (przy błędzie w połowie zostaje słówko bez zadań) |
| Zadania przy nowym słówku | trzy generowane automatem: tłumaczenie w obie strony i ze słuchu | lekcja założona w panelu jest od razu przechodzalna, a nie pusta | samo słówko (dziecko widzi lekcję bez zadań) oraz pełny edytor wszystkich siedmiu typów |
| Dystraktory w wyborze z listy | trzy inne słowa z tej samej lekcji, losowane przy dodawaniu | bez nich zadanie wyboru ma jedną odpowiedź; pierwsze słówko w lekcji dostaje więc wersję do pisania | stały zestaw dystraktorów |
| Usuwanie treści | kurs i dział można usunąć, lekcji i słówka nie (2026-11-15; wcześniej nie dało się usunąć niczego) | pomyłka przy zakładaniu kursu zostawała w panelu na zawsze, a ukrycie nie sprząta listy; przy lekcji i słówku ukrycie nadal wystarcza, bo tam chodzi o pojedynczy wpis, a nie o całą gałąź | brak kasowania (pierwsza wersja) oraz pełny CRUD z kasowaniem lekcji i słówek |
| Zapisy na kurs | polityka `enrollments_admin` obok `enrollments_insert_own` | administrator zapisuje i wypisuje cudze konta, dziecko dalej tylko siebie | funkcja `security definer` (jedna operacja na jednej tabeli nie potrzebuje transakcji) |
| Wypisanie z kursu | nie rusza postępów | `lesson_progress`, `attempts` i `srs_state` wiszą na użytkowniku, nie na zapisie, więc ponowny zapis przywraca stan | kasowanie postępów razem z zapisem |
| Poprawianie słówka | `admin_update_word` przepisuje też `payload` zadań z automatu, we wszystkich lekcjach kursu | treść zadania jest kopią słowa (sprawdzanie odpowiedzi nie schodzi przy każdej próbie do słownika), więc literówka poprawiona tylko w `terms` zostawałaby na ekranie dziecka | update samych `terms` (zadania zostają błędne) oraz kasowanie i dodawanie słówka od nowa (traci stan powtórek) |
| Zadania ułożone ręcznie przy poprawce | zostają nietknięte, funkcja zwraca ich liczbę | w zdaniu z luką czy rozsypance słowo bywa odmienione albo wplecione w zdanie — automat popsułby je bardziej, niż naprawił | przepisywanie wszystkich zadań pojęcia |
| Klucz słówka przy edycji | niezmienny | po kluczu import rozpoznaje, że to ten sam wpis; podmiana zdublowałaby słówko przy następnym pliku | edytowalny klucz |
| Slug kursu i działu | edytowalny, a po zmianie akcja przerzuca na nowy adres | slug widać w adresie i w nazwie pliku importu, a literówki w nim nie dało się poprawić inaczej niż zakładając kurs od nowa; stary adres przestaje istnieć w tej samej chwili, więc przekierowanie nie jest wygodą, tylko warunkiem, żeby strona po zapisie nie dała 404 | niezmienny slug oraz przekierowanie pominięte (strona po zapisie znika) |
| Zmiana języków kursu | tylko dopóki kurs nie ma słówek; pilnuje tego wyzwalacz `trg_courses_langs_frozen` | `terms` wiszą na kodzie języka, a treść zadania jest kopią słowa — po podmianie `target_lang` słówka zostałyby w starym języku, a lekcja czytałaby je głosem nowego | blokada tylko w formularzu (zapis idzie zwykłym `update`, więc nie ma tam czego pilnować) oraz przepisywanie słówek na nowy język |
| Kolejność przy kasowaniu kursu | funkcja `admin_delete_course`: najpierw działy, potem kurs | `lesson_items.concept_id` ma `on delete restrict`, a `concepts.course_id` ma `on delete cascade` — Postgres nie gwarantuje, że pozycje lekcji skasują się przed pojęciami, więc samo `delete from courses` wywala się na „restrict" | zwykły `delete` z aplikacji oraz zmiana `restrict` na `cascade` w `lesson_items` (to ona chroni stan powtórek przed usunięciem lekcji) |
| Kasowanie działu | zwykły `delete` pod polityką `units_admin`, bez funkcji | jedna operacja na jednej tabeli; słówka wiszą na kursie, nie na dziale, więc kaskada nie dotyka pojęć i nie trafia na `restrict` | funkcja `security definer` dla symetrii z kursem |
| Potwierdzenie kasowania | przepisanie sluga w polu obok przycisku | okienko „na pewno?" klika się odruchowo, a tu znikają też postępy i powtórki dzieci; panel pokazuje przy tym, ile działów, lekcji, słówek i zapisanych dzieci zniknie | `confirm()` w przeglądarce oraz samo kliknięcie czerwonego przycisku |
| Formularz edycji kursu i działu | zwykła sekcja na stronie | schowany pod `<details>` wyglądał na podpis listy i nikt go nie znajdował; pod rozwijaniem zostaje tylko kasowanie | rozwijanka dla obu (jeden klik mniej, ale funkcja niewidoczna) |

### Pułapki znalezione przy panelu treści

- **`on conflict` z indeksem częściowym wymaga powtórzenia warunku.** `terms_one_primary_idx`
  jest `unique (concept_id, lang) where is_primary`, więc działa dopiero
  `on conflict (concept_id, lang) where is_primary do update …` — bez `where` Postgres nie
  znajduje indeksu i wywala się na „no unique or exclusion constraint matching".
- **Next 16 nie uruchomi drugiego `next dev` w tym samym katalogu projektu.** Przy dwóch
  sesjach pracujących na jednym checkoucie druga dostaje `Another next dev server is already
  running` — podgląd w przeglądarce ma wtedy tylko ta sesja, która serwer uruchomiła.

## Flagi języków jako obrazki, nie emoji (2026-11-15)

Kursy miały flagę w polu `icon` jako emoji (🇬🇧). **Windows nie rysuje flag** z par liter
regionalnych — zamiast flagi pokazuje napis „GB". To nie jest usterka czcionki w aplikacji,
tylko brak tych glifów w systemie, więc żadne ustawienie CSS tego nie naprawi.

Flagi są teraz plikami w `apps/web/public/flagi/<kod>.svg`, a komponent `Flag` dobiera je po
kodzie języka kursu (`target_lang`). SVG, bo cztery flagi ważą razem 1,2 kB — mniej niż jeden
mały PNG — i są ostre w każdym rozmiarze, także na ekranach o dużej gęstości.

Dodanie języka to jeden plik `public/flagi/<kod>.svg` i wiersz w `languages`; w kodzie nie
zmienia się nic. Gdy pliku brakuje, komponent pokazuje ikonę kursu albo kod języka — nigdy
dziurę w układzie.

## Dopasowywanie ze słuchu i pary w obie strony (2026-11-15)

Doszedł ósmy typ zadania: `listen_match`. Po lewej stronie są głośniki, po prawej słowa po
polsku — dziecko słucha słowa w języku kursu i szuka jego znaczenia. Mechanika jest ta sama,
co w `match_pairs`, więc payload (`pairs` z `a` i `b`), tasowanie kolumn i sprawdzanie
odpowiedzi są wspólne; osobny jest tylko komponent.

| Obszar | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Kierunek łączenia | zaczyna dowolna kolumna | dziecko i tak patrzy raz w lewo, raz w prawo; wymuszanie „najpierw lewa" było utrudnieniem bez zysku, a przy słuchu odwracało naturalny ruch | dotychczasowe „lewa, potem prawa" |
| Kafelki ze słuchem | numer i głośnik, bez napisu | napis zamieniłby zadanie ze słuchu w zwykłe pary — dałoby się je zrobić, nie włączając dźwięku ani razu | pokazanie słowa po kliknięciu (po pierwszym odsłuchu reszta rozwiązuje się przez eliminację) |
| Ponowne dotknięcie głośnika | odtwarza jeszcze raz, nie zdejmuje zaznaczenia | dziecko dotyka głośnika właśnie po to, żeby usłyszeć drugi raz | przełącznik zaznaczenia jak w kolumnie z napisami |
| Liczba par | najwyżej 6 (w `match_pairs` jest 8) | usłyszane słowo trzeba utrzymać w pamięci, przeczytane zostaje na ekranie | ten sam limit co w parach |
| Odpowiedź po błędzie | komplet par w jednej linijce („pies — dog, kot — cat") | po ośmiu dotknięciach samo „nie tym razem" niczego nie uczy; dotyczy teraz także `match_pairs` | pokazywanie, które pary były źle (zdradza resztę przy poprawianiu) |

Walidacja payloadu dla `listen_match` jest ostrzejsza niż dla par: sprawdzamy, że każda para ma
`a` i `b` jako napisy. Przy parach zły kształt widać od razu na ekranie, tutaj kończyłby się
niemym głośnikiem, czyli czymś, co wygląda jak awaria przeglądarki.

- **`alter type ... add value` musi iść osobną migracją.** Nowa wartość enuma jest widoczna
  dopiero po zatwierdzeniu transakcji, a Postgres parsuje ciała funkcji SQL przy tworzeniu —
  `validate_exercise_payload` z literałem `'listen_match'` w tej samej migracji wywala się na
  „unsafe use of new value of enum type". Stąd `…_listen_match_enum.sql` i `…_listen_match.sql`.
- **Tekst do przeczytania głosem musi pojechać do przeglądarki.** To nie jest wyciek klucza
  odpowiedzi: rozwiązaniem jest przyporządkowanie, a tego w wydanym payloadzie nie ma — obie
  kolumny są tasowane osobno. Tak samo działa zadanie `listening`, które od początku wysyła
  słowo do wymówienia.

## Wybór obrazka (2026-11-15)

Dziewiąty typ zadania: `image_choice`. Na górze słowo, pod nim od dwóch do czterech obrazków —
dziecko dotyka tego, który pokazuje słowo. To jedyne zadanie, które da się zrobić, nie czytając
po angielsku: odpowiedzią jest obrazek, nie napis.

| Obszar | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Co stoi w payloadzie | ścieżka w buckecie (`2026/pies.png`) | adres zmienia się razem z projektem w chmurze, ścieżka nie; panel „Obrazki" daje dokładnie ją do skopiowania | pełny adres publiczny w pliku lekcji |
| Porównanie odpowiedzi | znak w znak, bez `normalize_answer` | normalizacja zjada kropki i ukośniki, więc `pies.png` i `pies-png` zrobiłyby się jednym plikiem; to nie jest tekst pisany przez dziecko | wspólna gałąź z `fill_blank_choice` |
| Liczba obrazków | najwyżej 4 | kafelek z obrazkiem jest duży; na telefonie w pionie więcej niż dwa rzędy znaczy przewijanie, czyli wybór w ciemno | sześć, jak w wyborze z listy |
| Opis dla czytnika ekranu | „Obrazek 1", „Obrazek 2" | nazwa pliku zwykle zdradza odpowiedź, a czytnik przeczytałby ją na głos razem z resztą kafelków | `alt` z nazwą pliku albo ze słowem |
| Odpowiedź po błędzie | podświetlony właściwy kafelek, bez paska z tekstem | ścieżka pliku nie mówi dziecku nic; pasek „Poprawnie: 2026/pies.png" byłby szumem | pokazanie nazwy pliku jak przy pozostałych typach |
| Kolejność obrazków | taka jak w pliku lekcji | tak samo działa `fill_blank_choice`; rozwiązaniem jest `answer`, nie pozycja, więc tasowanie nic nie chroni | tasowanie w `get_lesson_exercises` jak przy parach |

`speak` i `lang` są opcjonalne. Gdy są, nad obrazkami staje głośnik i zadanie robi się
„posłuchaj i wskaż" — ten sam komponent, inne wejście dla dziecka, które jeszcze nie czyta.

- **Walidacja pilnuje powtórzonych obrazków.** Dwa razy ten sam plik to dwie poprawne
  odpowiedzi, z których jedna liczy się jako błąd, a na ekranie nie widać tego wcale.
- **`get_lesson_exercises` zostaje bez zmian.** Gałąź `else` i tak wycina `answer`, a `prompt`
  z `options` mają dojechać do przeglądarki — nie ma tu czego dopisywać.

### Formularz w panelu (2026-11-15)

Zadanie z obrazkiem jest jedynym, które administrator składa z ręki w panelu — reszta zadań
układanych ręcznie wchodzi importem JSON.

- **Zwykły `insert`, nie funkcja `security definer`.** To jeden wiersz, więc nie ma tu czego
  pakować w transakcję; polityka `exercises_admin` i `validate_exercise_payload` jako CHECK
  pilnują tego samego, co pilnowałaby funkcja. Osobne RPC byłoby kodem bez zadania.
- **Ten sam schemat zoda, co import.** `imageChoicePayloadSchema` sprawdza payload w akcji
  serwera i w pliku importu — inaczej panel przyjmowałby zadania, których import by odrzucił.
- **Obrazki lecą do Storage prosto z przeglądarki.** Plik 2 MB przez Server Action przeszedłby
  dopiero po podniesieniu limitu żądania, a do akcji i tak jedzie sama ścieżka.
- **Poprawnego obrazka nie zaznaczamy za administratora.** Zadanie z cicho ustawionym złym
  kluczem odpowiedzi wygląda na ekranie normalnie i wychodzi dopiero wtedy, gdy dziecko dostaje
  błąd za dobrą odpowiedź. Lepszy jeden klik więcej niż taka pułapka.
- **Bez wskazania słówka zadanie nie wchodzi do powtórek.** Stan FSRS wisi na słówku, nie na
  zadaniu, więc lista słówek lekcji jest w formularzu, a nie w dokumentacji.

## Czas nauki i statystyki dziecka (2026-11-15)

| Obszar | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Skąd czas nauki | z `lesson_sessions`: od `started_at` do `finished_at` | to jedyne dwa znaczniki, które już są i opisują rzeczywiste wejście do lekcji i jej koniec; nic nie trzeba dopisywać po stronie przeglądarki | suma `attempts.response_ms` (mierzy czas myślenia nad zadaniem, nie czas nauki) oraz bicie „pulsu" z karty co kilkanaście sekund |
| Sesja bez końca | liczy się jako zero | dziecko zamknęło kartę w połowie lekcji — nie wiadomo, czy uczyło się dwie minuty, czy odeszło od komputera na godzinę; zero jest fałszem mniejszym niż dowolne zgadnięcie | doliczanie czasu do ostatniej odpowiedzi w sesji |
| Sesja dłuższa niż pół godziny | liczy się jako pół godziny (`session_seconds`) | lekcja ma kilkanaście zadań, więc pół godziny to już bardzo dużo; bez czapki jedno zapomniane okno robi z tygodnia nauki kilkanaście godzin i liczba przestaje cokolwiek znaczyć | surowa różnica znaczników oraz odrzucanie całej takiej sesji (znika też realna nauka sprzed przerwy) |
| Kto liczy | widoki `v_my_stats` i `v_my_courses` w bazie | sumy i grupowania po dniach nie da się poprosić przez PostgREST, a liczenie tego w przeglądarce znaczy ściąganie całej historii odpowiedzi | liczenie w Server Action po stronie aplikacji |
| Podgląd cudzych statystyk | te same widoki z `security_invoker`, bez funkcji dla administratora | polityki `*_read` już dopuszczają `is_admin()`, więc to samo zapytanie zwraca dziecku jeden wiersz, a dorosłemu wiersz każdego dziecka; druga ścieżka do tych samych liczb rozjechałaby się po pierwszej poprawce | funkcja `security definer` `student_stats(uuid)` obok widoków |
| Lekcje w rozbiciu na kursy | liczone tylko opublikowane | inaczej „5 z 12" znaczyłoby co innego na ekranie dziecka (widzi opublikowane) i w panelu (widzi wszystko) | liczenie wszystkich lekcji |
| Średni czas na lekcję | dzielone przez dokończone podejścia, nie przez zaliczone lekcje | lekcja powtarzana trzy razy zajęła trzy razy tyle czasu i tak ma być liczona | dzielenie przez `lessons_done` |
| Kafelki i wykres tygodnia | wspólny komponent `stats-widgets.tsx` | ten sam zestaw ogląda dziecko na swoim ekranie i dorosły w panelu; dwie kopie po pierwszej poprawce pokazywałyby co innego | osobny wykres na każdej ze stron |

### Pułapka: druga zmiana użytkownika w teście pgTAP

`set_config('request.jwt.claims', …)` wyliczane z `auth.users` działa tylko za pierwszym razem —
przy drugim wywołaniu rola to już `authenticated`, która tej tabeli nie czyta, i test pada na
„permission denied for table users" zamiast na sprawdzanej regule. Claimy wszystkich kont
układamy więc raz, jeszcze jako rola bazy, do tabeli tymczasowej (`t_claims`), a przełączanie
użytkownika tylko je stamtąd podstawia.

## Etapy lekcji (2026-11-15)

Lekcja „How do you spell that" z kursu dla czwartej klasy ma 18 słówek i 36 zadań. Dla dziecka
to pół godziny bez przerwy, a przerwanie w połowie nie zapisywało dotąd niczego — przy następnym
wejściu wszystko zaczynało się od nowa. Lekcja dzieli się więc na etapy po najwyżej 15 zadań,
a `lesson_progress` dostaje `completed` dopiero wtedy, gdy zaliczone są wszystkie.

| Obszar | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Skąd etapy | liczone w bazie z liczby zadań: `ceil(zadań / 15)`, zadanie `rn` trafia do `((rn-1) * etapów) / zadań + 1` | zero zmian w treści i w imporcie; lekcje do 15 zadań mają jeden etap i działają jak dotąd | etap jako pole w JSON-ie (każdy plik do poprawy, limit pilnowany ręcznie) oraz etap jako osobna lekcja (na mapie trzy kafelki zamiast jednego) |
| Próg podziału | zawsze, gdy zadań jest więcej niż 15 | jeden warunek zamiast dwóch; „więcej niż 10 słówek" i tak znaczy ponad 30 zadań, bo każde słówko ma ich trzy | dosłowne „> 10 słówek" (lekcja z 10 słówkami zostawałaby jednym etapem na 30 zadań) |
| Kawałki | równe co do jednego zadania (36 → 12/12/12, 31 → 11/10/10) | ostatni etap z jednym zadaniem wygląda jak usterka | pełne piętnastki i reszta na końcu (36 → 15/15/6) |
| Przejście dalej | podsumowanie etapu z przyciskiem „Następny etap", puchar dopiero po ostatnim | dziecko widzi postęp i ma gdzie skończyć; „Lekcja zaliczona!" po pierwszym z trzech kawałków byłoby nieprawdą | wybór etapu z mapy (więcej klikania) i jeden ciąg bez przerw (znika cały zysk z dzielenia) |
| Punkty za lekcję | `xp_reward` dzielone między etapy, reszta z dzielenia do ostatniego | przejście lekcji po kawałku daje tyle samo, co za jednym razem | pełna nagroda za każdy etap (trzykrotność) albo wypłata dopiero na końcu (dwa etapy bez nagrody) |
| Wynik lekcji | średnia z najlepszych wyników etapów, etapy nierozegrane liczone jako zero | po pierwszym z trzech etapów na mapie widać jedną trzecią, a nie komplet gwiazdek | wynik ostatniego etapu (jeden słaby kawałek kasowałby dwa dobre) |

Gwiazdki za lekcję pojawiają się dopiero po ostatnim etapie — wcześniej nie ma czego oceniać.
Powtórka ma najwyżej `review_limit()` zadań, więc zawsze jest jednoetapowa.

- **Sesja należy do etapu.** `lesson_sessions.stage_nr` i sprawdzenie w `submit_attempt`:
  bez tego dało się przysłać identyfikator zadania z etapu trzeciego, siedząc w pierwszym.
  Numer etapu zadania liczy `exercise_stage` — kolejność (`sort_order`, potem `id`) musi być
  ta sama co w `get_lesson_exercises`, inaczej funkcja odbijałaby zadania z właściwego etapu.
- **Argument domyślny nie dokłada się do istniejącej funkcji.** `get_lesson_exercises(uuid)`
  i `start_lesson_session(uuid, text)` trzeba było najpierw skasować: obok wariantu
  z `p_stage integer default 1` wywołanie jednoargumentowe stałoby się niejednoznaczne.
  Stare wywołania (również w testach) działają dalej, bo trafiają na wartość domyślną.
- **`create or replace view` nie zmieni typu istniejącej kolumny.** Przy dokładaniu
  `stage_count` do `v_my_lessons` trzeba było przepisać `word_count` co do `::integer`
  z migracji `…_review_count.sql`, inaczej Postgres odmawia podmiany widoku.
- **Przejście do następnego etapu to ten sam adres z innym parametrem**, więc React trzymał
  stan poprzedniego (numer zadania, ekran podsumowania). Komponent biegu lekcji dostaje
  `key={stage}` i startuje od nowa.

## Odpowiedzi: bez ogonków i więcej niż jedna (2026-11-15)

| Obszar | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Pisanie bez polskich liter | przyjmowane od początku, przez `normalize_answer` (`unaccent` + bez wielkości liter, interpunkcji i nadmiarowych spacji) | dziecko uczy się słówka, a nie szukania „ż" na klawiaturze; `unaccent` radzi sobie też z „ł", którego NFD nie rozkłada | porównanie znak w znak oraz osobna lista wariantów bez ogonków w `accepted` |
| Pilnowanie tej reguły | osobny plik testów `answers.test.sql` z drogą przez `submit_attempt`, nie tylko z samą funkcją | blok porównania jest przepisany w czterech migracjach (lekcja, powtórka, dopasowanie ze słuchu, obrazek, etapy) i w piątej kopii łatwo go zgubić; test na samej `normalize_answer` by tego nie złapał | brak testu (reguła działała, ale nic jej nie chroniło) |
| Kilka poprawnych odpowiedzi | pole formularza przyjmuje listę po przecinku, rozbija ją `split_answers` w bazie | `accepted` jest tablicą od pierwszej migracji, a import umiał synonimy od początku — brakowało tylko drogi z panelu; rozbijanie w bazie nie zmienia sygnatur funkcji, więc stare wywołania z jednym słowem działają bez zmian | nowy parametr `text[]` (wymusza `drop function` i przepisanie wywołań w trzech plikach testów) oraz osobne pole „synonimy" w formularzu |
| Która forma jest główna | pierwsza z listy | to ona stoi w `terms` jako `is_primary`, ją widzi dziecko w poleceniu, czyta syntezator mowy i ona trafia na listę wyboru u innych słówek; bez jawnej reguły kolejność zależałaby od przypadku | wybór głównej formy osobnym polem |
| Dystraktory na liście wyboru | tylko słowa główne | synonim obok swojego słowa na jednej liście daje dwie poprawne odpowiedzi, z których jedna liczy się jako błąd | losowanie ze wszystkich form |
| Synonimy przy poprawce | wymieniane w całości, jak przy imporcie | inaczej poprawiona literówka zostawałaby w bazie jako „synonim" i dalej liczyła się jako dobra odpowiedź; dlatego formularz pokazuje wszystkie formy naraz, a nie samo słowo główne | dopisywanie nowych form bez kasowania starych |
| Separator form | przecinek, średnik albo ukośnik | każdy z nich pisze się odruchowo, a w słówkach dla dzieci żaden nie występuje w treści odpowiedzi | sam przecinek oraz osobne pola na każdą formę |

### Kolejność odpowiedzi na liście wyboru (2026-11-15)

Lista z `options` wychodziła do dziecka w kolejności z `payload`, a w plikach importu poprawna
odpowiedź stoi pierwsza — po kilku zadaniach dziecko przestawało czytać listę i dotykało
pierwszego kafelka. Pary, dopasowanie ze słuchu i rozsypanka były tasowane od początku; lista
wyboru została pominięta.

- **Tasujemy przy wydawaniu (`get_lesson_exercises`), nie w `payload`.** Kolejność w bazie
  zostaje czytelna dla administratora i dla importu (poprawna odpowiedź może stać pierwsza),
  a dziecko dostaje inny układ przy każdym wejściu do lekcji. Przestawianie `payload` przy
  zapisie dałoby jeden układ na zawsze, a tasowanie w przeglądarce — niezgodność przy
  hydratacji (serwer wyrenderowałby inną kolejność niż klient).
- **Pułapka w teście: funkcja `stable` liczy się raz na zapytanie.** Dwadzieścia wywołań
  `get_lesson_exercises` w jednym `select` z `generate_series` zwraca dwadzieścia identycznych
  list, bo Postgres ma prawo policzyć taką funkcję raz i podstawić wynik. Test musi wołać ją
  w pętli, osobnym zapytaniem na iterację — inaczej „udowodni" brak tasowania.
