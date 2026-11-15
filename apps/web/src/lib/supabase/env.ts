/**
 * Adres i klucz publiczny Supabase. Klucz `publishable` (dawniej `anon`) może być w przeglądarce —
 * dostępu do danych pilnuje RLS. Zmienne przychodzą z głównego `.env.local` przez
 * `scripts/sync-env.mjs` (Next czyta env tylko z katalogu aplikacji).
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * Czy aplikacja w ogóle wie, gdzie jest baza. Świeże wdrożenie bez ustawionych zmiennych
 * zbuduje się bez błędu i wywali dopiero przy pierwszym żądaniu — lepiej powiedzieć wprost,
 * czego brakuje, niż pokazać pustą stronę błędu.
 */
export const SUPABASE_CONFIGURED = SUPABASE_URL !== "" && SUPABASE_KEY !== "";
