-- Dane słownikowe, bez których aplikacja nie ma z czego działać: języki i odznaki.
--
-- Celowo w migracji, a nie w `seed.sql`: seed uruchamia się tylko przy `db reset` na lokalnej
-- bazie, więc po `db push` projekt w chmurze zostałby bez ani jednego języka — a bez wiersza
-- w `languages` nie da się założyć kursu. Kurs demonstracyjny zostaje w seedzie, bo to treść
-- do testów, a nie dane słownikowe.
--
-- Wszystkie wstawienia są idempotentne: ponowne wykonanie niczego nie zdubluje.

insert into public.languages (code, name_native, name_pl, tts_lang) values
  ('pl', 'polski',  'polski',    'pl-PL'),
  ('en', 'English', 'angielski', 'en-GB'),
  ('de', 'Deutsch', 'niemiecki', 'de-DE'),
  ('es', 'Español', 'hiszpański','es-ES')
on conflict (code) do nothing;

insert into public.badges (code, title, description, icon, rule, sort_order) values
  ('first_lesson',  'Pierwszy krok',    'Ukończ pierwszą lekcję.',               '🥾', '{"kind":"lessons_completed","n":1,"points":25}',  10),
  ('five_lessons',  'Piątka z rzędu',   'Ukończ pięć lekcji.',                   '🖐️', '{"kind":"lessons_completed","n":5,"points":50}',  20),
  ('perfect',       'Bez błędu',        'Przejdź lekcję bezbłędnie.',            '💯', '{"kind":"perfect_lessons","n":1,"points":50}',    30),
  ('streak_3',      'Trzy dni z rzędu', 'Ucz się trzy dni pod rząd.',            '🔥', '{"kind":"streak_days","n":3,"points":50}',        40),
  ('streak_7',      'Cały tydzień',     'Ucz się siedem dni pod rząd.',          '🗓️', '{"kind":"streak_days","n":7,"points":100}',       50),
  ('words_10',      'Dziesięć słówek',  'Zapamiętaj dziesięć słówek na dłużej.', '🧠', '{"kind":"words_learned","n":10,"points":75}',     60),
  ('words_50',      'Pięćdziesiąt słówek', 'Zapamiętaj pięćdziesiąt słówek.',    '📚', '{"kind":"words_learned","n":50,"points":150}',    70),
  ('points_500',    'Pięćset punktów',  'Zbierz 500 punktów.',                   '⭐', '{"kind":"points_total","n":500,"points":100}',    80)
on conflict (code) do update set
  title       = excluded.title,
  description = excluded.description,
  icon        = excluded.icon,
  rule        = excluded.rule,
  sort_order  = excluded.sort_order;
