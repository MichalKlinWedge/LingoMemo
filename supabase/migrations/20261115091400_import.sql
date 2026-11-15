-- Import lekcji z JSON-a i miejsce na obrazki.
--
-- Cały import idzie jednym wywołaniem, bo Server Action robiący trzydzieści osobnych zapisów
-- nie jest transakcją — przy błędzie w połowie zostawiłby lekcję bez części zadań.
--
-- Klucze naturalne (slug kursu, działu i lekcji, klucz słówka) sprawiają, że ponowne wklejenie
-- tego samego pliku AKTUALIZUJE treść, zamiast ją dublować.

create or replace function public.admin_import_lesson(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_course      uuid;
  v_unit        uuid;
  v_lesson      uuid;
  v_prereq      uuid;
  v_prereq_slug text;
  v_prereq_unit text;
  v_concept     uuid;
  v_term        uuid;
  v_concepts    integer := 0;
  v_terms       integer := 0;
  v_exercises   integer := 0;
  v_warnings    text[]  := '{}';
  c             jsonb;
  t             jsonb;
  f             jsonb;
  e             jsonb;
  lang          text;
  v_sort        integer := 0;
  v_keys        jsonb   := '{}'::jsonb;  -- klucz słówka -> identyfikator
begin
  perform app_private.assert_admin();

  if (p_payload ->> 'schemaVersion')::integer is distinct from 1 then
    raise exception 'Nieznana wersja formatu importu' using errcode = '22023';
  end if;

  select id into v_course from public.courses where slug = p_payload ->> 'course';
  if v_course is null then
    raise exception 'Nie ma kursu o nazwie "%"', p_payload ->> 'course' using errcode = '22023';
  end if;

  -- Dział.
  insert into public.units (course_id, slug, title, icon, color, sort_order, is_published)
  values (
    v_course,
    p_payload -> 'unit' ->> 'slug',
    p_payload -> 'unit' ->> 'title',
    p_payload -> 'unit' ->> 'icon',
    p_payload -> 'unit' ->> 'color',
    (p_payload -> 'unit' ->> 'sortOrder')::integer,
    true
  )
  on conflict (course_id, slug) do update set
    title      = excluded.title,
    icon       = coalesce(excluded.icon, public.units.icon),
    color      = coalesce(excluded.color, public.units.color),
    sort_order = excluded.sort_order
  returning id into v_unit;

  -- Warunek wstępny: „lekcja" szukana w tym samym dziale albo „dzial/lekcja" w innym.
  v_prereq_slug := p_payload -> 'lesson' ->> 'prerequisiteLessonSlug';
  if v_prereq_slug is not null and btrim(v_prereq_slug) <> '' then
    if position('/' in v_prereq_slug) > 0 then
      v_prereq_unit := split_part(v_prereq_slug, '/', 1);
      v_prereq_slug := split_part(v_prereq_slug, '/', 2);
      select l.id into v_prereq
        from public.lessons l
        join public.units u on u.id = l.unit_id
       where u.course_id = v_course and u.slug = v_prereq_unit and l.slug = v_prereq_slug;
    else
      select l.id into v_prereq
        from public.lessons l
       where l.unit_id = v_unit and l.slug = v_prereq_slug;
    end if;

    if v_prereq is null then
      v_warnings := v_warnings || format('nie znaleziono lekcji wstępnej "%s" — lekcja będzie otwarta od razu',
                                         p_payload -> 'lesson' ->> 'prerequisiteLessonSlug');
    end if;
  end if;

  -- Lekcja.
  insert into public.lessons (
    unit_id, slug, title, icon, kind, sort_order, prerequisite_lesson_id,
    pass_threshold, xp_reward, is_published
  )
  values (
    v_unit,
    p_payload -> 'lesson' ->> 'slug',
    p_payload -> 'lesson' ->> 'title',
    p_payload -> 'lesson' ->> 'icon',
    coalesce((p_payload -> 'lesson' ->> 'kind')::public.lesson_kind, 'standard'),
    (p_payload -> 'lesson' ->> 'sortOrder')::integer,
    v_prereq,
    coalesce((p_payload -> 'lesson' ->> 'passThreshold')::numeric, 0.8),
    coalesce((p_payload -> 'lesson' ->> 'xpReward')::integer, 50),
    coalesce((p_payload -> 'lesson' ->> 'isPublished')::boolean, true)
  )
  on conflict (unit_id, slug) do update set
    title                  = excluded.title,
    icon                   = coalesce(excluded.icon, public.lessons.icon),
    kind                   = excluded.kind,
    sort_order             = excluded.sort_order,
    prerequisite_lesson_id = excluded.prerequisite_lesson_id,
    pass_threshold         = excluded.pass_threshold,
    xp_reward              = excluded.xp_reward,
    is_published           = excluded.is_published
  returning id into v_lesson;

  -- Słówka. Koncepty NIGDY nie są kasowane — wiszą na nich stan powtórek i historia prób.
  for c in select * from jsonb_array_elements(p_payload -> 'concepts') loop
    insert into public.concepts (course_id, key, image_path, tags)
    values (
      v_course,
      c ->> 'key',
      c ->> 'image',
      coalesce((select array_agg(value) from jsonb_array_elements_text(c -> 'tags')), '{}')
    )
    on conflict (course_id, key) do update set
      image_path = coalesce(excluded.image_path, public.concepts.image_path),
      tags       = excluded.tags
    returning id into v_concept;

    v_keys := v_keys || jsonb_build_object(c ->> 'key', v_concept::text);
    v_concepts := v_concepts + 1;

    -- Zapis słowa w każdym języku wymieniamy w całości: inaczej poprawka literówki zostawiłaby
    -- w bazie starą wersję jako „synonim”, który nadal byłby uznawany za poprawną odpowiedź.
    delete from public.terms where concept_id = v_concept;

    for lang in select jsonb_object_keys(c -> 'terms') loop
      for t in select * from jsonb_array_elements(c -> 'terms' -> lang) loop
        insert into public.terms (concept_id, lang, text, pos, ipa, gender, article, audio_path, note, is_primary)
        values (
          v_concept, lang, t ->> 'text',
          (t ->> 'pos')::public.part_of_speech,
          t ->> 'ipa', t ->> 'gender', t ->> 'article', t ->> 'audioPath', t ->> 'note',
          coalesce((t ->> 'isPrimary')::boolean, true)
        )
        returning id into v_term;
        v_terms := v_terms + 1;

        for f in select * from jsonb_array_elements(coalesce(t -> 'forms', '[]'::jsonb)) loop
          insert into public.term_forms (term_id, form_label, text)
          values (v_term, f ->> 'label', f ->> 'text')
          on conflict do nothing;
        end loop;
      end loop;
    end loop;
  end loop;

  -- Przypisanie słówek do lekcji — wymieniane w całości, bo to sama lista.
  delete from public.lesson_items where lesson_id = v_lesson;
  v_sort := 0;
  for c in select * from jsonb_array_elements(p_payload -> 'concepts') loop
    insert into public.lesson_items (lesson_id, concept_id, sort_order)
    values (v_lesson, (v_keys ->> (c ->> 'key'))::uuid, v_sort)
    on conflict do nothing;
    v_sort := v_sort + 1;
  end loop;

  -- Zadania wymieniane w całości. Historia prób to przeżyje: `attempts.exercise_id` ma
  -- `on delete set null`, a typ zadania jest w próbie zamrożony.
  delete from public.exercises where lesson_id = v_lesson;
  v_sort := 0;
  for e in select * from jsonb_array_elements(p_payload -> 'exercises') loop
    insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points)
    values (
      v_lesson,
      (e ->> 'type')::public.exercise_type,
      v_sort,
      case when e ? 'conceptKey' then (v_keys ->> (e ->> 'conceptKey'))::uuid end,
      e -> 'payload',
      coalesce((e ->> 'points')::integer, 10)
    );
    v_sort := v_sort + 1;
    v_exercises := v_exercises + 1;
  end loop;

  return jsonb_build_object(
    'lessonId', v_lesson,
    'unitId', v_unit,
    'concepts', v_concepts,
    'terms', v_terms,
    'exercises', v_exercises,
    'warnings', to_jsonb(v_warnings)
  );
end;
$fn$;

revoke execute on function public.admin_import_lesson(jsonb) from anon, public;
grant execute on function public.admin_import_lesson(jsonb) to authenticated;

-- Obrazki do słówek. Odczyt publiczny, bo obrazek kota nie jest tajemnicą, a dzięki temu
-- działa zwykły <img> bez podpisywania adresów. Wgrywa wyłącznie administrator.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lesson-media', 'lesson-media', true, 2 * 1024 * 1024,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'])
on conflict (id) do nothing;

drop policy if exists lesson_media_read on storage.objects;
create policy lesson_media_read on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'lesson-media');

drop policy if exists lesson_media_write on storage.objects;
create policy lesson_media_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'lesson-media' and public.is_admin());

drop policy if exists lesson_media_update on storage.objects;
create policy lesson_media_update on storage.objects
  for update to authenticated
  using (bucket_id = 'lesson-media' and public.is_admin())
  with check (bucket_id = 'lesson-media' and public.is_admin());

drop policy if exists lesson_media_delete on storage.objects;
create policy lesson_media_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'lesson-media' and public.is_admin());

-- Lista uczniów dla panelu: postępy bez zaglądania w cudze odpowiedzi.
create or replace function public.list_students()
returns table (
  user_id uuid, display_name text, email text, is_admin boolean,
  created_at timestamptz, lessons_done integer, total_points integer,
  streak_days integer, words_seen integer, last_active_on date
)
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform app_private.assert_admin();
  return query
    select
      p.id, p.display_name, u.email::text,
      exists (select 1 from app_private.admin_users a where a.user_id = p.id),
      p.created_at,
      coalesce(us.lessons_done, 0),
      coalesce((select sum(pl.delta)::integer from public.points_ledger pl where pl.user_id = p.id), 0),
      coalesce(us.streak_days, 0),
      (select count(*)::integer from public.srs_state s where s.user_id = p.id),
      us.last_active_on
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.user_stats us on us.user_id = p.id
    order by p.created_at;
end;
$fn$;

revoke execute on function public.list_students() from anon, public;
grant execute on function public.list_students() to authenticated;
