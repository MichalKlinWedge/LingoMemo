-- Niemiecki: kurs dla początkujących.
--
-- Tak samo jak `…_italian_course.sql` i `…_spanish_course.sql`: kurs zakłada MIGRACJA, bo
-- `admin_import_lesson` celowo nie tworzy kursu z literówki w polu `course`, a `seed.sql` leci
-- tylko przy `db:reset` na lokalnej bazie — po `db push` w chmurze nie byłoby dokąd importować.
--
-- Wiersza w `languages` tu nie ma: 'de' stoi w danych słownikowych od `…_reference_data.sql`,
-- a plik flagi `apps/web/public/flagi/de.svg` i kod na liście w `components/flag.tsx` też są
-- od początku. Dlatego ta migracja to jeden wiersz.
--
-- Dział, lekcje i słówka wchodzą importem plików z `content/pl-de/`:
--
--   npm run import:lesson -- content/pl-de/*.json            # lokalna baza
--   npm run import:lesson -- content/pl-de/*.json --remote    # projekt w chmurze

insert into public.courses (slug, source_lang, target_lang, title, description, icon, sort_order, is_published)
values ('pl-de-starter', 'pl', 'de', 'Niemiecki dla początkujących',
        'Pierwsze słowa i zwroty po niemiecku.', '🇩🇪', 4, true)
on conflict (slug) do nothing;
