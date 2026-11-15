-- Usunięcie kursu zależy od tego, czy ktoś się już z niego uczył.
--
-- Dotąd „Usuń kurs" zawsze znaczyło to samo: kurs znikał razem z działami, lekcjami, słówkami
-- i postępami dzieci. Przy kursie, którego nikt nie tknął, ta ceremonia jest przesadzona —
-- nie ma czego stracić. Przy kursie, który dziecko już robi, jest odwrotnie: jedno kliknięcie
-- kasuje historię nauki, serie dni i harmonogram powtórek, a tego nie odtworzy żaden backup
-- treści, bo to nie treść.
--
-- Od teraz ta sama akcja robi jedną z dwóch rzeczy, a decyduje o tym baza, nie przeglądarka:
--
--   * nikt nie zaczął  -> kurs znika naprawdę, tak jak dotąd;
--   * ktoś już zaczął  -> kurs zostaje, ale schodzi dzieciom z oczu (`is_published = false`).
--
-- Ukrycie jest odwracalne jednym odznaczeniem w panelu, więc nie udajemy, że to usunięcie:
-- funkcja zwraca, co właściwie zrobiła, a panel mówi to wprost JESZCZE PRZED kliknięciem.
--
-- „Zaczął" to ślad nauki, nie zapis na kurs. Dziecko zapisane, które nie otworzyło ani jednej
-- lekcji, nic nie traci — zapis znika razem z kursem i tyle.
--
-- Odrzucone: kolumna `deleted_at` i kasowanie miękkie wszędzie — każde zapytanie o kursy
-- musiałoby ją omijać, a mamy już `is_published`, które robi dokładnie to, o co chodzi
-- (dziecko nie widzi, administrator widzi). Odrzucone też: wybór „usuń albo ukryj" oddany
-- administratorowi — to pytanie, na które baza zna odpowiedź lepiej niż człowiek patrzący
-- na listę kursów.

/**
 * Czy ktoś się już uczył z tego kursu. Wewnętrzna — wołają ją funkcje `security definer`,
 * a `list_courses_started` wystawia wynik panelowi.
 *
 * Trzy ślady, bo każdy powstaje w innym momencie: sesja lekcji zaczyna się przy pierwszym
 * wejściu, `lesson_progress` zapisuje wynik podejścia, a `srs_state` trzyma harmonogram
 * powtórek słówka. W praktyce pierwszy wystarcza, ale sesję da się skasować, a powtórki zostają.
 */
create or replace function public.course_started(p_course uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from public.lesson_sessions s
      join public.lessons l on l.id = s.lesson_id
      join public.units u on u.id = l.unit_id
     where u.course_id = p_course
  ) or exists (
    select 1
      from public.lesson_progress p
      join public.lessons l on l.id = p.lesson_id
      join public.units u on u.id = l.unit_id
     where u.course_id = p_course
  ) or exists (
    select 1
      from public.srs_state st
      join public.concepts c on c.id = st.concept_id
     where c.course_id = p_course
  );
$fn$;

comment on function public.course_started(uuid) is
  'Czy w kursie jest ślad nauki dziecka: sesja lekcji, wynik podejścia albo stan powtórek. '
  'Sam zapis na kurs się nie liczy.';

revoke execute on function public.course_started(uuid) from anon, authenticated, public;

/** Dla panelu: który kurs da się usunąć, a który tylko ukryć. Jedno zapytanie na całą listę. */
create or replace function public.list_courses_started()
returns table (course_id uuid, started boolean)
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform app_private.assert_admin();
  return query select c.id, public.course_started(c.id) from public.courses c;
end;
$fn$;

revoke execute on function public.list_courses_started() from anon, public;
grant execute on function public.list_courses_started() to authenticated;

-- Przepisana w całości (`create or replace` nie zna zmian cząstkowych). Względem
-- `20261115092200_edit_course_unit.sql` dochodzi rozgałęzienie na początku i pole `action`
-- w zwracanym obiekcie.
create or replace function public.admin_delete_course(p_course uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_slug     text;
  v_units    integer;
  v_lessons  integer;
  v_words    integer;
  v_students integer;
begin
  perform app_private.assert_admin();

  select c.slug into v_slug from public.courses c where c.id = p_course;
  if v_slug is null then
    raise exception 'Nie ma takiego kursu' using errcode = '22023';
  end if;

  select count(*) into v_units from public.units u where u.course_id = p_course;
  select count(*) into v_lessons
    from public.lessons l join public.units u on u.id = l.unit_id where u.course_id = p_course;
  select count(*) into v_words from public.concepts c where c.course_id = p_course;
  select count(*) into v_students from public.enrollments e where e.course_id = p_course;

  -- Kurs, z którego ktoś się już uczył, tylko schodzi z oczu. Postępy, serie i harmonogram
  -- powtórek zostają nietknięte — to jedyna rzecz w panelu, której nie da się odtworzyć.
  if public.course_started(p_course) then
    update public.courses set is_published = false where id = p_course;
    return jsonb_build_object(
      'action', 'hidden', 'slug', v_slug,
      'units', v_units, 'lessons', v_lessons, 'words', v_words, 'students', v_students
    );
  end if;

  -- Kolejność jest tu całą treścią gałęzi: działy ciągną za sobą lekcje i pozycje lekcji,
  -- więc kasowanie kursu nie trafia już na `restrict` z `lesson_items`.
  delete from public.units where course_id = p_course;
  delete from public.courses where id = p_course;

  return jsonb_build_object(
    'action', 'deleted', 'slug', v_slug,
    'units', v_units, 'lessons', v_lessons, 'words', v_words, 'students', v_students
  );
end;
$fn$;

comment on function public.admin_delete_course(uuid) is
  'Kurs bez śladu nauki kasuje razem z działami, lekcjami i słówkami; kurs, z którego ktoś się '
  'już uczył, tylko ukrywa (is_published = false). Zwraca w polu "action", co zrobiła.';

revoke execute on function public.admin_delete_course(uuid) from anon, public;
grant execute on function public.admin_delete_course(uuid) to authenticated;
