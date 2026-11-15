-- Treść: języki, kursy, działy, lekcje, słówka i zadania.
--
-- Wielojęzyczność opiera się na rozdzieleniu ZNACZENIA od SŁOWA: `concepts` to jednostka
-- znaczeniowa („pies” jako zwierzę), `terms` to jej zapis w konkretnym języku. Dodanie kursu
-- PL->DE to wtedy wiersze w `terms`, bez żadnej migracji. Kierunek tłumaczenia żyje w kursie,
-- nie w słówku.

create table public.languages (
  code        text primary key check (code ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  name_native text not null,
  name_pl     text not null,
  -- Znacznik BCP-47 dla Web Speech API, np. 'en-GB'. Bez niego nie ma zadań ze słuchu.
  tts_lang    text,
  is_active   boolean not null default true
);

create table public.courses (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  source_lang  text not null references public.languages(code),
  target_lang  text not null references public.languages(code),
  title        text not null,
  description  text,
  icon         text,
  sort_order   integer not null default 0,
  is_published boolean not null default false,
  created_at   timestamptz not null default now(),
  check (source_lang <> target_lang)
);

create table public.units (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references public.courses(id) on delete cascade,
  slug         text not null,
  title        text not null,
  icon         text,
  color        text,
  sort_order   integer not null,
  is_published boolean not null default false,
  unique (course_id, slug)
);
create index units_course_order_idx on public.units (course_id, sort_order);

create type public.lesson_kind as enum ('standard', 'review', 'test');

create table public.lessons (
  id                     uuid primary key default gen_random_uuid(),
  unit_id                uuid not null references public.units(id) on delete cascade,
  slug                   text not null,
  title                  text not null,
  icon                   text,
  kind                   public.lesson_kind not null default 'standard',
  sort_order             integer not null,
  -- Lekcja otwiera się po ukończeniu poprzedniej. Pusty wskaźnik = pierwsza w dziale.
  prerequisite_lesson_id uuid references public.lessons(id) on delete set null,
  pass_threshold         numeric(4,3) not null default 0.800 check (pass_threshold between 0 and 1),
  xp_reward              integer not null default 50 check (xp_reward >= 0),
  -- Lekcja powtórkowa nie ma własnych zadań — zestaw buduje get_review_set() ze stanu powtórek
  -- ucznia, więc jest inny dla każdego dziecka.
  review_scope_unit_id   uuid references public.units(id) on delete cascade,
  is_published           boolean not null default false,
  created_at             timestamptz not null default now(),
  unique (unit_id, slug),
  check (kind <> 'review' or review_scope_unit_id is not null)
);
create index lessons_unit_order_idx on public.lessons (unit_id, sort_order);

create type public.part_of_speech as enum ('noun', 'verb', 'adjective', 'adverb', 'phrase', 'other');

create table public.concepts (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid references public.courses(id) on delete cascade,
  -- Klucz naturalny: ponowny import tego samego JSON-a aktualizuje, a nie duplikuje.
  key        text not null,
  image_path text,
  tags       text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (course_id, key)
);

create table public.terms (
  id         uuid primary key default gen_random_uuid(),
  concept_id uuid not null references public.concepts(id) on delete cascade,
  lang       text not null references public.languages(code),
  text       text not null,
  normalized text generated always as (lower(btrim(text))) stored,
  ipa        text,
  pos        public.part_of_speech,
  -- Rodzaj i rodzajnik jako dane, nie kolumny dla konkretnego języka (der/die/das, le/la).
  gender     text,
  article    text,
  -- Nagranie zamiast syntezatora mowy, gdy przeglądarka nie ma głosu dla języka.
  audio_path text,
  note       text,
  -- Synonimy: is_primary = false. Przy sprawdzaniu odpowiedzi liczą się wszystkie.
  is_primary boolean not null default true
);
create unique index terms_one_primary_idx on public.terms (concept_id, lang) where is_primary;
create index terms_lang_normalized_idx on public.terms (lang, normalized);
create index terms_concept_idx on public.terms (concept_id);

create table public.term_forms (
  id         uuid primary key default gen_random_uuid(),
  term_id    uuid not null references public.terms(id) on delete cascade,
  form_label text not null,
  text       text not null,
  normalized text generated always as (lower(btrim(text))) stored,
  unique (term_id, form_label, text)
);

create table public.lesson_items (
  lesson_id  uuid not null references public.lessons(id) on delete cascade,
  -- `restrict`: na koncepcie wiszą stan powtórek i historia prób, więc nie znika razem z lekcją.
  concept_id uuid not null references public.concepts(id) on delete restrict,
  sort_order integer not null,
  primary key (lesson_id, concept_id)
);

create type public.exercise_type as enum (
  'translate_ab',       -- z języka kursu na obcy
  'translate_ba',       -- z obcego na język kursu
  'fill_blank_choice',  -- uzupełnij brakujące słowo, wybór z listy
  'inflection',         -- odmiana / forma wyrazu
  'listening',          -- ze słuchu
  'match_pairs',        -- połącz w pary
  'sentence_order'      -- ułóż zdanie z rozsypanki
);

-- Walidacja payloadu zadania w bazie. Musi być IMMUTABLE (wymóg CHECK), więc nie wolno tu czytać
-- żadnej tabeli. To ostatnia linia obrony — czytelne komunikaty daje zod przy imporcie.
create or replace function public.validate_exercise_payload(t public.exercise_type, p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select case t
    when 'translate_ab' then
          jsonb_typeof(p -> 'prompt') = 'string'
      and jsonb_typeof(p -> 'accepted') = 'array'
      and jsonb_array_length(p -> 'accepted') >= 1
    when 'translate_ba' then
          jsonb_typeof(p -> 'prompt') = 'string'
      and jsonb_typeof(p -> 'accepted') = 'array'
      and jsonb_array_length(p -> 'accepted') >= 1
    when 'fill_blank_choice' then
          jsonb_typeof(p -> 'sentence') = 'string'
      and (p ->> 'sentence') like '%{{blank}}%'
      and jsonb_typeof(p -> 'options') = 'array'
      and jsonb_array_length(p -> 'options') between 2 and 6
      and jsonb_typeof(p -> 'answer') = 'string'
      and p -> 'options' @> jsonb_build_array(p -> 'answer')
    when 'inflection' then
          jsonb_typeof(p -> 'base') = 'string'
      and jsonb_typeof(p -> 'formLabel') = 'string'
      and jsonb_typeof(p -> 'accepted') = 'array'
      and jsonb_array_length(p -> 'accepted') >= 1
    when 'listening' then
          jsonb_typeof(p -> 'speak') = 'string'
      and jsonb_typeof(p -> 'lang') = 'string'
      and jsonb_typeof(p -> 'accepted') = 'array'
      and jsonb_array_length(p -> 'accepted') >= 1
    when 'match_pairs' then
          jsonb_typeof(p -> 'pairs') = 'array'
      and jsonb_array_length(p -> 'pairs') between 3 and 8
    when 'sentence_order' then
          jsonb_typeof(p -> 'tokens') = 'array'
      and jsonb_typeof(p -> 'solution') = 'array'
      and jsonb_array_length(p -> 'tokens') = jsonb_array_length(p -> 'solution')
      and jsonb_array_length(p -> 'tokens') >= 2
    else false
  end;
$fn$;

create table public.exercises (
  id         uuid primary key default gen_random_uuid(),
  lesson_id  uuid not null references public.lessons(id) on delete cascade,
  type       public.exercise_type not null,
  sort_order integer not null,
  -- Powiązanie ze słówkiem: bez niego odpowiedź nie wpływa na powtórki.
  concept_id uuid references public.concepts(id) on delete set null,
  payload    jsonb not null,
  points     integer not null default 10 check (points between 0 and 1000),
  is_active  boolean not null default true,
  constraint exercises_payload_valid check (public.validate_exercise_payload(type, payload))
);
create index exercises_lesson_order_idx on public.exercises (lesson_id, sort_order) where is_active;
