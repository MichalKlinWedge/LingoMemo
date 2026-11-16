# Aplikacja na telefonie i tablecie dziecka

Aplikacja LingoMemo (Android) służy wyłącznie do nauki. Panelu administratora i widoku rodzica
w niej nie ma — to zostaje na stronie w przeglądarce. Plan i etapy: `docs/PLAN_MOBILE.md`.

---

## Dla właściciela: skąd się bierze plik do instalacji

Dziecko dostaje **osobny APK** z kanału `dzieci`. Aktualizacje wysyłane poleceniem `npm run ota`
trafiają tylko na telefon właściciela; do dzieci idzie wersja sprawdzona, osobnym poleceniem.

```bash
npm run apk:dzieci   # nowy APK dla dzieci (gdy zmieni się coś natywnego albo uprawnienie)
npm run ota          # poprawka JS u właściciela — najpierw sprawdzamy u siebie
npm run ota:dzieci   # ta sama poprawka do dzieci, z tego samego commita
```

Po zbudowaniu EAS podaje link ze stroną instalacyjną — ten link wysyłamy albo otwieramy na
tablecie. Historia buildów: https://expo.dev/accounts/klin.michal/projects/lingomemo/builds

Komunikat przy poprawce OTA bierze się sam z tematu ostatniego commita, razem z jego numerem —
nie trzeba go wpisywać, a na pulpicie EAS od razu widać, co poszło na telefon. Własny komunikat
podaje się skryptowi wprost: `node scripts/ota.mjs preview --message "…"` (przez `npm run ota --`
to nie przejdzie, bo npm zabiera takie flagi dla siebie).

**Nowego APK wymaga tylko zmiana natywna**: nowy moduł (np. obrazki SVG przez `expo-image`),
nowe uprawnienie, zmiana w `app.json`. Zmiany w kodzie aplikacji idą przez OTA i dochodzą same.

Adres bazy i klucz publiczny są zapisane po stronie EAS (środowisko `preview`), bo `.env.local`
nie jedzie do chmury:

```bash
npx eas-cli@latest env:list --environment preview
```

---

## Instalacja na tablecie albo telefonie dziecka

1. **Dziecko musi już mieć konto.** Konto zakłada się wyłącznie z linku z zaproszeniem, otwartego
   w przeglądarce — aplikacja tylko loguje. Jeśli dziecko uczy się dotąd przez przeglądarkę, ma
   konto i nic więcej nie trzeba.
2. **Otwórz link do APK bezpośrednio w Chrome na tablecie** i zainstaluj z „Pobranych". Plik
   skopiowany przez Dysk Google czy menedżer plików bywa niepełny i kończy się komunikatem
   „Aplikacja nie została zainstalowana".
3. Android zapyta o zgodę na instalację z tego źródła (Chrome → „Zezwalaj z tego źródła") — to
   normalne dla aplikacji spoza Sklepu Play.
4. **Google Play Protect** może pokazać „Aplikacja została zablokowana, aby chronić urządzenie"
   (nie zna dewelopera) — wybierz **„Zainstaluj mimo to"** nad przyciskiem OK, nie samo OK.
5. Otwórz aplikację i zaloguj się kontem dziecka (ten sam e-mail i hasło co w przeglądarce).
6. Nowa wersja instaluje się na starą — konto, punkty i postępy zostają, bo wszystko liczy baza.

## Co ustawić po pierwszym zalogowaniu

- **Przypomnienie o powtórkach** — przełącznik na dole ekranu kursów, godzina do wyboru.
  Android zapyta o zgodę na powiadomienia, a potem warto włączyć **dokładne alarmy** (przycisk
  pokazuje się sam, gdy ich nie ma): bez nich system przesuwa przypomnienie nawet
  o kilkanaście minut.
- **Głos** — zadania ze słuchu i głośniki przy słówkach czytają głosem systemowym Androida.
  W ustawieniach systemu (Dostępność → Zamiana tekstu na mowę → silnik Google → Zainstaluj dane
  głosowe) trzeba pobrać głos **dla polskiego i dla każdego uczonego języka**: angielskiego,
  włoskiego, francuskiego — tego, w którym dziecko ma kurs. Bez głosu aplikacja **pomija**
  zadanie ze słuchu i nie liczy go jako błędu.

  Brakujący głos nie zawsze objawia się ciszą. Gdy Android dostaje `it-IT`, a danych włoskich nie
  ma, nie zgłasza błędu — zostaje przy swoim domyślnym głosie i czyta włoskie słowa po angielsku.
  Tak samo dla pozostałych języków. Jeśli więc kurs brzmi jak angielski, zacznij od sprawdzenia,
  czy głos tego języka jest pobrany; w samej aplikacji ani w bazie nie ma czego przestawiać,
  bo znacznik języka (`languages.tts_lang`, np. `it-IT`) idzie z bazy razem z zadaniem.

## Czego nie ma na tablecie

Panelu administratora, widoku rodzica (postępy dzieci, prośby o dostęp), zakładania konta
i zmiany hasła. Wszystko to jest na stronie: https://lingo-memo.vercel.app

Nauka **wymaga internetu** — ocena odpowiedzi, punkty i terminy powtórek liczą się w bazie, nie
w aplikacji. Bez sieci aplikacja mówi to wprost, zamiast udawać, że coś się zapisało.
