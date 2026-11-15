-- Rozszerzenia i schemat prywatny.
--
-- `app_private` nie jest wystawiony przez PostgREST (patrz `api.schemas` w config.toml), więc
-- nic, co w nim leży, nie jest osiągalne z przeglądarki — nawet gdyby polityka RLS miała błąd.
-- Tu trafiają dane, których uczeń nie ma prawa zobaczyć w żadnych okolicznościach: lista
-- administratorów i zaproszenia.

create schema if not exists app_private;
revoke all on schema app_private from anon, authenticated;

-- digest() do haszowania tokenów zaproszeń.
create extension if not exists pgcrypto with schema extensions;
-- unaccent(): „zażółć” i „zazolc” to przy sprawdzaniu odpowiedzi to samo słowo.
create extension if not exists unaccent with schema extensions;
-- levenshtein(): tolerancja jednej literówki w odpowiedzi dziecka.
create extension if not exists fuzzystrmatch with schema extensions;
