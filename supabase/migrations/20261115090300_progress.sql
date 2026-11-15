-- Uczeń i jego postępy.
--
-- Wszystkie tabele w tym pliku są dla ucznia TYLKO DO ODCZYTU. Zapis idzie wyłącznie przez
-- funkcje `security definer` (start_lesson_session, submit_attempt, finish_lesson_session) —
-- brak polityki INSERT/UPDATE to celowa decyzja, nie przeoczenie. Dzięki temu nie da się
-- dopisać sobie punktów ani oznaczyć lekcji jako zaliczonej.

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar_key   text,
  ui_lang      text not null default 'pl' references public.languages(code),
  -- Strefa czasowa dziecka. Termin powtórki to data, nie moment — liczona w UTC pojawiałaby się
  -- w środku nocy.
  time_zone    text not null default 'Europe/Warsaw',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- Rola administratora NIE jest kolumną tej tabeli: patrz app_private.admin_users.

-- Profil powstaje razem z kontem; imię bierzemy z metadanych podanych przy rejestracji.
create or replace function public.create_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(coalesce(new.email, 'uczen'), '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$fn$;

drop trigger if exists trg_create_profile on auth.users;
create trigger trg_create_profile
after insert on auth.users
for each row execute function public.create_profile();

create table public.enrollments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  course_id  uuid not null references public.courses(id) on delete cascade,
  started_at timestamptz not null default now(),
  unique (user_id, course_id)
);

create type public.progress_status as enum ('in_progress', 'completed');

create table public.lesson_progress (
  user_id        uuid not null references auth.users(id) on delete cascade,
  lesson_id      uuid not null references public.lessons(id) on delete cascade,
  status         public.progress_status not null default 'in_progress',
  best_score     numeric(4,3) not null default 0,
  last_score     numeric(4,3),
  stars          smallint not null default 0 check (stars between 0 and 3),
  attempts_count integer not null default 0,
  completed_at   timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (user_id, lesson_id)
);
create index lesson_progress_user_status_idx on public.lesson_progress (user_id, status);

create table public.lesson_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  lesson_id       uuid not null references public.lessons(id) on delete cascade,
  -- Klucz z przeglądarki (crypto.randomUUID): przy zerwanym połączeniu ponowne wysłanie tej
  -- samej lekcji nie zakłada drugiej sesji.
  idempotency_key text not null,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  total_exercises integer not null default 0,
  correct_count   integer not null default 0,
  score           numeric(4,3),
  xp_awarded      integer not null default 0,
  unique (user_id, lesson_id, idempotency_key)
);
create index lesson_sessions_user_started_idx on public.lesson_sessions (user_id, started_at desc);

create table public.attempts (
  id            bigint generated always as identity primary key,
  session_id    uuid not null references public.lesson_sessions(id) on delete cascade,
  -- Zduplikowane z sesji, żeby polityka RLS nie musiała dołączać kolejnej tabeli.
  user_id       uuid not null references auth.users(id) on delete cascade,
  exercise_id   uuid references public.exercises(id) on delete set null,
  concept_id    uuid references public.concepts(id) on delete set null,
  -- Zamrożony typ: historia przeżyje usunięcie zadania przez administratora.
  exercise_type public.exercise_type not null,
  is_correct    boolean not null,
  -- Poprawna mimo literówki. Do statystyk i do oceny „hard” w powtórkach.
  near_miss     boolean not null default false,
  hint_used     boolean not null default false,
  raw_answer    jsonb not null,
  response_ms   integer,
  created_at    timestamptz not null default now()
);
create index attempts_user_created_idx on public.attempts (user_id, created_at desc);
create index attempts_user_concept_idx on public.attempts (user_id, concept_id);
create index attempts_session_idx on public.attempts (session_id);

-- Stan powtórek per słówko i uczeń. Model pamięci FSRS-6: stabilność (ile dni do spadku
-- przypomnienia do 90%) i trudność (1-10). Szczegóły w migracji …_srs.sql.
create table public.srs_state (
  user_id          uuid not null references auth.users(id) on delete cascade,
  concept_id       uuid not null references public.concepts(id) on delete cascade,
  course_id        uuid not null references public.courses(id) on delete cascade,
  stability        double precision not null default 0,
  difficulty       double precision not null default 0,
  due_on           date not null default current_date,
  last_reviewed_at timestamptz,
  reps             integer not null default 0,
  lapses           integer not null default 0,
  last_result      boolean,
  primary key (user_id, concept_id)
);
create index srs_state_user_due_idx on public.srs_state (user_id, due_on);
create index srs_state_user_course_lapses_idx on public.srs_state (user_id, course_id, lapses desc);
