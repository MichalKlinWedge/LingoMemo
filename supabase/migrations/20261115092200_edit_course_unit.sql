-- Edycja i usuwanie kursu oraz działu.
--
-- Trzy rzeczy, których panel dotąd nie umiał: zmiana sluga, zmiana języków kursu i kasowanie.
-- Slug i tytuł to zwykły `update` pod polityką `courses_admin` — baza nie musi o tym wiedzieć.
-- Dwie pozostałe potrzebują wsparcia:
--
-- 1. Języki kursu da się zmienić tylko wtedy, gdy kurs jest jeszcze pusty. `terms` wiszą na
--    kodzie języka, a treść zadań jest kopią słowa — po podmianie `target_lang` słówka zostałyby
--    w starym języku, a lekcja czytałaby je głosem nowego. Pilnuje tego wyzwalacz, nie aplikacja:
--    zapis idzie zwykłym zapytaniem, więc nie ma gdzie indziej tego sprawdzić.
--
-- 2. Kasowanie kursu wymaga kolejności. `lesson_items.concept_id` ma `on delete restrict`
--    (na pojęciu wisi stan powtórek dziecka), a `concepts.course_id` ma `on delete cascade` —
--    samo `delete from courses` wywala się na „restrict”, bo Postgres nie gwarantuje, że pozycje
--    lekcji skasują się przed pojęciami. Najpierw więc działy (z nimi lekcje i ich pozycje),
--    dopiero potem kurs. Dwa zapytania to jedna transakcja tylko wtedy, gdy siedzą w funkcji.

-- 1. Języki kursu: zamrożone od pierwszego słówka.
create or replace function public.courses_langs_frozen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if (new.source_lang, new.target_lang) is distinct from (old.source_lang, old.target_lang)
     and exists (select 1 from public.concepts c where c.course_id = old.id) then
    raise exception 'Nie zmienisz języków kursu, w którym są już słówka. Najpierw usuń słówka albo załóż osobny kurs.'
      using errcode = '22023';
  end if;
  return new;
end;
$fn$;

revoke execute on function public.courses_langs_frozen() from anon, public;

drop trigger if exists trg_courses_langs_frozen on public.courses;
create trigger trg_courses_langs_frozen
before update on public.courses
for each row execute function public.courses_langs_frozen();

-- 2. Usunięcie kursu razem z zawartością i postępami dzieci.
--
-- Funkcja zwraca, co zniknęło — panel pokazuje to w potwierdzeniu, żeby nie trzeba było zgadywać,
-- czy skasowało się puste miejsce, czy pół roku nauki.
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

  -- Kolejność jest tu całą treścią funkcji: działy ciągną za sobą lekcje i pozycje lekcji,
  -- więc kasowanie kursu nie trafia już na `restrict` z `lesson_items`.
  delete from public.units where course_id = p_course;
  delete from public.courses where id = p_course;

  return jsonb_build_object(
    'slug', v_slug, 'units', v_units, 'lessons', v_lessons, 'words', v_words, 'students', v_students
  );
end;
$fn$;

comment on function public.admin_delete_course(uuid) is
  'Kasuje kurs razem z działami, lekcjami, słówkami, zapisami i postępami dzieci. '
  'Działy idą pierwsze — inaczej kaskada trafia na "restrict" z lesson_items.';

revoke execute on function public.admin_delete_course(uuid) from anon, public;
grant execute on function public.admin_delete_course(uuid) to authenticated;
