-- Francuski: język w słowniku i kurs dla początkujących.
--
-- Ta migracja jest dłuższa niż hiszpańska i niemiecka, bo francuskiego w bazie jeszcze nie było
-- — tak samo jak przy włoskim (`…_italian_course.sql`) trzeba najpierw wiersza w `languages`.
-- Musi stać w migracji, a nie w `seed.sql`: seed leci wyłącznie przy `db:reset` na lokalnej
-- bazie, więc po `db push` w chmurze nie byłoby języka, a pole języka w panelu bierze listę
-- właśnie z `languages`.
--
-- Kurs też zakłada migracja: `admin_import_lesson` celowo nie tworzy kursu z literówki w polu
-- `course`, więc bez wiersza kursu nie ma dokąd importować lekcji.
--
-- Dział, lekcje i słówka wchodzą importem plików z `content/pl-fr/`:
--
--   npm run import:lesson -- content/pl-fr/*.json            # lokalna baza
--   npm run import:lesson -- content/pl-fr/*.json --remote    # projekt w chmurze
--
-- Flaga do interfejsu to osobny plik `apps/web/public/flagi/fr.svg` plus kod języka na liście
-- w `components/flag.tsx` — emoji flag Windows nie rysuje (patrz docs/DECYZJE.md).

insert into public.languages (code, name_native, name_pl, tts_lang) values
  ('fr', 'français', 'francuski', 'fr-FR')
on conflict (code) do nothing;

insert into public.courses (slug, source_lang, target_lang, title, description, icon, sort_order, is_published)
values ('pl-fr-starter', 'pl', 'fr', 'Francuski dla początkujących',
        'Pierwsze słowa i zwroty po francusku.', '🇫🇷', 5, true)
on conflict (slug) do nothing;
