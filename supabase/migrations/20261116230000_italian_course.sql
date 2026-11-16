-- Włoski: język w słowniku i kurs dla początkujących.
--
-- Kurs zakłada MIGRACJA, nie panel. `admin_import_lesson` celowo nie tworzy kursu z literówki
-- w polu `course`, więc bez wiersza kursu nie ma dokąd importować lekcji — tak samo jak
-- w `…_starter_course.sql`. Wiersz w `languages` musi być tutaj z tego samego powodu, co reszta
-- danych słownikowych: `seed.sql` leci wyłącznie przy `db:reset` na lokalnej bazie, więc po
-- `db push` projekt w chmurze zostałby bez włoskiego, a bez niego nie da się założyć kursu
-- nawet z ręki w panelu (pole języka bierze listę z `languages`).
--
-- Tu jest SAM język i SAM kurs — żadnych działów, lekcji ani słówek. Treść wchodzi importem
-- plików z `content/pl-it/`:
--
--   npm run import:lesson -- content/pl-it/*.json            # lokalna baza
--   npm run import:lesson -- content/pl-it/*.json --remote    # projekt w chmurze
--
-- Flaga do interfejsu to osobny plik `apps/web/public/flagi/it.svg` plus kod języka na liście
-- w `components/flag.tsx` — emoji flag Windows nie rysuje (patrz docs/DECYZJE.md).

insert into public.languages (code, name_native, name_pl, tts_lang) values
  ('it', 'italiano', 'włoski', 'it-IT')
on conflict (code) do nothing;

insert into public.courses (slug, source_lang, target_lang, title, description, icon, sort_order, is_published)
values ('pl-it-starter', 'pl', 'it', 'Włoski dla początkujących',
        'Pierwsze słowa i zwroty po włosku.', '🇮🇹', 2, true)
on conflict (slug) do nothing;
