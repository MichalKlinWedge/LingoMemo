-- Usunięcie słówka z lekcji.
--
-- „Z lekcji", nie „z kursu": pojęcie trzyma stan powtórek dziecka (`srs_state`) i jego próby,
-- a `lesson_items.concept_id` ma `on delete restrict` właśnie po to, żeby nie dało się tego
-- skasować przypadkiem. Zdejmujemy więc pozycję z lekcji i zadania, które z tej pary słów
-- powstały — dziecko nie traci niczego, czego się nauczyło.
--
-- Wyjątek: słówko, którego nikt jeszcze nie widział i które nie występuje w żadnej innej lekcji,
-- znika razem z terminami. Inaczej każda literówka zostawiałaby w kursie śmiecia, którego
-- w panelu nie widać, a który wraca przy imporcie jako duplikat klucza.
--
-- Trzy tabele naraz plus warunek — stąd funkcja, a nie `delete()` z Server Action.

create or replace function public.admin_remove_word(p_lesson uuid, p_concept uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_exercises integer;
  v_uzywane   boolean;
  v_dotkniete boolean;
  v_key       text;
begin
  perform app_private.assert_admin();

  select c.key into v_key from public.concepts c where c.id = p_concept;
  if v_key is null then
    raise exception 'Nie ma takiego słówka' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.lesson_items li where li.lesson_id = p_lesson and li.concept_id = p_concept
  ) then
    raise exception 'Tego słówka nie ma w tej lekcji' using errcode = '22023';
  end if;

  delete from public.exercises e where e.lesson_id = p_lesson and e.concept_id = p_concept;
  get diagnostics v_exercises = row_count;

  delete from public.lesson_items li where li.lesson_id = p_lesson and li.concept_id = p_concept;

  -- Czy słówko jeszcze gdzieś pracuje.
  select exists (select 1 from public.lesson_items li where li.concept_id = p_concept)
      or exists (select 1 from public.exercises e where e.concept_id = p_concept)
    into v_uzywane;

  -- Czy jakiekolwiek dziecko już je widziało.
  select exists (select 1 from public.srs_state s where s.concept_id = p_concept)
      or exists (select 1 from public.attempts a where a.concept_id = p_concept)
    into v_dotkniete;

  if not v_uzywane and not v_dotkniete then
    -- Kaskada zabiera `terms` i `term_forms`.
    delete from public.concepts c where c.id = p_concept;
    return jsonb_build_object('key', v_key, 'exercises', v_exercises, 'removed', 'course');
  end if;

  return jsonb_build_object('key', v_key, 'exercises', v_exercises, 'removed', 'lesson');
end;
$fn$;

comment on function public.admin_remove_word(uuid, uuid) is
  'Zdejmuje słówko z lekcji razem z jej zadaniami dla tego słówka. Słówko nietknięte przez '
  'żadne dziecko i nieużywane w innej lekcji kasuje całkiem — zwraca "removed": lesson albo course.';

revoke execute on function public.admin_remove_word(uuid, uuid) from anon, public;
grant execute on function public.admin_remove_word(uuid, uuid) to authenticated;
