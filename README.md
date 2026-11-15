# LingoMemo

Aplikacja webowa do nauki słówek i prostych zwrotów obcego języka — dla dzieci. Duże przyciski,
duże litery, obrazki, punkty i nagrody. Dostęp zamknięty: konto zakłada się wyłącznie z linku
z zaproszeniem wygenerowanego przez administratora.

Pierwszy kurs: polski → angielski. Model danych jest wielojęzyczny — kolejny język to dane,
nie zmiana w kodzie.

| | |
|---|---|
| Repozytorium | https://github.com/MichalKlinWedge/LingoMemo |
| Projekt Supabase | `xyrfcawecvpwriqepodo` |
| Hosting | Vercel (region `fra1`, ten sam co baza) |

## Katalogi

| Ścieżka | Co tam jest |
|---|---|
| `apps/web` | Aplikacja Next.js — część dla ucznia i panel administratora |
| `packages/core` | Logika wspólna w czystym TypeScripcie: typy zadań, etykiety, formatowanie |
| `packages/db` | Typy TypeScript generowane z bazy (`npm run gen`) |
| `supabase/migrations` | Schemat bazy — jedna migracja na temat, nigdy edycja starej |
| `supabase/tests` | Testy uprawnień (pgTAP) |
| `tools/seed-dev` | Dane demo i nadanie pierwszego administratora (wyłącznie na localhoście) |
| `docs` | Plan etapowy i decyzje architektoniczne |

## Uruchomienie lokalne

Potrzebne: Node 22+, Docker Desktop (do lokalnej bazy).

```
npm install
cp .env.example .env.local      # uzupełnij, jeśli łączysz się z bazą w chmurze
npm run db:start                # lokalna baza Supabase
npm run db:reset                # schemat z migracji + dane demo
npm run seed:dev -- --email rodzic@dom.local --password "..."   # pierwszy administrator
npm run web:local               # http://localhost:3000
```

Konta zakłada się wyłącznie z zaproszenia, więc pierwszy administrator powstaje skryptem.
Kolejne osoby zaprasza się linkiem z `/admin/zaproszenia`.

Po zmianie sekcji `[auth]` w `supabase/config.toml` (np. hooka rejestracji) trzeba
`npm run db:stop && npm run db:start` — `db:reset` nie przeładowuje kontenera Auth.

Lokalny Supabase chodzi na portach **54421–54429** (API `54421`, baza `54422`, Studio `54423`),
a nie na domyślnych 54321–54329 — domyślne zajmuje inny projekt na tej samej maszynie.

`npm run web:local` sam pobiera adres i klucz z lokalnej bazy. Do pracy na bazie w chmurze służy
`npm run web`, które bierze wartości z `.env.local` w katalogu głównym.

Jeden `.env.local` w katalogu głównym jest źródłem prawdy — `scripts/sync-env.mjs` przepisuje
z niego `apps/web/.env.local`, bo Next czyta zmienne tylko z katalogu swojej aplikacji.
`SUPABASE_SERVICE_ROLE_KEY` zostaje w katalogu głównym i nie trafia do aplikacji.

## Kontrola jakości

```
npm run check     # typecheck + lint + testy jednostkowe
npm run test:db   # testy uprawnień RLS na lokalnej bazie
```

Obie bramki muszą przechodzić przed commitem; po zmianie w bazie dochodzi jeszcze `npm run gen`.

## Wdrożenie

```
npm run supabase -- link --project-ref xyrfcawecvpwriqepodo
npm run db:push
```

W panelu Supabase, raz: Authentication → Hooks → **Before User Created** → Postgres
(`public.before_user_created`) oraz dopisanie adresu produkcyjnego do Redirect URLs.

W Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`.
`SUPABASE_SERVICE_ROLE_KEY` **nie trafia do Vercela** — jest potrzebny tylko lokalnie.

## Dokumenty

- [`docs/PLAN_ETAPOWY.md`](docs/PLAN_ETAPOWY.md) — etapy i kryteria odbioru, ze stanem na bieżąco
- [`docs/DECYZJE.md`](docs/DECYZJE.md) — co wybrano, dlaczego i co odrzucono
- [`CLAUDE.md`](CLAUDE.md) — konwencje i reguły architektury
