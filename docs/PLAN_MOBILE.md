# Aplikacja na telefon — plan

Dokument planistyczny: **tylko tryb ucznia**. Telefon służy do robienia kursów i niczego więcej —
nie ma w nim panelu administratora ani widoku rodzica. Wzorcem rozbicia prac jest sąsiedni projekt
ExpeditionPlan (`D:\AI\ExpeditionPlan`), gdzie web planuje, a telefon „przeżywa wyjazd”; tutaj web
tworzy i pilnuje treści, a telefon uczy.

Zasady z `CLAUDE.md` obowiązują bez wyjątku: ocenia baza, klucze odpowiedzi nie opuszczają bazy,
autoryzacja jest w RLS i funkcjach `security definer`. Telefon jest **kolejnym klientem tych samych
funkcji**, nie drugą implementacją logiki.

---

## 1. Zakres

### Jest na telefonie

| Obszar | Skąd to się bierze |
|---|---|
| Logowanie e-mail + hasło, pamiętana sesja | `auth`, bez zakładania konta |
| Lista kursów ucznia | `list_courses_started`, `enrollments` |
| Mapa działów i lekcji: gwiazdki etapów, kwadraciki poziomów, kłódki | widok `v_my_lessons`, `is_lesson_unlocked`, `is_unit_unlocked` |
| Lekcja w etapach po 15 zadań, dziewięć typów zadań | `start_lesson_session`, `get_lesson_exercises`, `submit_attempt`, `finish_lesson_session` |
| Podpowiedzi (łatwiejszy wariant tego samego słówka) | `use_hint`, `hints_left`, `hint_status` |
| Bramka zaległych powtórek przed nową lekcją | `review_gate` |
| Powtórka działu i test na koniec działu | `get_review_set`, `pick_test_exercises` |
| Plansza ze słówkami (tryb nauki przed lekcją) | treść lekcji |
| Nagrody: osiem odznak ze stanem zdobycia | `badges`, `user_badges` |
| Statystyki własne: punkty, seria, umiane i zaległe, wykres tygodnia | `points_ledger`, `srs_state`, `learner_today` |
| Wymowa słówka | syntezator mowy telefonu, `audio_path` jako zapas |
| Codzienne przypomnienie o powtórkach | powiadomienie lokalne, liczba zaległych z bazy |

### Nie ma na telefonie

Panel administratora w całości (`/admin/*`: import lekcji, kursy, działy, słówka, zadania, konta,
zaproszenia, biblioteka mediów, statystyki aplikacji, ustawienia), **widok rodzica** (lista dzieci,
karta dziecka `/dziecko/[id]`, prośby o dostęp do dziecka i do kursu, poprawianie danych dziecka)
oraz **zakładanie konta i zmiana hasła**.

Konto powstaje wyłącznie z linku z zaproszeniem, otwartego w przeglądarce — tak jak dziś, przez hook
`before_user_created`. Telefon tylko loguje się na gotowe konto. Tak samo robi ExpeditionPlan
(`docs/ZNAJOMI.md`: najpierw link w przeglądarce i konto, potem APK i logowanie) i nie ma powodu
wnosić do aplikacji drugiej ścieżki rejestracji.

Konsekwencja dla administratora i rodzica, którzy uczą się jak dziecko (decyzje z 2026-11-16
„Administrator uczy się jak dziecko” i „Rodzic uczy się swoich kursów”): na telefonie są zwykłym
uczniem. Widzą swoje kursy, nie widzą kafelków dzieci ani panelu. Do sprawdzenia postępów dziecka
rodzic wchodzi na web.

---

## 2. Co bierzemy z ExpeditionPlan, a czego nie

| Wzorzec z ExpeditionPlan | Tutaj |
|---|---|
| Expo + `expo-router`, dev build zamiast Expo Go | **tak** — `apps/mobile` w tym samym monorepo |
| `AGENTS.md` w `apps/mobile` z regułą „nie wierz pamięci o Expo, czytaj wersjonowane dokumenty” | **tak**, przenosimy prawie 1:1 — SDK łamie API co wydanie |
| EAS: profile `preview` (właściciel) i `friends` (inni), OTA `eas update` na kanał | **tak**, z kanałem `dzieci` zamiast `friends` |
| Wspólna logika w `packages/core` jako źródła TypeScript, bez importów z Node i przeglądarki | **tak** — `packages/core` już taki jest (`main: src/index.ts`, rozszerzenia `.ts` w importach) |
| Dokument „Analiza telefonu” z brakami P1/P2/P3 i podziałem na OTA i APK | **tak, ale po pierwszym tygodniu używania**, nie przed |
| `packages/sync`: SQLite, outbox, `pull_changes`, brak twardych usunięć | **nie w MVP** — patrz decyzja o offline niżej |
| Mapy offline, geofencing, mowa w tle, zadania w tle | nie dotyczy |
| Osobny kanał aktualizacji sprawdzany najpierw u właściciela | **tak** — dziecko nie jest poligonem |

Najważniejsza różnica: w ExpeditionPlan silnik harmonogramu jest w `packages/core` i liczy się
identycznie w przeglądarce, na telefonie i w Edge Function, więc offline było naturalne. Tutaj
silnikiem jest `submit_attempt` w Postgresie — i to przesądza o punkcie 3.2.

---

## 3. Decyzje do podjęcia przed pierwszą linią kodu

Obie trafią do `docs/DECYZJE.md` razem z tym, co odrzucone.

### 3.1. Native (Expo) czy PWA

| Wariant | Za | Przeciw |
|---|---|---|
| **Expo / React Native, Android** (rekomendacja) | przewidywalna mowa (`expo-speech` + głosy systemowe offline), powiadomienia o powtórkach z dokładnym alarmem, ikona i pełny ekran bez proszenia o „Dodaj do ekranu głównego”, zapas na offline w v1.x, OTA | drugi interfejs — dziewięć typów zadań to ~1100 linii Reacta do przepisania na komponenty RN; EAS i podpisywanie; iOS poza zasięgiem bez konta Apple |
| **PWA, czyli to co już jest** | `manifest.ts` istnieje, interfejs sprawdzony przy 375 px, zero nowego kodu | Web Speech API jest zawodne i projekt już to notuje jako pułapkę (`getVoices()` puste przy pierwszym wywołaniu, część Androidów bez głosu `en-GB`, iOS wymaga dotknięcia); powiadomienia codzienne na iOS praktycznie nie istnieją, na Androidzie giną przy czyszczeniu danych; dziecko samo nie zainstaluje skrótu |
| **WebView z adresem produkcyjnym + most do mowy i powiadomień** | jeden interfejs, najszybsza droga do ikony na ekranie | daje ikonę i niewiele więcej: offline nadal niemożliwe, zachowanie przewijania i powiększania obce, trudniejsze szukanie błędów, a przy awarii sieci biała strona zamiast komunikatu |

Rekomendacja: **Expo, tylko Android** (jak ExpeditionPlan). PWA zostaje tym, czym jest dziś —
manifestu nie usuwamy, bo tablet w domu działa na nim dobrze. WebView zostaje wariantem awaryjnym,
jeśli pomiary z PoC-M2 i PoC-M3 wyjdą tak, że mowa i powiadomienia z przeglądarki wystarczą.

**Decyzja (2026-11-16): Expo.** Wariant WebView odpada bez pomiaru — jego jedyną zaletą było
oszczędzenie drugiego interfejsu, a kosztem jest to, czego ta aplikacja najbardziej potrzebuje
(mowa, przypomnienia, zapas na offline). Wpis w `docs/DECYZJE.md`.

iOS: poza planem. Bez konta dewelopera Apple nie ma czym rozdawać aplikacji, a dla jednego iPada
PWA wystarcza.

### 3.2. Offline: czego telefon **nie** będzie umiał w MVP

Nauka offline wymaga kluczy odpowiedzi na telefonie, a to łamie regułę „`exercises` nie ma polityki
SELECT dla ucznia; `get_lesson_exercises` wycina `accepted`/`answer`/`solution`”. Lokalna ocena
w `packages/core` byłaby drugą implementacją normalizacji — dokładnie tym, co `DECYZJE.md` odrzuciło
jako „ocenę podwójną”.

Dlatego **MVP telefonu jest online**. Cała obsługa braku sieci to: czytelny ekran „Potrzebny
internet” z przyciskiem „Spróbuj jeszcze raz” zamiast białej strony albo wiszącego „Wczytuję…”.
Z ExpeditionPlan przenosimy przy tym jedną twardą lekcję (P1.1 z `ANALIZA_TELEFON.md`): klient
Supabase nie ma własnego limitu czasu, więc przy jednej kresce zasięgu zapytanie wisi dziesiątki
sekund. Limit czasu w `fetch` klienta jest obowiązkowy od pierwszego ekranu.

Co może działać bez sieci później (v1.x, osobna decyzja): plansza ze słówkami i tłumaczenia — one
i tak pokazują odpowiedzi, więc nie ma czego chronić — oraz odczyt nagród i statystyk z ostatniego
pobrania. Zadania offline tylko wtedy, gdy świadomie zmienimy regułę o kluczach; na telefonie
dziecka zagrożeniem jest samo dziecko zaglądające do pliku, nie obcy.

---

## 4. Etapy

Każdy etap kończy się kryterium odbioru sprawdzalnym na fizycznym telefonie, nie w emulatorze.

### Etap M0 — szkielet i bramka decyzyjna

`apps/mobile`: Expo (SDK 58), `expo-router`, sesja Supabase w `localStorage` z expo-sqlite
(SecureStore ma limit 2 KB na wartość, a token sesji bywa dłuższy), dev build na telefonie
właściciela. Trzy pomiary, każdy mały i rozstrzygający:

- **PoC-M1 — czy baza wpuszcza telefon.** Logowanie, `start_lesson_session`, `submit_attempt`
  z `@supabase/supabase-js` w React Native (polyfill URL, odświeżanie tokenu przy powrocie
  aplikacji na pierwszy plan). Pomiar: czas od dotknięcia „Sprawdź” do werdyktu na LTE. Próg:
  < 400 ms — decyzja o regionie `dub1` mówi, że 200 ms to różnica między „natychmiast”
  i „zacina się”.
- **PoC-M2 — mowa.** `expo-speech`: czy na telefonie dziecka jest głos `en-GB` i `pl-PL`, jak
  brzmi bez sieci, czy `getAvailableVoicesAsync()` pozwala sprawdzić jego obecność **przed**
  pokazaniem zadania ze słuchu. Web ma już na ten wypadek `onSkip` („nie licz tego zadania”) —
  przenosimy to zachowanie, a nie wymyślamy nowego.
- **PoC-M3 — przypomnienie o powtórkach.** `expo-notifications` z dokładnym alarmem
  (`SCHEDULE_EXACT_ALARM` w `app.json` — w ExpeditionPlan brak tego uprawnienia opóźniał
  powiadomienia o kilkanaście minut) i liczbą zaległych słówek w treści. Pomiar: czy przychodzi
  przy wygaszonym ekranie, po restarcie telefonu i nazajutrz bez otwierania aplikacji.
**Kryterium odbioru:** na fizycznym telefonie dziecko loguje się do APK, robi jedno zadanie
`translate_ab` ocenione przez bazę, słyszy słówko po angielsku, a nazajutrz dostaje powiadomienie
o powtórkach. Wyniki trzech pomiarów dopisane do `docs/DECYZJE.md`. **Bez tej bramki Etap M1
nie startuje.**

**Stan (2026-11-16):** kod bramki jest, pomiarów nie ma — do zrobienia na telefonie.
Powstało `apps/mobile` (Expo 58, `expo-router`, EAS z profilami `development`, `preview`
i `dzieci`), klient Supabase z limitem 15 s, logowanie e-mailem i hasłem oraz trzy ekrany
pomiarowe: PoC-M1 (`zadanie.tsx` — lekcja z `v_my_lessons`, `start_lesson_session`,
`get_lesson_exercises`, `submit_attempt`, `finish_lesson_session`, mediana czasu werdyktu wobec
progu 400 ms; obsługuje cztery typy zadań tekstowych i wyborowych), PoC-M2 (`mowa.tsx` — lista
głosów, obecność `pl-PL` i `en-GB`, wymowa) i PoC-M3 (`powiadomienia.tsx` — zgoda, dokładne
alarmy, liczba zaległych słówek w treści, przypomnienie za minutę i codzienne o 17:00).
`npm run check` przechodzi razem z telefonem, `npx expo-doctor` bez uwag.

`dbErrorMessage` przeniesiony z `apps/web/src/lib` do `packages/core` — tych samych funkcji bazy
woła przeglądarka i telefon, a komunikat o odmowie nie ma brzmieć w nich inaczej. `sync-env.mjs`
pisze teraz także `apps/mobile/.env.local` (`EXPO_PUBLIC_*` z tych samych wartości co
`NEXT_PUBLIC_*`; telefon zawsze dostaje adres z chmury, bo `127.0.0.1` komputera i tak by nie
zobaczył).

Czego brakuje do pierwszego uruchomienia: `eas init` na koncie właściciela (wpisze
`extra.eas.projectId` i `updates.url`) oraz dev build `eas build --profile development`.
Expo Go nie wystarczy — powiadomienia, mowa i SQLite to moduły natywne.

### Etap M1 — mapa i lekcja

`@lingomemo/core` i `@lingomemo/db` używane przez Metro (pakiety z workspace jako źródła TS).
Ekrany: kursy → mapa działów i lekcji → lekcja → podsumowanie. Najpierw cztery typy zadań bez
grafiki i bez dotykowych układanek: `translate_ab`, `translate_ba`, `fill_blank_choice`,
`listening`. Etapy po 15 zadań, pasek postępu, bramka zaległych powtórek, podpowiedzi, jedna
szansa na poprawienie literówki (werdykt `retry` z rozróżnieniem `typo` i `order`).

Logika z `lesson-actions.ts` przenosi się jako cienki moduł klienta — te same RPC, bez Server
Actions. Nowego backendu nie ma i być nie powinno: prawa i ocena są w bazie, a `requireUser()`
na webie jest tylko bramką na interfejs.

**Kryterium odbioru:** dziecko przechodzi lekcję demo na telefonie od mapy do podsumowania;
gwiazdki, punkty i stan powtórek zgadzają się z tym, co o tej samej lekcji pokazuje web.

**Stan (2026-11-16):** kod jest, przejścia lekcji na telefonie jeszcze nie było (brak dev buildu).
Powstało:

- **Kursy** (`app/index.tsx`): kursy, na które uczeń jest zapisany; wejście w kurs. Kursu bez
  zapisu nie pokazujemy wcale — w bazie jest zamknięty, a o dopisanie prosi się na webie.
- **Mapa kursu** (`app/kurs/[slug].tsx`): działy, kafelki lekcji z ikoną, gwiazdkami i liczbą
  słówek, kwadraciki etapów (z gwiazdkami etapu) oraz wejścia na poziom średni i trudny, karta
  bramki zaległych powtórek, powody zamknięcia pod kafelkiem. Dotknięcie kafelka otwiera „to,
  co dalej": po zaliczeniu łatwego — średni, potem trudny.
- **Lekcja** (`features/lesson/`): `api.ts` (te same RPC co w webowych Server Actions),
  `load.ts` (dane przed pierwszym zadaniem, wybór etapu i poziomu z adresu), `runner.tsx`
  (pasek postępu, etap i poziom, licznik podpowiedzi, podpowiedź, „Nie wiem, pomiń", jedna
  szansa na poprawienie literówki z rozróżnieniem `typo`/`order`, informacja zwrotna
  z automatycznym przejściem dalej odkładanym przy każdym dotknięciu ekranu, podsumowanie
  etapu i lekcji z gwiazdkami, punktami, serią i odznakami).
- **Cztery typy zadań**: `translate_ab`, `translate_ba` i `inflection` jako pisanie,
  `fill_blank_choice` (oraz `translate_ab` z opcjami) jako wybór, `listening` ze słuchu.
  Mowa przez `expo-speech` (`lib/speak.ts`): brak głosu dla języka kursu pomija zadanie
  ze słuchu BEZ zapisania próby — tak samo jak web.

Sprawdzone: `npm run check` zielone, bundle Metro się składa, a składnia wszystkich zapytań
i sygnatury RPC — na lokalnej bazie (widoki `v_my_lessons` i `v_my_lesson_levels`, zagnieżdżone
`lessons → units!unit_id → courses!inner`, `get_lesson_exercises`, `review_gate`, `hints_left`,
`setting_int`). Niesprawdzone: cokolwiek na ekranie telefonu.

Czego w M1 nie ma: dźwięków reakcji i animacji (web ma je z Web Audio; na telefonie to osobna
zależność), flag języków jako obrazków (zostaje ikona kursu), nagrań z pola `audio_path`
(potrzebny `expo-audio`) oraz planszy ze słówkami („sowa" przy kafelku) — ta jest w M3 razem
z trybem nauki.

### Etap M2 — pozostałe typy zadań, dotyk i obrazki

`inflection`, `match_pairs`, `sentence_order`, `listen_match`, `image_choice`. Obrazki z bucketu
`lesson-media` przez `expo-image` z pamięcią podręczną na dysku; w treści lekcji stoi ścieżka,
nie adres (jak `mediaUrl` na webie). Pary i rozsypanka na dotknięcia, bez przeciągania — web
robi to tak samo i działa.

Rozmiary z `CLAUDE.md` przenosimy jako wartości w stylach RN: przycisk 56, kafel odpowiedzi 72,
tekst 20. Z ExpeditionPlan bierzemy ostrzeżenie P2.4: tam „mały” przycisk miał 32 dp i dziecko
w niego nie trafiało. Motyw (kolory, `--tap`, czcionki Nunito i Baloo) przechodzi z `globals.css`
do jednego pliku `constants/theme.ts` — nie rozsypujemy go po komponentach.

**Kryterium odbioru:** lekcja „Zwierzęta domowe” z kompletem dziewięciu typów przechodzi na
telefonie bez przewijania w poziomie, a wybór obrazka ma zawsze cztery kafelki w dwóch kolumnach.

### Etap M3 — powtórki, test działu, nagrody, statystyki

`get_review_set`, test na koniec działu, plansza ze słówkami, ekran nagród, statystyki ucznia
(punkty, seria, umiane i zaległe, wykres tygodnia). Codzienne przypomnienie o powtórkach o godzinie
wybranej w ustawieniach aplikacji, z liczbą zaległych; wyłączalne jednym przełącznikiem, przeliczane
po każdej lekcji i raz na dobę.

**Kryterium odbioru:** dziecko dostaje po południu powiadomienie „5 słówek czeka”, wchodzi
z powiadomienia wprost w powtórkę, robi ją i seria dni rośnie.

### Etap M4 — dystrybucja i stabilizacja

APK na kanale `dzieci` (`eas build --profile dzieci`), aktualizacje OTA najpierw na kanał
właściciela, do dzieci osobnym poleceniem i tylko ze sprawdzonego commita. `expo-updates`
z propozycją restartu. Obsługa wygaśnięcia sesji bez wyrzucania na biały ekran. Krótki
`docs/TELEFON.md` dla rodzica: instalacja z linku w Chrome, zgoda na źródło, „Zainstaluj mimo to”
w Play Protect — wszystkie trzy pułapki opisane w `ZNAJOMI.md` są prawdziwe.

**Kryterium odbioru:** dziecko instaluje APK z linku, loguje się kontem z zaproszenia i robi lekcję;
następna poprawka dochodzi do niego jako OTA, bez ponownej instalacji.

### Po M4

Dokument `docs/ANALIZA_TELEFON.md` na wzór ExpeditionPlan: co działa, braki P1/P2/P3, każdy z
oznaczeniem, czy to sama zmiana JS (OTA), czy nowy APK. Pisany po tygodniu prawdziwego używania
przez dziecko, nie przed — w ExpeditionPlan ten dokument znalazł rzeczy, których nie dało się
przewidzieć przy projektowaniu (wiszące zapytania przy słabym zasięgu, data „dziś” w UTC).

---

## 5. Struktura i polecenia

Stan na bramce M0 (ekrany M1–M3 dołożą `features/` i `components/` z prawdziwymi zadaniami):

```
apps/mobile/
  app.json            # nazwa, pakiet pl.lingomemo.app, SCHEDULE_EXACT_ALARM, wtyczki
  eas.json            # profile: development, preview (właściciel), dzieci
  AGENTS.md           # reguły pracy z Expo („nie wierz pamięci modelu”)
  assets/             # ikona i wariant maskowalny (te same rysunki co PWA)
  src/
    app/              # ekrany expo-router: index, logowanie, zadanie, mowa, powiadomienia
    components/ui.tsx # przycisk, kafel, karta, pole — odpowiedniki klas z globals.css
    constants/theme.ts
    lib/              # supabase.ts (limit 15 s), session.ts, clock.ts
```

Polecenia w katalogu głównym: `npm run mobile` (sync-env + `expo start`), `npm run ota`
i `npm run ota:dzieci`, `npm run apk` i `npm run apk:dzieci`. Typecheck i lint telefonu wchodzą
do `npm run check` same, bo `npm run typecheck --workspaces --if-present` obejmuje nowy pakiet.
Buildu EAS do bramy jakości **nie** wnosimy — trwa minuty i wymaga sieci; bramą dla telefonu jest
kryterium odbioru etapu.

---

## 6. Czego ten plan nie rozstrzyga

- Kolejność etapów po M4 ustala pierwszy tydzień używania, nie ten dokument.
- Nauka offline — osobna decyzja, razem z regułą o kluczach odpowiedzi (3.2).
- iOS — poza planem, dopóki nie ma konta dewelopera Apple.
- Tablet: dziś działa jako PWA i tak zostaje; aplikacja natywna jest dla telefonu.
