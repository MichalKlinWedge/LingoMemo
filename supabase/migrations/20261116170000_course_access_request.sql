-- Dostęp do kursu na zapis, a do tego prośba, którą uczeń wysyła sam.
--
-- Dotąd kurs opublikowany był otwarty dla każdego zalogowanego: strona główna wypisywała
-- wszystkie kursy z `courses`, ekran kursu nie pytał o zapis, a polityka `enrollments_insert_own`
-- pozwalała dziecku zapisać się samemu. Zapis istniał, ale nie znaczył nic poza statystykami —
-- dziecko z zaproszeniem do „Angielskiego klasa 4" widziało tak samo wszystko inne.
--
-- Teraz zapis jest warunkiem nauki, a kurs bez zapisu dziecko widzi tylko z nazwy, w osobnej
-- sekcji, z przyciskiem prośby. Decyduje administrator, bo to on wie, czy czwartoklasista ma
-- się brać za włoski.
--
-- Prośba jest śladem, nie kolejką zadań — tak samo jak `parent_requests` z `…_parent_request.sql`.
-- Para (dziecko, kurs) z datą pierwszego i ostatniego pytania, kasowana w chwili zapisu przez
-- wyzwalacz. Administrator ma widzieć „to dziecko prosi o ten kurs" przy liście uczniów kursu,
-- a nie odhaczać zgłoszenia osobnym przyciskiem.
--
-- Bramką jest `is_lesson_unlocked`, a nie polityki na `courses`: nazwy kursów mają zostać
-- widoczne (bez nich nie ma o co prosić), a zamknięte ma być ROBIENIE lekcji. Ta jedna funkcja
-- stoi pod `get_lesson_exercises`, `start_lesson_session` i ekranem kursu, więc wystarczy jedno
-- miejsce zamiast polityki na czterech tabelach.
--
-- Odrzucone: zapis na życzenie bez pytania (to jest dokładnie stan sprzed tej migracji);
-- polityka SELECT na `courses` ograniczona do zapisanych (dziecko nie zobaczyłoby nazw, więc
-- nie miałoby o co poprosić, a rodzic straciłby kursy dziecka z `v_my_courses`); osobny ekran
-- „katalog kursów" (dwie listy na stronie głównej wystarczą, a trzeci ekran trzeba znaleźć);
-- powiadomienie mailem do administratora (nie mamy wysyłki, a ślad przy uczniu widać od razu).

-- 1. Zapis zakłada administrator albo zaproszenie. Dziecko już nie zapisze się samo.
--
-- Wyzwalacz z zaproszeń (`…_invitations.sql`) jest `security definer`, więc działa dalej —
-- dziecko dostaje zapis na kurs z linku, którym je zaproszono.
drop policy if exists enrollments_insert_own on public.enrollments;

-- 2. Zapisy wsteczne: kto już się uczył, ten zostaje przy swoim.
--
-- Bez tego bramka zamknęłaby dzieciom kursy, które robią dzisiaj — zapis miał dotąd zbyt małe
-- znaczenie, żeby zakładać, że jest wszędzie tam, gdzie jest nauka. Ślady te same, co w
-- `course_started` z `…_delete_or_hide_course.sql`: sesja lekcji, wynik podejścia i harmonogram
-- powtórek. Każdy powstaje w innym momencie, więc bierzemy wszystkie trzy.
insert into public.enrollments (user_id, course_id)
select s.user_id, u.course_id
  from public.lesson_sessions s
  join public.lessons l on l.id = s.lesson_id
  join public.units u on u.id = l.unit_id
union
select p.user_id, u.course_id
  from public.lesson_progress p
  join public.lessons l on l.id = p.lesson_id
  join public.units u on u.id = l.unit_id
union
select st.user_id, c.course_id
  from public.srs_state st
  join public.concepts c on c.id = st.concept_id
on conflict (user_id, course_id) do nothing;

-- 3. Czy dziecko jest zapisane na kurs.
create or replace function public.is_enrolled(p_course uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.enrollments e
     where e.course_id = p_course and e.user_id = p_user
  );
$fn$;

comment on function public.is_enrolled(uuid, uuid) is
  'Czy ten uczeń ma zapis na ten kurs. Zapis zakłada administrator albo zaproszenie.';

revoke execute on function public.is_enrolled(uuid, uuid) from anon, public;
grant execute on function public.is_enrolled(uuid, uuid) to authenticated;

-- 4. Bramka. Reszta ciała przepisana z `20261116110000_admin_learns_as_child.sql` —
-- `create or replace` nie zna zmian cząstkowych.
--
-- Zapis sprawdzamy PRZED wszystkim innym: kurs bez zapisu jest zamknięty w całości, razem
-- z powtórkami i testami działów. Administrator nie ma tu wyjątku, bo uczy się na zasadach
-- dziecka; do podglądu z panelu służy `p_preview`, które tej funkcji w ogóle nie woła.
create or replace function public.is_lesson_unlocked(p_lesson uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select case
    when not public.is_enrolled(
           (select u.course_id from public.units u where u.id = l.unit_id), p_user
         ) then false
    -- Test powtórkowy jest otwarty dokładnie wtedy, gdy stoi bramka. Bez zaległości nie ma
    -- czego powtarzać, więc kafelek jest zamknięty i ekran go nie pokazuje.
    when l.review_scope_course_id is not null then public.review_gate_on(l.review_scope_course_id, p_user)
    -- Bramka stoi przed zamkiem działu: zamyka cały kurs, razem z powtórkami i testami działów.
    when public.review_gate_on(
           (select u.course_id from public.units u where u.id = l.unit_id), p_user
         ) then false
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
  'Czy lekcja jest dla tego ucznia otwarta: zapis na kurs, otwarty dział, a w nim warunek '
  'wstępny lekcji (test działu czeka na komplet lekcji). Dla administratora tak samo jak dla dziecka.';

-- 5. Prośby.
create table if not exists app_private.course_access_requests (
  user_id   uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  -- `first_at` mówi, jak długo dziecko czeka; `last_at` tylko tyle, że dalej mu zależy.
  first_at  timestamptz not null default now(),
  last_at   timestamptz not null default now(),
  primary key (user_id, course_id)
);

comment on table app_private.course_access_requests is
  'Prośby uczniów o dostęp do kursu. Kasowane wyzwalaczem w chwili zapisu.';

/**
 * Prośba o dostęp. Woła ją przycisk przy kursie, na który dziecko nie jest zapisane.
 *
 * O sensie prośby decyduje baza: kurs musi istnieć i być opublikowany (o kursie ukrytym dziecko
 * nawet nie wie), a dziecko nie może już być zapisane. Powtórne kliknięcie nie zakłada drugiej
 * prośby, tylko odświeża `last_at`.
 */
create or replace function public.request_course_access(p_course uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Trzeba być zalogowanym' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.courses c where c.id = p_course and c.is_published
  ) then
    raise exception 'Nie ma takiego kursu' using errcode = '22023';
  end if;

  -- Zapisany o nic nie prosi. Milczenie zamiast błędu: przycisk mógł zostać kliknięty na
  -- stronie otwartej jeszcze przed zapisem.
  if public.is_enrolled(p_course, v_user) then
    delete from app_private.course_access_requests
     where user_id = v_user and course_id = p_course;
    return;
  end if;

  insert into app_private.course_access_requests (user_id, course_id)
  values (v_user, p_course)
  on conflict (user_id, course_id) do update set last_at = now();
end;
$fn$;

revoke execute on function public.request_course_access(uuid) from anon, public;
grant execute on function public.request_course_access(uuid) to authenticated;

/** Kursy, o które już poprosiłem — żeby przycisk zamienił się w „prośba wysłana". */
create or replace function public.my_course_requests()
returns table (course_id uuid, first_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.course_id, r.first_at
    from app_private.course_access_requests r
   where r.user_id = (select auth.uid())
   order by r.first_at;
$fn$;

revoke execute on function public.my_course_requests() from anon, public;
grant execute on function public.my_course_requests() to authenticated;

/** Wszystkie czekające prośby, z imieniem dziecka. Dla panelu — stąd `assert_admin`. */
create or replace function public.admin_course_requests()
returns table (user_id uuid, course_id uuid, display_name text, first_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform app_private.assert_admin();

  return query
    select r.user_id, r.course_id, coalesce(p.display_name, 'bez imienia'), r.first_at
      from app_private.course_access_requests r
      left join public.profiles p on p.id = r.user_id
     order by r.first_at;
end;
$fn$;

revoke execute on function public.admin_course_requests() from anon, public;
grant execute on function public.admin_course_requests() to authenticated;

-- 6. Zapis kasuje prośbę. Dzięki temu administrator nie ma osobnego przycisku „rozpatrz" —
-- zapisuje tak jak dotąd, a ślad znika sam.
create or replace function public.clear_course_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  delete from app_private.course_access_requests
   where user_id = new.user_id and course_id = new.course_id;
  return new;
end;
$fn$;

drop trigger if exists enrollments_clear_request on public.enrollments;
create trigger enrollments_clear_request
  after insert on public.enrollments
  for each row execute function public.clear_course_request();
