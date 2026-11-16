-- Administrator uczy się na tych samych zasadach co dziecko.
--
-- `is_lesson_unlocked` oddawało administratorowi „otwarte" dla każdej lekcji, a
-- `get_lesson_exercises` i `start_lesson_session` wpuszczały go też do lekcji przed publikacją.
-- Miało to służyć podglądowi z panelu, ale działało wszędzie: administrator wchodzący na mapę
-- kursu jak każdy uczeń miał cały kurs otwarty, bez zamków, bez warunków wstępnych i bez testów
-- działów. Nie da się wtedy sprawdzić tego, co dziecko naprawdę zobaczy, ani uczyć się razem
-- z nim na równych prawach.
--
-- Od teraz obejście jest jawne i jednorazowe: przeglądarka musi o nie poprosić parametrem
-- `p_preview`, a baza i tak sprawdza, czy pytający jest administratorem. Panel podaje go
-- w linku „Zobacz lekcję oczami dziecka" (`?podglad=1`), a zwykłe wejście w lekcję z mapy
-- kursu — nie. Administrator uczący się normalnie ma zamki, warunki wstępne i testy działów
-- dokładnie takie, jak dziecko.
--
-- Postęp zapisuje się jak dotąd na koncie pytającego, także w podglądzie: to jego własne
-- konto, więc niczyjej nauki nie dotyka. Podgląd zmienia dostęp, nie księgowanie.
--
-- Odrzucone: osobna rola „podglądowa" w bazie (drugi zestaw polityk RLS do utrzymania);
-- podgląd po nagłówku albo po `set_config` (nie widać go w sygnaturze, więc łatwo zapomnieć,
-- że funkcja ma dwa tryby); kasowanie postępu administratora po podglądzie (nie da się
-- odróżnić, co powstało w podglądzie, a co w nauce — a usuwanie cudzych danych to zła
-- domyślna odpowiedź).

-- 1. Dział: zamek dotyczy wszystkich, administratora też.
create or replace function public.is_unit_unlocked(p_unit uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select not exists (
    select 1
    from public.units wcze
    join public.lessons t on t.unit_id = wcze.id and t.kind = 'test'
    where wcze.course_id = u.course_id
      and wcze.sort_order < u.sort_order
      and not exists (
        select 1 from public.lesson_progress lp
        where lp.user_id = p_user and lp.lesson_id = t.id and lp.status = 'completed'
      )
  )
  from public.units u
  where u.id = p_unit;
$fn$;

comment on function public.is_unit_unlocked(uuid, uuid) is
  'Czy dział jest dla tego ucznia otwarty: każdy wcześniejszy dział kursu ma zdany test działu. '
  'Podgląd administratora omija to w `get_lesson_exercises`, nie tutaj.';

-- 2. Lekcja: to samo. Reguły przepisane z `…_unit_test.sql` bez gałęzi administratora.
create or replace function public.is_lesson_unlocked(p_lesson uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select case
    -- Zamek działu stoi przed wszystkim innym: zamknięty dział zamyka też swoją powtórkę
    -- i swój test, inaczej dałoby się przeskoczyć dział testem.
    when not public.is_unit_unlocked(l.unit_id, p_user) then false
    -- Test sprawdza dział, więc czeka na komplet jego lekcji. Lekcje nieopublikowane się
    -- nie liczą — dziecko ich nie widzi, nie ma jak ich zaliczyć.
    when l.kind = 'test' then not exists (
      select 1 from public.lessons sl
      where sl.unit_id = l.unit_id and sl.kind = 'standard' and sl.is_published
        and not exists (
          select 1 from public.lesson_progress lp
          where lp.user_id = p_user and lp.lesson_id = sl.id and lp.status = 'completed'
        )
    )
    when l.kind = 'review' then exists (
      select 1
      from public.lesson_progress lp
      join public.lessons sl on sl.id = lp.lesson_id
      where lp.user_id = p_user
        and lp.status = 'completed'
        and sl.unit_id = l.review_scope_unit_id
    )
    when l.prerequisite_lesson_id is null then true
    else exists (
      select 1 from public.lesson_progress lp
      where lp.user_id = p_user
        and lp.lesson_id = l.prerequisite_lesson_id
        and lp.status = 'completed'
    )
  end
  from public.lessons l
  where l.id = p_lesson;
$fn$;

comment on function public.is_lesson_unlocked(uuid, uuid) is
  'Czy lekcja jest dla tego ucznia otwarta: otwarty dział, a w nim warunek wstępny lekcji '
  '(test działu czeka na komplet lekcji). Dla administratora dokładnie tak samo jak dla dziecka.';

-- Nowy parametr to nowa sygnatura, więc stare wersje trzeba usunąć. Kolejność bez znaczenia:
-- `start_lesson_session` rozwiązuje wywołanie dopiero w czasie działania.
drop function if exists public.start_lesson_session(uuid, text, integer, smallint);

-- 3. Start sesji dostaje `p_preview` i podaje go dalej do `get_lesson_exercises`,
-- którego wersję z podglądem wydała już migracja `…_shuffle_exercise_order.sql`.
create or replace function public.start_lesson_session(
  p_lesson uuid,
  p_idempotency_key text,
  p_stage integer default 1,
  p_level smallint default 1,
  -- Podgląd z panelu. Działa tylko dla administratora i tylko wtedy, gdy przeglądarka
  -- poprosi o niego wprost — ucząc się normalnie, administrator ma zamki jak dziecko.
  p_preview boolean default false
)
returns uuid
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_user    uuid := (select auth.uid());
  v_session uuid;
  v_kind    public.lesson_kind;
  v_stages  integer;
  v_total   integer;
  v_ids     uuid[];
  v_level   smallint := coalesce(p_level, 1);
  v_preview boolean  := coalesce(p_preview, false) and public.is_admin();
begin
  if v_user is null then
    raise exception 'Trzeba być zalogowanym' using errcode = '42501';
  end if;
  if v_level < 1 or v_level > 3 then
    raise exception 'Poziom to 1, 2 albo 3' using errcode = '22023';
  end if;
  -- Podgląd administratora wchodzi też w lekcję przed publikacją. Punkty i postęp zapisują się
  -- na jego własnym koncie, więc nie dotykają niczyjej nauki.
  select l.kind into v_kind from public.lessons l
   where l.id = p_lesson and (l.is_published or v_preview);
  if not found then
    raise exception 'Nie ma takiej lekcji' using errcode = '22023';
  end if;
  if not v_preview and not public.is_lesson_unlocked(p_lesson, v_user) then
    raise exception 'Ta lekcja jest jeszcze zamknięta' using errcode = '42501';
  end if;

  if v_kind in ('review', 'test') then
    v_level := 1;
  end if;

  if v_level > 1 and not public.is_level_unlocked(p_lesson, v_user, v_level) and not v_preview then
    raise exception 'Najpierw przejdź tę lekcję na poziomie łatwym' using errcode = '42501';
  end if;

  v_stages := case when v_level > 1 then 1 else public.lesson_stage_count(p_lesson, v_user) end;
  if coalesce(p_stage, 1) < 1 or coalesce(p_stage, 1) > v_stages then
    raise exception 'Ta lekcja nie ma etapu numer %', p_stage using errcode = '22023';
  end if;

  -- Klucz idempotencji jest nadawany na etap: przeglądarka losuje nowy przy wejściu w kolejny.
  select s.id into v_session from public.lesson_sessions s
   where s.user_id = v_user and s.lesson_id = p_lesson and s.idempotency_key = p_idempotency_key;
  if found then
    return v_session;
  end if;

  select coalesce(array_agg(x.id order by x.sort_order), '{}')
    into v_ids
    from public.get_lesson_exercises(p_lesson, coalesce(p_stage, 1), v_level, v_preview) x;

  v_total := coalesce(array_length(v_ids, 1), 0);

  insert into public.lesson_sessions (
    user_id, lesson_id, idempotency_key, total_exercises, stage_nr, level, exercise_ids
  )
  values (
    v_user, p_lesson, p_idempotency_key, v_total, coalesce(p_stage, 1), v_level,
    case when v_kind in ('review', 'test') or v_level > 1 then '{}'::uuid[] else v_ids end
  )
  returning id into v_session;

  return v_session;
end;
$fn$;

revoke execute on function public.start_lesson_session(uuid, text, integer, smallint, boolean) from anon, public;
grant execute on function public.start_lesson_session(uuid, text, integer, smallint, boolean) to authenticated;
