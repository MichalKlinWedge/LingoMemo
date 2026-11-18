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
  co ekran kursu pokazywałby jedną lekcję i pustkę. Tytuł lekcji nie jest tajemnicą — tajemnicą
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
| Gdzie się zapisuje na kurs | w dwóch miejscach, jedną akcją `setEnrollmentAction`: na stronie kursu (lista dzieci) i na karcie dziecka (lista wszystkich kursów) | dorosły myśli raz kursem („kto to przerobi"), raz dzieckiem („co ono ma teraz do roboty") — przy jednym wejściu trzeba było zgadywać, na której stronie kursu szukać dziecka; karta pokazuje też kursy bez zapisu i oznacza nieopublikowane, bo inaczej nie dałoby się zapisać na coś, czego dziecko jeszcze nie ma | tylko strona kursu (pierwsza wersja) oraz osobna strona „przypisania" |
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
| Skąd etapy | liczone w bazie z liczby zadań: `ceil(zadań / 15)`, zadanie `rn` trafia do `((rn-1) * etapów) / zadań + 1` | zero zmian w treści i w imporcie; lekcje do 15 zadań mają jeden etap i działają jak dotąd | etap jako pole w JSON-ie (każdy plik do poprawy, limit pilnowany ręcznie) oraz etap jako osobna lekcja (na ekranie kursu trzy kafelki zamiast jednego) |
| Próg podziału | zawsze, gdy zadań jest więcej niż 15 | jeden warunek zamiast dwóch; „więcej niż 10 słówek" i tak znaczy ponad 30 zadań, bo każde słówko ma ich trzy | dosłowne „> 10 słówek" (lekcja z 10 słówkami zostawałaby jednym etapem na 30 zadań) |
| Kawałki | równe co do jednego zadania (36 → 12/12/12, 31 → 11/10/10) | ostatni etap z jednym zadaniem wygląda jak usterka | pełne piętnastki i reszta na końcu (36 → 15/15/6) |
| Przejście dalej | podsumowanie etapu z przyciskiem „Następny etap", puchar dopiero po ostatnim | dziecko widzi postęp i ma gdzie skończyć; „Lekcja zaliczona!" po pierwszym z trzech kawałków byłoby nieprawdą | wybór etapu z ekranu kursu (więcej klikania) i jeden ciąg bez przerw (znika cały zysk z dzielenia) |
| Punkty za lekcję | `xp_reward` dzielone między etapy, reszta z dzielenia do ostatniego | przejście lekcji po kawałku daje tyle samo, co za jednym razem | pełna nagroda za każdy etap (trzykrotność) albo wypłata dopiero na końcu (dwa etapy bez nagrody) |
| Wynik lekcji | średnia z najlepszych wyników etapów, etapy nierozegrane liczone jako zero | po pierwszym z trzech etapów na ekranie kursu widać jedną trzecią, a nie komplet gwiazdek | wynik ostatniego etapu (jeden słaby kawałek kasowałby dwa dobre) |

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

### Poziom trudności zadań (2026-11-15)

Lekcje były za trudne: każde słówko dostaje komplet zadań, a wśród nich wpisywanie — dziecko,
które dopiero poznało słowo, nie ma szans go napisać. Trudność rozbiliśmy na dwa niezależne
ograniczenia, a zadanie wchodzi do lekcji, gdy mieści się w obu.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Sufit konta | `profiles.level` 1–3, ustawia rodzic w panelu ucznia | jedno pole na dziecko, widoczne tam, gdzie i tak ogląda się jego postępy | poziom osobno dla każdego kursu (`enrollments`) — przy jednym kursie na dziecko nie widać różnicy, a każde zapytanie rośnie o złączenie |
| Rampa słówka | poziom z `srs_state.stability`: 7 dni → rozpoznaję, 21 dni → umiem | trudność rośnie słówko po słówku, więc nowe słowo zaczyna od klikania nawet na poziomie 3; sam przełącznik na koncie podnosiłby trudność skokiem, także dla świeżo poznanych słów | tylko ręczny poziom; tylko automat z wyników całych lekcji (skok w trudności w złym momencie) |
| Gdzie siedzi poziom zadania | kolumna `exercises.level`, nie mapa „typ → trudność" | `translate_ab` z `options` w payloadzie to klikanie w kafelki, a bez nich wpisywanie z klawiatury — ten sam typ bywa i łatwy, i trudny | tabela przeliczająca typ na poziom |
| Skąd bierze się poziom zadania | wyzwalacz `exercises_level` z funkcji `default_exercise_level(type, payload)`; podany wprost zostaje | `default` kolumny nie widzi reszty wiersza, a import i panel nie muszą nic podawać | wyliczanie poziomu w aplikacji przy każdym wstawieniu |
| `level` bez `not null` | pusty być nie może, ale pilnuje tego więz `exercises_level_valid` razem z wyzwalaczem | `not null` bez `default` sprawia, że `npm run gen` robi z kolumny pole wymagane w każdym `insert()` w aplikacji, a `default` ubiegłby wyzwalacz i wszystko miałoby poziom 1 | `not null` z wartością domyślną |
| Gdzie filtrujemy | `visible_exercises` w bazie, używane przez `get_lesson_exercises`, `lesson_exercise_count`, `exercise_stage` i `pick_review_exercises` | dobór zadań i klucze odpowiedzi nie opuszczają bazy, a etapy lekcji muszą liczyć dokładnie to, co dziecko dostanie | filtr w przeglądarce; filtr tylko w `get_lesson_exercises` (etapy rozjechałyby się z `submit_attempt`) |
| Słówko bez zadania w poziomie | wchodzi jego najłatwiejsze zadanie | inaczej słówko wypadłoby z lekcji, FSRS nigdy by go nie zobaczył i nigdy nie dojrzałoby do trudniejszych zadań | pominięcie słówka |

Skutki uboczne, o których trzeba wiedzieć:

- **Na poziomie 1 lekcja jest krótsza.** `admin_add_word` robi do słówka jedno zadanie na
  klikanie (tłumaczenie z kafelkami, i tylko gdy w lekcji jest z czego je ułożyć) i dwa na
  wpisywanie, więc filtr zdejmuje większość. Docelowo generator powinien robić więcej wariantów
  łatwych — dopóki tego nie ma, poziom 1 skraca lekcję, zamiast ją zamieniać na łatwiejszą.
- **Zadanie spoza poziomu nie da się rozwiązać.** `submit_attempt` sprawdza etap przez
  `exercise_stage`, a ten liczy tylko widoczne zadania — odpowiedź na schowane zadanie wraca
  z komunikatem o złym etapie lekcji. W aplikacji nie ma jak do tego dojść, bo dziecko dostaje
  wyłącznie zadania widoczne.
- **Testy silnika lekcji ustawiają sufit 3 i wysoką stabilność.** `lessons`, `answers`
  i `skip_exercise` sprawdzają ocenianie i etapy, nie dobór trudności — bez tego ustawienia
  wybierałyby zadanie zależne od tego, które uuid wypadnie niżej.

### Łatwy wariant zdania (2026-11-15)

Zadanie „wpisz całe zdanie" jest zadaniem poziomu 3, więc na poziomie 1 po prostu znikało
z lekcji — dziecko nie ćwiczyło zdań w ogóle. Zamiast chować takie zadanie, dorabiamy mu łatwy
odpowiednik: tę samą treść dziecko układa z klocków, wśród których są słowa niepasujące.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Typ łatwego wariantu | istniejąca rozsypanka `sentence_order` z dystraktorami | nie trzeba nowego typu zadania, komponentu ani gałęzi w ocenianiu — ocena i tak porównuje złożone zdanie z `solution` | nowy typ `sentence_choice` |
| Liczba klocków | więcej niż słów w zdaniu (walidacja wymagała dotąd równości) | bez niepasujących słów wybór polega na zużyciu wszystkiego, a nie na przeczytaniu zdania | tyle klocków, ile słów |
| Skąd dystraktory | słówka tego samego działu, w języku odpowiedzi, losowane RAZ przy zakładaniu zadania | słowa z tej samej bajki wymagają przeczytania zdania; losowanie przy każdym wydaniu dałoby co wejście inne zadanie, czyli ćwiczenie zgadywania | losowanie przy wydawaniu zadania; słowa z całego kursu |
| Poziom rozsypanki | 1 (klikanie) | dziecko nie pisze ani jednej litery, a o to chodzi w poziomie 1 | zostawienie poziomu 2 — wtedy łatwy wariant też znikałby na poziomie 1 |
| Kto je tworzy | `build_sentence_order(lesson)` wołana wyzwalaczem po wstawieniu zadań + jednorazowo dla treści już w bazie | import wstawia zadania jednym poleceniem i nie musi nic o tym wiedzieć; nowa lekcja dostaje łatwe warianty sama | dopisywanie wariantów ręcznie w plikach treści (dziś 86 zdań); generowanie w locie przy wydawaniu lekcji (zadanie bez wiersza nie ma id, więc nie ma czego zapisać w próbach) |
| Gotowe zdanie | przycisk „Sprawdź" aktywny po dwóch klockach, nie po zużyciu wszystkich | przy dystraktorach „wszystkie klocki" znaczyłoby „zawsze źle" | wymaganie zużycia wszystkich klocków |

Do poprawionej treści (zmiana zdania w istniejącym zadaniu) wariantu nie dorabia nic — wyzwalacz
działa przy wstawianiu, nie przy edycji. Od tego jest `admin_add_sentence_order(lesson)`; na razie
bez przycisku w panelu.

### Rodzic poprawia dane dziecka (2026-11-15)

Imię dziecka wpisuje się raz, przy zakładaniu konta, i do tej pory nie było go gdzie poprawić:
polityka `profiles_update_own` puszcza do zapisu tylko własny wiersz, a dziecko nie ma w aplikacji
ekranu swojego profilu. Literówka zostawała na zawsze.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Jak zapisujemy | funkcja `admin_update_profile(uuid, text, text)` z `assert_admin()` | funkcja wylicza kolumny po nazwie, więc dołożenie kolumny do `profiles` niczego po cichu nie otwiera | polityka `profiles_admin` na UPDATE — otwiera administratorowi wszystkie kolumny z `grant update (...)`, dzisiejsze i przyszłe |
| Co wolno zmienić | imię i strefa czasowa | strefa rozstrzyga, o której dziecku zmienia się dzień, czyli kiedy wypada powtórka i czy wieczorna lekcja przedłuża serię | avatar i język interfejsu — nie ma ich dziś w żadnym ekranie, więc nie ma czego ustawiać |
| Sprawdzanie strefy | względem `pg_timezone_names`, przy zapisie | `now() at time zone 'Warszawa'` rzuca błędem dopiero w użyciu, czyli wywaliłoby dziecku start lekcji, a nie formularz rodzica | `check` na kolumnie (nie wolno w nim podzapytania); brak sprawdzania |
| Pusta strefa | znaczy „zostaw jak było" | kolumna jest `not null`, a pole w formularzu to lista wyboru — pusto wychodzi tylko przy błędzie | czyszczenie do wartości domyślnej |
| Lista stref | kilkanaście pozycji w komponencie plus obecna strefa dziecka | pełne `Intl.supportedValuesOf("timeZone")` to czterysta pozycji, a biblioteka stref w Node i w przeglądarce bywa innej wersji — lista rozjechałaby się przy uwodnieniu | pełna lista z `Intl`; wolne pole tekstowe |
| E-mail i hasło | zostają na ekranie `/admin/konta` | siedzą w `auth.users`, a tam sięga tylko `service_role`, którego w aplikacji webowej nie ma | wspólny formularz „konto i profil" |
| Poziom trudności | zostaje w swoim panelu, z `set_learner_level` | ma własny opis, co każdy poziom zmienia dla dziecka | wrzucenie poziomu do tego samego formularza |

### Trzy kwadraciki poziomów przy lekcji (2026-11-15)

Zastępuje politykę z wpisu „Poziom trudności zadań" tego samego dnia. Tamto rozwiązanie dobierało
trudność za dziecko (sufit z profilu + rampa z FSRS), więc dziecko nie miało jak sięgnąć po
trudniejsze zadanie, nawet gdy chciało, a dorosły musiał to przestawiać w panelu.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Kto wybiera trudność | dziecko, klikając jeden z trzech kwadracików pod lekcją | wybór jest na ekranie kursu, tam gdzie i tak patrzy; nic nie trzeba ustawiać w panelu | sufit w profilu i rampa z FSRS (dobierały za dziecko) |
| Co otwiera następną lekcję | wyłącznie poziom łatwy | dziecko ma iść dalej po materiale, a nie utknąć na trudnym; trudniejsze wejścia są dobrowolne | zaliczenie wszystkich trzech poziomów |
| Kiedy otwierają się średni i trudny | po zaliczeniu łatwego, oba naraz | najpierw poznanie słówek klikaniem; kaskada (trudny po średnim) robi trudny nieosiągalnym po jednej nieudanej próbie | od razu wszystkie trzy; kaskadowo |
| Ile materiału w trudniejszym wejściu | osiem losowych słówek lekcji, po jednym zadaniu na słówko | krótkie podejście, inne za każdym razem; cała lekcja na trudnym to pół godziny pisania | wszystkie słówka lekcji |
| Gdzie zapisuje się wynik | `lesson_level_progress` (tylko poziom 2 i 3); poziom łatwy zostaje w `lesson_progress` | postęp lekcji i odblokowania zostają takie jak były, a kwadraciki mają swój stan | kolumna `level` w `lesson_progress` (zmienia klucz główny i wszystkie widoki postępu) |
| Migawka zadań w sesji | tylko poziom łatwy; trudniejsze wejście jej nie zapisuje | zestaw jest losowany przy każdym wywołaniu, więc zapisana lista i tak nie byłaby tą, którą zobaczyła przeglądarka — dokładnie jak przy powtórce | losowanie raz i zapamiętanie w sesji (strona renderuje zadania przed założeniem sesji) |
| Kolory kwadracików | fiolet łatwy (jak etapy), błękit średni, bursztyn trudny | zieleń i koral są zarezerwowane na „dobrze" i „źle", a bursztyn ma własny ciemniejszy obrys, bo samo `--color-sun` na jasnym tle jest niewidoczne | zieleń/żółty/czerwony jako skala trudności |
| Układ na ekranie kursu | wszystkie kwadraciki w jednej linii, przyklejonej do dołu kafelka (`margin-top: auto`) | tytuły lekcji mają różną liczbę wierszy, więc bez tego kwadraciki stały w rzędzie na różnych wysokościach | kwadraciki tuż pod tytułem |

`profiles.level` i `set_learner_level` zostają w bazie i w panelu, ale nie filtrują już niczego —
usunięcie pola to osobna decyzja. Funkcje dobierające po sufucie (`visible_exercises`,
`allowed_exercise_level`, rampa) zostały usunięte, bo nikt ich już nie wołał.

### Listy w panelu jako tabele (2026-11-15)

Kursy, działy i lekcje były listami kart na całą szerokość, a pod każdą listą stał rozłożony
na stałe formularz „Nowy …". Przy czterech kursach ten formularz zajmował więcej miejsca niż
wszystkie kursy razem i to on przyciągał wzrok, choć zakłada się kurs raz, a listę czyta się
przy każdym wejściu. Panel jest ekranem dla dorosłego, nie dla dziecka — tu liczy się jedno
spojrzenie na całość, nie kafelek pod palec.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Postać listy | tabela (`.admin-table`), jeden wiersz na wpis | widać naraz wszystkie wpisy, ich liczniki i to, czy dziecko je widzi | karty (jeden wpis na ekran telefonu, trzy na monitorze) |
| Dodawanie | formularz rozwijany przyciskiem „➕ Dodaj …" nad tabelą | rzadka czynność nie zabiera miejsca częstej | formularz rozłożony na stałe; osobna podstrona „nowy …" (traci kontekst listy) |
| Poprawianie i kasowanie | w wierszu, pod ołówkiem i koszem | zmiana nazwy nie wymaga wchodzenia na podstronę wpisu; na podstronę wchodzi się po zawartość | tylko na podstronie wpisu |
| Ile wierszy rozwiniętych | najwyżej jeden, i najwyżej jedna rzecz w nim | każdy formularz ma wartości wzięte przy wejściu na stronę, więc kilka otwartych naraz kusi, żeby wpisać coś w dwóch, a zapisać jeden | wiele otwartych wierszy |
| Przyciski w wierszu | same ikony, nazwa w `aria-label` i w dymku | nazwy akcji przy sześciu kolumnach rozpychały tabelę poza kartę i połowa przycisku „Usuń" zostawała za krawędzią | ikona z napisem |
| Pole „Kolejność" | usunięte z formularzy działu i lekcji; numer jedzie ukrytym polem | kolejność zmienia się przeciągnięciem wiersza, a pole pokazywało wartość z chwili wejścia na stronę — zapis formularza cofał przestawienie | zostawienie pola obok przeciągania (dwa głosy o tym samym) |
| Kolumny na telefonie | liczniki i „widoczny" schowane (`hidden sm:table-cell`), stan „ukryty" jako chip pod nazwą | bez tego tabela rozpychała się poza kartę i strona przewijała się w poziomie | przewijanie tabeli w poziomie |
| Przeciąganie w tabeli | `SortableTable` trzyma w stanie same identyfikatory, nie wiersze | zawartość wiersza przychodzi z góry i zmienia się przy rozwinięciu formularza, więc odłożona kopia pokazywałaby poprzednią | trzymanie całych wierszy (jak w poprzednim `SortableRows`) |

Slug po zmianie: formularz z listy nie podaje `current_slug`, więc akcja nie przerzuca nigdzie —
adres strony z listą się nie zmienia. Podaje go formularz na podstronie wpisu, gdzie slug siedzi
w adresie i po zmianie trzeba przejść na nowy.

### Jedna szansa na poprawienie literówki (2026-11-15)

Pomyłka o jedną literę w zadaniu z pisaniem była po cichu zaliczana („Prawie! Zaliczone"),
a pomyłka o dwie — zwykłym błędem. Jedno i drugie uczy nie tego, co trzeba: przy zaliczeniu
dziecko nie dowiaduje się, że napisało słowo źle, a przy błędzie nie ma jak poprawić czegoś,
co prawie umie. Od teraz pierwsza bliska pomyłka wraca jako prośba o poprawkę, bez oceny.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Kiedy prośba | zadania z wpisywaniem, odpowiedź przyszła jako `text` | kafelka nie da się poprawić o literę — albo jest dobry, albo nie | druga szansa przy klikaniu i przy parach |
| Co to znaczy „bardzo nieduża pomyłka" | jedna litera przy słowie od czterech liter, dwie dopiero od siedmiu | przy krótkim słowie dwie litery różnicy to inne słowo, a nie potknięcie palca | stały próg dwóch liter (zgadywanie dostawałoby drugie podejście) |
| Ile razy | raz na zadanie w sesji | dalsze poprawki to już zgadywanka, nie nauka | bez ograniczenia; limit na całą lekcję |
| Kto liczy „ten jeden raz" | baza, w `lesson_sessions.retried_exercise_ids` | gdyby liczyła przeglądarka, odświeżenie strony dawałoby kolejne podejścia | stan w przeglądarce; pole w `attempts` |
| Ślad po prośbie | żaden: ani próba, ani punkty, ani ruch w powtórkach | prośba nie jest odpowiedzią, a zapisana psułaby trafność i liczbę odpowiedzi w statystykach | próba z flagą „do poprawki" |
| Co widzi dziecko | „Prawie! Zajrzyj w litery i popraw" nad polem, z wpisaną odpowiedzią | poprawia się literówkę, a nie pisze od nowa | wyczyszczone pole; pokazanie, która litera jest zła (to już przepisywanie) |

Po poprawce ocena jest normalna: jedna litera nadal przechodzi jako „prawie" (ocena 2 dla
harmonogramu powtórek), dwie to błąd. Werdykt z prośbą ma `retry: true` i nie niesie poprawnej
odpowiedzi — gdyby niósł, nie byłoby czego poprawiać.

### Podpowiedzi (2026-11-15)

Dziecko, które utknęło na zadaniu, miało dwa wyjścia: zgadywać albo pominąć (czyli dostać błąd
i cofnąć słówko w powtórkach). Podpowiedź jest trzecim: to samo słówko w łatwiejszej postaci.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Pula | pięć na dobę, liczone Z UŻYĆ w tabeli `hint_uses` | „ile dziś zużyto" wychodzi z zapytania, więc o północy w strefie dziecka pula odnawia się sama | licznik w `profiles` zerowany cronem (jedno nieudane uruchomienie i pula nie wraca; do tego strefa serwera zamiast strefy dziecka) |
| Doba | data z `profiles.time_zone`, tak samo jak seria dni | o północy u dziecka, nie w UTC — inaczej pula wracałaby w środku nocy albo w porze obiadu | `current_date` w UTC |
| Co robi podpowiedź | najpierw szuka łatwiejszego zadania do tego samego słówka w tej lekcji, a gdy go nie ma — upraszcza to, które jest (rozsypanka bez zbędnych klocków, cztery kafelki do dwóch) | na poziomie łatwym wszystko jest już na klikanie, więc bez uproszczenia podpowiedź byłaby tam martwa | pokazanie poprawnej odpowiedzi (dziecko przepisuje i nic nie zostaje w głowie) |
| Uproszczenie bez nowego wiersza | ten sam identyfikator zadania, inny payload | `solution` i `accepted` się nie ruszają, więc ocenianie i migawka sesji działają bez zmian | tworzenie nowego zadania w locie |
| Zamiana na inne zadanie | identyfikator zamiennika wchodzi do migawki sesji (`array_replace`, a gdy migawki nie ma — dopisanie) | bez tego `submit_attempt` odrzuciłby odpowiedź na zadanie, którego sesja nie wydała | luźniejsze sprawdzanie w `submit_attempt` (otwiera drogę do odpowiadania na cudze zadania) |
| Druga podpowiedź do tego samego zadania | nic nie kosztuje, oddaje ten sam zamiennik (`unique (user_id, session_id, exercise_id)`) | odświeżenie strony nie ma zjadać puli | liczenie każdego kliknięcia |
| Wpływ na powtórki | odpowiedź po podpowiedzi idzie z `hint_used = true`, czyli ocena najwyżej 2 | słówko wraca szybciej, bo dziecko go jeszcze nie umie | traktowanie jak zwykłej odpowiedzi |
| Zapis | tylko przez `use_hint`; tabela bez polityki INSERT | jak każda tabela postępu — dziecko nie dopisze sobie puli | polityka INSERT dla ucznia |

Przy okazji wyszło z tego `child_exercise(id)`: wycinanie kluczy odpowiedzi i tasowanie kolejności
było dotąd wyrażeniem wewnątrz `get_lesson_exercises`, a potrzebuje tego też `use_hint`. Dwie
kopie rozjechałyby się przy pierwszym nowym typie zadania.

### Tryb nauki: plansza ze słówkami (2026-11-15)

Dziecko wchodziło w lekcję, nie znając ani jednego słówka — pierwsze zadanie było jednocześnie
pierwszym spotkaniem ze słowem. Sowa 🦉 pod kafelkiem lekcji prowadzi teraz na planszę, na której
widać wszystkie słówka lekcji i można ich posłuchać, zanim zacznie się zadania.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Skąd plansza bierze słówka | zwykłe zapytania o `lesson_items`, `concepts` i `terms` | polityki `*_read` już wydają je dziecku dla lekcji otwartej i opublikowanej, a klucze odpowiedzi siedzą w `exercises`, których plansza nie rusza | nowa funkcja `security definer` `get_lesson_words()` (drugie wejście do tych samych danych, do rozjechania się przy pierwszej poprawce) |
| Dla których lekcji jest sowa | dla otwartych, nie-powtórkowych, mających słówka | polityka `lessons_read` i tak nie wydaje słówek lekcji zamkniętej, a powtórka nie ma własnych — składa się z przerobionych | sowa przy każdej lekcji (przy zamkniętej otwierałaby pustą planszę) |
| Czy plansza coś zapisuje | nie: ani próby, ani punktów, ani stanu powtórek | to oglądanie, nie odpowiadanie; wpisanie tego do FSRS zafałszowałoby harmonogram, bo dziecko nic tu nie przypomina sobie z pamięci | zaliczanie „obejrzanych" słówek jako powtórki |
| Co jest przyciskiem | cała karta słówka | dziecko dotyka tego, co widzi; przy sześciu kartach na tablecie celowanie w głośnik 3 rem w narożniku kończy się dotknięciem karty obok | głośnik obok słowa (jak w zadaniach) |
| Ile haków `useSpeak` | jeden na całą planszę | każdy zakłada nasłuch `voiceschanged`, więc dwadzieścia kart to dwadzieścia przerenderowań przy każdym doczytaniu głosów | `SpeakButton` na kartę (ma własny hak) |
| Wymowa pisana | `terms.ipa` pod słowem, jeśli jest | przy angielskim samo nagranie nie wystarcza dziecku, które już czyta — a kolumna jest w bazie od pierwszej migracji i dotąd nic jej nie pokazywało | brak zapisu fonetycznego |
| Słowo główne czy synonimy | samo główne (`is_primary`) | plansza ma pokazać jedną parę słów do zapamiętania; „ziemniak, kartofel" na kafelku dla sześciolatka to dwa słowa do nauczenia naraz | wszystkie poprawne odpowiedzi po przecinku (jak w panelu) |
| Nazwa dla czytnika ekranu | treść karty plus `sr-only` „Posłuchaj:" | gotowe `aria-label` z samym obcym słowem zasłoniłoby tłumaczenie, czyli połowę tej planszy | `aria-label="Posłuchaj: apple"` |
| Czytanie całej listy | następne słowo startuje z wywołania zwrotnego poprzedniego, po 0,7 s przerwy | `speechSynthesis` nie mówi, ile wypowiedź potrwa, więc stała przerwa dla wszystkich albo ucinałaby dłuższe słowa, albo kazała czekać po krótkich | `setInterval` co stałą liczbę sekund; kolejkowanie wszystkich wypowiedzi naraz (nie da się wtedy przerwać w środku ani pokazać, które słowo leci) |
| Przerwanie czytania | numer przebiegu w `useRef`, podbijany przy każdym przerwaniu | `cancel()` w części przeglądarek kończy wypowiedź zdarzeniem `onend` nie do odróżnienia od normalnego końca, więc bez tego lista jechałaby dalej po naciśnięciu „Przerwij" | flaga `boolean` (spóźnione wywołanie zwrotne z poprzedniego przebiegu i tak by ją zastało ustawioną) |

Dół kafelka na ekranie kursu (liczba słówek, sowa, kwadraciki postępu) jedzie w jednym bloku z
`mt-auto`, a miejsce po sowie zostaje puste tam, gdzie jej nie ma. Tytuły lekcji mają różną liczbę
wierszy, więc każdy z tych elementów osobno stał w sąsiednich kolumnach na innej wysokości.

### Test na koniec działu (2026-11-15)

Dział kończył się powtórką, czyli ćwiczeniem bez progu — dziecko przechodziło do następnego
działu niezależnie od tego, czy cokolwiek z poprzedniego mu zostało. Wartość `'test'` w enumie
`lesson_kind` stała nieużywana od pierwszej migracji. Teraz każdy dział ze słówkami ma na końcu
„Test działu", a zdany test otwiera dalsze działy.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Skąd zadania testu | po jednym na każde słówko działu, losowy typ, limit `test_limit()` = 15 | test sprawdza dział, a nie stan powtórek — bierze też słówka, których dziecko nigdy nie powtarzało (tym różni się od powtórki) | dobór jak w powtórce (po `srs_state`); zadania pisane ręcznie dla każdego działu |
| Skąd bierze się lekcja testu | wyzwalacz na `lesson_items`: pierwsze słówko w dziale zakłada test | gdyby test trzeba było dodać ręcznie, dział bez testu byłby stanem domyślnym i reguła „zdany test otwiera dział" nie znaczyłaby nic | tworzenie przy imporcie (omija działy z panelu); przycisk w panelu |
| Kiedy otwiera się test | gdy wszystkie opublikowane lekcje `standard` działu są zaliczone | test po połowie działu sprawdzałby materiał, którego dziecko jeszcze nie widziało | od razu; po zaliczeniu dowolnej lekcji (jak powtórka) |
| Co blokuje niezdany test | wszystkie dalsze działy kursu, nie tylko następny | inaczej dałoby się przeskoczyć dział, wchodząc od razu w trzeci | tylko następny dział |
| Dział bez słówek | nie dostaje testu i niczego nie blokuje | brak testu nie może być warunkiem nie do spełnienia | pusty test (zero zadań, więc nie do zdania) |
| Gdzie stoi zamek | `is_unit_unlocked` wołane z `is_lesson_unlocked` przed resztą reguł | zamknięty dział zamyka też swoją powtórkę i swój test — inaczej dałoby się wejść w dział bokiem, testem | sprawdzanie działu tylko przy zwykłych lekcjach |
| Próg zdania | próg lekcji, domyślnie 80% | ta sama reguła co w lekcji, nie ma czego tłumaczyć osobno | osobny, wyższy próg dla testu |

Zapis postępu nie wymagał zmian: `finish_lesson_session` pisze `lesson_progress` dla każdej
lekcji, niezależnie od rodzaju, więc zdany test jest zwykłym „completed" i to on jest
warunkiem w `is_unit_unlocked`.

Skutek dla kursów, które już istnieją: migracja dokłada test do każdego działu ze słówkami,
więc dziecko w połowie kursu zobaczy dalsze działy zamknięte, dopóki nie zda testów działów
wcześniejszych. To jest zamierzone — bez tego reguła nie dotyczyłaby żadnej istniejącej treści.

### Podpowiedzi w karcie ucznia (2026-11-15)

Dziecko widziało licznik w lekcji, dorosły nie widział nic — ani ile podpowiedzi poszło dziś, ani
od kiedy liczy się doba tego dziecka. A gdy pula skończyła się nie z jego winy (zepsute zadanie,
pomyłka w treści), nie było jak jej oddać inaczej niż zapytaniem SQL.

- **`hint_status(uczeń)` zamiast `hints_left()`**: tamta liczy dla tego, kto pyta, a tu pyta
  rodzic o cudze konto. Dostęp: własne konto albo administrator, nikt inny.
- **Reset kasuje wpisy z DZISIAJ, nie całą historię.** Wczorajsze użycia są zapisem nauki,
  a na dzisiejszą pulę i tak nie wpływają.
- **Data doby wypisana wprost w panelu.** Pula odnawia się o północy w strefie dziecka, która
  nie musi być strefą dorosłego patrzącego na ekran.
- **Pułapka w teście**: `hint_status` jest `stable`, więc w jednym poleceniu z kasowaniem
  widziałby jeszcze stan sprzed niego. Asercje muszą iść osobnymi poleceniami.

### Usunięcie kursu zależy od tego, czy ktoś go zaczął (2026-11-15)

„Usuń kurs" znaczyło dotąd zawsze to samo: kurs znikał razem z działami, lekcjami, słówkami
i postępami dzieci. Przy kursie, którego nikt nie tknął, ta ceremonia jest przesadzona; przy
kursie, który dziecko już robi, jedno kliknięcie kasuje historię nauki, serie dni i harmonogram
powtórek — a tego nie odtworzy żaden backup treści, bo to nie jest treść.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Co robi „Usuń" | kurs bez śladu nauki znika, kurs ze śladem schodzi na `is_published = false` | nieodwracalne zostaje tylko tam, gdzie nie ma czego stracić | zawsze kasowanie; zawsze ukrywanie (lista zarastałaby kursami do wyrzucenia) |
| Kto decyduje | baza, w `admin_delete_course` | przeglądarka nie zna śladów nauki, a formularz da się podstawić | wybór oddany administratorowi w panelu — to pytanie, na które baza zna odpowiedź |
| Co znaczy „zaczął" | `course_started`: sesja lekcji, wynik podejścia albo stan powtórek | każdy ślad powstaje w innym momencie; sesję da się skasować, a powtórki zostają | sam zapis na kurs (`enrollments`) — dziecko zapisane, które nic nie otworzyło, nic nie traci |
| Skąd panel wie z góry | `list_courses_started()`, jedno zapytanie na całą listę | „Usuń" musi mówić prawdę PRZED kliknięciem, inaczej kłamie w jedną albo w drugą stronę | sprawdzanie po fakcie, z komunikatu zwrotnego |
| Przepisanie sluga | tylko przy prawdziwym kasowaniu | ukrycie cofa się jednym odznaczeniem „Widoczne dla dzieci", więc kazanie przepisywać adres uczy klikać na ślepo | przepisywanie zawsze; brak przepisywania w obu przypadkach |
| Miękkie kasowanie | nie ma, wystarcza `is_published` | kolumnę `deleted_at` musiałoby omijać każde zapytanie o kursy, a `is_published` robi dokładnie to, o co chodzi | `deleted_at` i filtr w widokach |

## Rola rodzica (2026-11-15)

Rodzic ma wgląd w postępy swoich dzieci. Dzieci przypisuje administrator. Pierwotnie rola nie
dawała nic poza wglądem — od wpisu „Rodzic uczy się swoich kursów" (2026-11-16) rodzic robi też
własne lekcje, na tych samych zasadach co dziecko.

| Pytanie | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Gdzie mieszka rola | `app_private.parent_users` + claim `app_metadata.is_parent` | dokładnie jak przy administratorze: zero zapytań na „czy to rodzic", a użytkownik nie nada jej sobie sam | kolumna w `profiles` (uczeń ją zapisuje), osobna tabela w `public` (widoczna przez PostgREST) |
| Gdzie mieszka lista dzieci | tabela `app_private.parent_children`, **nie** claim | przypisanie dziecka ma działać od razu; claim odświeża się przy nowym tokenie, więc rodzic czekałby do godziny na dostęp | tablica dzieci w `app_metadata` razem z rolą |
| Jak czytają to polityki | `user_id in (select public.my_child_ids())` | podzapytanie nie zależy od wiersza, więc Postgres liczy je raz na zapytanie (InitPlan) | `is_parent_of(user_id)` — funkcja wołana dla każdego wiersza z osobna |
| Które tabele | dopisanie warunku do istniejących polityk `*_read` | jedna polityka na tabelę i cała reguła widoczna w jednym miejscu | drugi komplet polityk „dla rodzica" obok tych dla ucznia i administratora |
| `exercises` | **bez zmian, zamknięte** | leżą tam klucze odpowiedzi do całego kursu; jedno konto rodzica wystarczyłoby, żeby je wyciągnąć | otwarcie na równi z administratorem, żeby karta dziecka pokazywała poprawne odpowiedzi |
| Skąd rodzic bierze konto | zaproszenie z rolą `parent` albo nadanie roli istniejącemu kontu w panelu | obie drogi prowadzą do tego samego wiersza w `parent_users` | wyłącznie zaproszenie (nie da się awansować konta, które już istnieje) |
| Gdzie przypisuje się dzieci | w karcie rodzica, przełącznikami | rodziców jest dwoje, a dzieci kilkoro — krótsza lista do klikania i od razu widać, komu brakuje przypisania | wybór rodzica w karcie dziecka (dziecko może mieć dwoje rodziców, więc i tak nie jest to wybór jednego z listy) |
| Odebranie roli | kasuje też powiązania | rola odebrana z zostawionymi dziećmi to cicha furtka, gdyby nadać ją temu samemu kontu ponownie | zostawianie powiązań „na wszelki wypadek" |
| Zapis na kurs w zaproszeniu | pomijany dla roli `parent` — **zmienione**, patrz „Rodzic uczy się swoich kursów" (2026-11-16) | wówczas: rodzic dostałby pusty wiersz w `enrollments` i kafelek kursu na stronie, której nie ma po co otwierać | zapisywanie wszystkich tak samo |

Strona główna rozgałęzia się po claimie: rodzic widzi listę dzieci nad kafelkami swoich kursów,
a karta dziecka (`/dziecko/[id]`) nie sprawdza uprawnień sama — pokazuje to, co przepuści RLS.
Wejście pod adres cudzego dziecka kończy się komunikatem „Nie widzisz tego konta", bo zapytanie
o profil wraca puste. Druga bramka w kodzie mogłaby się z regułą w bazie rozjechać.

**Pułapka odkryta przy pisaniu:** `user_id = any ((select public.my_child_ids()))` nie działa,
gdy funkcja zwraca `uuid[]` — Postgres czyta `any (podzapytanie)` jako porównanie z wierszami,
nie z tablicą, i wywala się na `operator does not exist: uuid = uuid[]`. Funkcja zwraca więc
`setof uuid`, a polityki używają `in (select ...)`.

### Podpowiedź za ukończoną lekcję (2026-11-15)

Pula pięciu podpowiedzi na dobę traktowała tak samo dziecko, które przerobiło dziś trzy lekcje,
i takie, które weszło do aplikacji i od razu utknęło. Każda lekcja zaliczona danego dnia dokłada
do puli tego dnia jedną podpowiedź.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Skąd bierze się dokładka | liczona na bieżąco z `lesson_progress.completed_at` przez `hint_bonus(uczeń)` | to samo podejście, co przy zużyciu: stan wychodzi z tego, co w bazie już jest, więc nie ma czego przyznawać, cofać ani zerować o północy | kolumna `bonus_hints` w `profiles` dopisywana przy zaliczeniu lekcji (wymaga crona, którego cała mechanika podpowiedzi unika) |
| Co liczy się jako ukończona lekcja | pierwsze zaliczenie, po dacie `completed_at` w strefie dziecka | `finish_lesson_session` trzyma tę datę na `coalesce`, więc wpis powstaje raz; powtórka tej samej lekcji nie dokłada drugiej podpowiedzi | liczenie sesji skończonych dzisiaj (ta sama łatwa lekcja powtórzona pięć razy to pięć podpowiedzi) |
| Poziom średni i trudny | nie dokładają nic | to dobrowolna dokładka do lekcji już zaliczonej, a nie kolejna ukończona lekcja; inaczej jedna lekcja dawałaby trzy podpowiedzi | doliczanie `lesson_level_progress` |
| Gdzie doklejamy dokładkę | w `hints_left()`, obok limitu dziennego | wszystko, co liczy pulę, zostaje w jednym miejscu; `use_hint` i tak pyta tylko o `hints_left()` | osobne pole w `use_hint`; sprawdzanie limitu w przeglądarce |
| Kto może wywołać `hint_bonus` | nikt z zewnątrz (brak nadania dla `authenticated`) | `security definer` z cudzym `uuid` w argumencie pozwalałby policzyć, ile lekcji zrobiło dziś inne dziecko; wołają ją tylko `hints_left` i `hint_status`, które same pilnują konta | nadanie dla `authenticated` „dla wygody" |
| Skąd ekran podsumowania wie o dokładce | akcja `finishLesson` czyta `hints_left()` po zamknięciu lekcji, a ekran porównuje z pulą sprzed | dokładka nie jest niczym przyznawanym w `finish_lesson_session`, więc nie ma jej czego zwracać; różnica puli mówi dokładnie tyle, ile trzeba | dopisanie pola do odpowiedzi `finish_lesson_session` (przepisywanie 250-wierszowej funkcji po to, żeby policzyć to samo drugi raz) |
| Co widzi rodzic | `hint_status` zwraca `bonus` osobno od `limit` | w karcie ucznia „zostało 7" przy puli „5 na dobę" wygląda na pomyłkę, dopóki nie widać, skąd te dwie dodatkowe | sama liczba „zostało" |

## Prośba rodzica o przypisanie dziecka (2026-11-15)

Rodzic po zalogowaniu bez przypisanego dziecka czytał „poproś administratora" i musiał to zrobić
poza aplikacją. Teraz prośba zgłasza się sama.

| Pytanie | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Kiedy idzie prośba | po udanym logowaniu i po rejestracji z zaproszenia, wywołaniem `request_child_access()` | rodzic czyta na stronie, że administrator prośbę dostał — musi ją dostać w tej samej chwili, nie przy następnym logowaniu | wywołanie przy renderowaniu strony głównej (zapis przy każdym odświeżeniu, w tym przy prerenderze) |
| Kto decyduje, czy prośba ma sens | baza | funkcja odmawia kontu bez roli rodzica i kasuje prośbę rodzicowi, który dziecko już ma; przeglądarka nie musi tego wiedzieć, a podstawione wywołanie nic nie daje | warunek w aplikacji przed wywołaniem |
| Co to jest | jedna data przy koncie (`app_private.parent_requests`) | administrator ma wiedzieć „ten rodzic czeka i od kiedy", a nie odhaczać zgłoszenia | kolejka zgłoszeń ze stanem „załatwione", powiadomienia mailowe |
| Kiedy znika | w chwili przypisania pierwszego dziecka, wewnątrz `admin_set_child` | przypisanie JEST załatwieniem prośby; osobny przycisk „oznacz jako załatwione" to drugi stan, który rozjedzie się z pierwszym | ręczne kasowanie przez administratora |
| Gdzie widać | chip `⏳ czeka na dziecko` i data w wierszu konta | lista kont to miejsce, w którym administrator i tak przypisuje dzieci — osobny ekran zgłoszeń trzeba by pamiętać, żeby otworzyć | osobna strona „Prośby" w panelu |
| Powtórne wejście | `on conflict` odświeża `last_at`, `first_at` zostaje | to `first_at` mówi, jak długo rodzic czeka; gdyby nadpisywać, prośba sprzed tygodnia wyglądałaby na dzisiejszą | wstawianie nowego wiersza przy każdym logowaniu |

**Pułapka:** test `invitations.test.sql` liczy wszystkie zaproszenia w bazie (`count(*) = 1`),
więc wywraca się po ręcznym klikaniu w panelu na lokalnej bazie. To nie jest błąd kodu —
`npm run test:db` zakłada bazę świeżo po `npm run db:reset`.

### Średni poziom dorabiany do treści (2026-11-16)

Kwadracik średniego poziomu znikał przy całych lekcjach — na przykład przy „Classroom language",
gdzie wszystkie tłumaczenia mają gotowe kafelki (poziom 1), a jedyne zadania z pisaniem to trzy ze
słuchu (poziom 3). Średniego nie było ani jednego, więc nie było czym wypełnić wejścia.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Co to znaczy „średni" dla danego słówka | jedno słowo → wpisanie go; zdanie → ułożenie z klocków z dystraktorami | obie formy już są w aplikacji; brakowało ich w treści | jeden uniwersalny typ zadania na średni poziom |
| Kiedy dorabiamy | gdy słówko nie ma ŻADNEGO zadania poziomu 2 | nie dokładamy drugiego tego samego; lekcje z własnym średnim zostają nietknięte | dorabianie do każdego słówka |
| Rozsypanka dorobiona na średni | poziom ustawiony wprost na 2 | rozsypanka sama z siebie jest klikaniem, ale ta ma w klockach słowa niepasujące, więc wymaga przeczytania zdania | przeniesienie wszystkich rozsypanek z dystraktorami na poziom średni (lekcje, gdzie rozsypanka była jedynym łatwym zadaniem słówka, straciłyby poziom łatwy) |
| Kiedy odpala się generator | wyzwalacz WIĘZOWY `deferrable initially deferred`, czyli przy zatwierdzeniu transakcji | wyzwalacz na polecenie odpalał się w środku `admin_add_word`: po pierwszym `insert` słówko miało tylko wybór z kafelków, więc generator dorabiał czwarte zadanie chwilę przed tym, jak funkcja wstawiła własne tłumaczenie na polski — czyli ten właśnie średni | wyzwalacz na polecenie; wołanie generatora z `import_lesson` i `admin_add_word` (trzy funkcje do przepisania) |
| Pusty kwadracik zamiast dorabiania | odrzucone | rząd wygląda równo, ale dziecko dalej nie ma czego zrobić | — |

Pułapka dla testów: wyzwalacz więzowy odpala się przy zatwierdzeniu transakcji, a każdy test
pgTAP siedzi w jednej transakcji i kończy się `rollback`. Test, który sprawdza dorobioną treść,
musi wywołać generator wprost albo zrobić `set constraints all immediate`.

### Gwiazdki etapów nad kwadracikami (2026-11-16)

Przy kafelku lekcji stoi jedna ocena całej lekcji i łatwo ją wziąć za ocenę ostatniego etapu.
Gwiazdki pojedynczych etapów leżały w `lesson_stage_progress` od migracji z etapami i nic ich
nie pokazywało — dziecko widziało dwie gwiazdki przy lekcji i nie miało z czego wyczytać,
w którym etapie zgubiło trzecią.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Co znaczy gwiazdka przy kafelku | ocena CAŁEJ lekcji: średnia z najlepszych wyników wszystkich etapów, zapisywana po zamknięciu ostatniego i tylko w górę | to ona idzie do statystyk i do karty u rodzica, i tylko ona jest porównywalna między lekcjami | ocena ostatniego etapu (dziecko poprawiałoby jeden etap i dostawało trzy gwiazdki za całość) |
| Czy zostaje obok etapowych | zostaje | odpowiada na inne pytanie: „jak dobrze umiem tę lekcję", a nie „który etap powtórzyć" | zastąpienie jej gwiazdkami etapów |
| Skąd dane na ekranie kursu | zapytanie wprost do `lesson_stage_progress` z filtrem po użytkowniku | tabela ma politykę odczytu dla ucznia, więc nie trzeba migracji ani nowego widoku | nowy widok `v_my_lesson_stages` (migracja za jedno zapytanie); dopisanie tablicy gwiazdek do `v_my_lessons` |
| Dlaczego filtr po użytkowniku, skoro jest RLS | bo polityka przepuszcza też administratora (`is_admin()`) | bez filtru na ekranie administratora zmieszałyby się podejścia różnych dzieci | poleganie na samym RLS (ta sama poprawka poszła do ekranu lekcji, gdzie decydowała o tym, od którego etapu zaczyna się lekcja) |
| Czym rysujemy gwiazdkę | znak `★` w pudełku o stałej szerokości 0,625 rem | „★" ma w każdym kroju inną szerokość, a od niej zależy, czy rząd mieści się w kafelku; emoji `⭐` w tym rozmiarze jest plamą | emoji `⭐` jak przy kafelku; tekst bez pudełka |
| Puste gwiazdki na obrys | odrzucone | przy trzech etapach to dziewięć znaczków pod jednym kafelkiem | — |
| Szerokość kafelka lekcji | 9,5 rem → 11,5 rem | rząd gwiazdek jest szerszy od kwadracika; najgorszy przypadek (trzy etapy po trzy gwiazdki i dwa poziomy) ma 160 px przy 164 px miejsca | ściśnięcie gwiazdek do szerokości kwadracika (8 px na gwiazdkę, czyli kropka) |
| Wyrównanie rzędu | `align-items: flex-end` w `.marks` | kolumna etapu jest wyższa od kwadracika poziomu, a dolna krawędź ma iść przez cały rząd jedną linią | wyrównanie do środka (kwadraciki poziomów wisiałyby w połowie wysokości etapu) |
| Czytnik ekranu | jeden `role="img"` z podpisem „Zrobione etapy: 2 z 3; etap 1 — 3 gwiazdki, …", dymek nad każdym etapem | dziewięć osobnych gwiazdek to dziewięć bezużytecznych ogłoszeń | podpis na każdej gwiazdce |

Dopisane tego samego dnia: gwiazdki dostały też kwadraciki poziomu średniego i trudnego
(`v_my_lesson_levels` wydaje `stars`, więc bez nowego zapytania), a sam kwadracik etapu stał się
odnośnikiem do tego etapu (`?etap=N`) — wcześniej kursor nie zmieniał się w łapkę, bo nie było
czego kliknąć, choć poziomy obok już były odnośnikami. Wspólna kolumna „gwiazdki nad
kwadracikiem" nazywa się `.mark-col` i obsługuje jedno i drugie; kafelek lekcji urósł do 12 rem
(najgorszy przypadek: pięć kwadracików po trzy gwiazdki, 166 px przy 172 px miejsca).
Gwiazdki poziomu pokazujemy także przy wejściu zaczętym, a niezaliczonym — baza zapisuje
najlepszy wynik z podejść, więc „dwie gwiazdki nad kwadracikiem w połowie" to prawda, nie usterka.

### Administrator uczy się jak dziecko (2026-11-16)

`is_lesson_unlocked` oddawało administratorowi „otwarte" dla każdej lekcji, a wydawanie zadań
i start sesji wpuszczały go też do lekcji przed publikacją. Miało to służyć podglądowi z panelu,
ale działało wszędzie: administrator wchodzący na ekran kursu jak każdy uczeń miał cały kurs
otwarty — bez warunków wstępnych i bez testów działów. Nie dało się wtedy ani sprawdzić, co
dziecko naprawdę zobaczy, ani uczyć się razem z nim na tych samych zasadach.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Kiedy obejście działa | tylko gdy przeglądarka poprosi wprost: `p_preview` w `get_lesson_exercises` i `start_lesson_session` | widać w sygnaturze, że funkcja ma dwa tryby, i widać w kodzie strony, który tryb wybiera | obejście po samym `is_admin()` (było); nagłówek albo `set_config` (tryb niewidoczny w wywołaniu) |
| Kto może o nie poprosić | i tak tylko administrator — `p_preview and public.is_admin()` | parametr przychodzi z przeglądarki, więc nie może sam z siebie niczego otwierać | zaufanie parametrowi |
| Skąd się bierze | link „Zobacz lekcję oczami dziecka" w panelu, `?podglad=1` | to jedyne wejście, które ma być podglądem; wejście z ekranu kursu jest nauką | osobny adres `/podglad/[id]` (drugi raz ten sam ekran do utrzymania) |
| Co z zamkami w podglądzie | omija zamek lekcji, zamek działu, poziom i brak publikacji | po to jest: zobaczyć etap albo lekcję, której dziecko jeszcze nie otworzyło | omijanie tylko publikacji (nie dałoby się obejrzeć etapu za kłódką) |
| Jak to widać na ekranie | chip „👀 Podgląd" na pasku lekcji | bez tego administrator nie odróżnia „lekcja jest otwarta" od „wszedłem tylnymi drzwiami" | nic nie pokazywać |
| Postęp i punkty | zapisują się jak dotąd, na koncie pytającego, także w podglądzie | to jego własne konto, więc niczyjej nauki nie dotyka; podgląd zmienia dostęp, nie księgowanie | kasowanie postępu po podglądzie (nie da się odróżnić, co powstało w podglądzie) |

To zmiana polityki wobec wpisu z 2026-11-15, w którym administrator dostawał otwarte wszystko
w `is_lesson_unlocked`. Reguła „patrząc na cudzy postęp, administrator widzi kłódkę dziecka"
zostaje bez zmian — funkcja pyta o postępy tego użytkownika, o którego pyta.

### Kolejność zadań w lekcji (2026-11-16)

Pliki treści są pisane typami: najpierw wszystkie tłumaczenia w jedną stronę, potem w drugą,
potem dopasowanki, na końcu zdania z luką. `admin_import_lesson` nadaje `sort_order` po kolejności
w pliku, a poziom łatwy wydawał zadania dokładnie w tej kolejności — więc dziecko dostawało
czternaście tłumaczeń z rzędu. Przy lekcji podzielonej na etapy bywało, że cały etap był jednym
typem zadania.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Gdzie mieszamy | w `get_lesson_exercises`, przy wydawaniu | `sort_order` zostaje kolejnością z pliku, czyli tym, co administrator widzi w panelu i co sam ustawiał | przestawienie `sort_order` w tabeli (panel pokazywałby lekcję w rozsypce, a następny import i tak wróciłby do układu typami) |
| Czym mieszamy | `exercise_order(uuid)` — md5 identyfikatora zadania przerobiony na liczbę | wygląda losowo, nie ma nic wspólnego z typem, a dla danego zadania jest zawsze taka sama | `order by random()` przy każdym wydaniu |
| Dlaczego nie `random()` | lekcja pyta o zadania dwa razy: raz renderuje je strona, raz zapisuje migawkę `start_lesson_session` | przy losowaniu per wywołanie obie listy byłyby inne, a w lekcji z etapami różniłby się nawet ZBIÓR zadań etapu — czyli błąd „Zadanie należy do innego etapu lekcji", przed którym migawka miała chronić | — |
| Czy kolejność zależy od dziecka | nie | wtedy `exercise_stage` musiałoby czytać `auth.uid()` i dwa wywołania z różnych kontekstów (podgląd administratora, skrypt) dawałyby inny podział na etapy niż ten, który zobaczyło dziecko | ziarno z identyfikatora dziecka (rodzeństwo dostaje inną kolejność — zysk za mały wobec kosztu) |
| Przeplatanie typów po równo | odrzucone | sztuczny rytm: dziecko szybko się uczy, że po tłumaczeniu zawsze jest dopasowanka | — |
| Poziom średni i trudny | zostają na `order by random()` z `pick_level_exercises` | nie mają ani etapów, ani migawki sesji, więc losowanie przy każdym wywołaniu niczego nie rozjeżdża | ujednolicenie z poziomem łatwym |

Prawdziwa losowość przy każdym podejściu wymagałaby, żeby listę zadań wydawała sesja, a nie
osobne zapytanie strony — czyli przestawienia kolejności wywołań w ekranie lekcji.

## Bramka zaległych powtórek (2026-11-16)

Powtórki dotąd nikogo nie pilnowały. Dziecko widziało na stronie „🔁 14", wchodziło w nową lekcję
i uczyło się dalej, a kolejka zaległych rosła — czyli działo się dokładnie to, przed czym FSRS ma
chronić: nowe słówka dochodziły, stare wypadały z głowy.

Od teraz kurs ma bramkę: dziesięć zaległych słówek zamyka wszystkie lekcje kursu (razem
z powtórkami i testami działów), a otwarty zostaje jeden kafelek — „Test powtórkowy" ułożony
z zaległych słówek. Zdany test, próg lekcji jak wszędzie (80%), otwiera kurs do końca dnia.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Gdzie liczymy zaległe | w całym kursie | licznik, który dziecko i rodzic widzą, jest dla kursu; przy liczeniu per dział dziecko z sześcioma zaległymi w jednym dziale i siedmioma w drugim nie byłoby blokowane nigdzie, a zapomniało trzynaście słówek | per dział oraz globalnie dla konta (dwa kursy blokowałyby się wzajemnie) |
| Co znaczy „zaległe" | `due_on <= dziś` i słówko ma aktywne zadanie | słówko bez zadania nie weszłoby do testu, więc liczone podnosiłoby próg, którego nie da się zbić — bramka byłaby ścianą bez drzwi | samo `due_on <= dziś` (jak w `v_my_stats.words_due`) |
| Co zdejmuje blokadę | zdany test powtórkowy, do końca dnia w strefie dziecka | po dłuższej przerwie zaległych bywa czterdzieści, a test obejmuje dwanaście; gdyby blokada patrzyła tylko na licznik, dziecko dostawałoby test za testem i nie doszłoby do lekcji ani razu | zerowanie całej kolejki po zdanym teście (słówka, których w teście nie było, dostałyby termin wzięty z powietrza — FSRS przestaje wtedy cokolwiek znaczyć) |
| Raz podjęty test trzeba zdać | dokończony i oblany test zamyka kurs do czasu zdania, już niezależnie od licznika | patrz pułapka niżej: licznik spada po oblanym teście tak samo jak po zdanym | sama reguła licznikowa (dwanaście pustych odpowiedzi otwierało kurs) |
| Wyjątek od zatrzasku | brak zaległych słówek z zadaniem puszcza bramkę | dziecko, które oblało test obejmujący całą kolejkę, zostałoby z zamkniętym kursem i pustym testem | zatrzask bez wyjątku |
| Porzucona sesja testu | nie zatrzaskuje (liczy się tylko dokończona) | zerwane połączenie i zamknięta karta to nie oblany test | każde wejście w test |
| Czym jest test powtórkowy | zwykłą lekcją `kind = 'review'` z nową kolumną `review_scope_course_id` | cały silnik (sesja, próby, punkty, postęp) wisi na `lessons.id`, a `kind = 'review'` ma już dobór zadań ze stanu powtórek, wymuszony poziom łatwy i pustą migawkę zadań | nowa wartość `review_test` w `lesson_kind` (osobna migracja na sam enum i gałąź w dwóch największych funkcjach bazy, bez żadnego zysku) |
| Gdzie wisi | w pierwszym dziale kursu, a na ekranie kursu osobno nad działami | `lessons.unit_id` jest wymagane, a pierwszy dział nigdy nie jest zamknięty testem poprzedniego; między kafelkami działu wyglądałby na jego lekcję | osobny „dział techniczny" na kurs (pusty nagłówek na ekranie dziecka) |
| Ile słówek w teście | najwyżej `review_limit` (12), najdłużej zaległe pierwsze | tyle, co zwykła powtórka — test ma być jednym podejściem, a nie odrabianiem czterdziestu słówek pod rząd; kolejność po terminie, bo inaczej przy równym priorytecie wchodziłyby stale te same słówka (decyduje wtedy identyfikator zadania) | `test_limit` (15) oraz cała kolejka naraz |
| Kto zakłada test | wyzwalacz `lesson_items_review_test` przy pierwszym słówku kursu + dosyp dla kursów, które już mają słówka | tak samo jak test działu: kurs bez testu nie może być stanem domyślnym, bo wtedy reguła nie dotyczy niczego | zakładanie ręcznie w panelu |
| Powtórka działu | zostaje bez zmian: bierze wszystko, co dziecko w dziale widziało, i nie ma progu | jest ćwiczeniem do woli, a nie bramką; blokadę zdejmuje wyłącznie test kursu | podniesienie powtórki działu do roli bramki (dziecko musiałoby trafić w ten dział, w którym uzbierały się zaległości) |

### Pułapka: oblany test też obniża licznik zaległych

Pierwsza wersja reguły brzmiała „bramka stoi, dopóki zaległych jest dziesięć albo więcej, a zdany
test ją zdejmuje do końca dnia" — i test pgTAP od razu pokazał, że to nie trzyma się kupy. BŁĘDNA
odpowiedź też przesuwa termin słówka: FSRS wyznacza po wpadce krótki odstęp, ale liczony w dniach,
więc najbliższy termin wypada jutro. Po oblanym teście licznik spadał dokładnie tak samo jak po
zdanym, czyli dwanaście odpowiedzi „nie wiem" otwierało kurs.

Stąd zatrzask: jeśli dziecko dziś dokończyło test powtórkowy i go nie zdało, kurs zostaje
zamknięty do czasu zdania. Test `review_gate.test.sql` pilnuje obu końców tej reguły — że oblany
test nie otwiera kursu, CHOĆ licznik już nie wystarcza, i że zdany otwiera, CHOĆ zaległych zostało
więcej niż dziesięć (to drugie na drugim dziecku w tym samym kursie, żeby stany się nie mieszały).

### Ustawienia aplikacji w panelu (2026-11-16)

Czas automatycznego przejścia do następnego zadania siedział jako stała w kodzie przeglądarki,
więc skrócenie go z dziesięciu sekund na sześć wymagało wdrożenia. To akurat ustawienie, którego
właściwej wartości nie da się wymyślić przy biurku — widać ją dopiero przy dziecku. Stąd osobna
sekcja „Ustawienia" w panelu i tabela, z której czyta lekcja.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Gdzie mieszka ustawienie | tabela `app_settings`, klucz + `jsonb` | następne pokrętło to wiersz, nie migracja zmieniająca kształt tabeli i wszystkie zapytania | kolumna na ustawienie; tabela na ustawienie; zmienna środowiskowa (zmiana = wdrożenie, czyli to, co usuwamy) |
| Kto zapisuje | wyłącznie `admin_set_setting` (`security definer`), brak polityki INSERT/UPDATE | tak samo jak w tabelach postępu: zapis przez funkcję, nie przez politykę | polityka UPDATE dla administratora |
| Kto czyta | każdy zalogowany | przeglądarka dziecka musi znać czas odliczania, a nie ma tu nic wrażliwego | odczyt tylko funkcją |
| Gdzie sprawdzany jest zakres | w `admin_set_setting` (2–30 s), i drugi raz zodem w akcji panelu | `jsonb` przyjmie wszystko, a pokrętło na zero albo na dziesięć minut psuje lekcję; zod jest po to, żeby dorosły zobaczył komunikat przy polu | sprawdzanie tylko w przeglądarce; `check` na kolumnie (nie wyrazi reguły per klucz) |
| Wartość domyślna | 6 s, ta sama w `setting_int`, w lekcji i w panelu | brakujący wiersz nie może dawać innego czasu na ekranie dziecka niż w panelu | `null` i „brak odliczania" |
| Co z brakiem wiersza albo śmieciem w `value` | `setting_int` oddaje wartość domyślną | awaria ustawień nie ma zatrzymywać lekcji w połowie | wyjątek |

Zakres 2–30 s: poniżej dwóch sekund dziecko nie zdąży zobaczyć „Brawo!", powyżej trzydziestu
to już nie jest automatyczne przejście, tylko zawieszony ekran. Licznik i tak przestawia się
przy każdym dotknięciu, a po błędnej odpowiedzi nie rusza w ogóle.

### Wybór obrazka zawsze na cztery kafelki (2026-11-16)

Zadania „Wskaż obrazek" w treści miały po trzy obrazki. Siatka odpowiedzi ma dwie kolumny, więc
trzeci kafelek stał sam w drugim rzędzie, a strzał w ciemno trafiał co trzeci raz.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Ile obrazków | cztery | pełne dwa rzędy po dwa i o jedną czwartą mniejsza szansa trafienia na oślep | pięć i więcej (nie mieści się na telefonie bez przewijania, czyli bez zgadywania w ciemno) |
| Gdzie zapisana reguła | `CLAUDE.md`, przy konwencjach treści | to reguła dla generowanej treści, a nie niezmiennik bazy | — |
| Czy walidacja ma wymusić cztery | nie, zostaje „od dwóch do czterech" | lekcja może nie mieć czwartego sensownego obrazka, a import ręcznej lekcji nie ma się o to wywracać; przy generowaniu pilnuje tego reguła, nie schemat | `z.array(...).length(4)` w schemacie importu |
| Skąd czwarty obrazek | z obrazków, które ta lekcja i tak ma w słówkach | są już w buckecie, więc nic nie trzeba dogrywać; przy liczbach dobrany blisko (30 → 40), przy kolorach mylący (brązowy → pomarańczowy) | nowe pliki graficzne |

### Statystyki całej aplikacji w panelu (2026-11-16)

Dorosły miał statystyki jednego dziecka (karta ucznia) i statystyki swojego konta, ale nie miał
nic, co pokazuje całość: czy w ogóle ktoś się uczy, który kurs stoi, na czym dzieci się
przewracają. Sekcja „Statystyki" w panelu liczy to pięcioma widokami.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Kto liczy | baza, widoki `v_stats_*` | grupowania po dniach ani sum nie da się poprosić przez PostgREST, a liczenie w przeglądarce znaczy ściągnięcie historii odpowiedzi wszystkich dzieci | liczenie w aplikacji; materializowane widoki (statystyki mają być świeże po lekcji, nie po odświeżeniu) |
| Jak działa zakres | `security_invoker` — widok pokazuje to, co widzi pytający | polityki RLS już dopuszczają administratora do wszystkiego, a rodzica do jego dzieci; druga ścieżka (`security definer` + `is_admin()`) rozjechałaby się po pierwszej poprawce — ta sama decyzja co przy `v_my_*` | osobne funkcje `admin_stats_*` |
| Co pokazują słupki kursu | lekcje zaliczone przez wszystkie dzieci razem | to miara przerobionego materiału kursu, a nie postępu jednego dziecka — od tego jest karta ucznia | średni postęp dziecka (kurs z jednym pilnym dzieckiem wyglądałby na skończony) |
| Celność po typie zadania | osobny widok, lista sortowana od najgorszej | typ z celnością 30% to zwykle błąd w treści zadania, a nie trudny materiał; ta lista jest po to, żeby go znaleźć | celność tylko łącznie |
| Trudne słówka | suma `lapses` z `srs_state`, nie z odpowiedzi | w `srs_state` pomyłka jest już policzona raz na dziecko i słówko, więc nie trzeba przeliczać historii | liczenie z `attempts` |
| Czym rysujemy | te same ręczne klocki co u dziecka (`stats-widgets`), słupki poziome | biblioteka wykresów to kilkaset kilobajtów na jedną stronę panelu; poziome słupki, bo podpisy są pełnymi nazwami lekcji i kursów | biblioteka wykresów; pionowe słupki z podpisami bokiem |

Widoki są dostępne dla każdego zalogowanego i to jest celowe: dziecko zobaczy w nich swoje
własne liczby, rodzic liczby swoich dzieci. Test pgTAP sprawdza właśnie tę własność — gdyby
`security_invoker` kiedyś z nich zniknęło, dziecko zobaczyłoby w przeglądarce dane wszystkich.

### Biblioteka mediów zamiast wgrywarki (2026-11-16)

Strona „Obrazki" była wgrywarką bez pamięci: wgrywała pliki i pokazywała ścieżki do skopiowania,
a po odświeżeniu nie było widać nic. Bucket rósł w nieskończoność, nie dało się sprawdzić, co
w nim leży ani niczego skasować, a obrazek do słówka dało się przypiąć wyłącznie plikiem importu.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Skąd lista plików | `storage.list()` po katalogach, przy każdym wejściu na stronę | Storage jest źródłem prawdy o plikach; własna tabela-rejestr rozjechałaby się przy pierwszym wgraniu spoza panelu | tabela z rejestrem plików obok Storage |
| Czy wolno kasować użyty plik | wolno, ale z ostrzeżeniem i zgodą w checkboksie | czasem właśnie o to chodzi, że obrazek był zły; zakaz zmuszałby do ręcznego sprzątania treści najpierw | zakaz kasowania użytych; kasowanie kaskadowe (znika plik razem z zadaniem) |
| Skąd wiadomo, że jest użyty | `media_usage(text[])` — jedno zapytanie na całą listę | przy zapytaniu na plik byłoby ich tyle, ile obrazków w bibliotece | liczenie w aplikacji; brak ostrzeżenia |
| Co liczy się jako użycie | `concepts.image_path`, `options`, `answer` i `audioPath` w zadaniach | to wszystkie miejsca, w których ścieżka trafia do treści; dystraktor zadania liczy się tak samo jak odpowiedź, bo skasowany zostawi pustą kratkę | tylko obrazek słówka |
| Kasowanie | Server Action, nie przeglądarka | lista odświeża się sama; polityka na `storage.objects` i tak przepuszcza tylko administratora | kasowanie klientem Supabase z przeglądarki |
| Obrazek przy słówku | `admin_set_concept_image` + pole w formularzu słówka na stronie lekcji | dotąd jedyną drogą był import, więc poprawiając słówko w panelu nie dało się dołożyć mu obrazka | wybór z galerii w oknie (osobny komponent do utrzymania; ścieżkę i tak widać w bibliotece) |

Puste pole odpina obrazek od słówka, ale nie kasuje pliku — plik może być używany gdzie indziej,
a sprzątanie bucketa jest osobną czynnością, robioną w bibliotece.

## Każde słówko na każdym poziomie (2026-11-16)

W panelu przy słówkach lekcji stało „zadań: 1", „2", „4" — i to nie był tylko nierówny widok.
Słówko bez zadania poziomu łatwego wchodziło do lekcji tylko regułą ratunkową, bez średniego
wypadało z wejścia na średni, bez trudnego — z trudnego. Dziecko klikało kwadracik „trudny"
i dostawało osiem słówek z całej lekcji, bo tylko tyle miało tam jakiekolwiek zadanie.

Obowiązują teraz dwie zasady: **każde słówko ma zadanie na każdym z trzech poziomów**, a słówko
z kilkoma zadaniami jednego poziomu wchodzi do lekcji **raz**, losowo wybranym wariantem.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Skąd biorą się brakujące zadania | dorabia je baza: `build_easy_variants` (wybór z listy), `build_medium_variants` (wpisywanie albo rozsypanka), `build_hard_variants` (ze słuchu) | tak samo jak dotąd dorabiał się sam poziom średni; treść pisana ręcznie nigdy nie będzie kompletna na trzech poziomach dla kilkuset słówek | dopisywanie zadań do plików treści (dziesiątki lekcji, a następny import i tak wraca do stanu wyjściowego) |
| Źródło treści nowego zadania | słownik (`terms`), nie istniejące zadanie | słówko, które ma w lekcji wyłącznie zadanie ze słuchu, nie ma z czego zrobić wyboru z listy metodą „weź tłumaczenie i zabierz mu kafelki" | przepisywanie istniejącego zadania (nie działa dla słówek z jednym zadaniem nietłumaczeniowym) |
| Kiedy dorabiamy | wyzwalacz więzowy `exercises_variants`, odroczony do końca transakcji + jednorazowy przebieg po całej bazie | lekcja jest wtedy kompletna; w środku `admin_add_word` generator widziałby słówko z jednym zadaniem i dorabiał czwarte tuż przed tym, jak funkcja wstawi własne | wyzwalacz na polecenie (dorabia za wcześnie), generowanie przy wydawaniu lekcji (zadanie bez wiersza nie ma id, nie ma czego zapisać w próbach) |
| Język bez głosu | słówko zostaje na dwóch poziomach | bez `languages.tts_lang` nie ma czego odsłuchać, a zmyślone zadanie trudne byłoby kopią średniego z inną etykietą; panel pokazuje wtedy kreskę w kolumnie „Zadań" | sztuczne zadanie trudne dla każdego słówka |
| Ile zadań słówka wchodzi do lekcji | jedno, losowane z wariantów danego poziomu | lekcja z dwudziestoma słówkami po trzy zadania to sześćdziesiąt zadań pod rząd, a to samo słówko wracało w jednym etapie kilka razy | wszystkie warianty w jednym przejściu (tak było) oraz jeden wariant na etap, reszta w kolejnych etapach (lekcja dalej trwa trzy razy dłużej) |
| Czym losujemy | `variant_pick`: md5 z pary (zadanie, dziecko, dzisiejsza data w jego strefie) | lekcja pyta o zadania DWA razy — raz renderuje je strona, raz zapisuje migawkę `start_lesson_session`; przy `random()` obie listy byłyby inne i dziecko dostawałoby „To zadanie nie było w tym etapie lekcji". Ziarno z doby daje jeden wynik przez cały dzień, a jutro inny | `random()` przy każdym wywołaniu; ziarno z numeru podejścia (rośnie po KAŻDYM etapie, więc zestaw zmieniałby się w środku lekcji) |
| Którego poziomu dotyczy reguła „raz" | poziomu łatwego, bo on JEST lekcją | średni i trudny i tak biorą osiem słówek po jednym zadaniu (`pick_level_exercises`), a `lesson_exercises_at_level` odpowiada tam na inne pytanie: ile zadań tego poziomu lekcja ma (z tego bierze się kwadracik na ekranie kursu) | jedno na słówko na każdym poziomie (kwadracik na ekranie kursu przestałby pokazywać, ile treści naprawdę jest) |

### Co trzeba było poprawić w testach

Reguła „jedno zadanie na słówko" zmienia to, co wydaje etap, więc pięć plików pgTAP przestało
przechodzić — każdy z nich podstawiał do `submit_attempt` zadanie wybrane po typie, a takie
zadanie zwykle nie jest już tym, które etap wydał. Poprawka jest wszędzie ta sama i robi testy
przy okazji odpornymi: plik zostawia w lekcji tylko te zadania, które sam ocenia
(`typo_retry`, `word_order_retry`, `skip_exercise`, `answers`). W `lessons.test.sql`, który
sprawdza silnik lekcji zadanie po zadaniu, każde zadanie dostaje własne słówko — inaczej nie
dałoby się w jednym przejściu sprawdzić czterech różnych typów należących do tego samego słówka.

### Prośba o dostęp do kursu (2026-11-16)

Strona główna wypisywała dziecku wszystkie opublikowane kursy, ekran kursu nie pytał o zapis,
a polityka `enrollments_insert_own` pozwalała zapisać się samemu. Zapis istniał, ale nie znaczył
nic poza statystykami. Teraz zapis jest warunkiem nauki, a kurs bez zapisu dziecko widzi tylko
z nazwy — z przyciskiem prośby zamiast strzałki.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Gdzie stoi bramka | `is_lesson_unlocked` | pod nią siedzą `get_lesson_exercises`, `start_lesson_session` i ekran kursu — jedno miejsce zamiast polityk na czterech tabelach | polityka SELECT na `courses` ograniczona do zapisanych (dziecko nie zobaczyłoby nazw, więc nie miałoby o co poprosić, a rodzic straciłby kursy dziecka z `v_my_courses`) |
| Kto zakłada zapis | administrator albo zaproszenie | o tym, czy czwartoklasista bierze się za włoski, decyduje dorosły; wyzwalacz z zaproszenia jest `security definer`, więc działa dalej | `enrollments_insert_own` (zostawienie go znaczyłoby, że bramka jest ozdobą) |
| Czym jest prośba | para (dziecko, kurs) z datą, kasowana wyzwalaczem w chwili zapisu | to ten sam wzorzec, co `parent_requests`: ślad przy uczniu, nie kolejka zgłoszeń do odhaczenia | osobny stan „rozpatrzona/odrzucona" (druga maszyna stanów do utrzymania); powiadomienie mailem (nie mamy wysyłki) |
| Co z dziećmi, które już się uczą | zapisy wsteczne w migracji, z trzech śladów nauki | zapis miał dotąd zbyt małe znaczenie, żeby zakładać, że jest wszędzie tam, gdzie jest nauka — bez tego bramka zamknęłaby kursy robione dzisiaj | ogłoszenie „poproś o dostęp" także tym, którzy kurs już robią |
| Administrator | te same zasady, zapisuje się w panelu | uczy się na zasadach dziecka (`…_admin_learns_as_child.sql`), więc i jemu kurs bez zapisu jest zamknięty; przycisk prośby zamieniamy mu na odnośnik do panelu | wyjątek dla administratora w bramce (wtedy nie widzi tego, co widzi dziecko) |
| Gdzie administrator widzi prośby | lista nad tabelą kursów i znacznik przy uczniu w kursie | bez listy trzeba by wejść w każdy kurs po kolei, żeby się dowiedzieć, że ktoś czeka | osobny ekran „prośby" (trzeci ekran, który trzeba znaleźć) |

Testy, które wydawały zadania, musiały dostać zapis w scenariuszu — bez niego lekcja jest
zamknięta, zanim zacznie się to, co sprawdzają. To nie jest koszt uboczny, tylko dowód, że
bramka działa: zapomniany zapis widać natychmiast.


## Build w bramie jakości (2026-11-16)

Trzy wdrożenia pod rząd padły na Vercelu, a `npm run check` był przez cały czas zielony. Winna
była jedna linia: `export const BUCKET = "lesson-media"` w pliku z `"use server"`, gdzie wolno
eksportować wyłącznie funkcje asynchroniczne. Turbopack nie wyrzuca wtedy samej stałej — przestaje
się kompilować cały moduł, więc razem z nią znikają akcje, które w nim zostały, i jeden błąd
rozchodzi się na sześć w plikach, które niczego nie zmieniały.

Ani typecheck, ani lint tej reguły nie znają. To nie przeoczenie konfiguracji: `"use server"` jest
kontraktem bundlera, nie systemu typów — o tym, że eksport staje się punktem wejścia RPC, wie
dopiero ten, kto dzieli kod na warstwę serwera i klienta. Dlatego `check` kończy się teraz
produkcyjnym buildem. Koszt: ~15 s do przebiegu (całość ~23 s), bo Turbopack korzysta z cache
w `.next`.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Gdzie wstawić build | ostatni krok `check`, jako `check:build` | szybkie kroki padają pierwsze — przy błędzie typu nie czeka się na build | przed testami (najdłuższy krok na początku) |
| Katalog wyniku | ten sam `.next`, co serwer deweloperski | Next przepisuje commitowany `next-env.d.ts` na katalog ostatniego buildu, więc osobny `.next-check` powodowałby ciągłe zmiany w pliku i typecheck zależny od tego, co uruchomiono wcześniej | `distDir` z zmiennej środowiskowej (sprawdzone i wycofane właśnie z tego powodu) |
| Zakres | tylko `apps/web` | pozostałe pakiety są source-only, nie mają czego budować | `--workspaces --if-present` (ta sama praca, dłuższa komenda) |

Sprawdzone wprost: po wstawieniu z powrotem `export const` do pliku akcji `check:build` kończy się
kodem 1. Brama łapie dokładnie tę klasę błędów, dla której powstała.

### Koniec panelu „Poziom trudności" na koncie dziecka (2026-11-16)

Domyka wpis „Trzy kwadraciki poziomów przy lekcji" — tam `profiles.level` przestał cokolwiek
filtrować, a pole zostało w panelu „do osobnej decyzji". To jest ta decyzja: panel znika.

Przełącznik, który niczego nie zmienia, jest gorszy niż jego brak. Dorosły ustawiał dziecku
poziom 1, widział trzy kwadraciki pod każdą lekcją i miał prawo sądzić, że jedno psuje drugie.
O trudności decyduje dziecko, klikając kwadracik na ekranie kursu — i to jest jedyne miejsce.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Co znika | sekcja na `/admin/uczniowie/[id]` wraz z komponentem i akcją `setLearnerLevelAction` | martwy kod bez jedynego wywołania zostaje w repozytorium tylko po to, żeby mylić | zostawienie panelu z dopiskiem „nieaktywny" |
| Co zostaje | kolumna `profiles.level`, funkcja `set_learner_level` i jej test pgTAP | usunięcie kolumny to migracja kasująca dane, a sufit poziomu może jeszcze wrócić jako ustawienie rodzica | `drop column` razem z funkcją |
| Lista uczniów | „poziom: N" znika też z rozwiniętego wiersza | liczba, której nikt nie ustawia i nic nie czyta, jest w tabeli szumem | zostawienie jej jako podglądu kolumny |

### Rodzic uczy się swoich kursów (2026-11-16)

Poprawka do „Roli rodzica" wyżej. Rola powstała jako czysty wgląd — „rodzic nie robi lekcji" —
i to założenie weszło w trzy miejsca: strona główna pokazywała mu wyłącznie dzieci, zaproszenie
z kursem celowo nie zakładało mu zapisu, a komentarze w bazie tłumaczyły, dlaczego tak ma być.
Tymczasem rodzic uczący się razem z dzieckiem to najzwyklejszy przypadek: ten sam kurs, własne
konto, własne powtórki.

W bazie nie trzeba było niczego otwierać — i to jest tu najważniejsze. Nauką rządzi zapis na kurs
(`is_enrolled` pod `is_lesson_unlocked`), a ten nigdy nie pytał o rolę. Zmiana to jeden wyjątek
mniej w wyzwalaczu zaproszeń i jedna sekcja więcej na stronie głównej.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Co daje dostęp do nauki | zapis na kurs, tak samo jak u dziecka | o tym, kto się czego uczy, decyduje administrator — rola mówi tylko, czyje postępy wolno czytać | rola jako dostęp (rodzic uczy się wszystkiego), automatyczny zapis na kursy swoich dzieci (rodzic dwójki dzieci dostaje nagle cztery kursy) |
| Zapis w zaproszeniu | zakładany każdemu, kogo zaprasza, rodzica nie wyłączając | skoro administrator wpisał kurs w zaproszenie, to znaczy, że ten ktoś ma się tego kursu uczyć | osobne pole „zapisz też rodzica" w formularzu zaproszenia |
| Rodzaj zapisu | zwykły wiersz w `enrollments` | zapis to zapis; drugi rodzaj („rodzic uczy się kursu dziecka") znaczyłby to samo, a trzeba by go sprawdzać w każdej funkcji nauki | kolumna `is_parent` w `enrollments` |
| Strona główna | dzieci, pod nimi własne kursy, na końcu „Inne kursy" z prośbą | rodzic przychodzi tu po dzieci, ale kursy ma mieć pod ręką bez szukania; ta sama lista i ten sam przycisk prośby co u dziecka | osobny ekran „moja nauka" dla rodzica, przełącznik trybu dziecko/rodzic |
| Rodzic-administrator | widzi jedno i drugie | jedno konto obsługuje oba, a ukrywanie dzieci przed administratorem nic nie chroni | rozdzielanie widoków po dwu claimach |
| Postępy | księgują się na koncie rodzica | każdy wiersz postępu ma `user_id`, więc statystyki dziecka pozostają nietknięte | wspólny wynik „rodziny" |
| `exercises` | **dalej zamknięte** | rodzic robiący lekcje dostaje treść zadań z `get_lesson_exercises`, bez `accepted` / `answer` / `solution` — jak dziecko | otwarcie tabeli dla rodzica, bo „i tak się uczy" |

**Pułapka odkryta przy okazji:** strony własnych postępów (`/statystyki`, `/nagrody`) pytały
o `v_my_daily`, `v_my_weak_words` i `user_badges` bez `eq("user_id", …)`. Dla dziecka to obojętne —
RLS i tak oddaje mu jeden komplet wierszy — ale rodzic (i administrator) dostaje tam także wiersze
cudze, więc wykres tygodnia sumował naukę dzieci, a odznaka dziecka zapalała się rodzicowi jako
zdobyta. Filtr po `user_id` idzie teraz przy **każdym** zapytaniu o własne dane, nie tylko przy tych,
które i tak musiały wskazać wiersz (`v_my_stats`, `v_my_courses`). Widoki zostają bez zmian: te same
czytają karty dzieci, tylko z innym identyfikatorem. Lista dzieci stała się wspólnym komponentem
(`app/children-list.tsx`) i stoi na stronie głównej oraz w „Twoich postępach" — rodzic ma jedno
dojście do karty dziecka niezależnie od tego, gdzie zacznie. Tamże doszła sekcja „Twoje odznaki":
zdobyte odznaki z datą i licznik punktów, żeby „ile zrobiłem" i „co za to mam" stało na jednej
karcie — pełna lista, razem z niezdobytymi, zostaje w „Nagrodach". Sekcja jest dla każdego, nie
tylko dla rodzica: to ta sama strona własnych postępów, a rozgałęzianie jej po roli dodałoby warunek
bez żadnego zysku.

Sekcja odznak (`app/badge-list.tsx`) stoi w trzech miejscach: w „Twoich postępach" oraz na karcie
dziecka dwa razy — raz jego odznaki, raz odznaki rodzica. Decyduje jeden parametr `user`: bez niego
sekcja dotyczy zalogowanego i dokłada licznik punktów z odnośnikiem do „Nagród", z nim pokazuje
same odznaki z datami. Punkty dziecka stoją wyżej w kafelkach, a „Nagrody" pokazałyby rodzicowi
jego własne odznaki, nie dziecka. Na karcie odznaki dziecka idą zaraz po kursach, a odznaki rodzica
na samym końcu, z podpisem — wszystko pomiędzy jest o dziecku, więc własne nagrody nie mogą stać
w środku tej listy. Dostępu nie pilnuje komponent, tylko RLS: `user_badges` wydaje rodzicowi
wiersze wyłącznie przypisanych dzieci.

Prośba o dostęp stoi też przy kursach dziecka, na jego karcie: rodzic czyta, czego uczy się
dziecko, i w tym samym wierszu widzi albo „uczysz się tego kursu" (odnośnik do kursu), albo
przycisk prośby dla SIEBIE. To zwykłe `request_course_access` — nowej drogi nie ma, bo zapis
rodzica niczym się nie różni od zapisu dziecka, a decyduje tak samo administrator. Kursu ukrytego
nie trzeba tam obsługiwać: polityka `courses_read` nie wydaje go nikomu poza administratorem,
więc znika też z `v_my_courses` dziecka.

Test `parent_learns.test.sql` pilnuje obu końców tej zmiany: że rodzic po zapisie zaczyna lekcję
i dostaje zadania, oraz że zapis DZIECKA mu kursu nie otwiera, a tabeli `exercises` nie widzi
ani przed zapisem, ani po nim.

## Aplikacja na telefon: Expo, nie PWA ani WebView (2026-11-16)

Telefon dostaje osobną aplikację natywną (Expo/React Native, Android) **tylko w trybie ucznia** —
bez panelu administratora i bez widoku rodzica. Zakres, etapy M0–M4 i kryteria odbioru:
`docs/PLAN_MOBILE.md`. Rozbicie prac wzorowane na sąsiednim projekcie ExpeditionPlan, gdzie web
planuje, a telefon działa w trasie.

| Obszar | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Rodzaj aplikacji | Expo / React Native, Android | przewidywalna mowa (głosy systemowe offline), codzienne przypomnienia o powtórkach z dokładnym alarmem, ikona i pełny ekran bez proszenia dziecka o „Dodaj do ekranu głównego”, zapas na naukę offline w v1.x | PWA — Web Speech API jest u nas znaną pułapką, a powiadomienia codzienne na iOS praktycznie nie istnieją; WebView z adresem produkcyjnym — oszczędza drugi interfejs, ale nie daje ani mowy, ani offline, czyli tego, po co w ogóle robimy telefon |
| System | tylko Android | jest czym rozdawać APK (EAS, kanał `preview`); na iPada zostaje PWA | iOS — bez konta dewelopera Apple nie ma dystrybucji |
| Zakładanie konta | zostaje na webie (link z zaproszeniem, hook `before_user_created`) | druga ścieżka rejestracji w aplikacji to drugie miejsce, w którym można się pomylić co do tokenu | rejestracja w aplikacji, logowanie magic linkiem |
| Magazyn sesji | `localStorage` z expo-sqlite | SecureStore ma limit 2 KB na wartość, a token sesji Supabase bywa dłuższy — sesja ginęłaby po restarcie | `expo-secure-store` (tak było w pierwszej wersji planu), AsyncStorage (dodatkowa zależność bez zysku) |
| Limit czasu zapytań | 15 s w `fetch` klienta Supabase | klient Supabase nie ma własnego limitu; przy jednej kresce zasięgu zapytanie wisi minutami, a dziecko patrzy w „Sprawdzam…”. Lekcja P1.1 z ExpeditionPlan | bez limitu (domyślnie), 30 s jak w ExpeditionPlan — tam chodzi o góry, tu o odpowiedź w lekcji |
| Nauka offline | w MVP jej nie ma | zadania offline wymagają kluczy odpowiedzi na telefonie, a lokalna ocena w `core` to odrzucona „ocena podwójna”; obsługa braku sieci to czytelny komunikat, nie biała strona | outbox z lokalną oceną (jak `packages/sync` w ExpeditionPlan) |

`dbErrorMessage` przeniesiony z `apps/web/src/lib/db-error.ts` do `packages/core` — tych samych
funkcji bazy woła przeglądarka i telefon, a komunikat o odmowie RLS nie ma brzmieć w nich inaczej.
Na webie zostaje re-eksport i `dbLoadError` („Odśwież stronę”), bo na telefonie nie ma czego
odświeżać. `scripts/sync-env.mjs` pisze też `apps/mobile/.env.local`: `EXPO_PUBLIC_*`
przepisywane z tych samych wartości co `NEXT_PUBLIC_*`, zawsze z chmury — telefon nie zobaczy
adresu `127.0.0.1` komputera, więc `--local` go nie dotyczy.

### Pułapki znalezione przy bramce M0 (2026-11-16)

- **`expo lint` w SDK 58 ma reguły kompilatora Reacta.** `Date.now()` wywołane w ciele komponentu
  to „impure function” (wynik zmienia się przy ponownym renderze), a wywołanie w `useEffect`
  funkcji, która ustawia stan, to „cascading renders”. Stąd `src/lib/clock.ts` (stoper poza
  komponentem) i efekty, które ustawiają stan w `then`, a przeładowanie danych wyzwalają
  licznikiem w stanie. Obie reguły są włączone domyślnie i `npm run check` się o nie wywala.
- **`AndroidImportance` przez `import * as Notifications` przechodzi typecheck, ale nie lint** —
  reguła `import/namespace` go w przestrzeni nazw nie widzi. Musi być importem nazwanym.
- **`packages/core` nie ma typów `console`** (ani DOM, ani Node — i dobrze, bo ma być czysty).
  Log z nieznanego błędu idzie więc przez `globalThis`.
- **Wersje paczek dobiera `npx expo install`, nie ręczne wpisywanie.** Przepisane z sąsiedniego
  projektu wyglądały dobrze, ale `npx expo-doctor` wyłapał `react-native-safe-area-context`
  starszy o jedną wersję pomocniczą niż wymaga SDK; naprawia to `npx expo install --fix`.

## Telefon, Etap M1: co przenosimy wprost, a co inaczej niż na webie (2026-11-16)

Ekran kursu i przebieg lekcji na telefonie wołają te same funkcje bazy co web, więc reguły
(co otwarte, ile gwiazdek, kiedy bramka) nie są przepisane — przychodzą z bazy. Różnice dotyczą
tylko tego, czego telefon nie ma albo ma inaczej.

| Rzecz | Na webie | Na telefonie | Dlaczego |
|---|---|---|---|
| Wywołania bazy | Server Actions (`lesson-actions.ts`) | wprost z aplikacji (`features/lesson/api.ts`) | nie ma serwera aplikacji i nie jest potrzebny: praw pilnuje RLS, a klucze odpowiedzi wycina `get_lesson_exercises` |
| Odświeżanie danych | nowy render strony po powrocie | `useFocusEffect` wczytuje kurs przy każdym wejściu na ekran | po lekcji zmieniają się gwiazdki i zamki; ekran, który został w pamięci, pokazywałby stan sprzed lekcji |
| Automatyczne przejście po dobrej odpowiedzi | licznik odkładany przy każdym kliknięciu i klawiszu | licznik odkładany przy każdym dotknięciu ekranu (`onStartShouldSetResponderCapture`, bez przechwytywania dotknięcia) | dziecko, które słucha słówka głośnikiem, nie ma stracić ekranu sprzed nosa |
| Kwadraciki etapów i poziomów | małe, mysz trafia | te same rozmiary, ale `hitSlop` powiększa pole dotyku do progu dla palca | rząd kilku kwadracików nie zmieści się w 56 px na sztukę, a pole dotyku może być większe niż rysunek |
| Dźwięk reakcji i animacje | Web Audio + CSS | nie ma w M1 | to osobna zależność natywna; brak dźwięku nie psuje nauki, brak oceny z bazy — psuje |
| Nagranie z `audio_path` | odtwarzane jako zapas, gdy nie ma głosu | nie ma w M1 (potrzebny `expo-audio`) | pole jest zapasem, a seed i panel liczą na syntezator; bez głosu zadanie ze słuchu jest pomijane bez zapisania próby, jak na webie |
| Flaga kursu | obrazek flagi | ikona kursu (emoji) | obrazki flag to pliki weba; ikona jest w danych kursu i wystarcza |
| Podgląd z panelu (`?podglad=1`) | jest, tylko dla administratora | nie ma | telefon jest tylko dla ucznia, więc `p_preview` zawsze `false` |

Wzorzec na dane ekranu bez `setState` w efekcie: wynik wczytania trzymamy razem z kluczem tego,
czego dotyczy (`{ key, data }`), a świeżość liczymy przy renderze. Zerowanie stanu po zmianie
parametrów (`setData(null)` w efekcie) odbija linter Reacta jako kaskadę renderów — i ma rację,
bo to drugi render na każde wejście w lekcję.

### Telefon: obrazki wbudowanym `Image`, nie `expo-image` (2026-11-16)

Wybór obrazka na telefonie rysuje `Image` z React Native. `expo-image` daje lepszą pamięć
podręczną na dysku, ale jest modułem natywnym: dołożenie go **po** zrobieniu dev buildu znaczy,
że aplikacja na telefonie przestaje działać do kolejnej przebudowy (kilkanaście minut na EAS za
każdym razem). Pamięć podręczna przyda się dopiero przy nauce bez sieci, a to osobna decyzja
(PLAN_MOBILE 3.2) — wtedy razem z nią wraca też `expo-audio` do nagrań z pola `audio_path`.

Reguła ogólna, która z tego wychodzi: **nowy moduł natywny to nowy APK**, więc w trakcie etapu
dokładamy tylko to, co da się zrobić na tym, co już jest w aplikacji. Tak samo dzieli pracę
ExpeditionPlan (oznaczenia OTA i APK w `ANALIZA_TELEFON.md`).

### Telefon: informacja zwrotna w treści, nie przyklejona do dołu (2026-11-16)

Na webie pasek „Brawo! / Nie tym razem" z przyciskiem „Dalej" jest przyklejony do dołu okna.
Na telefonie ta sama konstrukcja wchodziła **pod przyciski systemowe Androida**: od SDK 54 tryb
edge-to-edge jest domyślny, więc pasek nawigacji leży na treści, a nie obok niej. Dziecko widziało
„Dalej" przycięte i trafiało w niego co drugi raz.

Teraz informacja zwrotna jest zwykłym elementem treści, zaraz pod zadaniem — w miejscu, w którym
chwilę wcześniej stało „Nie wiem, pomiń" — a po sprawdzeniu odpowiedzi ekran sam zjeżdża na dół
(`scrollToEnd`), żeby przy dłuższym zadaniu (pary, rozsypanka) nie wypadła poza widok. Każdy ekran
dolicza przy tym do dolnego marginesu wysokość wcięcia systemowego (`useSafeAreaInsets`).

Odrzucone: samo podniesienie paska o wysokość wcięcia. Pasek zostałby wtedy przyklejony do dołu
i nadal zabierałby wysokość ekranu, której przy otwartej klawiaturze brakuje najbardziej —
a „Dalej" byłby daleko od tego, co dziecko właśnie czytało.

### Telefon: przypomnienie o powtórkach bez zadania w tle (2026-11-16)

Treść przypomnienia („5 słówek czeka") powstaje w chwili planowania, a powtarzający się wyzwalacz
dzienny nie umie jej odświeżyć sam. Zamiast zadania w tle (`expo-background-task` — moduł natywny,
czyli nowy APK) przypomnienie planuje się od nowa przy każdym wejściu na ekran kursów i po
zaliczonej lekcji, czyli dokładnie wtedy, gdy liczba zaległych mogła się zmienić. Dziecko, które
nie otwiera aplikacji, dostanie liczbę z ostatniego wejścia — a to i tak więcej, niż dałoby
przypomnienie bez liczby. Zadanie w tle wraca w Etapie M4, razem z pierwszym APK dla dzieci.

### Telefon: obrazki przez `expo-image` — zmiana decyzji z tego samego dnia (2026-11-16)

Zastępuje „Telefon: obrazki wbudowanym `Image`, nie `expo-image`" wyżej. Powód jest prosty:
**obrazki lekcji są w SVG** (`2026/liczba-6.svg` i podobne — tak je wgrywa panel), a wbudowany
`Image` z React Native nie rysuje SVG wcale. Na telefonie kafelki wyboru obrazka były puste,
choć na webie te same pliki wyświetlały się bez zarzutu.

`expo-image` ma w sobie dekoder SVG dla Androida (`com.caverock:androidsvg-aar`), więc rysuje je
tak jak przeglądarka, a przy okazji dochodzi pamięć podręczna na dysku. Kosztem jest nowy moduł
natywny, czyli nowy dev build teraz i nowy APK przy wydaniu — dokładnie to, czego poprzednia
decyzja chciała uniknąć. Reguła „nowy moduł natywny to nowy APK" zostaje; to przypadek, w którym
treść nie daje wyboru.

Wniosek na przyszłość: **format treści sprawdza się na początku etapu, nie po pokazaniu
aplikacji**. Jedno zapytanie o `payload` zadania `image_choice` w bazie powiedziałoby to samo,
co dziecko z pustymi kafelkami w ręku.

### Telefon: APK dla dziecka — obrót ekranu i sprawdzanie aktualizacji (2026-11-16)

Pierwszy APK na kanale `dzieci` wymusił dwie poprawki w `app.json`, obie natywne (czyli możliwe
tylko przy nowym APK, nie przez OTA):

- **`orientation: "default"` zamiast `"portrait"`.** Dziecko uczy się na tablecie, a tablet często
  leży poziomo w podstawce. Zablokowany pion znaczył obrócony interfejs; układy są elastyczne
  i przewijane, więc poziomo działają.
- **`updates.checkAutomatically: "ON_LOAD"` zamiast `"ON_ERROR_RECOVERY"`.** Przy wartości
  z szablonu aplikacja szuka aktualizacji dopiero po awarii, a my nie mamy (jeszcze) własnego
  sprawdzania w kodzie — czyli poprawka OTA nigdy by do tabletu nie dotarła. Zauważone
  przed wysłaniem pliku dziecku; build z poprzednią wartością został anulowany.

Zmienne `EXPO_PUBLIC_SUPABASE_URL` i `EXPO_PUBLIC_SUPABASE_ANON_KEY` są zapisane po stronie EAS
(środowisko `preview`, widoczność `plaintext`), bo `.env.local` nie jedzie do chmury, a profil
`preview` wskazuje to środowisko w `eas.json`. Klucz publishable może być w APK —
dostępu do danych pilnuje RLS, a ocena odpowiedzi i tak dzieje się w bazie.

Instrukcja instalacji dla rodzica: `docs/TELEFON.md`.

### Co daje każdy poziom lekcji: podpowiedź i punkt odblokowania (2026-11-16)

Poziomy średni i trudny nie dawały nic poza gwiazdkami — postęp kursu liczy się z łatwego,
a dokładkę do podpowiedzi dawała sama zaliczona lekcja, czyli znowu łatwy. Dziecko, które weszło
na trudny, dostawało tyle samo co to, które go ominęło. Od teraz każdy poziom ma swoją nagrodę:

| Poziom | Co daje |
| --- | --- |
| łatwy | otwiera następną lekcję (bez zmian — to on jest postępem) |
| średni | jedną podpowiedź do dzisiejszej puli (`hint_bonus`) |
| trudny | jeden **punkt odblokowania** (`unlock_points_earned`) |

Dzienna pula podpowiedzi zostaje trzy; zmieniło się tylko źródło dokładki — z `lesson_progress`
na `lesson_level_progress` z `level = 2`. Reguła liczenia jest ta sama: data `completed_at`
w strefie dziecka, więc dokładka znika o północy, a powtórzone wejście nie daje drugiej
podpowiedzi.

Punkty odblokowania liczą się **z tego, co w bazie już jest**: zarobione to zaliczone wejścia na
trudny, wydane to wiersze w `public.lesson_unlocks`, stan konta jest różnicą. Żadnego licznika do
dopisywania i cofania — skasowana lekcja zabiera i punkt, i odblokowanie, bez rozjazdu z historią.

Za punkt otwiera się **zwykłą lekcję (`kind = 'standard'`) w dziale, w którym dziecko już jest**.
Punkt nie jest przepustką przez test działu ani przez bramkę zaległych powtórek: test zostaje
jedyną drogą do następnego działu, a zaległe słówka trzeba powtórzyć, nie wykupić. Pilnuje tego
`can_unlock_lesson`, a nie przeglądarka — ekran tylko pokazuje kłódkę z kluczykiem tam, gdzie baza
mówi, że da się ją otworzyć. Kliknięcie kłódki pyta o zgodę, bo punkt kosztuje kilkanaście zadań
na poziomie trudnym i wydanie go przez pomyłkę byłoby dotkliwe.

Odrzucone: punkty w `points_ledger` (to waluta za zadania, pokazywana w pasku — zmieszanie jej
z odblokowaniami znaczyłoby, że dziecko kupuje lekcje za zwykłą naukę); kolumna `unlock_points`
w `profiles` (licznik do zerowania, czyli dokładnie to, czego uniknęliśmy przy podpowiedziach);
odblokowanie całego działu (to już przeskok przez test); punkt za średni i podpowiedź za trudny
(nagroda ma rosnąć z trudnością, a odblokowanie jest warte więcej niż jedna podpowiedź).

## Wejście w etap zaczyna go od nowa (2026-11-16)

Dziecko, które weszło w etap drugi raz, widziało od razu podsumowanie poprzedniego podejścia
(„Jeszcze trochę, dobrze 5 z 8”) zamiast pierwszego zadania. Nic nie psuło się w bazie: sesja
była zamknięta prawidłowo, a twarde odświeżenie strony pokazywało lekcję od początku.

Powód jest po stronie nawigacji. Next nie odmontowuje strony, z której się wychodzi — chowa ją
w `<Activity>`, żeby powrót był natychmiastowy — i przy ponownym wejściu pokazuje **ten sam**
komponent z całym stanem sprzed wyjścia. `LessonRunner` trzyma w stanie numer zadania, fazę
i podsumowanie, więc wracał z ekranem końcowym. Klucz `key={level-stage}` tego nie łapie:
komponent nie jest nowy, tylko odsłonięty.

Przebieg kasujemy w **sprzątaniu efektu**, które wykonuje się dokładnie przy chowaniu ekranu
(i przy odmontowaniu, gdzie jest już bez znaczenia): numer zadania na zero, faza na „odpowiadaj”,
podsumowanie i werdykt na `null`, a do tego `sessionRef` i klucz idempotencji — nowe podejście
ma założyć nową sesję, a nie wrócić do zamkniętej.

Odrzucone: zerowanie w ciele efektu przy pokazaniu ekranu (działa tak samo, ale to kaskada
renderów, którą lint `react-hooks/set-state-in-effect` słusznie wywala); wyłączenie pamięci
nawigacji w `next.config` (lekarstwo na cały serwis za jeden ekran, w dodatku na ustawieniu
eksperymentalnym); osobny adres podsumowania w rodzaju `/lekcja/[id]/podsumowanie?sesja=…`
(stan lekcji trafiłby do adresu, a zakończony etap dałoby się otworzyć z historii przeglądarki).

Telefon tego błędu nie ma i nie wolno go tam wpuścić. `apps/mobile` nie trzyma ekranów
„na wszelki wypadek”: w lekcję wchodzi się przez `router.push` (nowy ekran, czyli nowy
`LessonRunner`), a wychodzi przez `router.replace` (ekran lekcji znika ze stosu razem ze stanem).
Gdyby kiedyś zamienić wyjście na `router.back()` zostawiające lekcję na stosie albo wejście na
`router.navigate`, które wraca do istniejącego ekranu zamiast tworzyć nowy — wróci dokładnie to
samo: dziecko w etapie zobaczy podsumowanie poprzedniego podejścia.

### Telefon: punkty odblokowania i stan konta na ekranie kursów (2026-11-16)

Nagrody za poziomy (średni — podpowiedź, trudny — punkt odblokowania) weszły najpierw na webie,
a telefon został przy samych gwiazdkach. Punkt dziecko zdobywało w aplikacji i nie dowiadywało
się o tym, a kłódki na ekranie były martwe — reguła siedziała w bazie, tylko nie było czym jej
dotknąć. Od teraz telefon robi dokładnie to, co strona: podsumowanie mówi o zdobytym punkcie,
ekran kursu pokazuje kłódkę z kluczykiem tam, gdzie `can_unlock_lesson` na to pozwala, a dotknięcie
pyta o zgodę przed wydaniem punktu.

Decyzji o tym, co wolno otworzyć, telefon **nie podejmuje**: wysyła `unlock_lesson` z samym
identyfikatorem lekcji, a kłódka pokazana jako klikalna jest zaproszeniem, nie zgodą. Kluczyk
dorysowujemy tylko wtedy, gdy punkt naprawdę jest (`unlock_status`) — klikalna kłódka bez pokrycia
obiecywałaby coś, czego baza nie da, a odmowa po dotknięciu boli bardziej niż zwykły zamek.
Powód zamka pod kafelkiem dostał brakujące dwa przypadki (zamknięty dział, lekcja do kupienia),
więc jest ich pięć, tyle samo co na webie.

Punkty, seria i zaległe powtórki stoją **na ekranie kursów**, nie w nagłówku każdego ekranu jak
`TopBar` na webie. Pasek nad stosem nawigacji w expo-router znaczyłby własny nagłówek dla lekcji,
logowania i planszy ze słówkami — a w lekcji licznik punktów przeszkadza (dziecko ma patrzeć
na zadanie) i tak czy tak zmieniłby się dopiero w podsumowaniu. Ekran kursów wczytuje się na nowo
przy każdym pokazaniu, więc punkty zdobyte w lekcji widać zaraz po powrocie na ekran kursu.

Odrzucone: przeliczanie stanu konta w telefonie z `lesson_level_progress` (druga implementacja
reguły obok `unlock_points_left`); odblokowanie bez pytania (punkt kosztuje kilkanaście zadań na
poziomie trudnym); wygaszanie kluczyka na kłódce lekcji, której baza nie pozwoli otworzyć
(`can_unlock_lesson` już to mówi, a dwa stopnie szarości na jednym kafelku to dla dziecka jeden
nieczytelny stan).

### Telefon: nowa wersja z przyciskiem, nie z zaskoczenia (2026-11-16)

Aplikacja sprawdza aktualizacje przy starcie (`checkAutomatically: ON_LOAD`), ale pobrana wersja
wchodzi do użycia dopiero przy następnym uruchomieniu — taki jest EAS Update. Na tablecie znaczyło
to „zamknij z listy ostatnich i otwórz dwa razy": instrukcja, której nikt nie zgadnie i nikt nie
zapamięta, a wysłana poprawka wisiała niewykorzystana.

Od teraz ekran kursów pokazuje kartę „Nowa wersja gotowa" z przyciskiem „Uruchom teraz"
(`isUpdatePending` z `useUpdates`), a pod „Konto" jest sprawdzenie na żądanie — przydaje się, gdy
poprawka wyszła przy już włączonej aplikacji, bo sprawdzenie przy starcie samo się nie powtórzy.

Odrzucone: `reloadAsync()` od razu po pobraniu (aplikacja, która nagle startuje od nowa, wygląda
na zepsutą, a w lekcji zabrałaby niedokończone podejście — dlatego karta stoi tylko na ekranie
kursów, gdzie restart nic nie kosztuje); własny licznik wersji w bazie i porównywanie go w kodzie
(`expo-updates` już wie, co pobrał, a druga prawda o wersji to drugie miejsce do pomyłki);
`checkAutomatically: ON_ERROR_RECOVERY` z ręcznym sprawdzaniem (pierwszy APK dla dzieci miał tak
przez pomyłkę — aktualizacja nie przyszłaby nigdy, dopóki aplikacja się nie wywali).


## Poziomy w łańcuchu, a gwiazdka warunkiem zaliczenia (2026-11-17)

Zgłoszone z ekranu: poziom średni nie został zdany — za dużo błędów — a poziom trudny i tak stał
otworem. To nie był przypadek, tylko reguła zapisana w `20261115095000_lesson_levels.sql`:
`is_level_unlocked` dla każdego poziomu powyżej łatwego pytała wyłącznie o to, czy skończona jest
lekcja. Zaliczenie łatwego otwierało więc średni i trudny naraz, a test pgTAP przyklepywał to
zdaniem „łatwy poziom otwiera oba trudniejsze kwadraciki naraz".

Dla dziecka to zaprzeczenie nazwy. „Trudny" ma być tym, do czego się dochodzi; jeśli stoi otworem
od początku, przestaje być nagrodą za średni i staje się drugą listą zadań obok.

Od teraz poziomy są łańcuchem — łatwy → średni → trudny — a każde ogniwo wymaga **co najmniej
jednej gwiazdki** z poprzedniego. Gwiazdki, nie samego statusu: wiersz z „completed" i zerem
gwiazdek mógł powstać wcześniej, przy obniżonym progu lekcji, a reguła ma obowiązywać i dla niego.

Drugie ogniwo tej samej zasady jest w `finish_lesson_session`: próg zaliczenia nie schodzi poniżej
0,8, czyli poniżej pierwszej gwiazdki (`greatest(pass_threshold, 0.800)`). Administrator może
obniżyć próg w formularzu lekcji i bez tego dałoby się ustawić 0,5, zamalować kwadracik wynikiem
bez ani jednej gwiazdki — i dostać ekran, na którym poziom jest „zrobiony", a następny zamknięty.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Warunek otwarcia | jedna gwiazdka z poprzedniego poziomu | to ta sama liczba, którą dziecko widzi nad kwadracikiem — nie trzeba tłumaczyć osobnego progu | komplet trzech gwiazdek (mur, nie próg); sam status „completed" (to on się rozjechał) |
| Gdzie pilnować progu | w bazie, w `finish_lesson_session` | ocena i tak jest liczona wyłącznie w bazie; warunek w przeglądarce omija się wyłączeniem JS | walidacja pola `pass_threshold` w panelu (nie zmienia wierszy już zapisanych) |
| Kwadracik zaczętego poziomu | kropka w środku zamiast połowy wypełnienia | pół kwadracika przy 1,5 rem czyta się jak kwadracik zamalowany — zgłoszenie zaczęło się właśnie od „kwadracik się zamalował" | puste pole (znikałaby prawdziwa informacja, że dziecko tu już było) |

Reguła dotyczy wyłącznie poziomów. Następną **lekcję** otwiera jak dotąd zaliczony poziom łatwy —
z tą jedną zmianą, że i tam „zaliczony" znaczy teraz „z gwiazdką".
## Źle zrobione zadanie wraca w tym samym etapie (2026-11-17)

Zadanie, które dziecku nie wyszło, wracało dopiero w powtórkach — za dzień albo za tydzień. W
obrębie etapu nie miało drugiego podejścia, więc całą nauką po błędzie był czerwony panel z
poprawną odpowiedzią, przeczytany przez cztery sekundy i zamknięty przyciskiem „Dalej". Od teraz
przebieg lekcji dokłada takie zadanie na koniec kolejki etapu i pokazuje je jeszcze raz, z napisem
„🔁 Jeszcze raz", żeby dziecko wiedziało, że to drugie podejście, a nie usterka.

Raz na zadanie. Powtórzone zadanie, zrobione źle po raz drugi, już nie wraca: dziecko, które
czegoś nie umie, kręciłoby się na jednym zadaniu do końca etapu, a „Nie wiem, pomiń" (dla bazy
zwykły błąd) tylko przedłużałoby pętlę.

Powtórka wywróciła liczenie wyniku. Dotąd z każdego zadania liczyła się OSTATNIA odpowiedź —
reguła z czasów, gdy ta sama sesja widziała zadanie dwa razy tylko przez przypadek. Z powtórką
znaczyłaby tyle, że każdy etap kończy się kompletem gwiazdek: poprawna odpowiedź stoi przecież na
ekranie tuż przed powtórzonym zadaniem. Od teraz liczy się każda odpowiedź z osobna. Poprawka jest
warta tyle co odpowiedź od razu, ale błąd zostaje w wyniku, bo dołożył do etapu jedno zadanie
więcej: dziesięć zadań z dwoma błędami naprawionymi w powtórce to 10/12, czyli 0,833 — jedna
gwiazdka, nie trzy.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Kiedy zadanie wraca | na końcu kolejki etapu | dziecko odpowiada na nie po kilku innych, a nie zaraz po przeczytaniu odpowiedzi — wtedy to pamięć, nie przepisanie | od razu po błędzie (przepisanie z ekranu obok); dopiero w powtórkach następnego dnia (tak było i to właśnie zmieniamy) |
| Ile razy | raz na zadanie | ogranicza etap z góry; po drugim błędzie słówko i tak idzie do powtórek z oceną „powtórz" | aż do skutku (pętla dla dziecka, które nie umie) |
| Udział w wyniku | każda odpowiedź liczy się z osobna | poprawka coś daje, a błąd coś kosztuje — jedno i drugie widać w liczniku „Dobrze: 10 z 12" | pierwsza odpowiedź wygrywa (powtórka byłaby karą bez nagrody); ostatnia odpowiedź wygrywa (darmowe trzy gwiazdki) |
| Gdzie liczone | w bazie, w `finish_lesson_session` | wynik i gwiazdki powstają wyłącznie w bazie; przeglądarka nie wysyła ani jednego, ani drugiego | licznik w `lesson-runner.tsx` (klient zacząłby decydować o ocenie) |

Prośba o poprawienie literówki zostaje bez zmian i nie miesza się z powtórką: nie zapisuje próby,
więc nie wchodzi do mianownika, i dalej przysługuje raz na zadanie w sesji. Podpowiedź też działa
jak dotąd — zamienia zadanie na łatwiejsze tylko na tej jednej pozycji w kolejce, więc powtórka
pokazuje zadanie w pełnej postaci.


## Po prośbie o poprawkę liczy się odpowiedź dokładna (2026-11-17)

Zgłoszone z ekranu: dziecko robi literówkę, dostaje „Prawie! Zajrzyj w litery i popraw", klika
„Sprawdź" drugi raz nie dotykając pola — i zadanie zostaje zaliczone. Prośba o poprawkę zamieniła
się w jedno kliknięcie więcej do tego samego wyniku, a przy okazji sama podpowiadała, że warto
kliknąć ponownie.

To nie było przeoczenie w jednym miejscu, tylko zderzenie dwóch reguł pisanych w różnym czasie.
`20261115090600_lessons.sql` wprowadziło tolerancję jednej literówki — słusznie, bo „dogg" to nie
jest nieznajomość słowa „dog". `20261115095400_typo_retry.sql` dołożyło nad nią prośbę o poprawkę:
zamiast po cichu zaliczyć, pokaż „Prawie!" i oddaj zadanie do poprawienia, raz na zadanie. Przy
drugim podejściu zadanie jest już w `retried_exercise_ids`, więc warunek prośby nie przechodzi
i odpowiedź leci niżej — prosto na starą tolerancję, która ją zalicza.

Tolerancja obowiązuje teraz wyłącznie **do pierwszego „Prawie!"**. Po nim trzeba napisać słowo
tak, jak się je pisze — bo dokładnie o to prosi komunikat na ekranie.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Zakres tolerancji | do pierwszej prośby o poprawkę | komunikat prosi o poprawienie; jeśli niepoprawione przechodzi, komunikat kłamie | zniesienie tolerancji w ogóle (wraca „dogg" liczony jak nieznajomość słowa; tolerancja dalej działa tam, gdzie prośba nie przysługuje) |
| Druga prośba | nie ma | pętla, z której dziecko nie wychodzi, a „Nie wiem, pomiń" tylko ją przedłuża | poprawianie aż do skutku |
| `near_miss` przy niepoprawionej literówce | zostaje prawdą | to prawda o tej odpowiedzi i stąd w statystykach wiadomo, że dziecko było blisko; o zaliczeniu decyduje `is_correct`, nie ona | kasowanie znacznika razem z zaliczeniem (traci się informację) |
| Ocena dla harmonogramu | zwykły błąd (1) | niepoprawiona literówka to słówko, którego dziecko nie umie napisać — ma wrócić w powtórkach | „z trudem" (2), czyli ocena dla zaliczenia z potknięciem |

Dwa testy, które opisywały stan sprzed poprawki (`typo_retry.test.sql`, `lessons.test.sql`),
mówią teraz odwrotnie, a doszedł trzeci: poprawiona naprawdę odpowiedź ma przechodzić. Bez niego
poprzedni test dałoby się zdać, zamykając poprawianie w ogóle.

### Telefon: ustawienia pod zębatką, nie na ekranie kursów (2026-11-17)

Ekran kursów zebrał z czasem wszystko, co nie miało innego miejsca: kartę przypomnienia
o powtórkach pośrodku listy, a pod nią rozwijany napis „Konto" z zalogowanym adresem, wersją
aplikacji, sprawdzeniem aktualizacji, listą głosów i wylogowaniem. Dorosły musiał przewinąć
wszystkie kursy dziecka i wiedzieć, że ten napis w ogóle się rozwija.

Od teraz w prawym górnym rogu nagłówka ekranu kursów stoi zębatka (`SettingsButton`
w `headerRight`), a za nią osobny ekran `ustawienia.tsx`: konto, wersja aplikacji ze
sprawdzeniem aktualizacji, przypomnienie o powtórkach, głosy i wyjście z konta. Ekran kursów
pokazuje kursy, pasek stanu i kartę „Nowa wersja gotowa" — czyli to, co dotyczy dziecka.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Gdzie zębatka | tylko na ekranie kursów | to jedyny ekran, z którego dorosły zaczyna; w lekcji każdy piksel nagłówka jest zajęty, a wyjście do ustawień w środku zadania gubi podejście | zębatka w nagłówku każdego ekranu |
| Co z przypomnieniem | przenosimy w całości | jedno miejsce na rzeczy ustawiane raz; włączenie i tak jest czynnością dorosłego, a nie dziecka | zostawienie karty na ekranie kursów (wraca bałagan, od którego zaczęliśmy) |
| Zębatka dla niezalogowanego | nie pokazuje się | ekran kursów jest wtedy powitaniem z prośbą o zalogowanie — w ustawieniach konta, którego nie ma, nie ma czego ustawiać | zębatka zawsze, z komunikatem po wejściu |
| Rozmiar dotyku | 44 px plus `hitSlop` 8 | nagłówek ma 56 px wysokości, więc wymagane 56 nie mieści się jako obrys; `hitSlop` dokłada je tam, gdzie i tak nic nie stoi | przycisk 56 px (rozpycha nagłówek), sama ikona bez zapasu (dla palca za mała) |

Numer wersji pokazuje `UpdateInfo` tak jak dotąd — `runtimeVersion` z `useUpdates`, czyli przy
polityce `appVersion` wprost `version` z `app.json`. Osobnego licznika wersji nie zakładamy
z tego samego powodu co poprzednio: druga prawda o wersji to drugie miejsce do pomyłki.

Zapowiedziany skutek do sprawdzenia na urządzeniu: wyłączone przypomnienie jest teraz o jedno
dotknięcie dalej niż było. Jeśli po tygodniu okaże się, że nikt go nie włączył, na ekran kursów
wraca jednowierszowa zachęta prowadząca do ustawień — ale sam przełącznik zostaje pod zębatką.
## Jeden kanał na Androida, nie osobny dla dzieci (2026-11-17)

Były dwa kanały EAS: `preview` na telefon właściciela i `dzieci` na tablety dzieci. Pomysł był
taki, że poprawka idzie najpierw do siebie, a do dzieci dopiero po sprawdzeniu. W praktyce
oznaczało to podwójny build, podwójne `npm run ota` i cztery polecenia w `package.json`, przy
których łatwo było wysłać poprawkę u siebie i zapomnieć o dzieciach — czyli zostawić je na
starszym kodzie, nie wiedząc o tym.

Od teraz **wersje są dwie: strona w przeglądarce i Android**. Jeden profil (`preview`), jeden
kanał, jedno `npm run ota`, jedno `npm run apk`.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Ile kanałów Androida | jeden, `preview` | telefony w domu są trzy, nie trzysta — osobny kanał kosztował krok przy każdej poprawce, a nie kupował nic, czego nie da się sprawdzić na webie albo na dev buildzie | dwa kanały (tak było); kanał `dzieci` wskazujący gałąź `preview` (działa bez przeinstalowania, ale zostawia nazwę, która już nic nie znaczy) |
| Co z wgranym APK dzieci | nowy plik do zainstalowania raz | kanał wchodzi do paczki przy budowaniu, więc stary APK słucha kanału, którego już nie zasilamy | zostawienie starego kanału przy życiu |
| Gdzie sprawdzać przed wysłaniem | na webie albo na dev buildzie | przebieg lekcji jest w obu aplikacjach ten sam, a różnice natywne i tak wymagają APK | kanał „najpierw u mnie" (to właśnie znosimy) |

Nazwa `preview` zostaje, choć kanał jest już jedyny: siedzi w APK właściciela, więc zmiana nazwy
znaczyłaby nowy plik także dla niego. To jest nazwa dystrybucji wewnętrznej w EAS, nie obietnica,
że wersja jest próbna.

## Test powtórkowy otwarty, dopóki są zaległe (2026-11-18)

Bramka zaległych powtórek działała, ale miała jedną prędkość: dwanaście słówek dziennie. Kafelek
testu był otwarty dokładnie wtedy, gdy stała bramka, a zdany test zdejmował blokadę do końca dnia
— i zabierał ze sobą test. Dziecko, któremu po tygodniu przerwy uzbierało się czterdzieści
zaległych słówek, odrabiało dziś dwanaście i na resztę musiało czekać do jutra. Kolejka z jednego
tygodnia schodziła tygodniami, choć dziecko chciało ją zbić od razu.

Rozdzielamy więc dwie rzeczy, które dotąd liczyła jedna funkcja: **blokada lekcji** zostaje jak
była (`review_gate_on`: dziesięć zaległych zamyka kurs, zdany test zwalnia do końca dnia), a
**test** jest otwarty, dopóki w kursie jest choć jedno zaległe słówko z zadaniem.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Kiedy test jest otwarty | `course_due_words > 0`, niezależnie od bramki | powtarzanie z własnej woli ma być możliwe zawsze, a nie tylko pod przymusem zamkniętych lekcji | otwarty tylko przy stojącej bramce (tak było: po zdanym teście kolejka czekała do jutra) |
| Czy zdjąć zwolnienie „do końca dnia" | nie | blokada trzymana aż do opróżnienia kolejki nie puściłaby po przerwie do żadnej lekcji — to ten sam błąd, przed którym broni wpis o bramce | blokada do spadku poniżej progu |
| Ile testów dziennie | tyle, ile starczy zaległych słówek | każde podejście bierze kolejne dwanaście najdłużej zaległych, a każda odpowiedź przesuwa termin — kolejka ogranicza się sama | sztywny limit trzech dziennie (próg wzięty z powietrza) |
| Punkty za kolejne podejścia | normalne, jak za każdą zdaną sesję | to dwanaście prawdziwych odpowiedzi, a nie klikanie w kółko: po kilku podejściach nie ma już z czego ułożyć testu | nagroda tylko za pierwszy test w dniu (karze za nadrabianie) |
| Wejście na ekranie | karta „🔁 Powtórki" z przyciskiem „Powtórz teraz", gdy bramka nie stoi | kafelek testu jest schowany między działami, a dziecko ma widzieć kolejkę swojego kursu — pasek u góry sumuje wszystkie kursy | sam licznik bez przycisku (dziecko widzi liczbę i nie ma jak nic z nią zrobić) |

Opróżniona kolejka oznacza, że kafelek znika sam: `course_due_words` spada do zera i test nie ma
z czego powstać. Dlatego nie potrzeba osobnego warunku „dość na dziś".

## Zamknięte w odcieniach szarości (2026-11-18)

Bramka zaległych powtórek zamykała w bazie wszystkie lekcje kursu, ale ekran dalej wyglądał
zapraszająco: szarzał sam kafelek lekcji, a gwiazdki, liczba słówek, kwadraciki etapów i poziomów
oraz cała karta kursu na liście zostawały w pełnym kolorze. Dziecko dotykało więc kafelka po
kafelku, a lista kursów nie mówiła wprost, że w tym kursie nie ma teraz czego klikać poza testem.

Od teraz **zamknięte jest szare w całości**: karta kursu trzymanego bramką (z kłódką zamiast
strzałki i zdaniem, ile słówek czeka) oraz każde zamknięte pudełko lekcji razem z zawartością.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Czym szarzymy | filtrem na całym pudełku (`filter: grayscale(1)`, na telefonie `filter: [{ grayscale: 1 }]`) | w pudełku lekcji siedzi kilkanaście kolorowych drobiazgów (emoji, gwiazdki, kwadraciki, flaga kursu, obrazek flagi) i każdy musiałby mieć swój wariant „na szaro" | własny kolor dla każdego elementu; samo `opacity` (przygasza, ale czerwień zostaje czerwienią) |
| Czy zamknięty kurs dalej da się otworzyć | tak, karta zostaje klikalna | w kursie czeka test powtórkowy, czyli jedyne wyjście z blokady — martwa karta zabierałaby dziecku drogę dalej | karta nieaktywna; ukrycie kursu z listy |
| Kłódka do otwarcia punktem | zostaje w kolorze (szarzeje tylko lekcja bez tego wyjścia) | lekcja jest w zasięgu — za punkt odblokowania otwiera się od razu, a szary mówiłby, że nie; to ta sama zasada, co osłabiony filtr na samym kafelku (`data-unlockable`) | szarość na każdej kłódce |
| Kwadraciki poziomów w zamkniętej lekcji | szarzeją razem z pudełkiem | reguła „zamknięty poziom blednie w swoim kolorze" jest po to, żeby dziecko widziało, co się po przejściu łatwego otworzy — a w zamkniętej lekcji nie otworzy się nic | kolor poziomu także w zamkniętej lekcji (jeden kolorowy element w szarym pudełku czyta się jak usterka) |
| Skąd ekran wie o blokadzie | `review_gate` per kurs, także na liście kursów (web i telefon) | regułę liczy baza, a lista kursów dotąd o nią nie pytała wcale | liczenie zaległych w przeglądarce z `v_my_stats` (pasek sumuje wszystkie kursy, a bramka liczy każdy osobno) |

Na telefonie `filter` wymaga nowej architektury Reacta Native — domyślnej od Expo SDK 55, czyli
tej, na której aplikacja stoi. Gdyby jej kiedyś nie było, filtr nic nie zrobi, dlatego szarość nie
wisi na nim samym: kwadraciki dostają szary kolor wprost, strzałkę zastępuje szara kłódka, a całe
pudełko przygasza `opacity`.

## Powtórka działu: dobrowolna, losowa, bez stawki (2026-11-18)

Dział kończył się jednym kafelkiem — „Testem działu". Test jest bramką: ma próg, otwiera
następny dział i robi się go raz, bo po zdaniu nie ma po co wracać. Nie było więc niczego, czym
dziecko mogłoby przećwiczyć dział jeszcze raz dla samego ćwiczenia.

Od teraz każdy dział ze słówkami dostaje drugi kafelek końcowy, **Powtórkę działu** (🔁):
piętnaście zadań losowanych z całego działu, po jednym na słówko, losowy typ zadania. Powstaje
sama, tym samym wyzwalaczem co test (`add_unit_test`), więc nie ma działów, w których ktoś
o niej zapomniał.

Rodzaj `review` z zasięgiem działu istniał od pierwszych migracji i robił prawie to samo — tyle
że brał słówka wyłącznie z kolejki FSRS (`srs_state`), czyli te, które dziecko już widziało
i które akurat są zaległe. Dla „chcę przećwiczyć dział" to zły dobór: tuż po przerobieniu działu
zaległych nie ma prawie wcale, więc powtórka bywała pusta dokładnie wtedy, kiedy jest
najbardziej potrzebna.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Rodzaj lekcji | istniejący `review` z `review_scope_unit_id` | to samo zachowanie już się tak nazywało; zmienia się dobór słówek, nie pojęcie | czwarta wartość w `lesson_kind` (trzecia gałąź do dopisania w każdej funkcji pytającej o rodzaj) |
| Dobór słówek | losowo z całego działu | powtórka ma utrwalać dział, także słówka nigdy nie powtarzane; od kolejki zaległych jest osobny test powtórkowy kursu | dobór ważony FSRS z dopełnieniem losowymi (dziecko wybiera powtórkę, żeby przećwiczyć dział, a nie żeby baza wybrała za nie) |
| Kiedy się otwiera | razem z testem działu, po komplecie zaliczonych lekcji | „powtórz" ma sens dopiero wtedy, gdy jest co powtarzać | po pierwszej zaliczonej lekcji (tak było i znaczyło „powtórz dział, którego jeszcze nie przerobiłeś") |
| Co blokuje | nic | jest dobrowolna; następny dział nadal otwiera wyłącznie zdany test | powtórka jako warunek testu (dołożona praca obowiązkowa pod nazwą „dodatkowa") |
| Ile zadań | 15, czyli `stage_size` | jedno podejście, a nie kilka etapów pod rząd; tyle samo co test | 12 jak w teście powtórkowym kursu (tam limit wynika z kolejki zaległych, nie z długości lekcji) |
| Powtarzanie | bez ograniczeń, każde podejście losuje od nowa | o to w niej chodzi | limit podejść dziennie (próg wzięty z powietrza) |
| Punkty za podejście | pełne `xp_reward` (30) za każde zdane | zwykła lekcja robiona drugi raz też płaci, a tu trzeba poprawnie odpowiedzieć piętnaście razy | zero punktów za powtórzone podejście (karanie za ćwiczenie) |
| Kolejność kafelków | powtórka ZA testem (`sort_order` 110) | oba otwierają się w tej samej chwili, więc pierwszy ma być ten, który prowadzi dalej | przed testem (rozgrzewka przed bramką — ale wtedy droga dalej jest drugim kafelkiem od końca) |

Seed przestał zakładać powtórki sam: robi to wyzwalacz, a dopisanie ich w `seed.sql` dawało
w każdym dziale dwie. `review.test.sql` opisuje teraz stan po zmianie — że powtórka czeka na
komplet lekcji, bierze słówka nigdy nie powtarzane i otwiera się po raz drugi.

## Test powtórkowy dopiero od pięciu zaległych (2026-11-18)

Otwarcie testu „na żądanie" (wpis wyżej) poszło o krok za daleko: kafelek stał otworem już przy
jednym zaległym słówku, więc ekran kursu witał kartą „Powtórki" z przyciskiem „Powtórz teraz",
za którym czekały dwa zadania. Lekcja, która kończy się, zanim dziecko zdąży się w nią wciągnąć,
nie jest warta zajmowania pierwszego miejsca na ekranie.

Od teraz test otwiera się od **pięciu** zaległych słówek (`review_test_min`), a przy krótszej
kolejce karta zamienia się w sam licznik: „🔁 3 słówka do powtórzenia — test otworzy się przy 5".

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Próg otwarcia | pięć zaległych słówek | tyle, żeby podejście było lekcją, a nie dwoma kliknięciami; kolejka i tak urośnie do jutra | trzy (wciąż chwila); dziesięć, czyli próg bramki (znosiłoby całe „na żądanie" — test pojawiałby się dokładnie wtedy, gdy i tak nie ma czego innego kliknąć) |
| Stojąca bramka a próg | bramka wygrywa: stoi, to test jest otwarty | po oblanym teście licznik spada poniżej pięciu (błędna odpowiedź też przesuwa termin), a kurs zostaje zamknięty zatrzaskiem — próg zamknąłby wtedy jedyne wyjście | próg bez wyjątku (kurs bez ani jednego otwartego wejścia) |
| Gdzie mieszka reguła | `review_test_open` w bazie, używana i przez `is_lesson_unlocked`, i przez `review_gate` | ekran nie liczy progu po swojemu, więc karta i kafelek nie mogą się rozjechać | porównanie `due >= 5` w przeglądarce i w telefonie (ta sama liczba w trzech miejscach) |
| Co widzi dziecko przy krótkiej kolejce | licznik z progiem, bez przycisku | bez tego „🔁 3" w pasku na górze wygląda na zadanie, którego nie da się wykonać | ukrycie licznika (dziecko nie wie, że coś czeka); przycisk prowadzący donikąd |

## Trzydzieści odznak zamiast ośmiu (2026-11-18)

Osiem odznak i pięć rodzajów reguł wystarczało na pierwszy tydzień: dziecko zbierało „Pierwszy
krok", „Bez błędu", „Trzy dni z rzędu" i „Dziesięć słówek" w dwa wieczory, a potem na ekranie
nagród zostawały trzy kłódki odległe o setki punktów. Ekran, na którym nic nie jest blisko,
przestaje być po co otwierany.

Teraz jest trzydzieści odznak w dziesięciu drabinkach (lekcje, bezbłędne przejścia, gwiazdki,
trudniejsze poziomy, sprawdziany, seria dni, słówka, dobre odpowiedzi, czas nauki, punkty), a przy
każdej niezdobytej stoi „7 z 10" i pasek. Siedem nowych rodzajów reguł liczy to, co dziecko i tak
widzi na swoich postępach: gwiazdki, zdane wejścia wyżej, sprawdziany, odpowiedzi, minuty.

| Decyzja | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Skąd nowe odznaki | wiersze w `badges` z nowymi `rule.kind` | reguły są deklaratywne od pierwszej migracji; dołożenie progu to wiersz, nie kod | osobna tabela na „wyzwania" (drugi mechanizm obok działającego) |
| Liczenie wartości reguł | jedna funkcja `badge_values()` zwracająca `jsonb` z wszystkimi licznikami | `award_badges()` wykonywało jedno zapytanie na niezdobytą odznakę — przy trzydziestu byłoby trzydzieści po każdej lekcji | zapytanie per odznaka (koszt rośnie z każdą nową nagrodą) |
| `badge_values` jest `volatile` | tak, mimo że tylko czyta | funkcja `stable` widzi bazę z chwili rozpoczęcia zewnętrznej instrukcji, więc drugie przejście `award_badges` nie widziało punktów z pierwszego i odznaka za punkty przychodziła o lekcję za późno | `stable` (szybsza, ale w praktyce gubiła nagrodę) |
| Odznaka płacąca punktami | dwa przejścia w `award_badges()` | „Pięć trudnych poziomów" (250 pkt) potrafi dociągnąć licznik do progu „Pięciuset punktów"; dziecko dostaje obie w tej samej chwili | jedno przejście (nagroda przychodzi po następnej lekcji, bez widocznego powodu); pętla do wyczerpania (żadna odznaka nie płaci tyle, żeby przeskoczyć dwa progi punktowe) |
| Ile brakuje | `my_badge_progress()` w bazie, wartość przycięta do progu | trzydzieści jednakowych kłódek nie mówi, czy brakuje jednej lekcji, czy czterdziestu; progi zostają tam, gdzie są liczone | liczenie w przeglądarce i w telefonie z `badges.rule` (te same progi w trzech miejscach) |
| Wygląd niezdobytej | przygaszona sama ikona, opis i pasek w pełnych barwach | to opis mówi, co trzeba zrobić — wyszarzenie całej karty ukrywało właśnie tę informację | `opacity` i `grayscale` na całej karcie (paska postępu nie da się z tego wyłączyć) |
| Kolejność na liście | drabinkami tematycznymi, w każdej od najłatwiejszej | lista czyta się jak kolekcja, a pasek i tak pokazuje, co jest blisko | sortowanie po „ile brakuje" (ta sama odznaka co tydzień w innym miejscu listy) |
| Progi istniejących ośmiu | bez zmian | odznaka już zdobyta nie może przestać być zdobyta; zmienia się tylko `sort_order` | podniesienie progów „żeby było więcej do zrobienia" (odebranie nagrody za pracę, która została wykonana) |
