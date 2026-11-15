-- Punkty i odznaki.
--
-- Punkty to KSIĘGA, nie licznik: każdy wpis mówi, za co został przyznany. Dzięki temu da się
-- pokazać dziecku historię („za lekcję Zwierzęta: 80 punktów”), a przy okazji ograniczenie
-- unikalności blokuje podwójne naliczenie przy ponowionym żądaniu.

create type public.point_reason as enum (
  'exercise_correct',
  'lesson_completed',
  'streak_day',
  'badge',
  'review_completed',
  'manual'
);

create table public.points_ledger (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  delta      integer not null,
  reason     public.point_reason not null,
  ref_type   text,
  ref_id     uuid,
  created_at timestamptz not null default now(),
  -- `nulls not distinct`: dwa wpisy bez odniesienia też się wykluczają, inaczej ograniczenie
  -- nie działałoby akurat tam, gdzie jest najbardziej potrzebne.
  constraint points_no_double_award unique nulls not distinct (user_id, reason, ref_type, ref_id)
);
create index points_ledger_user_created_idx on public.points_ledger (user_id, created_at desc);

-- `security_invoker`: widok dziedziczy RLS tabeli bazowej. Bez tego działałby z uprawnieniami
-- właściciela i pokazywał punkty wszystkich dzieci.
create view public.v_user_points with (security_invoker = on) as
  select user_id, sum(delta)::integer as total_points
  from public.points_ledger
  group by user_id;

create table public.badges (
  code        text primary key,
  title       text not null,
  description text not null,
  icon        text,
  -- Reguła deklaratywna, np. {"kind":"lessons_completed","n":10}. Sprawdzana w award_badges().
  rule        jsonb not null,
  sort_order  integer not null default 0,
  is_active   boolean not null default true
);

create table public.user_badges (
  user_id    uuid not null references auth.users(id) on delete cascade,
  badge_code text not null references public.badges(code) on delete cascade,
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge_code)
);

-- Seria dni nauki i sumy do szybkiego pokazania na ekranie startowym. Liczone w
-- finish_lesson_session, nie wyliczane za każdym razem z historii.
create table public.user_stats (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  streak_days    integer not null default 0,
  best_streak    integer not null default 0,
  last_active_on date,
  lessons_done   integer not null default 0,
  updated_at     timestamptz not null default now()
);
