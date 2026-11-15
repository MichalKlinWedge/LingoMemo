-- Kurs startowy w każdej bazie, nie tylko lokalnej.
--
-- Lekcje wchodzą importem JSON z panelu, ale `admin_import_lesson` wymaga istniejącego kursu
-- i celowo nie zakłada go sam — literówka w `course` miałaby wtedy zakładać nowy kurs zamiast
-- powiedzieć, że czegoś takiego nie ma. Panel nie ma jeszcze tworzenia kursów (Etap 6), więc
-- w chmurze nie było dokąd importować: `supabase/seed.sql` leci wyłącznie przy `db:reset`
-- na lokalnej bazie.
--
-- Tu jest SAM wiersz kursu — żadnych działów, lekcji ani słówek. Treść dalej wchodzi importem.
-- Seed lokalny sprawdza `if exists`, więc nie wejdzie sobie w drogę z tą migracją.

insert into public.courses (slug, source_lang, target_lang, title, description, icon, is_published)
values ('pl-en-starter', 'pl', 'en', 'Angielski od zera',
        'Pierwsze słówka i zwroty po angielsku.', '🇬🇧', true)
on conflict (slug) do nothing;
