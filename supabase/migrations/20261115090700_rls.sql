-- Uprawnienia: RLS na każdej tabeli + jawne nadania.
--
-- Dwie warstwy, celowo. Najpierw odbieramy wszystko wszystkim i nadajemy tylko to, co potrzebne
-- (uczeń nie dostaje INSERT/UPDATE praktycznie nigdzie — zapisy idą przez funkcje
-- `security definer`), a dopiero potem polityki RLS decydują, które wiersze widać.
-- Sam brak polityki zapisu to za mało: tabela bez włączonego RLS jest w Supabase czytelna dla
-- każdego z kluczem publicznym. Na końcu pliku jest asercja, która tego pilnuje.

-- 1. Czysty stan: anon nie ma dostępu do niczego, zalogowany dostanie wybrane uprawnienia niżej.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon;

-- 2. Odczyt treści i własnych danych.
grant select on
  public.languages, public.courses, public.units, public.lessons,
  public.concepts, public.terms, public.term_forms, public.lesson_items,
  public.badges, public.srs_params,
  public.profiles, public.enrollments, public.lesson_progress, public.lesson_sessions,
  public.attempts, public.srs_state, public.points_ledger, public.user_badges,
  public.user_stats, public.v_user_points
to authenticated;

-- `exercises` jest szczególny: payload zawiera poprawne odpowiedzi. Nadanie SELECT jest
-- potrzebne administratorowi w panelu, a uczeń i tak nic nie zobaczy — polityka SELECT na tej
-- tabeli obejmuje wyłącznie administratora, więc zapytanie ucznia zwraca pustkę. Treść zadania
-- dla ucznia wydaje get_lesson_exercises(), które wycina klucze odpowiedzi.
grant select on public.exercises to authenticated;

-- 3. Jedyne bezpośrednie zapisy ucznia: własny profil i zapisanie się na kurs.
grant update (display_name, avatar_key, ui_lang, time_zone) on public.profiles to authenticated;
grant insert on public.enrollments to authenticated;

-- 4. Administrator pracuje na treści przez zwykłe zapytania — stąd pełne nadania na te tabele.
grant insert, update, delete on
  public.languages, public.courses, public.units, public.lessons,
  public.concepts, public.terms, public.term_forms, public.lesson_items,
  public.exercises, public.badges, public.srs_params
to authenticated;

grant usage on all sequences in schema public to authenticated;

-- 5. RLS.
alter table public.languages       enable row level security;
alter table public.courses         enable row level security;
alter table public.units           enable row level security;
alter table public.lessons         enable row level security;
alter table public.concepts        enable row level security;
alter table public.terms           enable row level security;
alter table public.term_forms      enable row level security;
alter table public.lesson_items    enable row level security;
alter table public.exercises       enable row level security;
alter table public.profiles        enable row level security;
alter table public.enrollments     enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.lesson_sessions enable row level security;
alter table public.attempts        enable row level security;
alter table public.srs_state       enable row level security;
alter table public.points_ledger   enable row level security;
alter table public.badges          enable row level security;
alter table public.user_badges     enable row level security;
alter table public.user_stats      enable row level security;
alter table public.srs_params      enable row level security;

-- 5a. Treść: czytają zalogowani, gdy opublikowana; pisze administrator.
-- Wszędzie `(select auth.uid())`, nigdy gołe `auth.uid()` — podzapytanie liczy się raz na
-- zapytanie, a nie raz na wiersz.

create policy languages_read on public.languages
  for select to authenticated using (true);
create policy languages_admin on public.languages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy courses_read on public.courses
  for select to authenticated using (is_published or public.is_admin());
create policy courses_admin on public.courses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy units_read on public.units
  for select to authenticated using (
    public.is_admin()
    or (is_published and exists (
      select 1 from public.courses c where c.id = units.course_id and c.is_published
    ))
  );
create policy units_admin on public.units
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Lekcja jest widoczna dopiero wtedy, gdy jest otwarta — widoczność i odblokowanie to u nas
-- to samo. Zamknięta lekcja po prostu nie wraca z zapytania.
create policy lessons_read on public.lessons
  for select to authenticated using (
    public.is_admin()
    or (
      is_published
      and exists (
        select 1 from public.units u
        join public.courses c on c.id = u.course_id
        where u.id = lessons.unit_id and u.is_published and c.is_published
      )
      and public.is_lesson_unlocked(lessons.id, (select auth.uid()))
    )
  );
create policy lessons_admin on public.lessons
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy concepts_read on public.concepts
  for select to authenticated using (
    public.is_admin()
    or course_id is null
    or exists (select 1 from public.courses c where c.id = concepts.course_id and c.is_published)
  );
create policy concepts_admin on public.concepts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy terms_read on public.terms
  for select to authenticated using (
    exists (select 1 from public.concepts c where c.id = terms.concept_id)
  );
create policy terms_admin on public.terms
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy term_forms_read on public.term_forms
  for select to authenticated using (
    exists (select 1 from public.terms t where t.id = term_forms.term_id)
  );
create policy term_forms_admin on public.term_forms
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy lesson_items_read on public.lesson_items
  for select to authenticated using (
    exists (select 1 from public.lessons l where l.id = lesson_items.lesson_id)
  );
create policy lesson_items_admin on public.lesson_items
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Zadania: dla ucznia nie ma polityki SELECT i nie ma nadania. Jedyna droga do treści to
-- get_lesson_exercises(), które usuwa klucze odpowiedzi.
create policy exercises_admin on public.exercises
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy badges_read on public.badges
  for select to authenticated using (is_active or public.is_admin());
create policy badges_admin on public.badges
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy srs_params_read on public.srs_params
  for select to authenticated using (true);
create policy srs_params_admin on public.srs_params
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 5b. Dane ucznia: widzi swoje, administrator widzi wszystkie.

create policy profiles_read on public.profiles
  for select to authenticated using (id = (select auth.uid()) or public.is_admin());
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy enrollments_read on public.enrollments
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
create policy enrollments_insert_own on public.enrollments
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy lesson_progress_read on public.lesson_progress
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());

create policy lesson_sessions_read on public.lesson_sessions
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());

create policy attempts_read on public.attempts
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());

create policy srs_state_read on public.srs_state
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());

create policy points_ledger_read on public.points_ledger
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());

create policy user_badges_read on public.user_badges
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());

create policy user_stats_read on public.user_stats
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());

-- Celowo BRAK polityk INSERT/UPDATE/DELETE na lesson_progress, lesson_sessions, attempts,
-- srs_state, points_ledger, user_badges i user_stats. Zapisuje wyłącznie funkcja
-- `security definer`, więc nie da się dopisać sobie punktów ani zaliczyć lekcji.

-- 6. Nadania na funkcje wołane z aplikacji.
grant execute on function public.get_lesson_exercises(uuid) to authenticated;
grant execute on function public.start_lesson_session(uuid, text) to authenticated;
grant execute on function public.submit_attempt(uuid, uuid, jsonb, integer, boolean) to authenticated;
grant execute on function public.finish_lesson_session(uuid) to authenticated;
grant execute on function public.get_review_set(uuid, integer) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_lesson_unlocked(uuid, uuid) to authenticated;

-- award_badges i srs_apply są wołane tylko z wnętrza innych funkcji.
revoke execute on function public.award_badges(uuid) from anon, authenticated, public;

-- 7. Asercja: żadna tabela w `public` nie może zostać bez RLS. Lepiej, żeby migracja padła
-- teraz, niż żeby dane jednego dziecka były widoczne dla drugiego.
do $check$
declare
  r record;
begin
  for r in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename not in (
        select c.relname from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relrowsecurity
      )
  loop
    raise exception 'RLS wyłączone na public.%', r.tablename;
  end loop;
end;
$check$;
