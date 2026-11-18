-- Więcej nagród do zdobycia, i widoczne „ile jeszcze”.
--
-- Dotąd było osiem odznak i pięć rodzajów reguł. Dziecko zdobywało pierwsze cztery w ciągu
-- dwóch wieczorów, a potem zostawały trzy kłódki odległe o setki punktów — na ekranie nagród
-- nie było nic „na wyciągnięcie ręki”. Dokładamy dwadzieścia dwie odznaki w dziesięciu
-- drabinkach, tak żeby na każdym etapie nauki coś było blisko.
--
-- Trzy zmiany, każda z osobnym powodem:
--
-- 1. **Nowe rodzaje reguł.** Odznaki chwaliły dotąd tylko to, co da się policzyć na palcach
--    lekcji i punktów. Teraz liczą się też gwiazdki, trudniejsze wejścia, zdane sprawdziany,
--    dobre odpowiedzi i czas nauki — czyli to, co dziecko i tak widzi na swoich postępach.
--
-- 2. **Jedno miejsce, w którym liczy się wartości reguł** — `badge_values()`. Wcześniej
--    `award_badges()` wykonywało jedno zapytanie na każdą niezdobytą odznakę: przy ośmiu było
--    to osiem zapytań po lekcji, przy trzydziestu byłoby trzydzieści. Teraz jedno zapytanie
--    zwraca wszystkie liczniki jako `jsonb`, a pętla tylko je porównuje z progiem.
--
-- 3. **`my_badge_progress()`** — ile dziecku brakuje do każdej odznaki. Bez tego trzydzieści
--    odznak to na ekranie nagród trzydzieści jednakowych kłódek, a z tego nie wynika, czy do
--    nagrody brakuje jednej lekcji, czy czterdziestu. Funkcja, nie liczenie w przeglądarce:
--    progi i sposób liczenia zostają po stronie bazy, tak samo jak ocena odpowiedzi.
--
-- Odznaki, które dziecko już ma, zostają zdobyte — `user_badges` nikt tu nie rusza, a progi
-- istniejących ośmiu odznak się nie zmieniają. Zmienia się tylko ich `sort_order`, bo nowe
-- wchodzą między nie w drabinki tematyczne (lekcje, bezbłędne przejścia, gwiazdki, poziomy,
-- sprawdziany, seria, słówka, odpowiedzi, czas, punkty — w tej kolejności).

-- 1. Liczniki wszystkich reguł jednym zapytaniem.
--
-- `security definer`, bo czyta tabele postępu cudzym kluczem: woła ją `award_badges()` dla
-- dziecka, które właśnie skończyło lekcję, i `my_badge_progress()` dla zalogowanego. Nie jest
-- wystawiona nikomu — tak samo jak `award_badges()`.
--
-- `volatile`, mimo że tylko czyta. Funkcja `stable` widzi bazę taką, jaka była na początku
-- zewnętrznej instrukcji — a `award_badges()` liczy wartości dwa razy w jednym wywołaniu
-- i drugie przejście musi zobaczyć punkty dopisane przez pierwsze. Z `stable` nie widziało
-- ich nigdy i odznaka za punkty przychodziła dopiero po następnej lekcji.
create or replace function public.badge_values(p_user uuid)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'lessons_completed',  (select count(*) from public.lesson_progress lp
                            where lp.user_id = p_user and lp.status = 'completed'),
    'perfect_lessons',    (select count(*) from public.lesson_progress lp
                            where lp.user_id = p_user and lp.best_score >= 1),
    -- Lekcja na trzy gwiazdki to bezbłędne przejście łatwego poziomu; osobno od „bez błędu”,
    -- bo gwiazdki widać na mapie lekcji i dziecko je zbiera świadomie.
    'three_star_lessons', (select count(*) from public.lesson_progress lp
                            where lp.user_id = p_user and lp.stars >= 3),
    -- Gwiazdki ze wszystkich poziomów razem: łatwy siedzi w `lesson_progress`, średni
    -- i trudny w `lesson_level_progress`.
    'stars_total',        (select coalesce(sum(lp.stars), 0) from public.lesson_progress lp
                            where lp.user_id = p_user)
                        + (select coalesce(sum(llp.stars), 0) from public.lesson_level_progress llp
                            where llp.user_id = p_user),
    -- Zdane trudniejsze wejście, czyli z gwiazdką — tak samo jak przy odblokowaniu
    -- następnego poziomu (`is_level_unlocked`).
    'levels_passed',      (select count(*) from public.lesson_level_progress llp
                            where llp.user_id = p_user and llp.status = 'completed' and llp.stars >= 1),
    'hard_levels',        (select count(*) from public.lesson_level_progress llp
                            where llp.user_id = p_user and llp.level = 3
                              and llp.status = 'completed' and llp.stars >= 1),
    -- Powtórka i sprawdzian to dla dziecka to samo przeżycie: „sprawdzają mnie z tego, co było”.
    'tests_passed',       (select count(*) from public.lesson_progress lp
                             join public.lessons l on l.id = lp.lesson_id
                            where lp.user_id = p_user and lp.status = 'completed' and lp.stars >= 1
                              and l.kind in ('review', 'test')),
    'streak_days',        coalesce((select us.streak_days from public.user_stats us
                                     where us.user_id = p_user), 0),
    -- Słówko „umiane”: stabilność co najmniej 21 dni, czyli przypomni się za trzy tygodnie.
    'words_learned',      (select count(*) from public.srs_state s
                            where s.user_id = p_user and s.stability >= 21),
    'answers_correct',    (select count(*) from public.attempts a
                            where a.user_id = p_user and a.is_correct),
    -- Minuty, nie sekundy: próg „pół godziny nauki” ma być czytelny w regule, a sekundy
    -- z `session_seconds` są już przycięte do pół godziny na sesję.
    'learning_minutes',   coalesce((select sum(public.session_seconds(s.started_at, s.finished_at)) / 60
                                      from public.lesson_sessions s where s.user_id = p_user), 0),
    'points_total',       coalesce((select sum(pl.delta) from public.points_ledger pl
                                     where pl.user_id = p_user), 0)
  );
$fn$;

comment on function public.badge_values(uuid) is
  'Liczniki wszystkich rodzajów reguł odznak dla jednego dziecka, jako jsonb. Jedno zapytanie '
  'zamiast jednego na odznakę.';

-- 2. Odznaki. Reguły są deklaratywne, więc dołożenie nowej to wiersz w `badges`, nie zmiana kodu.
--
-- Dwa przejścia, bo odznaka płaci punktami: „Pięć trudnych poziomów” potrafi dociągnąć licznik
-- do progu „Tysiąca punktów”, a dziecko ma dostać obie od razu, a nie jedną po następnej lekcji.
-- Drugie przejście liczy wartości od nowa; trzeciego nie ma, bo żadna odznaka nie płaci tyle,
-- żeby przeskoczyć dwa progi punktowe naraz.
create or replace function public.award_badges(p_user uuid)
returns text[]
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_badge   record;
  v_values  jsonb;
  v_value   integer;
  v_round   text[];
  v_awarded text[] := '{}';
  v_pass    integer;
begin
  for v_pass in 1..2 loop
    v_values := public.badge_values(p_user);
    v_round  := '{}';

    for v_badge in
      select b.* from public.badges b
      where b.is_active
        and not exists (select 1 from public.user_badges ub where ub.user_id = p_user and ub.badge_code = b.code)
    loop
      -- Nieznany rodzaj reguły daje `null`, czyli odznaka nie przyzna się nigdy. Lepiej tak niż
      -- przyznać ją wszystkim za literówkę w `rule`.
      v_value := (v_values ->> (v_badge.rule ->> 'kind'))::integer;

      if v_value is not null and v_value >= (v_badge.rule ->> 'n')::integer then
        insert into public.user_badges (user_id, badge_code) values (p_user, v_badge.code)
        on conflict do nothing;
        insert into public.points_ledger (user_id, delta, reason, ref_type, ref_id)
        values (p_user, coalesce((v_badge.rule ->> 'points')::integer, 25), 'badge', v_badge.code, null)
        on conflict do nothing;
        v_round := v_round || v_badge.code;
      end if;
    end loop;

    v_awarded := v_awarded || v_round;
    exit when cardinality(v_round) = 0;
  end loop;

  return v_awarded;
end;
$fn$;

-- 3. Ile brakuje do każdej odznaki. Wartość przycięta do progu, żeby „z 10” nigdy nie było
-- mniejsze niż to, co stoi obok — dziecko ma zobaczyć „7 z 10”, nie „13 z 10”.
-- `volatile` tylko dlatego, że woła `badge_values()` — sama niczego nie zapisuje.
create or replace function public.my_badge_progress()
returns table (code text, value integer, target integer)
language sql
volatile
security definer
set search_path = ''
as $fn$
  with mine as (select public.badge_values((select auth.uid())) as vals)
  select b.code,
         least(
           coalesce((mine.vals ->> (b.rule ->> 'kind'))::integer, 0),
           (b.rule ->> 'n')::integer
         )::integer,
         (b.rule ->> 'n')::integer
    from public.badges b cross join mine
   where b.is_active;
$fn$;

comment on function public.my_badge_progress() is
  'Postęp zalogowanego dziecka do każdej czynnej odznaki: ile ma i ile potrzeba.';

revoke execute on function public.badge_values(uuid) from anon, authenticated, public;
revoke execute on function public.my_badge_progress() from anon, public;
grant execute on function public.my_badge_progress() to authenticated;

-- 4. Same odznaki. Wstawienie idempotentne: ponowne wykonanie niczego nie zdubluje, a zmiana
-- opisu albo progu to poprawka tego wiersza.
insert into public.badges (code, title, description, icon, rule, sort_order) values
  -- Lekcje
  ('first_lesson',  'Pierwszy krok',             'Ukończ pierwszą lekcję.',                  '🥾', '{"kind":"lessons_completed","n":1,"points":25}',    10),
  ('five_lessons',  'Piątka z rzędu',            'Ukończ pięć lekcji.',                      '🖐️', '{"kind":"lessons_completed","n":5,"points":50}',    20),
  ('lessons_10',    'Dziesięć lekcji',           'Ukończ dziesięć lekcji.',                  '🎒', '{"kind":"lessons_completed","n":10,"points":100}',  30),
  ('lessons_25',    'Dwadzieścia pięć lekcji',   'Ukończ dwadzieścia pięć lekcji.',          '🏆', '{"kind":"lessons_completed","n":25,"points":200}',  40),
  ('lessons_50',    'Pięćdziesiąt lekcji',       'Ukończ pięćdziesiąt lekcji.',              '👑', '{"kind":"lessons_completed","n":50,"points":400}',  50),
  -- Bezbłędne przejścia
  ('perfect',       'Bez błędu',                 'Przejdź lekcję bezbłędnie.',               '💯', '{"kind":"perfect_lessons","n":1,"points":50}',      60),
  ('perfect_5',     'Pięć razy bez błędu',       'Przejdź bezbłędnie pięć lekcji.',          '🎯', '{"kind":"perfect_lessons","n":5,"points":100}',     70),
  ('perfect_15',    'Piętnaście razy bez błędu', 'Przejdź bezbłędnie piętnaście lekcji.',    '🦅', '{"kind":"perfect_lessons","n":15,"points":250}',    80),
  -- Gwiazdki
  ('stars_three',   'Trzy razy na trzy gwiazdki','Zdobądź trzy gwiazdki w trzech lekcjach.', '🌠', '{"kind":"three_star_lessons","n":3,"points":100}',  90),
  ('stars_30',      'Trzydzieści gwiazdek',      'Zbierz trzydzieści gwiazdek.',             '✨', '{"kind":"stars_total","n":30,"points":150}',       100),
  -- Trudniejsze poziomy
  ('hard_1',        'Trudny poziom',             'Zdaj trudny poziom lekcji.',               '🧗', '{"kind":"hard_levels","n":1,"points":100}',        110),
  ('hard_5',        'Pięć trudnych poziomów',    'Zdaj trudny poziom w pięciu lekcjach.',    '🥇', '{"kind":"hard_levels","n":5,"points":250}',        120),
  ('levels_10',     'Dziesięć wejść wyżej',      'Zdaj dziesięć trudniejszych poziomów.',    '🧩', '{"kind":"levels_passed","n":10,"points":150}',     130),
  -- Sprawdziany i powtórki
  ('test_1',        'Sprawdzony',                'Zdaj sprawdzian albo test powtórkowy.',    '📝', '{"kind":"tests_passed","n":1,"points":75}',        140),
  ('test_5',        'Pięć sprawdzianów',         'Zdaj pięć sprawdzianów albo powtórek.',    '🧾', '{"kind":"tests_passed","n":5,"points":200}',       150),
  -- Seria dni
  ('streak_3',      'Trzy dni z rzędu',          'Ucz się trzy dni pod rząd.',               '🔥', '{"kind":"streak_days","n":3,"points":50}',         160),
  ('streak_7',      'Cały tydzień',              'Ucz się siedem dni pod rząd.',             '🗓️', '{"kind":"streak_days","n":7,"points":100}',        170),
  ('streak_14',     'Dwa tygodnie',              'Ucz się czternaście dni pod rząd.',        '🌙', '{"kind":"streak_days","n":14,"points":200}',       180),
  ('streak_30',     'Miesiąc bez przerwy',       'Ucz się trzydzieści dni pod rząd.',        '🏔️', '{"kind":"streak_days","n":30,"points":400}',       190),
  -- Słówka zapamiętane na dłużej
  ('words_10',      'Dziesięć słówek',           'Zapamiętaj dziesięć słówek na dłużej.',    '🧠', '{"kind":"words_learned","n":10,"points":75}',      200),
  ('words_50',      'Pięćdziesiąt słówek',       'Zapamiętaj pięćdziesiąt słówek.',          '📚', '{"kind":"words_learned","n":50,"points":150}',     210),
  ('words_100',     'Setka słówek',              'Zapamiętaj sto słówek.',                   '🎓', '{"kind":"words_learned","n":100,"points":250}',    220),
  ('words_200',     'Dwieście słówek',           'Zapamiętaj dwieście słówek.',              '🧙', '{"kind":"words_learned","n":200,"points":500}',    230),
  -- Dobre odpowiedzi
  ('answers_100',   'Sto dobrych odpowiedzi',    'Odpowiedz dobrze sto razy.',               '✅', '{"kind":"answers_correct","n":100,"points":75}',   240),
  ('answers_1000',  'Tysiąc dobrych odpowiedzi', 'Odpowiedz dobrze tysiąc razy.',            '🎖️', '{"kind":"answers_correct","n":1000,"points":300}', 250),
  -- Czas nauki
  ('time_30',       'Pół godziny nauki',         'Ucz się łącznie pół godziny.',             '⏱️', '{"kind":"learning_minutes","n":30,"points":50}',   260),
  ('time_300',      'Pięć godzin nauki',         'Ucz się łącznie pięć godzin.',             '🕰️', '{"kind":"learning_minutes","n":300,"points":250}', 270),
  -- Punkty
  ('points_500',    'Pięćset punktów',           'Zbierz 500 punktów.',                      '⭐', '{"kind":"points_total","n":500,"points":100}',     280),
  ('points_1000',   'Tysiąc punktów',            'Zbierz 1000 punktów.',                     '💎', '{"kind":"points_total","n":1000,"points":150}',    290),
  ('points_5000',   'Pięć tysięcy punktów',      'Zbierz 5000 punktów.',                     '🚀', '{"kind":"points_total","n":5000,"points":400}',    300)
on conflict (code) do update set
  title       = excluded.title,
  description = excluded.description,
  icon        = excluded.icon,
  rule        = excluded.rule,
  sort_order  = excluded.sort_order;
