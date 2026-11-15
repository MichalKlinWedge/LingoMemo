-- Podpowiedzi: pięć na dobę, a każda zamienia zadanie na łatwiejszą wersję tego samego słówka.
--
-- Dziecko, które utknie, miało dotąd dwa wyjścia: zgadywać albo pominąć zadanie (czyli dostać
-- błąd). Podpowiedź jest trzecim: to samo słówko, ale w prostszej formie — zamiast wpisywać
-- słowo z klawiatury, wskazuje je wśród kafelków albo układa zdanie z klocków.
--
-- Limit jest dzienny i liczony Z UŻYĆ, a nie trzymany jako licznik do wyzerowania: „ile dziś
-- zużyto" wychodzi z tabeli, więc o północy w strefie dziecka pula odnawia się sama. Żadnego
-- zadania w harmonogramie, nic do zepsucia przy przestawianiu zegarków.
--
-- Odrzucone: licznik w `profiles` zerowany zadaniem crona (jedno niewykonane uruchomienie i pula
-- nie wraca; do tego strefa czasowa dziecka, a nie serwera); podpowiedź jako podgląd odpowiedzi
-- (dziecko przepisuje i nic się nie uczy); generowanie łatwiejszej wersji w locie (zadanie bez
-- wiersza nie ma id, więc nie dałoby się go zapisać w próbach ani w migawce sesji).

-- 1. Ile podpowiedzi na dobę. Funkcja, nie stała w kodzie.
create or replace function public.hint_limit() returns integer
  language sql immutable set search_path = '' as $fn$ select 5 $fn$;

-- 2. Zużyte podpowiedzi. Jak każda tabela postępu: dla ucznia tylko do odczytu, zapis wyłącznie
-- przez `use_hint`. `used_on` to data w strefie dziecka, wyliczona w chwili użycia.
create table if not exists public.hint_uses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  session_id  uuid references public.lesson_sessions(id) on delete cascade,
  exercise_id uuid references public.exercises(id) on delete cascade,
  easier_id   uuid references public.exercises(id) on delete set null,
  used_on     date not null,
  created_at  timestamptz not null default now(),
  -- Druga podpowiedź do tego samego zadania w tej samej sesji nie kosztuje — oddajemy tę samą
  -- łatwiejszą wersję. Inaczej odświeżenie strony zjadałoby dziecku pulę.
  unique (user_id, session_id, exercise_id)
);

create index if not exists hint_uses_user_day_idx on public.hint_uses (user_id, used_on);

alter table public.hint_uses enable row level security;

create policy hint_uses_read on public.hint_uses
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
-- Celowo BRAK polityki INSERT/UPDATE/DELETE — tak samo jak przy pozostałych tabelach postępu.

grant select on public.hint_uses to authenticated;

/** Dzisiejsza data w strefie dziecka — po niej odnawia się pula podpowiedzi. */
create or replace function public.learner_today(p_user uuid)
returns date
language sql stable security definer set search_path = ''
as $fn$
  select (now() at time zone coalesce(
            (select p.time_zone from public.profiles p where p.id = p_user),
            'Europe/Warsaw'))::date;
$fn$;

/** Ile podpowiedzi zostało dziecku na dziś. */
create or replace function public.hints_left()
returns integer
language sql stable security definer set search_path = ''
as $fn$
  select greatest(
    public.hint_limit() - (
      select count(*)
        from public.hint_uses h
       where h.user_id = (select auth.uid())
         and h.used_on = public.learner_today((select auth.uid()))
    ),
    0
  )::integer;
$fn$;

/**
 * Łatwiejsza wersja zadania: to samo słówko w tej samej lekcji, ale niżej w poziomie.
 * Najpierw zamiennik zrobiony wprost dla tego zadania (`easy_for` — na przykład rozsypanka
 * dorobiona do zdania), potem najłatwiejsze, co jest.
 */
create or replace function public.easier_exercise(p_exercise uuid)
returns uuid
language sql stable security definer set search_path = ''
as $fn$
  select ex.id
    from public.exercises cur
    join public.exercises ex
      on ex.lesson_id = cur.lesson_id
     and ex.is_active
     and ex.id <> cur.id
     and ex.level < cur.level
     and (ex.easy_for = cur.id or (cur.concept_id is not null and ex.concept_id = cur.concept_id))
   where cur.id = p_exercise
   order by (ex.easy_for = cur.id) desc, ex.level, random()
   limit 1;
$fn$;

/**
 * Zadanie w wersji dla dziecka: bez kluczy odpowiedzi i z potasowaną kolejnością wszystkiego,
 * co ma kolejność. Wyciągnięte z `get_lesson_exercises`, bo to samo musi zrobić `use_hint` —
 * dwie kopie tego wyrażenia rozjechałyby się przy pierwszym nowym typie zadania.
 */
create or replace function public.child_exercise(p_exercise uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $fn$
  select case ex.type
    when 'match_pairs' then jsonb_build_object(
      'instruction', ex.payload -> 'instruction',
      'pairsLeft',  (select jsonb_agg(p ->> 'a' order by random()) from jsonb_array_elements(ex.payload -> 'pairs') p),
      'pairsRight', (select jsonb_agg(p ->> 'b' order by random()) from jsonb_array_elements(ex.payload -> 'pairs') p)
    )
    when 'listen_match' then jsonb_build_object(
      'instruction', ex.payload -> 'instruction',
      'lang', ex.payload -> 'lang',
      'audio', (
        select jsonb_agg(jsonb_build_object('text', p ->> 'b', 'audioPath', p -> 'audioPath') order by random())
          from jsonb_array_elements(ex.payload -> 'pairs') p
      ),
      'words', (select jsonb_agg(p ->> 'a' order by random()) from jsonb_array_elements(ex.payload -> 'pairs') p)
    )
    when 'sentence_order' then jsonb_build_object(
      'prompt', ex.payload -> 'prompt',
      'tokens', (select jsonb_agg(t order by random()) from jsonb_array_elements(ex.payload -> 'tokens') t)
    )
    -- Lista wyboru w losowej kolejności: poprawna odpowiedź nie ma stale stać pierwsza.
    else case
      when ex.payload ? 'options' then
        (ex.payload - 'accepted' - 'answer' - 'solution')
          || jsonb_build_object('options', (
               select jsonb_agg(o order by random()) from jsonb_array_elements(ex.payload -> 'options') o
             ))
      else ex.payload - 'accepted' - 'answer' - 'solution'
    end
  end
  from public.exercises ex
 where ex.id = p_exercise;
$fn$;

/**
 * Uproszczenie SAMEGO zadania, gdy w lekcji nie ma łatwiejszego odpowiednika — a tak jest na
 * poziomie łatwym, gdzie wszystko jest już na klikanie. Zwraca nowy payload dla tego samego
 * zadania albo NULL, gdy nie ma czego uprościć. Identyfikator zostaje ten sam, więc migawka
 * sesji i ocenianie działają bez żadnej zmiany: `solution` i `accepted` się nie ruszają.
 */
create or replace function public.simpler_payload(p_exercise uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $fn$
  with ex as (select e.type, e.payload from public.exercises e where e.id = p_exercise),
  dobra as (
    select coalesce(ex.payload ->> 'answer', ex.payload -> 'accepted' ->> 0) as answer from ex
  )
  select case
    -- Rozsypanka: znikają klocki, których nie ma w zdaniu.
    when ex.type = 'sentence_order'
         and jsonb_array_length(ex.payload -> 'tokens') > jsonb_array_length(ex.payload -> 'solution')
      then jsonb_build_object(
             'prompt', ex.payload -> 'prompt',
             'tokens', (select jsonb_agg(t order by random())
                          from jsonb_array_elements(ex.payload -> 'solution') t)
           )
    -- Lista wyboru: z czterech kafelków zostają dwa, w tym poprawny.
    when jsonb_typeof(ex.payload -> 'options') = 'array'
         and jsonb_array_length(ex.payload -> 'options') > 2
         and (select answer from dobra) is not null
      then (ex.payload - 'accepted' - 'answer' - 'solution')
             || jsonb_build_object('options', (
                  select jsonb_agg(o order by random())
                    from (
                      select to_jsonb((select answer from dobra)) as o
                      union all
                      (select o2 from jsonb_array_elements(ex.payload -> 'options') o2
                        where o2 #>> '{}' is distinct from (select answer from dobra)
                        order by random() limit 1)
                    ) wybrane
                ))
    else null
  end
  from ex;
$fn$;

/**
 * Zamiana zadania na łatwiejsze. Kosztuje jedną podpowiedź z dziennej puli, a zamiennik
 * dopisujemy do migawki sesji — inaczej `submit_attempt` odrzuciłby odpowiedź na zadanie,
 * którego sesja nie wydała.
 *
 * Powtórne wywołanie dla tego samego zadania w tej samej sesji nic nie kosztuje i oddaje ten
 * sam zamiennik: dziecko mogło odświeżyć stronę.
 */
create or replace function public.use_hint(p_session uuid, p_exercise uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_user   uuid := (select auth.uid());
  v_lesson uuid;
  v_ids    uuid[];
  v_easier  uuid;
  v_known   uuid;
  v_simpler jsonb;
begin
  if v_user is null then
    raise exception 'Trzeba być zalogowanym' using errcode = '42501';
  end if;

  select s.lesson_id, s.exercise_ids into v_lesson, v_ids
    from public.lesson_sessions s
   where s.id = p_session and s.user_id = v_user and s.finished_at is null;
  if not found then
    raise exception 'Ta lekcja jest już zakończona' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.exercises ex
     where ex.id = p_exercise and ex.is_active and ex.lesson_id = v_lesson
  ) and not (p_exercise = any (coalesce(v_ids, '{}'::uuid[]))) then
    raise exception 'To zadanie nie jest z tej lekcji' using errcode = '42501';
  end if;

  -- Już podpowiedziane w tej sesji: oddajemy to samo, bez pobierania opłaty.
  select h.easier_id into v_known
    from public.hint_uses h
   where h.user_id = v_user and h.session_id = p_session and h.exercise_id = p_exercise;

  if v_known is not null then
    return jsonb_build_object(
      'id', v_known,
      -- Zamiennikiem bywa to samo zadanie w prostszej postaci — wtedy payload trzeba zbudować
      -- jeszcze raz, bo w bazie siedzi wersja pełna.
      'payload', case when v_known = p_exercise
                      then public.simpler_payload(p_exercise)
                      else public.child_exercise(v_known) end,
      'type', (select ex.type from public.exercises ex where ex.id = v_known),
      'conceptId', (select ex.concept_id from public.exercises ex where ex.id = v_known),
      'points', (select ex.points from public.exercises ex where ex.id = v_known),
      'hintsLeft', public.hints_left()
    );
  end if;

  if public.hints_left() <= 0 then
    raise exception 'Na dziś nie ma już podpowiedzi. Wrócą jutro.' using errcode = '42501';
  end if;

  v_easier := public.easier_exercise(p_exercise);

  -- Nie ma łatwiejszego zadania (tak jest na poziomie łatwym, gdzie wszystko jest na klikanie)?
  -- Upraszczamy to, które jest: mniej kafelków do wyboru, rozsypanka bez zbędnych kloców.
  if v_easier is null then
    v_simpler := public.simpler_payload(p_exercise);
    if v_simpler is null then
      raise exception 'To zadanie nie ma łatwiejszej wersji' using errcode = '22023';
    end if;

    insert into public.hint_uses (user_id, session_id, exercise_id, easier_id, used_on)
    values (v_user, p_session, p_exercise, p_exercise, public.learner_today(v_user));

    return jsonb_build_object(
      'id', p_exercise,
      'type', (select ex.type from public.exercises ex where ex.id = p_exercise),
      'conceptId', (select ex.concept_id from public.exercises ex where ex.id = p_exercise),
      'points', (select ex.points from public.exercises ex where ex.id = p_exercise),
      'payload', v_simpler,
      'hintsLeft', public.hints_left()
    );
  end if;

  insert into public.hint_uses (user_id, session_id, exercise_id, easier_id, used_on)
  values (v_user, p_session, p_exercise, v_easier, public.learner_today(v_user));

  -- Zamiennik wchodzi na miejsce trudnego zadania, więc liczba zadań sesji się nie zmienia.
  -- Gdy migawka nie zna trudnego zadania (powtórka, trudniejsze wejście), dopisujemy zamiennik.
  update public.lesson_sessions
     set exercise_ids = case
           when p_exercise = any (coalesce(exercise_ids, '{}'::uuid[]))
             then array_replace(exercise_ids, p_exercise, v_easier)
           when coalesce(array_length(exercise_ids, 1), 0) > 0
             then array_append(exercise_ids, v_easier)
           else exercise_ids
         end
   where id = p_session;

  return jsonb_build_object(
    'id', v_easier,
    'type', (select ex.type from public.exercises ex where ex.id = v_easier),
    'conceptId', (select ex.concept_id from public.exercises ex where ex.id = v_easier),
    'points', (select ex.points from public.exercises ex where ex.id = v_easier),
    'payload', public.child_exercise(v_easier),
    'hintsLeft', public.hints_left()
  );
end;
$fn$;

revoke execute on function public.hint_limit() from anon, public;
revoke execute on function public.learner_today(uuid) from anon, public;
revoke execute on function public.easier_exercise(uuid) from anon, public;
revoke execute on function public.child_exercise(uuid) from anon, public;
revoke execute on function public.simpler_payload(uuid) from anon, public;
revoke execute on function public.hints_left() from anon, public;
revoke execute on function public.use_hint(uuid, uuid) from anon, public;
grant execute on function public.hints_left() to authenticated;
grant execute on function public.use_hint(uuid, uuid) to authenticated;
