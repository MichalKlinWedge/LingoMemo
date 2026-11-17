-- Lekcje wskazanego dziecka — także te, których jeszcze nie tknęło.
--
-- Na karcie dziecka rodzic widział dotąd tylko to, co się wydarzyło: kursy z licznikami
-- i ostatnie podejścia. Brakowało drugiej połowy obrazka — co jest jeszcze przed dzieckiem
-- i co mu się właśnie otworzyło. Bez tego nie da się odpowiedzieć na pytanie, które rodzic
-- zadaje naprawdę: „ile zostało?".
--
-- Dlaczego nowa funkcja, a nie `v_my_lessons`: tamten widok liczy wszystko dla ZALOGOWANEGO
-- (`auth.uid()` siedzi w siedmiu miejscach jego definicji), więc rodzic dostałby z niego własne
-- postępy podpisane imieniem dziecka. Dopisanie do niego kolumny `user_id` znaczyłoby przeliczanie
-- odblokowań i etapów dla każdej pary dziecko–lekcja w bazie przy każdym wejściu na ekran kursu,
-- a ten ekran otwiera dziecko kilkanaście razy dziennie. Funkcja z parametrem liczy jedno dziecko.
--
-- Bez `security definer`: dane chronią polityki `*_read`, tak samo jak na każdym innym ekranie.
-- Jawne sprawdzenie na wejściu jest mimo to potrzebne, bo `is_lesson_unlocked` JEST `security
-- definer` i bez tego warunku obcy mógłby się dowiedzieć, które lekcje ma otwarte cudze dziecko —
-- drobiazg, ale wyciek.
--
-- Czego tu nie ma: etapów lekcji. `lesson_stage_progress` nie ma polityki dla rodzica, a etapy
-- to szczegół przebiegu jednej lekcji — rodzic patrzy na kurs z góry. Gdyby kiedyś miały być
-- widoczne, trzeba zacząć od polityki na tamtej tabeli, nie od tej funkcji.

create or replace function public.child_lessons(p_child uuid)
returns table (
  lesson_id   uuid,
  unit_id     uuid,
  course_id   uuid,
  slug        text,
  title       text,
  icon        text,
  kind        public.lesson_kind,
  sort_order  integer,
  is_unlocked boolean,
  status      text,
  stars       integer,
  best_score  numeric,
  word_count  integer
)
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if not (
    p_child = (select auth.uid())
    or public.is_admin()
    or p_child in (select public.my_child_ids())
  ) then
    raise exception 'To nie jest Twoje dziecko' using errcode = '42501';
  end if;

  return query
    select
      l.id, l.unit_id, u.course_id, l.slug, l.title, l.icon, l.kind, l.sort_order,
      public.is_lesson_unlocked(l.id, p_child),
      coalesce(lp.status::text, 'new'),
      coalesce(lp.stars::integer, 0),
      coalesce(lp.best_score, 0::numeric),
      -- Tak samo jak w `v_my_lessons`: powtórka nie ma własnych słówek, więc liczymy zadania,
      -- które naprawdę dostanie TO dziecko.
      case
        when l.kind = 'review' then public.lesson_exercise_count(l.id, p_child)
        else (select count(*)::integer from public.lesson_items li where li.lesson_id = l.id)
      end
    from public.lessons l
    join public.units u on u.id = l.unit_id
    left join public.lesson_progress lp on lp.lesson_id = l.id and lp.user_id = p_child
    where l.is_published
      and u.is_published
      -- Tylko kursy, na które dziecko jest zapisane. `v_my_lessons` wydaje wszystkie lekcje
      -- w bazie, bo ekran kursu i tak pyta o jeden kurs — tutaj pytamy o dziecko, więc to tu
      -- jest miejsce na odsianie kursów, które go nie dotyczą.
      and exists (
        select 1 from public.enrollments e
         where e.user_id = p_child and e.course_id = u.course_id
      )
    order by u.sort_order, l.sort_order;
end;
$fn$;

comment on function public.child_lessons(uuid) is
  'Lekcje jednego dziecka razem z nietkniętymi: status, gwiazdki i czy lekcja jest już otwarta. '
  'Dla samego dziecka, administratora i rodzica, któremu je przypisano.';

revoke execute on function public.child_lessons(uuid) from anon, public;
grant execute on function public.child_lessons(uuid) to authenticated;
