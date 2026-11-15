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
| Powtórki | SM-2 „lite”, interwały 1/3/7/16/35 dni | dla dziecka wystarczy ocena binarna; pełne SM-2 wymaga oceniania własnej pewności | FSRS i pełne SM-2 — za dużo jak na tę skalę |
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
